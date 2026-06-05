import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConnectionManager, type ConnectionBackupExportOptions, type ConnectionBackupImportOptions, type RemoteEditBackupFile, type RemoteEditBackupImportResult } from '../connection/ConnectionManager';
import { buildRemoteEditUri } from '../filesystem/RemoteEditFileSystemProvider';
import { dirnameRemotePath, joinRemotePath, normalizeRemotePath, RemoteEntry, SftpSessionManager, type RemoteChecksumSummary, type RemoteChecksumValue, type RemoteCommandStreamingControl } from '../ssh/SftpSessionManager';
import { buildDeleteEntriesConfirmationDetail } from '../utils/deleteConfirmationUtils';
import { formatBytes, isRemoteEditOperationCancelled, throwIfCancelled, withRemoteEditProgress, type RemoteEditProgressReporter } from '../utils/progressUtils';
import { appendOutputLog, type OutputLogDetails } from '../utils/outputLogger';
import { getNonce } from '../utils/webviewUtils';
import { renderRemoteEditHtml } from './RemoteEditHtml';
import { handleRemoteEditPanelMessage } from './RemoteEditPanelHandlers';
import { RemoteEditIncomingMessageType, RemoteEditOutboundMessageType, type RemoteEditWebviewMessage } from './RemoteEditPanelMessages';
import { RemoteEditPanelState } from './RemoteEditPanelState';
import { calculateModeFromPermissionState, parsePermissionString, type SetPermissionsDialogResult, type SetPermissionsPanelOptions } from './RemoteEditPermissions';


type TransferConflictDecision = 'overwrite' | 'skip' | 'cancel' | 'merge';
type TransferConflictChoice = TransferConflictDecision | 'overwriteAll' | 'skipAll' | 'mergeAll';
type TransferConflictKind = 'file' | 'directory' | 'typeMismatch';
type TransferCompletionStatus = 'Completed' | 'Completed with errors' | 'Completed with skipped items' | 'Cancelled' | 'Failed';
type ArchiveFormat = 'tar.gz' | 'tar.bz2' | 'tar.xz' | 'tar.Z';

interface TransferConflictState {
  overwriteAllFiles: boolean;
  skipAllFiles: boolean;
  mergeAllFolders: boolean;
  skipAllFolders: boolean;
}

interface TransferSkipState {
  paths: Set<string>;
  prefixes: Set<string>;
}

interface PendingTransferConflict {
  requestId: string;
  transferId: string;
  operation: 'Upload' | 'Download';
  kind: TransferConflictKind;
  relativePath: string;
  sourcePath: string;
  destinationPath: string;
  sourceType: string;
  destinationType: string;
  sourceSize?: number;
  destinationSize?: number;
  sourceModified?: number;
  destinationModified?: number;
  hasMultipleItems: boolean;
  resolve: (decision: TransferConflictChoice) => void;
}

interface UploadTransferItem {
  kind: 'file' | 'directory';
  localPath: string;
  remotePath: string;
  relativePath: string;
  size: number;
}

interface DownloadTransferItem {
  kind: 'file' | 'directory';
  remotePath: string;
  localPath: string;
  relativePath: string;
  size: number;
}

interface TransferSummary {
  transferredFiles: number;
  skippedItems: string[];
  failedItems: string[];
}

interface ConfirmDialogOptions {
  title: string;
  message: string;
  details?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface AggregateTransferState {
  completedBytes: number;
  totalBytes: number;
}

interface QueuedTransferJob {
  id: string;
  operation: 'Upload' | 'Download';
  connectionId: string;
  connectionLabel: string;
  title: string;
  from: string;
  to: string;
  progress: string;
  queuedAt?: string;
  startedAt?: string;
  run: (cancellationSource: vscode.CancellationTokenSource) => Promise<TransferCompletionStatus>;
  resultSummary?: TransferSummary;
}


interface TransferQueueItemSnapshot {
  id: string;
  operation: 'Upload' | 'Download';
  title: string;
  connection: string;
  from: string;
  to: string;
  connectionId: string;
  status: 'Preparing' | 'Running' | 'Waiting' | 'Cancelling' | TransferCompletionStatus;
  progress: string;
  canCancel: boolean;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  skippedItems?: string[];
  failedItems?: string[];
}

const COMPOUND_FILE_EXTENSIONS = [
  '.tar.gz',
  '.tar.bz2',
  '.tar.xz',
  '.tar.Z',
  '.tar.lz',
  '.tar.lzma',
  '.tar.zst'
];


function formatBackupFileDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function buildCopyFileName(fileName: string, copyIndex: number): string {
  const suffix = `_copy${copyIndex <= 1 ? '' : copyIndex}`;
  const lowerName = fileName.toLowerCase();
  const compoundExtension = COMPOUND_FILE_EXTENSIONS.find(extension => lowerName.endsWith(extension.toLowerCase()));

  if (compoundExtension) {
    const originalExtension = fileName.slice(fileName.length - compoundExtension.length);
    const baseName = fileName.slice(0, fileName.length - compoundExtension.length);
    return `${baseName}${suffix}${originalExtension}`;
  }

  const lastDotIndex = fileName.lastIndexOf('.');
  const hasSimpleExtension = lastDotIndex > 0;

  if (!hasSimpleExtension) {
    return `${fileName}${suffix}`;
  }

  const baseName = fileName.slice(0, lastDotIndex);
  const extension = fileName.slice(lastDotIndex);
  return `${baseName}${suffix}${extension}`;
}

export class RemoteEditPanel {
  private static currentPanel: RemoteEditPanel | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panelDisposables: vscode.Disposable[] = [];
  private isDisposed = false;
  private readonly state = new RemoteEditPanelState();
  private activeTransferCancellationSource: vscode.CancellationTokenSource | undefined;
  private activeTransferConnectionId: string | undefined;
  private activeTransferJob: QueuedTransferJob | undefined;
  private activeTransferCancelling = false;
  private activeTransferStatus: 'Preparing' | 'Running' | 'Waiting' = 'Preparing';
  private pendingTransferConflict: PendingTransferConflict | undefined;
  private transferConflictSequence = 0;
  private readonly transferQueue: QueuedTransferJob[] = [];
  private readonly completedTransfers: TransferQueueItemSnapshot[] = [];
  private readonly maxCompletedTransfersPerConnection = 50;
  private runningTransfers = 0;
  private readonly maxConcurrentTransfers = 1;
  private activeConnectionCancellationSource: vscode.CancellationTokenSource | undefined;
  private activeRemoteCommand: { id: string; connectionId: string; cancellationSource: vscode.CancellationTokenSource; control?: RemoteCommandStreamingControl; stopMode?: 'stop' | 'force' } | undefined;
  private pendingPermissionsDialogResolve: ((result?: SetPermissionsDialogResult) => void) | undefined;
  private readonly pendingConfirmDialogs = new Map<string, (confirmed: boolean) => void>();
  private confirmDialogSequence = 0;
  private pendingImportBackupFile: RemoteEditBackupFile | undefined;

  static open(
    context: vscode.ExtensionContext,
    sessions: SftpSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel
  ): void {
    if (RemoteEditPanel.currentPanel) {
      if (RemoteEditPanel.currentPanel.panel && !RemoteEditPanel.currentPanel.isDisposed) {
        RemoteEditPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
        return;
      }

      const panel = RemoteEditPanel.createWebviewPanel();
      RemoteEditPanel.currentPanel.attachPanel(panel);
      return;
    }

    RemoteEditPanel.currentPanel = new RemoteEditPanel(
      RemoteEditPanel.createWebviewPanel(),
      context,
      sessions,
      connectionManager,
      output
    );
  }

  private static createWebviewPanel(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      'remoteedit.home',
      'RemoteEdit',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    panel.iconPath = new vscode.ThemeIcon('remote-explorer');
    return panel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly sessions: SftpSessionManager,
    private readonly connectionManager: ConnectionManager,
    private readonly output: vscode.OutputChannel
  ) {
    this.state.initializeFromSessions(this.sessions.listConnections());

    this.disposables.push(
      vscode.commands.registerCommand('remoteedit.cancelTransfer', () => this.cancelActiveTransfer())
    );

    this.attachPanel(panel);
  }

  private attachPanel(panel: vscode.WebviewPanel): void {
    this.disposePanelDisposables();
    this.panel = panel;
    this.isDisposed = false;
    this.panel.webview.html = this.renderHtml(this.panel.webview);

    this.panel.onDidDispose(() => this.handlePanelDisposed(), null, this.panelDisposables);
    this.panel.webview.onDidReceiveMessage(message => this.handleMessage(message), null, this.panelDisposables);
  }

  private handlePanelDisposed(): void {
    this.isDisposed = true;
    this.panel = undefined;
    this.disposePanelDisposables();
    this.stopRemoteCommand({});
    this.resolvePendingPermissionsDialog();
    this.resolvePendingConfirmDialogs();
  }

  private disposePanelDisposables(): void {
    while (this.panelDisposables.length) {
      this.panelDisposables.pop()?.dispose();
    }
  }

  private async handleMessage(message: RemoteEditWebviewMessage): Promise<void> {
    try {
      await handleRemoteEditPanelMessage(message, {
        getActiveConnectionId: () => this.state.getActiveConnectionId(),
        getActivePath: () => this.getActivePath(),
        onReady: async () => {
          await this.sendProfiles();
          await this.restoreActiveSession();
          this.postTransferQueueState();
          this.postPendingTransferConflict();
        },
        saveConnection: payload => this.saveConnection(payload),
        pickPrivateKeyPath: () => this.pickPrivateKeyPath(),
        deleteConnection: payload => this.deleteConnection(payload),
        renameConnection: payload => this.renameConnection(payload),
        requestImportConnectionsSettings: () => this.requestImportConnectionsSettings(),
        exportConnectionsSettings: payload => this.exportConnectionsSettings(payload),
        importConnectionsSettings: payload => this.importConnectionsSettings(payload),
        connect: payload => this.connect(payload),
        cancelConnection: () => this.cancelConnection(),
        disconnect: connectionId => this.disconnect(connectionId),
        switchSession: connectionId => this.switchSession(connectionId),
        enableSudoMode: () => this.enableSudoMode(),
        disableSudoMode: connectionId => this.disableSudoMode(connectionId),
        listDirectory: remotePath => this.listDirectory(remotePath),
        requestBreadcrumbDirectories: payload => this.requestBreadcrumbDirectories(payload),
        openParent: () => this.listDirectory(dirnameRemotePath(this.getActivePath())),
        openEntry: payload => this.openEntry(payload),
        openEntries: payload => this.openEntries(payload),
        openEntriesReadOnly: payload => this.openEntriesReadOnly(payload),
        compareSelectedEntries: payload => this.compareSelectedEntries(payload),
        openPath: payload => this.openPath(payload),
        addRemotePathFavorite: payload => this.addRemotePathFavorite(payload),
        removeRemotePathFavorite: payload => this.removeRemotePathFavorite(payload),
        requestCreateFile: payload => this.requestCreateEntry(payload, 'file'),
        requestCreateDirectory: payload => this.requestCreateEntry(payload, 'directory'),
        requestMakeCopy: payload => this.requestMakeCopy(payload),
        requestCalculateChecksums: payload => this.requestCalculateChecksums(payload),
        requestRenameEntry: payload => this.requestRenameEntry(payload),
        requestDeleteEntry: payload => this.requestDeleteEntry(payload),
        requestDeleteEntries: payload => this.requestDeleteEntries(payload),
        requestUploadEntries: payload => this.requestUploadEntries(payload),
        requestDownloadEntries: payload => this.requestDownloadEntries(payload),
        requestCompressArchive: payload => this.requestCompressArchive(payload),
        cancelTransfer: () => this.cancelActiveTransfer(),
        removeQueuedTransfer: payload => this.removeQueuedTransfer(payload),
        requestSetPermissions: payload => this.requestSetPermissions(payload),
        requestChangeOwnerGroup: payload => this.requestChangeOwnerGroup(payload),
        requestRunRemoteCommand: payload => this.requestRunRemoteCommand(payload),
        stopRemoteCommand: payload => this.stopRemoteCommand(payload),
        applyPermissions: payload => this.applyPermissionsFromDialog(payload),
        cancelPermissions: () => this.cancelPermissionsDialog(),
        showOutput: () => this.output.show(true),
        copyRemotePath: payload => this.copyRemotePath(payload),
        copyStatus: payload => this.copyStatus(payload),
        confirmDialogResponse: payload => this.handleConfirmDialogResponse(payload),
        transferConflictResponse: payload => this.handleTransferConflictResponse(payload),
        log: logMessage => this.logDebug(logMessage),
        unknown: messageType => this.postError(`Unknown webview message: ${messageType}`)
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const friendlyMessage = this.formatError(message.type, message.payload, messageText);
      this.logError(friendlyMessage);
      if (friendlyMessage !== messageText) {
        this.logError('Error details.', { Details: messageText });
      }
      const handledAsBackupOperation = this.postBackupOperationError(message.type, friendlyMessage);
      if (!handledAsBackupOperation) {
        this.postError(friendlyMessage);
      }
    }
  }

  private postBackupOperationError(messageType: string, message: string): boolean {
    if (messageType === 'exportConnectionsSettings') {
      this.postMessage(RemoteEditOutboundMessageType.ExportConnectionsSettingsValidationError, {
        operation: 'export',
        message: 'Export failed. Unable to save the backup file.'
      });
      return true;
    }

    if (messageType === 'importConnectionsSettings') {
      this.postMessage(RemoteEditOutboundMessageType.ImportConnectionsSettingsValidationError, {
        operation: 'import',
        message: this.formatBackupImportError(message)
      });
      return true;
    }

    if (messageType === 'requestImportConnectionsSettings') {
      this.pendingImportBackupFile = undefined;
      this.postMessage(RemoteEditOutboundMessageType.ShowImportConnectionsSettingsDialog, {
        summary: { importError: 'Import failed. Invalid backup file.' }
      });
      return true;
    }

    return false;
  }

  private formatBackupImportError(message: string): string {
    const lower = String(message || '').toLowerCase();

    if (lower.includes('check the export password') || lower.includes('invalid export password') || lower.includes('unable to authenticate data')) {
      return 'Import failed. Invalid export password.';
    }

    return `Import failed. ${message}`;
  }

  private setActiveConnection(connectionId: string | undefined): void {
    this.state.setActiveConnectionId(connectionId);
  }

  private async restoreActiveSession(): Promise<void> {
    const connectedSessions = this.sessions.listConnections();

    if (!connectedSessions.length) {
      this.state.clearRetainedCurrentPaths();
      this.setActiveConnection(undefined);
      this.sendSessions();
      this.postMessage(RemoteEditOutboundMessageType.Disconnected, {});
      return;
    }

    const lastActiveId = this.state.getLastActiveConnectionId();
    const nextActiveId = lastActiveId && this.sessions.hasConnection(lastActiveId)
      ? lastActiveId
      : connectedSessions[0].id;

    this.setActiveConnection(nextActiveId);
    this.sendSessions();
    await this.listDirectory(this.getActivePath());
  }

  private async sendProfiles(selectedId?: string): Promise<void> {
    const profiles = await this.connectionManager.listProfiles();
    this.postMessage(RemoteEditOutboundMessageType.ProfilesLoaded, { profiles, selectedId });
  }

  private sendSessions(): void {
    const sessions = this.sessions.listConnections().map(connection => ({
      ...connection,
      currentPath: this.state.getCurrentPath(connection.id, connection.startPath || '/'),
      sudoModeEnabled: this.sessions.isSudoModeEnabled(connection.id)
    }));

    this.postMessage(RemoteEditOutboundMessageType.SessionsChanged, {
      sessions,
      activeConnectionId: this.state.getActiveConnectionId()
    });
  }

  private async enableSudoMode(): Promise<void> {
    const connectionId = this.state.getActiveConnectionId();

    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId: '', enabled: false });
      this.postBusy(false, 'Connect to a host before enabling sudo mode.');
      return;
    }

    const password = await vscode.window.showInputBox({
      title: 'Enable sudo mode',
      prompt: 'Enter the sudo password for this connection. The password is kept only in memory for the current session.',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Sudo password'
    });

