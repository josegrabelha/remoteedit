import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AsyncLocalStorage } from 'async_hooks';
import { ConnectionManager, type RemoteEditPersistentWebviewStorage } from '../connection/ConnectionManager';
import { buildRemoteEditUri } from '../filesystem/RemoteEditFileSystemProvider';
import type { ActiveConnection, ConnectOptions, RemoteSessionManager, RemoteEntryMetadataNotifier, RemoteEntryMetadataUpdate } from '../remote/RemoteSessionManager';
import { getRemoteConnectOriginalMessage, getRemoteConnectStatusMessage } from '../remote/ConnectionProbe';
import { dirnameRemotePath, joinRemotePath, normalizeRemotePath, type RemoteEntry, type RemoteChecksumSummary } from '../ssh/SftpSessionManager';
import { SshTerminalService } from '../ssh/SshTerminalService';
import { PortForwardManager, type SavedPortForwardConfig, type PortForwardRuntimeState } from '../ssh/PortForwardManager';
import { RemoteEditSharedState } from '../state/RemoteEditSharedState';
import { RemoteSearchService, type RemoteSearchSnapshot, type RemoteSearchResult, type RemoteSearchOptions, type RemoteSearchResultMeta } from '../search/RemoteSearchService';
import { LogViewerPanel } from '../logViewer/LogViewerPanel';
import { buildDeleteEntriesConfirmationDetail } from '../utils/deleteConfirmationUtils';
import { RemoteEditOperationCancelledError, formatBytes, isRemoteEditOperationCancelled, throwIfCancelled, withRemoteEditProgress, type RemoteEditProgressReporter } from '../utils/progressUtils';
import { appendDebugLog, appendOutputLog, appendPerformanceLog, createPerformanceTimer, type OutputLogDetails } from '../utils/outputLogger';
import { shellQuote } from '../utils/shellUtils';
import { normalizePermissionDisplayMode } from '../utils/permissionFormatUtils';
import { getNonce } from '../utils/webviewUtils';
import { renderRemoteEditHtml } from './RemoteEditHtml';
import { handleRemoteEditPanelMessage } from './PanelHandlers';
import { RemoteEditIncomingMessageType, RemoteEditOutboundMessageType, type RemoteEditWebviewMessage } from './PanelMessages';
import { RemoteEditPanelState } from './PanelState';
import { calculateModeFromPermissionState, parsePermissionString, type SetPermissionsDialogResult, type SetPermissionsPanelOptions } from './Permissions';
import { formatOwnerGroupOperationError, formatOwnerGroupTargetLabel, formatPermissionOperationError, normalizePermissionEntries, validateOwnerGroupName } from './PermissionUtils';
import type { ActiveRemoteCommandState, ActiveTransferState, AggregateTransferState, ArchiveFormat, ConfirmDialogOptions, DownloadTransferItem, LocalUploadEntry, PendingConnectionSnapshot, PendingTransferConflict, QueuedTransferJob, TransferCompletionStatus, TransferConflictChoice, TransferConflictDecision, TransferConflictKind, TransferConflictState, TransferQueueItemSnapshot, TransferQueueStateSnapshot, TransferSkipState, TransferSummary, UploadTransferItem } from './PanelTypes';
import { buildCopyFileName } from './FileNameUtils';
import { buildArchiveBaseName, normalizeArchiveFormat, normalizeArchiveName } from './ArchiveUtils';
import { formatFailureStatus, formatStatusError, normalizeMessageForComparison, shouldShowStatusOutputLink } from './StatusFormatter';
import { formatRemoteEditError } from './ErrorFormatter';
import { extractConnectionIdFromError, formatBackupImportError, formatMissingRemoteConnectionMessage, isConnectionStateOperation, isMissingRemoteConnectionError } from './ConnectionErrors';
import { addCanceledTransferItem, buildDownloadQueueSourceLabel, buildDownloadQueueTargetLabel, buildSelectedLocalItemsLabel, buildSelectedRemoteItemsLabel, buildTransferCompletionStatusText, buildTransferProgressDetail, buildTransferResultProgress, buildTransferStatusMessage, buildUploadQueueSourceLabel, buildUploadQueueTargetLabel, createTransferSkipState, formatCount, formatLocalDateTime, formatQueuedTransferCount, formatTransferError, formatTransferProgressMessage, getTransferCompletionStatus, isTransferCancellationError, joinRemoteRelativePath, toPosixRelativePath, markTransferPathSkipped, markTransferTreeSkipped, shouldSkipTransferItem } from './TransferUtils';
import { readLocalFileWithCancellation, writeLocalFileSafely } from './TransferFileIO';
import { buildNativeTransferConflictDetail, buildNativeTransferConflictMessage, buildTransferConflictChoices, buildTransferConflictDialogPayload, buildTypeMismatchConflictMessage, isValidTransferConflictChoice } from './TransferConflicts';
import { buildFallbackServerSystemInfo, buildServerDashboardSnapshot, buildServerDashboardSnapshotCommand, createUnavailableServerOverview, parseServerDashboardSnapshotOutput, type ServerDashboardProcessItem, type ServerDashboardScheduledJobItem, type ServerDashboardServiceItem } from './server/ServerDashboardModel';
import { buildChecksumsDialogPayload, formatTimestampForDialog } from './ChecksumUtils';
import { formatRemoteFileOpenFailureReason } from './RemoteFileOpenErrors';
import { RemoteEditDialogManager, type InputDialogOptions } from './DialogManager';
import { RemoteSearchResultBatcher } from './RemoteSearchResultBatcher';
import { PortForwardController } from './PortForwardController';
import { RemoteCommandController } from './RemoteCommandController';
import { buildTransferQueueItemSnapshot, buildTransferQueueStateSnapshot } from './TransferQueueSnapshot';
import { ServerManagementController } from './server/ServerManagementController';
import { PanelBackupController } from './PanelBackupController';
import { DroppedUploadStagingService, normalizeDroppedUploadRelativePath } from './DroppedUploadStagingService';
import { remoteClipboardService, type RemoteClipboardItem } from '../remote/RemoteClipboardService';
import { RemoteMoveService } from '../remote/RemoteMoveService';
export type { TransferQueueItemSnapshot, TransferQueueStateSnapshot } from './PanelTypes';



interface ConnectionChangeNotifier {
  onDidChangeConnections?: vscode.Event<void>;
}

const DIRECTORY_LIST_TIMEOUT_MS = 60000;

export class RemoteEditPanel {
  private static currentPanel: RemoteEditPanel | undefined;
  private static readonly transferQueueChangedEmitter = new vscode.EventEmitter<TransferQueueStateSnapshot>();
  static readonly onDidChangeTransferQueue = RemoteEditPanel.transferQueueChangedEmitter.event;
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panelDisposables: vscode.Disposable[] = [];
  private isDisposed = false;
  private readonly state = new RemoteEditPanelState();
  private readonly activeTransfers = new Map<string, ActiveTransferState>();
  private readonly transferExecutionContext = new AsyncLocalStorage<string>();
  private pendingTransferConflict: PendingTransferConflict | undefined;
  private transferConflictSequence = 0;
  private transferConflictDialogQueue: Promise<void> = Promise.resolve();
  private readonly transferQueue: QueuedTransferJob[] = [];
  private readonly completedTransfers: TransferQueueItemSnapshot[] = [];
  private readonly maxCompletedTransfersPerConnection = 50;
  private readonly sshTerminalService: SshTerminalService;
  private readonly remoteSearchService: RemoteSearchService;
  private readonly portForwardManager: PortForwardManager;
  private readonly portForwardController: PortForwardController;
  private readonly serverManagementController: ServerManagementController;
  private readonly remoteSearchResultBatcher: RemoteSearchResultBatcher;
  private readonly remoteCommandController: RemoteCommandController;
  private runningTransfers = 0;
  private sessionOrder: string[] = [];

  private readonly activeConnectionCancellationSources = new Map<string, vscode.CancellationTokenSource>();
  private readonly pendingConnectionOptions = new Map<string, ConnectOptions>();
  private readonly disconnectingConnectionIds = new Set<string>();
  private directoryListRequestSequence = 0;
  private readonly activeRemoteCommands = new Map<string, ActiveRemoteCommandState>();
  private pendingPermissionsDialogResolve: ((result?: SetPermissionsDialogResult) => void) | undefined;
  private readonly dialogManager: RemoteEditDialogManager;
  private readonly virtualDocuments = new Map<string, string>();
  private readonly backupController: PanelBackupController;
  private readonly droppedUploadStaging: DroppedUploadStagingService;
  private readonly remoteMoveService: RemoteMoveService;

  static open(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel
  ): void {
    RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
  }

  static openConnection(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.revealConnection(connectionId).catch(error => remoteEditPanel.showCommandError(error));
  }

  static openRemotePath(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string,
    remotePath: string
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.openConnectionPath(connectionId, remotePath).catch(error => remoteEditPanel.showCommandError(error));
  }

  static syncRemotePathIfOpen(connectionId: string, remotePath: string): void {
    const remoteEditPanel = RemoteEditPanel.currentPanel;

    if (!remoteEditPanel?.panel || remoteEditPanel.isDisposed) {
      return;
    }

    void remoteEditPanel.openConnectionPath(connectionId, remotePath).catch(error => remoteEditPanel.showCommandError(error));
  }

  static syncConnectionIfOpen(connectionId: string): void {
    const remoteEditPanel = RemoteEditPanel.currentPanel;

    if (!remoteEditPanel?.panel || remoteEditPanel.isDisposed) {
      return;
    }

    void remoteEditPanel.revealConnection(connectionId).catch(error => remoteEditPanel.showCommandError(error));
  }

  static disconnectConnectionIfOpen(connectionId: string): boolean {
    const remoteEditPanel = RemoteEditPanel.currentPanel;

    if (!remoteEditPanel?.panel || remoteEditPanel.isDisposed) {
      return false;
    }

    void remoteEditPanel.disconnect(connectionId).catch(error => remoteEditPanel.showCommandError(error));
    return true;
  }

  static refreshProfilesIfOpen(selectedId?: string): void {
    const remoteEditPanel = RemoteEditPanel.currentPanel;

    if (!remoteEditPanel?.panel || remoteEditPanel.isDisposed) {
      return;
    }

    void remoteEditPanel.sendProfiles(selectedId).catch(error => remoteEditPanel.showCommandError(error));
  }

  static syncSessionsIfOpen(): void {
    const remoteEditPanel = RemoteEditPanel.currentPanel;

    if (!remoteEditPanel?.panel || remoteEditPanel.isDisposed) {
      return;
    }

    remoteEditPanel.syncSessionsFromSharedManager();
  }

  static openRemoteFile(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string,
    remotePath: string
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.openConnectionFile(connectionId, remotePath).catch(error => remoteEditPanel.showCommandError(error));
  }

  static openRemoteFileReadOnly(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string,
    remotePath: string
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.openConnectionFileReadOnly(connectionId, remotePath).catch(error => remoteEditPanel.showCommandError(error));
  }

  static createRemoteEntry(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string,
    targetDirectory: string,
    entryKind: 'file' | 'directory'
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.createRemoteEntryFromSidebar(connectionId, targetDirectory, entryKind).catch(error => remoteEditPanel.showCommandError(error));
  }

  static renameRemoteEntry(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string,
    remotePath: string,
    name: string
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.renameRemoteEntryFromSidebar(connectionId, remotePath, name).catch(error => remoteEditPanel.showCommandError(error));
  }

  static deleteRemoteEntry(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string,
    remotePath: string,
    name: string,
    entryType: string
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.deleteRemoteEntryFromSidebar(connectionId, remotePath, name, entryType).catch(error => remoteEditPanel.showCommandError(error));
  }

  static showRemoteEntryProperties(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string,
    remotePath: string
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.showRemoteEntryPropertiesFromSidebar(connectionId, remotePath).catch(error => remoteEditPanel.showCommandError(error));
  }

  static calculateRemoteChecksums(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string,
    remotePath: string,
    name: string
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.calculateRemoteChecksumsFromSidebar(connectionId, remotePath, name).catch(error => remoteEditPanel.showCommandError(error));
  }

  static setRemotePermissions(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string,
    remotePath: string,
    name: string,
    entryType: string,
    permissions?: string
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.setRemotePermissionsFromSidebar(connectionId, remotePath, name, entryType, permissions).catch(error => remoteEditPanel.showCommandError(error));
  }

  static disconnectConnection(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.disconnect(connectionId).catch(error => remoteEditPanel.showCommandError(error));
  }


  static connectWithPayload(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    payload: any
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    void remoteEditPanel.connect(payload || {}).catch(error => remoteEditPanel.showCommandError(error));
  }


  static requestUploadEntriesFromSidebar(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    payload: any
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreateHeadless(context, sessions, connectionManager, output);
    void remoteEditPanel.requestUploadEntries({ ...(payload || {}), source: 'sidebar' }).catch(error => remoteEditPanel.showCommandError(error));
  }

  static requestDroppedUploadEntriesFromSidebar(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    payload: any,
    localEntries: readonly LocalUploadEntry[] = []
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreateHeadless(context, sessions, connectionManager, output);
    void remoteEditPanel.requestSidebarDroppedUploadEntries({ ...(payload || {}), source: 'sidebar' }, localEntries)
      .catch(error => remoteEditPanel.showCommandError(error));
  }

  static requestDownloadEntriesFromSidebar(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    payload: any
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreateHeadless(context, sessions, connectionManager, output);
    void remoteEditPanel.requestDownloadEntries({ ...(payload || {}), source: 'sidebar' }).catch(error => remoteEditPanel.showCommandError(error));
  }

  static openLogViewerForConnection(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string
  ): void {
    LogViewerPanel.openForConnection(context, sessions, output, connectionId);
  }

  static openLogViewerForFile(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel,
    connectionId: string,
    remotePath: string
  ): void {
    LogViewerPanel.openForFile(context, sessions, output, connectionId, remotePath);
  }

  static getTransferQueueState(): TransferQueueStateSnapshot {
    const currentPanel = RemoteEditPanel.currentPanel;
    return currentPanel
      ? buildTransferQueueStateSnapshot(currentPanel.activeTransfers.values(), currentPanel.transferQueue, currentPanel.completedTransfers)
      : { pending: [], completed: [] };
  }

  static openTransferQueue(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel
  ): void {
    const remoteEditPanel = RemoteEditPanel.getOrCreate(context, sessions, connectionManager, output);
    remoteEditPanel.postTransferQueueState();
    remoteEditPanel.postMessage(RemoteEditOutboundMessageType.ShowTransferQueue, {});
  }

  static cancelTransfer(transferId?: string): void {
    const remoteEditPanel = RemoteEditPanel.currentPanel;
    if (!remoteEditPanel) {
      return;
    }

    void remoteEditPanel.cancelActiveTransfer({ transferId }).catch(error => remoteEditPanel.showCommandError(error));
  }

  static removeQueuedTransfer(transferId: string): void {
    RemoteEditPanel.currentPanel?.removeQueuedTransfer({ transferId });
  }

  static clearCompletedTransfers(): void {
    RemoteEditPanel.currentPanel?.clearAllCompletedTransfers();
  }

  private static getOrCreate(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel
  ): RemoteEditPanel {
    if (RemoteEditPanel.currentPanel) {
      if (RemoteEditPanel.currentPanel.panel && !RemoteEditPanel.currentPanel.isDisposed) {
        RemoteEditPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
        return RemoteEditPanel.currentPanel;
      }

      const panel = RemoteEditPanel.createWebviewPanel();
      RemoteEditPanel.currentPanel.attachPanel(panel);
      return RemoteEditPanel.currentPanel;
    }

    RemoteEditPanel.currentPanel = new RemoteEditPanel(
      RemoteEditPanel.createWebviewPanel(),
      context,
      sessions,
      connectionManager,
      output
    );

    return RemoteEditPanel.currentPanel;
  }

  private static getOrCreateHeadless(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel
  ): RemoteEditPanel {
    if (RemoteEditPanel.currentPanel) {
      RemoteEditPanel.currentPanel.isDisposed = false;
      return RemoteEditPanel.currentPanel;
    }

    RemoteEditPanel.currentPanel = new RemoteEditPanel(
      undefined,
      context,
      sessions,
      connectionManager,
      output
    );

    return RemoteEditPanel.currentPanel;
  }

