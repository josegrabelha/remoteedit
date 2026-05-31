import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/ConnectionManager';
import { buildRemoteEditUri } from '../filesystem/RemoteEditFileSystemProvider';
import { dirnameRemotePath, joinRemotePath, normalizeRemotePath, RemoteEntry, SftpSessionManager, type RemoteChecksumSummary, type RemoteChecksumValue } from '../ssh/SftpSessionManager';
import { buildDeleteEntriesConfirmationDetail } from '../utils/deleteConfirmationUtils';
import { formatBytes, isRemoteEditOperationCancelled, throwIfCancelled, withRemoteEditProgress, type RemoteEditProgressReporter } from '../utils/progressUtils';
import { appendOutputLog, type OutputLogDetails } from '../utils/outputLogger';
import { getNonce } from '../utils/webviewUtils';
import { renderRemoteEditHtml } from './RemoteEditHtml';
import { handleRemoteEditPanelMessage } from './RemoteEditPanelHandlers';
import { RemoteEditIncomingMessageType, RemoteEditOutboundMessageType, type RemoteEditWebviewMessage } from './RemoteEditPanelMessages';
import { RemoteEditPanelState } from './RemoteEditPanelState';
import { calculateModeFromPermissionState, parsePermissionString, type SetPermissionsPanelOptions } from './RemoteEditPermissions';


type TransferConflictDecision = 'overwrite' | 'skip' | 'cancel';
type TransferCompletionStatus = 'Completed' | 'Cancelled' | 'Failed';

interface TransferConflictState {
  overwriteAll: boolean;
  skipAll: boolean;
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
  run: () => Promise<TransferCompletionStatus>;
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
  private readonly transferQueue: QueuedTransferJob[] = [];
  private readonly completedTransfers: TransferQueueItemSnapshot[] = [];
  private readonly maxCompletedTransfersPerConnection = 50;
  private runningTransfers = 0;
  private readonly maxConcurrentTransfers = 1;
  private activeConnectionCancellationSource: vscode.CancellationTokenSource | undefined;
  private readonly transferCancelStatusBarItem: vscode.StatusBarItem;
  private pendingPermissionsDialogResolve: ((mode?: string) => void) | undefined;

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

    this.transferCancelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    this.transferCancelStatusBarItem.text = '$(x) Cancel Transfer';
    this.transferCancelStatusBarItem.tooltip = 'Cancel the active RemoteEdit transfer';
    this.transferCancelStatusBarItem.command = 'remoteedit.cancelTransfer';

