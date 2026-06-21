import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AsyncLocalStorage } from 'async_hooks';
import { ConnectionManager, type ConnectionBackupExportOptions, type ConnectionBackupImportOptions, type RemoteEditBackupFile, type RemoteEditBackupImportResult, type RemoteEditPersistentWebviewStorage } from '../connection/ConnectionManager';
import { buildRemoteEditUri } from '../filesystem/RemoteEditFileSystemProvider';
import type { ActiveConnection, ConnectOptions, RemoteSessionManager } from '../remote/RemoteSessionManager';
import { dirnameRemotePath, joinRemotePath, normalizeRemotePath, type RemoteEntry, type RemoteChecksumSummary, type RemoteChecksumValue, type RemoteCommandStreamingControl } from '../ssh/SftpSessionManager';
import { SshTerminalService } from '../ssh/SshTerminalService';
import { PortForwardManager, type SavedPortForwardConfig, type PortForwardRuntimeState } from '../ssh/PortForwardManager';
import { RemoteEditSharedState } from '../state/RemoteEditSharedState';
import { RemoteSearchService, type RemoteSearchSnapshot, type RemoteSearchResult, type RemoteSearchOptions, type RemoteSearchResultMeta } from '../search/RemoteSearchService';
import { LogViewerPanel } from '../logViewer/LogViewerPanel';
import { buildDeleteEntriesConfirmationDetail } from '../utils/deleteConfirmationUtils';
import { RemoteEditOperationCancelledError, formatBytes, isRemoteEditOperationCancelled, throwIfCancelled, withRemoteEditProgress, type RemoteEditProgressReporter } from '../utils/progressUtils';
import { appendDebugLog, appendOutputLog, appendPerformanceLog, createPerformanceTimer, type OutputLogDetails } from '../utils/outputLogger';
import { shellQuote } from '../utils/shellUtils';
import { getNonce } from '../utils/webviewUtils';
import { renderRemoteEditHtml } from './RemoteEditHtml';
import { handleRemoteEditPanelMessage } from './RemoteEditPanelHandlers';
import { RemoteEditIncomingMessageType, RemoteEditOutboundMessageType, type RemoteEditWebviewMessage } from './RemoteEditPanelMessages';
import { RemoteEditPanelState } from './RemoteEditPanelState';
import { calculateModeFromPermissionState, parsePermissionString, type SetPermissionsDialogResult, type SetPermissionsPanelOptions } from './RemoteEditPermissions';



interface ConnectionChangeNotifier {
  onDidChangeConnections?: vscode.Event<void>;
}

interface InputDialogOptions {
  title: string;
  prompt?: string;
  placeHolder?: string;
  label?: string;
  value?: string;
  valueSelection?: readonly [number, number];
  password?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  validationMessage?: string;
  validateInput?: (value: string) => string | undefined | null | PromiseLike<string | undefined | null>;
}

type TransferConflictDecision = 'overwrite' | 'skip' | 'cancel' | 'merge';
type TransferConflictChoice = TransferConflictDecision | 'overwriteAll' | 'skipAll' | 'mergeAll';
type TransferConflictKind = 'file' | 'directory' | 'typeMismatch';
type TransferCompletionStatus = 'Completed' | 'Completed with errors' | 'Completed with skipped items' | 'Canceled' | 'Failed';
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
  canceledItems: string[];
}

interface ConfirmDialogOptions {
  title: string;
  message: string;
  details?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  hideCancel?: boolean;
}

interface AggregateTransferState {
  completedBytes: number;
  totalBytes: number;
}

interface ActiveRemoteCommandState {
  id: string;
  connectionId: string;
  cancellationSource: vscode.CancellationTokenSource;
  control?: RemoteCommandStreamingControl;
  stopMode?: 'stop' | 'force';
}

interface ServerDashboardOverviewItem {
  label: string;
  value: string;
  help: string;
}

interface ServerDashboardSystemInfoItem {
  label: string;
  value: string;
}

interface ServerDashboardServiceItem {
  id: string;
  name: string;
  displayName: string;
  status: 'running' | 'stopped' | 'failed' | 'unknown';
  statusLabel: string;
  rawStatus: string;
  description: string;
  adapter: string;
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
}

interface ServerDashboardProcessItem {
  id: string;
  pid: string;
  user: string;
  cpu: string;
  memory: string;
  command: string;
  args: string;
  adapter: string;
  canKill: boolean;
}

interface ServerDashboardScheduledJobItem {
  id: string;
  name: string;
  countLabel: string;
  typeLabel: string;
  source: string;
  sourceType: string;
  user: string;
  path: string;
  canOpen: boolean;
  canEdit: boolean;
  copyValue: string;
}

interface ServerDashboardSnapshot {
  connectionId: string;
  requestId: string;
  refreshedAt: number;
  overview: ServerDashboardOverviewItem[];
  systemInfo: ServerDashboardSystemInfoItem[];
  services: ServerDashboardServiceItem[];
  serviceAdapter: string;
  processes: ServerDashboardProcessItem[];
  processAdapter: string;
  scheduledJobs: ServerDashboardScheduledJobItem[];
  scheduledJobsAdapter: string;
  capabilities: string[];
  error?: string;
}

interface PendingRemoteSearchResultBatch {
  meta: RemoteSearchResultMeta;
  results: RemoteSearchResult[];
  timer?: NodeJS.Timeout;
}

interface QueuedTransferJob {
  id: string;
  operation: 'Upload' | 'Download';
  source?: 'webview' | 'sidebar';
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



interface ActiveTransferState {
  job: QueuedTransferJob;
  cancellationSource: vscode.CancellationTokenSource;
  connectionId: string;
  canceling: boolean;
  status: 'Preparing' | 'Running' | 'Waiting';
}

interface PendingConnectionSnapshot extends ActiveConnection {
  connectionState: 'connecting' | 'failed';
  currentPath: string;
  sudoModeEnabled: boolean;
  error?: string;
}

export interface TransferQueueItemSnapshot {
  id: string;
  operation: 'Upload' | 'Download';
  title: string;
  connection: string;
  from: string;
  to: string;
  connectionId: string;
  status: 'Preparing' | 'Running' | 'Waiting' | 'Canceling' | TransferCompletionStatus;
  progress: string;
  canCancel: boolean;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  skippedItems?: string[];
  failedItems?: string[];
  canceledItems?: string[];
}

export interface TransferQueueStateSnapshot {
  current?: TransferQueueItemSnapshot;
  currentTransfers?: TransferQueueItemSnapshot[];
  pending: TransferQueueItemSnapshot[];
  completed: TransferQueueItemSnapshot[];
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
  private readonly pendingRemoteSearchResultBatches = new Map<string, PendingRemoteSearchResultBatch>();
  private runningTransfers = 0;
  private sessionOrder: string[] = [];