  private static createWebviewPanel(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      'remoteedit.home',
      'Remote Edit',
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
    panel: vscode.WebviewPanel | undefined,
    private readonly context: vscode.ExtensionContext,
    private readonly sessions: RemoteSessionManager,
    private readonly connectionManager: ConnectionManager,
    private readonly output: vscode.OutputChannel
  ) {
    this.state.initializeFromSessions(this.sessions.listConnections());
    this.droppedUploadStaging = new DroppedUploadStagingService(path.join(this.context.globalStorageUri.fsPath, 'dropped-uploads'));
    this.remoteMoveService = new RemoteMoveService(this.sessions);
    this.disposables.push(remoteClipboardService.onDidChange(() => this.postRemoteClipboardState()));
    this.sshTerminalService = new SshTerminalService(this.sessions);
    this.portForwardManager = new PortForwardManager(this.sessions, state => this.postPortForwardState(state));
    this.portForwardController = new PortForwardController({
      sessions: this.sessions,
      portForwardManager: this.portForwardManager,
      getActiveConnectionId: () => this.state.getActiveConnectionId(),
      postPortForwardState: state => this.postPortForwardState(state),
      logInfo: (message, details) => this.logInfo(message, details),
      logError: (message, details) => this.logError(message, details)
    });
    this.serverManagementController = new ServerManagementController({
      sessions: this.sessions,
      virtualDocuments: this.virtualDocuments,
      getActiveConnectionId: () => this.state.getActiveConnectionId(),
      postMessage: (type, payload) => this.postMessage(type, payload),
      postServerStatus: (message, isError, durationMs) => this.postServerStatus(message, isError, durationMs),
      showConfirmDialog: options => this.showConfirmDialog(options),
      openEntries: payload => this.openEntries(payload),
      openEntriesReadOnly: payload => this.openEntriesReadOnly(payload),
      logWarn: (message, details) => this.logWarn(message, details),
      logDebug: (message, details) => this.logDebug(message, details)
    });
    this.remoteSearchResultBatcher = new RemoteSearchResultBatcher((type, payload) => this.postMessage(type, payload));
    this.remoteSearchService = new RemoteSearchService(this.sessions, this.output, {
      onStarted: snapshot => this.postRemoteSearchStarted(snapshot),
      onResult: (result, meta) => this.remoteSearchResultBatcher.queue(result, meta),
      onFinished: snapshot => this.postRemoteSearchFinished(snapshot)
    });
    this.dialogManager = new RemoteEditDialogManager(
      () => !this.isDisposed && Boolean(this.panel),
      (type, payload) => this.postMessage(type, payload)
    );
    this.remoteCommandController = new RemoteCommandController({
      sessions: this.sessions,
      activeRemoteCommands: this.activeRemoteCommands,
      getActivePath: () => this.getActivePath(),
      requireActiveConnectionId: () => this.requireActiveConnectionId(),
      postMessage: (type, payload) => this.postMessage(type, payload),
      showWebviewInputBox: options => this.showWebviewInputBox(options),
      logInfo: (message, details) => this.logInfo(message, details),
      logWarn: (message, details) => this.logWarn(message, details),
      logError: (message, details) => this.logError(message, details)
    });
    this.backupController = new PanelBackupController({
      context: this.context,
      connectionManager: this.connectionManager,
      postMessage: (type, payload) => this.postMessage(type, payload),
      sendProfiles: () => this.sendProfiles(),
      postPersistentStorageSnapshot: () => this.postPersistentStorageSnapshot(),
      logInfo: (message, details) => this.logInfo(message, details),
      logError: (message, details) => this.logError(message, details)
    });

    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider('remoteedit-virtual', {
        provideTextDocumentContent: uri => this.virtualDocuments.get(uri.toString()) || ''
      }),
      vscode.commands.registerCommand('remoteedit.cancelTransfer', () => this.cancelActiveTransfer()),
      RemoteEditSharedState.onProfilesChanged(event => {
        if (event.source === 'webview') {
          return;
        }

        void (async () => {
          const timer = createPerformanceTimer();
          this.logDebug('Profiles changed event received.', {
            Source: event.source || 'unknown',
            Reason: event.reason || 'unspecified',
            SelectedId: event.selectedId || ''
          });
          await this.sendProfiles(event.selectedId);
          this.postPersistentStorageSnapshot();
          appendPerformanceLog(this.output, 'Panel', `Sent profiles snapshot after profiles changed in ${timer()}ms`, {
            Source: event.source || 'unknown',
            Reason: event.reason || 'unspecified'
          });
        })().catch(error => this.showCommandError(error));
      }),
      RemoteEditSharedState.onRemoteDirectoryChanged(event => {
        if (event.source === 'webview') {
          return;
        }

        void this.refreshCurrentDirectoryFromSharedChange(event.connectionId, event.remotePath).catch(error => this.showCommandError(error));
      }),
      RemoteEditSharedState.onRemoteFileOpenFailure(event => {
        if (event.source !== 'webview') {
          return;
        }

        void this.handleWebviewRemoteFileOpenFailure(event).catch(error => this.showCommandError(error));
      }),
      LogViewerPanel.onDidChangeActiveSessionCount(() => this.postLogViewerActiveSessionCount()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('remoteedit.webview.remotePathBreadcrumb.showDirectoryDetails') || event.affectsConfiguration('remoteedit.remotePathBreadcrumb.showDirectoryDetails')) {
          this.postRemotePathBreadcrumbSettings();
        }
        if (
          event.affectsConfiguration('remoteedit.webview.fileList.openOnNameClick') ||
          event.affectsConfiguration('remoteedit.fileList.openOnNameClick') ||
          event.affectsConfiguration('remoteedit.webview.fileList.permissionsDisplay')
        ) {
          this.postFileListSettings();
        }
      })
    );

    const connectionChangeEvent = (this.sessions as RemoteSessionManager & ConnectionChangeNotifier).onDidChangeConnections;

    if (connectionChangeEvent) {
      this.disposables.push(connectionChangeEvent(() => this.syncSessionsFromSharedManager()));
    }

    const metadataUpdateEvent = (this.sessions as RemoteSessionManager & RemoteEntryMetadataNotifier).onRemoteEntryMetadataUpdated;

    if (metadataUpdateEvent) {
      this.disposables.push(metadataUpdateEvent(event => this.handleRemoteEntryMetadataUpdated(event)));
    }

    if (panel) {
      this.attachPanel(panel);
    }
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
    // Keep active port forwards alive while the Remote Edit connection remains active.
    this.stopAllRemoteCommands(true);
    this.remoteSearchResultBatcher.clearAll();
    this.resolvePendingPermissionsDialog();
    this.dialogManager.resolvePendingDialogs();
    this.droppedUploadStaging.cancelAll();
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
          this.postRemoteSearchState();
          this.postLogViewerActiveSessionCount();
          this.postAllPortForwardStates();
          this.postPersistentStorageSnapshot();
          this.postRemoteClipboardState();
        },
        saveConnection: payload => this.saveConnection(payload),
        pickPrivateKeyPath: () => this.pickPrivateKeyPath(),
        pickCaCertificatePath: () => this.pickCaCertificatePath(),
        deleteConnection: payload => this.deleteConnection(payload),
        renameConnection: payload => this.renameConnection(payload),
        reorderConnections: payload => this.reorderConnections(payload),
        createConnectionGroup: payload => this.createConnectionGroup(payload),
        renameConnectionGroup: payload => this.renameConnectionGroup(payload),
        deleteConnectionGroup: payload => this.deleteConnectionGroup(payload),
        syncPersistentStorage: payload => this.syncPersistentStorage(payload),
        requestImportConnectionsSettings: () => this.requestImportConnectionsSettings(),
        exportConnectionsSettings: payload => this.exportConnectionsSettings(payload),
        importConnectionsSettings: payload => this.importConnectionsSettings(payload),
        connect: payload => this.connect(payload),
        cancelConnection: () => this.cancelConnection(),
        disconnect: connectionId => this.disconnect(connectionId),
        switchSession: connectionId => this.switchSession(connectionId),
        reorderSessions: payload => this.reorderSessions(payload),
        enableSudoMode: () => this.enableSudoMode(),
        disableSudoMode: connectionId => this.disableSudoMode(connectionId),
        listDirectory: (remotePath, options) => this.listDirectory(remotePath, options),
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
        requestCutRemoteEntries: payload => this.requestCutRemoteEntries(payload),
        requestPasteRemoteEntries: payload => this.requestPasteRemoteEntries(payload),
        requestMoveRemoteEntries: payload => this.requestMoveRemoteEntries(payload),
        requestDeleteEntry: payload => this.requestDeleteEntry(payload),
        requestDeleteEntries: payload => this.requestDeleteEntries(payload),
        requestUploadEntries: payload => this.requestUploadEntries(payload),
        requestDroppedUploadEntries: payload => this.requestDroppedUploadEntries(payload),
        beginDroppedUploadEntries: payload => this.beginDroppedUploadEntries(payload),
        writeDroppedUploadChunk: payload => this.writeDroppedUploadChunk(payload),
        finishDroppedUploadEntries: payload => this.finishDroppedUploadEntries(payload),
        cancelDroppedUploadEntries: payload => this.cancelDroppedUploadEntries(payload),
        requestDownloadEntries: payload => this.requestDownloadEntries(payload),
        requestCompressArchive: payload => this.requestCompressArchive(payload),
        cancelTransfer: payload => this.cancelActiveTransfer(payload),
        removeQueuedTransfer: payload => this.removeQueuedTransfer(payload),
        requestSetPermissions: payload => this.requestSetPermissions(payload),
        requestChangeOwnerGroup: payload => this.requestChangeOwnerGroup(payload),
        requestOwnerGroupSuggestions: payload => this.requestOwnerGroupSuggestions(payload),
        requestRunRemoteCommand: payload => this.requestRunRemoteCommand(payload),
        requestOpenSshTerminal: payload => this.requestOpenSshTerminal(payload),
        requestOpenLogViewer: payload => this.requestOpenLogViewer(payload),
        requestServerDashboard: payload => this.requestServerDashboard(payload),
        requestServerServiceDetails: payload => this.requestServerServiceDetails(payload),
        requestServerServiceAction: payload => this.requestServerServiceAction(payload),
        requestServerProcessDetails: payload => this.requestServerProcessDetails(payload),
        requestServerProcessAction: payload => this.requestServerProcessAction(payload),
        requestServerScheduledJobAction: payload => this.requestServerScheduledJobAction(payload),
        requestPortForwardState: payload => this.requestPortForwardState(payload),
        startPortForward: payload => this.startPortForward(payload),
        stopPortForward: payload => this.stopPortForward(payload),
        requestRemoteSearchState: () => this.postRemoteSearchState(),
        browseRemoteSearchScope: payload => this.browseRemoteSearchScope(payload),
        startRemoteSearch: payload => this.startRemoteSearch(payload),
        cancelRemoteSearch: () => this.cancelRemoteSearch(),
        clearRemoteSearch: () => this.clearRemoteSearch(),
        stopRemoteCommand: payload => this.stopRemoteCommand(payload),
        applyPermissions: payload => this.applyPermissionsFromDialog(payload),
        cancelPermissions: () => this.cancelPermissionsDialog(),
        showSettings: () => { void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:josegrabelha.remoteedit'); },
        showOutput: () => this.output.show(true),
        copyRemotePath: payload => this.copyRemotePath(payload),
        copyStatus: payload => this.copyStatus(payload),
        confirmDialogResponse: payload => this.dialogManager.handleConfirmDialogResponse(payload),
        inputDialogResponse: payload => this.dialogManager.handleInputDialogResponse(payload),
        transferConflictResponse: payload => this.handleTransferConflictResponse(payload),
        log: logMessage => this.logDebug(logMessage),
        performanceLog: payload => this.logWebviewPerformance(payload),
        unknown: messageType => this.postError(`Unknown webview message: ${messageType}`)
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const friendlyMessage = formatRemoteEditError(message.type, message.payload, messageText, {
        getActivePath: () => this.getActivePath(),
        isMissingRemoteConnectionError,
        formatMissingRemoteConnectionMessage
      });
      if (isMissingRemoteConnectionError(messageText)) {
        await this.markRemoteConnectionUnavailableFromMessage(message, messageText);
      }
      const statusMessage = formatStatusError(message.type, messageText);
      this.logError(statusMessage, { Details: friendlyMessage });
      if (friendlyMessage !== messageText && !normalizeMessageForComparison(friendlyMessage).includes(normalizeMessageForComparison(messageText))) {
        this.logError('Raw error details.', { Details: messageText });
      }
      const handledAsBackupOperation = this.postBackupOperationError(message.type, friendlyMessage);
      if (!handledAsBackupOperation) {
        if (this.isServerViewMessageType(message.type)) {
          this.postServerStatus(statusMessage, true);
        } else {
          this.postError(statusMessage, { showOutputLink: shouldShowStatusOutputLink(message.type, messageText, friendlyMessage, statusMessage) });
        }
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
        message: formatBackupImportError(message)
      });
      return true;
    }

    if (messageType === 'requestImportConnectionsSettings') {
      this.backupController.clearPendingImport();
      this.postMessage(RemoteEditOutboundMessageType.ShowImportConnectionsSettingsDialog, {
        summary: { importError: 'Import failed. Invalid backup file.' }
      });
      return true;
    }

    return false;
  }

  private getMessageConnectionId(message: RemoteEditWebviewMessage): string | undefined {
    const payloadConnectionId = String(message.payload?.connectionId || '').trim();

    if (payloadConnectionId) {
      return payloadConnectionId;
    }

    return this.state.getActiveConnectionId();
  }

  private async markRemoteConnectionUnavailableFromMessage(message: RemoteEditWebviewMessage, details: string): Promise<void> {
    if (isConnectionStateOperation(message.type)) {
      return;
    }

    const connectionId = extractConnectionIdFromError(details) || this.getMessageConnectionId(message);

    if (!connectionId) {
      return;
    }

    await this.markRemoteConnectionUnavailable(connectionId, details);
  }

  private async markRemoteConnectionUnavailable(connectionId: string, details?: string): Promise<void> {
    if (!connectionId) {
      return;
    }

    this.stopRemoteCommand({ connectionId, force: true });
    LogViewerPanel.stopConnectionIfOpen(connectionId);

    this.cancelActiveTransfersForConnection(connectionId);

    this.invalidateDirectoryListRequests();
    this.clearQueuedTransfersForConnection(connectionId);
    remoteClipboardService.clearForConnection(connectionId);
    this.state.deleteConnectionPath(connectionId);
    RemoteEditSharedState.deleteNavigation(connectionId);
    this.sessions.disableSudoMode(connectionId);

    try {
      await this.portForwardManager.stopAllForConnection(connectionId);
      await this.sessions.disconnect(connectionId);
    } catch {
      // Ignore cleanup errors while marking a stale session as unavailable.
    }

    if (this.state.getActiveConnectionId() === connectionId) {
      const remaining = this.sessions.listConnections();
      this.setActiveConnection(remaining[0]?.id);
    }

    this.updatePanelTitle();
    this.sendSessions();

    if (!this.state.getActiveConnectionId()) {
      this.postMessage(RemoteEditOutboundMessageType.Disconnected, {});
    }

    this.logWarn('Remote session marked as unavailable.', {
      Connection: connectionId,
      Details: details || 'Missing remote connection'
    });
  }

  private setActiveConnection(connectionId: string | undefined, syncSharedState = true): void {
    this.state.setActiveConnectionId(connectionId);

    if (syncSharedState) {
      RemoteEditSharedState.setActiveConnection(connectionId);
    }
  }

  private syncSessionsFromSharedManager(): void {
    if (this.activeConnectionCancellationSources.size > 0 || this.disconnectingConnectionIds.size > 0) {
      return;
    }

    const connectedSessions = this.sessions.listConnections();
    const connectedIds = new Set(connectedSessions.map(connection => connection.id));
    void this.portForwardManager.stopAllExceptConnections(connectedIds);

    this.state.initializeFromSessions(connectedSessions);

    const activeConnectionId = this.state.getActiveConnectionId();

    if (activeConnectionId && !connectedIds.has(activeConnectionId)) {
      this.state.deleteConnectionPath(activeConnectionId);
    }

    if (!connectedSessions.length) {
      this.state.clearRetainedCurrentPaths();
      this.setActiveConnection(undefined);
      this.updatePanelTitle();
      this.sendSessions();
      this.postMessage(RemoteEditOutboundMessageType.Disconnected, {});
      return;
    }

    const sharedActiveId = RemoteEditSharedState.getActiveConnectionId();
    const nextActiveId = sharedActiveId && connectedIds.has(sharedActiveId)
      ? sharedActiveId
      : activeConnectionId && connectedIds.has(activeConnectionId)
        ? activeConnectionId
        : connectedSessions[0].id;

    this.setActiveConnection(nextActiveId);
    this.updatePanelTitle();
    this.sendSessions();
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

    for (const connection of connectedSessions) {
      const sharedNavigation = RemoteEditSharedState.getNavigation(connection.id);

      if (sharedNavigation?.currentPath) {
        this.state.setCurrentPath(connection.id, sharedNavigation.currentPath);
      }
    }

    const sharedActiveId = RemoteEditSharedState.getActiveConnectionId();
    const lastActiveId = this.state.getLastActiveConnectionId();
    const nextActiveId = sharedActiveId && this.sessions.hasConnection(sharedActiveId)
      ? sharedActiveId
      : lastActiveId && this.sessions.hasConnection(lastActiveId)
        ? lastActiveId
        : connectedSessions[0].id;

    const sharedNavigation = RemoteEditSharedState.getNavigation(nextActiveId);

    if (sharedNavigation?.currentPath) {
      this.state.setCurrentPath(nextActiveId, sharedNavigation.currentPath);
    }

    this.setActiveConnection(nextActiveId);
    this.sendSessions();
    this.postRemoteSearchState(nextActiveId);
    await this.listDirectory(this.getActivePath());
  }

  private async sendProfiles(selectedId?: string): Promise<void> {
    const timer = createPerformanceTimer();
    const profiles = await this.connectionManager.listProfiles();
    const connectionGroups = await this.connectionManager.listGroups();
    this.postMessage(RemoteEditOutboundMessageType.ProfilesLoaded, { profiles, connectionGroups, selectedId });
    appendPerformanceLog(this.output, 'Panel', `Posted profiles snapshot in ${timer()}ms`, {
      Profiles: profiles.length,
      Groups: connectionGroups.length,
      SelectedId: selectedId || ''
    });
  }

  private buildPendingConnectionSnapshot(connectionId: string): PendingConnectionSnapshot | undefined {
    const attempt = this.pendingConnectionOptions.get(connectionId);

    if (!attempt) {
      return undefined;
    }

    const startPath = normalizeRemotePath(attempt.startPath || '/');

    return {
      id: connectionId,
      connectionType: attempt.connectionType || 'sftp',
      name: attempt.name || `${attempt.username}@${attempt.host}`,
      host: attempt.host,
      port: attempt.port,
      username: attempt.username,
      authType: attempt.authType,
      privateKeyPath: attempt.privateKeyPath,
      startPath,
      currentPath: this.state.getCurrentPath(connectionId, startPath),
      keepAlive: attempt.keepAlive !== false,
      ftpsAllowSelfSignedCertificate: attempt.ftpsAllowSelfSignedCertificate,
      ftpsCaCertificatePath: attempt.ftpsCaCertificatePath,
      isQuickConnect: Boolean(attempt.isQuickConnect),
      sudoModeEnabled: false,
      connectionState: 'connecting'
    };
  }

  private sendSessions(): void {
    const openConnections = this.sessions.listConnections();
    const openConnectionIds = new Set(openConnections.map(connection => connection.id));
    const pendingConnections = Array.from(this.activeConnectionCancellationSources.keys())
      .filter(connectionId => !openConnectionIds.has(connectionId))
      .map(connectionId => this.buildPendingConnectionSnapshot(connectionId))
      .filter((connection): connection is PendingConnectionSnapshot => Boolean(connection));
    const allConnectionIds = new Set([
      ...openConnections.map(connection => connection.id),
      ...pendingConnections.map(connection => connection.id)
    ]);
    this.sessionOrder = this.sessionOrder.filter(connectionId => allConnectionIds.has(connectionId));

    for (const connection of [...openConnections, ...pendingConnections]) {
      if (!this.sessionOrder.includes(connection.id)) {
        this.sessionOrder.push(connection.id);
      }
    }

    const orderIndex = new Map(this.sessionOrder.map((connectionId, index) => [connectionId, index]));
    const sessions = [
      ...openConnections.map(connection => ({
        ...connection,
        connectionState: 'connected' as const,
        currentPath: this.state.getCurrentPath(connection.id, connection.startPath || '/'),
        sudoModeEnabled: this.sessions.isSudoModeEnabled(connection.id)
      })),
      ...pendingConnections
    ].sort((first, second) => (orderIndex.get(first.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(second.id) ?? Number.MAX_SAFE_INTEGER));

    this.postMessage(RemoteEditOutboundMessageType.SessionsChanged, {
      sessions,
      activeConnectionId: this.state.getActiveConnectionId()
    });
    this.postRemoteClipboardState();
  }

  private reorderSessions(payload: any): void {
    const requestedIds: string[] = Array.isArray(payload?.connectionIds)
      ? payload.connectionIds.map((value: unknown) => String(value || '')).filter((value: string) => Boolean(value))
      : [];
    if (!requestedIds.length) {
      return;
    }

    const openConnections = this.sessions.listConnections();
    const openConnectionIds = new Set(openConnections.map(connection => connection.id));
    const nextOrder = requestedIds.filter((connectionId: string) => openConnectionIds.has(connectionId));

    for (const connection of openConnections) {
      if (!nextOrder.includes(connection.id)) {
        nextOrder.push(connection.id);
      }
    }

    this.sessionOrder = nextOrder;
    this.sendSessions();
  }

  private async enableSudoMode(): Promise<void> {
    const connectionId = this.state.getActiveConnectionId();

    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId: '', enabled: false });
      this.postBusy(false, 'Connect to a host before enabling Sudo Mode.');
      return;
    }

    const password = await this.showWebviewInputBox({
      title: 'Enable Sudo Mode',
      prompt: 'Enter the sudo password for this connection. The password is kept only in memory for the current session.',
      password: true,
      placeHolder: 'Sudo password',
      label: 'Sudo password',
      confirmLabel: 'Enable'
    });

    if (!password) {
      this.sessions.disableSudoMode(connectionId);
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: false });
      this.postBusy(false, 'Sudo Mode not enabled.');
      return;
    }

    try {
      await this.sessions.enableSudoMode(connectionId, password);
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: true });
      this.postBusy(false, 'Sudo Mode enabled for this session.');
      this.logInfo('Sudo Mode enabled.', { Connection: connectionId });
    } catch (error) {
      this.sessions.disableSudoMode(connectionId);
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: false });
      this.postBusy(false, message || 'Could not enable Sudo Mode.');
      this.logWarn('Could not enable Sudo Mode.', { Connection: connectionId, Details: message });
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
    this.postBusy(false, 'Sudo Mode disabled.');
    this.logInfo('Sudo Mode disabled.', { Connection: connectionId });
  }

  private async saveConnection(payload: any): Promise<void> {
    const statusConnectionId = this.getOperationStatusConnectionId(payload);
    const profilePayload = { ...(payload || {}) };
    const newGroupName = String(profilePayload.newGroupName || '').trim();
    delete profilePayload.statusConnectionId;
    delete profilePayload.newGroupName;

    this.postBusy(true, 'Saving connection...', false, undefined, statusConnectionId);

    try {
      if (newGroupName) {
        const group = await this.connectionManager.createGroup(newGroupName);
        profilePayload.groupId = group.id;
      }
      const profile = await this.connectionManager.saveProfile(profilePayload);
      await this.sendProfiles(profile.id);
      RemoteEditSharedState.fireProfilesChanged(profile.id, 'webview', 'saveProfile');
      this.postBusy(false, 'Connection saved.', false, undefined, statusConnectionId);
      this.logInfo('Saved connection.', { Name: profile.name, Target: `${profile.username ? profile.username + '@' : ''}${profile.host}:${profile.port}` });
    } catch (error) {
      this.postBusy(false, 'Connection save failed.', false, undefined, statusConnectionId);
      throw error;
    }
  }

  private getOperationStatusConnectionId(payload: any): string | undefined {
    const statusConnectionId = String(payload?.statusConnectionId || '').trim();
    return statusConnectionId || undefined;
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

  private async pickCaCertificatePath(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select',
      title: 'Select FTPS CA certificate file',
      filters: { 'PEM certificates': ['pem', 'crt', 'cer'], 'All files': ['*'] }
    });

    const selectedPath = selected?.[0]?.fsPath;
    if (selectedPath) {
      this.postMessage(RemoteEditOutboundMessageType.CaCertificatePathSelected, { path: selectedPath });
    }
  }



  private async renameConnection(payload: any): Promise<void> {
    const profileId = String(payload?.id || '').trim();
    const name = String(payload?.name || '').trim();

    this.postBusy(true, 'Renaming connection...');
    const profile = await this.connectionManager.renameProfile(profileId, name);
    await this.sendProfiles(profile.id);
    this.postBusy(false, 'Connection renamed.');
    this.logInfo('Renamed saved connection.', { Name: profile.name, ProfileId: profileId });
  }

  private async reorderConnections(payload: any): Promise<void> {
    const profileIds = Array.isArray(payload?.profileIds)
      ? payload.profileIds.map((profileId: unknown) => String(profileId || '').trim()).filter(Boolean)
      : [];
    const groupsByProfileId = payload?.groupsByProfileId && typeof payload.groupsByProfileId === 'object' && !Array.isArray(payload.groupsByProfileId)
      ? payload.groupsByProfileId as Record<string, string | undefined>
      : undefined;

    await this.connectionManager.reorderProfiles(profileIds, groupsByProfileId);
    await this.sendProfiles(String(payload?.selectedId || ''));
    RemoteEditSharedState.fireProfilesChanged(String(payload?.selectedId || '') || undefined, 'webview', 'profileListChanged');
    this.logInfo('Reordered saved connections.', { Count: String(profileIds.length) });
  }

  private async createConnectionGroup(payload: any): Promise<void> {
    const name = String(payload?.name || '').trim();

    this.postBusy(true, 'Creating connection group...');
    const group = await this.connectionManager.createGroup(name);
    await this.sendProfiles(String(payload?.selectedId || ''));
    this.postBusy(false, 'Connection group created.');
    RemoteEditSharedState.fireProfilesChanged(String(payload?.selectedId || '') || undefined, 'webview', 'profileListChanged');
    this.logInfo('Created connection group.', { Name: group.name, GroupId: group.id });
  }

  private async renameConnectionGroup(payload: any): Promise<void> {
    const groupId = String(payload?.id || '').trim();
    const name = String(payload?.name || '').trim();

    this.postBusy(true, 'Renaming connection group...');
    const group = await this.connectionManager.renameGroup(groupId, name);
    await this.sendProfiles(String(payload?.selectedId || ''));
    this.postBusy(false, 'Connection group renamed.');
    RemoteEditSharedState.fireProfilesChanged(String(payload?.selectedId || '') || undefined, 'webview', 'profileListChanged');
    this.logInfo('Renamed connection group.', { Name: group.name, GroupId: group.id });
  }

  private async deleteConnectionGroup(payload: any): Promise<void> {
    const groupId = String(payload?.id || '').trim();
    const name = String(payload?.name || '').trim() || 'connection group';
    const deleteConnections = Boolean(payload?.deleteConnections);
    const selectedId = String(payload?.selectedId || '');
    const profiles = await this.connectionManager.listProfiles();
    const profileIdsInGroup = profiles
      .filter(profile => profile.groupId === groupId)
      .map(profile => profile.id)
      .filter(Boolean);

    this.postBusy(true, deleteConnections ? 'Deleting connection group and connections...' : 'Deleting connection group...');

    if (deleteConnections) {
      for (const profileId of profileIdsInGroup) {
        if (this.sessions.hasConnection(profileId)) {
          await this.disconnect(profileId);
        }
      }
    }

    const removedProfileIds = await this.connectionManager.deleteGroup(groupId, deleteConnections);
    const nextSelectedId = deleteConnections && removedProfileIds.includes(selectedId) ? '' : selectedId;
    await this.sendProfiles(nextSelectedId);
    RemoteEditSharedState.fireProfilesChanged(nextSelectedId || undefined, 'webview', 'deleteGroup');

    if (!nextSelectedId && deleteConnections && selectedId) {
      this.postMessage(RemoteEditOutboundMessageType.ConnectionFormCleared, {});
    }

    this.postBusy(false, deleteConnections ? 'Connection group and connections deleted.' : 'Connection group deleted.');
    this.logInfo('Deleted connection group.', { Name: name, GroupId: groupId, ConnectionsDeleted: String(deleteConnections ? removedProfileIds.length : 0) });
  }


  private async syncPersistentStorage(payload: any): Promise<void> {
    const snapshot = this.normalizePersistentStoragePayload(payload);
    await this.connectionManager.syncPersistentWebviewStorageSnapshot(snapshot, {
      migrationOnly: Boolean(payload?.migrationOnly)
    });
    this.postPersistentStorageSnapshot();
  }

  private normalizePersistentStoragePayload(payload: any): RemoteEditPersistentWebviewStorage {
    const source = payload && typeof payload === 'object' && payload.snapshot && typeof payload.snapshot === 'object'
      ? payload.snapshot
      : payload;

    return {
      savedCommands: source && typeof source === 'object' ? source.savedCommands : undefined,
      serverLogShortcuts: source && typeof source === 'object' ? source.serverLogShortcuts : undefined,
      portForwards: source && typeof source === 'object' ? source.portForwards : undefined
    };
  }

  private postPersistentStorageSnapshot(): void {
    const timer = createPerformanceTimer();
    const snapshot = this.connectionManager.getPersistentWebviewStorageSnapshot();
    this.postMessage(
      RemoteEditOutboundMessageType.PersistentStorageSnapshot,
      snapshot
    );
    appendPerformanceLog(this.output, 'Panel', `Posted persistent storage snapshot in ${timer()}ms`, {
      SavedCommands: Object.keys(snapshot.savedCommands || {}).length,
      ServerLogShortcuts: Object.keys(snapshot.serverLogShortcuts || {}).length,
      PortForwards: Object.keys(snapshot.portForwards || {}).length
    });
  }

  private async requestImportConnectionsSettings(): Promise<void> {
    await this.backupController.requestImportConnectionsSettings();
  }

  private async exportConnectionsSettings(payload: any): Promise<void> {
    await this.backupController.exportConnectionsSettings(payload);
  }

  private async importConnectionsSettings(payload: any): Promise<void> {
    await this.backupController.importConnectionsSettings(payload);
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
      return;
    }

    this.postBusy(true, 'Removing connection...');

    if (this.sessions.hasConnection(profileId)) {
      await this.disconnect(profileId);
    }

    await this.connectionManager.deleteProfile(profileId);
    await this.sendProfiles('');
    RemoteEditSharedState.fireProfilesChanged(undefined, 'webview', 'importBackup');
    this.postMessage(RemoteEditOutboundMessageType.ConnectionFormCleared, {});
    this.postBusy(false, 'Connection removed.');
    this.logInfo('Removed saved connection.', { Name: profile.name, ProfileId: profileId });
  }

  private async connect(payload: any): Promise<void> {
    const clientConnectionId = String(payload?.clientConnectionId || payload?.id || '').trim();
    let options: ConnectOptions;

    try {
      options = await this.connectionManager.buildConnectOptions(payload || {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (clientConnectionId) {
        this.setActiveConnection(clientConnectionId, false);
        this.postBusy(false, 'Connection failed.', false, undefined, clientConnectionId);
        this.postError(message || 'Connection failed.', { connectionId: clientConnectionId, showOutputLink: true });
        return;
      }

      throw error;
    }

    if (!payload?.id && clientConnectionId) {
      options.connectionId = clientConnectionId;
    }

    const connectionId = options.connectionId;
    const target = `${options.username}@${options.host}:${options.port}`;

    if (this.activeConnectionCancellationSources.has(connectionId)) {
      this.postStatus('A connection attempt is already in progress for this tab.', connectionId);
      return;
    }

    const cancellationSource = new vscode.CancellationTokenSource();
    this.activeConnectionCancellationSources.set(connectionId, cancellationSource);
    this.pendingConnectionOptions.set(connectionId, options);
    this.setActiveConnection(connectionId, false);
    this.state.setCurrentPath(connectionId, normalizeRemotePath(options.startPath || '/'));
    this.sendSessions();

    this.postBusy(true, `Connecting to ${options.name || options.host}...`, 'connection', 'Cancel', connectionId);
    this.logInfo('Connecting to remote host.', { Target: target, Protocol: String(options.connectionType || 'sftp').toUpperCase(), Authentication: options.authType });

    let connection;

    try {
      connection = await this.sessions.connect(options, cancellationSource.token);
    } catch (error) {
      const canceled = isRemoteEditOperationCancelled(error)
        || cancellationSource.token.isCancellationRequested
        || ['Connection cancelled', 'Connection canceled'].some(message => String(error instanceof Error ? error.message : error).includes(message));

      if (canceled) {
        this.logInfo('Connection canceled.', { Target: target });
        this.postBusy(false, 'Connection canceled.', false, undefined, connectionId);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const originalMessage = getRemoteConnectOriginalMessage(error);
        const statusMessage = getRemoteConnectStatusMessage(error) || message;
        this.logWarn('Connection failed.', {
          Target: target,
          Error: message,
          OriginalError: originalMessage
        });
        this.postBusy(false, 'Connection failed.', false, undefined, connectionId);
        this.postError(statusMessage || 'Connection failed.', { connectionId, showOutputLink: true });
      }

      return;
    } finally {
      this.activeConnectionCancellationSources.delete(connectionId);
      this.pendingConnectionOptions.delete(connectionId);
      cancellationSource.dispose();
      this.sendSessions();
    }

    if (cancellationSource.token.isCancellationRequested) {
      this.postBusy(false, 'Connection canceled.', false, undefined, connectionId);
      this.logInfo('Connection canceled.', { Target: target });
      return;
    }

    if (payload?.id) {
      await this.connectionManager.applyCredentialPreferences(connection.id, options.authType, payload || {});
      await this.sendProfiles(connection.id);
    }

    this.state.setCurrentPath(connection.id, connection.startPath);
    RemoteEditSharedState.setNavigation(connection.id, connection.startPath, connection.startPath, 'webview');

    if (this.state.getActiveConnectionId() === connection.id || !this.state.getActiveConnectionId()) {
      this.setActiveConnection(connection.id);
      this.updatePanelTitle();
      this.sendSessions();
      await this.listDirectory(connection.startPath);
    } else {
      this.updatePanelTitle();
      this.sendSessions();
    }

    this.logInfo('Connected to remote host.', { Connection: connection.id, Target: target, StartPath: connection.startPath });
    this.postBusy(false, 'Connected.', false, undefined, connection.id);
  }

  private async cancelConnection(payload?: any): Promise<void> {
    const requestedConnectionId = String(payload?.connectionId || this.state.getActiveConnectionId() || '').trim();
    const source = requestedConnectionId
      ? this.activeConnectionCancellationSources.get(requestedConnectionId)
      : Array.from(this.activeConnectionCancellationSources.values())[0];

    if (!source) {
      this.postStatus('No connection attempt is in progress.', requestedConnectionId || undefined);
      return;
    }

    const connectionId = requestedConnectionId || Array.from(this.activeConnectionCancellationSources.entries()).find(([, value]) => value === source)?.[0] || '';
    this.postBusy(true, 'Canceling connection...', 'connection', 'Cancel', connectionId || undefined);
    source.cancel();
  }

  private async disconnect(connectionId: string): Promise<void> {
    this.stopRemoteCommand({ connectionId });

    if (!connectionId) {
      this.postStatus('No active connection.');
      return;
    }

    if (this.activeConnectionCancellationSources.has(connectionId)) {
      await this.cancelConnection({ connectionId });
      return;
    }

    const connection = this.sessions.getConnection(connectionId);
    const removedQueuedTransfers = this.clearQueuedTransfersForConnection(connectionId);

    this.cancelActiveTransfersForConnection(connectionId);

    this.invalidateDirectoryListRequests();
    this.postBusy(true, 'Disconnecting...', false, undefined, connectionId);
    this.disconnectingConnectionIds.add(connectionId);
    try {
      await this.portForwardManager.stopAllForConnection(connectionId);
      await this.sessions.disconnect(connectionId);
    } finally {
      this.disconnectingConnectionIds.delete(connectionId);
    }

    if (removedQueuedTransfers > 0) {
      this.postStatus(`${formatCount(removedQueuedTransfers, 'queued transfer')} removed for disconnected session.`, connectionId);
    }
    remoteClipboardService.clearForConnection(connectionId);
    this.state.deleteConnectionPath(connectionId);
    RemoteEditSharedState.deleteNavigation(connectionId);
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

    this.postBusy(false, 'Disconnected.', false, undefined, connectionId);
    this.logInfo('Disconnected from remote host.', { Connection: connectionId });
  }

  private async switchSession(connectionId: string): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    this.setActiveConnection(connectionId);
    this.updatePanelTitle();
    this.sendSessions();
    this.postRemoteSearchState(connectionId);
    await this.listDirectory(this.getActivePath());
  }

  private async revealConnection(connectionId: string): Promise<void> {
    await this.switchSession(connectionId);
  }

  private async openConnectionPath(connectionId: string, remotePath: string): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    this.setActiveConnection(connectionId);
    this.updatePanelTitle();
    this.state.setCurrentPath(connectionId, normalizeRemotePath(remotePath || '/'));
    this.sendSessions();
    await this.listDirectory(remotePath);
  }

  private async openConnectionFile(connectionId: string, remotePath: string): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    this.setActiveConnection(connectionId);
    this.updatePanelTitle();
    this.sendSessions();
    await this.openFile(remotePath);
  }

  private async openConnectionFileReadOnly(connectionId: string, remotePath: string): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    this.setActiveConnection(connectionId);
    this.updatePanelTitle();
    this.sendSessions();
    await this.openEntriesReadOnly({
      entries: [{
        name: remotePath.split('/').filter(Boolean).pop() || remotePath,
        type: 'file',
        effectiveType: 'file',
        path: remotePath
      }]
    });
  }

  private async createRemoteEntryFromSidebar(connectionId: string, targetDirectory: string, entryKind: 'file' | 'directory'): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    this.setActiveConnection(connectionId);
    this.updatePanelTitle();
    this.sendSessions();
    this.state.setCurrentPath(connectionId, normalizeRemotePath(targetDirectory || '/'));
    await this.requestCreateEntry({}, entryKind);
  }

  private async renameRemoteEntryFromSidebar(connectionId: string, remotePath: string, name: string): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    this.setActiveConnection(connectionId);
    this.updatePanelTitle();
    this.sendSessions();
    this.state.setCurrentPath(connectionId, dirnameRemotePath(remotePath));
    await this.requestRenameEntry({ path: remotePath, name });
  }

  private async deleteRemoteEntryFromSidebar(connectionId: string, remotePath: string, name: string, entryType: string): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    this.setActiveConnection(connectionId);
    this.updatePanelTitle();
    this.sendSessions();
    this.state.setCurrentPath(connectionId, dirnameRemotePath(remotePath));
    await this.requestDeleteEntry({ path: remotePath, name, type: entryType });
  }

  private async showRemoteEntryPropertiesFromSidebar(connectionId: string, remotePath: string): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    const connection = this.sessions.getConnection(connectionId);
    const stats = await this.sessions.stat(connectionId, remotePath);
    const name = remotePath.split('/').filter(Boolean).pop() || remotePath;
    const rows = [
      ['Name', name],
      ['Remote path', remotePath],
      ['Type', stats.type],
      ['Size', stats.type === 'directory' ? '—' : formatBytes(stats.size)],
      ['Modified', formatTimestampForDialog(stats.modifyTime)],
      ['Accessed', formatTimestampForDialog(stats.accessTime)],
      ['Connection', connection?.name || connectionId],
      ['Host', connection ? `${connection.username}@${connection.host}:${connection.port}` : connectionId]
    ];

    await vscode.window.showQuickPick(
      rows.map(([label, value]) => ({ label, description: value })),
      { title: `${stats.type === 'directory' ? 'Directory' : 'File'} Properties`, placeHolder: remotePath }
    );
  }

  private async calculateRemoteChecksumsFromSidebar(connectionId: string, remotePath: string, name: string): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    this.setActiveConnection(connectionId);
    this.updatePanelTitle();
    this.sendSessions();
    await this.requestCalculateChecksums({ path: remotePath, name, type: 'file' });
  }

  private async setRemotePermissionsFromSidebar(connectionId: string, remotePath: string, name: string, entryType: string, permissions?: string): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    const currentPermissions = String(permissions || '').trim();
    const mode = await vscode.window.showInputBox({
      title: 'Remote Edit: Set Permissions',
      prompt: `Enter the octal permissions for ${name || remotePath}.`,
      placeHolder: '0755',
      value: currentPermissions && /^[0-7]{3,4}$/.test(currentPermissions) ? currentPermissions : '',
      validateInput: (value: string) => /^[0-7]{3,4}$/.test(String(value || '').trim()) ? undefined : 'Enter a valid octal mode using 3 or 4 digits from 0 to 7.'
    });

    if (mode === undefined) {
      return;
    }

    const normalizedMode = mode.trim().padStart(4, '0');
    let recursive = false;

    if (entryType === 'directory') {
      const choice = await vscode.window.showQuickPick(['This directory only', 'Apply recursively'], {
        title: 'Remote Edit: Set Permissions',
        placeHolder: 'Choose how to apply permissions.'
      });

      if (!choice) {
        return;
      }

      recursive = choice === 'Apply recursively';
    }

    this.setActiveConnection(connectionId);
    this.updatePanelTitle();
    this.sendSessions();
    this.state.setCurrentPath(connectionId, dirnameRemotePath(remotePath));
    await this.sessions.chmod(connectionId, remotePath, normalizedMode, { recursive });
    this.logInfo('Set remote permissions.', {
      Mode: normalizedMode,
      Recursive: recursive ? 'Yes' : 'No',
      Path: this.buildRemoteReference(remotePath)
    });
    await this.listDirectory(dirnameRemotePath(remotePath));
    this.postBusy(false, `Permissions set to ${normalizedMode}.`, false, undefined, connectionId);
  }

  private showCommandError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logError('Remote Edit command failed.', { Details: message });
    void vscode.window.showErrorMessage(message);
  }

  private async refreshCurrentDirectoryFromSharedChange(connectionId: string, remotePath: string): Promise<void> {
    if (this.isDisposed || !this.panel) {
      return;
    }

    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      return;
    }

    if (this.state.getActiveConnectionId() !== connectionId) {
      return;
    }

    const normalizedPath = normalizeRemotePath(remotePath || '/');
    const currentPath = normalizeRemotePath(this.getActivePath() || '/');

    if (currentPath !== normalizedPath) {
      return;
    }

    await this.listDirectory(normalizedPath, { forceRefresh: true });
  }

  private async listDirectory(remotePath: string, options: { forceRefresh?: boolean } = {}): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const normalizedPath = normalizeRemotePath(remotePath);
    const requestSequence = ++this.directoryListRequestSequence;

    this.postBusy(true, `Loading ${normalizedPath}...`, false, undefined, connectionId);

    let entries: RemoteEntry[];

    try {
      entries = await this.withDirectoryListTimeout(
        this.sessions.listDirectory(connectionId, normalizedPath, { forceRefresh: Boolean(options.forceRefresh) }),
        normalizedPath
      );
    } catch (error) {
      if (this.isStaleDirectoryListRequest(requestSequence, connectionId)) {
        return;
      }

      this.postBusy(false, 'Directory listing failed.', false, undefined, connectionId);
      throw error;
    }

    if (this.isStaleDirectoryListRequest(requestSequence, connectionId)) {
      return;
    }

    const visibleEntries = normalizedPath === '/' ? entries : [this.buildParentEntry(normalizedPath), ...entries];

    this.state.setCurrentPath(connectionId, normalizedPath);
    RemoteEditSharedState.setNavigation(connectionId, normalizedPath, normalizedPath, 'webview');
    this.postMessage(RemoteEditOutboundMessageType.DirectoryListed, {
      connectionId,
      path: normalizedPath,
      entries: visibleEntries
    });
    this.sendSessions();

    this.logDebug('Listed remote directory.', { Connection: connectionId, Path: normalizedPath, Items: entries.length });
    this.postBusy(false, `Loaded ${formatCount(entries.length, 'item')}.`, false, undefined, connectionId);
  }

  private async withDirectoryListTimeout<T>(operation: Promise<T>, remotePath: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`Directory listing timed out after ${Math.round(DIRECTORY_LIST_TIMEOUT_MS / 1000)} seconds: ${remotePath}`));
          }, DIRECTORY_LIST_TIMEOUT_MS);
        })
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }


  private handleRemoteEntryMetadataUpdated(event: RemoteEntryMetadataUpdate): void {
    if (this.isDisposed || !this.panel || !event || !event.updates.length) {
      return;
    }

    const connectionId = String(event.connectionId || '');
    const normalizedPath = normalizeRemotePath(event.path || '/');

    if (!connectionId || this.state.getActiveConnectionId() !== connectionId || !this.sessions.hasConnection(connectionId)) {
      return;
    }

    if (normalizeRemotePath(this.getActivePath() || '/') !== normalizedPath) {
      return;
    }

    this.postMessage(RemoteEditOutboundMessageType.DirectoryMetadataUpdated, {
      connectionId,
      path: normalizedPath,
      updates: event.updates
    });
  }

  private invalidateDirectoryListRequests(): void {
    this.directoryListRequestSequence += 1;
  }

  private isStaleDirectoryListRequest(requestSequence: number, connectionId: string): boolean {
    return requestSequence !== this.directoryListRequestSequence
      || this.state.getActiveConnectionId() !== connectionId
      || !this.sessions.hasConnection(connectionId);
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
      throw new Error(readOnly ? 'Select a remote file to view read-only.' : 'Select a remote file to view/edit.');
    }

    const resolvedEntries: Array<{ name: string; type: string; effectiveType: string; path: string; resolvedType: string }> = [];

    for (const entry of entries) {
      resolvedEntries.push({
        ...entry,
        resolvedType: await this.resolveOpenableEntryType(entry.path, entry.type, entry.effectiveType, connectionId)
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
      : `${readOnly ? 'Opening read-only' : 'Opening'} ${resolvedEntries.length} remote files...`, false, undefined, connectionId);

    const failedEntries: Array<{ path: string; error: string }> = [];

    for (const entry of resolvedEntries) {
      const uri = buildRemoteEditUri(connectionId, entry.path, this.getActiveUriAuthority(), { readOnly, openSource: 'webview' });

      try {
        await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
        this.logInfo(readOnly ? 'Opened remote file read-only.' : 'Opened remote file.', { Path: this.buildRemoteReference(entry.path) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failedEntries.push({ path: entry.path, error: message });
        this.logWarn(readOnly ? 'Failed to open remote file read-only.' : 'Failed to open remote file.', { Path: this.buildRemoteReference(entry.path), Details: message });
      }
    }

    if (failedEntries.length) {
      if (resolvedEntries.length === 1) {
        const failed = failedEntries[0];
        await this.showRemoteFileOpenFailureDialog(
          readOnly ? 'Could not open remote file read-only' : 'Could not open remote file',
          failed.path,
          formatRemoteFileOpenFailureReason(failed.error, failed.path)
        );
      } else {
        const openedCount = resolvedEntries.length - failedEntries.length;
        const detail = failedEntries
          .map(item => `Path: ${item.path}\nReason: ${formatRemoteFileOpenFailureReason(item.error, item.path)}`)
          .join('\n\n');
        await this.showConfirmDialog({
          title: 'Some remote files could not be opened',
          message: `Opened ${openedCount} of ${formatCount(resolvedEntries.length, 'remote file')}.`,
          details: detail,
          confirmLabel: 'OK',
          hideCancel: true
        });
      }
    }

    const openSuccessMessage = failedEntries.length
      ? failedEntries.length === resolvedEntries.length
        ? (readOnly ? 'Remote file could not be opened read-only.' : 'Remote file could not be opened.')
        : `Opened ${resolvedEntries.length - failedEntries.length} of ${formatCount(resolvedEntries.length, 'remote file')}.`
      : resolvedEntries.length === 1
        ? (readOnly ? 'File opened read-only.' : 'File opened.')
        : (readOnly
          ? `${formatCount(resolvedEntries.length, 'remote file')} opened read-only.`
          : `${formatCount(resolvedEntries.length, 'remote file')} opened.`);

    this.postBusy(false, openSuccessMessage, false, undefined, connectionId);
  }

  private async compareSelectedEntries(payload: any): Promise<void> {
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

    if (entries.length !== 2) {
      throw new Error('Select exactly two remote files to compare.');
    }

    const resolvedEntries: Array<{ name: string; type: string; effectiveType: string; path: string; resolvedType: string }> = [];
    for (const entry of entries) {
      resolvedEntries.push({
        ...entry,
        resolvedType: await this.resolveOpenableEntryType(entry.path, entry.type, entry.effectiveType, connectionId)
      });
    }

    const unsupportedEntry = resolvedEntries.find(entry => entry.resolvedType !== 'file');
    if (unsupportedEntry) {
      throw new Error('Only files can be compared.');
    }

    const [left, right] = resolvedEntries;
    this.postBusy(true, `Comparing ${left.name || left.path} and ${right.name || right.path}...`, false, undefined, connectionId);

    try {
      await withRemoteEditProgress(
        'Preparing remote file comparison...',
        async (token, progress) => {
          await this.sessions.prepareFileForOpen(connectionId, left.path, token, progress);
          throwIfCancelled(token, 'Compare canceled.');
          await this.sessions.prepareFileForOpen(connectionId, right.path, token, progress);
          throwIfCancelled(token, 'Compare canceled.');
        },
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Compare canceled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Compare canceled.', false, undefined, connectionId);
        this.logInfo('Remote file compare canceled.');
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
    this.postBusy(false, 'Comparison opened.', false, undefined, connectionId);
  }

  private async resolveOpenableEntryType(remotePath: string, entryType?: string, entryEffectiveType?: string, connectionId?: string): Promise<'file' | 'directory' | 'unknown'> {
    if (entryEffectiveType === 'file' || entryEffectiveType === 'directory') {
      return entryEffectiveType;
    }

    if (entryType === 'file' || entryType === 'directory') {
      return entryType;
    }

    const stats = await this.sessions.stat(connectionId || this.requireActiveConnectionId(), remotePath);
    return stats.type;
  }

  private async openPath(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();

    const rawPath = String(payload?.path || '').trim();

    if (!rawPath) {
      throw new Error('Enter a remote path to open.');
    }

    const remotePath = normalizeRemotePath(rawPath);
    this.postBusy(true, `Opening ${remotePath}...`, false, undefined, connectionId);
    const stats = await this.sessions.stat(connectionId, remotePath);

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
    RemoteEditSharedState.fireFavoritesChanged(connectionId, 'webview');
    await this.sendProfiles(connectionId);
    this.logInfo('Added remote path favorite.', { Connection: connectionId, Path: remotePath });
  }

  private async removeRemotePathFavorite(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || this.getActivePath() || '').trim());

    await this.connectionManager.removeFavoriteRemotePath(connectionId, remotePath);
    RemoteEditSharedState.fireFavoritesChanged(connectionId, 'webview');
    await this.sendProfiles(connectionId);
    this.logInfo('Removed remote path favorite.', { Connection: connectionId, Path: remotePath });
  }

  private async openFile(remotePath: string): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const normalizedPath = normalizeRemotePath(remotePath);
    const uri = buildRemoteEditUri(connectionId, normalizedPath, this.getActiveUriAuthority(), { openSource: 'webview' });

    await vscode.commands.executeCommand('vscode.open', uri, { preview: false });

    this.logInfo('Opened remote file.', { Path: this.buildRemoteReference(normalizedPath) });
    this.postBusy(false, 'File opened.', false, undefined, connectionId);
  }

  private async copyRemotePath(payload: any): Promise<void> {
    this.requireActiveConnectionId();

    const remotePath = normalizeRemotePath(String(payload?.path || this.getActivePath() || '/'));
    const remoteReference = this.buildRemoteReference(remotePath);
    await vscode.env.clipboard.writeText(remoteReference);
    this.postStatusCopyFeedback('Copied');
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

    const newName = await this.showWebviewInputBox({
      title: entryKind === 'directory' ? 'Create New Directory' : 'Create New File',
      prompt: `Enter the name for the new remote ${label}.`,
      placeHolder: entryKind === 'directory' ? 'new-folder' : 'new-file.txt',
      label: entryKind === 'directory' ? 'Directory name' : 'File name',
      confirmLabel: 'Create',
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
      return;
    }

    const trimmedName = newName.trim();
    const newPath = joinRemotePath(targetDirectory, trimmedName);

    await this.ensureRemotePathDoesNotExist(connectionId, newPath, label);

    this.postBusy(true, `Creating ${label} ${trimmedName}...`, false, undefined, connectionId);

    if (entryKind === 'directory') {
      await this.sessions.createDirectory(connectionId, newPath);
    } else {
      await this.sessions.createFile(connectionId, newPath);
    }

    this.logInfo(`Created remote ${label}.`, { Path: this.buildRemoteReference(newPath) });
    await this.listDirectory(targetDirectory);
    RemoteEditSharedState.fireRemoteDirectoryChanged(connectionId, targetDirectory, 'webview');
    this.postBusy(false, `Created ${trimmedName}.`, false, undefined, connectionId);
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

    const copyName = await this.showWebviewInputBox({
      title: 'Make a Copy',
      prompt: 'Enter the name for the remote file copy.',
      label: 'Copy name',
      value: defaultName,
      valueSelection: [0, defaultName.length],
      confirmLabel: 'Copy',
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
        return;
      }

      overwrite = true;
    }

    this.postBusy(true, `Copying ${currentName}...`, false, undefined, connectionId);

    try {
      await withRemoteEditProgress(
        'Copying remote file...',
        async token => {
          await this.sessions.copyFile(connectionId, remotePath, newPath, overwrite, token);
        },
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Copy canceled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Copy canceled.', false, undefined, connectionId);
        return;
      }

      this.postBusy(false, 'Copy failed.', false, undefined, connectionId);
      throw error;
    }

    this.logInfo('Copied remote file.', { From: this.buildRemoteReference(remotePath), To: this.buildRemoteReference(newPath) });
    await this.listDirectory(parentPath);
    this.postBusy(false, `Copied to ${trimmedName}.`, false, undefined, connectionId);
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
    this.postBusy(true, `Calculating checksums for ${entryName}...`, false, undefined, connectionId);

    try {
      const result = await withRemoteEditProgress(
        'Calculating remote checksums...',
        async (token, progress) => {
          progress.reportMessage('Calculating SHA-256 and MD5 on the server...');
          const checksums = await this.sessions.calculateChecksums(connectionId, remotePath, token);
          throwIfCancelled(token, 'Checksum calculation canceled.');
          return checksums;
        },
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Checksum calculation canceled.' }
      );

      await this.showChecksumsResult(remotePath, stats.size, stats.modifyTime, result);

      this.logInfo('Calculated remote file checksums.', {
        Path: this.buildRemoteReference(remotePath),
        SHA256: result.sha256.value || result.sha256.error || 'Not available',
        MD5: result.md5.value || result.md5.error || 'Not available'
      });
      this.postBusy(false, `Calculated checksums for ${entryName}.`, false, undefined, connectionId);
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Checksum calculation canceled.', false, undefined, connectionId);
        return;
      }

      this.postBusy(false, 'Checksum calculation failed.', false, undefined, connectionId);
      throw error;
    }
  }

  private async showChecksumsResult(remotePath: string, size: number, modifyTime: number, result: RemoteChecksumSummary): Promise<void> {
    this.postMessage(RemoteEditOutboundMessageType.ShowChecksumsDialog, buildChecksumsDialogPayload(remotePath, size, modifyTime, result));
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

    const newName = await this.showWebviewInputBox({
      title: 'Rename',
      prompt: 'Enter the new name for the selected remote item.',
      label: 'New name',
      value: currentName,
      valueSelection: [0, currentName.length],
      confirmLabel: 'Rename',
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
      return;
    }

    const trimmedName = newName.trim();

    if (trimmedName === currentName) {
      this.postStatus('Rename skipped: the new name is the same as the current name.');
      return;
    }

    const parentPath = dirnameRemotePath(remotePath);
    const newPath = joinRemotePath(parentPath, trimmedName);

    this.postBusy(true, `Renaming ${currentName}...`, false, undefined, connectionId);
    await this.sessions.rename(connectionId, remotePath, newPath);
    this.logInfo('Renamed remote item.', { From: this.buildRemoteReference(remotePath), To: this.buildRemoteReference(newPath) });
    await this.listDirectory(parentPath);
    this.postBusy(false, 'Item renamed.', false, undefined, connectionId);
  }



  private buildRemoteClipboardItemsFromPayloadEntries(rawEntries: any[]): RemoteClipboardItem[] {
    return (Array.isArray(rawEntries) ? rawEntries : [])
      .map((entry: any) => {
        const remotePath = normalizeRemotePath(String(entry?.path || ''));
        const name = String(entry?.name || remotePath.split('/').filter(Boolean).pop() || '').trim();
        const type = String(entry?.effectiveType || entry?.type || 'unknown').toLowerCase();
        return {
          name,
          path: remotePath,
          type: type === 'file' || type === 'directory' || type === 'link' ? type : 'unknown'
        } satisfies RemoteClipboardItem;
      })
      .filter((entry: RemoteClipboardItem) => Boolean(entry.path) && entry.path !== '/' && entry.name && entry.name !== '..');
  }

  private async requestCutRemoteEntries(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const connection = this.sessions.getConnection(connectionId);

    if (!connection) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    const items = this.buildRemoteClipboardItemsFromPayloadEntries(payload?.entries);
    const state = remoteClipboardService.setCut(connection, items);
    const itemText = formatCount(state.items.length, 'remote item');
    this.postStatus(`Cut ${itemText}. Go to a folder in the same connection and choose Paste.`, connectionId);
    this.logInfo('Cut remote item(s).', {
      Connection: connectionId,
      Items: state.items.map(item => item.path).join(', ')
    });
  }

  private async requestPasteRemoteEntries(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const connection = this.sessions.getConnection(connectionId);

    if (!connection) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    const state = remoteClipboardService.requirePasteState(connection);
    const targetDirectory = normalizeRemotePath(String(payload?.targetDirectory || payload?.path || this.getActivePath()));
    const itemText = formatCount(state.items.length, 'remote item');

    this.postBusy(true, `Moving ${itemText}...`, false, undefined, connectionId);

    try {
      const result = await this.remoteMoveService.moveItems({
        connectionId,
        targetDirectory,
        items: state.items
      });

      remoteClipboardService.clear();
      this.logInfo('Moved remote item(s).', {
        Connection: connectionId,
        Destination: this.buildRemoteReference(result.targetDirectory),
        Items: state.items.map(item => item.path).join(', ')
      });
      RemoteEditSharedState.fireRemoteDirectoryChanged(connectionId, result.targetDirectory, 'webview');
      for (const sourceDirectory of result.sourceDirectories) {
        RemoteEditSharedState.fireRemoteDirectoryChanged(connectionId, sourceDirectory, 'webview');
      }
      await this.listDirectory(result.targetDirectory, { forceRefresh: true });
      this.postBusy(false, `Moved ${formatCount(result.moved, 'remote item')}.`, false, undefined, connectionId);
    } catch (error) {
      this.postBusy(false, 'Move failed.', false, undefined, connectionId);
      throw error;
    }
  }

  private async requestMoveRemoteEntries(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const connection = this.sessions.getConnection(connectionId);

    if (!connection) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    const payloadConnectionId = String(payload?.connectionId || connectionId);
    if (payloadConnectionId !== connectionId) {
      throw new Error('Remote drag-and-drop move is only available in the original connection.');
    }

    const items = this.buildRemoteClipboardItemsFromPayloadEntries(payload?.entries);
    if (!items.length) {
      throw new Error('Select one or more remote files or folders to move.');
    }

    const targetDirectory = normalizeRemotePath(String(payload?.targetDirectory || payload?.path || this.getActivePath()));
    const currentDirectory = normalizeRemotePath(this.getActivePath());
    const itemText = formatCount(items.length, 'remote item');

    this.postBusy(true, `Moving ${itemText}...`, false, undefined, connectionId);

    try {
      const result = await this.remoteMoveService.moveItems({
        connectionId,
        targetDirectory,
        items
      });

      this.logInfo('Moved remote item(s) by drag-and-drop.', {
        Connection: connectionId,
        Destination: this.buildRemoteReference(result.targetDirectory),
        Items: items.map(item => item.path).join(', ')
      });
      RemoteEditSharedState.fireRemoteDirectoryChanged(connectionId, result.targetDirectory, 'webview');
      for (const sourceDirectory of result.sourceDirectories) {
        RemoteEditSharedState.fireRemoteDirectoryChanged(connectionId, sourceDirectory, 'webview');
      }
      await this.listDirectory(currentDirectory, { forceRefresh: true });
      this.postBusy(false, `Moved ${formatCount(result.moved, 'remote item')}.`, false, undefined, connectionId);
    } catch (error) {
      this.postBusy(false, 'Move failed.', false, undefined, connectionId);
      throw error;
    }
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
      return;
    }

    const parentPath = dirnameRemotePath(remotePath);
    this.postBusy(true, `Deleting ${entryName}...`, false, undefined, connectionId);
    await this.sessions.delete(connectionId, remotePath);
    this.logInfo('Deleted remote item.', { Path: this.buildRemoteReference(remotePath) });
    await this.listDirectory(parentPath);
    RemoteEditSharedState.fireRemoteDirectoryChanged(connectionId, parentPath, 'webview');
    this.postBusy(false, `Deleted ${entryName}.`, false, undefined, connectionId);
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
      return;
    }

    this.postBusy(true, `Deleting ${entries.length} remote items...`, false, undefined, connectionId);

    for (const entry of entries) {
      await this.sessions.delete(connectionId, entry.path);
      this.logInfo('Deleted remote item.', { Path: this.buildRemoteReference(entry.path) });
    }

    const currentPath = this.getActivePath();
    await this.listDirectory(currentPath);
    RemoteEditSharedState.fireRemoteDirectoryChanged(connectionId, currentPath, 'webview');
    this.postBusy(false, `${formatCount(entries.length, 'item')} deleted.`, false, undefined, connectionId);
  }


  private async requestCompressArchive(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const format = normalizeArchiveFormat(String(payload?.format || ''));
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
    const archiveNameInput = await this.showWebviewInputBox({
      title: 'Compress to Archive',
      prompt: 'Enter the archive filename to create in the current remote directory.',
      label: 'Archive name',
      value: defaultName,
      valueSelection: [0, defaultName.length],
      confirmLabel: 'Create',
      validateInput: value => {
        const normalized = normalizeArchiveName(value, format);
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
      return;
    }

    const archiveName = normalizeArchiveName(archiveNameInput, format);
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
        return;
      }

      overwrite = true;
    }

    this.postBusy(true, `Creating ${archiveName}...`, false, undefined, connectionId);

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
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Archive creation canceled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Archive creation canceled.', false, undefined, connectionId);
        return;
      }

      this.postBusy(false, 'Archive creation failed.', false, undefined, connectionId);
      throw error;
    }

    this.logInfo('Created remote archive.', {
      Archive: this.buildRemoteReference(archivePath),
      Format: format,
      Items: entries.map(entry => entry.name).join(', ')
    });
    await this.listDirectory(baseDirectory);
    this.postBusy(false, `Created ${archiveName}.`, false, undefined, connectionId);
  }


  private async requestUploadEntries(payload: any): Promise<void> {
    const connectionId = this.requireTransferConnectionId(payload);
    const targetDirectory = normalizeRemotePath(String(payload?.targetDirectory || payload?.path || this.getActivePath()));
    const mode = String(payload?.mode || 'all');
    const transferSource = this.getTransferRequestSource(payload);
    const folderOnly = mode === 'folder';
    const filesOnly = mode === 'files';

    const selectedUris = await vscode.window.showOpenDialog({
      title: folderOnly ? 'Remote Edit: Upload Folder' : filesOnly ? 'Remote Edit: Upload Files' : 'Remote Edit: Upload Files or Folders',
      openLabel: 'Upload',
      canSelectFiles: !folderOnly,
      canSelectFolders: !filesOnly,
      canSelectMany: true
    });

    if (!selectedUris?.length) {
      this.logInfo('Upload selection canceled.');
      return;
    }

    this.enqueueTransferJob({
      id: this.createTransferJobId(),
      operation: 'Upload',
      source: transferSource,
      connectionId,
      connectionLabel: this.buildTransferConnectionLabel(connectionId),
      title: buildSelectedLocalItemsLabel(selectedUris),
      from: buildUploadQueueSourceLabel(selectedUris),
      to: buildUploadQueueTargetLabel(selectedUris, targetDirectory),
      progress: '--',
      run: cancellationSource => this.runUploadTransfer(connectionId, targetDirectory, selectedUris, cancellationSource)
    });
  }

  private async requestDroppedUploadEntries(payload: any): Promise<void> {
    const connectionId = this.requireTransferConnectionId(payload);
    const targetDirectory = normalizeRemotePath(String(payload?.targetDirectory || payload?.path || this.getActivePath()));
    const transferSource = this.getTransferRequestSource(payload);
    const localEntries = this.parseDroppedUploadEntries(payload?.items);

    if (!localEntries.length) {
      throw new Error('Drop files or folders from the local file system to upload.');
    }

    this.enqueueTransferJob({
      id: this.createTransferJobId(),
      operation: 'Upload',
      source: transferSource,
      connectionId,
      connectionLabel: this.buildTransferConnectionLabel(connectionId),
      title: this.buildDroppedUploadTitle(localEntries),
      from: this.buildDroppedUploadSourceLabel(localEntries),
      to: this.buildDroppedUploadTargetLabel(localEntries, targetDirectory),
      progress: '--',
      run: cancellationSource => this.runUploadTransfer(connectionId, targetDirectory, [], cancellationSource, localEntries)
    });
  }

  private async requestSidebarDroppedUploadEntries(
    payload: any,
    droppedLocalEntries: readonly LocalUploadEntry[] = []
  ): Promise<void> {
    const connectionId = this.requireTransferConnectionId(payload);
    const targetDirectory = normalizeRemotePath(String(payload?.targetDirectory || payload?.path || this.getActivePath()));
    const transferSource = this.getTransferRequestSource(payload);
    const localEntries = this.parseDroppedUploadEntries(droppedLocalEntries);

    if (!localEntries.length) {
      throw new Error('Drop files or folders from the local file system to upload.');
    }

    this.enqueueTransferJob({
      id: this.createTransferJobId(),
      operation: 'Upload',
      source: transferSource,
      connectionId,
      connectionLabel: this.buildTransferConnectionLabel(connectionId),
      title: this.buildDroppedUploadTitle(localEntries),
      from: this.buildDroppedUploadSourceLabel(localEntries),
      to: this.buildDroppedUploadTargetLabel(localEntries, targetDirectory),
      progress: '--',
      run: cancellationSource => this.runUploadTransfer(connectionId, targetDirectory, [], cancellationSource, localEntries)
    });
  }

  private async beginDroppedUploadEntries(payload: any): Promise<void> {
    const sessionId = String(payload?.sessionId || '').trim();
    const connectionId = this.requireTransferConnectionId(payload);
    const targetDirectory = normalizeRemotePath(String(payload?.targetDirectory || payload?.path || this.getActivePath()));
    const transferSource = this.getTransferRequestSource(payload);

    await this.droppedUploadStaging.begin({
      sessionId,
      connectionId,
      targetDirectory,
      source: transferSource,
      items: Array.isArray(payload?.items) ? payload.items : []
    });

    this.postMessage(RemoteEditOutboundMessageType.DroppedUploadSessionReady, { sessionId });
  }

  private async writeDroppedUploadChunk(payload: any): Promise<void> {
    const sessionId = String(payload?.sessionId || '').trim();
    const relativePath = this.normalizeDroppedUploadRelativePath(payload?.relativePath || '');
    const chunkIndex = Number(payload?.chunkIndex || 0);

    await this.droppedUploadStaging.writeChunk({
      sessionId,
      relativePath,
      chunkIndex,
      data: String(payload?.data || '')
    });

    this.postMessage(RemoteEditOutboundMessageType.DroppedUploadChunkWritten, { sessionId, relativePath, chunkIndex });
  }

  private async finishDroppedUploadEntries(payload: any): Promise<void> {
    const stagedTransfer = await this.droppedUploadStaging.finish(String(payload?.sessionId || ''));
    const localEntries = stagedTransfer.entries;

    if (!localEntries.length) {
      await this.droppedUploadStaging.cleanupRoot(stagedTransfer.rootDirectory);
      throw new Error('Drop files or folders from the local file system to upload.');
    }

    this.enqueueTransferJob({
      id: this.createTransferJobId(),
      operation: 'Upload',
      source: stagedTransfer.source,
      connectionId: stagedTransfer.connectionId,
      connectionLabel: this.buildTransferConnectionLabel(stagedTransfer.connectionId),
      title: this.buildDroppedUploadTitle(localEntries),
      from: this.buildDroppedUploadSourceLabel(localEntries),
      to: this.buildDroppedUploadTargetLabel(localEntries, stagedTransfer.targetDirectory),
      progress: '--',
      run: cancellationSource => this.runUploadTransfer(stagedTransfer.connectionId, stagedTransfer.targetDirectory, [], cancellationSource, localEntries),
      cleanup: () => this.droppedUploadStaging.cleanupRoot(stagedTransfer.rootDirectory)
    });
  }

  private async cancelDroppedUploadEntries(payload: any): Promise<void> {
    await this.droppedUploadStaging.cancel(String(payload?.sessionId || ''));
  }

  private parseDroppedUploadEntries(value: any): LocalUploadEntry[] {
    const rawItems = Array.isArray(value) ? value : [];
    const entries: LocalUploadEntry[] = [];
    const seen = new Set<string>();

    for (const item of rawItems) {
      const kind: LocalUploadEntry['kind'] = String(item?.kind || '').toLowerCase() === 'directory' ? 'directory' : 'file';
      const localPath = String(item?.localPath || '').trim();
      const relativePath = this.normalizeDroppedUploadRelativePath(item?.relativePath || item?.name || (localPath ? path.basename(localPath) : ''));

      if (!relativePath) {
        continue;
      }

      if (kind === 'file' && !localPath) {
        continue;
      }

      const size = Number(item?.size || 0);
      const key = `${kind}:${relativePath}:${localPath}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      entries.push({
        kind,
        localPath: localPath || undefined,
        relativePath,
        size: Number.isFinite(size) && size > 0 ? size : undefined
      });
    }

    return entries;
  }

  private normalizeDroppedUploadRelativePath(value: any): string {
    return normalizeDroppedUploadRelativePath(value);
  }

  private getDroppedUploadTopLevelNames(entries: readonly LocalUploadEntry[]): string[] {
    const names = new Set<string>();

    for (const entry of entries) {
      const [topLevelName] = entry.relativePath.split('/').filter(Boolean);
      if (topLevelName) {
        names.add(topLevelName);
      }
    }

    return Array.from(names);
  }

  private buildDroppedUploadTitle(entries: readonly LocalUploadEntry[]): string {
    const names = this.getDroppedUploadTopLevelNames(entries);

    if (names.length === 1) {
      return names[0];
    }

    return `${names.length || entries.length} dropped items`;
  }

  private buildDroppedUploadSourceLabel(entries: readonly LocalUploadEntry[]): string {
    const fileEntries = entries.filter(entry => entry.kind === 'file' && entry.localPath);
    const names = this.getDroppedUploadTopLevelNames(entries);

    if (fileEntries.length === 1 && names.length === 1) {
      return fileEntries[0].localPath || names[0];
    }

    return `${names.length || entries.length} dropped items`;
  }

  private buildDroppedUploadTargetLabel(entries: readonly LocalUploadEntry[], targetDirectory: string): string {
    const names = this.getDroppedUploadTopLevelNames(entries);

    if (names.length === 1) {
      return joinRemoteRelativePath(targetDirectory, names[0]);
    }

    return normalizeRemotePath(targetDirectory);
  }


  private requireTransferConnectionId(payload: any): string {
    const payloadConnectionId = String(payload?.connectionId || '').trim();

    if (payloadConnectionId) {
      if (!this.sessions.getConnection(payloadConnectionId)) {
        throw new Error('The selected remote connection is no longer active.');
      }

      return payloadConnectionId;
    }

    return this.requireActiveConnectionId();
  }

  private async runUploadTransfer(
    connectionId: string,
    targetDirectory: string,
    selectedUris: readonly vscode.Uri[],
    transferCancellationSource: vscode.CancellationTokenSource,
    localEntries?: readonly LocalUploadEntry[]
  ): Promise<TransferCompletionStatus> {
    this.postStatus('Preparing upload...');
    this.setActiveTransferProgress('Preparing upload...');

    const token = transferCancellationSource.token;
    const summary: TransferSummary = { transferredFiles: 0, skippedItems: [], failedItems: [], canceledItems: [] };
    const skipped = createTransferSkipState();
    throwIfCancelled(token, 'Upload canceled.');
    const items = localEntries?.length
      ? await this.collectDroppedUploadTransferItems(localEntries, targetDirectory, summary, token)
      : await this.collectUploadTransferItems(selectedUris, targetDirectory, summary, token);
    throwIfCancelled(token, 'Upload canceled.');

    if (!items.length) {
      const completionStatus = getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Upload', buildTransferCompletionStatusText('Upload', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
      this.postStatus(buildTransferStatusMessage('Upload', summary));
      await this.showTransferSummary('Upload', summary);
      return completionStatus;
    }

    try {
      await this.prepareUploadConflicts(connectionId, items, summary, skipped, token);
    } catch (error) {
      if (formatTransferError(error) === 'Upload canceled.') {
        addCanceledTransferItem(summary, '');
        this.setActiveTransferResultSummary(summary);
        this.logActiveTransferEvent('Upload', 'Upload canceled during conflict resolution.', { SkippedItems: summary.skippedItems.length });
        this.postStatus('Upload canceled.');
        return 'Canceled';
      }
      throw error;
    }

    const remainingItems = items.filter(item => !shouldSkipTransferItem(item.relativePath, skipped));

    if (!remainingItems.length) {
      const completionStatus = getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Upload', buildTransferCompletionStatusText('Upload', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
      this.postStatus(buildTransferStatusMessage('Upload', summary));
      await this.showTransferSummary('Upload', summary);
      return completionStatus;
    }

    const uploadFileItems = remainingItems.filter(item => item.kind === 'file');
    const totalBytes = uploadFileItems.reduce((sum, item) => sum + item.size, 0);
    const aggregateState: AggregateTransferState = { completedBytes: 0, totalBytes };

    let uploadCanceled = false;
    this.postStatus('Uploading...');
    this.setActiveTransferStatus('Running');
    this.setActiveTransferProgress('Starting upload...');

    try {
      await withRemoteEditProgress(
        'Uploading...',
        async (token, progress) => {
          for (const item of remainingItems.filter(item => item.kind === 'directory')) {
            throwIfCancelled(token, 'Upload canceled.');

            try {
              await this.sessions.createDirectory(connectionId, item.remotePath);
            } catch (error) {
              if (isTransferCancellationError(error, token)) {
                addCanceledTransferItem(summary, item.relativePath);
                throw new RemoteEditOperationCancelledError('Upload canceled.');
              }
              summary.failedItems.push(`${item.relativePath}: ${formatTransferError(error)}`);
            }
          }

          for (const [index, item] of uploadFileItems.entries()) {
            const progressDetail = buildTransferProgressDetail(item.relativePath, index + 1, uploadFileItems.length);
            throwIfCancelled(token, 'Upload canceled.');

            try {
              await this.sessions.createDirectory(connectionId, dirnameRemotePath(item.remotePath));
              throwIfCancelled(token, 'Upload canceled.');
              const content = await readLocalFileWithCancellation(item.localPath, token);
              throwIfCancelled(token, 'Upload canceled.');
              await this.sessions.writeFile(
                connectionId,
                item.remotePath,
                content,
                this.createAggregateProgress(progress, 'Uploading...', aggregateState, item.size, progressDetail),
                token
              );
              throwIfCancelled(token, 'Upload canceled.');
              aggregateState.completedBytes += item.size;
              progress.reportBytes('Uploading...', aggregateState.completedBytes, aggregateState.totalBytes, progressDetail);
              summary.transferredFiles += 1;
            } catch (error) {
              if (isTransferCancellationError(error, token)) {
                addCanceledTransferItem(summary, item.relativePath);
                throw new RemoteEditOperationCancelledError('Upload canceled.');
              }
              summary.failedItems.push(`${item.relativePath}: ${formatTransferError(error)}`);
            }
          }
        },
        {
          cancellable: true,
          returnOnCancel: false,
          cancelMessage: 'Upload canceled.',
          cancellationSource: transferCancellationSource,
          suppressNotification: true
        }
      ).catch(error => {
        if (isRemoteEditOperationCancelled(error)) {
          uploadCanceled = true;
          if (!summary.canceledItems.length) {
            addCanceledTransferItem(summary, '');
          }
          this.logActiveTransferEvent('Upload', 'Upload canceled.', { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
          return;
        }
        throw error;
      });
    } finally {
      await this.refreshUploadTargetDirectory(connectionId, targetDirectory);
    }

    if (uploadCanceled) {
      this.setActiveTransferResultSummary(summary);
      this.postStatus('Upload canceled.');
      await this.showTransferSummary('Upload', summary);
      return 'Canceled';
    }

    const completionStatus = getTransferCompletionStatus(summary);
    const completionMessage = buildTransferCompletionStatusText('Upload', summary);
    this.setActiveTransferResultSummary(summary);
    this.logActiveTransferEvent('Upload', completionMessage, { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
    this.postStatus(buildTransferStatusMessage('Upload', summary));
    await this.showTransferSummary('Upload', summary);
    return completionStatus;
  }

  private async refreshUploadTargetDirectory(connectionId: string, targetDirectory: string): Promise<void> {
    const normalizedTargetDirectory = normalizeRemotePath(targetDirectory || '/');

    if (this.sessions.hasConnection(connectionId)
      && !this.isDisposed
      && this.panel
      && this.state.getActiveConnectionId() === connectionId
      && normalizeRemotePath(this.getActivePath() || '/') === normalizedTargetDirectory) {
      await this.listDirectory(normalizedTargetDirectory, { forceRefresh: true });
    }

    RemoteEditSharedState.fireRemoteDirectoryChanged(connectionId, normalizedTargetDirectory, 'webview');
  }


  private async requestDownloadEntries(payload: any): Promise<void> {
    const connectionId = this.requireTransferConnectionId(payload);
    const transferSource = this.getTransferRequestSource(payload);
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
      title: 'Remote Edit: Select Download Folder',
      openLabel: 'Download Here',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false
    });

    const targetFolder = targetFolders?.[0]?.fsPath;

    if (!targetFolder) {
      this.logInfo('Download folder selection canceled.');
      return;
    }

    this.enqueueTransferJob({
      id: this.createTransferJobId(),
      operation: 'Download',
      source: transferSource,
      connectionId,
      connectionLabel: this.buildTransferConnectionLabel(connectionId),
      title: buildSelectedRemoteItemsLabel(entries),
      from: buildDownloadQueueSourceLabel(entries),
      to: buildDownloadQueueTargetLabel(entries, targetFolder),
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
    const summary: TransferSummary = { transferredFiles: 0, skippedItems: [], failedItems: [], canceledItems: [] };
    const skipped = createTransferSkipState();
    const items: DownloadTransferItem[] = [];

    for (const entry of entries) {
      throwIfCancelled(token, 'Download canceled.');
      await this.collectDownloadTransferItems(connectionId, entry, targetFolder, summary, items, token);
    }
    throwIfCancelled(token, 'Download canceled.');

    if (!items.length) {
      const completionStatus = getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Download', buildTransferCompletionStatusText('Download', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
      this.postStatus(buildTransferStatusMessage('Download', summary));
      await this.showTransferSummary('Download', summary);
      return completionStatus;
    }

    try {
      await this.prepareDownloadConflicts(connectionId, items, summary, skipped, token);
    } catch (error) {
      if (formatTransferError(error) === 'Download canceled.') {
        addCanceledTransferItem(summary, '');
        this.setActiveTransferResultSummary(summary);
        this.logActiveTransferEvent('Download', 'Download canceled during conflict resolution.', { SkippedItems: summary.skippedItems.length });
        this.postStatus('Download canceled.');
        return 'Canceled';
      }
      throw error;
    }

    const remainingItems = items.filter(item => !shouldSkipTransferItem(item.relativePath, skipped));

    if (!remainingItems.length) {
      const completionStatus = getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Download', buildTransferCompletionStatusText('Download', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
      this.postStatus(buildTransferStatusMessage('Download', summary));
      await this.showTransferSummary('Download', summary);
      return completionStatus;
    }

    const downloadFileItems = remainingItems.filter(item => item.kind === 'file');
    const totalBytes = downloadFileItems.reduce((sum, item) => sum + item.size, 0);
    const aggregateState: AggregateTransferState = { completedBytes: 0, totalBytes };

    let downloadCanceled = false;
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
              if (isTransferCancellationError(error, token)) {
                addCanceledTransferItem(summary, item.relativePath);
                throw new RemoteEditOperationCancelledError('Download canceled.');
              }
              summary.failedItems.push(`${item.relativePath}: ${formatTransferError(error)}`);
            }
          }

          for (const [index, item] of downloadFileItems.entries()) {
            const progressDetail = buildTransferProgressDetail(item.relativePath, index + 1, downloadFileItems.length);
            throwIfCancelled(token, 'Download canceled.');

            try {
              await fs.mkdir(path.dirname(item.localPath), { recursive: true });
              const content = await this.sessions.readFile(
                connectionId,
                item.remotePath,
                token,
                this.createAggregateProgress(progress, 'Downloading...', aggregateState, item.size, progressDetail)
              );
              throwIfCancelled(token, 'Download canceled.');
              await writeLocalFileSafely(item.localPath, content);
              throwIfCancelled(token, 'Download canceled.');
              aggregateState.completedBytes += item.size;
              progress.reportBytes('Downloading...', aggregateState.completedBytes, aggregateState.totalBytes, progressDetail);
              summary.transferredFiles += 1;
            } catch (error) {
              if (isTransferCancellationError(error, token)) {
                addCanceledTransferItem(summary, item.relativePath);
                throw new RemoteEditOperationCancelledError('Download canceled.');
              }
              summary.failedItems.push(`${item.relativePath}: ${formatTransferError(error)}`);
            }
          }
        },
        {
          cancellable: true,
          returnOnCancel: false,
          cancelMessage: 'Download canceled.',
          cancellationSource: transferCancellationSource,
          suppressNotification: true
        }
      ).catch(error => {
        if (isRemoteEditOperationCancelled(error)) {
          downloadCanceled = true;
          if (!summary.canceledItems.length) {
            addCanceledTransferItem(summary, '');
          }
          this.logActiveTransferEvent('Download', 'Download canceled.', { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
          return;
        }
        throw error;
      });
    } finally {
      // The queue owns the active transfer cancellation source.
    }

    if (downloadCanceled) {
      this.setActiveTransferResultSummary(summary);
      this.postStatus('Download canceled.');
      await this.showTransferSummary('Download', summary);
      return 'Canceled';
    }

    const completionStatus = getTransferCompletionStatus(summary);
    const completionMessage = buildTransferCompletionStatusText('Download', summary);
    this.setActiveTransferResultSummary(summary);
    this.logActiveTransferEvent('Download', completionMessage, { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
    this.postStatus(buildTransferStatusMessage('Download', summary));
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
      throwIfCancelled(token, 'Upload canceled.');
      const localPath = uri.fsPath;
      const baseName = path.basename(localPath);
      await this.collectUploadPath(localPath, baseName, targetDirectory, summary, items, token);
    }

    return items;
  }

  private async collectDroppedUploadTransferItems(
    localEntries: readonly LocalUploadEntry[],
    targetDirectory: string,
    summary: TransferSummary,
    token: vscode.CancellationToken
  ): Promise<UploadTransferItem[]> {
    const items: UploadTransferItem[] = [];
    const seenDirectories = new Set<string>();
    const seenFiles = new Set<string>();

    for (const entry of localEntries) {
      throwIfCancelled(token, 'Upload canceled.');
      const relativePath = this.normalizeDroppedUploadRelativePath(entry.relativePath);

      if (!relativePath) {
        continue;
      }

      const remotePath = joinRemoteRelativePath(targetDirectory, relativePath);

      if (entry.kind === 'directory') {
        if (!seenDirectories.has(relativePath)) {
          seenDirectories.add(relativePath);
          items.push({ kind: 'directory', localPath: entry.localPath || '', remotePath, relativePath, size: 0 });
        }
        continue;
      }

      const localPath = String(entry.localPath || '').trim();

      if (!localPath) {
        summary.skippedItems.push(`${relativePath}: skipped item without a local file path`);
        continue;
      }

      let stats: Awaited<ReturnType<typeof fs.lstat>>;

      try {
        stats = await fs.lstat(localPath);
      } catch (error) {
        summary.failedItems.push(`${relativePath}: ${formatTransferError(error)}`);
        continue;
      }

      throwIfCancelled(token, 'Upload canceled.');

      if (stats.isSymbolicLink()) {
        summary.skippedItems.push(`${relativePath}: skipped symbolic link`);
        continue;
      }

      if (stats.isDirectory()) {
        await this.collectUploadPath(localPath, relativePath, targetDirectory, summary, items, token);
        continue;
      }

      if (stats.isFile()) {
        if (seenFiles.has(relativePath)) {
          continue;
        }

        seenFiles.add(relativePath);
        items.push({ kind: 'file', localPath, remotePath, relativePath, size: Number(stats.size || entry.size || 0) });
        continue;
      }

      summary.skippedItems.push(`${relativePath}: skipped unsupported local item`);
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
    throwIfCancelled(token, 'Upload canceled.');
    const stats = await fs.lstat(localPath);
    throwIfCancelled(token, 'Upload canceled.');

    if (stats.isSymbolicLink()) {
      summary.skippedItems.push(`${relativePath}: skipped symbolic link`);
      return;
    }

    const remotePath = joinRemoteRelativePath(targetDirectory, relativePath);

    if (stats.isDirectory()) {
      items.push({ kind: 'directory', localPath, remotePath, relativePath, size: 0 });
      const children = await fs.readdir(localPath);
      for (const child of children) {
        throwIfCancelled(token, 'Upload canceled.');
        await this.collectUploadPath(path.join(localPath, child), path.posix.join(toPosixRelativePath(relativePath), child), targetDirectory, summary, items, token);
      }
      return;
    }

    if (stats.isFile()) {
      items.push({ kind: 'file', localPath, remotePath, relativePath: toPosixRelativePath(relativePath), size: Number(stats.size || 0) });
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
    const relativePath = toPosixRelativePath(entry.name || path.posix.basename(entry.path));
    throwIfCancelled(token, 'Download canceled.');
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
    throwIfCancelled(token, 'Download canceled.');

    if (entryType === 'link') {
      summary.skippedItems.push(`${relativePath}: skipped symbolic link`);
      return;
    }

    const resolvedType = effectiveType === 'file' || effectiveType === 'directory'
      ? effectiveType
      : entryType === 'file' || entryType === 'directory'
        ? entryType
        : (await this.sessions.stat(connectionId, remotePath)).type;

    throwIfCancelled(token, 'Download canceled.');

    const localPath = path.join(targetFolder, ...toPosixRelativePath(relativePath).split('/').filter(Boolean));

    if (resolvedType === 'directory') {
      items.push({ kind: 'directory', remotePath, localPath, relativePath: toPosixRelativePath(relativePath), size: 0 });
      const children = await this.sessions.listDirectory(connectionId, remotePath);
      throwIfCancelled(token, 'Download canceled.');
      for (const child of children) {
        if (child.name === '..') {
          continue;
        }
        throwIfCancelled(token, 'Download canceled.');
        await this.collectDownloadPath(
          connectionId,
          child.path,
          path.posix.join(toPosixRelativePath(relativePath), child.name),
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
      throwIfCancelled(token, 'Download canceled.');
      items.push({ kind: 'file', remotePath, localPath, relativePath: toPosixRelativePath(relativePath), size: Number(stats.size || 0) });
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
      throwIfCancelled(token, 'Upload canceled.');
      if (shouldSkipTransferItem(item.relativePath, skipped)) {
        continue;
      }

      let destinationStats: Awaited<ReturnType<RemoteSessionManager['stat']>> | undefined;
      try {
        destinationStats = await this.sessions.stat(connectionId, item.remotePath);
      } catch {
        continue;
      }

      throwIfCancelled(token, 'Upload canceled.');

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
          throwIfCancelled(token, 'Upload canceled.');

          if (decision === 'cancel') {
            throw new Error('Upload canceled.');
          }
          if (decision === 'skip') {
            markTransferTreeSkipped(item.relativePath, skipped, summary, 'skipped folder conflict');
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
        throwIfCancelled(token, 'Upload canceled.');

        if (decision === 'cancel') {
          throw new Error('Upload canceled.');
        }
        markTransferTreeSkipped(item.relativePath, skipped, summary, 'skipped because a remote file already exists at the target path');
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
        throwIfCancelled(token, 'Upload canceled.');

        if (decision === 'cancel') {
          throw new Error('Upload canceled.');
        }
        markTransferPathSkipped(item.relativePath, skipped, summary, 'skipped because a remote folder already exists at the target path');
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
      throwIfCancelled(token, 'Upload canceled.');

      if (decision === 'cancel') {
        throw new Error('Upload canceled.');
      }
      if (decision === 'skip') {
        markTransferPathSkipped(item.relativePath, skipped, summary, 'skipped file conflict');
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
      throwIfCancelled(token, 'Download canceled.');
      if (shouldSkipTransferItem(item.relativePath, skipped)) {
        continue;
      }

      let destinationStats: Awaited<ReturnType<typeof fs.stat>> | undefined;
      try {
        destinationStats = await fs.stat(item.localPath);
      } catch {
        continue;
      }

      throwIfCancelled(token, 'Download canceled.');
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
          throwIfCancelled(token, 'Download canceled.');

          if (decision === 'cancel') {
            throw new Error('Download canceled.');
          }
          if (decision === 'skip') {
            markTransferTreeSkipped(item.relativePath, skipped, summary, 'skipped folder conflict');
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
        throwIfCancelled(token, 'Download canceled.');

        if (decision === 'cancel') {
          throw new Error('Download canceled.');
        }
        markTransferTreeSkipped(item.relativePath, skipped, summary, 'skipped because a local file already exists at the target path');
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
        throwIfCancelled(token, 'Download canceled.');

        if (decision === 'cancel') {
          throw new Error('Download canceled.');
        }
        markTransferPathSkipped(item.relativePath, skipped, summary, 'skipped because a local folder already exists at the target path');
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
      throwIfCancelled(token, 'Download canceled.');

      if (decision === 'cancel') {
        throw new Error('Download canceled.');
      }
      if (decision === 'skip') {
        markTransferPathSkipped(item.relativePath, skipped, summary, 'skipped file conflict');
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

    const selected = this.shouldUseNativeTransferConflictDialog()
      ? await this.requestNativeTransferConflictDecision(options, token)
      : await this.requestTransferConflictDecision(options, token);
    throwIfCancelled(token, `${operation} canceled.`);
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

  private shouldUseNativeTransferConflictDialog(): boolean {
    return this.getActiveTransferState()?.job.source === 'sidebar';
  }

  private getTransferRequestSource(payload: any): 'webview' | 'sidebar' {
    return String(payload?.source || '').toLowerCase() === 'sidebar' ? 'sidebar' : 'webview';
  }

  private async requestNativeTransferConflictDecision(
    options: Omit<PendingTransferConflict, 'requestId' | 'transferId' | 'resolve'>,
    token: vscode.CancellationToken
  ): Promise<TransferConflictChoice> {
    const choices = buildTransferConflictChoices(options as PendingTransferConflict);
    const nativeChoices = choices.filter(choice => choice.decision !== 'cancel');
    const labels = Array.from(new Set(nativeChoices.map(choice => choice.label)));
    const message = buildNativeTransferConflictMessage(options);
    const detail = buildNativeTransferConflictDetail(options);

    const selectionPromise = vscode.window.showWarningMessage(
      message,
      { modal: true, detail },
      ...labels
    );

    const selected = await Promise.race([
      selectionPromise,
      new Promise<string | undefined>(resolve => {
        const subscription = token.onCancellationRequested(() => {
          subscription.dispose();
          resolve(undefined);
        });
      })
    ]);

    if (!selected) {
      return 'cancel';
    }

    return nativeChoices.find(choice => choice.label === selected)?.decision || 'cancel';
  }

  private requestTransferConflictDecision(
    options: Omit<PendingTransferConflict, 'requestId' | 'transferId' | 'resolve'>,
    token: vscode.CancellationToken
  ): Promise<TransferConflictChoice> {
    const transferId = this.getActiveTransferState()?.job.id || '';
    const requestId = `${Date.now()}-${++this.transferConflictSequence}`;
    const previousDialog = this.transferConflictDialogQueue;
    let releaseDialog: () => void = () => undefined;
    this.transferConflictDialogQueue = previousDialog.then(() => new Promise<void>(resolve => {
      releaseDialog = resolve;
    }));

    return previousDialog.then(() => new Promise<TransferConflictChoice>(resolve => {
      if (token.isCancellationRequested) {
        releaseDialog();
        resolve('cancel');
        return;
      }

      const subscription = token.onCancellationRequested(() => {
        this.cancelPendingTransferConflict(transferId || undefined);
      });

      const finish = (decision: TransferConflictChoice): void => {
        subscription.dispose();
        releaseDialog();
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
    }));
  }

  private postPendingTransferConflict(): void {
    if (!this.pendingTransferConflict) {
      this.postMessage(RemoteEditOutboundMessageType.HideTransferConflictDialog, {});
      return;
    }

    this.postMessage(RemoteEditOutboundMessageType.ShowTransferConflictDialog, buildTransferConflictDialogPayload(this.pendingTransferConflict, formatTimestampForDialog));
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
    conflict.resolve(isValidTransferConflictChoice(decision) ? decision : 'cancel');
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
        this.setActiveTransferProgress(formatTransferProgressMessage(label, aggregateTransferredBytes, state.totalBytes, detail));
        progress.reportBytes(label, aggregateTransferredBytes, state.totalBytes, detail);
      }
    };
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
    job.queuedAt = job.queuedAt || formatLocalDateTime(new Date());

    const willWait = this.runningTransfers >= this.getMaxConcurrentTransfers();
    this.transferQueue.push(job);
    this.postTransferQueueState();

    if (!willWait) {
      void this.processTransferQueue();
      return;
    }

    const queuedCount = this.transferQueue.length;
    const message = `${job.operation} queued. It will start when a transfer slot is available.`;
    this.logTransferEvent(job, `${job.operation} queued.`, { Pending: queuedCount });
    this.postStatus(`${message} ${formatQueuedTransferCount(queuedCount)}`);
    this.updateActiveTransferStatusBarItem();
  }

  private async processTransferQueue(): Promise<void> {
    while (this.runningTransfers < this.getMaxConcurrentTransfers() && this.transferQueue.length) {
      const job = this.transferQueue.shift();

      if (!job) {
        return;
      }

      if (!this.sessions.getConnection(job.connectionId)) {
        this.logTransferEvent(job, `${job.operation} skipped because the connection is no longer active.`);
        this.postStatus(`${job.operation} skipped because the connection is no longer active.`);
        this.cleanupTransferJob(job);
        this.postTransferQueueState();
        continue;
      }

      this.runningTransfers += 1;
      const transferCancellationSource = new vscode.CancellationTokenSource();
      job.startedAt = formatLocalDateTime(new Date());
      job.progress = 'Preparing...';
      this.activeTransfers.set(job.id, {
        job,
        cancellationSource: transferCancellationSource,
        connectionId: job.connectionId,
        canceling: false,
        status: 'Preparing'
      });
      this.updateActiveTransferStatusBarItem();
      this.postTransferQueueState();
      this.logTransferEvent(job, `${job.operation} started.`);

      void this.transferExecutionContext.run(job.id, async () => {
        try {
          const completionStatus = await job.run(transferCancellationSource);
          this.addCompletedTransfer(job, completionStatus);
        } catch (error) {
          if (isRemoteEditOperationCancelled(error)) {
            this.logTransferEvent(job, `${job.operation} canceled.`);
            this.postStatus(`${job.operation} canceled.`);
            this.addCompletedTransfer(job, 'Canceled');
          } else {
            const details = formatTransferError(error);
            this.logTransferEvent(job, `${job.operation} failed.`, { Details: details });
            this.postOperationError(formatFailureStatus(`${job.operation} failed`, details));
            this.addCompletedTransfer(job, 'Failed');
          }
        } finally {
          this.cancelPendingTransferConflict(job.id);
          try {
            await job.cleanup?.();
          } catch (cleanupError) {
            this.logDebug('Ignored transfer cleanup failure.', { Details: formatTransferError(cleanupError) });
          }
          this.runningTransfers = Math.max(0, this.runningTransfers - 1);
          this.activeTransfers.delete(job.id);
          transferCancellationSource.dispose();
          this.updateActiveTransferStatusBarItem();
          this.postTransferQueueState();
          void this.processTransferQueue();
        }
      });
    }
  }


  private updateActiveTransferStatusBarItem(): void {
    // Transfer cancellation is available from the Transfer Queue modal.
  }

  private cleanupTransferJob(job: QueuedTransferJob): void {
    if (!job.cleanup) {
      return;
    }

    void job.cleanup().catch(error => {
      this.logDebug('Ignored queued transfer cleanup failure.', { Details: formatTransferError(error) });
    });
  }

  private clearQueuedTransfersForConnection(connectionId: string): number {
    const initialLength = this.transferQueue.length;

    for (let index = this.transferQueue.length - 1; index >= 0; index -= 1) {
      if (this.transferQueue[index].connectionId === connectionId) {
        const [removedTransfer] = this.transferQueue.splice(index, 1);
        this.cleanupTransferJob(removedTransfer);
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
    const removedTransfers = this.transferQueue.splice(0, this.transferQueue.length);
    const removedCount = removedTransfers.length;
    removedTransfers.forEach(transfer => this.cleanupTransferJob(transfer));
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

    const completedTransfer = buildTransferQueueItemSnapshot(job, status, false);
    completedTransfer.progress = job.resultSummary ? buildTransferResultProgress(job.resultSummary) : status;
    completedTransfer.finishedAt = formatLocalDateTime(new Date());
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
    const source = new vscode.CancellationTokenSource();
    const job: QueuedTransferJob = {
      id: this.createTransferJobId(),
      operation,
      source: 'webview',
      connectionId,
      connectionLabel: this.buildTransferConnectionLabel(connectionId),
      title: `${operation} transfer`,
      from: '',
      to: '',
      progress: 'Preparing...',
      queuedAt: formatLocalDateTime(new Date()),
      startedAt: formatLocalDateTime(new Date()),
      run: async () => 'Canceled'
    };

    this.activeTransfers.set(job.id, {
      job,
      cancellationSource: source,
      connectionId,
      canceling: false,
      status: 'Preparing'
    });
    this.transferExecutionContext.enterWith(job.id);
    this.updateActiveTransferStatusBarItem();
    this.postTransferQueueState();

    return source;
  }

  private endManualTransfer(source?: vscode.CancellationTokenSource): void {
    if (!source) {
      return;
    }

    for (const [transferId, activeTransfer] of this.activeTransfers) {
      if (activeTransfer.cancellationSource === source) {
        this.activeTransfers.delete(transferId);
        source.dispose();
        this.postTransferQueueState();
        return;
      }
    }

    source.dispose();
  }

  private async cancelActiveTransfer(payload?: any): Promise<void> {
    const requestedTransferId = String(payload?.transferId || '').trim();
    const activeTransfer = requestedTransferId
      ? this.activeTransfers.get(requestedTransferId)
      : Array.from(this.activeTransfers.values())[0];

    if (!activeTransfer) {
      this.postStatus('No file transfer is currently running.');
      return;
    }

    activeTransfer.canceling = true;
    activeTransfer.job.progress = 'Canceling...';
    this.logTransferEvent(activeTransfer.job, `${activeTransfer.job.operation} cancellation requested.`);
    this.postTransferQueueState();
    this.cancelPendingTransferConflict(activeTransfer.job.id);
    activeTransfer.cancellationSource.cancel();
  }

  private cancelActiveTransfersForConnection(connectionId: string): void {
    for (const activeTransfer of this.activeTransfers.values()) {
      if (activeTransfer.connectionId !== connectionId) {
        continue;
      }

      activeTransfer.canceling = true;
      activeTransfer.job.progress = 'Canceling...';
      this.cancelPendingTransferConflict(activeTransfer.job.id);
      activeTransfer.cancellationSource.cancel();
    }

    this.postTransferQueueState();
  }

  private removeQueuedTransfer(payload: any): void {
    const transferId = String(payload?.transferId || '').trim();

    if (!transferId) {
      this.postStatus('Select a queued transfer to remove.');
      return;
    }

    const transferIndex = this.transferQueue.findIndex(item => item.id === transferId);

    if (transferIndex === -1) {
      if (this.activeTransfers.has(transferId)) {
        void this.cancelActiveTransfer({ transferId }).catch(error => this.showCommandError(error));
        return;
      }

      this.postStatus('Queued transfer not found. It may have already started or finished.');
      this.postTransferQueueState();
      return;
    }

    const [removedTransfer] = this.transferQueue.splice(transferIndex, 1);
    this.cleanupTransferJob(removedTransfer);
    this.logTransferEvent(removedTransfer, `${removedTransfer.operation} removed from queue.`);
    this.postStatus(`${removedTransfer.operation} removed from queue.`);
    this.updateActiveTransferStatusBarItem();
    this.postTransferQueueState();
  }

  private postTransferQueueState(): void {
    const state = buildTransferQueueStateSnapshot(this.activeTransfers.values(), this.transferQueue, this.completedTransfers);
    this.postMessage(RemoteEditOutboundMessageType.TransferQueueChanged, state);
    RemoteEditPanel.transferQueueChangedEmitter.fire(state);
  }

  private getActiveTransferState(): ActiveTransferState | undefined {
    const transferId = this.transferExecutionContext.getStore();
    return transferId ? this.activeTransfers.get(transferId) : undefined;
  }

  private getMaxConcurrentTransfers(): number {
    const configuredValue = vscode.workspace.getConfiguration('remoteedit').get<number>('maxConcurrentTransfers', 2);
    if (!Number.isFinite(configuredValue)) {
      return 2;
    }

    return Math.max(1, Math.min(5, Math.floor(configuredValue)));
  }

  private setActiveTransferStatus(status: 'Preparing' | 'Running' | 'Waiting'): void {
    const activeTransfer = this.getActiveTransferState();
    if (!activeTransfer) {
      return;
    }

    activeTransfer.status = status;
    this.postTransferQueueState();
  }

  private setActiveTransferProgress(progress: string): void {
    const activeTransfer = this.getActiveTransferState();
    if (!activeTransfer) {
      return;
    }

    activeTransfer.job.progress = progress;
    this.postTransferQueueState();
  }

  private setActiveTransferResultSummary(summary: TransferSummary): void {
    const activeTransfer = this.getActiveTransferState();
    if (!activeTransfer) {
      return;
    }

    activeTransfer.job.resultSummary = {
      transferredFiles: summary.transferredFiles,
      skippedItems: summary.skippedItems.slice(),
      failedItems: summary.failedItems.slice(),
      canceledItems: summary.canceledItems.slice()
    };
  }

  private async showTransferSummary(operation: 'Upload' | 'Download', summary: TransferSummary): Promise<void> {
    const details: string[] = [];

    if (summary.skippedItems.length) {
      details.push(`Skipped:\n${summary.skippedItems.slice(0, 20).join('\n')}${summary.skippedItems.length > 20 ? '\n...' : ''}`);
    }

    if (summary.failedItems.length) {
      details.push(`Failed:\n${summary.failedItems.slice(0, 20).join('\n')}${summary.failedItems.length > 20 ? '\n...' : ''}`);
    }

    if (summary.canceledItems.length) {
      details.push(`Canceled:\n${summary.canceledItems.slice(0, 20).join('\n')}${summary.canceledItems.length > 20 ? '\n...' : ''}`);
    }

    if (!details.length) {
      return;
    }

    this.logInfo(`${operation} completed with skipped, failed, or canceled items.`, {
      SkippedItems: summary.skippedItems.length,
      FailedItems: summary.failedItems.length,
      CanceledItems: summary.canceledItems.length,
      Details: details.join('\n\n')
    });
  }

  private async requestPortForwardState(payload: any): Promise<void> {
    await this.portForwardController.requestState(payload);
  }

  private async startPortForward(payload: any): Promise<void> {
    await this.portForwardController.start(payload);
  }

  private async stopPortForward(payload: any): Promise<void> {
    await this.portForwardController.stop(payload);
  }

  private postPortForwardState(state: PortForwardRuntimeState): void {
    this.postMessage(RemoteEditOutboundMessageType.PortForwardStateChanged, state);
  }

  private postAllPortForwardStates(): void {
    this.portForwardController.postAllStates();
  }

  private async requestServerServiceDetails(payload: any): Promise<void> {
    await this.serverManagementController.requestServerServiceDetails(payload);
  }

  private async requestServerServiceAction(payload: any): Promise<void> {
    await this.serverManagementController.requestServerServiceAction(payload);
  }

  private async requestServerProcessDetails(payload: any): Promise<void> {
    await this.serverManagementController.requestServerProcessDetails(payload);
  }

  private async requestServerProcessAction(payload: any): Promise<void> {
    await this.serverManagementController.requestServerProcessAction(payload);
  }

  private async requestServerScheduledJobAction(payload: any): Promise<void> {
    await this.serverManagementController.requestServerScheduledJobAction(payload);
  }

  private async requestServerDashboard(payload: any): Promise<void> {
    await this.serverManagementController.requestServerDashboard(payload);
  }

  private async requestOpenLogViewer(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.state.getActiveConnectionId() || '').trim();
    const remotePath = String(payload?.path || '').trim();

    if (!connectionId) {
      throw new Error('No open Remote Edit connection selected.');
    }

    const connection = this.sessions.getConnection(connectionId);
    if (!connection) {
      throw new Error('No open Remote Edit connection selected.');
    }

    if (String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      throw new Error('Log Viewer is available for SSH/SFTP connections only.');
    }

    if (remotePath) {
      const normalizedPath = normalizeRemotePath(remotePath);
      try {
        const stat = await this.sessions.stat(connectionId, normalizedPath);
        if (stat.type !== 'file') {
          throw new Error(stat.type === 'directory' ? 'Remote path is a directory, not a file.' : 'Remote path is not a regular file.');
        }
      } catch (error) {
        await this.showRemoteFileOpenFailureDialog(
          'Could not open remote log file',
          normalizedPath,
          formatRemoteFileOpenFailureReason(error, normalizedPath)
        );
        return;
      }

      LogViewerPanel.openForFile(this.context, this.sessions, this.output, connectionId, normalizedPath);
      return;
    }

    LogViewerPanel.openForConnection(this.context, this.sessions, this.output, connectionId);
  }

  private async requestOpenSshTerminal(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.state.getActiveConnectionId() || '').trim();
    const workingDirectory = String(payload?.workingDirectory || this.getActivePath() || '/');

    if (!connectionId) {
      throw new Error('Connect to a host before opening an SSH terminal.');
    }

    await this.sshTerminalService.openTerminal(connectionId, workingDirectory);
  }

  private async requestRunRemoteCommand(payload: any): Promise<void> {
    await this.remoteCommandController.requestRunRemoteCommand(payload);
  }

  private stopRemoteCommand(payload: any): void {
    this.remoteCommandController.stopRemoteCommand(payload);
  }

  private stopAllRemoteCommands(force = false): void {
    this.remoteCommandController.stopAllRemoteCommands(force);
  }



  private postRemoteClipboardState(): void {
    const connectionId = this.state.getActiveConnectionId();
    const connection = connectionId ? this.sessions.getConnection(connectionId) : undefined;
    this.postMessage(RemoteEditOutboundMessageType.RemoteClipboardChanged, remoteClipboardService.getSnapshot(connection));
  }

  private postLogViewerActiveSessionCount(): void {
    this.postMessage(RemoteEditOutboundMessageType.LogViewerActiveSessionCount, {
      count: LogViewerPanel.getActiveSessionCount()
    });
  }

  private postRemoteSearchState(connectionId = this.state.getActiveConnectionId()): void {
    const connection = connectionId ? this.sessions.getConnection(connectionId) : undefined;
    this.postMessage(RemoteEditOutboundMessageType.RemoteSearchState, this.remoteSearchService.getSnapshot(connectionId, connection?.connectionType || 'sftp'));
  }

  private postRemoteSearchStarted(snapshot: RemoteSearchSnapshot): void {
    this.remoteSearchResultBatcher.clear(snapshot.connectionId);
    this.postMessage(RemoteEditOutboundMessageType.RemoteSearchStarted, snapshot);
  }

  private postRemoteSearchFinished(snapshot: RemoteSearchSnapshot): void {
    this.remoteSearchResultBatcher.flush(snapshot.connectionId);
    this.postMessage(RemoteEditOutboundMessageType.RemoteSearchFinished, snapshot);
  }


  private postRemoteSearchFailed(connectionId: string, connectionType: string, options: Partial<RemoteSearchOptions>, message: string): void {
    this.postMessage(RemoteEditOutboundMessageType.RemoteSearchFinished, {
      id: '',
      status: 'failed',
      connectionId,
      connectionType,
      options: {
        connectionId,
        connectionType,
        scopePath: String(options.scopePath || this.getActivePath() || '/'),
        includeSubdirectories: Boolean(options.includeSubdirectories),
        includeHiddenFiles: Boolean(options.includeHiddenFiles),
        caseSensitive: Boolean(options.caseSensitive),
        fileName: String(options.fileName || '*'),
        searchInsideFiles: Boolean(options.searchInsideFiles),
        textToFind: String(options.textToFind || ''),
        useSudo: Boolean(options.useSudo)
      },
      results: [],
      totalResults: 0,
      finishedAt: Date.now(),
      error: message || 'Remote search failed.'
    });
  }

  private async startRemoteSearch(payload: any): Promise<void> {
    let connectionId = this.state.getActiveConnectionId();
    let connection = connectionId ? this.sessions.getConnection(connectionId) : undefined;
    let connectionType = connection?.connectionType || 'sftp';

    try {
      connectionId = this.requireActiveConnectionId();
      connection = this.sessions.getConnection(connectionId);
      connectionType = connection?.connectionType || connectionType;
      if (!connection) {
        throw new Error('Connect to a host before searching.');
      }

      const useSudo = Boolean(payload?.useSudo) && connection.connectionType === 'sftp';

      if (useSudo && !this.sessions.isSudoModeEnabled(connectionId)) {
        const password = String(payload?.sudoPassword || '') || await this.showWebviewInputBox({
          title: 'Run Search with Sudo Mode',
          prompt: 'Enter the sudo password for this connection. The password is kept only in memory for the current session.',
          password: true,
          placeHolder: 'Sudo password',
          label: 'Sudo password',
          confirmLabel: 'Search'
        });

        if (!password) {
          this.postRemoteSearchFailed(connectionId, connection.connectionType, payload || {}, 'Sudo search canceled.');
          return;
        }

        await this.sessions.enableSudoMode(connectionId, password);
        this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: true });
        this.logInfo('Sudo Mode enabled for remote search.', { Connection: connectionId });
      }

      const options: RemoteSearchOptions = {
        connectionId,
        connectionType: connection.connectionType,
        scopePath: String(payload?.scopePath || this.getActivePath() || connection.startPath || '/'),
        includeSubdirectories: Boolean(payload?.includeSubdirectories),
        includeHiddenFiles: Boolean(payload?.includeHiddenFiles),
        caseSensitive: Boolean(payload?.caseSensitive),
        fileName: String(payload?.fileName || '*'),
        searchInsideFiles: Boolean(payload?.searchInsideFiles) && connection.connectionType === 'sftp',
        textToFind: String(payload?.textToFind || ''),
        useSudo
      };

      void this.remoteSearchService.start(options).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        this.logError('Remote search failed.', { Connection: connectionId, Details: message });
        this.postRemoteSearchFailed(connectionId || '', connectionType, options, message || 'Remote search failed.');
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logError('Remote search failed.', { Connection: connectionId, Details: message });
      this.postRemoteSearchFailed(connectionId || '', connectionType, payload || {}, message || 'Remote search failed.');
    }
  }

  private cancelRemoteSearch(): void {
    const connectionId = this.state.getActiveConnectionId();
    this.remoteSearchService.cancel(connectionId);
    this.postRemoteSearchState(connectionId);
  }

  private clearRemoteSearch(): void {
    const connectionId = this.state.getActiveConnectionId();
    const connection = connectionId ? this.sessions.getConnection(connectionId) : undefined;
    this.remoteSearchService.clear(connectionId, connection?.connectionType || 'sftp');
    this.postRemoteSearchState(connectionId);
  }

  private async browseRemoteSearchScope(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const requestedPath = normalizeRemotePath(String(payload?.scopePath || this.getActivePath() || '/'));
    const parentPath = dirnameRemotePath(requestedPath);
    const includeFiles = Boolean(payload?.includeFiles);
    const purpose = String(payload?.purpose || '');
    const requestId = String(payload?.requestId || '');
    const timer = createPerformanceTimer();

    appendDebugLog(this.output, 'RemoteSearch', 'Browse scope directory requested.', {
      Connection: connectionId,
      Path: requestedPath,
      IncludeFiles: includeFiles ? 'Yes' : 'No',
      Purpose: purpose || 'remoteSearch'
    });

    try {
      const entries = await this.sessions.listDirectory(connectionId, requestedPath, { forceRefresh: false });
      const visibleEntries = entries
        .filter(entry => entry.name !== '..')
        .map(entry => {
          const effectiveType = (entry.effectiveType || entry.type) === 'directory' ? 'directory' : 'file';
          return {
            name: String(entry.name || ''),
            path: normalizeRemotePath(entry.path),
            type: effectiveType
          };
        })
        .filter(entry => includeFiles ? (entry.type === 'directory' || entry.type === 'file') : entry.type === 'directory')
        .sort((left, right) => {
          if (left.type !== right.type) {
            return left.type === 'directory' ? -1 : 1;
          }
          return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
        });

      this.postMessage(RemoteEditOutboundMessageType.RemoteSearchScopeEntriesListed, {
        connectionId,
        path: requestedPath,
        parentPath,
        entries: visibleEntries,
        purpose,
        requestId
      });

      appendPerformanceLog(this.output, 'RemoteSearch', 'browse scope directory listed', {
        Connection: connectionId,
        Path: requestedPath,
        Entries: visibleEntries.length,
        IncludeFiles: includeFiles ? 'Yes' : 'No',
        Total: `${timer()}ms`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage(RemoteEditOutboundMessageType.RemoteSearchScopeEntriesListed, {
        connectionId,
        path: requestedPath,
        parentPath,
        entries: [],
        error: message || 'Unable to list this directory.',
        purpose,
        requestId
      });

      appendDebugLog(this.output, 'RemoteSearch', 'Browse scope directory failed.', {
        Connection: connectionId,
        Path: requestedPath,
        Details: message
      });
      appendPerformanceLog(this.output, 'RemoteSearch', 'browse scope directory failed', {
        Connection: connectionId,
        Path: requestedPath,
        Total: `${timer()}ms`
      });
    }
  }

  private async requestOwnerGroupSuggestions(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.state.getActiveConnectionId() || '').trim();
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      this.postMessage(RemoteEditOutboundMessageType.OwnerGroupSuggestions, { connectionId, owners: [], groups: [] });
      return;
    }

    try {
      const suggestions = await this.sessions.listOwnerGroupSuggestions(connectionId);
      this.postMessage(RemoteEditOutboundMessageType.OwnerGroupSuggestions, {
        connectionId,
        owners: Array.isArray(suggestions?.owners) ? suggestions.owners : [],
        groups: Array.isArray(suggestions?.groups) ? suggestions.groups : []
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logDebug('Could not load owner/group suggestions.', { Connection: connectionId, Details: message });
      this.postMessage(RemoteEditOutboundMessageType.OwnerGroupSuggestions, { connectionId, owners: [], groups: [], error: message });
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

    const owner = validateOwnerGroupName(String(payload?.owner || '').trim(), 'Owner');
    const group = validateOwnerGroupName(String(payload?.group || '').trim(), 'Group');
    const recursive = Boolean(payload?.recursive);

    if (!owner && !group) {
      throw new Error('Enter an owner, a group, or both.');
    }

    const targetLabel = formatOwnerGroupTargetLabel(owner, group);
    const itemLabel = entries.length === 1 ? (entries[0].name || entries[0].path) : `${entries.length} selected items`;
    const failures: string[] = [];
    let changedCount = 0;

    this.postBusy(true, `Changing owner/group for ${itemLabel}...`, false, undefined, connectionId);

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
        const message = formatOwnerGroupOperationError(error, this.sessions.isSudoModeEnabled(connectionId));
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
      this.postBusy(false, summary, false, undefined, connectionId);
      this.postOperationError(summary);
      return;
    }

    this.postBusy(false, `Changed owner/group for ${formatCount(changedCount, 'item')}.`, false, undefined, connectionId);
  }

  private async requestSetPermissions(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const entries = normalizePermissionEntries(payload);

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
      return;
    }

    const itemLabel = entries.length === 1 ? (firstEntry.name || firstEntry.path) : `${entries.length} selected items`;
    const failures: string[] = [];
    let changedCount = 0;

    this.postBusy(true, `Setting permissions ${result.mode} on ${itemLabel}...`, false, undefined, connectionId);

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
        const message = formatPermissionOperationError(error, this.sessions.isSudoModeEnabled(connectionId));
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
      this.postBusy(false, summary, false, undefined, connectionId);
      this.postOperationError(summary);
      return;
    }

    this.postBusy(false, `Permissions set to ${result.mode} for ${formatCount(changedCount, 'item')}.`, false, undefined, connectionId);
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


  private async buildDefaultArchiveName(
    connectionId: string,
    baseDirectory: string,
    entries: Array<{ name: string }>,
    format: ArchiveFormat
  ): Promise<string> {
    const baseName = buildArchiveBaseName(entries);
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
      this.panel.title = 'Remote Edit';
    }
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
    appendDebugLog(this.output, 'Panel', message, details);
  }

  private logWebviewPerformance(payload: any): void {
    const message = String(payload?.message || 'renderEntries');
    const items = Number(payload?.items || 0);
    const renderMs = Number(payload?.renderMs || 0);

    appendPerformanceLog(this.output, 'Webview', message, {
      items,
      render: `${Math.round(renderMs)}ms`
    });
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
    const activeTransfer = this.getActiveTransferState();
    if (activeTransfer?.job.operation === operation) {
      this.logTransferEvent(activeTransfer.job, message, details);
      return;
    }

    this.logInfo(message, { Operation: operation, ...details });
  }

  private async handleWebviewRemoteFileOpenFailure(event: { connectionId: string; remotePath: string; error: unknown; readOnly: boolean }): Promise<void> {
    if (!this.panel || this.isDisposed) {
      return;
    }

    const activeConnectionId = this.state.getActiveConnectionId();
    if (activeConnectionId && activeConnectionId !== event.connectionId) {
      return;
    }

    await this.showRemoteFileOpenFailureDialog(
      event.readOnly ? 'Could not open remote file read-only' : 'Could not open remote file',
      event.remotePath,
      formatRemoteFileOpenFailureReason(event.error, event.remotePath)
    );
  }

  private async showRemoteFileOpenFailureDialog(title: string, remotePath: string, reason: string): Promise<void> {
    await this.showConfirmDialog({
      title,
      message: 'Remote file could not be opened.',
      details: `Path: ${remotePath}\nReason: ${reason || 'Unknown error'}`,
      confirmLabel: 'OK',
      hideCancel: true
    });
  }

  private async showWebviewInputBox(options: InputDialogOptions): Promise<string | undefined> {
    let value = String(options.value ?? '');
    let validationMessage = String(options.validationMessage || '');

    while (true) {
      const result = await this.dialogManager.showInputDialog({
        ...options,
        value,
        validationMessage
      });

      if (result === undefined) {
        return undefined;
      }

      const validationResult = options.validateInput
        ? await Promise.resolve(options.validateInput(result))
        : undefined;

      if (!validationResult) {
        return result;
      }

      value = result;
      validationMessage = String(validationResult);
    }
  }

  private async showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    return this.dialogManager.showConfirmDialog(options);
  }

  private isServerViewMessageType(messageType: string): boolean {
    const serverViewMessageTypes: readonly string[] = [
      RemoteEditIncomingMessageType.RequestServerDashboard,
      RemoteEditIncomingMessageType.RequestServerServiceDetails,
      RemoteEditIncomingMessageType.RequestServerServiceAction,
      RemoteEditIncomingMessageType.RequestServerProcessDetails,
      RemoteEditIncomingMessageType.RequestServerProcessAction,
      RemoteEditIncomingMessageType.RequestServerScheduledJobAction,
      RemoteEditIncomingMessageType.RequestPortForwardState,
      RemoteEditIncomingMessageType.StartPortForward,
      RemoteEditIncomingMessageType.StopPortForward
    ];

    return serverViewMessageTypes.includes(messageType);
  }

  private postServerStatus(message: string, isError = false, durationMs?: number): void {
    this.postMessage(RemoteEditOutboundMessageType.ServerStatus, {
      message,
      kind: isError ? 'error' : 'info',
      isError,
      durationMs: durationMs || (isError ? 7000 : 3000)
    });
  }

  private postStatus(message: string, connectionId?: string): void {
    this.postMessage(RemoteEditOutboundMessageType.Status, {
      message,
      connectionId: connectionId ?? this.state.getActiveConnectionId() ?? ''
    });
  }

  private postStatusCopyFeedback(message: string): void {
    this.postMessage(RemoteEditOutboundMessageType.StatusCopyFeedback, { message });
  }

  private postBusy(isBusy: boolean, message: string, cancelAction: boolean | 'transfer' | 'connection' = false, cancelLabel?: string, connectionId?: string): void {
    const action = cancelAction === true ? 'transfer' : (cancelAction || '');
    this.postMessage(RemoteEditOutboundMessageType.Busy, {
      isBusy,
      message,
      canCancelTransfer: action === 'transfer',
      cancelAction: action,
      cancelLabel: cancelLabel || (action === 'transfer' ? 'Cancel Transfer' : 'Cancel'),
      connectionId: connectionId ?? this.state.getActiveConnectionId() ?? ''
    });
  }

  private postOperationError(message: string): void {
    this.postError(message, { showOutputLink: true });
  }

  private postError(message: string, options?: { showOutputLink?: boolean; connectionId?: string }): void {
    this.postMessage(RemoteEditOutboundMessageType.Error, {
      message,
      showOutputLink: Boolean(options?.showOutputLink),
      outputLinkText: 'See details in Output.',
      connectionId: options?.connectionId ?? this.state.getActiveConnectionId() ?? ''
    });
  }

  private postRemotePathBreadcrumbSettings(): void {
    this.postMessage(RemoteEditOutboundMessageType.RemotePathBreadcrumbSettingsChanged, {
      showDirectoryDetails: getBooleanSettingWithLegacyFallback(
        'webview.remotePathBreadcrumb.showDirectoryDetails',
        'remotePathBreadcrumb.showDirectoryDetails',
        true
      )
    });
  }

  private postFileListSettings(): void {
    this.postMessage(RemoteEditOutboundMessageType.FileListSettingsChanged, {
      openOnNameClick: getBooleanSettingWithLegacyFallback(
        'webview.fileList.openOnNameClick',
        'fileList.openOnNameClick',
        true
      ),
      permissionsDisplay: getPermissionsDisplayModeSetting()
    });
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

    this.stopAllRemoteCommands(true);
    void this.portForwardManager.dispose();
    this.remoteSearchResultBatcher.clearAll();
    this.resolvePendingPermissionsDialog();
    this.dialogManager.resolvePendingDialogs();
    this.cancelPendingTransferConflict();
    this.clearAllQueuedTransfers();
    this.clearAllCompletedTransfers();
    this.endManualTransfer();
    this.droppedUploadStaging.cancelAll();
    this.disposePanelDisposables();

    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    return renderRemoteEditHtml(webview, getNonce(), {
      showRemotePathBreadcrumbDirectoryDetails: getBooleanSettingWithLegacyFallback(
        'webview.remotePathBreadcrumb.showDirectoryDetails',
        'remotePathBreadcrumb.showDirectoryDetails',
        true
      ),
      openFileListItemsOnNameClick: getBooleanSettingWithLegacyFallback(
        'webview.fileList.openOnNameClick',
        'fileList.openOnNameClick',
        true
      ),
      permissionsDisplayMode: getPermissionsDisplayModeSetting()
    });
  }
}



function getPermissionsDisplayModeSetting(): string {
  const value = vscode.workspace.getConfiguration('remoteedit').get<string>('webview.fileList.permissionsDisplay', 'symbolic');
  return normalizePermissionDisplayMode(value);
}

function getBooleanSettingWithLegacyFallback(key: string, legacyKey: string, defaultValue: boolean): boolean {
  const config = vscode.workspace.getConfiguration('remoteedit');

  if (hasConfiguredSetting(config, key)) {
    return config.get<boolean>(key, defaultValue);
  }

  if (hasConfiguredSetting(config, legacyKey)) {
    return config.get<boolean>(legacyKey, defaultValue);
  }

  return config.get<boolean>(key, defaultValue);
}

function hasConfiguredSetting(config: vscode.WorkspaceConfiguration, key: string): boolean {
  const inspected = config.inspect(key) as { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown } | undefined;

  return inspected?.globalValue !== undefined || inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined;
}