    this.disposables.push(
      this.transferCancelStatusBarItem,
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
    this.resolvePendingPermissionsDialog();
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
        },
        saveConnection: payload => this.saveConnection(payload),
        pickPrivateKeyPath: () => this.pickPrivateKeyPath(),
        deleteConnection: payload => this.deleteConnection(payload),
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
        cancelTransfer: () => this.cancelActiveTransfer(),
        removeQueuedTransfer: payload => this.removeQueuedTransfer(payload),
        requestSetPermissions: payload => this.requestSetPermissions(payload),
        applyPermissions: payload => this.applyPermissionsFromDialog(payload),
        cancelPermissions: () => this.cancelPermissionsDialog(),
        showOutput: () => this.output.show(true),
        copyRemotePath: payload => this.copyRemotePath(payload),
        copyStatus: payload => this.copyStatus(payload),
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
      this.postError(friendlyMessage);
    }
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
    this.postBusy(true, 'Saving bookmarked connection...');
    const profile = await this.connectionManager.saveProfile(payload || {});
    await this.sendProfiles(profile.id);
    this.postBusy(false, `Saved bookmarked connection: ${profile.name}.`);
    this.logInfo('Saved bookmarked connection.', { Name: profile.name, Target: `${profile.username ? profile.username + '@' : ''}${profile.host}:${profile.port}` });
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

  private async deleteConnection(payload: any): Promise<void> {
    const profileId = String(payload?.id || '').trim();

    if (!profileId) {
      throw new Error('Select a bookmarked connection to remove.');
    }

    const profile = await this.connectionManager.getProfile(profileId);

    if (!profile) {
      await this.sendProfiles();
      throw new Error('The selected bookmarked connection no longer exists.');
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Remove bookmarked connection "${profile.name}"? Stored secrets for this connection will also be removed.`,
      { modal: true },
      'Remove'
    );

    if (confirmation !== 'Remove') {
      this.postBusy(false, 'Remove canceled.');
      return;
    }

    this.postBusy(true, 'Removing bookmarked connection...');

    if (this.sessions.hasConnection(profileId)) {
      await this.disconnect(profileId);
    }

    await this.connectionManager.deleteProfile(profileId);
    await this.sendProfiles('');
    this.postMessage(RemoteEditOutboundMessageType.ConnectionFormCleared, {});
    this.postBusy(false, `Removed bookmarked connection: ${profile.name}.`);
    this.logInfo('Removed bookmarked connection.', { Name: profile.name, ProfileId: profileId });
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
    if (!connectionId) {
      this.postStatus('No active connection.');
      return;
    }

    const connection = this.sessions.getConnection(connectionId);
    const removedQueuedTransfers = this.clearQueuedTransfersForConnection(connectionId);
    this.clearCompletedTransfersForConnection(connectionId);

    if (this.activeTransferConnectionId === connectionId) {
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
      throw new Error('Select a remote file to view/edit.');
    }

    const resolvedEntries: Array<{ name: string; type: string; effectiveType: string; path: string; resolvedType: string }> = [];

    for (const entry of entries) {
      resolvedEntries.push({
        ...entry,
        resolvedType: await this.resolveOpenableEntryType(entry.path, entry.type, entry.effectiveType)
      });
    }

    if (resolvedEntries.length === 1 && resolvedEntries[0].resolvedType === 'directory') {
      await this.listDirectory(resolvedEntries[0].path);
      return;
    }

    const unsupportedEntry = resolvedEntries.find(entry => entry.resolvedType !== 'file');

    if (unsupportedEntry) {
      throw new Error('Only files can be opened when multiple items are selected.');
    }

    this.postBusy(true, resolvedEntries.length === 1
      ? `Opening ${resolvedEntries[0].name || resolvedEntries[0].path}...`
      : `Opening ${resolvedEntries.length} remote files...`);

    const connectionId = this.requireActiveConnectionId();
    const failedEntries: Array<{ path: string; error: string }> = [];

    try {
      await withRemoteEditProgress(
        resolvedEntries.length === 1 ? 'Opening remote file...' : `Opening ${resolvedEntries.length} remote files...`,
        async (token, progress) => {
          for (const entry of resolvedEntries) {
            throwIfCancelled(token, 'Opening cancelled.');

            const uri = buildRemoteEditUri(connectionId, entry.path, this.getActiveUriAuthority());

            try {
              await this.sessions.prepareFileForOpen(connectionId, entry.path, token, progress);
              throwIfCancelled(token, 'Opening cancelled.');
              await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
              this.logInfo('Opened remote file.', { Path: this.buildRemoteReference(entry.path) });
            } catch (error) {
              if (isRemoteEditOperationCancelled(error)) {
                throw error;
              }

              const message = error instanceof Error ? error.message : String(error);
              failedEntries.push({ path: entry.path, error: message });
              this.logWarn('Failed to open remote file.', { Path: this.buildRemoteReference(entry.path), Details: message });
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
      await vscode.window.showWarningMessage(
        `Opened ${resolvedEntries.length - failedEntries.length} of ${resolvedEntries.length} remote file(s).`,
        { modal: false, detail }
      );
    }

    this.postBusy(false, failedEntries.length
      ? `Opened ${resolvedEntries.length - failedEntries.length} of ${resolvedEntries.length} remote file(s).`
      : resolvedEntries.length === 1
        ? `Opened ${resolvedEntries[0].name || resolvedEntries[0].path}.`
        : `Opened ${resolvedEntries.length} remote files.`);
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

      const confirmation = await vscode.window.showWarningMessage(
        `Overwrite remote file '${trimmedName}'?`,
        { modal: true, detail: newPath },
        'Overwrite'
      );

      if (confirmation !== 'Overwrite') {
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
    const confirmation = await vscode.window.showWarningMessage(
      `Delete remote ${kind} '${entryName}'? This action cannot be undone.`,
      { modal: true, detail: remotePath },
      'Delete'
    );

    if (confirmation !== 'Delete') {
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
    const confirmation = await vscode.window.showWarningMessage(
      `Delete ${entries.length} remote items? This action cannot be undone.`,
      { modal: true, detail },
      'Delete'
    );

    if (confirmation !== 'Delete') {
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


  private async requestUploadEntries(_payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const targetDirectory = normalizeRemotePath(this.getActivePath());

    const selectedUris = await vscode.window.showOpenDialog({
      title: 'RemoteEdit: Upload Files or Folders',
      openLabel: 'Upload',
      canSelectFiles: true,
      canSelectFolders: true,
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
      run: () => this.runUploadTransfer(connectionId, targetDirectory, selectedUris)
    });
  }

  private async runUploadTransfer(connectionId: string, targetDirectory: string, selectedUris: readonly vscode.Uri[]): Promise<TransferCompletionStatus> {
    this.postStatus('Preparing upload...');
    this.setActiveTransferProgress('Preparing upload...');

    const summary: TransferSummary = { transferredFiles: 0, skippedItems: [], failedItems: [] };
    const items = await this.collectUploadTransferItems(selectedUris, targetDirectory, summary);

    if (!items.length) {
      this.logActiveTransferEvent('Upload', 'Upload finished with no uploadable files.', { SkippedItems: summary.skippedItems.length });
      this.postStatus(summary.skippedItems.length ? 'No uploadable files found. Some items were skipped.' : 'No uploadable files found.');
      await this.showTransferSummary('Upload', summary);
      return 'Completed';
    }

    try {
      await this.prepareUploadConflicts(connectionId, items, summary);
    } catch (error) {
      if (this.formatTransferError(error) === 'Upload cancelled.') {
        this.logActiveTransferEvent('Upload', 'Upload cancelled during conflict resolution.', { SkippedItems: summary.skippedItems.length });
        this.postStatus('Upload cancelled.');
        return 'Cancelled';
      }
      throw error;
    }

    const remainingItems = items.filter(item => !summary.skippedItems.includes(item.relativePath));

    if (!remainingItems.length) {
      this.logActiveTransferEvent('Upload', 'Upload skipped.', { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
      this.postStatus('Upload skipped.');
      await this.showTransferSummary('Upload', summary);
      return 'Completed';
    }

    const uploadFileItems = remainingItems.filter(item => item.kind === 'file');
    const totalBytes = uploadFileItems.reduce((sum, item) => sum + item.size, 0);
    const aggregateState: AggregateTransferState = { completedBytes: 0, totalBytes };

    let uploadCancelled = false;
    this.postStatus('Uploading...');
    const transferCancellationSource = this.beginManualTransfer('Upload', connectionId);
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
      this.endManualTransfer(transferCancellationSource);
      await this.listDirectory(targetDirectory);
    }

    if (uploadCancelled) {
      this.postStatus('Upload cancelled.');
      await this.showTransferSummary('Upload', summary);
      return 'Cancelled';
    }

    this.logActiveTransferEvent('Upload', 'Upload completed.', { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
    this.postStatus(`Uploaded ${summary.transferredFiles} file(s).`);
    await this.showTransferSummary('Upload', summary);
    return 'Completed';
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
      run: () => this.runDownloadTransfer(connectionId, entries, targetFolder)
    });
  }

  private async runDownloadTransfer(
    connectionId: string,
    entries: Array<{ name: string; type: string; effectiveType: string; path: string }>,
    targetFolder: string
  ): Promise<TransferCompletionStatus> {
    this.postStatus('Preparing download...');
    this.setActiveTransferProgress('Preparing download...');

    const summary: TransferSummary = { transferredFiles: 0, skippedItems: [], failedItems: [] };
    const items: DownloadTransferItem[] = [];

    for (const entry of entries) {
      await this.collectDownloadTransferItems(connectionId, entry, targetFolder, summary, items);
    }

    if (!items.length) {
      this.logActiveTransferEvent('Download', 'Download finished with no downloadable files.', { SkippedItems: summary.skippedItems.length });
      this.postStatus(summary.skippedItems.length ? 'No downloadable files found. Some items were skipped.' : 'No downloadable files found.');
      await this.showTransferSummary('Download', summary);
      return 'Completed';
    }

    try {
      await this.prepareDownloadConflicts(items, summary);
    } catch (error) {
      if (this.formatTransferError(error) === 'Download cancelled.') {
        this.logActiveTransferEvent('Download', 'Download cancelled during conflict resolution.', { SkippedItems: summary.skippedItems.length });
        this.postStatus('Download cancelled.');
        return 'Cancelled';
      }
      throw error;
    }

    const remainingItems = items.filter(item => !summary.skippedItems.includes(item.relativePath));

    if (!remainingItems.length) {
      this.logActiveTransferEvent('Download', 'Download skipped.', { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
      this.postStatus('Download skipped.');
      await this.showTransferSummary('Download', summary);
      return 'Completed';
    }

    const downloadFileItems = remainingItems.filter(item => item.kind === 'file');
    const totalBytes = downloadFileItems.reduce((sum, item) => sum + item.size, 0);
    const aggregateState: AggregateTransferState = { completedBytes: 0, totalBytes };

    let downloadCancelled = false;
    this.postStatus('Downloading...');
    const transferCancellationSource = this.beginManualTransfer('Download', connectionId);
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
      this.endManualTransfer(transferCancellationSource);
    }

    if (downloadCancelled) {
      this.postStatus('Download cancelled.');
      await this.showTransferSummary('Download', summary);
      return 'Cancelled';
    }

    this.logActiveTransferEvent('Download', 'Download completed.', { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length });
    this.postStatus(`Downloaded ${summary.transferredFiles} file(s).`);
    await this.showTransferSummary('Download', summary);
    return 'Completed';
  }

  private async collectUploadTransferItems(
    selectedUris: readonly vscode.Uri[],
    targetDirectory: string,
    summary: TransferSummary
  ): Promise<UploadTransferItem[]> {
    const items: UploadTransferItem[] = [];

    for (const uri of selectedUris) {
      const localPath = uri.fsPath;
      const baseName = path.basename(localPath);
      await this.collectUploadPath(localPath, baseName, targetDirectory, summary, items);
    }

    return items;
  }

  private async collectUploadPath(
    localPath: string,
    relativePath: string,
    targetDirectory: string,
    summary: TransferSummary,
    items: UploadTransferItem[]
  ): Promise<void> {
    const stats = await fs.lstat(localPath);

    if (stats.isSymbolicLink()) {
      summary.skippedItems.push(`${relativePath}: skipped symbolic link`);
      return;
    }

    const remotePath = this.joinRemoteRelativePath(targetDirectory, relativePath);

    if (stats.isDirectory()) {
      items.push({ kind: 'directory', localPath, remotePath, relativePath, size: 0 });
      const children = await fs.readdir(localPath);
      for (const child of children) {
        await this.collectUploadPath(path.join(localPath, child), path.posix.join(this.toPosixRelativePath(relativePath), child), targetDirectory, summary, items);
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
    items: DownloadTransferItem[]
  ): Promise<void> {
    const relativePath = this.toPosixRelativePath(entry.name || path.posix.basename(entry.path));
    await this.collectDownloadPath(connectionId, entry.path, relativePath, targetFolder, entry.type, entry.effectiveType, summary, items);
  }

  private async collectDownloadPath(
    connectionId: string,
    remotePath: string,
    relativePath: string,
    targetFolder: string,
    entryType: string | undefined,
    effectiveType: string | undefined,
    summary: TransferSummary,
    items: DownloadTransferItem[]
  ): Promise<void> {
    if (entryType === 'link') {
      summary.skippedItems.push(`${relativePath}: skipped symbolic link`);
      return;
    }

    const resolvedType = effectiveType === 'file' || effectiveType === 'directory'
      ? effectiveType
      : entryType === 'file' || entryType === 'directory'
        ? entryType
        : (await this.sessions.stat(connectionId, remotePath)).type;

    const localPath = path.join(targetFolder, ...this.toPosixRelativePath(relativePath).split('/').filter(Boolean));

    if (resolvedType === 'directory') {
      items.push({ kind: 'directory', remotePath, localPath, relativePath: this.toPosixRelativePath(relativePath), size: 0 });
      const children = await this.sessions.listDirectory(connectionId, remotePath);
      for (const child of children) {
        if (child.name === '..') {
          continue;
        }
        await this.collectDownloadPath(
          connectionId,
          child.path,
          path.posix.join(this.toPosixRelativePath(relativePath), child.name),
          targetFolder,
          child.type,
          child.effectiveType,
          summary,
          items
        );
      }
      return;
    }

    if (resolvedType === 'file') {
      const stats = await this.sessions.stat(connectionId, remotePath);
      items.push({ kind: 'file', remotePath, localPath, relativePath: this.toPosixRelativePath(relativePath), size: Number(stats.size || 0) });
      return;
    }

    summary.skippedItems.push(`${relativePath}: skipped unsupported remote item`);
  }

  private async prepareUploadConflicts(connectionId: string, items: UploadTransferItem[], summary: TransferSummary): Promise<void> {
    const conflictState: TransferConflictState = { overwriteAll: false, skipAll: false };
    const fileItems = items.filter(item => item.kind === 'file');
    const hasMultipleFiles = fileItems.length > 1;

    for (const item of fileItems) {
      let stats: Awaited<ReturnType<SftpSessionManager['stat']>> | undefined;
      try {
        stats = await this.sessions.stat(connectionId, item.remotePath);
      } catch {
        continue;
      }

      if (stats.type === 'directory') {
        summary.skippedItems.push(`${item.relativePath}: skipped because a remote directory already exists at the target path`);
        continue;
      }

      const decision = await this.resolveTransferConflict('Upload', item.relativePath, hasMultipleFiles, conflictState);
      if (decision === 'cancel') {
        throw new Error('Upload cancelled.');
      }
      if (decision === 'skip') {
        summary.skippedItems.push(item.relativePath);
      }
    }
  }

  private async prepareDownloadConflicts(items: DownloadTransferItem[], summary: TransferSummary): Promise<void> {
    const conflictState: TransferConflictState = { overwriteAll: false, skipAll: false };
    const fileItems = items.filter(item => item.kind === 'file');
    const hasMultipleFiles = fileItems.length > 1;

    for (const item of fileItems) {
      try {
        const stats = await fs.stat(item.localPath);
        if (stats.isDirectory()) {
          summary.skippedItems.push(`${item.relativePath}: skipped because a local directory already exists at the target path`);
          continue;
        }
      } catch {
        continue;
      }

      const decision = await this.resolveTransferConflict('Download', item.relativePath, hasMultipleFiles, conflictState);
      if (decision === 'cancel') {
        throw new Error('Download cancelled.');
      }
      if (decision === 'skip') {
        summary.skippedItems.push(item.relativePath);
      }
    }
  }

  private async resolveTransferConflict(
    operation: 'Upload' | 'Download',
    relativePath: string,
    hasMultipleFiles: boolean,
    state: TransferConflictState
  ): Promise<TransferConflictDecision> {
    if (state.overwriteAll) {
      return 'overwrite';
    }

    if (state.skipAll) {
      return 'skip';
    }

    const choices = hasMultipleFiles
      ? ['Overwrite', 'Skip', 'Overwrite All', 'Skip All', 'Cancel']
      : ['Overwrite', 'Cancel'];
    this.logActiveTransferEvent(operation, `${operation} conflict detected.`, { Item: relativePath });
    const selected = await vscode.window.showWarningMessage(
      `${operation} conflict: '${relativePath}' already exists. Choose how RemoteEdit should handle this file.`,
      ...choices
    );

    if (selected === 'Overwrite') {
      this.logActiveTransferEvent(operation, `${operation} conflict decision: overwrite.`, { Item: relativePath });
      return 'overwrite';
    }
    if (selected === 'Skip') {
      this.logActiveTransferEvent(operation, `${operation} conflict decision: skip.`, { Item: relativePath });
      return 'skip';
    }
    if (selected === 'Overwrite All') {
      state.overwriteAll = true;
      this.logActiveTransferEvent(operation, `${operation} conflict decision: overwrite all.`, { Item: relativePath });
      return 'overwrite';
    }
    if (selected === 'Skip All') {
      state.skipAll = true;
      this.logActiveTransferEvent(operation, `${operation} conflict decision: skip all.`, { Item: relativePath });
      return 'skip';
    }
    if (selected === 'Cancel') {
      this.logActiveTransferEvent(operation, `${operation} conflict decision: cancel.`, { Item: relativePath });
      return 'cancel';
    }

    this.logActiveTransferEvent(operation, `${operation} conflict decision: cancel.`, { Item: relativePath });
    return 'cancel';
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
      job.startedAt = this.formatLocalDateTime(new Date());
      this.activeTransferJob = job;
      this.activeTransferJob.progress = 'Preparing...';
      this.activeTransferCancelling = false;
      this.updateActiveTransferStatusBarItem();
      this.postTransferQueueState();
      this.logTransferEvent(job, `${job.operation} started.`);

      try {
        const completionStatus = await job.run();
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
        this.runningTransfers = Math.max(0, this.runningTransfers - 1);
        if (this.activeTransferJob?.id === job.id) {
          this.activeTransferJob = undefined;
        }
        this.activeTransferCancelling = false;
        this.updateActiveTransferStatusBarItem();
        this.postTransferQueueState();
      }
    }
  }

  private formatQueuedTransferCount(count = this.transferQueue.length): string {
    return count === 1 ? '1 queued' : `${count} queued`;
  }

  private updateActiveTransferStatusBarItem(): void {
    if (!this.activeTransferCancellationSource) {
      return;
    }

    const queuedSuffix = this.transferQueue.length ? ` (${this.formatQueuedTransferCount()})` : '';
    this.transferCancelStatusBarItem.text = `$(x) Cancel Transfer${queuedSuffix}`;
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
    completedTransfer.progress = status;
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
    this.transferCancelStatusBarItem.text = '$(x) Cancel Transfer';
    this.transferCancelStatusBarItem.tooltip = `Cancel the active ${operation.toLowerCase()} transfer`;
    this.updateActiveTransferStatusBarItem();
    this.transferCancelStatusBarItem.show();
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
    this.transferCancelStatusBarItem.text = '$(x) Cancel Transfer';
    this.transferCancelStatusBarItem.hide();
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
        this.activeTransferCancelling ? 'Cancelling' : (this.activeTransferCancellationSource ? 'Running' : 'Preparing'),
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
      progress: status === 'Waiting' ? '--' : (job.progress || ''),
      canCancel,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt
    };
  }

  private formatLocalDateTime(date: Date): string {
    const pad = (value: number): string => value.toString().padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private setActiveTransferProgress(progress: string): void {
    if (!this.activeTransferJob) {
      return;
    }

    this.activeTransferJob.progress = progress;
    this.postTransferQueueState();
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

    await vscode.window.showWarningMessage(
      `${operation} completed with ${summary.skippedItems.length} skipped item(s) and ${summary.failedItems.length} failed item(s).`,
      { modal: false, detail: details.join('\n\n') }
    );
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

  private async requestSetPermissions(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || ''));
    const entryType = String(payload?.type || '');
    const entryName = String(payload?.name || remotePath.split('/').filter(Boolean).pop() || remotePath);
    const currentPermissions = String(payload?.permissions || '');

    if (!remotePath || remotePath === '/' || entryName === '..') {
      throw new Error('Select a remote item to update permissions.');
    }

    const isDirectory = entryType === 'directory';
    const permissionState = parsePermissionString(currentPermissions, isDirectory);
    const initialMode = calculateModeFromPermissionState(permissionState);
    const selectedMode = await this.openSetPermissionsPanel({
      entryName,
      entryType,
      remotePath,
      currentPermissions,
      isDirectory,
      initialMode,
      permissionState
    });

    if (!selectedMode) {
      this.postStatus('Set permissions cancelled.');
      return;
    }

    this.postBusy(true, `Setting permissions ${selectedMode} on ${entryName}...`);
    await this.sessions.chmod(connectionId, remotePath, selectedMode);
    this.logInfo('Set remote permissions.', { Mode: selectedMode, Path: this.buildRemoteReference(remotePath) });
    await this.listDirectory(this.getActivePath());
    this.postBusy(false, `Permissions set to ${selectedMode}.`);
  }

  private openSetPermissionsPanel(options: SetPermissionsPanelOptions): Promise<string | undefined> {
    this.cancelPermissionsDialog();

    return new Promise<string | undefined>(resolve => {
      this.pendingPermissionsDialogResolve = resolve;
      this.postMessage(RemoteEditOutboundMessageType.ShowPermissionsDialog, {
        entryName: options.entryName,
        entryType: options.entryType,
        remotePath: options.remotePath,
        currentPermissions: options.currentPermissions,
        isDirectory: options.isDirectory,
        initialMode: options.initialMode,
        permissionState: options.permissionState
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

    this.finishPermissionsDialog(mode);
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

  private finishPermissionsDialog(mode?: string): void {
    const resolve = this.pendingPermissionsDialogResolve;

    if (!resolve) {
      return;
    }

    this.pendingPermissionsDialogResolve = undefined;
    resolve(mode);
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

    this.resolvePendingPermissionsDialog();
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