    if (!password) {
      this.sessions.disableSudoMode(connectionId);
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: false });
      this.postBusy(false, 'Sudo mode not enabled.');
      return;
    }

    try {
      await this.sessions.enableSudoMode(connectionId, password);
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: true });
      this.postBusy(false, 'Sudo mode enabled for this session.');
      this.logInfo('Sudo mode enabled.', { Connection: connectionId });
    } catch (error) {
      this.sessions.disableSudoMode(connectionId);
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: false });
      this.postBusy(false, message || 'Could not enable sudo mode.');
      this.logWarn('Could not enable sudo mode.', { Connection: connectionId, Details: message });
    }
  }

  private disableSudoMode(connectionId: string): void {
    if (!connectionId) {
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId: '', enabled: false });
      this.postBusy(false, 'No active connection.');
      return;
    }

    this.sessions.disableSudoMode(connectionId);
    this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: false });
    this.postBusy(false, 'Sudo mode disabled.');
    this.logInfo('Sudo mode disabled.', { Connection: connectionId });
  }

  private async saveConnection(payload: any): Promise<void> {
    this.postBusy(true, 'Saving saved connection...');
    const profile = await this.connectionManager.saveProfile(payload || {});
    await this.sendProfiles(profile.id);
    this.postBusy(false, `Saved connection: ${profile.name}.`);
    this.logInfo('Saved connection.', { Name: profile.name, Target: `${profile.username ? profile.username + '@' : ''}${profile.host}:${profile.port}` });
  }

  private async pickPrivateKeyPath(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select',
      title: 'Select private key file'
    });

    const selectedPath = selected?.[0]?.fsPath;
    if (selectedPath) {
      this.postMessage(RemoteEditOutboundMessageType.PrivateKeyPathSelected, { path: selectedPath });
    }
  }


  private async renameConnection(payload: any): Promise<void> {
    const profileId = String(payload?.id || '').trim();
    const name = String(payload?.name || '').trim();

    this.postBusy(true, 'Renaming saved connection...');
    const profile = await this.connectionManager.renameProfile(profileId, name);
    await this.sendProfiles(profile.id);
    this.postBusy(false, `Renamed saved connection: ${profile.name}.`);
    this.logInfo('Renamed saved connection.', { Name: profile.name, ProfileId: profileId });
  }


  private async requestImportConnectionsSettings(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'JSON backup': ['json'], 'All files': ['*'] },
      openLabel: 'Import',
      title: 'Import Remote Edit backup'
    });

    const selectedPath = selected?.[0]?.fsPath;
    if (!selectedPath) {
      return;
    }

    let backup: RemoteEditBackupFile;
    try {
      const raw = await fs.readFile(selectedPath, 'utf8');
      backup = JSON.parse(raw) as RemoteEditBackupFile;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pendingImportBackupFile = undefined;
      this.logError('Could not read the selected backup file.', { Details: message });
      this.postMessage(RemoteEditOutboundMessageType.ShowImportConnectionsSettingsDialog, {
        summary: { importError: 'Import failed. Invalid backup file.' }
      });
      return;
    }

    const summary = this.connectionManager.summarizeBackupFile(backup);
    this.pendingImportBackupFile = backup;
    this.postMessage(RemoteEditOutboundMessageType.ShowImportConnectionsSettingsDialog, { summary });
  }

  private async exportConnectionsSettings(payload: any): Promise<void> {
    const options = this.parseExportOptions(payload || {});

    if (!options.includeSettings && !options.includeConnections) {
      throw new Error('Select at least one export option.');
    }

    const target = await vscode.window.showSaveDialog({
      filters: { 'JSON backup': ['json'], 'All files': ['*'] },
      saveLabel: 'Export',
      title: 'Export Remote Edit backup',
      defaultUri: vscode.Uri.file(path.join(os.homedir(), `remoteedit-backup-${formatBackupFileDate(new Date())}.json`))
    });

    if (!target) {
      this.postMessage(RemoteEditOutboundMessageType.BackupOperationResult, { operation: 'export', message: 'Export canceled.', isError: false });
      return;
    }

    const backup = await this.connectionManager.buildBackupFile({
      ...options,
      extensionVersion: String((this.context.extension.packageJSON as { version?: string })?.version || '')
    });

    await fs.writeFile(target.fsPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
    const status = this.buildExportResultMessage(backup, options);
    this.postMessage(RemoteEditOutboundMessageType.BackupOperationResult, { operation: 'export', message: status, isError: false });
    this.logInfo('Exported Remote Edit backup.', {
      File: target.fsPath,
      Settings: backup.settings ? 'Yes' : 'No',
      Connections: String(backup.connections?.length || 0),
      Favorites: String(this.countBackupFavorites(backup)),
      Usernames: options.includeUsernames ? 'Yes' : 'No',
      EncryptedCredentials: backup.encryptedCredentials ? 'Yes' : 'No'
    });
  }

  private async importConnectionsSettings(payload: any): Promise<void> {
    if (!this.pendingImportBackupFile) {
      throw new Error('Choose a backup file before importing.');
    }

    const options = this.parseImportOptions(payload || {});

    if (!options.includeSettings && !options.includeConnections) {
      throw new Error('Select at least one import option.');
    }

    const result = await this.connectionManager.importBackupFile(this.pendingImportBackupFile, options);

    await this.sendProfiles();

    if (options.importMode === 'replace') {
      this.postMessage(RemoteEditOutboundMessageType.ConnectionFormCleared, {});
    }

    const status = this.buildImportResultMessage(result, options);

    this.postMessage(RemoteEditOutboundMessageType.BackupOperationResult, { operation: 'import', message: status, isError: false });
    this.logInfo('Imported Remote Edit backup.', {
      Mode: options.importMode,
      Settings: result.settingsImported ? 'Yes' : 'No',
      Added: String(result.added),
      Updated: String(result.updated),
      Skipped: String(result.skippedUnsupported),
      FavoritesImported: String(result.favoritesImported),
      UsernamesImported: String(result.usernamesImported),
      CredentialsRestored: String(result.credentialsRestored)
    });
  }

  private buildExportResultMessage(_backup: RemoteEditBackupFile, _options: ConnectionBackupExportOptions): string {
    return 'Export completed successfully.';
  }

  private buildImportResultMessage(_result: RemoteEditBackupImportResult, _options: ConnectionBackupImportOptions): string {
    return 'Import completed successfully.';
  }

  private countBackupFavorites(backup: RemoteEditBackupFile): number {
    return (backup.connections || []).reduce((count, connection) => {
      const favorites = Array.isArray(connection.remotePathFavorites) ? connection.remotePathFavorites : [];
      return count + favorites.length;
    }, 0);
  }

  private parseExportOptions(payload: any): ConnectionBackupExportOptions {
    const includeSettings = Boolean(payload.includeSettings);
    const includeConnections = Boolean(payload.includeConnections);
    const includeUsernames = includeConnections && Boolean(payload.includeUsernames);
    const includeCredentials = includeConnections && includeUsernames && Boolean(payload.includeCredentials);

    return {
      includeSettings,
      includeConnections,
      includeFavorites: includeConnections && Boolean(payload.includeFavorites),
      includeUsernames,
      includeCredentials,
      credentialPassword: includeCredentials ? String(payload.credentialPassword || '') : ''
    };
  }

  private parseImportOptions(payload: any): ConnectionBackupImportOptions {
    const includeSettings = Boolean(payload.includeSettings);
    const includeConnections = Boolean(payload.includeConnections);
    const includeUsernames = includeConnections && Boolean(payload.includeUsernames);
    const restoreCredentials = includeConnections && includeUsernames && Boolean(payload.restoreCredentials);
    const importMode = payload.importMode === 'replace' ? 'replace' : 'merge';

    return {
      includeSettings,
      includeConnections,
      includeFavorites: includeConnections && Boolean(payload.includeFavorites),
      includeUsernames,
      restoreCredentials,
      credentialPassword: restoreCredentials ? String(payload.credentialPassword || '') : '',
      importMode
    };
  }

  private async deleteConnection(payload: any): Promise<void> {
    const profileId = String(payload?.id || '').trim();

    if (!profileId) {
      throw new Error('Select a saved connection to remove.');
    }

    const profile = await this.connectionManager.getProfile(profileId);

    if (!profile) {
      await this.sendProfiles();
      throw new Error('The selected saved connection no longer exists.');
    }

    const confirmed = await this.showConfirmDialog({
      title: 'Remove saved connection?',
      message: `Remove saved connection "${profile.name}"? Stored secrets for this profile will also be removed.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      danger: true
    });

    if (!confirmed) {
      this.postStatus('Remove canceled.');
      return;
    }

    this.postBusy(true, 'Removing saved connection...');

    if (this.sessions.hasConnection(profileId)) {
      await this.disconnect(profileId);
    }

    await this.connectionManager.deleteProfile(profileId);
    await this.sendProfiles('');
    this.postMessage(RemoteEditOutboundMessageType.ConnectionFormCleared, {});
    this.postBusy(false, `Removed saved connection: ${profile.name}.`);
    this.logInfo('Removed saved connection.', { Name: profile.name, ProfileId: profileId });
  }

  private async connect(payload: any): Promise<void> {
    const options = await this.connectionManager.buildConnectOptions(payload || {});
    const target = `${options.username}@${options.host}:${options.port}`;

    if (this.activeConnectionCancellationSource) {
      this.postStatus('A connection attempt is already in progress.');
      return;
    }

    const cancellationSource = new vscode.CancellationTokenSource();
    this.activeConnectionCancellationSource = cancellationSource;

    this.postBusy(true, `Connecting to ${options.name || options.host}...`, 'connection', 'Cancel');
    this.logInfo('Connecting to remote host.', { Target: target, Authentication: options.authType });

    let connection;

    try {
      connection = await this.sessions.connect(options, cancellationSource.token);
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)
        || cancellationSource.token.isCancellationRequested
        || String(error instanceof Error ? error.message : error).includes('Connection cancelled')) {
        this.postBusy(false, 'Connection cancelled.');
        this.logInfo('Connection cancelled.', { Target: target });
        return;
      }

      throw error;
    } finally {
      if (this.activeConnectionCancellationSource === cancellationSource) {
        this.activeConnectionCancellationSource = undefined;
      }
      cancellationSource.dispose();
    }

    if (cancellationSource.token.isCancellationRequested) {
      this.postBusy(false, 'Connection cancelled.');
      this.logInfo('Connection cancelled.', { Target: target });
      return;
    }

    if (payload?.id) {
      await this.connectionManager.applyCredentialPreferences(connection.id, options.authType, payload || {});
      await this.sendProfiles(connection.id);
    }

    this.setActiveConnection(connection.id);
    this.state.setCurrentPath(connection.id, connection.startPath);
    this.updatePanelTitle();

    this.sendSessions();
    await this.listDirectory(connection.startPath);
    this.logInfo('Connected to remote host.', { Connection: connection.id, Target: target, StartPath: connection.startPath });
    this.postBusy(false, 'Connected.');
  }

  private async cancelConnection(): Promise<void> {
    const source = this.activeConnectionCancellationSource;

    if (!source) {
      this.postStatus('No connection attempt is in progress.');
      return;
    }

    this.postBusy(true, 'Cancelling connection...');
    source.cancel();
  }

  private async disconnect(connectionId: string): Promise<void> {
    if (this.activeRemoteCommand?.connectionId === connectionId) {
      this.stopRemoteCommand({});
    }

    if (!connectionId) {
      this.postStatus('No active connection.');
      return;
    }

    const connection = this.sessions.getConnection(connectionId);
    const removedQueuedTransfers = this.clearQueuedTransfersForConnection(connectionId);
    this.clearCompletedTransfersForConnection(connectionId);

    if (this.activeTransferConnectionId === connectionId) {
      this.cancelPendingTransferConflict();
      this.activeTransferCancellationSource?.cancel();
    }

    this.postBusy(true, 'Disconnecting...');
    await this.sessions.disconnect(connectionId);

    if (removedQueuedTransfers > 0) {
      this.postStatus(`${removedQueuedTransfers} queued transfer(s) removed for disconnected session.`);
    }
    this.state.deleteConnectionPath(connectionId);
    this.sessions.disableSudoMode(connectionId);

    if (this.state.getActiveConnectionId() === connectionId) {
      const remaining = this.sessions.listConnections();
      this.setActiveConnection(remaining[0]?.id);
    }

    this.updatePanelTitle();
    this.sendSessions();

    if (this.state.getActiveConnectionId()) {
      await this.listDirectory(this.getActivePath());
    } else {
      this.postMessage(RemoteEditOutboundMessageType.Disconnected, {});
    }

    this.postBusy(false, 'Disconnected.');
    this.logInfo('Disconnected from remote host.', { Connection: connectionId });
  }

  private async switchSession(connectionId: string): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected RemoteEdit connection is not connected.');
    }

    this.setActiveConnection(connectionId);
    this.updatePanelTitle();
    this.sendSessions();
    await this.listDirectory(this.getActivePath());
  }

  private async listDirectory(remotePath: string): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const normalizedPath = normalizeRemotePath(remotePath);
    this.postBusy(true, `Loading ${normalizedPath}...`);
    const entries = await this.sessions.listDirectory(connectionId, normalizedPath);
    const visibleEntries = normalizedPath === '/' ? entries : [this.buildParentEntry(normalizedPath), ...entries];

    this.state.setCurrentPath(connectionId, normalizedPath);
    this.postMessage(RemoteEditOutboundMessageType.DirectoryListed, {
      connectionId,
      path: normalizedPath,
      entries: visibleEntries
    });
    this.sendSessions();

    this.logInfo('Listed remote directory.', { Connection: connectionId, Path: normalizedPath, Items: entries.length });
    this.postBusy(false, `Listed ${entries.length} item(s).`);
  }

  private async requestBreadcrumbDirectories(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const requestId = String(payload?.requestId || '');
    const normalizedPath = normalizeRemotePath(String(payload?.path || this.getActivePath() || '/'));

    try {
      const entries = await this.sessions.listDirectory(connectionId, normalizedPath);
      const directories = entries
        .filter(entry => entry.name !== '..' && (entry.effectiveType || entry.type) === 'directory')
        .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' }))
        .map(entry => ({
          name: entry.name,
          path: entry.path,
          permissions: entry.permissions || '',
          owner: String(entry.owner || ''),
          group: String(entry.group || '')
        }));

      this.postMessage(RemoteEditOutboundMessageType.BreadcrumbDirectoriesListed, {
        connectionId,
        requestId,
        path: normalizedPath,
        directories
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage(RemoteEditOutboundMessageType.BreadcrumbDirectoriesListed, {
        connectionId,
        requestId,
        path: normalizedPath,
        directories: [],
        error: message || 'Could not list remote directories.'
      });
      this.logWarn('Could not list breadcrumb directories.', { Connection: connectionId, Path: normalizedPath, Error: message });
    }
  }

  private buildParentEntry(currentPath: string): RemoteEntry {
    return {
      name: '..',
      type: 'directory',
      effectiveType: 'directory',
      size: 0,
      modifyTime: 0,
      accessTime: 0,
      owner: '',
      group: '',
      permissions: '',
      path: dirnameRemotePath(currentPath)
    };
  }

  private async openEntry(payload: any): Promise<void> {
    this.requireActiveConnectionId();

    const entryType = String(payload?.type || '');
    const entryEffectiveType = String(payload?.effectiveType || '');
    const entryName = String(payload?.name || '');
    const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : joinRemotePath(this.getActivePath(), entryName);
    const resolvedType = await this.resolveOpenableEntryType(entryPath, entryType, entryEffectiveType);

    if (resolvedType === 'directory') {
      await this.listDirectory(entryPath);
      return;
    }

    if (resolvedType !== 'file') {
      throw new Error(`Cannot open entry type '${entryType || resolvedType}'.`);
    }

    await this.openFile(entryPath);
  }

  private async openEntries(payload: any): Promise<void> {
    await this.openEntriesWithMode(payload, false);
  }

  private async openEntriesReadOnly(payload: any): Promise<void> {
    await this.openEntriesWithMode(payload, true);
  }

  private async openEntriesWithMode(payload: any, readOnly: boolean): Promise<void> {
    this.requireActiveConnectionId();

    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    const entries = rawEntries
      .map((entry: any) => ({
        name: String(entry?.name || ''),
        type: String(entry?.type || ''),
        effectiveType: String(entry?.effectiveType || ''),
        path: entry?.path ? normalizeRemotePath(String(entry.path)) : ''
      }))
      .filter((entry: any) => Boolean(entry.path) && entry.name !== '..');

    if (!entries.length) {
      throw new Error(readOnly ? 'Select a remote file to view read-only.' : 'Select a remote file to view/edit.');
    }

    const resolvedEntries: Array<{ name: string; type: string; effectiveType: string; path: string; resolvedType: string }> = [];

    for (const entry of entries) {
      resolvedEntries.push({
        ...entry,
        resolvedType: await this.resolveOpenableEntryType(entry.path, entry.type, entry.effectiveType)
      });
    }

    if (!readOnly && resolvedEntries.length === 1 && resolvedEntries[0].resolvedType === 'directory') {
      await this.listDirectory(resolvedEntries[0].path);
      return;
    }

    const unsupportedEntry = resolvedEntries.find(entry => entry.resolvedType !== 'file');

    if (unsupportedEntry) {
      throw new Error(readOnly
        ? 'Only files can be opened read-only.'
        : 'Only files can be opened when multiple items are selected.');
    }

    this.postBusy(true, resolvedEntries.length === 1
      ? `${readOnly ? 'Opening read-only' : 'Opening'} ${resolvedEntries[0].name || resolvedEntries[0].path}...`
      : `${readOnly ? 'Opening read-only' : 'Opening'} ${resolvedEntries.length} remote files...`);

    const connectionId = this.requireActiveConnectionId();
    const failedEntries: Array<{ path: string; error: string }> = [];

    try {
      await withRemoteEditProgress(
        resolvedEntries.length === 1
          ? (readOnly ? 'Opening remote file read-only...' : 'Opening remote file...')
          : `${readOnly ? 'Opening read-only' : 'Opening'} ${resolvedEntries.length} remote files...`,
        async (token, progress) => {
          for (const entry of resolvedEntries) {
            throwIfCancelled(token, 'Opening cancelled.');

            const uri = buildRemoteEditUri(connectionId, entry.path, this.getActiveUriAuthority(), { readOnly });

            try {
              await this.sessions.prepareFileForOpen(connectionId, entry.path, token, progress);
              throwIfCancelled(token, 'Opening cancelled.');
              await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
              this.logInfo(readOnly ? 'Opened remote file read-only.' : 'Opened remote file.', { Path: this.buildRemoteReference(entry.path) });
            } catch (error) {
              if (isRemoteEditOperationCancelled(error)) {
                throw error;
              }

              const message = error instanceof Error ? error.message : String(error);
              failedEntries.push({ path: entry.path, error: message });
              this.logWarn(readOnly ? 'Failed to open remote file read-only.' : 'Failed to open remote file.', { Path: this.buildRemoteReference(entry.path), Details: message });
            }
          }
        },
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Opening cancelled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Opening cancelled.');
        this.logInfo('Opening remote file cancelled.');
        return;
      }

      throw error;
    }

    if (failedEntries.length) {
      const detail = failedEntries.map(item => `${item.path}: ${item.error}`).join('\n');
      void vscode.window.showWarningMessage(
        `Opened ${resolvedEntries.length - failedEntries.length} of ${resolvedEntries.length} remote file(s).`,
        { modal: false, detail }
      );
    }

    this.postBusy(false, failedEntries.length
      ? `Opened ${resolvedEntries.length - failedEntries.length} of ${resolvedEntries.length} remote file(s).`
      : resolvedEntries.length === 1
        ? `Opened ${resolvedEntries[0].name || resolvedEntries[0].path}${readOnly ? ' read-only' : ''}.`
        : `Opened ${resolvedEntries.length} remote files${readOnly ? ' read-only' : ''}.`);
  }

  private async compareSelectedEntries(payload: any): Promise<void> {
    this.requireActiveConnectionId();

    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    const entries = rawEntries
      .map((entry: any) => ({
        name: String(entry?.name || ''),
        type: String(entry?.type || ''),
        effectiveType: String(entry?.effectiveType || ''),
        path: entry?.path ? normalizeRemotePath(String(entry.path)) : ''
      }))
      .filter((entry: any) => Boolean(entry.path) && entry.name !== '..');

    if (entries.length !== 2) {
      throw new Error('Select exactly two remote files to compare.');
    }

    const resolvedEntries: Array<{ name: string; type: string; effectiveType: string; path: string; resolvedType: string }> = [];
    for (const entry of entries) {
      resolvedEntries.push({
        ...entry,
        resolvedType: await this.resolveOpenableEntryType(entry.path, entry.type, entry.effectiveType)
      });
    }

    const unsupportedEntry = resolvedEntries.find(entry => entry.resolvedType !== 'file');
    if (unsupportedEntry) {
      throw new Error('Only files can be compared.');
    }

    const connectionId = this.requireActiveConnectionId();
    const [left, right] = resolvedEntries;
    this.postBusy(true, `Comparing ${left.name || left.path} and ${right.name || right.path}...`);

    try {
      await withRemoteEditProgress(
        'Preparing remote file comparison...',
        async (token, progress) => {
          await this.sessions.prepareFileForOpen(connectionId, left.path, token, progress);
          throwIfCancelled(token, 'Compare cancelled.');
          await this.sessions.prepareFileForOpen(connectionId, right.path, token, progress);
          throwIfCancelled(token, 'Compare cancelled.');
        },
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Compare cancelled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Compare cancelled.');
        this.logInfo('Remote file compare cancelled.');
        return;
      }
      throw error;
    }

    const leftUri = buildRemoteEditUri(connectionId, left.path, this.getActiveUriAuthority(), { readOnly: true });
    const rightUri = buildRemoteEditUri(connectionId, right.path, this.getActiveUriAuthority(), { readOnly: true });
    const title = `${left.name || left.path} ↔ ${right.name || right.path}`;
    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

    this.logInfo('Compared remote files.', {
      Left: this.buildRemoteReference(left.path),
      Right: this.buildRemoteReference(right.path)
    });
    this.postBusy(false, `Comparing ${left.name || left.path} and ${right.name || right.path}.`);
  }

  private async resolveOpenableEntryType(remotePath: string, entryType?: string, entryEffectiveType?: string): Promise<'file' | 'directory' | 'unknown'> {
    if (entryEffectiveType === 'file' || entryEffectiveType === 'directory') {
      return entryEffectiveType;
    }

    if (entryType === 'file' || entryType === 'directory') {
      return entryType;
    }

    const stats = await this.sessions.stat(this.requireActiveConnectionId(), remotePath);
    return stats.type;
  }

  private async openPath(payload: any): Promise<void> {
    this.requireActiveConnectionId();

    const rawPath = String(payload?.path || '').trim();

    if (!rawPath) {
      throw new Error('Enter a remote path to open.');
    }

    const remotePath = normalizeRemotePath(rawPath);
    this.postBusy(true, `Opening ${remotePath}...`);
    const stats = await this.sessions.stat(this.requireActiveConnectionId(), remotePath);

    if (stats.type === 'directory') {
      await this.listDirectory(remotePath);
      return;
    }

    await this.openFile(remotePath);
  }

  private async addRemotePathFavorite(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || this.getActivePath() || '').trim());

    await this.connectionManager.addFavoriteRemotePath(connectionId, remotePath);
    await this.sendProfiles(connectionId);
    this.postStatus(`Added remote path favorite: ${remotePath}.`);
    this.logInfo('Added remote path favorite.', { Connection: connectionId, Path: remotePath });
  }

  private async removeRemotePathFavorite(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || this.getActivePath() || '').trim());

    await this.connectionManager.removeFavoriteRemotePath(connectionId, remotePath);
    await this.sendProfiles(connectionId);
    this.postStatus(`Removed remote path favorite: ${remotePath}.`);
    this.logInfo('Removed remote path favorite.', { Connection: connectionId, Path: remotePath });
  }

  private async openFile(remotePath: string): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const normalizedPath = normalizeRemotePath(remotePath);
    const uri = buildRemoteEditUri(connectionId, normalizedPath, this.getActiveUriAuthority());

    try {
      await withRemoteEditProgress(
        'Opening remote file...',
        async (token, progress) => {
          await this.sessions.prepareFileForOpen(connectionId, normalizedPath, token, progress);
          throwIfCancelled(token, 'Opening cancelled.');
        },
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Opening cancelled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Opening cancelled.');
        this.logInfo('Opening remote file cancelled.', { Path: this.buildRemoteReference(normalizedPath) });
        return;
      }

      throw error;
    }

    await vscode.commands.executeCommand('vscode.open', uri, { preview: false });

    this.logInfo('Opened remote file.', { Path: this.buildRemoteReference(normalizedPath) });
    this.postBusy(false, `Opened ${normalizedPath}.`);
  }

  private async copyRemotePath(payload: any): Promise<void> {
    this.requireActiveConnectionId();

    const remotePath = normalizeRemotePath(String(payload?.path || this.getActivePath() || '/'));
    const remoteReference = this.buildRemoteReference(remotePath);
    await vscode.env.clipboard.writeText(remoteReference);
    this.postStatus(`Copied remote path: ${remotePath}`);
  }

  private async copyStatus(payload: any): Promise<void> {
    const text = String(payload?.text || '').trim();
    const feedback = String(payload?.message || 'Copied').trim() || 'Copied';

    if (!text) {
      this.postStatusCopyFeedback('Nothing to copy');
      return;
    }

    await vscode.env.clipboard.writeText(text);
    this.postStatusCopyFeedback(feedback);
  }

  private async requestCreateEntry(_payload: any, entryKind: 'file' | 'directory'): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const targetDirectory = normalizeRemotePath(this.getActivePath());
    const label = entryKind === 'directory' ? 'directory' : 'file';

    if (!targetDirectory) {
      throw new Error(`Select a remote location to create a new ${label}.`);
    }

    const newName = await vscode.window.showInputBox({
      title: entryKind === 'directory' ? 'RemoteEdit: Create New Directory' : 'RemoteEdit: Create New File',
      prompt: `Enter the name for the new remote ${label}.`,
      placeHolder: entryKind === 'directory' ? 'new-folder' : 'new-file.txt',
      validateInput: value => {
        const trimmed = value.trim();
        if (!trimmed) {
          return `The ${label} name cannot be empty.`;
        }
        if (trimmed === '.' || trimmed === '..') {
          return `The ${label} name cannot be '.' or '..'.`;
        }
        if (trimmed.includes('/') || trimmed.includes('\\')) {
          return `The ${label} name must not contain path separators.`;
        }
        return undefined;
      }
    });

    if (newName === undefined) {
      this.postStatus(entryKind === 'directory' ? 'Create directory cancelled.' : 'Create file cancelled.');
      return;
    }

    const trimmedName = newName.trim();
    const newPath = joinRemotePath(targetDirectory, trimmedName);

    await this.ensureRemotePathDoesNotExist(connectionId, newPath, label);

    this.postBusy(true, `Creating ${label} ${trimmedName}...`);

    if (entryKind === 'directory') {
      await this.sessions.createDirectory(connectionId, newPath);
    } else {
      await this.sessions.createFile(connectionId, newPath);
    }

    this.logInfo(`Created remote ${label}.`, { Path: this.buildRemoteReference(newPath) });
    await this.listDirectory(targetDirectory);
    this.postBusy(false, `Created ${trimmedName}.`);
  }

  private async ensureRemotePathDoesNotExist(connectionId: string, remotePath: string, label: string): Promise<void> {
    try {
      await this.sessions.stat(connectionId, remotePath);
    } catch {
      return;
    }

    throw new Error(`A remote ${label} already exists at ${remotePath}.`);
  }

  private async requestMakeCopy(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || ''));
    const entryType = String(payload?.type || 'item');
    const currentName = String(payload?.name || remotePath.split('/').filter(Boolean).pop() || '').trim();

    if (!remotePath || remotePath === '/' || !currentName || currentName === '..' || entryType !== 'file') {
      throw new Error('Select a single remote file to make a copy.');
    }

    const parentPath = dirnameRemotePath(remotePath);
    const defaultName = await this.buildAvailableCopyName(connectionId, parentPath, currentName);

    const copyName = await vscode.window.showInputBox({
      title: 'RemoteEdit: Make a Copy',
      prompt: 'Enter the name for the remote file copy.',
      value: defaultName,
      valueSelection: [0, defaultName.length],
      validateInput: value => {
        const trimmed = value.trim();
        if (!trimmed) {
          return 'The copy name cannot be empty.';
        }
        if (trimmed === '.' || trimmed === '..') {
          return "The copy name cannot be '.' or '..'.";
        }
        if (trimmed.includes('/') || trimmed.includes('\\')) {
          return 'The copy name must not contain path separators.';
        }
        if (trimmed === currentName) {
          return 'The copy name must be different from the original file name.';
        }
        return undefined;
      }
    });

    if (copyName === undefined) {
      this.postStatus('Make a copy cancelled.');
      return;
    }

    const trimmedName = copyName.trim();
    const newPath = joinRemotePath(parentPath, trimmedName);
    const existingTarget = await this.tryStatRemotePath(connectionId, newPath);
    let overwrite = false;

    if (existingTarget) {
      if (existingTarget.type !== 'file') {
        throw new Error(`A remote ${existingTarget.type} already exists at ${newPath}. Choose another name.`);
      }

      const confirmed = await this.showConfirmDialog({
        title: 'Overwrite remote file?',
        message: 'A remote file with this name already exists. Do you want to overwrite it?',
        details: newPath,
        confirmLabel: 'Overwrite',
        cancelLabel: 'Cancel',
        danger: true
      });

      if (!confirmed) {
        this.postStatus('Make a copy cancelled.');
        return;
      }

      overwrite = true;
    }

    this.postBusy(true, `Copying ${currentName}...`);

    try {
      await withRemoteEditProgress(
        'Copying remote file...',
        async token => {
          await this.sessions.copyFile(connectionId, remotePath, newPath, overwrite, token);
        },
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Copy cancelled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Copy cancelled.');
        return;
      }

      this.postBusy(false, 'Copy failed.');
      throw error;
    }

    this.logInfo('Copied remote file.', { From: this.buildRemoteReference(remotePath), To: this.buildRemoteReference(newPath) });
    await this.listDirectory(parentPath);
    this.postBusy(false, `Copied to ${trimmedName}.`);
  }


  private async requestCalculateChecksums(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || ''));
    const entryType = String(payload?.type || 'item');
    const entryName = String(payload?.name || remotePath.split('/').filter(Boolean).pop() || '').trim();

    if (!remotePath || remotePath === '/' || !entryName || entryName === '..' || entryType !== 'file') {
      throw new Error('Select a single remote file to calculate checksums.');
    }

    const stats = await this.sessions.stat(connectionId, remotePath);
    this.postBusy(true, `Calculating checksums for ${entryName}...`);

    try {
      const result = await withRemoteEditProgress(
        'Calculating remote checksums...',
        async (token, progress) => {
          progress.reportMessage('Calculating SHA-256 and MD5 on the server...');
          const checksums = await this.sessions.calculateChecksums(connectionId, remotePath, token);
          throwIfCancelled(token, 'Checksum calculation cancelled.');
          return checksums;
        },
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Checksum calculation cancelled.' }
      );

      await this.showChecksumsResult(remotePath, stats.size, stats.modifyTime, result);

      this.logInfo('Calculated remote file checksums.', {
        Path: this.buildRemoteReference(remotePath),
        SHA256: result.sha256.value || result.sha256.error || 'Not available',
        MD5: result.md5.value || result.md5.error || 'Not available'
      });
      this.postBusy(false, `Calculated checksums for ${entryName}.`);
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Checksum calculation cancelled.');
        return;
      }

      this.postBusy(false, 'Checksum calculation failed.');
      throw error;
    }
  }

  private async showChecksumsResult(remotePath: string, size: number, modifyTime: number, result: RemoteChecksumSummary): Promise<void> {
    this.postMessage(RemoteEditOutboundMessageType.ShowChecksumsDialog, {
      remotePath,
      size: formatBytes(size),
      modified: this.formatTimestampForDialog(modifyTime),
      sha256: this.formatChecksumLine(result.sha256),
      md5: this.formatChecksumLine(result.md5),
      sha256Value: result.sha256.value || '',
      md5Value: result.md5.value || '',
      copyAllText: this.buildChecksumsCopyText(remotePath, result)
    });
  }

  private formatChecksumLine(checksum: RemoteChecksumValue): string {
    if (checksum.value) {
      return checksum.command ? `${checksum.value} (${checksum.command})` : checksum.value;
    }

    return checksum.error || 'Not available';
  }

  private buildChecksumsCopyText(remotePath: string, result: RemoteChecksumSummary): string {
    const lines = [`Remote file: ${remotePath}`];

    if (result.sha256.value) {
      lines.push(`SHA-256: ${result.sha256.value}`);
    }
    if (result.md5.value) {
      lines.push(`MD5: ${result.md5.value}`);
    }

    return lines.length > 1 ? lines.join('\n') : '';
  }

  private formatTimestampForDialog(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
      return 'unknown';
    }

    return new Date(value).toLocaleString();
  }

  private async tryStatRemotePath(connectionId: string, remotePath: string): Promise<{ type: 'file' | 'directory' | 'unknown'; size: number; modifyTime: number; accessTime: number } | undefined> {
    try {
      return await this.sessions.stat(connectionId, remotePath);
    } catch {
      return undefined;
    }
  }

  private async buildAvailableCopyName(connectionId: string, parentPath: string, fileName: string): Promise<string> {
    for (let index = 1; index <= 999; index += 1) {
      const candidate = buildCopyFileName(fileName, index);
      const candidatePath = joinRemotePath(parentPath, candidate);
      const existingTarget = await this.tryStatRemotePath(connectionId, candidatePath);

      if (!existingTarget) {
        return candidate;
      }
    }

    return buildCopyFileName(fileName, Date.now());
  }

  private async requestRenameEntry(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || ''));
    const currentName = String(payload?.name || remotePath.split('/').filter(Boolean).pop() || '').trim();

    if (!remotePath || remotePath === '/' || currentName === '..') {
      throw new Error('Select a remote item to rename.');
    }

    const newName = await vscode.window.showInputBox({
      title: 'RemoteEdit: Rename',
      prompt: 'Enter the new name for the selected remote item.',
      value: currentName,
      valueSelection: [0, currentName.length],
      validateInput: value => {
        const trimmed = value.trim();
        if (!trimmed) {
          return 'The new name cannot be empty.';
        }
        if (trimmed.includes('/') || trimmed.includes('\\')) {
          return 'The new name must not contain path separators.';
        }
        return undefined;
      }
    });

    if (newName === undefined) {
      this.postStatus('Rename cancelled.');
      return;
    }

    const trimmedName = newName.trim();

    if (trimmedName === currentName) {
      this.postStatus('Rename skipped: the new name is the same as the current name.');
      return;
    }

    const parentPath = dirnameRemotePath(remotePath);
    const newPath = joinRemotePath(parentPath, trimmedName);

    this.postBusy(true, `Renaming ${currentName}...`);
    await this.sessions.rename(connectionId, remotePath, newPath);
    this.logInfo('Renamed remote item.', { From: this.buildRemoteReference(remotePath), To: this.buildRemoteReference(newPath) });
    await this.listDirectory(parentPath);
    this.postBusy(false, `Renamed to ${trimmedName}.`);
  }

  private async requestDeleteEntry(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || ''));
    const entryType = String(payload?.type || 'item');
    const entryName = String(payload?.name || remotePath.split('/').filter(Boolean).pop() || remotePath);

    if (!remotePath || remotePath === '/' || entryName === '..') {
      throw new Error('Select a remote item to delete.');
    }

    const kind = entryType === 'directory' ? 'folder' : entryType === 'file' ? 'file' : 'item';
    const confirmed = await this.showConfirmDialog({
      title: 'Delete remote item?',
      message: `Delete remote ${kind} '${entryName}'? This action cannot be undone.`,
      details: remotePath,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true
    });

    if (!confirmed) {
      this.postStatus('Delete cancelled.');
      return;
    }

    const parentPath = dirnameRemotePath(remotePath);
    this.postBusy(true, `Deleting ${entryName}...`);
    await this.sessions.delete(connectionId, remotePath);
    this.logInfo('Deleted remote item.', { Path: this.buildRemoteReference(remotePath) });
    await this.listDirectory(parentPath);
    this.postBusy(false, `Deleted ${entryName}.`);
  }

  private async requestDeleteEntries(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    const entries = rawEntries
      .map((entry: any) => ({
        name: String(entry?.name || ''),
        type: String(entry?.type || 'item'),
        path: entry?.path ? normalizeRemotePath(String(entry.path)) : ''
      }))
      .filter((entry: any) => Boolean(entry.path) && entry.path !== '/' && entry.name !== '..');

    if (!entries.length) {
      throw new Error('Select one or more remote items to delete.');
    }

    if (entries.length === 1) {
      await this.requestDeleteEntry(entries[0]);
      return;
    }

    const detail = buildDeleteEntriesConfirmationDetail(entries);
    const confirmed = await this.showConfirmDialog({
      title: 'Delete remote items?',
      message: `Delete ${entries.length} remote items? This action cannot be undone.`,
      details: detail,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true
    });

    if (!confirmed) {
      this.postStatus('Delete cancelled.');
      return;
    }

    this.postBusy(true, `Deleting ${entries.length} remote items...`);

    for (const entry of entries) {
      await this.sessions.delete(connectionId, entry.path);
      this.logInfo('Deleted remote item.', { Path: this.buildRemoteReference(entry.path) });
    }

    await this.listDirectory(this.getActivePath());
    this.postBusy(false, `Deleted ${entries.length} items.`);
  }


  private async requestCompressArchive(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const format = this.normalizeArchiveFormat(String(payload?.format || ''));
    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    const entries: Array<{ name: string; type: string; effectiveType: string; path: string }> = rawEntries
      .map((entry: any) => ({
        name: String(entry?.name || '').trim(),
        type: String(entry?.type || ''),
        effectiveType: String(entry?.effectiveType || ''),
        path: entry?.path ? normalizeRemotePath(String(entry.path)) : ''
      }))
      .filter((entry: any) => Boolean(entry.path) && entry.name && entry.name !== '..');

    if (!format) {
      throw new Error('Select a supported archive format.');
    }

    if (!entries.length) {
      throw new Error('Select one or more remote items to compress.');
    }

    const baseDirectory = normalizeRemotePath(this.getActivePath());
    const outsideCurrentDirectory = entries.find(entry => dirnameRemotePath(entry.path) !== baseDirectory);
    if (outsideCurrentDirectory) {
      throw new Error('Archive creation supports items from the current remote directory only.');
    }

    const defaultName = await this.buildDefaultArchiveName(connectionId, baseDirectory, entries, format);
    const archiveNameInput = await vscode.window.showInputBox({
      title: 'RemoteEdit: Compress to Archive',
      prompt: 'Enter the archive filename to create in the current remote directory.',
      value: defaultName,
      valueSelection: [0, defaultName.length],
      validateInput: value => {
        const normalized = this.normalizeArchiveName(value, format);
        if (!normalized) {
          return 'The archive name cannot be empty.';
        }
        if (normalized === '.' || normalized === '..') {
          return "The archive name cannot be '.' or '..'.";
        }
        if (normalized.includes('/') || normalized.includes('\\')) {
          return 'The archive name must not contain path separators.';
        }
        if (entries.some(entry => entry.name === normalized)) {
          return 'The archive name must be different from the selected item names.';
        }
        return undefined;
      }
    });

    if (archiveNameInput === undefined) {
      this.postStatus('Compress to archive cancelled.');
      return;
    }

    const archiveName = this.normalizeArchiveName(archiveNameInput, format);
    const archivePath = joinRemotePath(baseDirectory, archiveName);
    const existingTarget = await this.tryStatRemotePath(connectionId, archivePath);
    let overwrite = false;

    if (existingTarget) {
      if (existingTarget.type === 'directory') {
        throw new Error(`A remote directory already exists at ${archivePath}. Choose another name.`);
      }

      const confirmed = await this.showConfirmDialog({
        title: 'Overwrite remote archive?',
        message: 'A remote item with this archive name already exists. Do you want to overwrite it?',
        details: archivePath,
        confirmLabel: 'Overwrite',
        cancelLabel: 'Cancel',
        danger: true
      });

      if (!confirmed) {
        this.postStatus('Compress to archive cancelled.');
        return;
      }

      overwrite = true;
    }

    this.postBusy(true, `Creating ${archiveName}...`);

    try {
      await withRemoteEditProgress(
        'Creating remote archive...',
        async token => {
          await this.sessions.createArchive(
            connectionId,
            baseDirectory,
            entries.map(entry => entry.name),
            archiveName,
            format,
            overwrite,
            token
          );
        },
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Archive creation cancelled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Archive creation cancelled.');
        return;
      }

      this.postBusy(false, 'Archive creation failed.');
      throw error;
    }

    this.logInfo('Created remote archive.', {
      Archive: this.buildRemoteReference(archivePath),
      Format: format,
      Items: entries.map(entry => entry.name).join(', ')
    });
    await this.listDirectory(baseDirectory);
    this.postBusy(false, `Created ${archiveName}.`);
  }


  private async requestUploadEntries(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const targetDirectory = normalizeRemotePath(this.getActivePath());
    const mode = String(payload?.mode || 'all');
    const folderOnly = mode === 'folder';
    const filesOnly = mode === 'files';

    const selectedUris = await vscode.window.showOpenDialog({
      title: folderOnly ? 'RemoteEdit: Upload Folder' : filesOnly ? 'RemoteEdit: Upload Files' : 'RemoteEdit: Upload Files or Folders',
      openLabel: 'Upload',
      canSelectFiles: !folderOnly,
      canSelectFolders: !filesOnly,
      canSelectMany: true
    });

    if (!selectedUris?.length) {
      this.logInfo('Upload selection cancelled.');
      this.postStatus('Upload cancelled.');
      return;
    }

    this.enqueueTransferJob({
      id: this.createTransferJobId(),
      operation: 'Upload',
      connectionId,
      connectionLabel: this.buildTransferConnectionLabel(connectionId),
      title: this.buildSelectedLocalItemsLabel(selectedUris),
      from: this.buildUploadQueueSourceLabel(selectedUris),
      to: this.buildUploadQueueTargetLabel(selectedUris, targetDirectory),
      progress: '--',
      run: cancellationSource => this.runUploadTransfer(connectionId, targetDirectory, selectedUris, cancellationSource)
    });
  }

  private async runUploadTransfer(
    connectionId: string,
    targetDirectory: string,
    selectedUris: readonly vscode.Uri[],
    transferCancellationSource: vscode.CancellationTokenSource
  ): Promise<TransferCompletionStatus> {
    this.postStatus('Preparing upload...');
    this.setActiveTransferProgress('Preparing upload...');

    const token = transferCancellationSource.token;
    const summary: TransferSummary = { transferredFiles: 0, skippedItems: [], failedItems: [] };
    const skipped = this.createTransferSkipState();
    throwIfCancelled(token, 'Upload cancelled.');
    const items = await this.collectUploadTransferItems(selectedUris, targetDirectory, summary, token);
    throwIfCancelled(token, 'Upload cancelled.');

    if (!items.length) {
      const completionStatus = this.getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Upload', this.buildTransferCompletionStatusText('Upload', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
      this.postStatus(this.buildTransferStatusMessage('Upload', summary));
      await this.showTransferSummary('Upload', summary);
      return completionStatus;
    }

    try {
      await this.prepareUploadConflicts(connectionId, items, summary, skipped, token);
    } catch (error) {
      if (this.formatTransferError(error) === 'Upload cancelled.') {
        this.setActiveTransferResultSummary(summary);
        this.logActiveTransferEvent('Upload', 'Upload cancelled during conflict resolution.', { SkippedItems: summary.skippedItems.length });
        this.postStatus('Upload cancelled.');
        return 'Cancelled';
      }
      throw error;
    }

    const remainingItems = items.filter(item => !this.shouldSkipTransferItem(item.relativePath, skipped));

    if (!remainingItems.length) {
      const completionStatus = this.getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Upload', this.buildTransferCompletionStatusText('Upload', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
      this.postStatus(this.buildTransferStatusMessage('Upload', summary));
      await this.showTransferSummary('Upload', summary);
      return completionStatus;
    }

    const uploadFileItems = remainingItems.filter(item => item.kind === 'file');
    const totalBytes = uploadFileItems.reduce((sum, item) => sum + item.size, 0);
    const aggregateState: AggregateTransferState = { completedBytes: 0, totalBytes };

    let uploadCancelled = false;
    this.postStatus('Uploading...');
    this.setActiveTransferStatus('Running');
    this.setActiveTransferProgress('Starting upload...');

    try {
      await withRemoteEditProgress(
        'Uploading...',
        async (token, progress) => {
          for (const item of remainingItems.filter(item => item.kind === 'directory')) {
            throwIfCancelled(token, 'Upload cancelled.');

            try {
              await this.sessions.createDirectory(connectionId, item.remotePath);
            } catch (error) {
              summary.failedItems.push(`${item.relativePath}: ${this.formatTransferError(error)}`);
            }
          }

          for (const [index, item] of uploadFileItems.entries()) {
            const progressDetail = this.buildTransferProgressDetail(item.relativePath, index + 1, uploadFileItems.length);
            throwIfCancelled(token, 'Upload cancelled.');

            try {
              await this.sessions.createDirectory(connectionId, dirnameRemotePath(item.remotePath));
              throwIfCancelled(token, 'Upload cancelled.');
              const content = await fs.readFile(item.localPath);
              throwIfCancelled(token, 'Upload cancelled.');
              await this.sessions.writeFile(
                connectionId,
                item.remotePath,
                content,
                this.createAggregateProgress(progress, 'Uploading...', aggregateState, item.size, progressDetail),
                token
              );
              throwIfCancelled(token, 'Upload cancelled.');
              aggregateState.completedBytes += item.size;
              progress.reportBytes('Uploading...', aggregateState.completedBytes, aggregateState.totalBytes, progressDetail);
              summary.transferredFiles += 1;
            } catch (error) {
              if (isRemoteEditOperationCancelled(error)) {
                throw error;
              }
              summary.failedItems.push(`${item.relativePath}: ${this.formatTransferError(error)}`);
            }
          }
        },
        {
          cancellable: true,
          returnOnCancel: true,
          cancelMessage: 'Upload cancelled.',
          cancellationSource: transferCancellationSource
        }
      ).catch(error => {
        if (isRemoteEditOperationCancelled(error)) {
          uploadCancelled = true;
          this.logActiveTransferEvent('Upload', 'Upload cancelled.', { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
          return;
        }
        throw error;
      });
    } finally {
      await this.listDirectory(targetDirectory);
    }

    if (uploadCancelled) {
      this.setActiveTransferResultSummary(summary);
      this.postStatus('Upload cancelled.');
      await this.showTransferSummary('Upload', summary);
      return 'Cancelled';
    }

    const completionStatus = this.getTransferCompletionStatus(summary);
    const completionMessage = this.buildTransferCompletionStatusText('Upload', summary);
    this.setActiveTransferResultSummary(summary);
    this.logActiveTransferEvent('Upload', completionMessage, { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
    this.postStatus(this.buildTransferStatusMessage('Upload', summary));
    await this.showTransferSummary('Upload', summary);
    return completionStatus;
  }

  private async requestDownloadEntries(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    const entries = rawEntries
      .map((entry: any) => ({
        name: String(entry?.name || ''),
        type: String(entry?.type || ''),
        effectiveType: String(entry?.effectiveType || ''),
        path: entry?.path ? normalizeRemotePath(String(entry.path)) : ''
      }))
      .filter((entry: any) => Boolean(entry.path) && entry.name !== '..');

    if (!entries.length) {
      throw new Error('Select one or more remote files or folders to download.');
    }

    const targetFolders = await vscode.window.showOpenDialog({
      title: 'RemoteEdit: Select Download Folder',
      openLabel: 'Download Here',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false
    });

    const targetFolder = targetFolders?.[0]?.fsPath;

    if (!targetFolder) {
      this.logInfo('Download folder selection cancelled.');
      this.postStatus('Download cancelled.');
      return;
    }

    this.enqueueTransferJob({
      id: this.createTransferJobId(),
      operation: 'Download',
      connectionId,
      connectionLabel: this.buildTransferConnectionLabel(connectionId),
      title: this.buildSelectedRemoteItemsLabel(entries),
      from: this.buildDownloadQueueSourceLabel(entries),
      to: this.buildDownloadQueueTargetLabel(entries, targetFolder),
      progress: '--',
      run: cancellationSource => this.runDownloadTransfer(connectionId, entries, targetFolder, cancellationSource)
    });
  }

  private async runDownloadTransfer(
    connectionId: string,
    entries: Array<{ name: string; type: string; effectiveType: string; path: string }>,
    targetFolder: string,
    transferCancellationSource: vscode.CancellationTokenSource
  ): Promise<TransferCompletionStatus> {
    this.postStatus('Preparing download...');
    this.setActiveTransferProgress('Preparing download...');

    const token = transferCancellationSource.token;
    const summary: TransferSummary = { transferredFiles: 0, skippedItems: [], failedItems: [] };
    const skipped = this.createTransferSkipState();
    const items: DownloadTransferItem[] = [];

    for (const entry of entries) {
      throwIfCancelled(token, 'Download cancelled.');
      await this.collectDownloadTransferItems(connectionId, entry, targetFolder, summary, items, token);
    }
    throwIfCancelled(token, 'Download cancelled.');

    if (!items.length) {
      const completionStatus = this.getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Download', this.buildTransferCompletionStatusText('Download', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
      this.postStatus(this.buildTransferStatusMessage('Download', summary));
      await this.showTransferSummary('Download', summary);
      return completionStatus;
    }

    try {
      await this.prepareDownloadConflicts(connectionId, items, summary, skipped, token);
    } catch (error) {
      if (this.formatTransferError(error) === 'Download cancelled.') {
        this.setActiveTransferResultSummary(summary);
        this.logActiveTransferEvent('Download', 'Download cancelled during conflict resolution.', { SkippedItems: summary.skippedItems.length });
        this.postStatus('Download cancelled.');
        return 'Cancelled';
      }
      throw error;
    }

    const remainingItems = items.filter(item => !this.shouldSkipTransferItem(item.relativePath, skipped));

    if (!remainingItems.length) {
      const completionStatus = this.getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Download', this.buildTransferCompletionStatusText('Download', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
      this.postStatus(this.buildTransferStatusMessage('Download', summary));
      await this.showTransferSummary('Download', summary);
      return completionStatus;
    }

    const downloadFileItems = remainingItems.filter(item => item.kind === 'file');
    const totalBytes = downloadFileItems.reduce((sum, item) => sum + item.size, 0);
    const aggregateState: AggregateTransferState = { completedBytes: 0, totalBytes };

    let downloadCancelled = false;
    this.postStatus('Downloading...');
    this.setActiveTransferStatus('Running');
    this.setActiveTransferProgress('Starting download...');

    try {
      await withRemoteEditProgress(
        'Downloading...',
        async (token, progress) => {
          for (const item of remainingItems.filter(item => item.kind === 'directory')) {
            try {
              await fs.mkdir(item.localPath, { recursive: true });
            } catch (error) {
              summary.failedItems.push(`${item.relativePath}: ${this.formatTransferError(error)}`);
            }
          }

          for (const [index, item] of downloadFileItems.entries()) {
            const progressDetail = this.buildTransferProgressDetail(item.relativePath, index + 1, downloadFileItems.length);
            throwIfCancelled(token, 'Download cancelled.');

            try {
              await fs.mkdir(path.dirname(item.localPath), { recursive: true });
              const content = await this.sessions.readFile(
                connectionId,
                item.remotePath,
                token,
                this.createAggregateProgress(progress, 'Downloading...', aggregateState, item.size, progressDetail)
              );
              await this.writeLocalFileSafely(item.localPath, content);
              aggregateState.completedBytes += item.size;
              progress.reportBytes('Downloading...', aggregateState.completedBytes, aggregateState.totalBytes, progressDetail);
              summary.transferredFiles += 1;
            } catch (error) {
              if (isRemoteEditOperationCancelled(error)) {
                throw error;
              }
              summary.failedItems.push(`${item.relativePath}: ${this.formatTransferError(error)}`);
            }
          }
        },
        {
          cancellable: true,
          returnOnCancel: true,
          cancelMessage: 'Download cancelled.',
          cancellationSource: transferCancellationSource
        }
      ).catch(error => {
        if (isRemoteEditOperationCancelled(error)) {
          downloadCancelled = true;
          this.logActiveTransferEvent('Download', 'Download cancelled.', { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
          return;
        }
        throw error;
      });
    } finally {
      // The queue owns the active transfer cancellation source.
    }

    if (downloadCancelled) {
      this.setActiveTransferResultSummary(summary);
      this.postStatus('Download cancelled.');
      await this.showTransferSummary('Download', summary);
      return 'Cancelled';
    }

    const completionStatus = this.getTransferCompletionStatus(summary);
    const completionMessage = this.buildTransferCompletionStatusText('Download', summary);
    this.setActiveTransferResultSummary(summary);
    this.logActiveTransferEvent('Download', completionMessage, { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
    this.postStatus(this.buildTransferStatusMessage('Download', summary));
    await this.showTransferSummary('Download', summary);
    return completionStatus;
  }

  private async collectUploadTransferItems(
    selectedUris: readonly vscode.Uri[],
    targetDirectory: string,
    summary: TransferSummary,
    token: vscode.CancellationToken
  ): Promise<UploadTransferItem[]> {
    const items: UploadTransferItem[] = [];

    for (const uri of selectedUris) {
      throwIfCancelled(token, 'Upload cancelled.');
      const localPath = uri.fsPath;
      const baseName = path.basename(localPath);
      await this.collectUploadPath(localPath, baseName, targetDirectory, summary, items, token);
    }

    return items;
  }

  private async collectUploadPath(
    localPath: string,
    relativePath: string,
    targetDirectory: string,
    summary: TransferSummary,
    items: UploadTransferItem[],
    token: vscode.CancellationToken
  ): Promise<void> {
    throwIfCancelled(token, 'Upload cancelled.');
    const stats = await fs.lstat(localPath);
    throwIfCancelled(token, 'Upload cancelled.');

    if (stats.isSymbolicLink()) {
      summary.skippedItems.push(`${relativePath}: skipped symbolic link`);
      return;
    }

    const remotePath = this.joinRemoteRelativePath(targetDirectory, relativePath);

    if (stats.isDirectory()) {
      items.push({ kind: 'directory', localPath, remotePath, relativePath, size: 0 });
      const children = await fs.readdir(localPath);
      for (const child of children) {
        throwIfCancelled(token, 'Upload cancelled.');
        await this.collectUploadPath(path.join(localPath, child), path.posix.join(this.toPosixRelativePath(relativePath), child), targetDirectory, summary, items, token);
      }
      return;
    }

    if (stats.isFile()) {
      items.push({ kind: 'file', localPath, remotePath, relativePath: this.toPosixRelativePath(relativePath), size: Number(stats.size || 0) });
      return;
    }

    summary.skippedItems.push(`${relativePath}: skipped unsupported local item`);
  }

  private async collectDownloadTransferItems(
    connectionId: string,
    entry: { name: string; type: string; effectiveType?: string; path: string },
    targetFolder: string,
    summary: TransferSummary,
    items: DownloadTransferItem[],
    token: vscode.CancellationToken
  ): Promise<void> {
    const relativePath = this.toPosixRelativePath(entry.name || path.posix.basename(entry.path));
    throwIfCancelled(token, 'Download cancelled.');
    await this.collectDownloadPath(connectionId, entry.path, relativePath, targetFolder, entry.type, entry.effectiveType, summary, items, token);
  }

  private async collectDownloadPath(
    connectionId: string,
    remotePath: string,
    relativePath: string,
    targetFolder: string,
    entryType: string | undefined,
    effectiveType: string | undefined,
    summary: TransferSummary,
    items: DownloadTransferItem[],
    token: vscode.CancellationToken
  ): Promise<void> {
    throwIfCancelled(token, 'Download cancelled.');

    if (entryType === 'link') {
      summary.skippedItems.push(`${relativePath}: skipped symbolic link`);
      return;
    }

    const resolvedType = effectiveType === 'file' || effectiveType === 'directory'
      ? effectiveType
      : entryType === 'file' || entryType === 'directory'
        ? entryType
        : (await this.sessions.stat(connectionId, remotePath)).type;

    throwIfCancelled(token, 'Download cancelled.');

    const localPath = path.join(targetFolder, ...this.toPosixRelativePath(relativePath).split('/').filter(Boolean));

    if (resolvedType === 'directory') {
      items.push({ kind: 'directory', remotePath, localPath, relativePath: this.toPosixRelativePath(relativePath), size: 0 });
      const children = await this.sessions.listDirectory(connectionId, remotePath);
      throwIfCancelled(token, 'Download cancelled.');
      for (const child of children) {
        if (child.name === '..') {
          continue;
        }
        throwIfCancelled(token, 'Download cancelled.');
        await this.collectDownloadPath(
          connectionId,
          child.path,
          path.posix.join(this.toPosixRelativePath(relativePath), child.name),
          targetFolder,
          child.type,
          child.effectiveType,
          summary,
          items,
          token
        );
      }
      return;
    }

    if (resolvedType === 'file') {
      const stats = await this.sessions.stat(connectionId, remotePath);
      throwIfCancelled(token, 'Download cancelled.');
      items.push({ kind: 'file', remotePath, localPath, relativePath: this.toPosixRelativePath(relativePath), size: Number(stats.size || 0) });
      return;
    }

    summary.skippedItems.push(`${relativePath}: skipped unsupported remote item`);
  }

  private async prepareUploadConflicts(connectionId: string, items: UploadTransferItem[], summary: TransferSummary, skipped: TransferSkipState, token: vscode.CancellationToken): Promise<void> {
    const conflictState: TransferConflictState = {
      overwriteAllFiles: false,
      skipAllFiles: false,
      mergeAllFolders: false,
      skipAllFolders: false
    };
    const hasMultipleItems = items.length > 1;

    for (const item of items) {
      throwIfCancelled(token, 'Upload cancelled.');
      if (this.shouldSkipTransferItem(item.relativePath, skipped)) {
        continue;
      }

      let destinationStats: Awaited<ReturnType<SftpSessionManager['stat']>> | undefined;
      try {
        destinationStats = await this.sessions.stat(connectionId, item.remotePath);
      } catch {
        continue;
      }

      throwIfCancelled(token, 'Upload cancelled.');

      if (item.kind === 'directory') {
        if (destinationStats.type === 'directory') {
          const sourceStats = await fs.lstat(item.localPath);
          const decision = await this.resolveTransferConflict(
            {
              operation: 'Upload',
              kind: 'directory',
              relativePath: item.relativePath,
              sourcePath: item.localPath,
              destinationPath: item.remotePath,
              sourceType: 'Local folder',
              destinationType: 'Remote folder',
              sourceSize: 0,
              destinationSize: 0,
              sourceModified: sourceStats.mtimeMs,
              destinationModified: destinationStats.modifyTime,
              hasMultipleItems
            },
            conflictState,
            token
          );
          throwIfCancelled(token, 'Upload cancelled.');

          if (decision === 'cancel') {
            throw new Error('Upload cancelled.');
          }
          if (decision === 'skip') {
            this.markTransferTreeSkipped(item.relativePath, skipped, summary, 'skipped folder conflict');
          }
          continue;
        }

        const decision = await this.resolveTransferConflict(
          {
            operation: 'Upload',
            kind: 'typeMismatch',
            relativePath: item.relativePath,
            sourcePath: item.localPath,
            destinationPath: item.remotePath,
            sourceType: 'Local folder',
            destinationType: 'Remote file',
            sourceSize: 0,
            destinationSize: destinationStats.size,
            sourceModified: (await fs.lstat(item.localPath)).mtimeMs,
            destinationModified: destinationStats.modifyTime,
            hasMultipleItems: false
          },
          conflictState,
          token
        );
        throwIfCancelled(token, 'Upload cancelled.');

        if (decision === 'cancel') {
          throw new Error('Upload cancelled.');
        }
        this.markTransferTreeSkipped(item.relativePath, skipped, summary, 'skipped because a remote file already exists at the target path');
        continue;
      }

      if (destinationStats.type === 'directory') {
        const sourceStats = await fs.lstat(item.localPath);
        const decision = await this.resolveTransferConflict(
          {
            operation: 'Upload',
            kind: 'typeMismatch',
            relativePath: item.relativePath,
            sourcePath: item.localPath,
            destinationPath: item.remotePath,
            sourceType: 'Local file',
            destinationType: 'Remote folder',
            sourceSize: item.size,
            destinationSize: 0,
            sourceModified: sourceStats.mtimeMs,
            destinationModified: destinationStats.modifyTime,
            hasMultipleItems: false
          },
          conflictState,
          token
        );
        throwIfCancelled(token, 'Upload cancelled.');

        if (decision === 'cancel') {
          throw new Error('Upload cancelled.');
        }
        this.markTransferPathSkipped(item.relativePath, skipped, summary, 'skipped because a remote folder already exists at the target path');
        continue;
      }

      const sourceStats = await fs.lstat(item.localPath);
      const decision = await this.resolveTransferConflict(
        {
          operation: 'Upload',
          kind: 'file',
          relativePath: item.relativePath,
          sourcePath: item.localPath,
          destinationPath: item.remotePath,
          sourceType: 'Local file',
          destinationType: 'Remote file',
          sourceSize: item.size,
          destinationSize: destinationStats.size,
          sourceModified: sourceStats.mtimeMs,
          destinationModified: destinationStats.modifyTime,
          hasMultipleItems
        },
        conflictState,
        token
      );
      throwIfCancelled(token, 'Upload cancelled.');

      if (decision === 'cancel') {
        throw new Error('Upload cancelled.');
      }
      if (decision === 'skip') {
        this.markTransferPathSkipped(item.relativePath, skipped, summary, 'skipped file conflict');
      }
    }
  }

  private async prepareDownloadConflicts(connectionId: string, items: DownloadTransferItem[], summary: TransferSummary, skipped: TransferSkipState, token: vscode.CancellationToken): Promise<void> {
    const conflictState: TransferConflictState = {
      overwriteAllFiles: false,
      skipAllFiles: false,
      mergeAllFolders: false,
      skipAllFolders: false
    };
    const hasMultipleItems = items.length > 1;

    for (const item of items) {
      throwIfCancelled(token, 'Download cancelled.');
      if (this.shouldSkipTransferItem(item.relativePath, skipped)) {
        continue;
      }

      let destinationStats: Awaited<ReturnType<typeof fs.stat>> | undefined;
      try {
        destinationStats = await fs.stat(item.localPath);
      } catch {
        continue;
      }

      throwIfCancelled(token, 'Download cancelled.');
      const sourceStats = await this.tryStatRemotePath(connectionId, item.remotePath);

      if (item.kind === 'directory') {
        if (destinationStats.isDirectory()) {
          const decision = await this.resolveTransferConflict(
            {
              operation: 'Download',
              kind: 'directory',
              relativePath: item.relativePath,
              sourcePath: item.remotePath,
              destinationPath: item.localPath,
              sourceType: 'Remote folder',
              destinationType: 'Local folder',
              sourceSize: 0,
              destinationSize: 0,
              sourceModified: sourceStats?.modifyTime,
              destinationModified: destinationStats.mtimeMs,
              hasMultipleItems
            },
            conflictState,
            token
          );
          throwIfCancelled(token, 'Download cancelled.');

          if (decision === 'cancel') {
            throw new Error('Download cancelled.');
          }
          if (decision === 'skip') {
            this.markTransferTreeSkipped(item.relativePath, skipped, summary, 'skipped folder conflict');
          }
          continue;
        }

        const decision = await this.resolveTransferConflict(
          {
            operation: 'Download',
            kind: 'typeMismatch',
            relativePath: item.relativePath,
            sourcePath: item.remotePath,
            destinationPath: item.localPath,
            sourceType: 'Remote folder',
            destinationType: 'Local file',
            sourceSize: 0,
            destinationSize: destinationStats.size,
            sourceModified: sourceStats?.modifyTime,
            destinationModified: destinationStats.mtimeMs,
            hasMultipleItems: false
          },
          conflictState,
          token
        );
        throwIfCancelled(token, 'Download cancelled.');

        if (decision === 'cancel') {
          throw new Error('Download cancelled.');
        }
        this.markTransferTreeSkipped(item.relativePath, skipped, summary, 'skipped because a local file already exists at the target path');
        continue;
      }

      if (destinationStats.isDirectory()) {
        const decision = await this.resolveTransferConflict(
          {
            operation: 'Download',
            kind: 'typeMismatch',
            relativePath: item.relativePath,
            sourcePath: item.remotePath,
            destinationPath: item.localPath,
            sourceType: 'Remote file',
            destinationType: 'Local folder',
            sourceSize: item.size,
            destinationSize: 0,
            sourceModified: sourceStats?.modifyTime,
            destinationModified: destinationStats.mtimeMs,
            hasMultipleItems: false
          },
          conflictState,
          token
        );
        throwIfCancelled(token, 'Download cancelled.');

        if (decision === 'cancel') {
          throw new Error('Download cancelled.');
        }
        this.markTransferPathSkipped(item.relativePath, skipped, summary, 'skipped because a local folder already exists at the target path');
        continue;
      }

      const decision = await this.resolveTransferConflict(
        {
          operation: 'Download',
          kind: 'file',
          relativePath: item.relativePath,
          sourcePath: item.remotePath,
          destinationPath: item.localPath,
          sourceType: 'Remote file',
          destinationType: 'Local file',
          sourceSize: item.size,
          destinationSize: destinationStats.size,
          sourceModified: sourceStats?.modifyTime,
          destinationModified: destinationStats.mtimeMs,
          hasMultipleItems
        },
        conflictState,
        token
      );
      throwIfCancelled(token, 'Download cancelled.');

      if (decision === 'cancel') {
        throw new Error('Download cancelled.');
      }
      if (decision === 'skip') {
        this.markTransferPathSkipped(item.relativePath, skipped, summary, 'skipped file conflict');
      }
    }
  }

  private async resolveTransferConflict(
    options: Omit<PendingTransferConflict, 'requestId' | 'transferId' | 'resolve'>,
    state: TransferConflictState,
    token: vscode.CancellationToken
  ): Promise<TransferConflictDecision> {
    if (options.kind === 'file') {
      if (state.overwriteAllFiles) {
        return 'overwrite';
      }
      if (state.skipAllFiles) {
        return 'skip';
      }
    }

    if (options.kind === 'directory') {
      if (state.mergeAllFolders) {
        return 'merge';
      }
      if (state.skipAllFolders) {
        return 'skip';
      }
    }

    const operation = options.operation;
    const waitingMessage = options.kind === 'directory'
      ? 'Waiting for folder conflict decision...'
      : options.kind === 'typeMismatch'
        ? 'Waiting for type conflict decision...'
        : 'Waiting for file conflict decision...';

    this.logActiveTransferEvent(operation, `${operation} conflict detected.`, { Item: options.relativePath });
    this.postStatus(waitingMessage);
    this.setActiveTransferStatus('Waiting');
    this.setActiveTransferProgress(waitingMessage);

    const selected = await this.requestTransferConflictDecision(options, token);
    throwIfCancelled(token, `${operation} cancelled.`);
    this.setActiveTransferStatus('Preparing');
    this.setActiveTransferProgress(`Preparing ${operation.toLowerCase()}...`);

    if (selected === 'overwrite') {
      this.logActiveTransferEvent(operation, `${operation} conflict decision: overwrite.`, { Item: options.relativePath });
      return 'overwrite';
    }
    if (selected === 'skip') {
      this.logActiveTransferEvent(operation, `${operation} conflict decision: skip.`, { Item: options.relativePath });
      return 'skip';
    }
    if (selected === 'overwriteAll') {
      state.overwriteAllFiles = true;
      this.logActiveTransferEvent(operation, `${operation} conflict decision: overwrite all files.`, { Item: options.relativePath });
      return 'overwrite';
    }
    if (selected === 'skipAll') {
      if (options.kind === 'directory') {
        state.skipAllFolders = true;
        this.logActiveTransferEvent(operation, `${operation} conflict decision: skip all folders.`, { Item: options.relativePath });
      } else {
        state.skipAllFiles = true;
        this.logActiveTransferEvent(operation, `${operation} conflict decision: skip all files.`, { Item: options.relativePath });
      }
      return 'skip';
    }
    if (selected === 'merge') {
      this.logActiveTransferEvent(operation, `${operation} conflict decision: merge.`, { Item: options.relativePath });
      return 'merge';
    }
    if (selected === 'mergeAll') {
      state.mergeAllFolders = true;
      this.logActiveTransferEvent(operation, `${operation} conflict decision: merge all folders.`, { Item: options.relativePath });
      return 'merge';
    }

    this.logActiveTransferEvent(operation, `${operation} conflict decision: cancel.`, { Item: options.relativePath });
    return 'cancel';
  }

  private requestTransferConflictDecision(
    options: Omit<PendingTransferConflict, 'requestId' | 'transferId' | 'resolve'>,
    token: vscode.CancellationToken
  ): Promise<TransferConflictChoice> {
    const transferId = this.activeTransferJob?.id || '';
    const requestId = `${Date.now()}-${++this.transferConflictSequence}`;

    return new Promise<TransferConflictChoice>(resolve => {
      const subscription = token.onCancellationRequested(() => {
        this.cancelPendingTransferConflict(transferId || undefined);
      });

      const finish = (decision: TransferConflictChoice): void => {
        subscription.dispose();
        resolve(decision);
      };

      this.pendingTransferConflict = {
        ...options,
        requestId,
        transferId,
        resolve: finish
      };

      this.postPendingTransferConflict();
      this.notifyTransferConflictDecisionNeeded();
    });
  }

  private postPendingTransferConflict(): void {
    if (!this.pendingTransferConflict) {
      this.postMessage(RemoteEditOutboundMessageType.HideTransferConflictDialog, {});
      return;
    }

    this.postMessage(RemoteEditOutboundMessageType.ShowTransferConflictDialog, this.buildTransferConflictDialogPayload(this.pendingTransferConflict));
  }

  private buildTransferConflictDialogPayload(conflict: PendingTransferConflict): any {
    const itemName = path.posix.basename(this.toPosixRelativePath(conflict.relativePath)) || this.toPosixRelativePath(conflict.relativePath);
    const isUpload = conflict.operation === 'Upload';
    const action = isUpload ? 'Upload' : 'Download';
    const lowerAction = action.toLowerCase();
    const title = conflict.kind === 'directory'
      ? `${action} folder conflict`
      : `${action} conflict`;
    const message = conflict.kind === 'directory'
      ? 'A folder with the same name already exists in the destination.'
      : conflict.kind === 'typeMismatch'
        ? this.buildTypeMismatchConflictMessage(conflict)
        : 'A file with the same name already exists in the destination.';

    return {
      requestId: conflict.requestId,
      operation: conflict.operation,
      kind: conflict.kind,
      title,
      message,
      itemName,
      relativePath: conflict.relativePath,
      sourcePath: conflict.sourcePath,
      destinationPath: conflict.destinationPath,
      sourceType: conflict.sourceType,
      destinationType: conflict.destinationType,
      sourceSize: conflict.sourceSize && conflict.sourceSize > 0 ? formatBytes(conflict.sourceSize) : '',
      destinationSize: conflict.destinationSize && conflict.destinationSize > 0 ? formatBytes(conflict.destinationSize) : '',
      sourceModified: this.formatTimestampForDialog(conflict.sourceModified || 0),
      destinationModified: this.formatTimestampForDialog(conflict.destinationModified || 0),
      choices: this.buildTransferConflictChoices(conflict),
      note: conflict.kind === 'directory'
        ? 'Merge uses the existing folder and copies content into it. It does not delete extra files already in the destination.'
        : conflict.kind === 'file' && conflict.hasMultipleItems
          ? 'Overwrite All and Skip All apply only to future file conflicts in this transfer.'
          : '',
      lowerAction
    };
  }

  private buildTypeMismatchConflictMessage(conflict: PendingTransferConflict): string {
    if (conflict.sourceType.toLowerCase().includes('folder')) {
      return 'A folder cannot be copied because a file with the same name already exists in the destination.';
    }

    return 'A file cannot be copied because a folder with the same name already exists in the destination.';
  }

  private buildTransferConflictChoices(conflict: PendingTransferConflict): Array<{ label: string; decision: TransferConflictChoice; primary?: boolean; danger?: boolean }> {
    if (conflict.kind === 'typeMismatch') {
      return [
        { label: 'Skip', decision: 'skip' },
        { label: 'Cancel', decision: 'cancel', danger: true }
      ];
    }

    if (conflict.kind === 'directory') {
      const choices: Array<{ label: string; decision: TransferConflictChoice; primary?: boolean; danger?: boolean }> = [
        { label: 'Merge', decision: 'merge', primary: true },
        { label: 'Skip', decision: 'skip' }
      ];

      if (conflict.hasMultipleItems) {
        choices.push({ label: 'Merge All', decision: 'mergeAll' });
        choices.push({ label: 'Skip All', decision: 'skipAll' });
      }

      choices.push({ label: 'Cancel', decision: 'cancel', danger: true });
      return choices;
    }

    if (!conflict.hasMultipleItems) {
      return [
        { label: 'Overwrite', decision: 'overwrite', primary: true },
        { label: 'Cancel', decision: 'cancel', danger: true }
      ];
    }

    return [
      { label: 'Overwrite', decision: 'overwrite', primary: true },
      { label: 'Skip', decision: 'skip' },
      { label: 'Overwrite All', decision: 'overwriteAll' },
      { label: 'Skip All', decision: 'skipAll' },
      { label: 'Cancel', decision: 'cancel', danger: true }
    ];
  }

  private handleTransferConflictResponse(payload: any): void {
    const requestId = String(payload?.requestId || '');
    const decision = String(payload?.decision || 'cancel') as TransferConflictChoice;
    const conflict = this.pendingTransferConflict;

    if (!conflict || conflict.requestId !== requestId) {
      return;
    }

    this.pendingTransferConflict = undefined;
    this.postMessage(RemoteEditOutboundMessageType.HideTransferConflictDialog, {});
    conflict.resolve(this.isValidTransferConflictChoice(decision) ? decision : 'cancel');
  }

  private isValidTransferConflictChoice(value: string): value is TransferConflictChoice {
    return value === 'overwrite'
      || value === 'skip'
      || value === 'overwriteAll'
      || value === 'skipAll'
      || value === 'cancel'
      || value === 'merge'
      || value === 'mergeAll';
  }

  private cancelPendingTransferConflict(transferId?: string): void {
    const conflict = this.pendingTransferConflict;

    if (!conflict) {
      return;
    }

    if (transferId && conflict.transferId && conflict.transferId !== transferId) {
      return;
    }

    this.pendingTransferConflict = undefined;
    this.postMessage(RemoteEditOutboundMessageType.HideTransferConflictDialog, {});
    conflict.resolve('cancel');
  }

  private notifyTransferConflictDecisionNeeded(): void {
    if (this.panel && !this.isDisposed && this.panel.visible) {
      return;
    }

    void vscode.window.showWarningMessage(
      'Remote Edit transfer paused. A conflict decision is required to continue.',
      'Open Remote Edit'
    ).then(choice => {
      if (choice !== 'Open Remote Edit') {
        return;
      }

      this.revealRemoteEditPanel();
      this.postPendingTransferConflict();
    });
  }

  private revealRemoteEditPanel(): void {
    if (this.panel && !this.isDisposed) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = RemoteEditPanel.createWebviewPanel();
    this.attachPanel(panel);
  }

  private createTransferSkipState(): TransferSkipState {
    return {
      paths: new Set<string>(),
      prefixes: new Set<string>()
    };
  }

  private markTransferPathSkipped(relativePath: string, skipped: TransferSkipState, summary: TransferSummary, reason?: string): void {
    const normalizedPath = this.toPosixRelativePath(relativePath);
    skipped.paths.add(normalizedPath);
    summary.skippedItems.push(reason ? `${normalizedPath}: ${reason}` : normalizedPath);
  }

  private markTransferTreeSkipped(relativePath: string, skipped: TransferSkipState, summary: TransferSummary, reason?: string): void {
    const normalizedPath = this.toPosixRelativePath(relativePath);
    skipped.paths.add(normalizedPath);
    skipped.prefixes.add(`${normalizedPath.replace(/\/+$/, '')}/`);
    summary.skippedItems.push(reason ? `${normalizedPath}: ${reason}` : normalizedPath);
  }

  private shouldSkipTransferItem(relativePath: string, skipped: TransferSkipState): boolean {
    const normalizedPath = this.toPosixRelativePath(relativePath);

    if (skipped.paths.has(normalizedPath)) {
      return true;
    }

    for (const prefix of skipped.prefixes) {
      if (normalizedPath.startsWith(prefix)) {
        return true;
      }
    }

    return false;
  }

  private createAggregateProgress(
    progress: RemoteEditProgressReporter,
    label: string,
    state: AggregateTransferState,
    itemBytes: number,
    detail?: string
  ): RemoteEditProgressReporter {
    return {
      reportMessage: () => {
        const message = detail ? `${detail} - ${label}` : label;
        this.setActiveTransferProgress(message);
        progress.reportMessage(message);
      },
      reportBytes: (_label: string, transferredBytes: number) => {
        const aggregateTransferredBytes = state.completedBytes + Math.min(transferredBytes, itemBytes);
        this.setActiveTransferProgress(this.formatTransferProgressMessage(label, aggregateTransferredBytes, state.totalBytes, detail));
        progress.reportBytes(label, aggregateTransferredBytes, state.totalBytes, detail);
      }
    };
  }

  private formatTransferProgressMessage(label: string, transferredBytes: number, totalBytes: number, detail?: string): string {
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      return label;
    }

    const safeTransferred = Math.max(0, Math.min(transferredBytes, totalBytes));
    const percent = Math.max(0, Math.min(100, Math.floor((safeTransferred / totalBytes) * 100)));
    const transferMessage = `${formatBytes(safeTransferred)} of ${formatBytes(totalBytes)} (${percent}%)`;
    return detail ? `${detail} - ${transferMessage}` : transferMessage;
  }

  private buildTransferProgressDetail(relativePath: string, currentFile: number, totalFiles: number): string {
    const fileLabel = this.truncateTransferProgressLabel(relativePath || 'file');

    if (totalFiles > 1) {
      return `${currentFile}/${totalFiles}: ${fileLabel}`;
    }

    return fileLabel;
  }

  private truncateTransferProgressLabel(label: string, maxLength = 42): string {
    const normalizedLabel = label.replace(/\\/g, '/');

    if (normalizedLabel.length <= maxLength) {
      return normalizedLabel;
    }

    const keepStart = Math.max(8, Math.floor((maxLength - 3) / 2));
    const keepEnd = Math.max(8, maxLength - keepStart - 3);
    return `${normalizedLabel.slice(0, keepStart)}...${normalizedLabel.slice(-keepEnd)}`;
  }

  private buildSelectedLocalItemsLabel(selectedUris: readonly vscode.Uri[]): string {
    if (selectedUris.length === 1) {
      return path.basename(selectedUris[0].fsPath) || 'Selected item';
    }

    return `${selectedUris.length} selected items`;
  }

  private buildSelectedRemoteItemsLabel(entries: Array<{ name: string; path: string }>): string {
    if (entries.length === 1) {
      return entries[0].name || path.posix.basename(entries[0].path) || 'Selected item';
    }

    return `${entries.length} selected items`;
  }

  private buildUploadQueueSourceLabel(selectedUris: readonly vscode.Uri[]): string {
    if (selectedUris.length === 1) {
      return selectedUris[0].fsPath;
    }

    return `${selectedUris.length} selected items`;
  }

  private buildUploadQueueTargetLabel(selectedUris: readonly vscode.Uri[], targetDirectory: string): string {
    if (selectedUris.length === 1) {
      return this.joinRemoteRelativePath(targetDirectory, path.basename(selectedUris[0].fsPath));
    }

    return targetDirectory;
  }

  private buildDownloadQueueSourceLabel(entries: Array<{ name: string; path: string }>): string {
    if (entries.length === 1) {
      return entries[0].path;
    }

    return `${entries.length} selected items`;
  }

  private buildDownloadQueueTargetLabel(entries: Array<{ name: string; path: string }>, targetFolder: string): string {
    if (entries.length === 1) {
      const fileName = entries[0].name || path.posix.basename(entries[0].path);
      return path.join(targetFolder, fileName);
    }

    return targetFolder;
  }

  private createTransferJobId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private buildTransferConnectionLabel(connectionId: string): string {
    const connection = this.sessions.getConnection(connectionId);

    if (!connection) {
      return connectionId;
    }

    const endpoint = `${connection.username}@${connection.host}`;

    if (!connection.name || connection.name === endpoint) {
      return endpoint;
    }

    return `${connection.name} (${endpoint})`;
  }

  private enqueueTransferJob(job: QueuedTransferJob): void {
    job.queuedAt = job.queuedAt || this.formatLocalDateTime(new Date());

    const willWait = this.runningTransfers >= this.maxConcurrentTransfers;
    this.transferQueue.push(job);
    this.postTransferQueueState();

    if (!willWait) {
      void this.processTransferQueue();
      return;
    }

    const queuedCount = this.transferQueue.length;
    const message = `${job.operation} queued. It will start after the current transfer.`;
    this.logTransferEvent(job, `${job.operation} queued.`, { Pending: queuedCount });
    this.postStatus(`${message} ${this.formatQueuedTransferCount(queuedCount)}`);
    void vscode.window.showInformationMessage(message);
    this.updateActiveTransferStatusBarItem();
  }

  private async processTransferQueue(): Promise<void> {
    while (this.runningTransfers < this.maxConcurrentTransfers && this.transferQueue.length) {
      const job = this.transferQueue.shift();

      if (!job) {
        return;
      }

      if (!this.sessions.getConnection(job.connectionId)) {
        this.logTransferEvent(job, `${job.operation} skipped because the connection is no longer active.`);
        this.postStatus(`${job.operation} skipped because the connection is no longer active.`);
        this.postTransferQueueState();
        continue;
      }

      this.runningTransfers += 1;
      const transferCancellationSource = new vscode.CancellationTokenSource();
      job.startedAt = this.formatLocalDateTime(new Date());
      this.activeTransferJob = job;
      this.activeTransferJob.progress = 'Preparing...';
      this.activeTransferCancellationSource = transferCancellationSource;
      this.activeTransferConnectionId = job.connectionId;
      this.activeTransferCancelling = false;
      this.activeTransferStatus = 'Preparing';
      this.updateActiveTransferStatusBarItem();
      this.postTransferQueueState();
      this.logTransferEvent(job, `${job.operation} started.`);

      try {
        const completionStatus = await job.run(transferCancellationSource);
        this.addCompletedTransfer(job, completionStatus);
      } catch (error) {
        if (isRemoteEditOperationCancelled(error)) {
          this.logTransferEvent(job, `${job.operation} cancelled.`);
          this.postStatus(`${job.operation} cancelled.`);
          this.addCompletedTransfer(job, 'Cancelled');
        } else {
          const details = this.formatTransferError(error);
          this.logTransferEvent(job, `${job.operation} failed.`, { Details: details });
          this.postStatus(`${job.operation} failed.`);
          this.postError(`Could not complete ${job.operation.toLowerCase()}. Details: ${details}`);
          this.addCompletedTransfer(job, 'Failed');
        }
      } finally {
        this.cancelPendingTransferConflict(job.id);
        this.runningTransfers = Math.max(0, this.runningTransfers - 1);
        if (this.activeTransferCancellationSource === transferCancellationSource) {
          this.activeTransferCancellationSource = undefined;
          this.activeTransferConnectionId = undefined;
        }
        transferCancellationSource.dispose();
        if (this.activeTransferJob?.id === job.id) {
          this.activeTransferJob = undefined;
        }
        this.activeTransferCancelling = false;
        this.activeTransferStatus = 'Preparing';
        this.updateActiveTransferStatusBarItem();
        this.postTransferQueueState();
      }
    }
  }

  private formatQueuedTransferCount(count = this.transferQueue.length): string {
    return count === 1 ? '1 queued' : `${count} queued`;
  }

  private updateActiveTransferStatusBarItem(): void {
    // Transfer cancellation is available from the Transfer Queue modal.
  }

  private clearQueuedTransfersForConnection(connectionId: string): number {
    const initialLength = this.transferQueue.length;

    for (let index = this.transferQueue.length - 1; index >= 0; index -= 1) {
      if (this.transferQueue[index].connectionId === connectionId) {
        this.transferQueue.splice(index, 1);
      }
    }

    this.updateActiveTransferStatusBarItem();
    const removedCount = initialLength - this.transferQueue.length;
    if (removedCount > 0) {
      this.logInfo('Queued transfers removed for disconnected session.', { Connection: connectionId, Removed: removedCount });
      this.postTransferQueueState();
    }
    return removedCount;
  }

  private clearAllQueuedTransfers(): void {
    const removedCount = this.transferQueue.length;
    this.transferQueue.splice(0, this.transferQueue.length);
    this.updateActiveTransferStatusBarItem();
    if (removedCount > 0) {
      this.logInfo('Queued transfers cleared.', { Removed: removedCount });
      this.postTransferQueueState();
    }
  }

  private addCompletedTransfer(job: QueuedTransferJob, status: TransferCompletionStatus): void {
    if (!this.sessions.hasConnection(job.connectionId)) {
      return;
    }

    const completedTransfer = this.buildTransferQueueItemSnapshot(job, status, false);
    completedTransfer.progress = job.resultSummary ? this.buildTransferResultProgress(job.resultSummary) : status;
    completedTransfer.finishedAt = this.formatLocalDateTime(new Date());
    this.completedTransfers.push(completedTransfer);
    this.trimCompletedTransfersForConnection(job.connectionId);
    this.postTransferQueueState();
  }

  private trimCompletedTransfersForConnection(connectionId: string): void {
    let transferCount = 0;

    for (let index = this.completedTransfers.length - 1; index >= 0; index -= 1) {
      if (this.completedTransfers[index].connectionId !== connectionId) {
        continue;
      }

      transferCount += 1;

      if (transferCount > this.maxCompletedTransfersPerConnection) {
        this.completedTransfers.splice(index, 1);
      }
    }
  }

  private clearCompletedTransfersForConnection(connectionId: string): void {
    for (let index = this.completedTransfers.length - 1; index >= 0; index -= 1) {
      if (this.completedTransfers[index].connectionId === connectionId) {
        this.completedTransfers.splice(index, 1);
      }
    }

    this.postTransferQueueState();
  }

  private clearAllCompletedTransfers(): void {
    this.completedTransfers.splice(0, this.completedTransfers.length);
    this.postTransferQueueState();
  }

  private beginManualTransfer(operation: 'Upload' | 'Download', connectionId: string): vscode.CancellationTokenSource {
    this.endManualTransfer();

    const source = new vscode.CancellationTokenSource();
    this.activeTransferCancellationSource = source;
    this.activeTransferConnectionId = connectionId;
    this.activeTransferCancelling = false;
    this.updateActiveTransferStatusBarItem();
    this.postTransferQueueState();

    return source;
  }

  private endManualTransfer(source?: vscode.CancellationTokenSource): void {
    if (source && this.activeTransferCancellationSource !== source) {
      source.dispose();
      return;
    }

    const activeSource = this.activeTransferCancellationSource;
    this.activeTransferCancellationSource = undefined;
    this.activeTransferConnectionId = undefined;
    this.activeTransferCancelling = false;
    activeSource?.dispose();
    this.postTransferQueueState();
  }

  private async cancelActiveTransfer(): Promise<void> {
    if (!this.activeTransferCancellationSource) {
      this.postStatus('No file transfer is currently running.');
      return;
    }

    this.activeTransferCancelling = true;
    if (this.activeTransferJob) {
      this.logTransferEvent(this.activeTransferJob, `${this.activeTransferJob.operation} cancellation requested.`);
    }
    this.setActiveTransferProgress('Cancelling...');
    this.postTransferQueueState();
    this.cancelPendingTransferConflict(this.activeTransferJob?.id);
    this.activeTransferCancellationSource.cancel();
  }

  private removeQueuedTransfer(payload: any): void {
    const transferId = String(payload?.transferId || '').trim();

    if (!transferId) {
      this.postStatus('Select a queued transfer to remove.');
      return;
    }

    const transferIndex = this.transferQueue.findIndex(item => item.id === transferId);

    if (transferIndex === -1) {
      this.postStatus('Queued transfer not found. It may have already started.');
      this.postTransferQueueState();
      return;
    }

    const [removedTransfer] = this.transferQueue.splice(transferIndex, 1);
    this.logTransferEvent(removedTransfer, `${removedTransfer.operation} removed from queue.`);
    this.postStatus(`${removedTransfer.operation} removed from queue.`);
    this.updateActiveTransferStatusBarItem();
    this.postTransferQueueState();
  }

  private postTransferQueueState(): void {
    const current = this.activeTransferJob
      ? this.buildTransferQueueItemSnapshot(
        this.activeTransferJob,
        this.activeTransferCancelling ? 'Cancelling' : this.activeTransferStatus,
        Boolean(this.activeTransferCancellationSource && !this.activeTransferCancelling)
      )
      : undefined;

    this.postMessage(RemoteEditOutboundMessageType.TransferQueueChanged, {
      current,
      pending: this.transferQueue.map(job => this.buildTransferQueueItemSnapshot(job, 'Waiting', false)),
      completed: this.completedTransfers.filter(item => this.sessions.hasConnection(item.connectionId))
    });
  }

  private buildTransferQueueItemSnapshot(
    job: QueuedTransferJob,
    status: TransferQueueItemSnapshot['status'],
    canCancel: boolean
  ): TransferQueueItemSnapshot {
    return {
      id: job.id,
      operation: job.operation,
      title: job.title,
      connectionId: job.connectionId,
      connection: job.connectionLabel,
      from: job.from,
      to: job.to,
      status,
      progress: job.progress || (status === 'Waiting' ? '--' : ''),
      canCancel,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      skippedItems: job.resultSummary?.skippedItems.slice(),
      failedItems: job.resultSummary?.failedItems.slice()
    };
  }

  private formatLocalDateTime(date: Date): string {
    const pad = (value: number): string => value.toString().padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private setActiveTransferStatus(status: 'Preparing' | 'Running' | 'Waiting'): void {
    this.activeTransferStatus = status;
    this.postTransferQueueState();
  }

  private setActiveTransferProgress(progress: string): void {
    if (!this.activeTransferJob) {
      return;
    }

    this.activeTransferJob.progress = progress;
    this.postTransferQueueState();
  }

  private setActiveTransferResultSummary(summary: TransferSummary): void {
    if (!this.activeTransferJob) {
      return;
    }

    this.activeTransferJob.resultSummary = {
      transferredFiles: summary.transferredFiles,
      skippedItems: summary.skippedItems.slice(),
      failedItems: summary.failedItems.slice()
    };
  }

  private async writeLocalFileSafely(localPath: string, content: Buffer): Promise<void> {
    const parentDirectory = path.dirname(localPath);
    const tempName = `.${path.basename(localPath)}.remoteedit-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    const tempPath = path.join(parentDirectory, tempName);

    try {
      await fs.writeFile(tempPath, content);
      await fs.rename(tempPath, localPath);
    } catch (error) {
      try {
        await fs.rm(tempPath, { force: true });
      } catch {
        // Ignore cleanup errors for local temporary files.
      }
      throw error;
    }
  }

  private async showTransferSummary(operation: 'Upload' | 'Download', summary: TransferSummary): Promise<void> {
    const details: string[] = [];

    if (summary.skippedItems.length) {
      details.push(`Skipped:\n${summary.skippedItems.slice(0, 20).join('\n')}${summary.skippedItems.length > 20 ? '\n...' : ''}`);
    }

    if (summary.failedItems.length) {
      details.push(`Failed:\n${summary.failedItems.slice(0, 20).join('\n')}${summary.failedItems.length > 20 ? '\n...' : ''}`);
    }

    if (!details.length) {
      return;
    }

    // This is an informational summary only. Do not await a normal VS Code notification here.
    // If the notification is hidden/dismissed or moved to the notification center, awaiting it can
    // keep the active transfer job open and leave the queue stuck in Preparing/Cancelling.
    const notificationMessage = this.buildTransferCompletionStatusText(operation, summary) +
      ` ${summary.skippedItems.length} skipped item(s), ${summary.failedItems.length} failed item(s).`;

    const notificationOptions = { modal: false, detail: details.join('\n\n') };

    if (this.getTransferCompletionStatus(summary) === 'Failed') {
      void vscode.window.showErrorMessage(notificationMessage, notificationOptions);
      return;
    }

    void vscode.window.showWarningMessage(notificationMessage, notificationOptions);
  }

  private joinRemoteRelativePath(baseRemotePath: string, relativePath: string): string {
    return this.toPosixRelativePath(relativePath).split('/').filter(Boolean).reduce(
      (current, part) => joinRemotePath(current, part),
      normalizeRemotePath(baseRemotePath)
    );
  }

  private toPosixRelativePath(value: string): string {
    return String(value || '').split(path.sep).join('/').replace(/^\/+/, '');
  }

  private formatTransferError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private getTransferCompletionStatus(summary: TransferSummary): TransferCompletionStatus {
    if (summary.failedItems.length > 0 && summary.transferredFiles === 0) {
      return 'Failed';
    }

    if (summary.failedItems.length > 0) {
      return 'Completed with errors';
    }

    if (summary.skippedItems.length > 0) {
      return 'Completed with skipped items';
    }

    return 'Completed';
  }

  private buildTransferCompletionStatusText(operation: 'Upload' | 'Download', summary: TransferSummary): string {
    const completionStatus = this.getTransferCompletionStatus(summary);

    if (completionStatus === 'Failed') {
      return `${operation} failed.`;
    }

    if (completionStatus === 'Completed with errors') {
      return `${operation} completed with errors.`;
    }

    if (completionStatus === 'Completed with skipped items') {
      return `${operation} completed with skipped items.`;
    }

    return `${operation} completed.`;
  }

  private buildTransferStatusMessage(operation: 'Upload' | 'Download', summary: TransferSummary): string {
    const transferredLabel = `${summary.transferredFiles} file(s)`;
    const skippedLabel = `${summary.skippedItems.length} skipped item(s)`;
    const failedLabel = `${summary.failedItems.length} failed item(s)`;
    const completionStatus = this.getTransferCompletionStatus(summary);

    if (completionStatus === 'Failed') {
      return `${operation} failed. ${failedLabel}.`;
    }

    if (completionStatus === 'Completed with errors') {
      return `${operation} completed with errors. ${transferredLabel} transferred, ${failedLabel}.`;
    }

    if (completionStatus === 'Completed with skipped items') {
      return `${operation} completed with skipped items. ${transferredLabel} transferred, ${skippedLabel}.`;
    }

    return operation === 'Upload' ? `Uploaded ${transferredLabel}.` : `Downloaded ${transferredLabel}.`;
  }

  private buildTransferResultProgress(summary: TransferSummary): string {
    return `${summary.transferredFiles} file(s) transferred, ${summary.skippedItems.length} skipped item(s), ${summary.failedItems.length} failed item(s).`;
  }


  private async requestRunRemoteCommand(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const commandId = String(payload?.commandId || '').trim() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const command = String(payload?.command || '').trim();
    const workingDirectory = normalizeRemotePath(String(payload?.workingDirectory || this.getActivePath() || '/'));

    if (!command) {
      this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
        commandId,
        error: 'Enter a command to run.'
      });
      return;
    }

    if (this.activeRemoteCommand) {
      this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
        commandId,
        error: 'Another remote command is already running.'
      });
      return;
    }

    const cancellationSource = new vscode.CancellationTokenSource();
    this.activeRemoteCommand = { id: commandId, connectionId, cancellationSource };
    const connection = this.sessions.getConnection(connectionId);
    const username = String(connection?.username || '').trim();
    const useSudo = this.sessions.isSudoModeEnabled(connectionId) && username.toLowerCase() !== 'root';

    this.postMessage(RemoteEditOutboundMessageType.RemoteCommandStarted, {
      commandId,
      connectionId,
      workingDirectory,
      command,
      useSudo
    });
    this.logInfo('Running remote command.', {
      Connection: connectionId,
      WorkingDirectory: workingDirectory,
      RunAs: useSudo ? 'root via sudo' : (username || 'SSH user'),
      Command: command
    });

    void this.executeRemoteCommandForWebview(commandId, connectionId, workingDirectory, command, cancellationSource);
  }

  private stopRemoteCommand(payload: any): void {
    const commandId = String(payload?.commandId || '').trim();
    const force = Boolean(payload?.force);

    if (!this.activeRemoteCommand) {
      return;
    }

    if (commandId && this.activeRemoteCommand.id !== commandId) {
      return;
    }

    this.activeRemoteCommand.stopMode = force ? 'force' : 'stop';

    if (force) {
      this.activeRemoteCommand.control?.forceKill();
      this.activeRemoteCommand.cancellationSource.cancel();
      return;
    }

    this.activeRemoteCommand.control?.stop();
    this.activeRemoteCommand.cancellationSource.cancel();
  }

  private async executeRemoteCommandForWebview(
    commandId: string,
    connectionId: string,
    workingDirectory: string,
    command: string,
    cancellationSource: vscode.CancellationTokenSource
  ): Promise<void> {
    let outputBuffer = '';
    let outputFlushTimer: NodeJS.Timeout | undefined;
    const commandExitCodes: number[] = [];

    const flushOutput = () => {
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = undefined;
      }

      if (!outputBuffer) {
        return;
      }

      const text = outputBuffer;
      outputBuffer = '';

      this.postMessage(RemoteEditOutboundMessageType.RemoteCommandOutput, {
        commandId,
        stream: 'stdout',
        text
      });
    };

    const scheduleOutputFlush = () => {
      if (outputFlushTimer) {
        return;
      }

      outputFlushTimer = setTimeout(flushOutput, 100);
    };

    const queueOutput = (chunk: string) => {
      if (!chunk) {
        return;
      }

      outputBuffer += chunk;
      scheduleOutputFlush();
    };

    try {
      const result = await this.sessions.runRemoteCommandStreaming(
        connectionId,
        workingDirectory,
        command,
        {
          onControl: control => {
            if (this.activeRemoteCommand?.id === commandId) {
              this.activeRemoteCommand.control = control;
            }
          },
          onCommand: logicalCommand => {
            flushOutput();
            this.postMessage(RemoteEditOutboundMessageType.RemoteCommandOutput, {
              commandId,
              kind: 'command',
              text: logicalCommand
            });
          },
          onCommandStatus: (index, code) => {
            commandExitCodes[index] = code;
            flushOutput();
            this.postMessage(RemoteEditOutboundMessageType.RemoteCommandOutput, {
              commandId,
              kind: 'commandStatus',
              code
            });
          },
          onStdout: chunk => queueOutput(chunk),
          onStderr: chunk => queueOutput(chunk)
        },
        cancellationSource.token
      );

      flushOutput();

      if (cancellationSource.token.isCancellationRequested) {
        this.logInfo('Remote command stopped.', {
          Connection: connectionId,
          WorkingDirectory: workingDirectory,
          Command: command
        });
        const stopMode = this.activeRemoteCommand?.id === commandId ? this.activeRemoteCommand.stopMode : undefined;
        this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          stopped: true,
          forceKilled: stopMode === 'force'
        });
        return;
      }

      this.logInfo('Remote command finished.', {
        Connection: connectionId,
        WorkingDirectory: workingDirectory,
        Command: command,
        ExitCode: String(result.code),
        Signal: result.signal || ''
      });

      this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
        commandId,
        code: result.code,
        signal: result.signal || '',
        commandCount: commandExitCodes.filter(code => typeof code === 'number').length,
        failedCommandCount: commandExitCodes.filter(code => typeof code === 'number' && code !== 0).length
      });
    } catch (error) {
      flushOutput();
      const message = error instanceof Error ? error.message : String(error);
      const stopped = cancellationSource.token.isCancellationRequested || isRemoteEditOperationCancelled(error) || message === 'Operation cancelled.';

      if (stopped) {
        this.logInfo('Remote command stopped.', {
          Connection: connectionId,
          WorkingDirectory: workingDirectory,
          Command: command
        });
        const stopMode = this.activeRemoteCommand?.id === commandId ? this.activeRemoteCommand.stopMode : undefined;
        this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          stopped: true,
          forceKilled: stopMode === 'force'
        });
      } else {
        this.logError('Remote command failed.', {
          Connection: connectionId,
          WorkingDirectory: workingDirectory,
          Command: command,
          Details: message
        });
        this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          error: message || 'Remote command failed.'
        });
      }
    } finally {
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = undefined;
      }
      if (this.activeRemoteCommand?.id === commandId) {
        this.activeRemoteCommand = undefined;
      }
      cancellationSource.dispose();
    }
  }

  private async requestChangeOwnerGroup(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    const entries = rawEntries
      .map((entry: any) => ({
        path: normalizeRemotePath(String(entry?.path || '')),
        name: String(entry?.name || '').trim(),
        type: String(entry?.type || ''),
        effectiveType: String(entry?.effectiveType || '')
      }))
      .filter((entry: any) => entry.path && entry.path !== '/' && entry.name !== '..');

    if (!entries.length) {
      throw new Error('Select one or more remote items to change owner/group.');
    }

    const owner = this.validateOwnerGroupName(String(payload?.owner || '').trim(), 'Owner');
    const group = this.validateOwnerGroupName(String(payload?.group || '').trim(), 'Group');
    const recursive = Boolean(payload?.recursive);

    if (!owner && !group) {
      throw new Error('Enter an owner, a group, or both.');
    }

    const targetLabel = this.formatOwnerGroupTargetLabel(owner, group);
    const itemLabel = entries.length === 1 ? (entries[0].name || entries[0].path) : `${entries.length} selected items`;
    const failures: string[] = [];
    let changedCount = 0;

    this.postBusy(true, `Changing owner/group for ${itemLabel}...`);

    for (const entry of entries) {
      const effectiveType = entry.effectiveType || entry.type;
      const recursiveForEntry = recursive && effectiveType === 'directory';

      try {
        await this.sessions.changeOwnerGroup(connectionId, entry.path, { owner, group, recursive: recursiveForEntry });
        changedCount += 1;
        this.logInfo('Changed remote owner/group.', {
          Target: targetLabel,
          Recursive: recursiveForEntry ? 'Yes' : 'No',
          Path: this.buildRemoteReference(entry.path)
        });
      } catch (error) {
        const message = this.formatOwnerGroupOperationError(error, connectionId);
        failures.push(`${entry.path}: ${message}`);
        this.logError('Could not change remote owner/group.', {
          Target: targetLabel,
          Recursive: recursiveForEntry ? 'Yes' : 'No',
          Path: this.buildRemoteReference(entry.path),
          Details: message
        });
      }
    }

    if (changedCount > 0) {
      await this.listDirectory(this.getActivePath());
    }

    if (failures.length) {
      const summary = `Owner/group change completed with errors: ${changedCount} succeeded, ${failures.length} failed.`;
      this.logWarn(summary, { Failed: failures.slice(0, 20).join('\n') + (failures.length > 20 ? '\n...' : '') });
      this.postBusy(false, summary);
      this.postError(`${summary} Check Output for details.`);
      return;
    }

    this.postBusy(false, `Changed owner/group for ${changedCount} item(s).`);
  }

  private validateOwnerGroupName(value: string, label: string): string {
    const trimmed = String(value || '').trim();

    if (!trimmed) {
      return '';
    }

    if (!/^[A-Za-z0-9_][A-Za-z0-9._@+-]*$/.test(trimmed)) {
      throw new Error(`${label} can contain letters, numbers, underscore, dot, dash, plus, and at sign, and must not start with a dash.`);
    }

    return trimmed;
  }

  private formatOwnerGroupTargetLabel(owner: string, group: string): string {
    if (owner && group) {
      return `${owner}:${group}`;
    }

    return owner || group;
  }

  private formatOwnerGroupOperationError(error: unknown, connectionId: string): string {
    const message = error instanceof Error ? error.message : String(error);

    if (!this.sessions.isSudoModeEnabled(connectionId) && /permission denied|operation not permitted|not owner/i.test(message)) {
      return `${message} Try enabling Sudo Mode.`;
    }

    return message;
  }

  private async requestSetPermissions(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const entries = this.normalizePermissionEntries(payload);

    if (!entries.length) {
      throw new Error('Select one or more remote items to update permissions.');
    }

    const firstEntry = entries[0];
    const hasDirectory = entries.some(entry => entry.effectiveType === 'directory' || entry.type === 'directory');
    const hasFile = entries.some(entry => entry.effectiveType === 'file' || entry.type === 'file' || entry.type === 'link');
    const isMixed = hasDirectory && hasFile;
    const firstIsDirectory = firstEntry.effectiveType === 'directory' || firstEntry.type === 'directory';
    const permissionState = parsePermissionString(firstEntry.permissions, firstIsDirectory);
    const initialMode = calculateModeFromPermissionState(permissionState);
    const result = await this.openSetPermissionsPanel({
      entryName: firstEntry.name || firstEntry.path.split('/').filter(Boolean).pop() || firstEntry.path,
      entryType: firstEntry.effectiveType || firstEntry.type,
      remotePath: firstEntry.path,
      currentPermissions: firstEntry.permissions,
      isDirectory: firstIsDirectory,
      initialMode,
      permissionState,
      selectedCount: entries.length,
      hasFile,
      hasDirectory,
      isMixed
    });

    if (!result) {
      this.postStatus('Set permissions cancelled.');
      return;
    }

    const itemLabel = entries.length === 1 ? (firstEntry.name || firstEntry.path) : `${entries.length} selected items`;
    const failures: string[] = [];
    let changedCount = 0;

    this.postBusy(true, `Setting permissions ${result.mode} on ${itemLabel}...`);

    for (const entry of entries) {
      const effectiveType = entry.effectiveType || entry.type;
      const recursiveForEntry = result.recursive && effectiveType === 'directory';

      try {
        await this.sessions.chmod(connectionId, entry.path, result.mode, { recursive: recursiveForEntry });
        changedCount += 1;
        this.logInfo('Set remote permissions.', {
          Mode: result.mode,
          Recursive: recursiveForEntry ? 'Yes' : 'No',
          Path: this.buildRemoteReference(entry.path)
        });
      } catch (error) {
        const message = this.formatPermissionOperationError(error, connectionId);
        failures.push(`${entry.path}: ${message}`);
        this.logError('Could not set remote permissions.', {
          Mode: result.mode,
          Recursive: recursiveForEntry ? 'Yes' : 'No',
          Path: this.buildRemoteReference(entry.path),
          Details: message
        });
      }
    }

    if (changedCount > 0) {
      await this.listDirectory(this.getActivePath());
    }

    if (failures.length) {
      const summary = `Permissions update completed with errors: ${changedCount} succeeded, ${failures.length} failed.`;
      this.logWarn(summary, { Failed: failures.slice(0, 20).join('\n') + (failures.length > 20 ? '\n...' : '') });
      this.postBusy(false, summary);
      this.postError(`${summary} Check Output for details.`);
      return;
    }

    this.postBusy(false, `Permissions set to ${result.mode} for ${changedCount} item(s).`);
  }

  private normalizePermissionEntries(payload: any): Array<{ path: string; name: string; type: string; effectiveType: string; permissions: string }> {
    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [payload];

    return rawEntries
      .map((entry: any) => ({
        path: normalizeRemotePath(String(entry?.path || '')),
        name: String(entry?.name || '').trim(),
        type: String(entry?.type || ''),
        effectiveType: String(entry?.effectiveType || ''),
        permissions: String(entry?.permissions || '')
      }))
      .filter((entry: { path: string; name: string }) => entry.path && entry.path !== '/' && entry.name !== '..');
  }

  private formatPermissionOperationError(error: unknown, connectionId: string): string {
    const message = error instanceof Error ? error.message : String(error);

    if (!this.sessions.isSudoModeEnabled(connectionId) && /permission denied|operation not permitted|not owner/i.test(message)) {
      return `${message} Try enabling Sudo Mode.`;
    }

    return message;
  }

  private openSetPermissionsPanel(options: SetPermissionsPanelOptions): Promise<SetPermissionsDialogResult | undefined> {
    this.cancelPermissionsDialog();

    return new Promise<SetPermissionsDialogResult | undefined>(resolve => {
      this.pendingPermissionsDialogResolve = resolve;
      this.postMessage(RemoteEditOutboundMessageType.ShowPermissionsDialog, {
        entryName: options.entryName,
        entryType: options.entryType,
        remotePath: options.remotePath,
        currentPermissions: options.currentPermissions,
        isDirectory: options.isDirectory,
        initialMode: options.initialMode,
        permissionState: options.permissionState,
        selectedCount: options.selectedCount || 1,
        hasFile: Boolean(options.hasFile),
        hasDirectory: Boolean(options.hasDirectory),
        isMixed: Boolean(options.isMixed)
      });
    });
  }

  private applyPermissionsFromDialog(payload: any): void {
    const mode = String(payload?.mode || '').trim();

    if (!/^[0-7]{4}$/.test(mode)) {
      this.postMessage(RemoteEditOutboundMessageType.PermissionsValidationError, {
        message: 'Enter a valid octal mode using 3 or 4 digits from 0 to 7.'
      });
      return;
    }

    this.finishPermissionsDialog({ mode, recursive: Boolean(payload?.recursive) });
  }

  private cancelPermissionsDialog(): void {
    this.finishPermissionsDialog(undefined);
  }

  private resolvePendingPermissionsDialog(): void {
    const resolve = this.pendingPermissionsDialogResolve;

    if (!resolve) {
      return;
    }

    this.pendingPermissionsDialogResolve = undefined;
    resolve(undefined);
  }

  private finishPermissionsDialog(result?: SetPermissionsDialogResult): void {
    const resolve = this.pendingPermissionsDialogResolve;

    if (!resolve) {
      return;
    }

    this.pendingPermissionsDialogResolve = undefined;
    resolve(result);
    this.postMessage(RemoteEditOutboundMessageType.HidePermissionsDialog, {});
  }

  private getActivePath(): string {
    const activeConnectionId = this.state.getActiveConnectionId();

    if (!activeConnectionId) {
      return '/';
    }

    return this.state.getCurrentPath(activeConnectionId, this.sessions.getConnection(activeConnectionId)?.startPath || '/');
  }

  private requireActiveConnectionId(): string {
    const activeConnectionId = this.state.getActiveConnectionId();

    if (!activeConnectionId || !this.sessions.hasConnection(activeConnectionId)) {
      throw new Error('Connect to a host before browsing or opening remote files.');
    }

    return activeConnectionId;
  }


  private normalizeArchiveFormat(format: string): ArchiveFormat | '' {
    switch (format) {
      case 'tar.gz':
      case 'tar.bz2':
      case 'tar.xz':
      case 'tar.Z':
        return format;
      default:
        return '';
    }
  }

  private normalizeArchiveName(value: string, format: ArchiveFormat): string {
    const extension = `.${format}`;
    const trimmed = String(value || '').trim();

    if (!trimmed) {
      return '';
    }

    return trimmed.endsWith(extension) ? trimmed : `${trimmed}${extension}`;
  }

  private async buildDefaultArchiveName(
    connectionId: string,
    baseDirectory: string,
    entries: Array<{ name: string }>,
    format: ArchiveFormat
  ): Promise<string> {
    const baseName = this.buildArchiveBaseName(entries);
    const extension = `.${format}`;

    for (let index = 0; index <= 999; index += 1) {
      const candidate = `${index === 0 ? baseName : `${baseName}-${index}`}${extension}`;
      const existingTarget = await this.tryStatRemotePath(connectionId, joinRemotePath(baseDirectory, candidate));

      if (!existingTarget && !entries.some(entry => entry.name === candidate)) {
        return candidate;
      }
    }

    return `${baseName}-${Date.now()}${extension}`;
  }

  private buildArchiveBaseName(entries: Array<{ name: string }>): string {
    if (entries.length !== 1) {
      return 'archive';
    }

    const rawName = entries[0].name || 'archive';
    const withoutKnownArchiveExtension = rawName
      .replace(/\.tar\.gz$/i, '')
      .replace(/\.tar\.bz2$/i, '')
      .replace(/\.tar\.xz$/i, '')
      .replace(/\.tar\.z$/i, '');

    return withoutKnownArchiveExtension || rawName || 'archive';
  }


  private buildRemoteReference(remotePath: string): string {
    const activeConnectionId = this.state.getActiveConnectionId();

    if (!activeConnectionId) {
      return normalizeRemotePath(remotePath);
    }

    const connection = this.sessions.getConnection(activeConnectionId);

    if (!connection) {
      return `${activeConnectionId}:${normalizeRemotePath(remotePath)}`;
    }

    return `[${connection.name}] ${connection.username}@${connection.host}:${normalizeRemotePath(remotePath)}`;
  }

  private getActiveUriAuthority(): string | undefined {
    const activeConnectionId = this.state.getActiveConnectionId();

    if (!activeConnectionId) {
      return undefined;
    }

    return this.sessions.getConnection(activeConnectionId)?.host;
  }

  private updatePanelTitle(): void {
    if (this.panel) {
      this.panel.title = 'RemoteEdit';
    }
  }

  private formatError(messageType: string, payload: any, details: string): string {
    if (messageType === RemoteEditIncomingMessageType.Connect) {
      const host = String(payload?.host || '').trim() || 'remote host';
      const port = String(payload?.port || '22').trim() || '22';
      const username = String(payload?.username || '').trim();
      const authType = String(payload?.authType || 'password') === 'privateKey' ? 'private key' : 'password';
      const target = username ? `${username}@${host}:${port}` : `${host}:${port}`;
      return `Connection failed for ${target} using ${authType} authentication. Check host, port, credentials, VPN/firewall, SSH/SFTP access, and private key path/passphrase when applicable. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.SaveConnection) {
      return `Could not save the connection profile. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.DeleteConnection) {
      return `Could not delete the connection profile. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.ListDirectory || messageType === RemoteEditIncomingMessageType.OpenPath) {
      const rawPath = String(payload?.path || this.getActivePath() || '/').trim() || '/';
      const remotePath = normalizeRemotePath(rawPath);
      return `Remote path not found or not accessible: ${remotePath}. Check the path and permissions. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.OpenEntry) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : String(payload?.name || 'selected entry');
      return `Could not open remote entry: ${entryPath}. Check the path, file type, and permissions. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestRenameEntry) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not rename remote entry: ${entryPath}. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestMakeCopy) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not make a copy of remote file: ${entryPath}. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestCalculateChecksums) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not calculate checksums for remote file: ${entryPath}. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestDeleteEntry) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not delete remote entry: ${entryPath}. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestUploadEntries) {
      return `Could not upload selected item(s). Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestDownloadEntries) {
      return `Could not download selected item(s). Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestSetPermissions) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not set permissions on remote entry: ${entryPath}. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestChangeOwnerGroup) {
      return `Could not change owner/group for selected remote item(s). Details: ${details}`;
    }

    return details;
  }

  private logInfo(message: string, details?: OutputLogDetails): void {
    appendOutputLog(this.output, 'INFO', message, details);
  }

  private logWarn(message: string, details?: OutputLogDetails): void {
    appendOutputLog(this.output, 'WARN', message, details);
  }

  private logError(message: string, details?: OutputLogDetails): void {
    appendOutputLog(this.output, 'ERROR', message, details);
  }

  private logDebug(message: string, details?: OutputLogDetails): void {
    appendOutputLog(this.output, 'DEBUG', message, details);
  }

  private logTransferEvent(job: QueuedTransferJob, message: string, details?: OutputLogDetails): void {
    this.logInfo(message, {
      Operation: job.operation,
      Title: job.title,
      From: job.from,
      To: job.to,
      Connection: job.connectionId,
      ...details
    });
  }

  private logActiveTransferEvent(operation: 'Upload' | 'Download', message: string, details?: OutputLogDetails): void {
    if (this.activeTransferJob?.operation === operation) {
      this.logTransferEvent(this.activeTransferJob, message, details);
      return;
    }

    this.logInfo(message, { Operation: operation, ...details });
  }

  private async showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    if (this.isDisposed || !this.panel) {
      return false;
    }

    const requestId = `${Date.now()}-${++this.confirmDialogSequence}`;

    return new Promise<boolean>(resolve => {
      this.pendingConfirmDialogs.set(requestId, resolve);
      this.postMessage(RemoteEditOutboundMessageType.ShowConfirmDialog, {
        requestId,
        title: options.title,
        message: options.message,
        details: options.details || '',
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel || 'Cancel',
        danger: Boolean(options.danger)
      });
    });
  }

  private handleConfirmDialogResponse(payload: any): void {
    const requestId = String(payload?.requestId || '');
    const resolve = this.pendingConfirmDialogs.get(requestId);

    if (!resolve) {
      return;
    }

    this.pendingConfirmDialogs.delete(requestId);
    resolve(Boolean(payload?.confirmed));
  }

  private resolvePendingConfirmDialogs(): void {
    for (const resolve of this.pendingConfirmDialogs.values()) {
      resolve(false);
    }

    this.pendingConfirmDialogs.clear();
  }

  private postStatus(message: string): void {
    this.postMessage(RemoteEditOutboundMessageType.Status, { message });
  }

  private postStatusCopyFeedback(message: string): void {
    this.postMessage(RemoteEditOutboundMessageType.StatusCopyFeedback, { message });
  }

  private postBusy(isBusy: boolean, message: string, cancelAction: boolean | 'transfer' | 'connection' = false, cancelLabel?: string): void {
    const action = cancelAction === true ? 'transfer' : (cancelAction || '');
    this.postMessage(RemoteEditOutboundMessageType.Busy, {
      isBusy,
      message,
      canCancelTransfer: action === 'transfer',
      cancelAction: action,
      cancelLabel: cancelLabel || (action === 'transfer' ? 'Cancel Transfer' : 'Cancel')
    });
  }

  private postError(message: string): void {
    this.postMessage(RemoteEditOutboundMessageType.Error, { message });
  }

  private postMessage(type: RemoteEditOutboundMessageType, payload: any): void {
    if (this.isDisposed || !this.panel) {
      return;
    }

    void this.panel.webview.postMessage({ type, payload }).then(
      undefined,
      error => {
        const message = error instanceof Error ? error.message : String(error);
        this.logDebug('Ignored WebView update after panel disposal.', { Details: message });
      }
    );
  }

  dispose(): void {
    this.isDisposed = true;
    RemoteEditPanel.currentPanel = undefined;

    this.stopRemoteCommand({});
    this.resolvePendingPermissionsDialog();
    this.resolvePendingConfirmDialogs();
    this.cancelPendingTransferConflict();
    this.clearAllQueuedTransfers();
    this.clearAllCompletedTransfers();
    this.endManualTransfer();
    this.disposePanelDisposables();

    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    return renderRemoteEditHtml(webview, getNonce());
  }
}