  private readonly activeConnectionCancellationSources = new Map<string, vscode.CancellationTokenSource>();
  private readonly pendingConnectionOptions = new Map<string, ConnectOptions>();
  private readonly disconnectingConnectionIds = new Set<string>();
  private directoryListRequestSequence = 0;
  private readonly activeRemoteCommands = new Map<string, ActiveRemoteCommandState>();
  private pendingPermissionsDialogResolve: ((result?: SetPermissionsDialogResult) => void) | undefined;
  private readonly pendingConfirmDialogs = new Map<string, (confirmed: boolean) => void>();
  private readonly pendingInputDialogs = new Map<string, (value: string | undefined) => void>();
  private readonly virtualDocuments = new Map<string, string>();
  private confirmDialogSequence = 0;
  private inputDialogSequence = 0;
  private pendingImportBackupFile: RemoteEditBackupFile | undefined;

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
    return RemoteEditPanel.currentPanel?.buildTransferQueueStateSnapshot() || { pending: [], completed: [] };
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
    this.sshTerminalService = new SshTerminalService(this.sessions);
    this.portForwardManager = new PortForwardManager(this.sessions, state => this.postPortForwardState(state));
    this.remoteSearchService = new RemoteSearchService(this.sessions, this.output, {
      onStarted: snapshot => this.postRemoteSearchStarted(snapshot),
      onResult: (result, meta) => this.queueRemoteSearchResult(result, meta),
      onFinished: snapshot => this.postRemoteSearchFinished(snapshot)
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
          await this.sendProfiles(event.selectedId);
          this.postPersistentStorageSnapshot();
        })().catch(error => this.showCommandError(error));
      }),
      RemoteEditSharedState.onRemoteDirectoryChanged(event => {
        if (event.source === 'webview') {
          return;
        }

        void this.refreshCurrentDirectoryFromSharedChange(event.connectionId, event.remotePath).catch(error => this.showCommandError(error));
      }),
      LogViewerPanel.onDidChangeActiveSessionCount(() => this.postLogViewerActiveSessionCount()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('remoteedit.remotePathBreadcrumb.showDirectoryDetails')) {
          return;
        }

        this.postRemotePathBreadcrumbSettings();
      })
    );

    const connectionChangeEvent = (this.sessions as RemoteSessionManager & ConnectionChangeNotifier).onDidChangeConnections;

    if (connectionChangeEvent) {
      this.disposables.push(connectionChangeEvent(() => this.syncSessionsFromSharedManager()));
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
    this.clearAllPendingRemoteSearchResults();
    this.resolvePendingPermissionsDialog();
    this.resolvePendingConfirmDialogs();
    this.resolvePendingInputDialogs();
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
        },
        saveConnection: payload => this.saveConnection(payload),
        pickPrivateKeyPath: () => this.pickPrivateKeyPath(),
        pickCaCertificatePath: () => this.pickCaCertificatePath(),
        deleteConnection: payload => this.deleteConnection(payload),
        renameConnection: payload => this.renameConnection(payload),
        reorderConnections: payload => this.reorderConnections(payload),
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
        requestDeleteEntry: payload => this.requestDeleteEntry(payload),
        requestDeleteEntries: payload => this.requestDeleteEntries(payload),
        requestUploadEntries: payload => this.requestUploadEntries(payload),
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
        confirmDialogResponse: payload => this.handleConfirmDialogResponse(payload),
        inputDialogResponse: payload => this.handleInputDialogResponse(payload),
        transferConflictResponse: payload => this.handleTransferConflictResponse(payload),
        log: logMessage => this.logDebug(logMessage),
        performanceLog: payload => this.logWebviewPerformance(payload),
        unknown: messageType => this.postError(`Unknown webview message: ${messageType}`)
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const friendlyMessage = this.formatError(message.type, message.payload, messageText);
      if (this.isMissingRemoteConnectionError(messageText)) {
        await this.markRemoteConnectionUnavailableFromMessage(message, messageText);
      }
      const statusMessage = this.formatStatusError(message.type, messageText);
      this.logError(statusMessage, { Details: friendlyMessage });
      if (friendlyMessage !== messageText && !this.normalizeMessageForComparison(friendlyMessage).includes(this.normalizeMessageForComparison(messageText))) {
        this.logError('Raw error details.', { Details: messageText });
      }
      const handledAsBackupOperation = this.postBackupOperationError(message.type, friendlyMessage);
      if (!handledAsBackupOperation) {
        if (this.isServerViewMessageType(message.type)) {
          this.postServerStatus(statusMessage, true);
        } else {
          this.postError(statusMessage, { showOutputLink: this.shouldShowStatusOutputLink(message.type, messageText, friendlyMessage, statusMessage) });
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

  private isMissingRemoteConnectionError(message: string): boolean {
    const lower = String(message || '').toLowerCase();

    return /no\s+(sftp|ftp|ftps)\s+connection\s+available/.test(lower)
      || /remoteedit connection ['"].+['"] is not connected/.test(lower)
      || lower.includes('connect to a host before browsing or opening remote files')
      || lower.includes('the selected remoteedit connection is not connected')
      || lower.includes('no active connection')
      || lower.includes('no response from server')
      || lower.includes('connection is no longer available')
      || lower.includes('connection closed')
      || lower.includes('connection lost');
  }

  private formatMissingRemoteConnectionMessage(details?: string): string {
    const suffix = details ? ` Error: ${details}` : '';
    return `The remote connection is no longer available. Reconnect to continue browsing.${suffix}`;
  }

  private isConnectionStateOperation(messageType: string): boolean {
    return messageType === RemoteEditIncomingMessageType.Connect
      || messageType === RemoteEditIncomingMessageType.CancelConnection
      || messageType === RemoteEditIncomingMessageType.Disconnect
      || messageType === RemoteEditIncomingMessageType.SaveConnection
      || messageType === RemoteEditIncomingMessageType.DeleteConnection
      || messageType === RemoteEditIncomingMessageType.RenameConnection
      || messageType === RemoteEditIncomingMessageType.ExportConnectionsSettings
      || messageType === RemoteEditIncomingMessageType.ImportConnectionsSettings
      || messageType === RemoteEditIncomingMessageType.RequestImportConnectionsSettings
      || messageType === RemoteEditIncomingMessageType.PickPrivateKeyPath
      || messageType === RemoteEditIncomingMessageType.PickCaCertificatePath
      || messageType === RemoteEditIncomingMessageType.Ready;
  }

  private extractConnectionIdFromError(message: string): string | undefined {
    const match = String(message || '').match(/Remote Edit connection ['"]([^'"]+)['"] is not connected/i);
    return match?.[1];
  }

  private getMessageConnectionId(message: RemoteEditWebviewMessage): string | undefined {
    const payloadConnectionId = String(message.payload?.connectionId || '').trim();

    if (payloadConnectionId) {
      return payloadConnectionId;
    }

    return this.state.getActiveConnectionId();
  }

  private async markRemoteConnectionUnavailableFromMessage(message: RemoteEditWebviewMessage, details: string): Promise<void> {
    if (this.isConnectionStateOperation(message.type)) {
      return;
    }

    const connectionId = this.extractConnectionIdFromError(details) || this.getMessageConnectionId(message);

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
    const profiles = await this.connectionManager.listProfiles();
    this.postMessage(RemoteEditOutboundMessageType.ProfilesLoaded, { profiles, selectedId });
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
    this.postBusy(true, 'Saving connection...');
    const profile = await this.connectionManager.saveProfile(payload || {});
    await this.sendProfiles(profile.id);
    RemoteEditSharedState.fireProfilesChanged(profile.id, 'webview');
    this.postBusy(false, 'Connection saved.');
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

    await this.connectionManager.reorderProfiles(profileIds);
    await this.sendProfiles(String(payload?.selectedId || ''));
    RemoteEditSharedState.fireProfilesChanged(String(payload?.selectedId || '') || undefined, 'webview');
    this.logInfo('Reordered saved connections.', { Count: String(profileIds.length) });
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
    this.postMessage(
      RemoteEditOutboundMessageType.PersistentStorageSnapshot,
      this.connectionManager.getPersistentWebviewStorageSnapshot()
    );
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
    RemoteEditSharedState.fireProfilesChanged(undefined, 'webview');
    this.postPersistentStorageSnapshot();

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

    this.postBusy(true, 'Removing connection...');

    if (this.sessions.hasConnection(profileId)) {
      await this.disconnect(profileId);
    }

    await this.connectionManager.deleteProfile(profileId);
    await this.sendProfiles('');
    RemoteEditSharedState.fireProfilesChanged(undefined, 'webview');
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
        this.logWarn('Connection failed.', { Target: target, Error: message });
        this.postBusy(false, 'Connection failed.', false, undefined, connectionId);
        this.postError(message || 'Connection failed.', { connectionId, showOutputLink: true });
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
    this.postBusy(true, 'Disconnecting...');
    this.disconnectingConnectionIds.add(connectionId);
    try {
      await this.portForwardManager.stopAllForConnection(connectionId);
      await this.sessions.disconnect(connectionId);
    } finally {
      this.disconnectingConnectionIds.delete(connectionId);
    }

    if (removedQueuedTransfers > 0) {
      this.postStatus(`${this.formatCount(removedQueuedTransfers, 'queued transfer')} removed for disconnected session.`);
    }
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

    this.postBusy(false, 'Disconnected.');
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
      ['Modified', this.formatTimestampForDialog(stats.modifyTime)],
      ['Accessed', this.formatTimestampForDialog(stats.accessTime)],
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
    this.postBusy(false, `Permissions set to ${normalizedMode}.`);
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

    this.postBusy(true, `Loading ${normalizedPath}...`);

    let entries: RemoteEntry[];

    try {
      entries = await this.sessions.listDirectory(connectionId, normalizedPath, { forceRefresh: Boolean(options.forceRefresh) });
    } catch (error) {
      if (this.isStaleDirectoryListRequest(requestSequence, connectionId)) {
        return;
      }

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
    this.postBusy(false, `Loaded ${this.formatCount(entries.length, 'item')}.`);
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
            throwIfCancelled(token, 'Opening canceled.');

            const uri = buildRemoteEditUri(connectionId, entry.path, this.getActiveUriAuthority(), { readOnly });

            try {
              await this.sessions.prepareFileForOpen(connectionId, entry.path, token, progress);
              throwIfCancelled(token, 'Opening canceled.');
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
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Opening canceled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Opening canceled.');
        this.logInfo('Opening remote file canceled.');
        return;
      }

      throw error;
    }

    if (failedEntries.length) {
      if (resolvedEntries.length === 1) {
        const failed = failedEntries[0];
        await this.showRemoteFileOpenFailureDialog(
          readOnly ? 'Could not open remote file read-only' : 'Could not open remote file',
          failed.path,
          this.formatRemoteFileOpenFailureReason(failed.error, failed.path)
        );
      } else {
        const openedCount = resolvedEntries.length - failedEntries.length;
        const detail = failedEntries
          .map(item => `Path: ${item.path}\nReason: ${this.formatRemoteFileOpenFailureReason(item.error, item.path)}`)
          .join('\n\n');
        await this.showConfirmDialog({
          title: 'Some remote files could not be opened',
          message: `Opened ${openedCount} of ${this.formatCount(resolvedEntries.length, 'remote file')}.`,
          details: detail,
          confirmLabel: 'OK',
          hideCancel: true
        });
      }
    }

    const openSuccessMessage = failedEntries.length
      ? failedEntries.length === resolvedEntries.length
        ? (readOnly ? 'Remote file could not be opened read-only.' : 'Remote file could not be opened.')
        : `Opened ${resolvedEntries.length - failedEntries.length} of ${this.formatCount(resolvedEntries.length, 'remote file')}.`
      : resolvedEntries.length === 1
        ? (readOnly ? 'File opened read-only.' : 'File opened.')
        : (readOnly
          ? `${this.formatCount(resolvedEntries.length, 'remote file')} opened read-only.`
          : `${this.formatCount(resolvedEntries.length, 'remote file')} opened.`);

    this.postBusy(false, openSuccessMessage);
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
          throwIfCancelled(token, 'Compare canceled.');
          await this.sessions.prepareFileForOpen(connectionId, right.path, token, progress);
          throwIfCancelled(token, 'Compare canceled.');
        },
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Compare canceled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Compare canceled.');
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
    this.postBusy(false, 'Comparison opened.');
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
    RemoteEditSharedState.fireFavoritesChanged(connectionId, 'webview');
    await this.sendProfiles(connectionId);
    this.postStatus('Favorite added.');
    this.logInfo('Added remote path favorite.', { Connection: connectionId, Path: remotePath });
  }

  private async removeRemotePathFavorite(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || this.getActivePath() || '').trim());

    await this.connectionManager.removeFavoriteRemotePath(connectionId, remotePath);
    RemoteEditSharedState.fireFavoritesChanged(connectionId, 'webview');
    await this.sendProfiles(connectionId);
    this.postStatus('Favorite removed.');
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
          throwIfCancelled(token, 'Opening canceled.');
        },
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Opening canceled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Opening canceled.');
        this.logInfo('Opening remote file canceled.', { Path: this.buildRemoteReference(normalizedPath) });
        return;
      }

      throw error;
    }

    await vscode.commands.executeCommand('vscode.open', uri, { preview: false });

    this.logInfo('Opened remote file.', { Path: this.buildRemoteReference(normalizedPath) });
    this.postBusy(false, 'File opened.');
  }

  private async copyRemotePath(payload: any): Promise<void> {
    this.requireActiveConnectionId();

    const remotePath = normalizeRemotePath(String(payload?.path || this.getActivePath() || '/'));
    const remoteReference = this.buildRemoteReference(remotePath);
    await vscode.env.clipboard.writeText(remoteReference);
    this.postStatus('Remote path copied.');
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
      this.postStatus(entryKind === 'directory' ? 'Create directory canceled.' : 'Create file canceled.');
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
    RemoteEditSharedState.fireRemoteDirectoryChanged(connectionId, targetDirectory, 'webview');
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
      this.postStatus('Make a copy canceled.');
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
        this.postStatus('Make a copy canceled.');
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
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Copy canceled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Copy canceled.');
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
      this.postBusy(false, `Calculated checksums for ${entryName}.`);
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Checksum calculation canceled.');
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
      this.postStatus('Rename canceled.');
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
    this.postBusy(false, 'Item renamed.');
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
      this.postStatus('Delete canceled.');
      return;
    }

    const parentPath = dirnameRemotePath(remotePath);
    this.postBusy(true, `Deleting ${entryName}...`);
    await this.sessions.delete(connectionId, remotePath);
    this.logInfo('Deleted remote item.', { Path: this.buildRemoteReference(remotePath) });
    await this.listDirectory(parentPath);
    RemoteEditSharedState.fireRemoteDirectoryChanged(connectionId, parentPath, 'webview');
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
      this.postStatus('Delete canceled.');
      return;
    }

    this.postBusy(true, `Deleting ${entries.length} remote items...`);

    for (const entry of entries) {
      await this.sessions.delete(connectionId, entry.path);
      this.logInfo('Deleted remote item.', { Path: this.buildRemoteReference(entry.path) });
    }

    const currentPath = this.getActivePath();
    await this.listDirectory(currentPath);
    RemoteEditSharedState.fireRemoteDirectoryChanged(connectionId, currentPath, 'webview');
    this.postBusy(false, `${this.formatCount(entries.length, 'item')} deleted.`);
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
    const archiveNameInput = await this.showWebviewInputBox({
      title: 'Compress to Archive',
      prompt: 'Enter the archive filename to create in the current remote directory.',
      label: 'Archive name',
      value: defaultName,
      valueSelection: [0, defaultName.length],
      confirmLabel: 'Create',
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
      this.postStatus('Compress to archive canceled.');
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
        this.postStatus('Compress to archive canceled.');
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
        { cancellable: true, returnOnCancel: true, cancelMessage: 'Archive creation canceled.' }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        this.postBusy(false, 'Archive creation canceled.');
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
    const connectionId = this.requireTransferConnectionId(payload);
    const targetDirectory = normalizeRemotePath(String(payload?.targetDirectory || this.getActivePath()));
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
      this.postStatus('Upload canceled.');
      return;
    }

    this.enqueueTransferJob({
      id: this.createTransferJobId(),
      operation: 'Upload',
      source: transferSource,
      connectionId,
      connectionLabel: this.buildTransferConnectionLabel(connectionId),
      title: this.buildSelectedLocalItemsLabel(selectedUris),
      from: this.buildUploadQueueSourceLabel(selectedUris),
      to: this.buildUploadQueueTargetLabel(selectedUris, targetDirectory),
      progress: '--',
      run: cancellationSource => this.runUploadTransfer(connectionId, targetDirectory, selectedUris, cancellationSource)
    });
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
    transferCancellationSource: vscode.CancellationTokenSource
  ): Promise<TransferCompletionStatus> {
    this.postStatus('Preparing upload...');
    this.setActiveTransferProgress('Preparing upload...');

    const token = transferCancellationSource.token;
    const summary: TransferSummary = { transferredFiles: 0, skippedItems: [], failedItems: [], canceledItems: [] };
    const skipped = this.createTransferSkipState();
    throwIfCancelled(token, 'Upload canceled.');
    const items = await this.collectUploadTransferItems(selectedUris, targetDirectory, summary, token);
    throwIfCancelled(token, 'Upload canceled.');

    if (!items.length) {
      const completionStatus = this.getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Upload', this.buildTransferCompletionStatusText('Upload', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
      this.postStatus(this.buildTransferStatusMessage('Upload', summary));
      await this.showTransferSummary('Upload', summary);
      return completionStatus;
    }

    try {
      await this.prepareUploadConflicts(connectionId, items, summary, skipped, token);
    } catch (error) {
      if (this.formatTransferError(error) === 'Upload canceled.') {
        this.addCanceledTransferItem(summary, '');
        this.setActiveTransferResultSummary(summary);
        this.logActiveTransferEvent('Upload', 'Upload canceled during conflict resolution.', { SkippedItems: summary.skippedItems.length });
        this.postStatus('Upload canceled.');
        return 'Canceled';
      }
      throw error;
    }

    const remainingItems = items.filter(item => !this.shouldSkipTransferItem(item.relativePath, skipped));

    if (!remainingItems.length) {
      const completionStatus = this.getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Upload', this.buildTransferCompletionStatusText('Upload', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
      this.postStatus(this.buildTransferStatusMessage('Upload', summary));
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
              if (this.isTransferCancellationError(error, token)) {
                this.addCanceledTransferItem(summary, item.relativePath);
                throw new RemoteEditOperationCancelledError('Upload canceled.');
              }
              summary.failedItems.push(`${item.relativePath}: ${this.formatTransferError(error)}`);
            }
          }

          for (const [index, item] of uploadFileItems.entries()) {
            const progressDetail = this.buildTransferProgressDetail(item.relativePath, index + 1, uploadFileItems.length);
            throwIfCancelled(token, 'Upload canceled.');

            try {
              await this.sessions.createDirectory(connectionId, dirnameRemotePath(item.remotePath));
              throwIfCancelled(token, 'Upload canceled.');
              const content = await this.readLocalFileWithCancellation(item.localPath, token);
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
              if (this.isTransferCancellationError(error, token)) {
                this.addCanceledTransferItem(summary, item.relativePath);
                throw new RemoteEditOperationCancelledError('Upload canceled.');
              }
              summary.failedItems.push(`${item.relativePath}: ${this.formatTransferError(error)}`);
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
            this.addCanceledTransferItem(summary, '');
          }
          this.logActiveTransferEvent('Upload', 'Upload canceled.', { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
          return;
        }
        throw error;
      });
    } finally {
      await this.listDirectory(targetDirectory);
    }

    if (uploadCanceled) {
      this.setActiveTransferResultSummary(summary);
      this.postStatus('Upload canceled.');
      await this.showTransferSummary('Upload', summary);
      return 'Canceled';
    }

    const completionStatus = this.getTransferCompletionStatus(summary);
    const completionMessage = this.buildTransferCompletionStatusText('Upload', summary);
    this.setActiveTransferResultSummary(summary);
    this.logActiveTransferEvent('Upload', completionMessage, { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
    this.postStatus(this.buildTransferStatusMessage('Upload', summary));
    await this.showTransferSummary('Upload', summary);
    return completionStatus;
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
      this.postStatus('Download canceled.');
      return;
    }

    this.enqueueTransferJob({
      id: this.createTransferJobId(),
      operation: 'Download',
      source: transferSource,
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
    const summary: TransferSummary = { transferredFiles: 0, skippedItems: [], failedItems: [], canceledItems: [] };
    const skipped = this.createTransferSkipState();
    const items: DownloadTransferItem[] = [];

    for (const entry of entries) {
      throwIfCancelled(token, 'Download canceled.');
      await this.collectDownloadTransferItems(connectionId, entry, targetFolder, summary, items, token);
    }
    throwIfCancelled(token, 'Download canceled.');

    if (!items.length) {
      const completionStatus = this.getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Download', this.buildTransferCompletionStatusText('Download', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
      this.postStatus(this.buildTransferStatusMessage('Download', summary));
      await this.showTransferSummary('Download', summary);
      return completionStatus;
    }

    try {
      await this.prepareDownloadConflicts(connectionId, items, summary, skipped, token);
    } catch (error) {
      if (this.formatTransferError(error) === 'Download canceled.') {
        this.addCanceledTransferItem(summary, '');
        this.setActiveTransferResultSummary(summary);
        this.logActiveTransferEvent('Download', 'Download canceled during conflict resolution.', { SkippedItems: summary.skippedItems.length });
        this.postStatus('Download canceled.');
        return 'Canceled';
      }
      throw error;
    }

    const remainingItems = items.filter(item => !this.shouldSkipTransferItem(item.relativePath, skipped));

    if (!remainingItems.length) {
      const completionStatus = this.getTransferCompletionStatus(summary);
      this.setActiveTransferResultSummary(summary);
      this.logActiveTransferEvent('Download', this.buildTransferCompletionStatusText('Download', summary), { SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
      this.postStatus(this.buildTransferStatusMessage('Download', summary));
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
              if (this.isTransferCancellationError(error, token)) {
                this.addCanceledTransferItem(summary, item.relativePath);
                throw new RemoteEditOperationCancelledError('Download canceled.');
              }
              summary.failedItems.push(`${item.relativePath}: ${this.formatTransferError(error)}`);
            }
          }

          for (const [index, item] of downloadFileItems.entries()) {
            const progressDetail = this.buildTransferProgressDetail(item.relativePath, index + 1, downloadFileItems.length);
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
              await this.writeLocalFileSafely(item.localPath, content);
              throwIfCancelled(token, 'Download canceled.');
              aggregateState.completedBytes += item.size;
              progress.reportBytes('Downloading...', aggregateState.completedBytes, aggregateState.totalBytes, progressDetail);
              summary.transferredFiles += 1;
            } catch (error) {
              if (this.isTransferCancellationError(error, token)) {
                this.addCanceledTransferItem(summary, item.relativePath);
                throw new RemoteEditOperationCancelledError('Download canceled.');
              }
              summary.failedItems.push(`${item.relativePath}: ${this.formatTransferError(error)}`);
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
            this.addCanceledTransferItem(summary, '');
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

    const completionStatus = this.getTransferCompletionStatus(summary);
    const completionMessage = this.buildTransferCompletionStatusText('Download', summary);
    this.setActiveTransferResultSummary(summary);
    this.logActiveTransferEvent('Download', completionMessage, { TransferredFiles: summary.transferredFiles, SkippedItems: summary.skippedItems.length, FailedItems: summary.failedItems.length, CanceledItems: summary.canceledItems.length });
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
      throwIfCancelled(token, 'Upload canceled.');
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
    throwIfCancelled(token, 'Upload canceled.');
    const stats = await fs.lstat(localPath);
    throwIfCancelled(token, 'Upload canceled.');

    if (stats.isSymbolicLink()) {
      summary.skippedItems.push(`${relativePath}: skipped symbolic link`);
      return;
    }

    const remotePath = this.joinRemoteRelativePath(targetDirectory, relativePath);

    if (stats.isDirectory()) {
      items.push({ kind: 'directory', localPath, remotePath, relativePath, size: 0 });
      const children = await fs.readdir(localPath);
      for (const child of children) {
        throwIfCancelled(token, 'Upload canceled.');
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

    const localPath = path.join(targetFolder, ...this.toPosixRelativePath(relativePath).split('/').filter(Boolean));

    if (resolvedType === 'directory') {
      items.push({ kind: 'directory', remotePath, localPath, relativePath: this.toPosixRelativePath(relativePath), size: 0 });
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
      throwIfCancelled(token, 'Download canceled.');
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
      throwIfCancelled(token, 'Upload canceled.');
      if (this.shouldSkipTransferItem(item.relativePath, skipped)) {
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
        throwIfCancelled(token, 'Upload canceled.');

        if (decision === 'cancel') {
          throw new Error('Upload canceled.');
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
        throwIfCancelled(token, 'Upload canceled.');

        if (decision === 'cancel') {
          throw new Error('Upload canceled.');
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
      throwIfCancelled(token, 'Upload canceled.');

      if (decision === 'cancel') {
        throw new Error('Upload canceled.');
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
      throwIfCancelled(token, 'Download canceled.');
      if (this.shouldSkipTransferItem(item.relativePath, skipped)) {
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
        throwIfCancelled(token, 'Download canceled.');

        if (decision === 'cancel') {
          throw new Error('Download canceled.');
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
        throwIfCancelled(token, 'Download canceled.');

        if (decision === 'cancel') {
          throw new Error('Download canceled.');
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
      throwIfCancelled(token, 'Download canceled.');

      if (decision === 'cancel') {
        throw new Error('Download canceled.');
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
    const choices = this.buildTransferConflictChoices(options as PendingTransferConflict);
    const nativeChoices = choices.filter(choice => choice.decision !== 'cancel');
    const labels = Array.from(new Set(nativeChoices.map(choice => choice.label)));
    const message = this.buildNativeTransferConflictMessage(options);
    const detail = this.buildNativeTransferConflictDetail(options);

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

  private buildNativeTransferConflictMessage(options: Omit<PendingTransferConflict, 'requestId' | 'transferId' | 'resolve'>): string {
    const operation = options.operation.toLowerCase();

    if (options.kind === 'directory') {
      return `Remote Edit: ${operation} folder conflict. The directory already exists. What would you like to do?`;
    }

    if (options.kind === 'typeMismatch') {
      return `Remote Edit: ${operation} type conflict. ${this.buildTypeMismatchConflictMessage(options as PendingTransferConflict)}`;
    }

    return `Remote Edit: ${operation} file conflict. The file already exists. What would you like to do?`;
  }

  private buildNativeTransferConflictDetail(options: Omit<PendingTransferConflict, 'requestId' | 'transferId' | 'resolve'>): string {
    const lines = [
      `Item: ${options.relativePath}`,
      `Source: ${options.sourcePath}`,
      `Destination: ${options.destinationPath}`
    ];

    if (options.kind === 'directory') {
      lines.push('', 'Merge uses the existing directory and copies content into it. It does not delete extra files already in the destination.');
    }

    return lines.join('\n');
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
    this.postStatus(`${message} ${this.formatQueuedTransferCount(queuedCount)}`);
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
        this.postTransferQueueState();
        continue;
      }

      this.runningTransfers += 1;
      const transferCancellationSource = new vscode.CancellationTokenSource();
      job.startedAt = this.formatLocalDateTime(new Date());
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
            const details = this.formatTransferError(error);
            this.logTransferEvent(job, `${job.operation} failed.`, { Details: details });
            this.postOperationError(this.formatFailureStatus(`${job.operation} failed`, details));
            this.addCompletedTransfer(job, 'Failed');
          }
        } finally {
          this.cancelPendingTransferConflict(job.id);
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


  private formatCount(count: number, singular: string, plural?: string): string {
    const safeCount = Number.isFinite(count) ? count : 0;
    return `${safeCount} ${safeCount === 1 ? singular : (plural || `${singular}s`)}`;
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
      queuedAt: this.formatLocalDateTime(new Date()),
      startedAt: this.formatLocalDateTime(new Date()),
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
    this.logTransferEvent(removedTransfer, `${removedTransfer.operation} removed from queue.`);
    this.postStatus(`${removedTransfer.operation} removed from queue.`);
    this.updateActiveTransferStatusBarItem();
    this.postTransferQueueState();
  }

  private postTransferQueueState(): void {
    const state = this.buildTransferQueueStateSnapshot();
    this.postMessage(RemoteEditOutboundMessageType.TransferQueueChanged, state);
    RemoteEditPanel.transferQueueChangedEmitter.fire(state);
  }

  private buildTransferQueueStateSnapshot(): TransferQueueStateSnapshot {
    const currentTransfers = Array.from(this.activeTransfers.values()).map(activeTransfer => this.buildTransferQueueItemSnapshot(
      activeTransfer.job,
      activeTransfer.canceling ? 'Canceling' : activeTransfer.status,
      !activeTransfer.canceling
    ));

    return {
      current: currentTransfers[0],
      currentTransfers,
      pending: this.transferQueue.map(job => this.buildTransferQueueItemSnapshot(job, 'Waiting', false)),
      completed: this.completedTransfers.slice()
    };
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
      failedItems: job.resultSummary?.failedItems.slice(),
      canceledItems: job.resultSummary?.canceledItems.slice()
    };
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

  private formatLocalDateTime(date: Date): string {
    const pad = (value: number): string => value.toString().padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

  private async readLocalFileWithCancellation(localPath: string, token: vscode.CancellationToken): Promise<Buffer> {
    throwIfCancelled(token, 'Upload canceled.');

    const abortController = new AbortController();
    const cancellationSubscription = token.onCancellationRequested(() => abortController.abort());

    try {
      const content = await fs.readFile(localPath, { signal: abortController.signal });
      throwIfCancelled(token, 'Upload canceled.');
      return content;
    } catch (error) {
      if (token.isCancellationRequested || (error instanceof Error && error.name === 'AbortError')) {
        throw new RemoteEditOperationCancelledError('Upload canceled.');
      }

      throw error;
    } finally {
      cancellationSubscription.dispose();
    }
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

  private isTransferCancellationError(error: unknown, token?: vscode.CancellationToken): boolean {
    if (token?.isCancellationRequested || isRemoteEditOperationCancelled(error)) {
      return true;
    }

    const message = this.formatTransferError(error).trim().toLowerCase();
    return message === 'operation canceled.'
      || message === 'operation cancelled.'
      || message === 'upload canceled.'
      || message === 'upload cancelled.'
      || message === 'download canceled.'
      || message === 'download cancelled.';
  }

  private addCanceledTransferItem(summary: TransferSummary, relativePath: string): void {
    const safePath = String(relativePath || '').trim();
    const item = safePath ? `${safePath}: Operation canceled.` : 'Operation canceled.';

    if (!summary.canceledItems.includes(item)) {
      summary.canceledItems.push(item);
    }
  }

  private getTransferCompletionStatus(summary: TransferSummary): TransferCompletionStatus {
    if (summary.canceledItems.length > 0 && summary.failedItems.length === 0) {
      return 'Canceled';
    }

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

    if (completionStatus === 'Canceled') {
      return `${operation} canceled.`;
    }

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
    const transferredLabel = this.formatCount(summary.transferredFiles, 'file');
    const skippedLabel = this.formatCount(summary.skippedItems.length, 'skipped item');
    const failedLabel = this.formatCount(summary.failedItems.length, 'failed item');
    const canceledLabel = this.formatCount(summary.canceledItems.length, 'canceled item');
    const completionStatus = this.getTransferCompletionStatus(summary);

    if (completionStatus === 'Canceled') {
      return `${operation} canceled. ${transferredLabel} transferred, ${skippedLabel}, ${canceledLabel}.`;
    }

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
    const transferredLabel = this.formatCount(summary.transferredFiles, 'file');
    const skippedLabel = this.formatCount(summary.skippedItems.length, 'skipped item');

    if (summary.canceledItems.length > 0 && summary.failedItems.length === 0) {
      return `${transferredLabel} transferred, ${skippedLabel}, ${this.formatCount(summary.canceledItems.length, 'canceled item')}.`;
    }

    return `${transferredLabel} transferred, ${skippedLabel}, ${this.formatCount(summary.failedItems.length, 'failed item')}.`;
  }



  private async requestPortForwardState(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.state.getActiveConnectionId() || '').trim();
    const ids = Array.isArray(payload?.ids) ? payload.ids.map((id: unknown) => String(id || '').trim()).filter(Boolean) : [];

    if (!connectionId) {
      return;
    }

    if (ids.length > 0) {
      for (const id of ids) {
        this.postPortForwardState(this.portForwardManager.getState(connectionId, id));
      }
      return;
    }

    for (const state of this.portForwardManager.listStates(connectionId)) {
      this.postPortForwardState(state);
    }
  }

  private async startPortForward(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.state.getActiveConnectionId() || '').trim();
    const config = this.parsePortForwardConfig(payload?.forward || payload || {});

    if (!connectionId) {
      throw new Error('No active connection.');
    }

    const connection = this.sessions.getConnection(connectionId);
    if (!connection || String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      throw new Error('Port forwarding requires an active SSH/SFTP connection.');
    }

    const state = await this.portForwardManager.startForward(connectionId, config);
    this.postPortForwardState(state);

    if (state.status === 'error' && state.error) {
      this.logError('Port forwarding failed.', {
        Connection: connection.name || connectionId,
        Forward: this.formatPortForwardLabel(config),
        Details: state.error
      });
    } else if (state.status === 'running') {
      this.logInfo('Started port forward.', {
        Connection: connection.name || connectionId,
        Forward: this.formatPortForwardLabel(config)
      });
    }
  }

  private async stopPortForward(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.state.getActiveConnectionId() || '').trim();
    const forwardId = String(payload?.id || payload?.forwardId || payload?.forward?.id || '').trim();

    if (!connectionId || !forwardId) {
      return;
    }

    const state = await this.portForwardManager.stopForward(connectionId, forwardId);
    this.postPortForwardState(state);
  }

  private parsePortForwardConfig(value: any): SavedPortForwardConfig {
    const id = String(value?.id || '').trim();
    const localPort = Number(value?.localPort || 0);
    const remotePort = Number(value?.remotePort || 0);
    const localHost = String(value?.localHost || '').trim() || 'localhost';
    const remoteHost = String(value?.remoteHost || '').trim() || '127.0.0.1';
    const name = String(value?.name || '').trim() || `${localPort || ''} → ${remotePort || ''}`.trim() || 'Port forward';

    if (!id) {
      throw new Error('Port forward id is required.');
    }

    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535 || !Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
      throw new Error('Ports must be between 1 and 65535.');
    }

    return { id, name, localHost, localPort, remoteHost, remotePort, autoStartOnConnect: Boolean(value?.autoStartOnConnect) };
  }

  private formatPortForwardLabel(config: SavedPortForwardConfig): string {
    return `${config.localHost}:${config.localPort} → ${config.remoteHost}:${config.remotePort}`;
  }

  private postPortForwardState(state: PortForwardRuntimeState): void {
    this.postMessage(RemoteEditOutboundMessageType.PortForwardStateChanged, state);
  }

  private postAllPortForwardStates(): void {
    for (const connection of this.sessions.listConnections()) {
      for (const state of this.portForwardManager.listStates(connection.id)) {
        this.postPortForwardState(state);
      }
    }
  }

  private async requestServerServiceDetails(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.state.getActiveConnectionId() || '').trim();
    const serviceName = String(payload?.name || '').trim();
    const adapter = String(payload?.adapter || '').trim();

    if (!connectionId || !serviceName) {
      return;
    }

    const connection = this.sessions.getConnection(connectionId);
    if (!connection || String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      await this.showConfirmDialog({
        title: 'Service Details',
        message: 'Service details are unavailable.',
        details: 'Server services require an active SSH/SFTP connection.',
        confirmLabel: 'OK',
        hideCancel: true
      });
      return;
    }

    const command = this.buildServerServiceDetailsCommand(adapter, serviceName);
    if (!command) {
      await this.showConfirmDialog({
        title: 'Service Details',
        message: serviceName,
        details: `Adapter ${adapter || 'unknown'} does not support service details yet.`,
        confirmLabel: 'OK',
        hideCancel: true
      });
      return;
    }

    try {
      const result = await this.runServerManagementCommand(connectionId, command);
      const output = this.normalizeServerCommandOutput(result.stdout, result.stderr, result.code);
      await this.showConfirmDialog({
        title: 'Service Details',
        message: serviceName,
        details: output || 'No details returned.',
        confirmLabel: 'OK',
        hideCancel: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.showConfirmDialog({
        title: 'Service Details',
        message: serviceName,
        details: message || 'Could not read service details.',
        confirmLabel: 'OK',
        hideCancel: true
      });
    }
  }

  private async requestServerServiceAction(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.state.getActiveConnectionId() || '').trim();
    const serviceName = String(payload?.name || '').trim();
    const adapter = String(payload?.adapter || '').trim();
    const action = String(payload?.action || '').trim().toLowerCase();

    if (!connectionId || !serviceName || !['start', 'stop', 'restart'].includes(action)) {
      return;
    }

    const connection = this.sessions.getConnection(connectionId);
    if (!connection || String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      this.postServerStatus('Server services require an active SSH/SFTP connection.', true);
      return;
    }

    const command = this.buildServerServiceActionCommand(adapter, serviceName, action as 'start' | 'stop' | 'restart');
    if (!command) {
      await this.showConfirmDialog({
        title: 'Service action unavailable',
        message: serviceName,
        details: `Adapter ${adapter || 'unknown'} does not support ${action} yet.`,
        confirmLabel: 'OK',
        hideCancel: true
      });
      return;
    }

    const label = this.formatServerServiceActionLabel(action);
    const confirmed = await this.showConfirmDialog({
      title: `${label} service?`,
      message: `${label} ${serviceName}?`,
      details: `Adapter: ${adapter || 'unknown'}\nService: ${serviceName}`,
      confirmLabel: label,
      cancelLabel: 'Cancel',
      danger: action === 'stop' || action === 'restart'
    });

    if (!confirmed) {
      return;
    }

    try {
      const result = await this.runServerManagementCommand(connectionId, command);
      if (result.code !== 0) {
        await this.showConfirmDialog({
          title: 'Service action failed',
          message: `${label} failed for ${serviceName}.`,
          details: this.normalizeServerCommandOutput(result.stdout, result.stderr, result.code),
          confirmLabel: 'OK',
          hideCancel: true
        });
        return;
      }

      await this.requestServerDashboard({ connectionId, requestId: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.showConfirmDialog({
        title: 'Service action failed',
        message: `${label} failed for ${serviceName}.`,
        details: message || 'Unknown error',
        confirmLabel: 'OK',
        hideCancel: true
      });
    }
  }

  private async requestServerProcessDetails(payload: any): Promise<void> {
    const pid = String(payload?.pid || '').trim();
    if (!/^\d+$/.test(pid)) {
      return;
    }

    const details = [
      `PID: ${pid}`,
      `User: ${String(payload?.user || '—')}`,
      `CPU: ${String(payload?.cpu || '—')}`,
      `Memory: ${String(payload?.memory || '—')}`,
      `Command: ${String(payload?.command || '—')}`,
      `Args: ${String(payload?.args || '—')}`
    ].join('\n');

    await this.showConfirmDialog({
      title: 'Process Details',
      message: `PID ${pid}`,
      details,
      confirmLabel: 'OK',
      hideCancel: true
    });
  }

  private async requestServerProcessAction(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.state.getActiveConnectionId() || '').trim();
    const pid = String(payload?.pid || '').trim();
    const processSnapshot = this.buildServerProcessActionSnapshot(payload);

    if (!connectionId || !/^\d+$/.test(pid)) {
      return;
    }

    if (pid === '1') {
      await this.showConfirmDialog({
        title: 'Process action unavailable',
        message: 'PID 1 cannot be killed from Remote Edit.',
        details: 'Remote Edit blocks kill actions for PID 1 as a safety measure.',
        confirmLabel: 'OK',
        hideCancel: true
      });
      return;
    }

    const connection = this.sessions.getConnection(connectionId);
    if (!connection || String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      this.postServerStatus('Process actions require an active SSH/SFTP connection.', true);
      return;
    }

    const confirmed = await this.showConfirmDialog({
      title: 'Kill process?',
      message: `Kill PID ${pid}?`,
      details: [
        `PID: ${pid}`,
        `User: ${processSnapshot.user}`,
        `Command: ${processSnapshot.command}`,
        '',
        'This will send SIGTERM to the process.'
      ].join('\n'),
      confirmLabel: 'Kill',
      cancelLabel: 'Cancel',
      danger: true
    });

    if (!confirmed) {
      return;
    }

    this.postServerProcessActionState(connectionId, pid, 'killing', processSnapshot);

    try {
      const termResult = await this.runServerManagementCommand(connectionId, this.buildServerProcessKillCommand(pid, false));
      const termOutput = this.parseServerProcessKillOutput(termResult.stdout, termResult.stderr);

      if (!termOutput.stillRunning) {
        await this.finishServerProcessTerminated(connectionId, pid, processSnapshot);
        return;
      }

      if (termOutput.killRc !== 0) {
        this.postServerProcessActionState(connectionId, pid, 'clear', processSnapshot);
        await this.showConfirmDialog({
          title: 'Kill process failed',
          message: `Could not kill PID ${pid}.`,
          details: this.normalizeServerCommandOutput(termResult.stdout, termResult.stderr, termResult.code),
          confirmLabel: 'OK',
          hideCancel: true
        });
        await this.requestServerDashboard({ connectionId, requestId: '' });
        return;
      }

      this.postServerProcessActionState(connectionId, pid, 'still-running', processSnapshot);
      const forceConfirmed = await this.showConfirmDialog({
        title: 'Process is still running.',
        message: 'Force kill?',
        details: [
          `PID: ${pid}`,
          `User: ${processSnapshot.user}`,
          `Command: ${processSnapshot.command}`,
          '',
          'This will send SIGKILL (kill -9). The process cannot clean up before exiting.'
        ].join('\n'),
        confirmLabel: 'Force Kill',
        cancelLabel: 'Cancel',
        danger: true
      });

      if (!forceConfirmed) {
        this.postServerProcessActionState(connectionId, pid, 'clear', processSnapshot);
        await this.requestServerDashboard({ connectionId, requestId: '' });
        return;
      }

      this.postServerProcessActionState(connectionId, pid, 'killing', processSnapshot);
      const forceResult = await this.runServerManagementCommand(connectionId, this.buildServerProcessKillCommand(pid, true));
      const forceOutput = this.parseServerProcessKillOutput(forceResult.stdout, forceResult.stderr);

      if (!forceOutput.stillRunning) {
        await this.finishServerProcessTerminated(connectionId, pid, processSnapshot);
        return;
      }

      this.postServerProcessActionState(connectionId, pid, 'clear', processSnapshot);
      await this.showConfirmDialog({
        title: 'Force kill failed',
        message: `PID ${pid} is still running or could not be killed.`,
        details: this.normalizeServerCommandOutput(forceResult.stdout, forceResult.stderr, forceResult.code),
        confirmLabel: 'OK',
        hideCancel: true
      });
      await this.requestServerDashboard({ connectionId, requestId: '' });
      return;
    } catch (error) {
      this.postServerProcessActionState(connectionId, pid, 'clear', processSnapshot);
      const message = error instanceof Error ? error.message : String(error);
      await this.showConfirmDialog({
        title: 'Kill process failed',
        message: `Could not kill PID ${pid}.`,
        details: message || 'Unknown error',
        confirmLabel: 'OK',
        hideCancel: true
      });
      await this.requestServerDashboard({ connectionId, requestId: '' });
    }
  }

  private async requestServerScheduledJobAction(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.state.getActiveConnectionId() || '').trim();
    const action = String(payload?.action || 'open').trim().toLowerCase();
    const sourceType = String(payload?.sourceType || '').trim();
    const name = String(payload?.name || '').trim();
    const path = String(payload?.path || '').trim();
    const user = String(payload?.user || '').trim();
    const copyValue = String(payload?.copyValue || path || name || user || '').trim();

    if (!connectionId) {
      return;
    }

    if (action === 'copy') {
      if (!copyValue) {
        return;
      }
      await vscode.env.clipboard.writeText(copyValue);
      return;
    }

    if (sourceType === 'user') {
      if (action === 'edit') {
        await this.showConfirmDialog({
          title: 'Edit user crontab',
          message: 'Editing user crontabs is not enabled yet.',
          details: 'Remote Edit currently opens user crontabs read-only. Editing user crontabs needs a safer apply flow with validation and backup.',
          confirmLabel: 'OK',
          hideCancel: true
        });
        return;
      }

      await this.openUserCrontabReadOnly(connectionId, user || name || 'current');
      return;
    }

    if (!path || path === '/') {
      await this.showConfirmDialog({
        title: 'Cron job source unavailable',
        message: 'This cron job source cannot be opened.',
        details: copyValue || 'No remote path is available for this item.',
        confirmLabel: 'OK',
        hideCancel: true
      });
      return;
    }

    const entry = {
      path,
      name: path.split('/').filter(Boolean).pop() || name || path,
      type: 'file',
      effectiveType: 'file'
    };

    if (action === 'edit') {
      await this.openEntries({ entries: [entry] });
    } else {
      await this.openEntriesReadOnly({ entries: [entry] });
    }
  }

  private async openUserCrontabReadOnly(connectionId: string, user: string): Promise<void> {
    const normalizedUser = String(user || '').trim();
    if (!normalizedUser) {
      return;
    }

    const connection = this.sessions.getConnection(connectionId);
    if (!connection || String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      this.postServerStatus('Cron job actions require an active SSH/SFTP connection.', true);
      return;
    }

    const currentUser = String(connection.username || '').trim();
    const command = currentUser && normalizedUser === currentUser
      ? 'crontab -l 2>&1'
      : `crontab -u ${shellQuote(normalizedUser)} -l 2>/dev/null || crontab -l ${shellQuote(normalizedUser)} 2>&1`;

    let output = '';
    const result = await this.runServerManagementCommand(connectionId, command);
    output = `${result.stdout || ''}${result.stderr ? `
${result.stderr}` : ''}`.trimEnd();

    if (result.code !== 0 && !output) {
      output = `Could not read crontab for ${normalizedUser}.`;
    }

    const content = `${output || '# No crontab content.'}
`;
    const safeUser = normalizedUser.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'user';
    const uri = vscode.Uri.from({
      scheme: 'remoteedit-virtual',
      authority: 'scheduled-jobs',
      path: `/${safeUser}.crontab`,
      query: `connectionId=${encodeURIComponent(connectionId)}&user=${encodeURIComponent(normalizedUser)}&ts=${Date.now()}`
    });

    this.virtualDocuments.set(uri.toString(), content);
    await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
  }

  private buildServerProcessActionSnapshot(payload: any): ServerDashboardProcessItem {
    const pid = String(payload?.pid || '').trim();
    return {
      id: `process-${pid || 'unknown'}`,
      pid,
      user: String(payload?.user || '—'),
      cpu: String(payload?.cpu || '—'),
      memory: String(payload?.memory || '—'),
      command: String(payload?.command || '—'),
      args: String(payload?.args || payload?.command || '—'),
      adapter: String(payload?.adapter || 'ps'),
      canKill: /^\d+$/.test(pid) && pid !== '1' && !this.isServerKernelThreadProcess(payload?.command, payload?.args)
    };
  }

  private postServerProcessActionState(connectionId: string, pid: string, status: 'killing' | 'still-running' | 'terminated' | 'clear', process: ServerDashboardProcessItem): void {
    this.postMessage(RemoteEditOutboundMessageType.ServerProcessActionState, {
      connectionId,
      pid,
      status,
      process
    });
  }

  private async finishServerProcessTerminated(connectionId: string, pid: string, process: ServerDashboardProcessItem): Promise<void> {
    this.postServerProcessActionState(connectionId, pid, 'terminated', process);
    await new Promise(resolve => setTimeout(resolve, 2000));
    this.postServerProcessActionState(connectionId, pid, 'clear', process);
    await this.requestServerDashboard({ connectionId, requestId: '' });
  }

  private buildServerProcessKillCommand(pid: string, force: boolean): string {
    const signal = force ? '-9 ' : '';
    return [
      `__remote_edit_pid=${pid}`,
      'remote_edit_process_exists() {',
      '  ps -p "$1" -o pid= >/dev/null 2>&1 && return 0',
      '  ps -ef 2>/dev/null | awk -v p="$1" \'NR > 1 && $2 == p { found = 1 } END { exit(found ? 0 : 1) }\'',
      '}',
      'if remote_edit_process_exists "$__remote_edit_pid"; then',
      '  printf "REMOTE_EDIT_PROCESS_EXISTS_BEFORE=yes\\n"',
      'else',
      '  printf "REMOTE_EDIT_PROCESS_EXISTS_BEFORE=no\\n"',
      'fi',
      `kill ${signal}"$__remote_edit_pid"`,
      '__remote_edit_kill_rc=$?',
      'sleep 1',
      'printf "REMOTE_EDIT_KILL_RC=%s\\n" "$__remote_edit_kill_rc"',
      'if remote_edit_process_exists "$__remote_edit_pid"; then',
      '  printf "REMOTE_EDIT_PROCESS_EXISTS_AFTER=yes\\n"',
      '  printf "REMOTE_EDIT_PROCESS_STILL_RUNNING=yes\\n"',
      'else',
      '  printf "REMOTE_EDIT_PROCESS_EXISTS_AFTER=no\\n"',
      '  printf "REMOTE_EDIT_PROCESS_STILL_RUNNING=no\\n"',
      'fi',
      'exit 0'
    ].join('\n');
  }

  private parseServerProcessKillOutput(stdout: string, stderr: string): { killRc: number; stillRunning: boolean; existsBefore: boolean; existsAfter: boolean } {
    const text = `${stdout || ''}\n${stderr || ''}`;
    const rcMatch = /REMOTE_EDIT_KILL_RC=(\d+)/.exec(text);
    const runningMatch = /REMOTE_EDIT_PROCESS_STILL_RUNNING=(yes|no)/.exec(text);
    const beforeMatch = /REMOTE_EDIT_PROCESS_EXISTS_BEFORE=(yes|no)/.exec(text);
    const afterMatch = /REMOTE_EDIT_PROCESS_EXISTS_AFTER=(yes|no)/.exec(text);
    return {
      killRc: rcMatch ? Number(rcMatch[1]) : 1,
      stillRunning: runningMatch ? runningMatch[1] === 'yes' : false,
      existsBefore: beforeMatch ? beforeMatch[1] === 'yes' : true,
      existsAfter: afterMatch ? afterMatch[1] === 'yes' : runningMatch ? runningMatch[1] === 'yes' : false
    };
  }

  private async runServerManagementCommand(connectionId: string, command: string): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = '';
    let stderr = '';
    const result = await this.sessions.runRemoteCommandStreaming(
      connectionId,
      '/',
      command,
      {
        onStdout: chunk => { stdout += chunk || ''; },
        onStderr: chunk => { stderr += chunk || ''; }
      }
    );

    return {
      code: typeof result.code === 'number' ? result.code : 0,
      stdout,
      stderr
    };
  }

  private buildServerServiceDetailsCommand(adapter: string, serviceName: string): string {
    const normalizedAdapter = String(adapter || '').trim().toLowerCase();
    const quotedName = shellQuote(serviceName);

    if (normalizedAdapter === 'linux-systemd') {
      return `systemctl status --no-pager --full ${quotedName} 2>&1 || true`;
    }

    if (normalizedAdapter === 'aix-src') {
      return `lssrc -s ${quotedName} 2>&1 || true`;
    }

    if (normalizedAdapter === 'linux-sysv') {
      return `if command -v service >/dev/null 2>&1; then service ${quotedName} status; elif [ -x /etc/init.d/${quotedName} ]; then /etc/init.d/${quotedName} status; else echo 'Service command not found.'; exit 127; fi 2>&1 || true`;
    }

    return '';
  }

  private buildServerServiceActionCommand(adapter: string, serviceName: string, action: 'start' | 'stop' | 'restart'): string {
    const normalizedAdapter = String(adapter || '').trim().toLowerCase();
    const quotedName = shellQuote(serviceName);

    if (normalizedAdapter === 'linux-systemd') {
      return `systemctl ${action} ${quotedName}`;
    }

    if (normalizedAdapter === 'linux-sysv') {
      return `if command -v service >/dev/null 2>&1; then service ${quotedName} ${action}; elif [ -x /etc/init.d/${quotedName} ]; then /etc/init.d/${quotedName} ${action}; else echo 'Service command not found.'; exit 127; fi`;
    }

    if (normalizedAdapter === 'aix-src') {
      if (action === 'start') {
        return `startsrc -s ${quotedName}`;
      }
      if (action === 'stop') {
        return `stopsrc -s ${quotedName}`;
      }
      return [
        `stopsrc -s ${quotedName}`,
        '__remote_edit_stop_status=$?',
        'sleep 1',
        `startsrc -s ${quotedName}`,
        '__remote_edit_start_status=$?',
        'if [ "$__remote_edit_stop_status" -ne 0 ] || [ "$__remote_edit_start_status" -ne 0 ]; then exit 1; fi',
        'exit 0'
      ].join('\n');
    }

    return '';
  }

  private formatServerServiceActionLabel(action: string): string {
    switch (action) {
      case 'start': return 'Start';
      case 'stop': return 'Stop';
      case 'restart': return 'Restart';
      default: return 'Run';
    }
  }

  private normalizeServerCommandOutput(stdout: string, stderr: string, code: number): string {
    const output = [String(stdout || '').trim(), String(stderr || '').trim()].filter(Boolean).join('\n\n').trim();
    const exitLine = code === 0 ? '' : `Exit code: ${code}`;
    return [output, exitLine].filter(Boolean).join('\n\n').trim();
  }

  private async requestServerDashboard(payload: any): Promise<void> {
    const requestedConnectionId = String(payload?.connectionId || '').trim();
    const connectionId = requestedConnectionId || this.state.getActiveConnectionId() || '';
    const requestId = String(payload?.requestId || '').trim();

    if (!connectionId) {
      this.postMessage(RemoteEditOutboundMessageType.ServerDashboard, {
        connectionId,
        requestId,
        refreshedAt: Date.now(),
        overview: this.createUnavailableServerOverview('No connection'),
        systemInfo: [],
        services: [],
        serviceAdapter: 'unknown',
        processes: [],
        processAdapter: 'unknown',
        scheduledJobs: [],
        scheduledJobsAdapter: 'unknown',
        capabilities: [],
        error: 'No active connection.'
      });
      return;
    }

    const connection = this.sessions.getConnection(connectionId);
    if (!connection) {
      this.postMessage(RemoteEditOutboundMessageType.ServerDashboard, {
        connectionId,
        requestId,
        refreshedAt: Date.now(),
        overview: this.createUnavailableServerOverview('Disconnected'),
        systemInfo: [],
        services: [],
        serviceAdapter: 'unknown',
        processes: [],
        processAdapter: 'unknown',
        capabilities: [],
        error: 'Connection is no longer active.'
      });
      return;
    }

    if (String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      this.postMessage(RemoteEditOutboundMessageType.ServerDashboard, {
        connectionId,
        requestId,
        refreshedAt: Date.now(),
        overview: this.createUnavailableServerOverview('Unsupported'),
        systemInfo: [],
        services: [],
        serviceAdapter: 'unknown',
        processes: [],
        processAdapter: 'unknown',
        capabilities: [],
        error: 'Server dashboard requires SSH/SFTP.'
      });
      return;
    }

    let output = '';
    try {
      await this.sessions.runRemoteCommandStreaming(
        connectionId,
        '/',
        this.buildServerDashboardSnapshotCommand(),
        {
          onStdout: chunk => { output += chunk || ''; },
          onStderr: () => undefined
        }
      );

      const fields = this.parseServerDashboardSnapshotOutput(output);
      this.postMessage(RemoteEditOutboundMessageType.ServerDashboard, this.buildServerDashboardSnapshot(connectionId, requestId, connection, fields));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage(RemoteEditOutboundMessageType.ServerDashboard, {
        connectionId,
        requestId,
        refreshedAt: Date.now(),
        overview: this.createUnavailableServerOverview('Unavailable'),
        systemInfo: this.buildFallbackServerSystemInfo(connection, [], Date.now()),
        services: [],
        serviceAdapter: 'unknown',
        processes: [],
        processAdapter: 'unknown',
        capabilities: [],
        error: message || 'Could not refresh the server dashboard.'
      });
      this.logWarn('Could not refresh server dashboard.', { Connection: connectionId, Details: message });
    }
  }

  private buildServerDashboardSnapshotCommand(): string {
    return String.raw`remote_edit_print() {
  remote_edit_key="$1"
  shift
  remote_edit_value="$*"
  remote_edit_value=$(printf '%s' "$remote_edit_value" | tr '\r\n' '  ')
  printf '%s=%s\n' "$remote_edit_key" "$remote_edit_value"
}
remote_edit_cmd_exists() { command -v "$1" >/dev/null 2>&1; }
remote_edit_os=$(uname -s 2>/dev/null || printf 'unknown')
remote_edit_kernel=$(uname -r 2>/dev/null || printf '')
remote_edit_arch=$(uname -m 2>/dev/null || printf '')
if [ "$remote_edit_os" = "AIX" ]; then
  remote_edit_aix_arch=$(uname -p 2>/dev/null || printf '')
  if [ -z "$remote_edit_aix_arch" ] && remote_edit_cmd_exists bootinfo; then
    remote_edit_aix_arch=$(bootinfo -p 2>/dev/null || printf '')
  fi
  if [ -n "$remote_edit_aix_arch" ]; then
    remote_edit_arch="$remote_edit_aix_arch"
  fi
fi
remote_edit_host=$(hostname 2>/dev/null || uname -n 2>/dev/null || printf '')
remote_edit_user=$(whoami 2>/dev/null || id -un 2>/dev/null || printf '')
remote_edit_id=$(id 2>/dev/null || printf '')
remote_edit_home=$HOME
remote_edit_shell=$SHELL
remote_edit_server_time=$(date '+%Y-%m-%d %H:%M %z' 2>/dev/null || printf '')
if [ -z "$remote_edit_server_time" ]; then
  remote_edit_server_time=$(date '+%Y-%m-%d %H:%M' 2>/dev/null || printf '')
fi
if [ -z "$remote_edit_server_time" ]; then
  remote_edit_server_time=$(date 2>/dev/null || printf '')
fi
remote_edit_os_version=''
if [ "$remote_edit_os" = "Linux" ] && [ -r /etc/os-release ]; then
  remote_edit_os_version=$(awk -F= '/^PRETTY_NAME=/{ value=$2; gsub(/^"|"$/, "", value); print value; exit }' /etc/os-release 2>/dev/null)
fi
if [ -z "$remote_edit_os_version" ] && [ "$remote_edit_os" = "AIX" ] && remote_edit_cmd_exists oslevel; then
  remote_edit_os_version=$(oslevel -s 2>/dev/null || oslevel 2>/dev/null || printf '')
fi
if [ -z "$remote_edit_os_version" ]; then
  remote_edit_os_version=$(uname -sr 2>/dev/null || printf '')
fi
remote_edit_uptime=$(uptime 2>/dev/null || printf '')
remote_edit_uptime_seconds=''
if [ -r /proc/uptime ]; then
  remote_edit_uptime_seconds=$(awk '{ print int($1) }' /proc/uptime 2>/dev/null)
fi
remote_edit_disk_root=$(df -P / 2>/dev/null | awk 'NR==2 { print $2 "|" $3 "|" $4 "|" $5 }')
remote_edit_memory=''
if remote_edit_cmd_exists free; then
  remote_edit_memory=$(free -m 2>/dev/null | awk '/^Mem:/ { print $2 "|" $3 "|" $4 "|free"; exit }')
elif remote_edit_cmd_exists svmon && remote_edit_cmd_exists pagesize; then
  remote_edit_pagesize=$(pagesize 2>/dev/null || printf '0')
  remote_edit_memory=$(svmon -G 2>/dev/null | awk -v p="$remote_edit_pagesize" '/^memory/ && p > 0 { printf "%d|%d|%d|svmon", ($2*p)/1048576, ($3*p)/1048576, ($4*p)/1048576; exit }')
fi
remote_edit_has_systemd='no'
if [ -d /run/systemd/system ] || remote_edit_cmd_exists systemctl; then
  remote_edit_has_systemd='yes'
fi
remote_edit_capabilities=''
for remote_edit_capability in systemctl journalctl crontab ps lssrc service svmon free df uptime; do
  if remote_edit_cmd_exists "$remote_edit_capability"; then
    if [ -n "$remote_edit_capabilities" ]; then
      remote_edit_capabilities="$remote_edit_capabilities,$remote_edit_capability"
    else
      remote_edit_capabilities="$remote_edit_capability"
    fi
  fi
done
remote_edit_service_index=0
remote_edit_print_service() {
  remote_edit_print "SERVICE_$remote_edit_service_index" "$*"
  remote_edit_service_index=$((remote_edit_service_index + 1))
}
remote_edit_process_index=0
remote_edit_print_process() {
  remote_edit_print "PROCESS_$remote_edit_process_index" "$*"
  remote_edit_process_index=$((remote_edit_process_index + 1))
}
remote_edit_scheduled_index=0
remote_edit_print_scheduled() {
  remote_edit_print "SCHEDULED_$remote_edit_scheduled_index" "$*"
  remote_edit_scheduled_index=$((remote_edit_scheduled_index + 1))
}
remote_edit_count_user_cron_jobs() {
  awk '
    /^[[:space:]]*$/ { next }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/ { next }
    $1 ~ /^@[A-Za-z0-9_-]+$/ && NF >= 2 { count++; next }
    NF >= 6 { count++ }
    END { print count + 0 }
  '
}
remote_edit_count_system_cron_jobs() {
  awk '
    /^[[:space:]]*$/ { next }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/ { next }
    $1 ~ /^@[A-Za-z0-9_-]+$/ && NF >= 3 { count++; next }
    NF >= 7 { count++ }
    END { print count + 0 }
  '
}
remote_edit_collect_scheduled_jobs() {
  remote_edit_print_user_crontab() {
    remote_edit_cron_user="$1"
    remote_edit_cron_output="$2"
    [ -n "$remote_edit_cron_user" ] || return
    [ -n "$remote_edit_cron_output" ] || return
    remote_edit_count=$(printf '%s
' "$remote_edit_cron_output" | remote_edit_count_user_cron_jobs)
    if [ "$remote_edit_count" = "0" ]; then
      remote_edit_label="0 jobs"
    else
      remote_edit_label="$remote_edit_count jobs"
      [ "$remote_edit_count" = "1" ] && remote_edit_label="1 job"
    fi
    remote_edit_print_scheduled "user|$remote_edit_cron_user|$remote_edit_label|user crontab|$remote_edit_cron_user||$remote_edit_cron_user|yes|no|$remote_edit_cron_user crontab"
  }

  remote_edit_read_user_crontab() {
    remote_edit_cron_user="$1"
    [ -n "$remote_edit_cron_user" ] || return
    if [ "$remote_edit_cron_user" = "$remote_edit_user" ]; then
      crontab -l 2>/dev/null || true
      return
    fi
    if [ "$remote_edit_os" = "AIX" ]; then
      crontab -l "$remote_edit_cron_user" 2>/dev/null || true
    else
      crontab -u "$remote_edit_cron_user" -l 2>/dev/null || true
    fi
  }

  remote_edit_is_real_user() {
    remote_edit_check_user="$1"
    [ -n "$remote_edit_check_user" ] || return 1
    case "$remote_edit_check_user" in .*|*/*|*:*|*' '*|*_*) return 1 ;; esac
    if [ "$remote_edit_os" = "AIX" ] && remote_edit_cmd_exists lsuser; then
      lsuser "$remote_edit_check_user" >/dev/null 2>&1 && return 0
    fi
    if remote_edit_cmd_exists getent; then
      getent passwd "$remote_edit_check_user" >/dev/null 2>&1 && return 0
    fi
    if [ -r /etc/passwd ]; then
      awk -F: -v u="$remote_edit_check_user" '$1 == u { found = 1 } END { exit(found ? 0 : 1) }' /etc/passwd 2>/dev/null && return 0
    fi
    [ "$remote_edit_check_user" = "$remote_edit_user" ] && return 0
    return 1
  }

  remote_edit_find_user_spool_file() {
    remote_edit_spool_user="$1"
    [ -n "$remote_edit_spool_user" ] || return
    for remote_edit_spool_dir in /var/spool/cron /var/spool/cron/crontabs /var/cron/tabs /usr/spool/cron/crontabs; do
      remote_edit_spool_file="$remote_edit_spool_dir/$remote_edit_spool_user"
      [ -f "$remote_edit_spool_file" ] || continue
      printf '%s
' "$remote_edit_spool_file"
      return
    done
  }

  remote_edit_read_user_crontab_with_fallback() {
    remote_edit_fallback_user="$1"
    remote_edit_fallback_file="$2"
    remote_edit_output=$(remote_edit_read_user_crontab "$remote_edit_fallback_user")
    if [ -n "$remote_edit_output" ]; then
      printf '%s
' "$remote_edit_output"
      return
    fi
    if [ -z "$remote_edit_fallback_file" ]; then
      remote_edit_fallback_file=$(remote_edit_find_user_spool_file "$remote_edit_fallback_user")
    fi
    if [ -n "$remote_edit_fallback_file" ] && [ -r "$remote_edit_fallback_file" ]; then
      cat "$remote_edit_fallback_file" 2>/dev/null || true
    fi
  }

  if remote_edit_cmd_exists crontab; then
    remote_edit_current_file=$(remote_edit_find_user_spool_file "$remote_edit_user")
    remote_edit_current_cron=$(remote_edit_read_user_crontab_with_fallback "$remote_edit_user" "$remote_edit_current_file")
    remote_edit_print_user_crontab "$remote_edit_user" "$remote_edit_current_cron"

    remote_edit_seen_cron_users=" $remote_edit_user "
    remote_edit_user_scan_count=0
    for remote_edit_spool_dir in /var/spool/cron /var/spool/cron/crontabs /var/cron/tabs /usr/spool/cron/crontabs; do
      [ -d "$remote_edit_spool_dir" ] || continue
      [ -r "$remote_edit_spool_dir" ] || continue
      for remote_edit_cron_user_file in "$remote_edit_spool_dir"/*; do
        [ -f "$remote_edit_cron_user_file" ] || continue
        remote_edit_cron_user=$(basename "$remote_edit_cron_user_file" 2>/dev/null || printf '')
        [ -n "$remote_edit_cron_user" ] || continue
        case "$remote_edit_cron_user" in .*|*.tmp|*.bak|*.old|*~|*_*) continue ;; esac
        case "$remote_edit_seen_cron_users" in *" $remote_edit_cron_user "*) continue ;; esac
        remote_edit_is_real_user "$remote_edit_cron_user" || continue
        remote_edit_seen_cron_users="$remote_edit_seen_cron_users$remote_edit_cron_user "
        remote_edit_user_scan_count=$((remote_edit_user_scan_count + 1))
        [ "$remote_edit_user_scan_count" -gt 50 ] && break
        remote_edit_user_cron=$(remote_edit_read_user_crontab_with_fallback "$remote_edit_cron_user" "$remote_edit_cron_user_file")
        remote_edit_print_user_crontab "$remote_edit_cron_user" "$remote_edit_user_cron"
      done
    done
  fi

  if [ -r /etc/crontab ]; then
    remote_edit_count=$(remote_edit_count_system_cron_jobs < /etc/crontab 2>/dev/null || printf '0')
    remote_edit_label="$remote_edit_count jobs"
    [ "$remote_edit_count" = "1" ] && remote_edit_label="1 job"
    remote_edit_print_scheduled "file|/etc/crontab|$remote_edit_label|system crontab|/etc/crontab|/etc/crontab||yes|yes|/etc/crontab"
  elif [ -e /etc/crontab ]; then
    remote_edit_print_scheduled "file|/etc/crontab|Permission denied|system crontab|/etc/crontab|/etc/crontab||no|no|/etc/crontab"
  fi

  if [ -d /etc/cron.d ]; then
    if [ -r /etc/cron.d ]; then
      for remote_edit_cron_file in /etc/cron.d/*; do
        [ -f "$remote_edit_cron_file" ] || continue
        remote_edit_base=$(basename "$remote_edit_cron_file" 2>/dev/null || printf '')
        [ -n "$remote_edit_base" ] || continue
        case "$remote_edit_base" in .*|*.dpkg-*|*.rpm*|*~) continue ;; esac
        if [ -r "$remote_edit_cron_file" ]; then
          remote_edit_count=$(remote_edit_count_system_cron_jobs < "$remote_edit_cron_file" 2>/dev/null || printf '0')
          remote_edit_label="$remote_edit_count jobs"
          [ "$remote_edit_count" = "1" ] && remote_edit_label="1 job"
          remote_edit_print_scheduled "cron-d|$remote_edit_cron_file|$remote_edit_label|cron.d|$remote_edit_cron_file|$remote_edit_cron_file||yes|yes|$remote_edit_cron_file"
        else
          remote_edit_print_scheduled "cron-d|$remote_edit_cron_file|Permission denied|cron.d|$remote_edit_cron_file|$remote_edit_cron_file||no|no|$remote_edit_cron_file"
        fi
      done
    else
      remote_edit_print_scheduled "cron-d|/etc/cron.d|Permission denied|cron.d|/etc/cron.d|/etc/cron.d||no|no|/etc/cron.d"
    fi
  fi

  for remote_edit_periodic in hourly daily weekly monthly; do
    remote_edit_dir="/etc/cron.$remote_edit_periodic"
    [ -d "$remote_edit_dir" ] || continue
    if [ ! -r "$remote_edit_dir" ]; then
      remote_edit_print_scheduled "periodic|$remote_edit_dir|Permission denied|$remote_edit_periodic|$remote_edit_dir|$remote_edit_dir||no|no|$remote_edit_dir"
      continue
    fi
    for remote_edit_script in "$remote_edit_dir"/*; do
      [ -f "$remote_edit_script" ] || continue
      remote_edit_base=$(basename "$remote_edit_script" 2>/dev/null || printf '')
      [ -n "$remote_edit_base" ] || continue
      case "$remote_edit_base" in .*|*.dpkg-*|*.rpm*|*~) continue ;; esac
      if [ -r "$remote_edit_script" ]; then
        remote_edit_print_scheduled "periodic|$remote_edit_script|script|$remote_edit_periodic|$remote_edit_script|$remote_edit_script||yes|yes|$remote_edit_script"
      else
        remote_edit_print_scheduled "periodic|$remote_edit_script|Permission denied|$remote_edit_periodic|$remote_edit_script|$remote_edit_script||no|no|$remote_edit_script"
      fi
    done
  done
}
remote_edit_collect_processes() {
  if ! remote_edit_cmd_exists ps; then
    return
  fi
  remote_edit_process_adapter=ps
  remote_edit_process_output=$(ps -eo pid,user,pcpu,pmem,comm,args 2>/dev/null | awk '
    NR > 1 && $1 ~ /^[0-9]+$/ {
      pid=$1; user=$2; cpu=$3; mem=$4; comm=$5; args="";
      for (i=6; i<=NF; i++) { args = args (args ? " " : "") $i; }
      if (args == "") args=comm;
      gsub(/\|/, "/", user); gsub(/\|/, "/", cpu); gsub(/\|/, "/", mem); gsub(/\|/, "/", comm); gsub(/\|/, "/", args);
      print pid "|" user "|" cpu "|" mem "|" comm "|" args;
    }
  ')
  if [ -z "$remote_edit_process_output" ]; then
    remote_edit_process_output=$(ps -eo pid,user,pcpu,pmem,args 2>/dev/null | awk '
      NR > 1 && $1 ~ /^[0-9]+$/ {
        pid=$1; user=$2; cpu=$3; mem=$4; args="";
        for (i=5; i<=NF; i++) { args = args (args ? " " : "") $i; }
        comm=args; sub(/[[:space:]].*$/, "", comm);
        gsub(/\|/, "/", user); gsub(/\|/, "/", cpu); gsub(/\|/, "/", mem); gsub(/\|/, "/", comm); gsub(/\|/, "/", args);
        print pid "|" user "|" cpu "|" mem "|" comm "|" args;
      }
    ')
  fi
  if [ -z "$remote_edit_process_output" ]; then
    remote_edit_process_output=$(ps -ef 2>/dev/null | awk '
      NR > 1 && $2 ~ /^[0-9]+$/ {
        user=$1; pid=$2; args="";
        for (i=8; i<=NF; i++) { args = args (args ? " " : "") $i; }
        comm=args; sub(/[[:space:]].*$/, "", comm);
        gsub(/\|/, "/", user); gsub(/\|/, "/", comm); gsub(/\|/, "/", args);
        print pid "|" user "|||" comm "|" args;
      }
    ')
  fi
  printf '%s
' "$remote_edit_process_output" | while IFS='|' read -r remote_edit_process_pid remote_edit_process_user remote_edit_process_cpu remote_edit_process_memory remote_edit_process_command remote_edit_process_args; do
    [ -n "$remote_edit_process_pid" ] || continue
    remote_edit_print_process "$remote_edit_process_adapter|$remote_edit_process_pid|$remote_edit_process_user|$remote_edit_process_cpu|$remote_edit_process_memory|$remote_edit_process_command|$remote_edit_process_args"
  done
}
remote_edit_collect_processes
remote_edit_collect_scheduled_jobs
if [ "$remote_edit_os" = "Linux" ]; then
  remote_edit_systemd_units=''
  if [ "$remote_edit_has_systemd" = "yes" ] && remote_edit_cmd_exists systemctl; then
    remote_edit_systemd_units=$(systemctl list-units --type=service --all --no-legend --no-pager --full 2>/dev/null || systemctl --type=service --all --no-legend --no-pager --full list-units 2>/dev/null || printf '')
    if [ -z "$remote_edit_systemd_units" ]; then
      remote_edit_systemd_units=$(systemctl list-units --type service --all --no-legend --no-pager --full 2>/dev/null || printf '')
    fi
    if [ -z "$remote_edit_systemd_units" ]; then
      remote_edit_systemd_units=$(systemctl list-unit-files --type=service --no-legend --no-pager --full 2>/dev/null | awk 'NF >= 1 && $1 ~ /\.service$/ { print $1 " loaded unknown unknown " $2 }')
    fi
  fi

  if [ -n "$remote_edit_systemd_units" ]; then
    printf '%s
' "$remote_edit_systemd_units" | awk '
      NF >= 1 {
        if ($1 !~ /\.service$/ && $2 ~ /\.service$/) { unit=$2; active=$4; unit_sub_state=$5; start=6; }
        else { unit=$1; active=$3; unit_sub_state=$4; start=5; }
        if (unit !~ /\.service$/) next;
        if (active == "") active="unknown";
        if (unit_sub_state == "") unit_sub_state="unknown";
        desc="";
        for (i=start; i<=NF; i++) { desc = desc (desc ? " " : "") $i; }
        gsub(/\|/, "/", unit); gsub(/\|/, "/", active); gsub(/\|/, "/", unit_sub_state); gsub(/\|/, "/", desc);
        print unit "|" active " " unit_sub_state "|" desc;
      }
    ' | while IFS='|' read -r remote_edit_service_name remote_edit_service_status remote_edit_service_description; do
      [ -n "$remote_edit_service_name" ] || continue
      remote_edit_print_service "linux-systemd|$remote_edit_service_name|$remote_edit_service_status|$remote_edit_service_description"
    done
  elif remote_edit_cmd_exists service; then
    service --status-all 2>&1 | awk '
      /^ *\[/ {
        marker=$2; name=$4;
        if (name == "") name=$NF;
        status="unknown";
        if (marker == "+") status="running";
        else if (marker == "-") status="stopped";
        if (name != "" && name != "]") print name "|" status "|service --status-all";
        next;
      }
    ' | while IFS='|' read -r remote_edit_service_name remote_edit_service_status remote_edit_service_description; do
      [ -n "$remote_edit_service_name" ] || continue
      remote_edit_print_service "linux-sysv|$remote_edit_service_name|$remote_edit_service_status|$remote_edit_service_description"
    done
  elif [ -d /etc/init.d ]; then
    for remote_edit_init_script in /etc/init.d/*; do
      [ -f "$remote_edit_init_script" ] || continue
      [ -x "$remote_edit_init_script" ] || continue
      remote_edit_service_name=$(basename "$remote_edit_init_script" 2>/dev/null || printf '')
      [ -n "$remote_edit_service_name" ] || continue
      remote_edit_print_service "linux-sysv|$remote_edit_service_name|unknown|$remote_edit_init_script"
    done
  fi
elif [ "$remote_edit_os" = "AIX" ] && remote_edit_cmd_exists lssrc; then
  lssrc -a 2>/dev/null | awk '
    NR > 1 && $1 != "" {
      subsystem=$1; group=$2; pid=""; status="";
      if ($3 ~ /^[0-9]+$/) { pid=$3; status=$4; } else { status=$3; }
      if (status == "") status="unknown";
      desc=group;
      if (pid != "") desc = desc " pid " pid;
      gsub(/\|/, "/", subsystem); gsub(/\|/, "/", status); gsub(/\|/, "/", desc);
      print subsystem "|" status "|" desc;
    }
  ' | while IFS='|' read -r remote_edit_service_name remote_edit_service_status remote_edit_service_description; do
    [ -n "$remote_edit_service_name" ] || continue
    remote_edit_print_service "aix-src|$remote_edit_service_name|$remote_edit_service_status|$remote_edit_service_description"
  done
fi
remote_edit_print OS "$remote_edit_os"
remote_edit_print OS_VERSION "$remote_edit_os_version"
remote_edit_print KERNEL "$remote_edit_kernel"
remote_edit_print ARCH "$remote_edit_arch"
remote_edit_print HOSTNAME "$remote_edit_host"
remote_edit_print USER "$remote_edit_user"
remote_edit_print ID "$remote_edit_id"
remote_edit_print HOME "$remote_edit_home"
remote_edit_print SHELL "$remote_edit_shell"
remote_edit_print SERVER_TIME "$remote_edit_server_time"
remote_edit_print UPTIME "$remote_edit_uptime"
remote_edit_print UPTIME_SECONDS "$remote_edit_uptime_seconds"
remote_edit_print DISK_ROOT "$remote_edit_disk_root"
remote_edit_print MEMORY "$remote_edit_memory"
remote_edit_print HAS_SYSTEMD "$remote_edit_has_systemd"
remote_edit_print CAPABILITIES "$remote_edit_capabilities"
exit 0`;
  }

  private parseServerDashboardSnapshotOutput(output: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const rawLine of String(output || '').split(/\r?\n/)) {
      const index = rawLine.indexOf('=');
      if (index <= 0) {
        continue;
      }

      const key = rawLine.slice(0, index).trim();
      if (!/^[A-Z0-9_]+$/.test(key)) {
        continue;
      }

      result[key] = rawLine.slice(index + 1).trim();
    }

    return result;
  }

  private buildServerDashboardSnapshot(connectionId: string, requestId: string, connection: any, fields: Record<string, string>): ServerDashboardSnapshot {
    const refreshedAt = Date.now();
    const capabilities = this.parseServerCapabilities(fields.CAPABILITIES);
    const adapter = this.detectServerAdapter(fields, capabilities);
    const identity = this.parseServerIdentity(fields.ID, String(connection?.username || fields.USER || '').trim());
    const services = this.parseServerDashboardServices(fields, adapter);
    const processes = this.parseServerDashboardProcesses(fields);
    const scheduledJobs = this.parseServerDashboardScheduledJobs(fields);

    return {
      connectionId,
      requestId,
      refreshedAt,
      overview: [
        this.formatServerUptime(fields.UPTIME_SECONDS, fields.UPTIME),
        this.formatServerLoad(fields.UPTIME),
        this.formatServerMemory(fields.MEMORY),
        this.formatServerDisk(fields.DISK_ROOT)
      ],
      systemInfo: [
        { label: 'OS', value: this.normalizeServerInfoValue(fields.OS) },
        { label: 'OS Version', value: this.normalizeServerInfoValue(fields.OS_VERSION || fields.KERNEL) },
        { label: 'Adapter', value: adapter },
        { label: 'Hostname', value: this.normalizeServerInfoValue(fields.HOSTNAME || connection?.host) },
        { label: 'User', value: identity.user },
        { label: 'Group', value: identity.group },
        { label: 'Home', value: this.normalizeServerInfoValue(fields.HOME) },
        { label: 'Shell', value: this.normalizeServerInfoValue(fields.SHELL) },
        { label: 'Architecture', value: this.normalizeServerInfoValue(fields.ARCH) },
        { label: 'Protocol', value: 'SSH/SFTP' },
        { label: 'Sudo', value: this.formatServerSudoStatus(connection) },
        { label: 'Capabilities', value: this.formatServerCapabilities(capabilities) },
        { label: 'Server Time', value: this.formatServerTime(fields.SERVER_TIME) },
        { label: 'Last refresh', value: this.formatServerRefreshTime(refreshedAt) }
      ],
      services,
      serviceAdapter: services[0]?.adapter || adapter,
      processes,
      processAdapter: processes[0]?.adapter || (capabilities.includes('ps') ? 'ps' : 'unknown'),
      scheduledJobs,
      scheduledJobsAdapter: scheduledJobs.length ? 'cron' : (capabilities.includes('crontab') ? 'cron' : 'unknown'),
      capabilities
    };
  }

  private buildFallbackServerSystemInfo(connection: any, capabilities: string[], refreshedAt: number): ServerDashboardSystemInfoItem[] {
    const identity = this.parseServerIdentity('', String(connection?.username || '').trim());
    return [
      { label: 'OS', value: '—' },
      { label: 'OS Version', value: '—' },
      { label: 'Adapter', value: 'unknown' },
      { label: 'Hostname', value: this.normalizeServerInfoValue(connection?.host) },
      { label: 'User', value: identity.user },
      { label: 'Group', value: identity.group },
      { label: 'Protocol', value: 'SSH/SFTP' },
      { label: 'Sudo', value: this.formatServerSudoStatus(connection) },
      { label: 'Capabilities', value: this.formatServerCapabilities(capabilities) },
      { label: 'Server Time', value: '—' },
      { label: 'Last refresh', value: this.formatServerRefreshTime(refreshedAt) }
    ];
  }

  private createUnavailableServerOverview(reason: string): ServerDashboardOverviewItem[] {
    return ['Uptime', 'Load', 'Memory', 'Disk'].map(label => ({ label, value: '—', help: reason }));
  }

  private normalizeServerInfoValue(value: unknown): string {
    const text = String(value ?? '').trim();
    return text || '—';
  }

  private parseServerCapabilities(value: string | undefined): string[] {
    return String(value || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  private parseServerDashboardServices(fields: Record<string, string>, adapter: string): ServerDashboardServiceItem[] {
    const services: ServerDashboardServiceItem[] = [];

    Object.keys(fields)
      .filter(key => /^SERVICE_\d+$/i.test(key))
      .sort((left, right) => Number(left.replace(/\D/g, '')) - Number(right.replace(/\D/g, '')))
      .forEach((key, index) => {
        const parts = String(fields[key] || '').split('|');
        const serviceAdapter = String(parts[0] || adapter || '').trim() || adapter || 'unknown';
        const name = String(parts[1] || '').trim();
        const rawStatus = String(parts[2] || '').trim();
        const description = String(parts.slice(3).join('|') || '').trim();

        if (!name) {
          return;
        }

        const status = this.normalizeServerServiceStatus(serviceAdapter, rawStatus);
        services.push({
          id: this.createServerServiceId(serviceAdapter, name, index),
          name,
          displayName: name,
          status,
          statusLabel: this.formatServerServiceStatusLabel(status),
          rawStatus: rawStatus || 'unknown',
          description,
          adapter: serviceAdapter,
          canStart: status === 'stopped' || status === 'failed',
          canStop: status === 'running',
          canRestart: status === 'running' || status === 'failed'
        });
      });

    return services.sort((left, right) => {
      const statusOrder = (status: ServerDashboardServiceItem['status']) => {
        switch (status) {
          case 'failed': return 0;
          case 'running': return 1;
          case 'stopped': return 2;
          default: return 3;
        }
      };
      const statusDelta = statusOrder(left.status) - statusOrder(right.status);
      if (statusDelta !== 0) {
        return statusDelta;
      }
      return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
    });
  }

  private parseServerDashboardScheduledJobs(fields: Record<string, string>): ServerDashboardScheduledJobItem[] {
    const items: ServerDashboardScheduledJobItem[] = [];
    const seen = new Set<string>();

    Object.keys(fields)
      .filter(key => /^SCHEDULED_\d+$/i.test(key))
      .sort((left, right) => Number(left.replace(/\D/g, '')) - Number(right.replace(/\D/g, '')))
      .forEach((key, index) => {
        const parts = String(fields[key] || '').split('|');
        const sourceType = String(parts[0] || '').trim() || 'unknown';
        const name = String(parts[1] || '').trim();
        const countLabel = String(parts[2] || '').trim() || '—';
        const typeLabel = String(parts[3] || '').trim() || sourceType;
        const source = String(parts[4] || name || '').trim();
        const path = String(parts[5] || '').trim();
        const user = String(parts[6] || '').trim();
        const canOpen = String(parts[7] || '').trim().toLowerCase() === 'yes';
        const canEdit = String(parts[8] || '').trim().toLowerCase() === 'yes';
        const copyValue = String(parts.slice(9).join('|') || path || source || name).trim();

        if (!name && !source) {
          return;
        }

        const identity = `${sourceType}|${path}|${user}|${name}`;
        if (seen.has(identity)) {
          return;
        }
        seen.add(identity);

        items.push({
          id: this.createServerScheduledJobId(sourceType, path || source || name, user, index),
          name: name || source || user || 'Scheduled item',
          countLabel,
          typeLabel,
          source: source || path || name,
          sourceType,
          user,
          path,
          canOpen,
          canEdit,
          copyValue: copyValue || source || path || name
        });
      });

    return items.sort((left, right) => {
      const order = (item: ServerDashboardScheduledJobItem): number => {
        if (item.sourceType === 'user') return 0;
        if (item.sourceType === 'file') return 1;
        if (item.sourceType === 'cron-d') return 2;
        if (item.sourceType === 'periodic') return 3;
        return 4;
      };
      const orderDiff = order(left) - order(right);
      if (orderDiff !== 0) return orderDiff;
      return left.name.localeCompare(right.name);
    });
  }

  private createServerScheduledJobId(sourceType: string, source: string, user: string, index: number): string {
    const raw = `${sourceType}-${user || ''}-${source || ''}-${index}`;
    return raw.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 140) || `scheduled-${index}`;
  }

  private parseServerDashboardProcesses(fields: Record<string, string>): ServerDashboardProcessItem[] {
    const processes: ServerDashboardProcessItem[] = [];

    Object.keys(fields)
      .filter(key => /^PROCESS_\d+$/i.test(key))
      .sort((left, right) => Number(left.replace(/\D/g, '')) - Number(right.replace(/\D/g, '')))
      .forEach((key, index) => {
        const parts = String(fields[key] || '').split('|');
        const adapter = String(parts[0] || 'ps').trim() || 'ps';
        const pid = String(parts[1] || '').trim();
        const user = String(parts[2] || '').trim() || '—';
        const cpu = this.formatServerProcessMetric(parts[3]);
        const memory = this.formatServerProcessMetric(parts[4]);
        const command = String(parts[5] || '').trim();
        const args = String(parts.slice(6).join('|') || command || '').trim();

        if (!/^\d+$/.test(pid)) {
          return;
        }

        processes.push({
          id: this.createServerProcessId(adapter, pid, index),
          pid,
          user,
          cpu,
          memory,
          command: command || args || '—',
          args: args || command || '—',
          adapter,
          canKill: pid !== '1' && !this.isServerKernelThreadProcess(command, args)
        });
      });

    return processes.sort((left, right) => Number(left.pid) - Number(right.pid));
  }

  private isServerKernelThreadProcess(command: unknown, args: unknown): boolean {
    const commandText = String(command ?? '').trim();
    const argsText = String(args ?? '').trim();
    const isBracketOnly = (value: string): boolean => /^\[[^\]]+\]$/.test(value);
    return isBracketOnly(commandText) || isBracketOnly(argsText);
  }

  private formatServerProcessMetric(value: unknown): string {
    const text = String(value ?? '').trim();
    if (!text) {
      return '—';
    }
    return text.endsWith('%') ? text : `${text}%`;
  }

  private createServerProcessId(adapter: string, pid: string, index: number): string {
    const safeAdapter = String(adapter || 'process').replace(/[^A-Za-z0-9._-]/g, '-');
    const safePid = String(pid || 'pid').replace(/[^0-9]/g, '') || 'pid';
    return `${safeAdapter}-${safePid}-${index}`;
  }

  private createServerServiceId(adapter: string, name: string, index: number): string {
    const safeAdapter = String(adapter || 'service').replace(/[^A-Za-z0-9._-]/g, '-');
    const safeName = String(name || 'item').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 96) || 'item';
    return `${safeAdapter}-${safeName}-${index}`;
  }

  private normalizeServerServiceStatus(adapter: string, rawStatus: string): ServerDashboardServiceItem['status'] {
    const text = String(rawStatus || '').trim().toLowerCase();
    const normalizedAdapter = String(adapter || '').trim().toLowerCase();

    if (normalizedAdapter === 'aix-src') {
      if (/\bactive\b/.test(text)) return 'running';
      if (/\binoperative\b/.test(text)) return 'stopped';
      return 'unknown';
    }

    if (/\bfailed\b|\berror\b/.test(text)) return 'failed';
    if (/\bactive\b|\brunning\b/.test(text)) return 'running';
    if (/\binactive\b|\bstopped\b|\bdead\b|\bexited\b/.test(text)) return 'stopped';
    return 'unknown';
  }

  private formatServerServiceStatusLabel(status: ServerDashboardServiceItem['status']): string {
    switch (status) {
      case 'running': return 'Running';
      case 'stopped': return 'Stopped';
      case 'failed': return 'Failed';
      default: return 'Unknown';
    }
  }

  private detectServerAdapter(fields: Record<string, string>, capabilities: string[]): string {
    const osName = String(fields.OS || '').trim().toLowerCase();
    const capabilitySet = new Set(capabilities.map(item => item.toLowerCase()));

    if (osName === 'linux') {
      if (fields.HAS_SYSTEMD === 'yes' || capabilitySet.has('systemctl')) {
        return 'linux-systemd';
      }
      if (capabilitySet.has('service')) {
        return 'linux-sysv';
      }
      return 'generic-unix';
    }

    if (osName === 'aix') {
      return capabilitySet.has('lssrc') ? 'aix-src' : 'generic-unix';
    }

    return osName ? 'generic-unix' : 'unknown';
  }

  private formatServerSudoStatus(connection: any): string {
    const username = String(connection?.username || '').trim();
    if (username.toLowerCase() === 'root') {
      return 'Root user';
    }
    return this.sessions.isSudoModeEnabled(String(connection?.id || '')) ? 'Enabled' : 'Disabled';
  }

  private parseServerIdentity(idOutput: string | undefined, fallbackUserName?: string): { user: string; group: string } {
    const text = String(idOutput || '').trim();
    const uidMatch = /uid=(\d+)(?:\(([^)]+)\))?/i.exec(text);
    const gidMatch = /gid=(\d+)(?:\(([^)]+)\))?/i.exec(text);

    const uid = uidMatch?.[1] || '';
    const uidName = uidMatch?.[2] || String(fallbackUserName || '').trim();
    const gid = gidMatch?.[1] || '';
    const gidName = gidMatch?.[2] || '';

    return {
      user: this.formatServerIdentityValue(uidName, uid),
      group: this.formatServerIdentityValue(gidName, gid)
    };
  }

  private formatServerIdentityValue(name: string | undefined, id: string | undefined): string {
    const normalizedName = String(name || '').trim();
    const normalizedId = String(id || '').trim();

    if (normalizedName && normalizedId) {
      return `${normalizedName} (${normalizedId})`;
    }
    if (normalizedName) {
      return normalizedName;
    }
    if (normalizedId) {
      return normalizedId;
    }
    return '—';
  }

  private formatServerCapabilities(capabilities: string[]): string {
    const capabilitySet = new Set((capabilities || []).map(item => String(item || '').trim().toLowerCase()).filter(Boolean));
    const features: string[] = [];

    if (capabilitySet.has('systemctl') || capabilitySet.has('service') || capabilitySet.has('lssrc')) {
      features.push('Services');
    }
    if (capabilitySet.has('journalctl')) {
      features.push('Logs');
    }
    if (capabilitySet.has('crontab')) {
      features.push('Cron');
    }
    if (capabilitySet.has('ps')) {
      features.push('Processes');
    }
    if (capabilitySet.has('df')) {
      features.push('Disk');
    }
    if (capabilitySet.has('free') || capabilitySet.has('svmon')) {
      features.push('Memory');
    }

    return features.length ? features.join(', ') : '—';
  }

  private formatServerUptime(secondsText: string | undefined, rawUptime: string | undefined): ServerDashboardOverviewItem {
    const seconds = Number(String(secondsText || '').trim());
    if (Number.isFinite(seconds) && seconds > 0) {
      return { label: 'Uptime', value: this.formatServerDuration(seconds), help: 'System uptime' };
    }

    const raw = String(rawUptime || '').trim();
    const match = /\bup\s+(.+?)(?:,\s+\d+\s+users?|,\s+load averages?:|,\s+load average:|$)/i.exec(raw);
    const duration = this.formatServerUptimeText(match?.[1] || raw);
    return { label: 'Uptime', value: duration || '—', help: duration ? 'System uptime' : 'Not available' };
  }

  private formatServerDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${Math.max(0, minutes)}m`;
  }

  private formatServerUptimeText(value: string | undefined): string {
    const text = String(value || '').trim();
    if (!text) {
      return '';
    }

    const daysMatch = /(\d+)\s+days?/i.exec(text);
    const hoursMinutesMatch = /(\d+):(\d{2})/.exec(text);
    if (daysMatch || hoursMinutesMatch) {
      const days = Number(daysMatch?.[1] || 0);
      const hours = Number(hoursMinutesMatch?.[1] || 0);
      const minutes = Number(hoursMinutesMatch?.[2] || 0);
      const totalSeconds = (days * 86400) + (hours * 3600) + (minutes * 60);
      if (totalSeconds > 0) {
        return this.formatServerDuration(totalSeconds);
      }
    }

    const hourMatch = /(\d+)\s*(?:hours?|hrs?|h)\b/i.exec(text);
    const minuteMatch = /(\d+)\s*(?:minutes?|mins?|m)\b/i.exec(text);
    if (hourMatch || minuteMatch) {
      const hours = Number(hourMatch?.[1] || 0);
      const minutes = Number(minuteMatch?.[1] || 0);
      const totalSeconds = (hours * 3600) + (minutes * 60);
      if (totalSeconds > 0) {
        return this.formatServerDuration(totalSeconds);
      }
    }

    return '';
  }

  private formatServerLoad(rawUptime: string | undefined): ServerDashboardOverviewItem {
    const raw = String(rawUptime || '').trim();
    const match = /load averages?:\s*([0-9.,]+)[, ]+([0-9.,]+)[, ]+([0-9.,]+)/i.exec(raw);
    if (match) {
      const one = this.formatServerLoadNumber(match[1]);
      const five = this.formatServerLoadNumber(match[2]);
      const fifteen = this.formatServerLoadNumber(match[3]);
      return { label: 'Load', value: one || '—', help: five && fifteen ? `5m ${five} • 15m ${fifteen}` : 'Not available' };
    }

    return { label: 'Load', value: '—', help: 'Not available' };
  }

  private formatServerLoadNumber(value: string | undefined): string {
    return String(value || '')
      .trim()
      .replace(/[,.]+$/, '')
      .replace(',', '.');
  }

  private formatServerMemory(memoryText: string | undefined): ServerDashboardOverviewItem {
    const parts = String(memoryText || '').split('|');
    const totalMb = Number(parts[0]);
    const usedMb = Number(parts[1]);

    if (Number.isFinite(totalMb) && totalMb > 0 && Number.isFinite(usedMb)) {
      const percent = Math.max(0, Math.min(100, Math.round((usedMb / totalMb) * 100)));
      return {
        label: 'Memory',
        value: `${percent}%`,
        help: `${formatBytes(usedMb * 1024 * 1024)} / ${formatBytes(totalMb * 1024 * 1024)}`
      };
    }

    return { label: 'Memory', value: '—', help: 'Not available' };
  }

  private formatServerDisk(diskText: string | undefined): ServerDashboardOverviewItem {
    const parts = String(diskText || '').split('|');
    const totalKb = Number(parts[0]);
    const usedKb = Number(parts[1]);
    const freeKb = Number(parts[2]);
    const percentText = String(parts[3] || '').trim();

    if (Number.isFinite(totalKb) && totalKb > 0 && Number.isFinite(usedKb)) {
      const value = percentText || `${Math.round((usedKb / totalKb) * 100)}%`;
      const usedLabel = formatBytes(usedKb * 1024);
      const totalLabel = formatBytes(totalKb * 1024);
      const freeLabel = Number.isFinite(freeKb) ? formatBytes(freeKb * 1024) : '';
      return {
        label: 'Disk',
        value,
        help: `${usedLabel} / ${totalLabel}${freeLabel ? ` • ${freeLabel} free` : ''}`
      };
    }

    return { label: 'Disk', value: '—', help: 'Not available' };
  }

  private formatServerTime(value: unknown): string {
    const text = String(value ?? '').trim();
    if (!text) {
      return '—';
    }

    return text.replace(/([+-]\d{2})(\d{2})\b/, 'UTC$1:$2');
  }

  private formatServerRefreshTime(timestamp: number): string {
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `${time} local`;
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
          this.formatRemoteFileOpenFailureReason(error, normalizedPath)
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
    const requestedConnectionId = String(payload?.connectionId || '').trim();
    const connectionId = requestedConnectionId || this.requireActiveConnectionId();
    const commandId = String(payload?.commandId || '').trim() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const command = String(payload?.command || '').trim();
    const workingDirectory = normalizeRemotePath(String(payload?.workingDirectory || this.getActivePath() || '/'));

    if (!command) {
      this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
        commandId,
        connectionId,
        error: 'Enter a command to run.'
      });
      return;
    }

    if (this.activeRemoteCommands.has(connectionId)) {
      this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
        commandId,
        connectionId,
        error: 'Another remote command is already running for this connection.'
      });
      return;
    }

    const connection = this.sessions.getConnection(connectionId);
    const username = String(connection?.username || '').trim();
    const isRootConnection = username.toLowerCase() === 'root';
    const requestedSudo = Boolean(payload?.useSudo) && !isRootConnection;
    let sudoModeEnabled = this.sessions.isSudoModeEnabled(connectionId);

    if (requestedSudo && !sudoModeEnabled) {
      if (connection?.connectionType !== 'sftp') {
        this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
          error: 'Sudo Mode is available only for SFTP connections.'
        });
        return;
      }

      const password = String(payload?.sudoPassword || '') || await this.showWebviewInputBox({
        title: 'Run Command with Sudo',
        prompt: 'Enter the sudo password for this connection. The password is kept only in memory for the current session.',
        password: true,
        placeHolder: 'Sudo password',
        label: 'Sudo password',
        confirmLabel: 'Run'
      });

      if (!password) {
        this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
          error: 'Sudo command canceled.'
        });
        return;
      }

      try {
        await this.sessions.enableSudoMode(connectionId, password);
        sudoModeEnabled = true;
        this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: true });
        this.logInfo('Sudo Mode enabled for remote command.', { Connection: connectionId });
      } catch (error) {
        this.sessions.disableSudoMode(connectionId);
        const message = error instanceof Error ? error.message : String(error);
        this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: false });
        this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
          error: message || 'Could not enable Sudo Mode.'
        });
        this.logWarn('Could not enable Sudo Mode for remote command.', { Connection: connectionId, Details: message });
        return;
      }
    }

    const cancellationSource = new vscode.CancellationTokenSource();
    this.activeRemoteCommands.set(connectionId, { id: commandId, connectionId, cancellationSource });
    const useSudo = (sudoModeEnabled || requestedSudo) && !isRootConnection;

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
    const connectionId = String(payload?.connectionId || '').trim();
    const force = Boolean(payload?.force);
    const activeCommand = this.findActiveRemoteCommand(commandId, connectionId);

    if (!activeCommand) {
      if (commandId) {
        this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
          stopped: true,
          forceKilled: force
        });
      }
      return;
    }

    activeCommand.stopMode = force ? 'force' : 'stop';

    if (force) {
      activeCommand.control?.forceKill();
      activeCommand.cancellationSource.cancel();
      return;
    }

    activeCommand.control?.stop();
    activeCommand.cancellationSource.cancel();
  }

  private findActiveRemoteCommand(commandId?: string, connectionId?: string): ActiveRemoteCommandState | undefined {
    const normalizedConnectionId = String(connectionId || '').trim();
    if (normalizedConnectionId) {
      const activeCommand = this.activeRemoteCommands.get(normalizedConnectionId);
      if (!commandId || activeCommand?.id === commandId) {
        return activeCommand;
      }
      return undefined;
    }

    const normalizedCommandId = String(commandId || '').trim();
    if (normalizedCommandId) {
      return Array.from(this.activeRemoteCommands.values()).find(command => command.id === normalizedCommandId);
    }

    return Array.from(this.activeRemoteCommands.values())[0];
  }

  private stopAllRemoteCommands(force = false): void {
    for (const activeCommand of this.activeRemoteCommands.values()) {
      this.stopRemoteCommand({ commandId: activeCommand.id, connectionId: activeCommand.connectionId, force });
    }
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
            const activeCommand = this.activeRemoteCommands.get(connectionId);
            if (activeCommand?.id === commandId) {
              activeCommand.control = control;
            }
          },
          onCommand: logicalCommand => {
            flushOutput();
            this.postMessage(RemoteEditOutboundMessageType.RemoteCommandOutput, {
              commandId,
              connectionId,
              kind: 'command',
              text: logicalCommand
            });
          },
          onCommandStatus: (index, code) => {
            commandExitCodes[index] = code;
            flushOutput();
            this.postMessage(RemoteEditOutboundMessageType.RemoteCommandOutput, {
              commandId,
              connectionId,
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
        const stopMode = this.activeRemoteCommands.get(connectionId)?.id === commandId ? this.activeRemoteCommands.get(connectionId)?.stopMode : undefined;
        this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
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
        connectionId,
        code: result.code,
        signal: result.signal || '',
        commandCount: commandExitCodes.filter(code => typeof code === 'number').length,
        failedCommandCount: commandExitCodes.filter(code => typeof code === 'number' && code !== 0).length
      });
    } catch (error) {
      flushOutput();
      const message = error instanceof Error ? error.message : String(error);
      const stopped = cancellationSource.token.isCancellationRequested || isRemoteEditOperationCancelled(error) || message === 'Operation canceled.' || message === 'Operation cancelled.';

      if (stopped) {
        this.logInfo('Remote command stopped.', {
          Connection: connectionId,
          WorkingDirectory: workingDirectory,
          Command: command
        });
        const stopMode = this.activeRemoteCommands.get(connectionId)?.id === commandId ? this.activeRemoteCommands.get(connectionId)?.stopMode : undefined;
        this.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
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
          connectionId,
          error: message || 'Remote command failed.'
        });
      }
    } finally {
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = undefined;
      }
      const activeCommand = this.activeRemoteCommands.get(connectionId);
      if (activeCommand?.id === commandId) {
        this.activeRemoteCommands.delete(connectionId);
      }
      cancellationSource.dispose();
    }
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
    this.clearPendingRemoteSearchResults(snapshot.connectionId);
    this.postMessage(RemoteEditOutboundMessageType.RemoteSearchStarted, snapshot);
  }

  private queueRemoteSearchResult(result: RemoteSearchResult, meta: RemoteSearchResultMeta): void {
    const connectionId = meta.connectionId;
    let batch = this.pendingRemoteSearchResultBatches.get(connectionId);
    if (!batch || batch.meta.searchId !== meta.searchId) {
      if (batch) {
        this.flushPendingRemoteSearchResults(connectionId);
      }
      batch = { meta: { ...meta }, results: [] };
      this.pendingRemoteSearchResultBatches.set(connectionId, batch);
    }

    batch.meta = { ...meta };
    batch.results.push(result);

    if (!batch.timer) {
      batch.timer = setTimeout(() => this.flushPendingRemoteSearchResults(connectionId), 100);
    }
  }

  private flushPendingRemoteSearchResults(connectionId: string): void {
    const batch = this.pendingRemoteSearchResultBatches.get(connectionId);
    if (!batch) {
      return;
    }

    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = undefined;
    }

    if (!batch.results.length) {
      this.pendingRemoteSearchResultBatches.delete(connectionId);
      return;
    }

    const results = batch.results.splice(0, batch.results.length);
    this.postMessage(RemoteEditOutboundMessageType.RemoteSearchResultsBatch, {
      connectionId: batch.meta.connectionId,
      results,
      status: batch.meta.status,
      searchId: batch.meta.searchId,
      totalResults: batch.meta.totalResults
    });
    this.pendingRemoteSearchResultBatches.delete(connectionId);
  }

  private clearPendingRemoteSearchResults(connectionId: string): void {
    const batch = this.pendingRemoteSearchResultBatches.get(connectionId);
    if (batch?.timer) {
      clearTimeout(batch.timer);
    }
    this.pendingRemoteSearchResultBatches.delete(connectionId);
  }

  private clearAllPendingRemoteSearchResults(): void {
    for (const batch of this.pendingRemoteSearchResultBatches.values()) {
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
    }
    this.pendingRemoteSearchResultBatches.clear();
  }

  private postRemoteSearchFinished(snapshot: RemoteSearchSnapshot): void {
    this.flushPendingRemoteSearchResults(snapshot.connectionId);
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
      this.postOperationError(summary);
      return;
    }

    this.postBusy(false, `Changed owner/group for ${this.formatCount(changedCount, 'item')}.`);
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
      this.postStatus('Set permissions canceled.');
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
      this.postOperationError(summary);
      return;
    }

    this.postBusy(false, `Permissions set to ${result.mode} for ${this.formatCount(changedCount, 'item')}.`);
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
      this.panel.title = 'Remote Edit';
    }
  }

  private formatStatusError(messageType: string, rawMessage: string): string {
    const base = this.getStatusErrorPrefix(messageType);

    if (!base) {
      const reason = this.formatRealErrorForStatus(rawMessage);
      return this.compactStatusMessage(reason || rawMessage || 'Operation failed.');
    }

    return this.formatFailureStatus(base, rawMessage);
  }

  private formatFailureStatus(base: string, rawMessage: string): string {
    const reason = this.formatRealErrorForStatus(rawMessage);

    if (!reason) {
      return `${base}.`;
    }

    const normalizedReason = this.removeDuplicateStatusPrefix(reason, base);
    return `${base}: ${this.ensureStatusPunctuation(normalizedReason || reason)}`;
  }

  private getStatusErrorPrefix(messageType: string): string {
    switch (messageType) {
      case RemoteEditIncomingMessageType.Connect:
        return 'Connection failed';
      case RemoteEditIncomingMessageType.SaveConnection:
        return 'Connection could not be saved';
      case RemoteEditIncomingMessageType.DeleteConnection:
        return 'Connection could not be removed';
      case RemoteEditIncomingMessageType.RenameConnection:
        return 'Connection could not be renamed';
      case RemoteEditIncomingMessageType.Disconnect:
        return 'Disconnect failed';
      case RemoteEditIncomingMessageType.SwitchSession:
        return 'Could not switch connection';
      case RemoteEditIncomingMessageType.EnableSudoMode:
      case RemoteEditIncomingMessageType.DisableSudoMode:
        return 'Sudo Mode could not be changed';
      case RemoteEditIncomingMessageType.ListDirectory:
      case RemoteEditIncomingMessageType.OpenParent:
      case RemoteEditIncomingMessageType.OpenPath:
        return 'Remote path could not be loaded';
      case RemoteEditIncomingMessageType.OpenEntry:
      case RemoteEditIncomingMessageType.OpenEntries:
      case RemoteEditIncomingMessageType.OpenEntriesReadOnly:
        return 'Remote file could not be opened';
      case RemoteEditIncomingMessageType.CompareSelectedEntries:
        return 'Comparison failed';
      case RemoteEditIncomingMessageType.AddRemotePathFavorite:
      case RemoteEditIncomingMessageType.RemoveRemotePathFavorite:
        return 'Favorite could not be updated';
      case RemoteEditIncomingMessageType.RequestCreateFile:
        return 'File could not be created';
      case RemoteEditIncomingMessageType.RequestCreateDirectory:
        return 'Directory could not be created';
      case RemoteEditIncomingMessageType.RequestMakeCopy:
        return 'Copy failed';
      case RemoteEditIncomingMessageType.RequestCalculateChecksums:
        return 'Checksum calculation failed';
      case RemoteEditIncomingMessageType.RequestRenameEntry:
        return 'Rename failed';
      case RemoteEditIncomingMessageType.RequestDeleteEntry:
      case RemoteEditIncomingMessageType.RequestDeleteEntries:
        return 'Delete failed';
      case RemoteEditIncomingMessageType.RequestUploadEntries:
        return 'Upload failed';
      case RemoteEditIncomingMessageType.RequestDownloadEntries:
        return 'Download failed';
      case RemoteEditIncomingMessageType.RequestCompressArchive:
        return 'Archive creation failed';
      case RemoteEditIncomingMessageType.RequestSetPermissions:
      case RemoteEditIncomingMessageType.ApplyPermissions:
        return 'Permissions update failed';
      case RemoteEditIncomingMessageType.RequestChangeOwnerGroup:
        return 'Owner/group change failed';
      case RemoteEditIncomingMessageType.RequestRunRemoteCommand:
        return 'Remote command failed';
      case RemoteEditIncomingMessageType.StopRemoteCommand:
        return 'Remote command could not be stopped';
      case RemoteEditIncomingMessageType.CopyRemotePath:
      case RemoteEditIncomingMessageType.CopyStatus:
        return 'Copy failed';
      default:
        return '';
    }
  }

  private formatRealErrorForStatus(message: string): string {
    let text = String(message || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

    if (!text) {
      return '';
    }

    const lines = text.split('\n')
      .map(line => line.trim())
      .filter(line => line && !/^at\s+/i.test(line));

    text = lines[0] || text;
    text = text
      .replace(/^(?:error|typeerror|rangeerror|referenceerror):\s*/i, '')
      .replace(/^details:\s*/i, '')
      .replace(/^getConnection:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    text = this.normalizeNoisyStatusError(text);

    return this.compactStatusReason(text);
  }

  private normalizeNoisyStatusError(message: string): string {
    const text = String(message || '').trim();

    if (/^all configured authentication methods failed\.?$/i.test(text)) {
      return 'authentication failed';
    }

    return text;
  }

  private removeDuplicateStatusPrefix(reason: string, base: string): string {
    const text = String(reason || '').trim();

    if (this.normalizeMessageForComparison(text) === this.normalizeMessageForComparison(base)) {
      return '';
    }

    const normalizedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`^${normalizedBase}\\s*[:.-]\\s*`, 'i'), '').trim();
  }

  private ensureStatusPunctuation(message: string): string {
    const text = String(message || '').trim();
    return /[.!?]$/.test(text) ? text : `${text}.`;
  }

  private compactStatusReason(message: string): string {
    const compact = String(message || '').trim();
    return compact.length <= 120 ? compact : `${compact.slice(0, 117).trimEnd()}...`;
  }

  private extractErrorDetailText(message: string): string {
    const text = String(message || '').trim();
    const match = /\bDetails:\s*([\s\S]*)$/i.exec(text);
    return (match ? match[1] : text).trim();
  }

  private compactStatusMessage(message: string): string {
    const withoutDetails = String(message || 'Operation failed.').replace(/\s+Details:\s*[\s\S]*$/i, '').trim();
    const compact = withoutDetails || 'Operation failed.';
    return compact.length <= 120 ? compact : `${compact.slice(0, 117).trimEnd()}...`;
  }

  private shouldShowStatusOutputLink(messageType: string, rawMessage: string, detailedMessage: string, statusMessage: string): boolean {
    const raw = String(rawMessage || '').trim();

    if (!raw) {
      return false;
    }

    if (/^(select|enter|choose|only|connect to |no active|no connection|the .* cannot|the .* must|a remote .* already exists)/i.test(raw)) {
      return false;
    }

    const normalizedDetails = this.normalizeMessageForComparison(detailedMessage);
    const normalizedRaw = this.normalizeMessageForComparison(rawMessage);
    const normalizedStatus = this.normalizeMessageForComparison(statusMessage);

    return Boolean(
      normalizedDetails &&
      normalizedStatus &&
      normalizedDetails !== normalizedRaw &&
      normalizedDetails !== normalizedStatus &&
      !normalizedStatus.includes(normalizedDetails)
    );
  }

  private normalizeMessageForComparison(message: string): string {
    return String(message || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.!?]+$/g, '')
      .trim();
  }

  private formatError(messageType: string, payload: any, details: string): string {
    if (messageType === RemoteEditIncomingMessageType.Connect) {
      const host = String(payload?.host || '').trim() || 'remote host';
      const port = String(payload?.port || '22').trim() || '22';
      const username = String(payload?.username || '').trim();
      const authType = String(payload?.authType || 'password') === 'privateKey' ? 'private key' : 'password';
      const target = username ? `${username}@${host}:${port}` : `${host}:${port}`;
      const rawProtocol = String(payload?.connectionType || 'sftp').trim().toLowerCase();
      const protocol = rawProtocol.toUpperCase() || 'SFTP';
      const authLabel = rawProtocol === 'ftp' || rawProtocol === 'ftps' ? '' : ` using ${authType} authentication`;
      return `${protocol} connection failed for ${target}${authLabel}. Error: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.SaveConnection) {
      return `Could not save the connection profile. Error: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.DeleteConnection) {
      return `Could not delete the connection profile. Error: ${details}`;
    }

    if (this.isMissingRemoteConnectionError(details)) {
      return this.formatMissingRemoteConnectionMessage(details);
    }

    if (messageType === RemoteEditIncomingMessageType.ListDirectory || messageType === RemoteEditIncomingMessageType.OpenPath) {
      const rawPath = String(payload?.path || this.getActivePath() || '/').trim() || '/';
      const remotePath = normalizeRemotePath(rawPath);
      return `Could not load remote path ${remotePath}. Error: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.OpenEntry) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : String(payload?.name || 'selected entry');
      return `Could not open remote entry ${entryPath}. Error: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestRenameEntry) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not rename remote entry ${entryPath}. Error: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestMakeCopy) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not make a copy of remote file ${entryPath}. Error: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestCalculateChecksums) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not calculate checksums for remote file ${entryPath}. Error: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestDeleteEntry) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not delete remote entry ${entryPath}. Error: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestUploadEntries) {
      return `Could not upload selected items. Error: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestDownloadEntries) {
      return `Could not download selected items. Error: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestSetPermissions) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not set permissions on remote entry ${entryPath}. Error: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestChangeOwnerGroup) {
      return `Could not change owner/group for selected remote items. Error: ${details}`;
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

  private async showRemoteFileOpenFailureDialog(title: string, remotePath: string, reason: string): Promise<void> {
    await this.showConfirmDialog({
      title,
      message: 'Remote file could not be opened.',
      details: `Path: ${remotePath}\nReason: ${reason || 'Unknown error'}`,
      confirmLabel: 'OK',
      hideCancel: true
    });
  }

  private formatRemoteFileOpenFailureReason(error: unknown, remotePath?: string): string {
    let text = error instanceof Error ? error.message : String(error || '');
    const path = String(remotePath || '').trim();

    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)[0] || '';

    text = text
      .replace(/^(?:error|details):\s*/i, '')
      .replace(/^_?[a-z]*stat:\s*/i, '')
      .replace(/^getConnection:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (/no such file|not found|does not exist/i.test(text)) {
      const match = /(no such file[^:]*|not found|does not exist)[:\s]*(.*)$/i.exec(text);
      const messagePath = String(match?.[2] || '').trim();
      return `No such file${messagePath || path ? `: ${messagePath || path}` : ''}`;
    }

    if (/permission denied|access denied/i.test(text)) {
      return 'Permission denied.';
    }

    if (/is a directory/i.test(text)) {
      return 'Remote path is a directory, not a file.';
    }

    return text || 'Unknown error';
  }

  private async showWebviewInputBox(options: InputDialogOptions): Promise<string | undefined> {
    let value = String(options.value ?? '');
    let validationMessage = String(options.validationMessage || '');

    while (true) {
      const result = await this.showInputDialog({
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

  private async showInputDialog(options: InputDialogOptions): Promise<string | undefined> {
    if (this.isDisposed || !this.panel) {
      return undefined;
    }

    const requestId = `${Date.now()}-${++this.inputDialogSequence}`;

    return new Promise<string | undefined>(resolve => {
      this.pendingInputDialogs.set(requestId, resolve);
      this.postMessage(RemoteEditOutboundMessageType.ShowInputDialog, {
        requestId,
        title: options.title,
        prompt: options.prompt || '',
        placeHolder: options.placeHolder || '',
        label: options.label || '',
        value: options.value || '',
        valueSelection: options.valueSelection || undefined,
        password: Boolean(options.password),
        confirmLabel: options.confirmLabel || 'OK',
        cancelLabel: options.cancelLabel || 'Cancel',
        validationMessage: options.validationMessage || ''
      });
    });
  }

  private handleInputDialogResponse(payload: any): void {
    const requestId = String(payload?.requestId || '');
    const resolve = this.pendingInputDialogs.get(requestId);

    if (!resolve) {
      return;
    }

    this.pendingInputDialogs.delete(requestId);
    resolve(Boolean(payload?.confirmed) ? String(payload?.value ?? '') : undefined);
  }

  private resolvePendingInputDialogs(): void {
    for (const resolve of this.pendingInputDialogs.values()) {
      resolve(undefined);
    }

    this.pendingInputDialogs.clear();
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
        danger: Boolean(options.danger),
        hideCancel: Boolean(options.hideCancel)
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
      showDirectoryDetails: vscode.workspace
        .getConfiguration('remoteedit.remotePathBreadcrumb')
        .get<boolean>('showDirectoryDetails', true)
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
    this.clearAllPendingRemoteSearchResults();
    this.resolvePendingPermissionsDialog();
    this.resolvePendingConfirmDialogs();
    this.resolvePendingInputDialogs();
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
    return renderRemoteEditHtml(webview, getNonce(), {
      showRemotePathBreadcrumbDirectoryDetails: vscode.workspace
        .getConfiguration('remoteedit.remotePathBreadcrumb')
        .get<boolean>('showDirectoryDetails', true)
    });
  }
}
