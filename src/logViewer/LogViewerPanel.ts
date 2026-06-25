import * as vscode from 'vscode';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import type { ActiveConnection, RemoteCommandStreamingControl } from '../remote/RemoteSessionTypes';
import { isSftpConnectionType } from '../remote/RemoteConnectionTypes';
import { appendDebugLog, appendPerformanceLog, appendOutputLog, createPerformanceTimer } from '../utils/outputLogger';
import { getNonce } from '../utils/webviewUtils';
import { dirnameRemotePath, normalizeRemotePath } from '../ssh/SftpSessionManager';
import { shellQuote } from '../utils/shellUtils';

interface ConnectionChangeNotifier {
  onDidChangeConnections?: vscode.Event<void>;
}

type LogViewerStatus = 'opening' | 'following' | 'paused' | 'stopped' | 'failed' | 'disconnected';
type JsonLogMode = 'auto' | 'on' | 'off';

const LOG_VIEWER_FAVORITES_KEY = 'remoteedit.logViewer.favorites.v1';


interface LogViewerOpenOptions {
  connectionId: string;
  path?: string;
  follow?: boolean;
  useSudo?: boolean;
  draftTabId?: string;
}

interface LogViewerLineRecord {
  raw: string;
  fromStderr?: boolean;
  marker?: boolean;
}

interface ActiveLogSession {
  id: string;
  connectionId: string;
  path: string;
  status: LogViewerStatus;
  cancellationSource?: vscode.CancellationTokenSource;
  control?: RemoteCommandStreamingControl;
  stopMode?: 'stop' | 'force';
  stdoutRemainder: string;
  stderrRemainder: string;
  lastPostedStdoutPartial: string;
  lastPostedStderrPartial: string;
  flushTimer?: NodeJS.Timeout;
  pendingLines: string[];
  lines: LogViewerLineRecord[];
  pausedBuffer: LogViewerLineRecord[];
  discardedPausedLines: number;
  discardedBackgroundLines: number;
  useSudo: boolean;
  message: string;
  continuity: string;
  startedAt: number;
}

interface PendingBinaryLogConfirmation {
  resolve: (allowOpen: boolean) => void;
}

const MAX_LINES_PER_TAB = 20000;
const MAX_PAUSED_BUFFER_LINES = 5000;
const INITIAL_TAIL_LINES = 500;
const MAX_ACTIVE_FOLLOW_TABS = 5;
const STREAM_BATCH_INTERVAL_MS = 120;
const LOG_VIEWER_BINARY_SAMPLE_BYTES = 8192;
const LOG_VIEWER_BINARY_WARNING_MESSAGE = 'This file appears to contain binary data. Opening it in Log Viewer may display incorrectly, affect performance, or cause unexpected issues.';
const DEFAULT_BACKGROUND_BUFFER_LINES = 5000;
const MIN_BACKGROUND_BUFFER_LINES = 500;
const MAX_BACKGROUND_BUFFER_LINES = 50000;

export class LogViewerPanel implements vscode.Disposable {
  private static currentPanel: LogViewerPanel | undefined;
  private static readonly activeSessionCountEmitter = new vscode.EventEmitter<number>();
  static readonly onDidChangeActiveSessionCount: vscode.Event<number> = LogViewerPanel.activeSessionCountEmitter.event;

  static getActiveSessionCount(): number {
    return LogViewerPanel.currentPanel?.getActiveSessionCount() || 0;
  }

  private readonly panelDisposables: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sessionsById = new Map<string, ActiveLogSession>();
  private readonly pendingMessages: Array<{ type: string; payload: any }> = [];
  private panel: vscode.WebviewPanel | undefined;
  private isDisposed = false;
  private webviewReady = false;
  private webviewVisible = false;
  private connectionSyncTimer?: NodeJS.Timeout;
  private lastConnectionsSignature = '';
  private lastActiveSessionCount = 0;
  private binaryLogConfirmationSeq = 0;
  private readonly pendingBinaryLogConfirmations = new Map<string, PendingBinaryLogConfirmation>();

  static openForConnection(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    output: vscode.OutputChannel,
    connectionId: string
  ): void {
    const panel = LogViewerPanel.getOrCreate(context, sessions, output);
    void panel.openConnection(connectionId).catch(error => panel.showError(error));
  }

  static openForFile(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    output: vscode.OutputChannel,
    connectionId: string,
    remotePath: string
  ): void {
    const panel = LogViewerPanel.getOrCreate(context, sessions, output);
    void panel.openFile(connectionId, remotePath).catch(error => panel.showError(error));
  }

  static stopConnectionIfOpen(connectionId: string): void {
    LogViewerPanel.currentPanel?.handleConnectionDisconnected(connectionId);
  }

  private static getOrCreate(
    context: vscode.ExtensionContext,
    sessions: RemoteSessionManager,
    output: vscode.OutputChannel
  ): LogViewerPanel {
    if (LogViewerPanel.currentPanel && !LogViewerPanel.currentPanel.isDisposed) {
      LogViewerPanel.currentPanel.reveal();
      return LogViewerPanel.currentPanel;
    }

    LogViewerPanel.currentPanel = new LogViewerPanel(context, sessions, output);
    return LogViewerPanel.currentPanel;
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessions: RemoteSessionManager,
    private readonly output: vscode.OutputChannel
  ) {
    this.attachPanel();

    const connectionChangeEvent = (this.sessions as RemoteSessionManager & ConnectionChangeNotifier).onDidChangeConnections;
    if (connectionChangeEvent) {
      this.disposables.push(connectionChangeEvent(() => this.syncConnections(true)));
    }

    this.connectionSyncTimer = setInterval(() => this.syncConnections(false), 2000);
    this.disposables.push(new vscode.Disposable(() => {
      if (this.connectionSyncTimer) {
        clearInterval(this.connectionSyncTimer);
        this.connectionSyncTimer = undefined;
      }
    }));
  }

  dispose(): void {
    appendDebugLog(this.output, 'Log Viewer', 'Disposing panel.', { Sessions: this.sessionsById.size });
    this.isDisposed = true;
    this.resolvePendingBinaryLogConfirmations(false);
    this.stopAllSessions(true);
    this.disposePanelDisposables();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel?.dispose();
    this.panel = undefined;
    if (LogViewerPanel.currentPanel === this) {
      LogViewerPanel.currentPanel = undefined;
    }
  }

  private attachPanel(): void {
    this.webviewReady = false;
    this.pendingMessages.length = 0;
    this.panel = vscode.window.createWebviewPanel(
      'remoteedit.logViewer',
      'Remote Edit Log Viewer',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.webviewVisible = Boolean(this.panel.visible);
    this.panel.iconPath = new vscode.ThemeIcon('output');
    this.panel.onDidDispose(() => this.handlePanelDisposed(), null, this.panelDisposables);
    this.panel.onDidChangeViewState(event => this.handlePanelViewStateChanged(event.webviewPanel.visible), null, this.panelDisposables);
    this.panel.webview.onDidReceiveMessage(message => this.handleMessage(message), null, this.panelDisposables);
    this.panel.webview.html = this.renderHtml(this.panel.webview);
    appendDebugLog(this.output, 'Log Viewer', 'Panel attached.');
  }

  private reveal(): void {
    if (!this.panel) {
      this.attachPanel();
      return;
    }
    this.panel.reveal(vscode.ViewColumn.Active);
    appendDebugLog(this.output, 'Log Viewer', 'Panel revealed.');
  }

  private handlePanelDisposed(): void {
    appendDebugLog(this.output, 'Log Viewer', 'Panel disposed.', { Sessions: this.sessionsById.size });
    this.webviewReady = false;
    this.webviewVisible = false;
    this.pendingMessages.length = 0;
    this.resolvePendingBinaryLogConfirmations(false);
    this.applyBackgroundBufferLimitToAllSessions();
    this.disposePanelDisposables();
    this.panel = undefined;
  }

  private handlePanelViewStateChanged(visible: boolean): void {
    this.webviewVisible = visible;
    appendDebugLog(this.output, 'Log Viewer', 'Panel visibility changed.', { Visible: visible });
    if (visible) {
      this.post('snapshot', this.buildSnapshotPayload());
      return;
    }
    this.applyBackgroundBufferLimitToAllSessions();
  }

  private refreshWebviewVisibilityFromPanel(): void {
    if (this.panel?.visible) {
      this.webviewVisible = true;
    }
  }

  private handleWebviewVisibilityMessage(visible: boolean): void {
    this.webviewVisible = visible;
    if (visible) {
      this.post('snapshot', this.buildSnapshotPayload());
      return;
    }
    this.applyBackgroundBufferLimitToAllSessions();
  }

  private disposePanelDisposables(): void {
    while (this.panelDisposables.length) {
      this.panelDisposables.pop()?.dispose();
    }
  }

  private async openConnection(connectionId: string): Promise<void> {
    const connection = this.assertSftpConnection(connectionId);
    this.post('connections', this.buildConnectionsPayload(connectionId));
    this.post('newDraftTab', {
      tabId: this.buildDraftTabId(connection.id),
      connection: this.toConnectionView(connection),
      path: ''
    });
  }

  private async openFile(connectionId: string, remotePath: string): Promise<void> {
    this.assertSftpConnection(connectionId);
    const normalizedPath = normalizeRemotePath(remotePath || '/');
    this.post('connections', this.buildConnectionsPayload(connectionId));
    await this.startFollowing({ connectionId, path: normalizedPath, follow: true });
  }

  private assertSftpConnection(connectionId: string): ActiveConnection {
    const connection = this.sessions.getConnection(connectionId);
    if (!connection) {
      throw new Error('No open Remote Edit connection selected');
    }
    if (!isSftpConnectionType(connection.connectionType)) {
      throw new Error('Log Viewer is available for SSH/SFTP connections only');
    }
    return connection;
  }

  private async handleMessage(message: any): Promise<void> {
    try {
      this.refreshWebviewVisibilityFromPanel();
      switch (String(message?.type || '')) {
        case 'ready':
          this.webviewReady = true;
          this.webviewVisible = Boolean(this.panel?.visible);
          this.post('config', {
            maxLinesPerTab: MAX_LINES_PER_TAB,
            maxPausedBufferLines: MAX_PAUSED_BUFFER_LINES,
            maxBackgroundBufferLines: this.getMaxBackgroundBufferLines(),
            initialTailLines: INITIAL_TAIL_LINES,
            maxActiveFollowTabs: MAX_ACTIVE_FOLLOW_TABS
          });
          this.post('connections', this.buildConnectionsPayload());
          this.flushPendingMessages();
          this.post('snapshot', this.buildSnapshotPayload());
          return;
        case 'visibilityChanged':
          this.handleWebviewVisibilityMessage(Boolean(message.payload?.visible));
          return;
        case 'openLog':
          await this.startFollowing({
            connectionId: String(message.payload?.connectionId || ''),
            path: String(message.payload?.path || ''),
            follow: true,
            useSudo: Boolean(message.payload?.useSudo),
            draftTabId: String(message.payload?.draftTabId || '')
          });
          return;
        case 'stopLog':
          this.stopSession(String(message.payload?.tabId || ''), Boolean(message.payload?.force));
          return;
        case 'pauseLog':
          this.setSessionPaused(String(message.payload?.tabId || ''), Boolean(message.payload?.paused));
          return;
        case 'clearLog':
          this.clearSessionBuffer(String(message.payload?.tabId || ''));
          return;
        case 'binaryLogOpenResponse':
          this.handleBinaryLogOpenResponse(
            String(message.payload?.requestId || ''),
            Boolean(message.payload?.allowOpen)
          );
          return;
        case 'closeTab':
          this.stopSession(String(message.payload?.tabId || ''), true);
          return;
        case 'copy':
          await vscode.env.clipboard.writeText(String(message.payload?.text || ''));
          this.post('copyFeedback', {});
          return;
        case 'showOutput':
          this.output.show(true);
          return;
        case 'listLogDirectory':
          await this.listLogDirectory(
            String(message.payload?.connectionId || ''),
            String(message.payload?.path || '/'),
            String(message.payload?.requestId || '')
          );
          return;
        case 'requestLogFavorites':
          this.post('logFavorites', {
            connectionId: String(message.payload?.connectionId || ''),
            favorites: this.getLogFavorites(String(message.payload?.connectionId || ''))
          });
          return;
        case 'toggleLogFavorite':
          await this.toggleLogFavorite(
            String(message.payload?.connectionId || ''),
            String(message.payload?.path || '')
          );
          return;
        case 'removeLogFavorite':
          await this.removeLogFavorite(
            String(message.payload?.connectionId || ''),
            String(message.payload?.path || '')
          );
          return;
        case 'log':
          this.logDebug(String(message.payload?.message || ''));
          return;
        case 'performanceLog':
          this.logPerformance(String(message.payload?.operation || 'Log Viewer webview'), Number(message.payload?.durationMs || 0), message.payload?.details);
          return;
        default:
          this.post('error', { message: `Unknown Log Viewer message: ${String(message?.type || '')}` });
      }
    } catch (error) {
      this.showError(error);
    }
  }

  private async confirmBinaryLogOpenIfNeeded(connection: ActiveConnection, remotePath: string): Promise<boolean> {
    const sample = await this.readLogFileSample(connection, remotePath);
    if (!sample || !this.looksLikeBinaryContent(sample)) {
      return true;
    }

    appendDebugLog(this.output, 'Log Viewer', 'Binary data detected before opening log.', {
      Connection: connection.name,
      Path: remotePath,
      SampleBytes: sample.length
    });

    return this.requestBinaryLogOpenConfirmation(connection, remotePath, sample.length);
  }

  private requestBinaryLogOpenConfirmation(connection: ActiveConnection, remotePath: string, sampleBytes: number): Promise<boolean> {
    if (!this.panel || this.isDisposed) {
      return Promise.resolve(false);
    }

    const requestId = `binary-log-${Date.now()}-${++this.binaryLogConfirmationSeq}`;
    return new Promise<boolean>(resolve => {
      this.pendingBinaryLogConfirmations.set(requestId, { resolve });
      this.post('confirmBinaryLogOpen', {
        requestId,
        message: LOG_VIEWER_BINARY_WARNING_MESSAGE,
        connectionName: connection.name || connection.host || 'Connection',
        path: remotePath,
        sampleBytes
      });
    });
  }

  private handleBinaryLogOpenResponse(requestId: string, allowOpen: boolean): void {
    const pending = this.pendingBinaryLogConfirmations.get(requestId);
    if (!pending) {
      return;
    }
    this.pendingBinaryLogConfirmations.delete(requestId);
    pending.resolve(Boolean(allowOpen));
  }

  private resolvePendingBinaryLogConfirmations(allowOpen: boolean): void {
    const confirmations = Array.from(this.pendingBinaryLogConfirmations.values());
    this.pendingBinaryLogConfirmations.clear();
    for (const confirmation of confirmations) {
      confirmation.resolve(allowOpen);
    }
  }

  private async readLogFileSample(connection: ActiveConnection, remotePath: string): Promise<Buffer | undefined> {
    const normalizedPath = normalizeRemotePath(remotePath || '/');
    const command = this.buildBinarySampleCommand(normalizedPath);
    const stdoutChunks: string[] = [];
    const timer = createPerformanceTimer();

    try {
      const result = await this.sessions.runRemoteCommandStreaming(
        connection.id,
        dirnameRemotePath(normalizedPath),
        command,
        {
          onStdout: chunk => stdoutChunks.push(String(chunk || ''))
        }
      );

      const sample = this.parseByteSample(stdoutChunks.join(''));
      appendPerformanceLog(this.output, 'Log Viewer', `Binary sample check completed in ${timer()}ms.`, {
        Connection: connection.name,
        Path: normalizedPath,
        Code: String(result.code),
        SampleBytes: sample.length
      });

      return sample;
    } catch (error) {
      appendDebugLog(this.output, 'Log Viewer', 'Binary sample check failed; allowing Log Viewer open.', {
        Connection: connection.name,
        Path: normalizedPath,
        Error: this.formatError(error)
      });
      appendPerformanceLog(this.output, 'Log Viewer', `Binary sample check failed in ${timer()}ms.`, {
        Connection: connection.name,
        Path: normalizedPath,
        Error: this.formatError(error)
      });
      return undefined;
    }
  }

  private buildBinarySampleCommand(remotePath: string): string {
    const quotedPath = shellQuote(normalizeRemotePath(remotePath));
    return [
      `__remote_edit_log_path=${quotedPath}`,
      `__remote_edit_sample_bytes=${LOG_VIEWER_BINARY_SAMPLE_BYTES}`,
      'if ! command -v od >/dev/null 2>&1; then',
      '  exit 127',
      'fi',
      'if [ ! -f "$__remote_edit_log_path" ]; then',
      '  exit 0',
      'fi',
      'dd if="$__remote_edit_log_path" bs="$__remote_edit_sample_bytes" count=1 2>/dev/null | od -An -v -t u1'
    ].join('\n');
  }

  private parseByteSample(output: string): Buffer {
    const bytes: number[] = [];
    const matches = String(output || '').match(/\b\d{1,3}\b/g) || [];
    for (const match of matches) {
      const value = Number(match);
      if (Number.isInteger(value) && value >= 0 && value <= 255) {
        bytes.push(value);
        if (bytes.length >= LOG_VIEWER_BINARY_SAMPLE_BYTES) {
          break;
        }
      }
    }
    return Buffer.from(bytes);
  }

  private looksLikeBinaryContent(sample: Buffer): boolean {
    if (!sample.length) {
      return false;
    }

    if (this.hasTextEncodingBom(sample)) {
      return false;
    }

    if (this.hasKnownBinarySignature(sample)) {
      return true;
    }

    if (sample.includes(0)) {
      return true;
    }

    let suspiciousControlBytes = 0;
    for (const byte of sample) {
      const allowedControl = byte === 8 || byte === 9 || byte === 10 || byte === 13 || byte === 27;
      if (byte < 32 && !allowedControl) {
        suspiciousControlBytes += 1;
      }
    }

    return suspiciousControlBytes >= 8 && suspiciousControlBytes / sample.length > 0.02;
  }

  private hasTextEncodingBom(sample: Buffer): boolean {
    return (sample.length >= 2 && (
      (sample[0] === 0xff && sample[1] === 0xfe) ||
      (sample[0] === 0xfe && sample[1] === 0xff)
    )) || (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf)
      || (sample.length >= 4 && (
        (sample[0] === 0x00 && sample[1] === 0x00 && sample[2] === 0xfe && sample[3] === 0xff) ||
        (sample[0] === 0xff && sample[1] === 0xfe && sample[2] === 0x00 && sample[3] === 0x00)
      ));
  }

  private hasKnownBinarySignature(sample: Buffer): boolean {
    const hasPrefix = (values: number[]) => sample.length >= values.length && values.every((value, index) => sample[index] === value);

    return hasPrefix([0x7f, 0x45, 0x4c, 0x46]) // ELF
      || hasPrefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) // PNG
      || hasPrefix([0xff, 0xd8, 0xff]) // JPEG
      || hasPrefix([0x47, 0x49, 0x46, 0x38]) // GIF
      || hasPrefix([0x50, 0x4b, 0x03, 0x04]) // ZIP
      || hasPrefix([0x50, 0x4b, 0x05, 0x06]) // Empty ZIP
      || hasPrefix([0x50, 0x4b, 0x07, 0x08]) // Spanned ZIP
      || hasPrefix([0x1f, 0x8b]) // gzip
      || hasPrefix([0x42, 0x5a, 0x68]) // bzip2
      || hasPrefix([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) // 7z
      || hasPrefix([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) // RAR
      || hasPrefix([0xca, 0xfe, 0xba, 0xbe]) // Java class / Mach-O fat
      || hasPrefix([0xfe, 0xed, 0xfa, 0xce]) // Mach-O
      || hasPrefix([0xfe, 0xed, 0xfa, 0xcf]) // Mach-O 64
      || hasPrefix([0xcf, 0xfa, 0xed, 0xfe]) // Mach-O reverse
      || hasPrefix([0xce, 0xfa, 0xed, 0xfe]) // Mach-O reverse 64
      || hasPrefix([0x25, 0x50, 0x44, 0x46, 0x2d]) // PDF
      || hasPrefix([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00]); // SQLite
  }

  private async startFollowing(options: LogViewerOpenOptions): Promise<void> {
    const connection = this.assertSftpConnection(options.connectionId);
    const remotePath = normalizeRemotePath(options.path || '/');
    if (!remotePath || remotePath === '/') {
      throw new Error('Enter a remote log path');
    }

    const existing = Array.from(this.sessionsById.values()).find(item => item.connectionId === connection.id && item.path === remotePath);
    if (existing) {
      this.post('focusTab', { tabId: existing.id });
      if (existing.status === 'stopped' || existing.status === 'failed' || existing.status === 'disconnected') {
        appendDebugLog(this.output, 'Log Viewer', 'Preparing to restart existing session.', { Connection: connection.name, Path: remotePath, Status: existing.status });
      } else {
        appendDebugLog(this.output, 'Log Viewer', 'Focused existing session.', { Connection: connection.name, Path: remotePath, Status: existing.status });
        return;
      }
    }

    const activeFollowing = Array.from(this.sessionsById.values()).filter(item => item.status === 'following' || item.status === 'paused' || item.status === 'opening').length;
    if (activeFollowing >= MAX_ACTIVE_FOLLOW_TABS) {
      throw new Error(`Log Viewer can follow up to ${MAX_ACTIVE_FOLLOW_TABS} logs at the same time. Stop one log before opening another`);
    }

    if (!await this.confirmBinaryLogOpenIfNeeded(connection, remotePath)) {
      appendDebugLog(this.output, 'Log Viewer', 'Binary log open cancelled by user.', { Connection: connection.name, Path: remotePath });
      this.post('openLogCancelled', {
        draftTabId: options.draftTabId || '',
        path: remotePath,
        message: ''
      });
      return;
    }

    if (existing && (existing.status === 'stopped' || existing.status === 'failed' || existing.status === 'disconnected')) {
      appendDebugLog(this.output, 'Log Viewer', 'Restarting existing session.', { Connection: connection.name, Path: remotePath, Status: existing.status });
      this.stopSession(existing.id, true);
    }

    const tabId = this.buildTabId(connection.id, remotePath);
    if (options.draftTabId && options.draftTabId !== tabId && this.sessionsById.has(options.draftTabId)) {
      this.cleanupSession(options.draftTabId, true);
      this.sessionsById.delete(options.draftTabId);
    }
    const cancellationSource = new vscode.CancellationTokenSource();
    const session: ActiveLogSession = {
      id: tabId,
      connectionId: connection.id,
      path: remotePath,
      status: 'opening',
      cancellationSource,
      stdoutRemainder: '',
      stderrRemainder: '',
      lastPostedStdoutPartial: '',
      lastPostedStderrPartial: '',
      pendingLines: [],
      lines: [],
      pausedBuffer: [],
      discardedPausedLines: 0,
      discardedBackgroundLines: 0,
      useSudo: this.sessions.isSudoModeEnabled(connection.id),
      message: '',
      continuity: '',
      startedAt: Date.now()
    };

    this.sessionsById.set(tabId, session);
    this.emitActiveSessionCountIfChanged();
    const marker = `--- started from last ${INITIAL_TAIL_LINES} lines; earlier lines are not loaded ---`;
    this.appendSessionLineRecords(session, [{ raw: marker, marker: true }]);
    this.post('tabStarted', {
      tabId,
      connection: this.toConnectionView(connection),
      path: remotePath,
      status: 'opening',
      useSudo: session.useSudo,
      initialTailLines: INITIAL_TAIL_LINES,
      marker,
      draftTabId: options.draftTabId || ''
    });

    const command = this.buildTailCommand(remotePath, INITIAL_TAIL_LINES);
    appendDebugLog(this.output, 'Log Viewer', 'Starting session.', { Connection: connection.name, Path: remotePath, Sudo: session.useSudo });
    const timer = createPerformanceTimer();

    void this.sessions.runRemoteCommandStreaming(
      connection.id,
      dirnameRemotePath(remotePath),
      command,
      {
        onStdout: chunk => this.handleStdout(session.id, chunk),
        onStderr: chunk => this.handleStderr(session.id, chunk),
        onControl: control => {
          const current = this.sessionsById.get(session.id);
          if (current) {
            current.control = control;
          }
        }
      },
      cancellationSource.token
    ).then(result => {
      const current = this.sessionsById.get(session.id);
      if (!current) {
        return;
      }
      this.flushSession(current, true);
      const stoppedByUser = current.stopMode === 'stop' || current.stopMode === 'force';
      current.status = stoppedByUser ? 'stopped' : result.code === 0 ? 'stopped' : 'failed';
      current.message = stoppedByUser ? 'Follow stopped' : result.code === 0 ? 'Follow stopped' : `Remote tail exited with code ${result.code}`;
      current.continuity = 'Follow stopped; new lines are not being streamed';
      this.emitActiveSessionCountIfChanged();
      this.post('tabStatus', {
        tabId: current.id,
        status: current.status,
        message: current.message,
        continuity: current.continuity
      });
      appendDebugLog(this.output, 'Log Viewer', 'Session finished.', {
        Connection: connection.name,
        Path: remotePath,
        Status: current.status,
        Code: String(result.code),
        StoppedByUser: stoppedByUser
      });
      appendPerformanceLog(this.output, 'Log Viewer', `Session finished in ${timer()}ms.`, { Connection: connection.name, Path: remotePath, Code: String(result.code) });
      this.cleanupSession(current.id, false);
    }).catch(error => {
      const current = this.sessionsById.get(session.id);
      if (!current) {
        return;
      }
      this.flushSession(current, true);
      const stoppedByUser = current.stopMode === 'stop' || current.stopMode === 'force' || cancellationSource.token.isCancellationRequested;
      current.status = stoppedByUser ? 'stopped' : 'failed';
      current.message = stoppedByUser ? 'Follow stopped' : this.formatError(error);
      current.continuity = stoppedByUser ? 'Follow stopped; new lines are not being streamed' : 'Stream interrupted; log continuity is not guaranteed';
      this.emitActiveSessionCountIfChanged();
      this.post('tabStatus', {
        tabId: current.id,
        status: current.status,
        message: current.message,
        continuity: current.continuity
      });
      appendDebugLog(this.output, 'Log Viewer', 'Session failed.', {
        Connection: connection.name,
        Path: remotePath,
        Status: current.status,
        StoppedByUser: stoppedByUser,
        Error: this.formatError(error)
      });
      appendPerformanceLog(this.output, 'Log Viewer', `Session failed in ${timer()}ms.`, {
        Connection: connection.name,
        Path: remotePath,
        StoppedByUser: stoppedByUser,
        Error: this.formatError(error)
      });
      this.cleanupSession(current.id, false);
    });
  }

  private handleStdout(tabId: string, chunk: string): void {
    const session = this.sessionsById.get(tabId);
    if (!session) {
      return;
    }
    if (session.status === 'opening') {
      session.status = 'following';
      session.message = 'Following';
      session.continuity = 'Showing recent log window';
      this.emitActiveSessionCountIfChanged();
      this.post('tabStatus', {
        tabId: session.id,
        status: 'following',
        message: session.message,
        continuity: session.continuity
      });
    }
    const combined = session.stdoutRemainder + String(chunk || '');
    const lines = combined.split(/\r?\n/);
    session.stdoutRemainder = lines.pop() || '';
    this.enqueueLines(session, lines);
    this.postPartialLine(session, false);
  }

  private handleStderr(tabId: string, chunk: string): void {
    const session = this.sessionsById.get(tabId);
    if (!session) {
      return;
    }
    const combined = session.stderrRemainder + String(chunk || '');
    const lines = combined.split(/\r?\n/);
    session.stderrRemainder = lines.pop() || '';
    const normalized = lines.map(line => `stderr: ${line}`).filter(Boolean);
    this.enqueueLines(session, normalized, true);
    this.postPartialLine(session, true);
  }

  private enqueueLines(session: ActiveLogSession, lines: string[], fromStderr = false): void {
    const filtered = lines.filter(line => line !== '');
    if (!filtered.length) {
      return;
    }
    session.pendingLines.push(...filtered);
    if (!session.flushTimer) {
      session.flushTimer = setTimeout(() => {
        session.flushTimer = undefined;
        this.flushSession(session, false, fromStderr);
      }, STREAM_BATCH_INTERVAL_MS);
    }
  }

  private flushSession(session: ActiveLogSession, includeRemainders: boolean, fromStderr = false): void {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = undefined;
    }
    if (includeRemainders && session.stdoutRemainder) {
      session.pendingLines.push(session.stdoutRemainder);
      session.stdoutRemainder = '';
    }
    if (includeRemainders && session.stderrRemainder) {
      session.pendingLines.push(`stderr: ${session.stderrRemainder}`);
      session.stderrRemainder = '';
    }
    if (!session.pendingLines.length) {
      return;
    }
    const lines = session.pendingLines.splice(0, session.pendingLines.length);
    this.appendSessionLineRecords(session, lines.map(raw => ({ raw, fromStderr })));
    if (this.canPostLiveLines()) {
      this.post('lines', { tabId: session.id, lines, fromStderr });
      if (includeRemainders) {
        this.postPartialLine(session, false, true);
        this.postPartialLine(session, true, true);
      }
    }
  }

  private stopSession(tabId: string, force = false): void {
    const session = this.sessionsById.get(tabId);
    if (!session) {
      this.post('tabClosed', { tabId });
      return;
    }
    appendDebugLog(this.output, 'Log Viewer', 'Stopping session.', { Connection: session.connectionId, Path: session.path, Force: force, Status: session.status });
    session.stopMode = force ? 'force' : 'stop';
    if (!force && session.status !== 'stopped') {
      session.status = 'stopped';
      session.message = 'Follow stopped';
      session.continuity = 'Follow stopped; new lines are not being streamed';
      this.emitActiveSessionCountIfChanged();
      this.post('tabStatus', {
        tabId: session.id,
        status: session.status,
        message: session.message,
        continuity: session.continuity
      });
    }
    this.flushSession(session, true);
    try {
      if (force) {
        session.control?.forceKill();
      } else {
        session.control?.stop();
      }
    } catch {
      // Ignore best-effort remote stop failures.
    }
    session.cancellationSource?.cancel();
    if (force) {
      this.cleanupSession(tabId, true);
      this.sessionsById.delete(tabId);
      this.emitActiveSessionCountIfChanged();
      this.post('tabClosed', { tabId });
    }
  }

  private stopAllSessions(force = true): void {
    appendDebugLog(this.output, 'Log Viewer', 'Stopping all sessions.', { Sessions: this.sessionsById.size, Force: force });
    for (const id of Array.from(this.sessionsById.keys())) {
      this.stopSession(id, force);
    }
  }

  private cleanupSession(tabId: string, disposeCancellation: boolean): void {
    const session = this.sessionsById.get(tabId);
    if (!session) {
      return;
    }
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = undefined;
    }
    if (disposeCancellation) {
      session.cancellationSource?.dispose();
    }
    if (session.status === 'stopped' || session.status === 'failed' || session.status === 'disconnected') {
      session.cancellationSource?.dispose();
      session.cancellationSource = undefined;
      session.control = undefined;
    }
  }

  private getActiveSessionCount(): number {
    return Array.from(this.sessionsById.values()).filter(session => !this.isTerminalStatus(session.status)).length;
  }

  private emitActiveSessionCountIfChanged(): void {
    const count = this.getActiveSessionCount();
    if (count === this.lastActiveSessionCount) {
      return;
    }
    this.lastActiveSessionCount = count;
    LogViewerPanel.activeSessionCountEmitter.fire(count);
  }

  private isTerminalStatus(status: LogViewerStatus): boolean {
    return status === 'stopped' || status === 'failed';
  }

  private getMaxBackgroundBufferLines(): number {
    const configured = vscode.workspace.getConfiguration('remoteedit').get<number>('logViewer.maxBackgroundBufferLines', DEFAULT_BACKGROUND_BUFFER_LINES);
    const numeric = Number(configured);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_BACKGROUND_BUFFER_LINES;
    }
    return Math.max(MIN_BACKGROUND_BUFFER_LINES, Math.min(MAX_BACKGROUND_BUFFER_LINES, Math.floor(numeric)));
  }

  private postPartialLine(session: ActiveLogSession, fromStderr: boolean, force = false): void {
    if (session.status === 'paused') {
      return;
    }

    const raw = fromStderr ? session.stderrRemainder : session.stdoutRemainder;
    const previous = fromStderr ? session.lastPostedStderrPartial : session.lastPostedStdoutPartial;
    if (!force && raw === previous) {
      return;
    }
    if (!this.canPostLiveLines()) {
      return;
    }

    if (fromStderr) {
      session.lastPostedStderrPartial = raw;
    } else {
      session.lastPostedStdoutPartial = raw;
    }

    this.post('partialLine', {
      tabId: session.id,
      raw,
      fromStderr
    });
  }

  private canPostLiveLines(): boolean {
    const visible = this.webviewVisible || Boolean(this.panel?.visible);
    if (visible) {
      this.webviewVisible = true;
    }
    return Boolean(this.panel && this.webviewReady && visible && !this.isDisposed);
  }

  private appendSessionLineRecords(session: ActiveLogSession, records: LogViewerLineRecord[]): void {
    if (!records.length) {
      return;
    }

    if (session.status === 'paused') {
      session.pausedBuffer.push(...records);
      const pausedLimit = this.webviewVisible ? MAX_PAUSED_BUFFER_LINES : this.getMaxBackgroundBufferLines();
      if (session.pausedBuffer.length > pausedLimit) {
        const extra = session.pausedBuffer.length - pausedLimit;
        session.pausedBuffer.splice(0, extra);
        session.discardedPausedLines += extra;
        if (!this.webviewVisible) {
          session.discardedBackgroundLines += extra;
        }
      }
      return;
    }

    session.lines.push(...records);
    this.applyLineLimitToSession(session, this.webviewVisible ? MAX_LINES_PER_TAB : this.getMaxBackgroundBufferLines(), !this.webviewVisible);
  }

  private applyLineLimitToSession(session: ActiveLogSession, maxLines: number, countAsBackgroundDiscard: boolean): void {
    const safeMax = Math.max(1, Math.floor(maxLines || DEFAULT_BACKGROUND_BUFFER_LINES));
    if (session.lines.length <= safeMax) {
      return;
    }
    const extra = session.lines.length - safeMax;
    session.lines.splice(0, extra);
    if (countAsBackgroundDiscard) {
      session.discardedBackgroundLines += extra;
    }
  }

  private applyBackgroundBufferLimitToAllSessions(): void {
    const maxLines = this.getMaxBackgroundBufferLines();
    let discarded = 0;
    for (const session of this.sessionsById.values()) {
      const beforeLines = session.lines.length;
      const beforePaused = session.pausedBuffer.length;
      this.applyLineLimitToSession(session, maxLines, true);
      if (session.pausedBuffer.length > maxLines) {
        const extra = session.pausedBuffer.length - maxLines;
        session.pausedBuffer.splice(0, extra);
        session.discardedPausedLines += extra;
        session.discardedBackgroundLines += extra;
      }
      discarded += Math.max(0, beforeLines - session.lines.length) + Math.max(0, beforePaused - session.pausedBuffer.length);
    }
    if (discarded > 0) {
      appendDebugLog(this.output, 'Log Viewer', 'Applied background buffer limit.', { MaxLines: maxLines, DiscardedLines: discarded });
    }
  }

  private setSessionPaused(tabId: string, paused: boolean): void {
    const session = this.sessionsById.get(tabId);
    if (!session || session.status === 'stopped' || session.status === 'failed' || session.status === 'disconnected') {
      return;
    }

    if (paused) {
      session.status = 'paused';
      session.message = 'Paused';
      session.continuity = 'Follow is running in background; new lines are buffered';
      this.emitActiveSessionCountIfChanged();
      appendDebugLog(this.output, 'Log Viewer', 'Paused session.', { Connection: session.connectionId, Path: session.path });
      return;
    }

    if (session.status === 'paused') {
      const buffered = session.pausedBuffer.splice(0, session.pausedBuffer.length);
      if (buffered.length) {
        session.lines.push(...buffered);
        this.applyLineLimitToSession(session, this.webviewVisible ? MAX_LINES_PER_TAB : this.getMaxBackgroundBufferLines(), !this.webviewVisible);
      }
      session.status = 'following';
      session.message = 'Following';
      session.continuity = 'Showing recent log window';
      this.emitActiveSessionCountIfChanged();
      appendDebugLog(this.output, 'Log Viewer', 'Resumed session.', { Connection: session.connectionId, Path: session.path, BufferedLines: buffered.length });
    }
  }

  private clearSessionBuffer(tabId: string): void {
    const session = this.sessionsById.get(tabId);
    if (!session) {
      return;
    }
    appendDebugLog(this.output, 'Log Viewer', 'Cleared session buffer.', {
      Connection: session.connectionId,
      Path: session.path,
      LoadedLines: session.lines.length,
      PausedBufferLines: session.pausedBuffer.length
    });
    session.lines = [];
    session.pausedBuffer = [];
    session.stdoutRemainder = '';
    session.stderrRemainder = '';
    session.discardedPausedLines = 0;
    session.discardedBackgroundLines = 0;
    this.postPartialLine(session, false, true);
    this.postPartialLine(session, true, true);
  }

  private buildSnapshotPayload(): any {
    const sessions = Array.from(this.sessionsById.values())
      .map(session => this.toSessionSnapshot(session))
      .filter(Boolean);
    return {
      activeTabId: sessions.length ? (sessions[sessions.length - 1] as any).tabId : '',
      sessions
    };
  }

  private toSessionSnapshot(session: ActiveLogSession): any | undefined {
    const connection = this.sessions.getConnection(session.connectionId);
    if (!connection) {
      return undefined;
    }
    return {
      tabId: session.id,
      connection: this.toConnectionView(connection),
      path: session.path,
      status: session.status,
      useSudo: session.useSudo,
      lines: session.lines,
      pausedBuffer: session.pausedBuffer,
      stdoutRemainder: session.stdoutRemainder,
      stderrRemainder: session.stderrRemainder,
      discardedPausedLines: session.discardedPausedLines,
      discardedBackgroundLines: session.discardedBackgroundLines,
      message: session.message,
      continuity: session.continuity
    };
  }

  private syncConnections(force = true): void {
    const openConnectionIds = new Set(this.sessions.listConnections().map(connection => connection.id));
    const payload = this.buildConnectionsPayload();
    const signature = JSON.stringify(payload.connections.map((connection: any) => ({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      username: connection.username,
      connectionType: connection.connectionType,
      sudoModeEnabled: connection.sudoModeEnabled
    })));
    if (force || signature !== this.lastConnectionsSignature) {
      this.lastConnectionsSignature = signature;
      this.post('connections', payload);
    }
    for (const session of this.sessionsById.values()) {
      if (!openConnectionIds.has(session.connectionId)) {
        this.handleConnectionDisconnected(session.connectionId);
      }
    }
  }

  private handleConnectionDisconnected(connectionId: string): void {
    const affected = Array.from(this.sessionsById.values()).filter(item => item.connectionId === connectionId);
    if (affected.length) {
      appendDebugLog(this.output, 'Log Viewer', 'Connection disconnected.', { Connection: connectionId, Sessions: affected.length });
    }
    for (const session of affected) {
      session.status = 'disconnected';
      session.message = 'Connection disconnected. Loaded content is preserved';
      session.continuity = 'Stream interrupted; log continuity is not guaranteed';
      this.stopSession(session.id, true);
      this.post('tabStatus', {
        tabId: session.id,
        status: 'disconnected',
        message: session.message,
        continuity: session.continuity
      });
    }
  }

  private async listLogDirectory(connectionId: string, remotePath: string, requestId: string): Promise<void> {
    const connection = this.assertSftpConnection(connectionId);
    const normalizedPath = normalizeRemotePath(remotePath || connection.startPath || '/');
    const timer = createPerformanceTimer();
    appendDebugLog(this.output, 'Log Viewer', 'Listing log directory.', { Connection: connection.name, Path: normalizedPath });

    try {
      const entries = await this.sessions.listDirectory(connection.id, normalizedPath);
      const visibleEntries = entries
        .filter(entry => entry.name !== '.' && entry.name !== '..')
        .map(entry => {
          const effectiveType = entry.effectiveType || entry.type;
          return {
            name: entry.name,
            path: entry.path || normalizeRemotePath(`${normalizedPath}/${entry.name}`),
            type: effectiveType === 'directory' ? 'directory' : 'file',
            size: entry.size || 0,
            modified: entry.modifyTime || 0
          };
        })
        .filter(entry => entry.type === 'directory' || entry.type === 'file')
        .sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

      this.post('logDirectoryList', {
        requestId,
        connectionId: connection.id,
        path: normalizedPath,
        parentPath: normalizedPath === '/' ? '' : dirnameRemotePath(normalizedPath),
        entries: visibleEntries
      });
      appendPerformanceLog(this.output, 'Log Viewer', `Listed log directory in ${timer()}ms.`, {
        Connection: connection.name,
        Path: normalizedPath,
        Entries: visibleEntries.length
      });
    } catch (error) {
      this.post('logDirectoryList', {
        requestId,
        connectionId: connection.id,
        path: normalizedPath,
        parentPath: normalizedPath === '/' ? '' : dirnameRemotePath(normalizedPath),
        entries: [],
        error: this.formatError(error)
      });
      appendDebugLog(this.output, 'Log Viewer', 'Log directory listing failed.', {
        Connection: connection.name,
        Path: normalizedPath,
        Error: this.formatError(error)
      });
      appendPerformanceLog(this.output, 'Log Viewer', `Log directory listing failed in ${timer()}ms.`, {
        Connection: connection.name,
        Path: normalizedPath,
        Error: this.formatError(error)
      });
    }
  }

  private getAllLogFavorites(): Record<string, string[]> {
    const stored = this.context.globalState.get<Record<string, string[]>>(LOG_VIEWER_FAVORITES_KEY, {});
    return stored && typeof stored === 'object' ? stored : {};
  }

  private getLogFavorites(connectionId: string): string[] {
    if (!connectionId) {
      return [];
    }
    const allFavorites = this.getAllLogFavorites();
    const paths = Array.isArray(allFavorites[connectionId]) ? allFavorites[connectionId] : [];
    const normalized: string[] = [];
    for (const path of paths) {
      const normalizedPath = normalizeRemotePath(String(path || ''));
      if (normalizedPath && normalizedPath !== '/' && !normalized.includes(normalizedPath)) {
        normalized.push(normalizedPath);
      }
    }
    return normalized;
  }

  private async saveLogFavorites(connectionId: string, favorites: string[]): Promise<void> {
    if (!connectionId) {
      return;
    }
    const allFavorites = this.getAllLogFavorites();
    const normalized = favorites
      .map(path => normalizeRemotePath(String(path || '')))
      .filter(path => path && path !== '/');
    allFavorites[connectionId] = Array.from(new Set(normalized));
    await this.context.globalState.update(LOG_VIEWER_FAVORITES_KEY, allFavorites);
    this.post('logFavorites', { connectionId, favorites: allFavorites[connectionId] });
    this.post('connections', this.buildConnectionsPayload(connectionId));
  }

  private async toggleLogFavorite(connectionId: string, remotePath: string): Promise<void> {
    this.assertSftpConnection(connectionId);
    const normalizedPath = normalizeRemotePath(remotePath || '');
    if (!normalizedPath || normalizedPath === '/') {
      throw new Error('Enter a remote file before adding it to Log Viewer favorites');
    }
    const favorites = this.getLogFavorites(connectionId);
    const existingIndex = favorites.findIndex(item => normalizeRemotePath(item) === normalizedPath);
    if (existingIndex >= 0) {
      favorites.splice(existingIndex, 1);
      appendDebugLog(this.output, 'Log Viewer', 'Removed log favorite.', { Connection: connectionId, Path: normalizedPath });
    } else {
      favorites.push(normalizedPath);
      appendDebugLog(this.output, 'Log Viewer', 'Added log favorite.', { Connection: connectionId, Path: normalizedPath });
    }
    await this.saveLogFavorites(connectionId, favorites);
  }

  private async removeLogFavorite(connectionId: string, remotePath: string): Promise<void> {
    this.assertSftpConnection(connectionId);
    const normalizedPath = normalizeRemotePath(remotePath || '');
    const favorites = this.getLogFavorites(connectionId).filter(item => normalizeRemotePath(item) !== normalizedPath);
    await this.saveLogFavorites(connectionId, favorites);
    appendDebugLog(this.output, 'Log Viewer', 'Removed log favorite.', { Connection: connectionId, Path: normalizedPath });
  }

  private buildConnectionsPayload(activeConnectionId?: string): any {
    return {
      activeConnectionId,
      connections: this.sessions.listConnections()
        .filter(connection => isSftpConnectionType(connection.connectionType))
        .map(connection => this.toConnectionView(connection))
    };
  }

  private toConnectionView(connection: ActiveConnection): any {
    return {
      id: connection.id,
      name: connection.name,
      host: connection.host,
      username: connection.username,
      connectionType: connection.connectionType,
      sudoModeEnabled: this.sessions.isSudoModeEnabled(connection.id),
      logFavorites: this.getLogFavorites(connection.id)
    };
  }

  private buildTabId(connectionId: string, remotePath: string): string {
    return `${connectionId}:${normalizeRemotePath(remotePath)}`;
  }

  private buildDraftTabId(connectionId: string): string {
    return `${connectionId}:draft:${Date.now()}`;
  }

  private buildTailCommand(remotePath: string, initialLines: number): string {
    const quotedPath = shellQuote(normalizeRemotePath(remotePath));
    const safeLines = Math.max(1, Math.min(5000, Math.floor(initialLines || INITIAL_TAIL_LINES)));
    return [
      `__remote_edit_log_path=${quotedPath}`,
      `__remote_edit_tail_lines=${safeLines}`,
      'if [ ! -r "$__remote_edit_log_path" ]; then',
      '  printf "%s\\n" "Remote Edit Log Viewer: attempting to open path; permission or existence errors may appear below." >&2',
      'fi',
      'printf "%s\\n" "--- started with tail -F; log rotation handling is supported when available ---"',
      'tail -n "$__remote_edit_tail_lines" -F "$__remote_edit_log_path"',
      '__remote_edit_tail_status=$?',
      'if [ "$__remote_edit_tail_status" -eq 0 ]; then exit 0; fi',
      'printf "%s\\n" "--- tail -F exited; retrying with portable tail -f; log rotation handling may be limited ---"',
      'tail -n "$__remote_edit_tail_lines" -f "$__remote_edit_log_path"',
      '__remote_edit_tail_status=$?',
      'if [ "$__remote_edit_tail_status" -eq 0 ]; then exit 0; fi',
      'printf "%s\\n" "--- portable tail -f exited; retrying with legacy tail syntax; log rotation handling may be limited ---"',
      'exec tail -"$__remote_edit_tail_lines" -f "$__remote_edit_log_path"'
    ].join('\n');
  }

  private post(type: string, payload: any): void {
    if (!this.panel || this.isDisposed) {
      return;
    }

    if (!this.webviewReady) {
      this.pendingMessages.push({ type, payload });
      return;
    }

    void this.panel.webview.postMessage({ type, payload });
  }

  private flushPendingMessages(): void {
    if (!this.panel || !this.webviewReady) {
      return;
    }

    const messages = this.pendingMessages.splice(0, this.pendingMessages.length);
    for (const message of messages) {
      void this.panel.webview.postMessage(message);
    }
  }

  private showError(error: unknown): void {
    const message = this.formatError(error);
    appendOutputLog(this.output, 'WARN', `Log Viewer: ${message}`);
    this.post('error', { message, showOutputLink: true });
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error || 'Unknown error');
  }

  private logDebug(message: string): void {
    appendDebugLog(this.output, 'Log Viewer webview', message);
  }

  private logPerformance(operation: string, durationMs: number, details?: Record<string, unknown>): void {
    appendPerformanceLog(this.output, 'Log Viewer webview', `${operation} in ${durationMs}ms.`, details as any || {});
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Remote Edit Log Viewer</title>
<style>
:root{--remoteedit-validation-error:#b94a48;--re-border:var(--vscode-panel-border);--re-bg:var(--vscode-editor-background);--re-side:var(--vscode-sideBar-background,var(--vscode-editor-background));--re-active-tab-bg:var(--vscode-sideBar-background,var(--vscode-editor-background));--re-fg:var(--vscode-foreground);--re-muted:var(--vscode-descriptionForeground);--re-input-bg:var(--vscode-input-background);--re-input-fg:var(--vscode-input-foreground);--re-warn:var(--vscode-inputValidation-warningForeground,#c19c00);--re-error:var(--vscode-inputValidation-errorForeground,var(--vscode-errorForeground,#ff8a80));}
*{box-sizing:border-box}*{scrollbar-width:thin;scrollbar-color:var(--vscode-scrollbarSlider-background) transparent;}*::-webkit-scrollbar{width:6px;height:6px;}*::-webkit-scrollbar-track{background:transparent;}*::-webkit-scrollbar-thumb{background-color:var(--vscode-scrollbarSlider-background);border-radius:6px;border:2px solid transparent;background-clip:padding-box;}*::-webkit-scrollbar-thumb:hover{background-color:var(--vscode-scrollbarSlider-hoverBackground);}*::-webkit-scrollbar-thumb:active{background-color:var(--vscode-scrollbarSlider-activeBackground);}*::-webkit-scrollbar-corner{background:transparent;}html,body{height:100%;}body{margin:0;background:var(--re-bg);color:var(--re-fg);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);overflow:hidden;user-select:none;-webkit-user-select:none;}input,textarea,select{user-select:text;-webkit-user-select:text;}button{min-height:31px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:6px 12px;border-radius:3px;cursor:pointer;white-space:nowrap;font-family:inherit;font-size:inherit;}button:hover:not(:disabled){background:var(--vscode-button-hoverBackground);}button:disabled{cursor:default;opacity:.55;}button.secondary{background:var(--vscode-button-secondaryBackground,var(--vscode-input-background));color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));border:1px solid var(--vscode-button-border,var(--vscode-input-border,var(--vscode-panel-border)));}button.secondary:hover:not(:disabled){background:var(--vscode-button-secondaryHoverBackground,var(--vscode-list-hoverBackground));}button.icon-only{min-width:32px;width:32px;height:32px;min-height:32px;padding:4px;display:inline-flex;align-items:center;justify-content:center;line-height:0;}input[type="text"],input:not([type]),select{height:31px;color:var(--re-input-fg);background:var(--re-input-bg);border:1px solid var(--vscode-input-border,transparent);border-radius:3px;padding:4px 8px;outline:none;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);}input:focus,select:focus{border-color:var(--vscode-focusBorder);}input.input-invalid{border-color:var(--remoteedit-validation-error);}input.input-invalid:focus{border-color:var(--remoteedit-validation-error);outline:none;box-shadow:none;}.checkbox-row{display:inline-flex;align-items:center;gap:8px;color:var(--vscode-foreground);font-size:12px;white-space:nowrap;}.checkbox-row input[type="checkbox"]{appearance:none;-webkit-appearance:none;position:relative;flex:0 0 auto;width:14px;min-width:14px;height:14px;min-height:14px;margin:0;padding:0;border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:3px;background:var(--vscode-input-background);color:var(--vscode-button-foreground);cursor:pointer;}.checkbox-row input[type="checkbox"]:checked{background:var(--vscode-button-background);border-color:var(--vscode-button-background);}.checkbox-row input[type="checkbox"]:checked::after{content:'';position:absolute;left:50%;top:40%;width:3.5px;height:7px;border:solid var(--vscode-button-foreground);border-width:0 1.5px 1.5px 0;transform:translate(-50%,-50%) rotate(45deg);transform-origin:center;}.checkbox-row input[type="checkbox"]:focus,.checkbox-row input[type="checkbox"]:focus-visible{outline:none;box-shadow:none;border-color:var(--vscode-input-border,var(--vscode-panel-border));}.checkbox-row input[type="checkbox"]:checked:focus,.checkbox-row input[type="checkbox"]:checked:focus-visible{border-color:var(--vscode-button-background);}.checkbox-row input[type="checkbox"]:disabled{opacity:.68;cursor:default;}.app{height:100%;display:flex;flex-direction:column;min-height:0;margin:0 -9px;width:calc(100% + 18px);}.title{font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.title-in-tabs{height:34px;min-height:34px;display:inline-flex;align-items:center;flex:0 0 auto;padding:0 14px 0 12px;color:var(--vscode-foreground);border-bottom:1px solid transparent;}.header-right{display:none;}.context-label{display:none;}.browser-session-strip{height:35px;min-height:35px;display:flex;align-items:flex-end;background:var(--re-side);overflow:hidden;border-bottom:0;position:relative;z-index:2;}.session-tabs{position:relative;display:flex;gap:0;align-items:flex-end;min-width:0;flex:0 1 auto;height:100%;overflow-x:auto;overflow-y:hidden;}.session-tabs.empty{align-items:flex-end;overflow-x:hidden;flex:0 0 auto;width:auto;}.session-empty{display:inline-flex;align-items:center;height:100%;padding:0 10px;color:var(--re-muted);font-size:12px;}.session-tab{display:inline-flex;align-items:center;justify-content:flex-start;gap:7px;height:34px;min-height:34px;min-width:112px;max-width:220px;border:1px solid var(--vscode-panel-border);border-bottom:0;background:var(--vscode-editor-background);color:var(--vscode-tab-inactiveForeground,var(--vscode-foreground));border-radius:0;padding:0 7px 0 10px;cursor:pointer;white-space:nowrap;line-height:normal;font-size:12px;flex:0 0 auto;overflow:hidden;}.session-tab:hover:not(:disabled){background:var(--vscode-tab-hoverBackground,var(--vscode-list-hoverBackground));border-color:var(--vscode-panel-border);color:var(--vscode-foreground);}.session-tab+.session-tab{margin-left:-1px;}.session-tab.active{position:relative;z-index:4;border:1px solid var(--vscode-panel-border);border-bottom:0;background:var(--re-active-tab-bg);color:var(--vscode-tab-activeForeground,var(--vscode-foreground));box-shadow:none;}.session-tab.active::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:var(--vscode-tab-activeBorderTop,var(--vscode-focusBorder));border-radius:0;pointer-events:none;}.session-tab.active:hover:not(:disabled){background:var(--re-active-tab-bg);border-color:var(--vscode-panel-border);color:var(--vscode-tab-activeForeground,var(--vscode-foreground));}.session-tab.dragging{opacity:.58;}.session-tab-drop-line{position:absolute;bottom:0;width:1px;height:33px;background:var(--vscode-focusBorder);display:none;pointer-events:none;z-index:12;transform:none;}.session-tab-title{display:flex;flex:1 1 auto;min-width:0;overflow:hidden;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px;line-height:1.05;}.session-tab-filename,.session-tab-connection{display:block;max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.session-tab-filename{font-size:12px;line-height:1.08;color:inherit;}.session-tab-connection{font-size:9.5px;line-height:1.05;color:var(--vscode-descriptionForeground);opacity:.76;font-weight:400;}.session-tab.active .session-tab-connection{opacity:.86;}.session-tab-badge{position:relative;width:12px;min-width:12px;height:12px;min-height:12px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;color:var(--re-muted);font-size:11px;line-height:1;}.session-tab-badge.badge-count{width:auto;min-width:14px;height:auto;min-height:0;color:var(--re-muted);}.session-tab-badge.badge-running::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;}.session-tab-badge.badge-stopped::before{content:'';width:8px;height:8px;border-radius:1px;background:currentColor;}.session-tab-badge.badge-paused::before,.session-tab-badge.badge-paused::after{content:'';position:absolute;top:2px;width:3px;height:8px;border-radius:1px;background:currentColor;}.session-tab-badge.badge-paused::before{left:2px;}.session-tab-badge.badge-paused::after{right:2px;}.session-tab-badge.badge-error{font-weight:650;color:var(--re-error);}.session-tab-close{position:relative;width:20px;min-width:20px;height:20px;min-height:20px;display:inline-flex;align-items:center;justify-content:center;padding:0;margin:0 -3px 0 0;border:0;border-radius:3px;background:transparent;color:inherit;opacity:.72;line-height:0;font-size:0;font-weight:400;transform:none;flex:0 0 auto;}.session-tab-close::before,.session-tab-close::after{content:'';position:absolute;left:50%;top:50%;width:11px;height:1px;background:currentColor;transform-origin:center;}.session-tab-close::before{transform:translate(-50%,-50%) rotate(45deg);}.session-tab-close::after{transform:translate(-50%,-50%) rotate(-45deg);}.session-tab-close:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));opacity:1;}.session-tab-new{font-weight:650;width:34px;min-width:34px;max-width:34px;padding:0;justify-content:center;flex:0 0 34px;align-self:flex-end;margin-left:0;z-index:9;display:inline-flex;}.session-tabs:not(.empty)+.session-tab-new{margin-left:-1px;}.session-tabs.empty+.session-tab-new{margin-left:0;display:inline-flex;visibility:visible;opacity:1;}.browser-section-divider{position:relative;z-index:1;height:1px;background-color:var(--re-active-tab-bg);background-image:linear-gradient(to right,var(--vscode-panel-border) 0,var(--vscode-panel-border) var(--active-tab-left,0px),transparent var(--active-tab-left,0px),transparent calc(var(--active-tab-left,0px) + var(--active-tab-width,0px)),var(--vscode-panel-border) calc(var(--active-tab-left,0px) + var(--active-tab-width,0px)),var(--vscode-panel-border) 100%);flex:0 0 auto;} .browser-open-section{position:relative;z-index:2;display:flex;align-items:center;gap:10px;height:46px;min-height:46px;max-height:46px;padding:6px 10px;background:var(--vscode-editor-background);flex:0 0 46px;overflow:hidden;}.browser-open-text-row{display:flex;align-items:center;flex:0 0 auto;min-width:0;max-width:45%;}.browser-open-text{min-width:0;max-width:100%;}.card-title{font-weight:650;color:var(--vscode-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.card-subtitle{margin-top:3px;color:var(--vscode-descriptionForeground);font-size:11px;font-weight:400;line-height:1.3;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.open-connections-row{display:flex;align-items:flex-end;align-self:flex-end;flex:1 1 0;min-width:34px;min-height:0;height:35px;margin-bottom:-7px;overflow:hidden;justify-content:flex-start;}.browser-open-section .browser-session-strip{margin-top:0;min-height:35px;height:35px;padding:0;display:flex;flex:1 1 auto;min-width:34px;max-width:100%;justify-content:flex-start;align-items:flex-end;border-bottom:0;overflow:hidden;background:transparent;}.browser-open-section .session-tabs{align-items:flex-end;height:35px;min-width:0;overflow-x:auto;overflow-y:hidden;gap:0;flex:0 1 auto;max-width:calc(100% - 34px);}.browser-open-section .session-tabs.empty{align-items:flex-end;overflow:hidden;flex:0 0 0;width:0;min-width:0;max-width:0;}.tab-panel{display:flex;flex-direction:column;min-height:0;flex:0 0 auto;}.toolbar,.searchbar{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--re-border);min-height:38px;background:var(--re-active-tab-bg);}.toolbar{position:relative;flex-wrap:nowrap;}.toolbar #followButton,.toolbar #pauseButton,.toolbar #clearButton,.toolbar #copyButton{width:72px;min-width:72px;max-width:72px;padding-left:8px;padding-right:8px;text-align:center;}.searchbar{flex-wrap:nowrap;overflow:hidden;justify-content:space-between;align-items:center;position:relative;z-index:20;}.connection-picker{position:relative;flex:0 1 220px;min-width:150px;max-width:240px;}.connection-picker.open .profile-dropdown-chevron{transform:rotate(180deg);}.connection-picker.open .profile-dropdown-menu{display:block;}.connection-select-native{display:none!important;}.path-label{display:none;}.remote-file-field{position:relative;display:flex;align-items:center;flex:1 1 360px;min-width:260px;}.remote-file-field input.path-input{width:100%;min-width:0;flex:1;background:var(--vscode-input-background);padding-right:98px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.path-input:disabled{opacity:.68;}.remote-file-buttons{position:absolute;top:2px;right:2px;display:inline-flex;align-items:center;gap:1px;height:27px;}.remote-path-favorite-button{width:30px;min-width:30px;height:27px;min-height:27px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:2px;border:0;border-left:1px solid var(--vscode-input-border,var(--vscode-panel-border));background:transparent;color:var(--vscode-input-foreground);opacity:.82;line-height:1;}.remote-path-favorite-button svg{width:25px;height:25px;display:block;fill:currentColor;stroke:none;pointer-events:none;}.remote-path-favorite-button.file-picker-button svg{width:15px;height:15px;}.remote-path-favorite-button .filled-star-icon,.remote-path-favorite-button .filled-hotel-class-icon{display:none;}.remote-path-favorite-button.active .star-icon{display:none;}.remote-path-favorite-button.active .filled-star-icon{display:block;}.remote-path-favorite-button.has-favorites .hotel-class-icon{display:none;}.remote-path-favorite-button.has-favorites .filled-hotel-class-icon{display:block;}.remote-path-favorite-button:hover:not(:disabled){opacity:1;background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));}.remote-path-favorite-button.active,.remote-path-favorite-button.has-favorites{opacity:1;}.remote-path-favorite-button:disabled{cursor:default;opacity:.42;}.remote-path-favorites-popover{position:absolute;top:calc(100% + 4px);right:0;z-index:90;display:none;width:min(520px,100%);max-height:240px;overflow-y:auto;overflow-x:hidden;padding:6px;border:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));border-radius:5px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));color:var(--vscode-editorWidget-foreground,var(--vscode-foreground));box-shadow:0 8px 22px rgba(0,0,0,.35);}.remote-path-favorites-popover.visible{display:block;}.remote-path-favorites-title{padding:4px 7px 6px;font-size:12px;font-weight:650;color:var(--vscode-descriptionForeground);}.remote-path-favorites-empty{padding:8px 7px;color:var(--vscode-descriptionForeground);font-size:12px;line-height:1.35;}.remote-path-favorite-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px;align-items:center;}.remote-path-favorite-path{min-height:28px;padding:5px 7px;border:0;border-radius:3px;background:transparent;color:inherit;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.remote-path-favorite-path:hover:not(:disabled){background:var(--vscode-list-hoverBackground);}.remote-path-favorite-remove{width:26px;min-width:26px;height:26px;min-height:26px;padding:0;border:0;border-radius:3px;background:transparent;color:var(--vscode-descriptionForeground);font-size:16px;line-height:1;}.remote-path-favorite-remove:hover:not(:disabled){background:var(--vscode-list-hoverBackground);color:var(--vscode-errorForeground,var(--vscode-foreground));}.search-options{display:flex;align-items:center;gap:10px;min-width:auto;flex:0 0 auto;overflow:visible;white-space:nowrap;}.search-options>*{flex:0 0 auto;}.search-field{display:flex;align-items:center;gap:8px;margin-left:auto;justify-content:flex-end;width:min(520px,42vw);min-width:260px;max-width:520px;flex:0 0 auto;overflow:hidden;}.search-box{position:relative;display:flex;align-items:center;min-width:0;max-width:330px;flex:1 1 auto;}.search-box input.search-input{width:100%;min-width:0;padding-right:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.search-inline-controls{position:absolute;right:3px;top:2px;height:27px;display:inline-flex;align-items:center;gap:2px;}.search-toggle-button{width:25px;min-width:25px;height:25px;min-height:25px;padding:0;border:0;border-radius:2px;background:transparent;color:var(--vscode-input-foreground);opacity:.78;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:650;line-height:1;}.search-toggle-button:hover:not(:disabled){opacity:1;background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));}.search-toggle-button.active{opacity:1;background:var(--vscode-toolbar-activeBackground,var(--vscode-list-activeSelectionBackground));color:var(--vscode-toolbar-activeForeground,var(--vscode-list-activeSelectionForeground,var(--vscode-foreground)));}.search-toggle-icon{width:14px;height:14px;display:block;fill:currentColor;stroke:none;}.search-count{max-width:52px;color:var(--re-muted);font-size:10.5px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px;border-left:1px solid var(--vscode-input-border,var(--vscode-panel-border));}.search-inline-button{width:24px;min-width:24px;height:25px;min-height:25px;padding:0;border:0;border-left:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:2px;background:transparent;color:var(--vscode-input-foreground);display:inline-flex;align-items:center;justify-content:center;}.search-inline-button:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));}.font-size-controls{display:inline-flex;align-items:center;width:98px;min-width:98px;max-width:98px;height:31px;border:1px solid var(--vscode-input-border,transparent);border-radius:3px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);overflow:hidden;flex:0 0 98px;}.font-size-button{width:26px;min-width:26px;max-width:26px;flex:0 0 26px;height:29px;min-height:29px;padding:0;border:0;border-radius:0;background:transparent;color:inherit;display:inline-flex;align-items:center;justify-content:center;font-weight:650;}.font-size-button:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));}.font-size-label{width:44px;min-width:44px;max-width:44px;flex:0 0 44px;height:29px;min-height:29px;display:inline-flex;align-items:center;justify-content:center;text-align:center;color:var(--re-muted);font-size:11px;line-height:1;padding:0 5px;border-left:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-right:1px solid var(--vscode-input-border,var(--vscode-panel-border));cursor:pointer;}.font-size-label:hover{background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));color:var(--vscode-input-foreground);}.font-size-label:focus,.font-size-label:focus-visible{outline:none;background:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));color:var(--vscode-input-foreground);}.json-option{display:inline-flex;align-items:center;gap:6px;color:var(--vscode-foreground);font-size:12px;white-space:nowrap;}.json-select-native{display:none!important;}.json-picker{position:relative;width:82px;min-width:82px;}.json-picker .profile-dropdown-menu{position:fixed;left:0;top:0;right:auto;width:82px;z-index:10010;}.profile-dropdown-button{width:100%;height:31px;min-height:31px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:5px 7px 5px 8px;border:1px solid var(--vscode-input-border,transparent);border-radius:3px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);text-align:left;}.profile-dropdown-button:hover:not(:disabled){background:var(--vscode-input-background);border-color:var(--vscode-focusBorder);}.profile-dropdown-button:focus{outline:none;border-color:var(--vscode-focusBorder);}.profile-dropdown-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.profile-dropdown-chevron{width:15px;height:15px;display:block;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;fill:none;opacity:.78;transition:transform 120ms ease;}.json-picker.open .profile-dropdown-chevron,.connection-picker.open .profile-dropdown-chevron{transform:rotate(180deg);}.profile-dropdown-menu{position:absolute;z-index:300;top:calc(100% + 4px);left:0;right:0;display:none;width:100%;box-sizing:border-box;max-height:170px;overflow-y:auto;overflow-x:hidden;padding:5px;border:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));border-radius:5px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));color:var(--vscode-editorWidget-foreground,var(--vscode-foreground));box-shadow:0 8px 22px rgba(0,0,0,.35);}.json-picker.open .profile-dropdown-menu,.connection-picker.open .profile-dropdown-menu{display:block;}.profile-dropdown-item{width:100%;min-height:34px;display:grid;grid-template-columns:minmax(0,1fr);gap:2px;align-items:center;padding:6px 7px;border:0;border-radius:3px;background:transparent;color:inherit;text-align:left;}.profile-dropdown-item:hover:not(:disabled){background:var(--vscode-list-hoverBackground);}.profile-dropdown-item.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);}.profile-dropdown-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.profile-dropdown-meta{color:var(--vscode-descriptionForeground);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.profile-dropdown-item.selected .profile-dropdown-meta{color:inherit;opacity:.78;}.content{flex:1;min-height:0;overflow:auto;font-family:var(--vscode-editor-font-family,monospace);font-size:var(--log-font-size,var(--vscode-editor-font-size,12px));line-height:1.45;position:relative;background:var(--vscode-editor-background);display:block;align-content:flex-start;justify-content:flex-start;padding:6px 8px;user-select:text;-webkit-user-select:text;}.empty{padding:28px 8px;color:var(--re-muted);text-align:center;user-select:none;-webkit-user-select:none;}.background-buffer-warning{margin:4px 6px 8px;padding:6px 8px;border:1px solid var(--vscode-inputValidation-warningBorder,var(--vscode-panel-border));border-radius:4px;background:var(--vscode-inputValidation-warningBackground,rgba(255,200,0,.08));color:var(--vscode-inputValidation-warningForeground,var(--vscode-descriptionForeground));font-family:var(--vscode-font-family);font-size:12px;line-height:1.35;white-space:normal;user-select:text;-webkit-user-select:text;}.line{display:flex;min-height:19px;white-space:pre;}.line.wrap{white-space:pre-wrap;}.ln{box-sizing:content-box;flex:0 0 auto;width:var(--line-number-gutter,2ch);min-width:var(--line-number-gutter,2ch);text-align:right;color:var(--re-muted);padding-right:1ch;user-select:none;}.txt{flex:1;min-width:0;user-select:text;-webkit-user-select:text;}.line.level-error .txt{color:var(--vscode-errorForeground,#ff8a80);}.line.level-warn .txt{color:var(--vscode-inputValidation-warningForeground,#ffd866);}.line.level-info .txt{color:var(--vscode-charts-blue,#9cdcfe);}.line.level-debug .txt{color:var(--vscode-charts-green,#b5cea8);}.line.marker .txt{color:var(--re-warn);font-style:italic;}.line.stderr .txt{color:var(--re-error);}.match{background:var(--vscode-editor-findMatchHighlightBackground,rgba(234,92,0,.33));outline:1px solid var(--vscode-editor-findMatchBorder,transparent);}.json-row{display:grid;grid-template-columns:130px 72px 120px minmax(0,1fr);gap:8px;}.json-level{font-weight:650;}.status{height:26px;min-height:26px;display:grid;grid-template-columns:112px 132px 104px minmax(0,1fr);align-items:center;column-gap:18px;border-top:1px solid var(--re-border);padding:0 10px;color:var(--re-muted);white-space:nowrap;overflow:hidden;font-size:12px;}.status-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.status-cell.status-main{color:var(--vscode-foreground);font-weight:500;}.status-cell.status-info{color:var(--vscode-descriptionForeground);}.status.error .status-main,.status.error .status-info{color:var(--re-error);}.hidden{display:none!important;}.new-lines{position:absolute;right:16px;bottom:16px;border-radius:14px;}.file-picker-popover{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:80;border:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));border-radius:5px;background:var(--vscode-input-background,var(--vscode-sideBar-background));overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.28);font-size:11px;}.file-picker-popover.hidden{display:none;}.file-picker-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background,var(--vscode-input-background));}.file-picker-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground);font-size:11px;}.file-picker-actions{display:flex;gap:6px;flex:0 0 auto;}.file-picker-actions button{min-height:24px;padding:3px 8px;font-size:11px;}.file-picker-list{max-height:180px;overflow:auto;padding:3px 0;}.file-picker-empty{padding:8px 10px;color:var(--vscode-descriptionForeground);font-size:11px;}.file-picker-empty.error{color:var(--remoteedit-validation-error);}.file-picker-item{display:flex;align-items:center;gap:6px;width:100%;min-height:24px;border:0;background:transparent;color:var(--vscode-foreground);text-align:left;padding:3px 9px;cursor:pointer;font:inherit;font-size:11px;}.file-picker-item:hover{background:var(--vscode-list-hoverBackground);}.file-picker-item-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.file-picker-item-path{margin-left:auto;min-width:0;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground);}.file-picker-item.file-selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);}.file-picker-item.file-selected .file-picker-item-path{color:inherit;opacity:.78;}.context-menu{position:fixed;z-index:10020;width:156px;padding:4px;border:1px solid var(--vscode-menu-border,var(--vscode-panel-border));border-radius:4px;background:var(--vscode-menu-background,var(--vscode-editorWidget-background));color:var(--vscode-menu-foreground,var(--vscode-editorWidget-foreground));box-shadow:0 8px 22px rgba(0,0,0,.35);display:none;}.context-menu.visible{display:block;}.context-menu button{width:100%;box-sizing:border-box;min-height:28px;padding:5px 9px;text-align:left;white-space:nowrap;background:transparent;color:inherit;border:0;border-radius:3px;}.context-menu button:hover:not(:disabled){background:var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground));color:var(--vscode-menu-selectionForeground,inherit);}.context-menu button:disabled{opacity:.45;}.context-menu-separator{height:1px;margin:4px 3px;background:var(--vscode-menu-separatorBackground,var(--vscode-panel-border));opacity:.9;}.confirm-dialog-backdrop{position:fixed;inset:0;z-index:10030;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.45);}.confirm-dialog-backdrop.visible{display:flex;}.confirm-dialog{width:min(520px,100%);max-height:calc(100vh - 48px);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));border-radius:8px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));color:var(--vscode-editorWidget-foreground,var(--vscode-foreground));box-shadow:0 18px 54px rgba(0,0,0,.45);}.confirm-dialog-header{padding:16px 18px 12px;border-bottom:1px solid var(--vscode-panel-border);}.confirm-dialog-title{margin:0 0 5px;font-size:18px;font-weight:650;}.confirm-dialog-subtitle{color:var(--vscode-descriptionForeground);font-size:11px;font-weight:400;line-height:1.3;margin-top:3px;opacity:.85;overflow-wrap:anywhere;}.confirm-dialog-body{padding:15px 18px;display:grid;gap:12px;overflow:auto;}.confirm-dialog-details{margin:0;padding:10px 12px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-input-background);color:var(--vscode-descriptionForeground);font-family:var(--vscode-editor-font-family,monospace);font-size:12px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;-webkit-user-select:text;}.confirm-dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:0 18px 16px;}.webview-tooltip{position:fixed;z-index:10000;max-width:min(360px,calc(100vw - 24px));padding:4px 7px;border-radius:3px;background:var(--vscode-editorWidget-background);color:var(--vscode-editorWidget-foreground);border:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));box-shadow:0 2px 8px rgba(0,0,0,.28);font-size:12px;line-height:1.25;white-space:nowrap;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(2px);transition:opacity 80ms ease,transform 80ms ease;}.webview-tooltip.visible{opacity:1;visibility:visible;transform:translateY(0);}/* Remove native browser/VS Code focus rings from webview controls. Remote Edit uses hover/active styles instead. */
*:focus,*:focus-visible{outline:none!important;}
button:focus,button:focus-visible,[role='button']:focus,[role='button']:focus-visible,a:focus,a:focus-visible,.session-tab:focus,.session-tab:focus-visible,.session-tab-close:focus,.session-tab-close:focus-visible,.dialog-checkbox:focus,.dialog-checkbox:focus-visible,.checkbox-row input[type='checkbox']:focus,.checkbox-row input[type='checkbox']:focus-visible,.search-toggle-button:focus,.search-toggle-button:focus-visible,.search-inline-button:focus,.search-inline-button:focus-visible,.font-size-label:focus,.font-size-label:focus-visible{outline:none!important;box-shadow:none!important;}</style>
</head>
<body>
<div class="app">
  <div class="browser-open-section" aria-label="Log Viewer Sessions">
    <div class="browser-open-text-row">
      <div class="browser-open-text">
        <div class="card-title">Log Viewer</div>
        <div class="card-subtitle">Remote log file sessions</div>
      </div>
    </div>
    <div class="open-connections-row">
      <div class="session-strip browser-session-strip">
        <div id="tabs" class="session-tabs empty"><span class="session-tab-drop-line"></span></div>
        <button id="newLogTabButton" class="session-tab session-tab-new" type="button" data-new-tab="1" data-tooltip="New log tab" aria-label="New log tab">+</button>
      </div>
    </div>
  </div>
  <div id="browserSectionDivider" class="browser-section-divider"></div>
  <div id="main" class="tab-panel hidden">
    <div class="toolbar">
      <div id="connectionPicker" class="connection-picker">
        <button id="connectionDropdownButton" type="button" class="profile-dropdown-button" aria-haspopup="listbox" aria-expanded="false" data-tooltip="Open SSH/SFTP connection">
          <span id="connectionDropdownLabel" class="profile-dropdown-label">Connection</span>
          <svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg>
        </button>
        <div id="connectionDropdownMenu" class="profile-dropdown-menu connection-dropdown-menu" role="listbox" aria-label="Open SSH/SFTP connection"></div>
        <select id="connectionSelect" class="connection-select-native" tabindex="-1" aria-hidden="true"></select>
      </div>
      <div class="remote-file-field">
        <input id="pathInput" class="path-input" placeholder="/var/log/nginx/error.log">
        <div class="remote-file-buttons" aria-hidden="false">
          <button id="toggleLogFavoriteButton" class="remote-path-favorite-button" type="button" aria-label="Add Log Favorite" data-tooltip="Add Log Favorite"><svg class="star-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143Zm-61 83.92 49.62-212.54-164.93-142.84 217.23-18.85L480-777.69l85.08 200.38 217.23 18.85-164.93 142.84L667-203.08 480-315.92 293-203.08ZM480-470Z" /></svg><svg class="filled-star-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m293-203.08 49.62-212.54-164.93-142.84 217.23-18.85L480-777.69l85.08 200.38 217.23 18.85-164.93 142.84L667-203.08 480-315.92 293-203.08Z" /></svg></button>
          <button id="logFavoritesButton" class="remote-path-favorite-button" type="button" aria-label="Show Log Favorites" data-tooltip="Show Log Favorites"><svg class="hotel-class-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m620.31-395.38 138.92-120 57.69 5.38-149.84 129.15 44.31 195.47-48.93-29.7-42.15-180.3ZM544-631.23l-38.92-91.85 22.15-54.61 63.54 150.84-46.77-4.38ZM294-287l126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143Zm-61 83.92 49.62-212.54-164.93-142.84 217.23-18.85L420-777.69l85.08 200.38 217.23 18.85-164.93 142.84L607-203.08 420-315.92 233-203.08Zm187-257.69Z" /></svg><svg class="filled-hotel-class-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m620.31-395.38 138.92-120 57.69 5.38-149.84 129.15 44.31 195.47-48.93-29.7-42.15-180.3ZM544-631.23l-38.92-91.85 22.15-54.61 63.54 150.84-46.77-4.38ZM233-203.08l49.62-212.54-164.93-142.84 217.23-18.85L420-777.69l85.08 200.38 217.23 18.85-164.93 142.84L607-203.08 420-315.92 233-203.08Z" /></svg></button>
          <button id="filePickerButton" class="remote-path-favorite-button file-picker-button" type="button" aria-label="Browse Remote File" data-tooltip="Browse Remote File"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg></button>
        </div>
        <div id="logFavoritesPopover" class="remote-path-favorites-popover" aria-hidden="true">
          <div class="remote-path-favorites-title">Favorite files</div>
          <div id="logFavoritesList"></div>
        </div>
        <div id="pickerPopover" class="file-picker-popover hidden" aria-hidden="true">
          <div class="file-picker-header">
            <div id="pickerBrowserPath" class="file-picker-path">/</div>
            <div class="file-picker-actions">
              <button id="pickerCancel" class="secondary" type="button">Cancel</button>
            </div>
          </div>
          <div id="pickerList" class="file-picker-list"><div class="file-picker-empty">Choose a remote file.</div></div>
        </div>
      </div>
      <button id="followButton">Follow</button><button id="pauseButton" class="secondary">Pause</button><button id="clearButton" class="secondary">Clear</button><button id="copyButton" class="secondary">Copy</button><button id="jumpButton" class="secondary">Jump to bottom</button>
    </div>
    <div class="searchbar"><div class="search-options"><div class="json-option">JSON:<span id="jsonPicker" class="json-picker"><button id="jsonDropdownButton" type="button" class="profile-dropdown-button" aria-haspopup="listbox" aria-expanded="false" data-tooltip="JSON log parsing mode"><span id="jsonDropdownLabel" class="profile-dropdown-label">Auto</span><svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg></button><div id="jsonDropdownMenu" class="profile-dropdown-menu" role="listbox" aria-label="JSON log parsing mode"><button type="button" class="profile-dropdown-item selected" role="option" data-json-mode="auto"><span class="profile-dropdown-name">Auto</span></button><button type="button" class="profile-dropdown-item" role="option" data-json-mode="on"><span class="profile-dropdown-name">On</span></button><button type="button" class="profile-dropdown-item" role="option" data-json-mode="off"><span class="profile-dropdown-name">Off</span></button></div><select id="jsonMode" class="json-select-native" tabindex="-1" aria-hidden="true"><option value="auto">Auto</option><option value="on">On</option><option value="off">Off</option></select></span></div><label class="checkbox-row"><input id="highlightToggle" class="dialog-checkbox" type="checkbox" checked>Highlight levels</label><label class="checkbox-row"><input id="wrapToggle" class="dialog-checkbox" type="checkbox">Line wrap</label><label class="checkbox-row"><input id="lineNumbersToggle" class="dialog-checkbox" type="checkbox" checked>Line numbers</label><label class="checkbox-row"><input id="autoScrollToggle" class="dialog-checkbox" type="checkbox" checked>Auto-scroll</label></div><div class="search-field"><div class="search-box"><input id="searchInput" class="search-input" placeholder="Find in loaded file"><div class="search-inline-controls"><span id="searchCount" class="search-count"></span><button id="matchesOnlyToggle" type="button" class="search-toggle-button" data-tooltip="Show matches only" aria-label="Show matches only" aria-pressed="false"><svg class="search-toggle-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12L9 8v4l-2 1V8L2 3z"></path></svg></button><button id="caseToggle" type="button" class="search-toggle-button" data-tooltip="Case sensitive" aria-label="Case sensitive" aria-pressed="false">Aa</button><button id="prevButton" type="button" class="search-inline-button" data-tooltip="Previous match">↑</button><button id="nextButton" type="button" class="search-inline-button" data-tooltip="Next match">↓</button></div></div><div class="font-size-controls" data-tooltip="Log content font size"><button id="fontDecreaseButton" type="button" class="font-size-button" data-tooltip="Decrease log font size" aria-label="Decrease log font size">−</button><span id="fontSizeLabel" class="font-size-label" role="button" tabindex="0" data-tooltip="Reset log font size" aria-label="Reset log font size">13px</span><button id="fontIncreaseButton" type="button" class="font-size-button" data-tooltip="Increase log font size" aria-label="Increase log font size">+</button></div></div></div>
  </div>
  <div id="content" class="content"><div class="empty">Open a log from an SSH/SFTP connection.</div><button id="newLinesButton" class="new-lines hidden"></button></div>
  <div id="status" class="status"><span class="status-cell status-main">No log opened</span><span class="status-cell"></span><span class="status-cell"></span><span class="status-cell status-info"></span></div>
</div>
<div id="closeTabConfirmBackdrop" class="confirm-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="closeTabConfirmTitle" aria-hidden="true">
  <section class="confirm-dialog">
    <header class="confirm-dialog-header"><h2 id="closeTabConfirmTitle" class="confirm-dialog-title">Close log tab?</h2><div id="closeTabConfirmMessage" class="confirm-dialog-subtitle">Closing this tab will remove the loaded log content.</div></header>
    <div class="confirm-dialog-body">
      <pre id="closeTabConfirmDetails" class="confirm-dialog-details"></pre>
    </div>
    <div class="confirm-dialog-actions"><button id="closeTabConfirmCancel" class="secondary" type="button">Cancel</button><button id="closeTabConfirmClose" type="button">Close Tab</button></div>
  </section>
</div>
<div id="binaryLogConfirmBackdrop" class="confirm-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="binaryLogConfirmTitle" aria-hidden="true">
  <section class="confirm-dialog">
    <header class="confirm-dialog-header"><h2 id="binaryLogConfirmTitle" class="confirm-dialog-title">Binary data detected</h2><div id="binaryLogConfirmMessage" class="confirm-dialog-subtitle">This file appears to contain binary data. Opening it in Log Viewer may display incorrectly, affect performance, or cause unexpected issues.</div></header>
    <div class="confirm-dialog-body">
      <pre id="binaryLogConfirmDetails" class="confirm-dialog-details"></pre>
    </div>
    <div class="confirm-dialog-actions"><button id="binaryLogConfirmCancel" class="secondary" type="button">Cancel</button><button id="binaryLogConfirmOpen" type="button">Open anyway</button></div>
  </section>
</div>
<div id="webviewTooltip" class="webview-tooltip" role="tooltip" aria-hidden="true"></div>
<div id="textContextMenu" class="context-menu" role="menu" aria-label="Text Actions"><button id="textContextUndo" type="button" role="menuitem">Undo</button><button id="textContextRedo" type="button" role="menuitem">Redo</button><div class="context-menu-separator" role="separator"></div><button id="textContextCut" type="button" role="menuitem">Cut</button><button id="textContextCopy" type="button" role="menuitem">Copy</button><button id="textContextPaste" type="button" role="menuitem">Paste</button><div class="context-menu-separator" role="separator"></div><button id="textContextSelectAll" type="button" role="menuitem">Select All</button></div>
<div id="logContextMenu" class="context-menu" role="menu" aria-label="Log Content Actions"><button id="logContextCopy" type="button" role="menuitem">Copy</button></div>
<script nonce="${nonce}">
(function(){
const vscode=acquireVsCodeApi();
const MAX_LINES=${MAX_LINES_PER_TAB};const MAX_PAUSED=${MAX_PAUSED_BUFFER_LINES};const MAX_RENDER=3000;const DEFAULT_LOG_FONT_SIZE=12;
const state={connections:[],activeConnectionId:'',tabs:[],activeTabId:'',config:{},picker:{visible:false,connectionId:'',path:'/var/log',entries:[],parentPath:'',loading:false,error:'',requestId:0},drag:{id:'',index:-1},closeConfirm:{tabId:''},binaryConfirm:{requestId:''},globalMessage:'',globalError:false};
const els={contextLabel:document.getElementById('contextLabel'),tabs:document.getElementById('tabs'),newLogTabButton:document.getElementById('newLogTabButton'),divider:document.getElementById('browserSectionDivider'),main:document.getElementById('main'),content:document.getElementById('content'),status:document.getElementById('status'),connectionSelect:document.getElementById('connectionSelect'),connectionPicker:document.getElementById('connectionPicker'),connectionDropdownButton:document.getElementById('connectionDropdownButton'),connectionDropdownLabel:document.getElementById('connectionDropdownLabel'),connectionDropdownMenu:document.getElementById('connectionDropdownMenu'),pathInput:document.getElementById('pathInput'),followButton:document.getElementById('followButton'),pauseButton:document.getElementById('pauseButton'),clearButton:document.getElementById('clearButton'),copyButton:document.getElementById('copyButton'),jumpButton:document.getElementById('jumpButton'),filePickerButton:document.getElementById('filePickerButton'),toggleLogFavoriteButton:document.getElementById('toggleLogFavoriteButton'),logFavoritesButton:document.getElementById('logFavoritesButton'),logFavoritesPopover:document.getElementById('logFavoritesPopover'),logFavoritesList:document.getElementById('logFavoritesList'),autoScrollToggle:document.getElementById('autoScrollToggle'),searchInput:document.getElementById('searchInput'),prevButton:document.getElementById('prevButton'),nextButton:document.getElementById('nextButton'),searchCount:document.getElementById('searchCount'),matchesOnlyToggle:document.getElementById('matchesOnlyToggle'),caseToggle:document.getElementById('caseToggle'),highlightToggle:document.getElementById('highlightToggle'),jsonMode:document.getElementById('jsonMode'),jsonPicker:document.getElementById('jsonPicker'),jsonDropdownButton:document.getElementById('jsonDropdownButton'),jsonDropdownLabel:document.getElementById('jsonDropdownLabel'),jsonDropdownMenu:document.getElementById('jsonDropdownMenu'),wrapToggle:document.getElementById('wrapToggle'),lineNumbersToggle:document.getElementById('lineNumbersToggle'),fontDecreaseButton:document.getElementById('fontDecreaseButton'),fontIncreaseButton:document.getElementById('fontIncreaseButton'),fontSizeLabel:document.getElementById('fontSizeLabel'),newLinesButton:document.getElementById('newLinesButton'),showOutputButton:document.getElementById('showOutputButton'),pickerPopover:document.getElementById('pickerPopover'),pickerCancel:document.getElementById('pickerCancel'),pickerBrowserPath:document.getElementById('pickerBrowserPath'),pickerList:document.getElementById('pickerList'),webviewTooltip:document.getElementById('webviewTooltip'),closeTabConfirmBackdrop:document.getElementById('closeTabConfirmBackdrop'),closeTabConfirmTitle:document.getElementById('closeTabConfirmTitle'),closeTabConfirmMessage:document.getElementById('closeTabConfirmMessage'),closeTabConfirmDetails:document.getElementById('closeTabConfirmDetails'),closeTabConfirmCancel:document.getElementById('closeTabConfirmCancel'),closeTabConfirmClose:document.getElementById('closeTabConfirmClose'),binaryLogConfirmBackdrop:document.getElementById('binaryLogConfirmBackdrop'),binaryLogConfirmTitle:document.getElementById('binaryLogConfirmTitle'),binaryLogConfirmMessage:document.getElementById('binaryLogConfirmMessage'),binaryLogConfirmDetails:document.getElementById('binaryLogConfirmDetails'),binaryLogConfirmCancel:document.getElementById('binaryLogConfirmCancel'),binaryLogConfirmOpen:document.getElementById('binaryLogConfirmOpen'),textContextMenu:document.getElementById('textContextMenu'),textContextUndo:document.getElementById('textContextUndo'),textContextRedo:document.getElementById('textContextRedo'),textContextCut:document.getElementById('textContextCut'),textContextCopy:document.getElementById('textContextCopy'),textContextPaste:document.getElementById('textContextPaste'),textContextSelectAll:document.getElementById('textContextSelectAll'),logContextMenu:document.getElementById('logContextMenu'),logContextCopy:document.getElementById('logContextCopy')};
function post(type,payload){vscode.postMessage({type:type,payload:payload||{}});}function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}function base(p){let n=String(p||'');while(n.length>1&&n.endsWith('/'))n=n.slice(0,-1);return n.split('/').pop()||p||'log'}function parentPath(p){let n=String(p||'/');while(n.length>1&&n.endsWith('/'))n=n.slice(0,-1);const i=n.lastIndexOf('/');return i<=0?'/':n.slice(0,i)}function dirnameOfFile(p){return parentPath(p)}function connectionById(id){return state.connections.find(c=>c.id===id)}function getTab(id){return state.tabs.find(t=>t.id===id)}function active(){return getTab(state.activeTabId)}function activeConnectionId(){const t=active();return t&&t.connection?t.connection.id:state.activeConnectionId}function normalizeUiPath(p){let v=String(p||'').trim();if(!v)return'';if(!v.startsWith('/'))v='/'+v;while(v.length>1&&v.endsWith('/'))v=v.slice(0,-1);return v}function getConnectionLogFavorites(connectionId){const c=connectionById(connectionId);return c&&Array.isArray(c.logFavorites)?c.logFavorites:[]}function setConnectionLogFavorites(connectionId,favorites){const list=Array.isArray(favorites)?favorites:[];for(const c of state.connections){if(c.id===connectionId)c.logFavorites=list;}for(const t of state.tabs){if(t.connection&&t.connection.id===connectionId)t.connection.logFavorites=list;}}let activeEditableContext=null;function isTextEditableInput(element){if(!(element instanceof HTMLInputElement))return false;const type=String(element.getAttribute('type')||'text').toLowerCase();return ['text','search','password','email','number','url','tel'].includes(type);}function getTextEditableTarget(target){if(!(target instanceof Element))return null;const editable=target.closest('textarea, input, [contenteditable="true"]');if(!editable)return null;if(editable instanceof HTMLTextAreaElement)return editable;if(isTextEditableInput(editable))return editable;if(editable instanceof HTMLElement&&editable.isContentEditable)return editable;return null;}function hideTextContextMenu(){activeEditableContext=null;if(els.textContextMenu)els.textContextMenu.classList.remove('visible');}function hideLogContextMenu(){if(els.logContextMenu)els.logContextMenu.classList.remove('visible');}function hideCustomContextMenus(){hideTextContextMenu();hideLogContextMenu();}function positionContextMenu(menu,x,y){if(!menu)return;menu.classList.add('visible');const margin=6;const rect=menu.getBoundingClientRect();let left=x;let top=y;if(left+rect.width+margin>window.innerWidth)left=Math.max(margin,window.innerWidth-rect.width-margin);if(top+rect.height+margin>window.innerHeight)top=Math.max(margin,window.innerHeight-rect.height-margin);menu.style.left=Math.round(left)+'px';menu.style.top=Math.round(top)+'px';}function editableHasValue(element){if(!element)return false;if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)return String(element.value||'').length>0;return String(element.textContent||'').length>0;}function editableIsReadOnly(element){if(!element)return true;if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)return !!(element.disabled||element.readOnly);return !(element instanceof HTMLElement)||!element.isContentEditable;}function editableHasSelection(element){if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)return typeof element.selectionStart==='number'&&typeof element.selectionEnd==='number'&&element.selectionEnd>element.selectionStart;const selection=window.getSelection?window.getSelection():null;return !!(selection&&!selection.isCollapsed&&element instanceof Node&&element.contains(selection.anchorNode)&&element.contains(selection.focusNode));}function editableSelectionText(element){if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement){if(typeof element.selectionStart!=='number'||typeof element.selectionEnd!=='number')return'';return String(element.value||'').slice(element.selectionStart,element.selectionEnd);}const selection=window.getSelection?window.getSelection():null;if(!selection||selection.isCollapsed||!(element instanceof Node)||!element.contains(selection.anchorNode)||!element.contains(selection.focusNode))return'';return selection.toString();}function selectAllEditable(element){if(!element)return;element.focus();if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement){if(typeof element.select==='function')element.select();return;}const range=document.createRange();range.selectNodeContents(element);const selection=window.getSelection?window.getSelection():null;if(selection){selection.removeAllRanges();selection.addRange(range);}}function showTextContextMenu(element,x,y){hideCustomContextMenus();activeEditableContext=element;const readOnly=editableIsReadOnly(element);const hasSelection=editableHasSelection(element);const hasValue=editableHasValue(element);if(els.textContextUndo)els.textContextUndo.disabled=readOnly;if(els.textContextRedo)els.textContextRedo.disabled=readOnly;if(els.textContextCut)els.textContextCut.disabled=readOnly||!hasSelection;if(els.textContextCopy)els.textContextCopy.disabled=!hasSelection;if(els.textContextPaste)els.textContextPaste.disabled=readOnly;if(els.textContextSelectAll)els.textContextSelectAll.disabled=!hasValue;positionContextMenu(els.textContextMenu,x,y);}function replaceEditableSelection(element,text){if(!element||editableIsReadOnly(element))return;if(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement){const start=typeof element.selectionStart==='number'?element.selectionStart:String(element.value||'').length;const end=typeof element.selectionEnd==='number'?element.selectionEnd:start;if(typeof element.setRangeText==='function'){element.setRangeText(text,start,end,'end');}else{const value=String(element.value||'');element.value=value.slice(0,start)+text+value.slice(end);const pos=start+text.length;element.selectionStart=pos;element.selectionEnd=pos;}element.dispatchEvent(new Event('input',{bubbles:true}));element.focus();return;}element.focus();document.execCommand('insertText',false,text);}async function handleTextContextAction(action){const target=activeEditableContext;if(!target)return;if(action==='undo'||action==='redo'){if(!editableIsReadOnly(target)){target.focus();document.execCommand(action);target.dispatchEvent(new Event('input',{bubbles:true}));}}else if(action==='copy'){const selected=editableSelectionText(target);if(selected)post('copy',{text:selected});}else if(action==='cut'){const selected=editableSelectionText(target);if(selected&&!editableIsReadOnly(target)){post('copy',{text:selected});replaceEditableSelection(target,'');}}else if(action==='paste'){if(editableIsReadOnly(target))return;let text='';try{if(navigator.clipboard&&navigator.clipboard.readText)text=await navigator.clipboard.readText();}catch(err){text='';}if(text){replaceEditableSelection(target,text);}else{target.focus();try{document.execCommand('paste');}catch(err){}}}else if(action==='selectAll'){selectAllEditable(target);}hideCustomContextMenus();}function selectedLogText(){const selection=window.getSelection&&window.getSelection();if(!selection||selection.isCollapsed||!els.content)return'';let inside=false;for(let i=0;i<selection.rangeCount;i++){const range=selection.getRangeAt(i);if(els.content.contains(range.commonAncestorContainer)||els.content.contains(range.startContainer)||els.content.contains(range.endContainer)){inside=true;break;}}return inside?selection.toString():'';}function showLogContextMenu(x,y){hideCustomContextMenus();const text=selectedLogText();if(!text)return;positionContextMenu(els.logContextMenu,x,y);}const TOOLTIP_SHOW_DELAY_MS=500;const TOOLTIP_TRANSIENT_DURATION_MS=1500;const TOOLTIP_FADE_MS=80;let activeTooltipTarget=null;let tooltipTimer=0;function hideWebviewTooltip(){if(tooltipTimer){clearTimeout(tooltipTimer);tooltipTimer=0;}activeTooltipTarget=null;if(!els.webviewTooltip)return;els.webviewTooltip.classList.remove('visible');els.webviewTooltip.setAttribute('aria-hidden','true');}function positionWebviewTooltip(target,preferAbove){if(!els.webviewTooltip||!target)return;const gap=7;const margin=8;const rect=target.getBoundingClientRect();const tooltipRect=els.webviewTooltip.getBoundingClientRect();let left=rect.left+(rect.width/2)-(tooltipRect.width/2);left=Math.max(margin,Math.min(left,window.innerWidth-tooltipRect.width-margin));let top=preferAbove?(rect.top-tooltipRect.height-gap):(rect.bottom+gap);if(top<margin)top=rect.bottom+gap;if(top+tooltipRect.height>window.innerHeight-margin)top=rect.top-tooltipRect.height-gap;top=Math.max(margin,Math.min(top,window.innerHeight-tooltipRect.height-margin));els.webviewTooltip.style.left=Math.round(left)+'px';els.webviewTooltip.style.top=Math.round(top)+'px';}function showWebviewTooltip(target){if(!els.webviewTooltip||!target||state.drag.id)return;const text=String(target.getAttribute('data-tooltip')||'').trim();if(!text)return;if(tooltipTimer)clearTimeout(tooltipTimer);activeTooltipTarget=target;els.webviewTooltip.textContent=text;els.webviewTooltip.setAttribute('aria-hidden','false');els.webviewTooltip.classList.remove('visible');els.webviewTooltip.style.left='0px';els.webviewTooltip.style.top='0px';tooltipTimer=window.setTimeout(()=>{if(activeTooltipTarget!==target)return;const preferAbove=target.classList.contains('tooltip-above')||target.getAttribute('data-tooltip-position')==='above';positionWebviewTooltip(target,preferAbove);els.webviewTooltip.classList.add('visible');},TOOLTIP_SHOW_DELAY_MS);}function getTooltipTarget(eventTarget){if(state.drag.id)return null;return eventTarget&&eventTarget.closest?eventTarget.closest('[data-tooltip]'):null;}function isCurrentLogFavorite(){const t=active();const path=normalizeUiPath(els.pathInput.value||t?.path||'');return !!(t&&path&&getConnectionLogFavorites(t.connection.id).some(f=>normalizeUiPath(f)===path))}function hideLogFavoritesPopover(){if(els.logFavoritesPopover){els.logFavoritesPopover.classList.remove('visible');els.logFavoritesPopover.setAttribute('aria-hidden','true');}}function renderLogFavoritesPopover(){const t=active();if(!els.logFavoritesList)return;if(!t){els.logFavoritesList.innerHTML='<div class="remote-path-favorites-empty">No active log tab.</div>';return;}const favorites=getConnectionLogFavorites(t.connection.id);if(!favorites.length){els.logFavoritesList.innerHTML='<div class="remote-path-favorites-empty">No favorite files.</div>';return;}els.logFavoritesList.innerHTML=favorites.map(path=>{const p=esc(path);return '<div class="remote-path-favorite-item"><button type="button" class="remote-path-favorite-path" data-log-favorite-path="'+p+'" data-tooltip="'+p+'">'+p+'</button><button type="button" class="remote-path-favorite-remove" data-log-favorite-remove="'+p+'" aria-label="Remove '+p+'">×</button></div>';}).join('')}function toggleLogFavoritesPopover(){if(!els.logFavoritesPopover)return;const t=active();const running=!!(t&&(t.status==='following'||t.status==='paused'||t.status==='opening'));if(!t||running){hideLogFavoritesPopover();return;}const visible=els.logFavoritesPopover.classList.contains('visible');if(visible){hideLogFavoritesPopover();return;}renderLogFavoritesPopover();els.logFavoritesPopover.classList.add('visible');els.logFavoritesPopover.setAttribute('aria-hidden','false')}function setSearchToggleButton(button,active){if(!button)return;button.classList.toggle('active',!!active);button.setAttribute('aria-pressed',active?'true':'false')}function isSearchToggleActive(button){return !!(button&&button.classList.contains('active'))}function toggleSearchButton(button){setSearchToggleButton(button,!isSearchToggleActive(button));applyOptions()}function renderLogFavoriteControls(){const t=active();const path=normalizeUiPath(els.pathInput.value||t?.path||'');const favorites=t?getConnectionLogFavorites(t.connection.id):[];const isFav=!!(path&&favorites.some(f=>normalizeUiPath(f)===path));const running=!!(t&&(t.status==='following'||t.status==='paused'||t.status==='opening'));if(els.toggleLogFavoriteButton){els.toggleLogFavoriteButton.disabled=!t||!path;els.toggleLogFavoriteButton.classList.toggle('active',isFav);els.toggleLogFavoriteButton.setAttribute('data-tooltip',isFav?'Remove Log Favorite':'Add Log Favorite');els.toggleLogFavoriteButton.setAttribute('aria-label',isFav?'Remove Log Favorite':'Add Log Favorite');}if(els.logFavoritesButton){els.logFavoritesButton.disabled=!t||running;els.logFavoritesButton.classList.toggle('has-favorites',favorites.length>0);if(running&&els.logFavoritesPopover)hideLogFavoritesPopover();}renderLogFavoritesPopover()}
function applySnapshot(payload){const sessions=Array.isArray(payload.sessions)?payload.sessions:[];if(!sessions.length)return;const next=[];for(const item of sessions){let t=getTab(item.tabId);if(!t)t=createTab({tabId:item.tabId,connection:item.connection,path:item.path,status:item.status,useSudo:item.useSudo,discardedPausedLines:item.discardedPausedLines,discardedBackgroundLines:item.discardedBackgroundLines},false);t.id=item.tabId;t.connection=item.connection||t.connection;t.path=item.path||t.path;t.status=item.status||t.status;t.draft=false;t.useSudo=!!item.useSudo;t.paused=t.status==='paused';t.pausedBuffer=(Array.isArray(item.pausedBuffer)?item.pausedBuffer:[]).map(record=>({raw:String(record&&record.raw!=null?record.raw:record),stderr:!!(record&&record.fromStderr)}));t.discardedPaused=Number(item.discardedPausedLines||0);t.discardedBackground=Number(item.discardedBackgroundLines||0);t.message=item.message||'';t.continuity=item.continuity||'';t.stdoutPartial=String(item.stdoutRemainder||'');t.stderrPartial=String(item.stderrRemainder||'');t.lines=(Array.isArray(item.lines)?item.lines:[]).map(record=>parseLine(record&&record.raw!=null?record.raw:record,t,!!(record&&record.fromStderr)));computeMatches(t);next.push(t);}state.tabs=next;state.activeTabId=(payload.activeTabId&&next.some(t=>t.id===payload.activeTabId))?payload.activeTabId:next[0].id;const activeTab=active();if(activeTab)state.activeConnectionId=activeTab.connection.id;render();}function createTab(payload,draft){return{id:payload.tabId,connection:payload.connection,path:payload.path||'',status:payload.status||(draft?'stopped':'opening'),draft:!!draft,lines:[],paused:false,pausedBuffer:[],discardedPaused:Number(payload.discardedPausedLines||0),discardedBackground:Number(payload.discardedBackgroundLines||0),discardedOld:0,newInactive:0,autoScroll:true,search:'',matchIndexes:[],currentMatch:0,showMatchesOnly:false,caseSensitive:false,highlight:true,jsonMode:'auto',wrap:false,lineNumbers:true,fontSize:DEFAULT_LOG_FONT_SIZE,continuity:'',message:'',useSudo:!!payload.useSudo,stdoutPartial:'',stderrPartial:''};}
function newDraftTab(payload){clearGlobalStatusMessage();const existing=getTab(payload.tabId);const t=existing||createTab(payload,true);if(!existing)state.tabs.push(t);state.activeTabId=t.id;state.activeConnectionId=t.connection.id;hidePicker();render();setTimeout(()=>els.pathInput.focus(),0);}
function newTab(payload){clearGlobalStatusMessage();let t=getTab(payload.tabId);const draftId=payload.draftTabId||'';const draftIndex=draftId?state.tabs.findIndex(item=>item.id===draftId):-1;if(!t){t=createTab(payload,false);if(draftIndex>=0)state.tabs.splice(draftIndex,1,t);else state.tabs.push(t);}else if(draftIndex>=0&&state.tabs[draftIndex]&&state.tabs[draftIndex].id!==payload.tabId){state.tabs.splice(draftIndex,1);}t.id=payload.tabId;t.draft=false;t.path=payload.path||t.path;t.status=payload.status||'opening';t.connection=payload.connection||t.connection;t.useSudo=!!payload.useSudo;t.discardedBackground=Number(payload.discardedBackgroundLines||t.discardedBackground||0);t.discardedPaused=Number(payload.discardedPausedLines||t.discardedPaused||0);t.stdoutPartial='';t.stderrPartial='';if(payload.marker)t.lines.push({raw:payload.marker,marker:true});state.activeTabId=t.id;state.activeConnectionId=t.connection.id;hidePicker();render();}
function setStatus(tab,payload){tab.status=payload.status||tab.status;if(tab.status==='stopped'||tab.status==='failed'||tab.status==='disconnected'){tab.paused=false;tab.pausedBuffer=[];}tab.message=payload.message||tab.message;tab.continuity=payload.continuity||tab.continuity;renderTabs();renderStatus();render();}
function setPartialLine(tab,raw,fromStderr){if(!tab)return;const text=String(raw||'');if(fromStderr)tab.stderrPartial=text;else tab.stdoutPartial=text;if(tab.id!==state.activeTabId){return;}const atBottom=isAtBottom();computeMatches(tab);renderContent();renderStatus();if(tab.autoScroll&&atBottom)scrollBottom();}
function addLines(tab,lines,fromStderr){if(tab.paused){tab.pausedBuffer.push(...lines.map(raw=>({raw:raw,stderr:!!fromStderr})));if(tab.pausedBuffer.length>MAX_PAUSED){const extra=tab.pausedBuffer.length-MAX_PAUSED;tab.pausedBuffer.splice(0,extra);tab.discardedPaused+=extra;}renderStatus();return;}const atBottom=isAtBottom();for(const raw of lines){tab.lines.push(parseLine(raw,tab,fromStderr));}if(tab.lines.length>MAX_LINES){const extra=tab.lines.length-MAX_LINES;tab.lines.splice(0,extra);tab.discardedOld+=extra;if(!tab.lines[0]||!tab.lines[0].marker){tab.lines.unshift({raw:'--- older loaded lines discarded due to line limit ---',marker:true});}}if(tab.id!==state.activeTabId){tab.newInactive+=lines.length;renderTabs();return;}computeMatches(tab);renderContent();renderStatus();if(tab.autoScroll&&atBottom)scrollBottom();else if(!atBottom&&lines.length){els.newLinesButton.textContent=lines.length+' new lines ↓';els.newLinesButton.classList.remove('hidden');}}
function parseLine(raw,tab,stderr){const line={raw:String(raw),stderr:!!stderr,marker:/^---.*---$/.test(String(raw))||String(raw).startsWith('Remote Edit Log Viewer:')};if(!line.marker&&tab.jsonMode!=='off'){const trimmed=line.raw.trim();if((tab.jsonMode==='on'||trimmed.startsWith('{'))&&trimmed.endsWith('}')){try{const obj=JSON.parse(trimmed);line.json=obj;line.level=normLevel(obj.level||obj.severity||obj.lvl);line.message=String(obj.message||obj.msg||obj.event||line.raw);line.time=String(obj.time||obj.timestamp||obj.ts||obj.date||'');line.source=String(obj.service||obj.app||obj.logger||obj.source||'');line.fields=obj;}catch(e){}}}if(!line.level)line.level=detectLevel(line.raw);return line;}
function normLevel(v){const s=String(v||'').toLowerCase();if(/fatal|critical|crit|error|err/.test(s))return'error';if(/warn/.test(s))return'warn';if(/info|notice/.test(s))return'info';if(/debug|trace/.test(s))return'debug';return''}function detectLevel(v){const s=' '+String(v||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ')+' ';if([' FATAL ',' CRITICAL ',' ERROR ',' ERR '].some(x=>s.includes(x)))return'error';if([' WARN ',' WARNING '].some(x=>s.includes(x)))return'warn';if([' INFO ',' NOTICE '].some(x=>s.includes(x)))return'info';if([' DEBUG ',' TRACE '].some(x=>s.includes(x)))return'debug';return''}
function renderConnectionSelect(tab,running){const selectedId=tab&&tab.connection?tab.connection.id:(state.activeConnectionId||'');if(els.connectionSelect){els.connectionSelect.innerHTML=state.connections.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name||c.host||'Connection')+'</option>').join('');els.connectionSelect.value=selectedId;els.connectionSelect.disabled=!tab||running||state.connections.length<2;}const selected=connectionById(selectedId)||state.connections[0];const disabled=!tab||running||state.connections.length<2;if(els.connectionDropdownButton){els.connectionDropdownButton.disabled=disabled;els.connectionDropdownButton.setAttribute('aria-expanded',els.connectionPicker&&els.connectionPicker.classList.contains('open')?'true':'false');els.connectionDropdownButton.setAttribute('data-tooltip',running?'Stop follow before changing connection':'Open SSH/SFTP connection');}if(els.connectionDropdownLabel){els.connectionDropdownLabel.textContent=selected?(selected.name||selected.host||'Connection'):'Connection';}if(els.connectionDropdownMenu){if(!state.connections.length){els.connectionDropdownMenu.innerHTML='<div class="profile-dropdown-empty">No SSH/SFTP connections open.</div>';}else{els.connectionDropdownMenu.innerHTML=state.connections.map(c=>{const id=esc(c.id);const name=esc(c.name||c.host||'Connection');const meta=esc(((c.username?c.username+'@':'')+(c.host||''))||String(c.connectionType||''));const selectedClass=c.id===selectedId?' selected':'';return '<button type="button" class="profile-dropdown-item'+selectedClass+'" role="option" data-connection-id="'+id+'"><span class="profile-dropdown-name">'+name+'</span><span class="profile-dropdown-meta">'+meta+'</span></button>';}).join('');}}}function updateFontControls(tab){const size=Math.max(8,Math.min(22,Number(tab?.fontSize||DEFAULT_LOG_FONT_SIZE)));if(tab)tab.fontSize=size;if(els.content)els.content.style.setProperty('--log-font-size',size+'px');if(els.fontSizeLabel)els.fontSizeLabel.textContent=size+'px';if(els.fontDecreaseButton)els.fontDecreaseButton.disabled=!tab||size<=8;if(els.fontIncreaseButton)els.fontIncreaseButton.disabled=!tab||size>=22;}function clearLoadedStateForTab(tab){if(!tab)return;tab.lines=[];tab.paused=false;tab.pausedBuffer=[];tab.discardedPaused=0;tab.discardedOld=0;tab.newInactive=0;tab.message='';tab.continuity='';tab.status='stopped';tab.draft=true;tab.matchIndexes=[];tab.currentMatch=0;}function changeActiveConnection(connectionId){const t=active();const c=connectionById(connectionId);if(!t||!c||t.connection.id===c.id)return;const running=t.status==='following'||t.status==='paused'||t.status==='opening';if(running){render();return;}const oldId=t.id;post('closeTab',{tabId:oldId});t.connection=c;t.id=c.id+':draft:'+Date.now();state.activeTabId=t.id;state.activeConnectionId=c.id;clearLoadedStateForTab(t);hidePicker();hideLogFavoritesPopover();render();}function render(){renderHeader();renderTabs();renderPicker();const tab=active();els.main.classList.toggle('hidden',!tab);if(tab){const running=tab.status==='following'||tab.status==='paused'||tab.status==='opening';renderConnectionSelect(tab,running);els.pathInput.value=tab.path||'';els.pathInput.disabled=running;els.filePickerButton.disabled=running;els.autoScrollToggle.checked=tab.autoScroll;els.searchInput.value=tab.search;setSearchToggleButton(els.matchesOnlyToggle,tab.showMatchesOnly);setSearchToggleButton(els.caseToggle,tab.caseSensitive);els.highlightToggle.checked=tab.highlight;setJsonMode(tab.jsonMode,false);els.wrapToggle.checked=tab.wrap;els.lineNumbersToggle.checked=tab.lineNumbers;updateFontControls(tab);els.followButton.textContent=running?'Stop':'Follow';els.pauseButton.textContent=tab.paused?'Resume':'Pause';els.pauseButton.disabled=tab.status==='stopped'||tab.status==='failed'||tab.status==='disconnected'||tab.draft;}renderLogFavoriteControls();renderContent();renderStatus();updateActiveTabDivider();}
function renderHeader(){const t=active();const c=t?t.connection:connectionById(state.activeConnectionId);if(els.contextLabel){els.contextLabel.textContent=c?(c.name+' · '+String(c.connectionType||'SSH').toUpperCase()):'';}}
function renderTabs(){if(!state.tabs.length){els.tabs.classList.add('empty');els.tabs.innerHTML='<span class="session-tab-drop-line"></span>';return;}els.tabs.classList.remove('empty');els.tabs.innerHTML=state.tabs.map(t=>{const connectionName=t.connection&&t.connection.name?t.connection.name:'server';const filename=t.path?base(t.path):'New log';return '<button draggable="true" class="session-tab '+(t.id===state.activeTabId?'active':'')+'" data-id="'+esc(t.id)+'"><span class="session-tab-title"><span class="session-tab-filename">'+esc(filename)+'</span><span class="session-tab-connection">'+esc(connectionName)+'</span></span><span class="session-tab-badge '+tabBadgeClass(t)+'">'+esc(tabBadge(t))+'</span><span class="session-tab-close" data-close="'+esc(t.id)+'" data-tooltip="Close" aria-label="Close"></span></button>';}).join('')+'<span class="session-tab-drop-line"></span>';}
function tabBadge(t){if(t.newInactive>0)return'+'+t.newInactive;if(t.status==='failed'||t.status==='disconnected')return'!';return''}function tabBadgeClass(t){if(t.newInactive>0)return'badge-count';if(t.status==='following')return'badge-running';if(t.status==='paused'||t.paused)return'badge-paused';if(t.status==='failed'||t.status==='disconnected')return'badge-error';return'badge-stopped'}
function updateActiveTabDivider(){requestAnimationFrame(()=>{const activeTab=els.tabs.querySelector('.session-tab.active');if(!activeTab){els.divider.style.setProperty('--active-tab-left','0px');els.divider.style.setProperty('--active-tab-width','0px');return;}const tabRect=activeTab.getBoundingClientRect();const dividerRect=els.divider.getBoundingClientRect();const left=Math.max(0,Math.round(tabRect.left-dividerRect.left));const width=Math.max(0,Math.round(tabRect.width));const gapLeft=Math.max(0,left+1);const gapWidth=Math.max(0,width-2);els.divider.style.setProperty('--active-tab-left',gapLeft+'px');els.divider.style.setProperty('--active-tab-width',gapWidth+'px');});}
function renderContent(){const tab=active();updateFontControls(tab);if(!tab){els.content.innerHTML='<div class="empty">Open a log from an SSH/SFTP connection.</div><button id="newLinesButton" class="new-lines hidden"></button>';els.newLinesButton=document.getElementById('newLinesButton');wireNewLines();return;}computeMatches(tab);let indexed=tab.lines.map((line,index)=>({line:line,index:index}));if(tab.showMatchesOnly&&tab.search){const set=new Set(tab.matchIndexes);indexed=indexed.filter(item=>set.has(item.index));}let backgroundNotice='';if(tab.discardedBackground){backgroundNotice='<div class="background-buffer-warning">⚠ Older log lines were discarded while this session was running in background to keep memory usage low.</div>';}let renderNotice='';if(indexed.length>MAX_RENDER){const hidden=indexed.length-MAX_RENDER;indexed=indexed.slice(indexed.length-MAX_RENDER);const noticeLn=tab.lineNumbers?'<span class="ln"></span>':'';renderNotice='<div class="line marker">'+noticeLn+'<span class="txt">--- rendering last '+MAX_RENDER+' visible lines; '+hidden+' older visible lines are still loaded but not rendered to keep Remote Edit responsive ---</span></div>';}const partials=[];if(tab.stdoutPartial)partials.push({raw:tab.stdoutPartial,stderr:false});if(tab.stderrPartial)partials.push({raw:'stderr: '+tab.stderrPartial,stderr:true});let visiblePartials=partials;if(tab.showMatchesOnly&&tab.search){const needle=tab.caseSensitive?tab.search:String(tab.search||'').toLowerCase();visiblePartials=partials.filter(line=>{const raw=tab.caseSensitive?String(line.raw):String(line.raw).toLowerCase();return raw.includes(needle);});}const partialOffset=tab.lines.length;const lastVisibleLine=Math.max(1,indexed.length?indexed[indexed.length-1].index+1:tab.lines.length,partialOffset+visiblePartials.length);els.content.style.setProperty('--line-number-gutter',Math.max(2,String(lastVisibleLine).length)+'ch');const html=backgroundNotice+renderNotice+indexed.map(item=>renderLine(item.line,tab,item.index+1)).join('')+visiblePartials.map((line,index)=>renderLine(parseLine(line.raw,tab,line.stderr),tab,partialOffset+index+1)).join('');els.content.innerHTML=html||'<div class="empty">No loaded log lines.</div>';if(indexed.length&&els.content.scrollHeight<=els.content.clientHeight){els.content.scrollTop=0;}const btn=document.createElement('button');btn.id='newLinesButton';btn.className='new-lines hidden';els.content.appendChild(btn);els.newLinesButton=btn;wireNewLines();}
function renderLine(line,tab,num){const cls=['line'];if(tab.wrap)cls.push('wrap');if(line.marker)cls.push('marker');if(line.stderr)cls.push('stderr');if(tab.highlight&&line.level)cls.push('level-'+line.level);const text=renderText(line,tab);const ln=tab.lineNumbers?'<span class="ln">'+num+'</span>':'';return'<div class="'+cls.join(' ')+'" data-line-number="'+num+'">'+ln+'<span class="txt">'+text+'</span></div>'}
function renderText(line,tab){if(line.json&&tab.jsonMode!=='off'){const level=line.level?line.level.toUpperCase():'';const msg=line.message||line.raw;let fields='';try{fields=Object.keys(line.fields||{}).filter(k=>!['time','timestamp','ts','date','level','severity','lvl','message','msg','event','service','app','logger','source'].includes(k)).slice(0,4).map(k=>k+'='+String(line.fields[k])).join(' ')}catch(e){}return'<span class="json-row"><span>'+highlight(line.time||'',tab)+'</span><span class="json-level">'+highlight(level,tab)+'</span><span>'+highlight(line.source||'',tab)+'</span><span>'+highlight(msg+(fields?'  '+fields:''),tab)+'</span></span>'}return highlight(line.raw,tab)}
function highlight(text,tab){const raw=String(text==null?'':text);const q=String(tab.search||'');if(!q)return esc(raw);const source=tab.caseSensitive?raw:raw.toLowerCase();const needle=tab.caseSensitive?q:q.toLowerCase();if(!needle)return esc(raw);let out='';let pos=0;let idx=source.indexOf(needle,pos);while(idx!==-1){out+=esc(raw.slice(pos,idx))+'<span class="match">'+esc(raw.slice(idx,idx+q.length))+'</span>';pos=idx+q.length;idx=source.indexOf(needle,pos);}out+=esc(raw.slice(pos));return out}
function computeMatches(tab){const q=tab.search;if(!q){tab.matchIndexes=[];tab.currentMatch=0;return;}const needle=tab.caseSensitive?q:q.toLowerCase();tab.matchIndexes=[];tab.lines.forEach((l,i)=>{const raw=tab.caseSensitive?l.raw:l.raw.toLowerCase();if(raw.includes(needle))tab.matchIndexes.push(i);});if(tab.currentMatch>=tab.matchIndexes.length)tab.currentMatch=Math.max(0,tab.matchIndexes.length-1);}
function renderStatus(){const tab=active();if(!tab){renderStatusCells([state.globalMessage?(state.globalError?'Error':'Info'):'No log opened','','',state.globalMessage||''],!!state.globalError);if(els.searchCount)els.searchCount.textContent='';return;}const info=[];if(tab.paused&&tab.pausedBuffer&&tab.pausedBuffer.length)info.push(formatLineCount(tab.pausedBuffer.length)+' buffered');if(tab.discardedPaused)info.push(tab.discardedPaused+' paused lines discarded');if(tab.discardedBackground)info.push('background lines discarded');if(tab.discardedOld)info.push('older lines discarded');if(tab.continuity)info.push(tab.continuity);if((tab.status==='failed'||tab.status==='disconnected')&&tab.message)info.unshift(tab.message);const isError=tab.status==='failed'||tab.status==='disconnected';renderStatusCells([displayStatus(tab),formatLineCount(tab.lines.length),formatLoadedSize(loadedByteCount(tab)),info.length?info.join(' · '):'—'],isError);els.searchCount.textContent=tab.search?(tab.showMatchesOnly?tab.matchIndexes.length+' shown':(tab.matchIndexes.length?tab.currentMatch+1:0)+' of '+tab.matchIndexes.length):'';}function renderStatusCells(values,isError){els.status.className='status'+(isError?' error':'');els.status.textContent='';for(let i=0;i<4;i++){const cell=document.createElement('span');cell.className='status-cell'+(i===0?' status-main':'')+(i===3?' status-info':'');cell.textContent=normalizeStatusText(values[i]||'');els.status.appendChild(cell);}}function normalizeStatusText(value){return String(value||'').replace(/[.]+$/,'');}function displayStatus(tab){if(tab.status==='opening')return'Opening';if(tab.paused||tab.status==='paused')return'Paused';if(tab.draft&&tab.status==='stopped'&&!tab.lines.length)return'Idle';if(tab.status==='following')return'Following';if(tab.status==='stopped')return'Stopped';if(tab.status==='failed')return'Failed';if(tab.status==='disconnected')return'Disconnected';return titleCase(tab.status||'Idle');}function titleCase(value){const text=String(value||'');return text?text.charAt(0).toUpperCase()+text.slice(1):'';}function formatLineCount(count){return count===1?'1 line':Number(count||0).toLocaleString()+' lines';}function loadedByteCount(tab){let bytes=0;for(const line of tab.lines||[]){bytes+=String(line&&line.raw!==undefined?line.raw:'').length+1;}return bytes;}function formatLoadedSize(bytes){const value=Number(bytes||0);if(value<1024)return value+' B';const units=['KB','MB','GB','TB'];let size=value/1024;let unit=units[0];for(let i=1;i<units.length&&size>=1024;i++){size=size/1024;unit=units[i];}const decimals=size>=10||unit==='KB'?0:1;return size.toFixed(decimals)+' '+unit;}function labelForJsonMode(value){return value==='on'?'On':value==='off'?'Off':'Auto'}function setJsonMode(value,apply){const v=value==='on'||value==='off'?value:'auto';els.jsonMode.value=v;if(els.jsonDropdownLabel)els.jsonDropdownLabel.textContent=labelForJsonMode(v);if(els.jsonDropdownMenu){for(const item of Array.from(els.jsonDropdownMenu.querySelectorAll('[data-json-mode]'))){item.classList.toggle('selected',item.getAttribute('data-json-mode')===v)}}if(apply){applyOptions();}}function positionJsonDropdown(){if(!els.jsonDropdownButton||!els.jsonDropdownMenu)return;const rect=els.jsonDropdownButton.getBoundingClientRect();const menu=els.jsonDropdownMenu;const width=Math.max(rect.width,82);const margin=8;let left=rect.left;const maxLeft=window.innerWidth-width-margin;if(left>maxLeft)left=Math.max(margin,maxLeft);const top=rect.bottom+4;menu.style.left=Math.round(left)+'px';menu.style.top=Math.round(top)+'px';menu.style.width=Math.round(width)+'px';}function hideJsonDropdown(){if(els.jsonPicker){els.jsonPicker.classList.remove('open');}if(els.jsonDropdownButton)els.jsonDropdownButton.setAttribute('aria-expanded','false')}function hideConnectionDropdown(){if(els.connectionPicker){els.connectionPicker.classList.remove('open');}if(els.connectionDropdownButton)els.connectionDropdownButton.setAttribute('aria-expanded','false')}
function showPicker(connectionId,initialPath){const id=connectionId||activeConnectionId();if(!id){setGlobalStatusMessage('Open Log Viewer from an active SSH/SFTP connection',false);return;}state.picker.visible=true;state.picker.connectionId=id;state.picker.error='';state.picker.entries=[];const logPath=initialPath||'';const browsePath=logPath?dirnameOfFile(logPath):'/var/log';showPickerShell(browsePath);requestDirectory(browsePath);}
function showPickerShell(path){state.picker.visible=true;state.picker.path=path||'/';if(els.pickerPopover){els.pickerPopover.classList.remove('hidden');els.pickerPopover.setAttribute('aria-hidden','false');}if(els.pickerBrowserPath)els.pickerBrowserPath.textContent=state.picker.path||'/';if(els.pickerList)els.pickerList.innerHTML='<div class="file-picker-empty">Loading...</div>';setTimeout(()=>els.pathInput&&els.pathInput.focus(),0);}
function hidePicker(){state.picker.visible=false;state.picker.error='';if(els.pickerPopover){els.pickerPopover.classList.add('hidden');els.pickerPopover.setAttribute('aria-hidden','true');}}
function selectFileFromPicker(path){const t=active();const selected=normalizeUiPath(path||'');if(!t||!selected){state.picker.error='Select a remote file.';renderPicker();return;}t.path=selected;els.pathInput.value=selected;els.pathInput.classList.remove('input-invalid');hidePicker();renderTabs();renderHeader();renderLogFavoriteControls();renderStatus();}
function requestDirectory(path){const connectionId=state.picker.connectionId||activeConnectionId();if(!connectionId)return;state.picker.loading=true;state.picker.error='';state.picker.requestId+=1;state.picker.path=normalizeUiPath(path||'/');renderPicker();post('listLogDirectory',{connectionId:connectionId,path:state.picker.path,requestId:String(state.picker.requestId)});}
function renderPicker(){if(!els.pickerPopover)return;els.pickerPopover.classList.toggle('hidden',!state.picker.visible);els.pickerPopover.setAttribute('aria-hidden',state.picker.visible?'false':'true');if(!state.picker.visible)return;if(els.pickerBrowserPath)els.pickerBrowserPath.textContent=state.picker.path||'/';if(!els.pickerList)return;const parentPath=state.picker.parentPath||dirnameOfFile(state.picker.path||'/');const parentItem=state.picker.path&&state.picker.path!=='/'?'<button class="file-picker-item" type="button" data-type="directory" data-path="'+esc(parentPath||'/')+'"><span aria-hidden="true">..</span></button>':'';if(state.picker.loading){els.pickerList.innerHTML='<div class="file-picker-empty">Loading...</div>';return;}if(state.picker.error&&!state.picker.entries.length){els.pickerList.innerHTML=parentItem+'<div class="file-picker-empty error">'+esc(state.picker.error)+'</div>';return;}const currentPath=normalizeUiPath(els.pathInput.value||active()?.path||'');const items=state.picker.entries.map(e=>{const entryPath=normalizeUiPath(e.path||'');const type=e.type==='directory'?'directory':'file';const selected=type==='file'&&currentPath&&entryPath===currentPath?' file-selected':'';return '<button class="file-picker-item'+selected+'" type="button" data-type="'+esc(type)+'" data-path="'+esc(entryPath)+'"><span aria-hidden="true">'+(type==='directory'?'▸':'·')+'</span><span class="file-picker-item-name">'+esc(e.name||entryPath)+'</span><span class="file-picker-item-path">'+esc(entryPath)+'</span></button>';}).join('');els.pickerList.innerHTML=parentItem+(items||'<div class="file-picker-empty">No files or folders.</div>');}
function handleDirectoryList(p){if(String(p.requestId||'')!==String(state.picker.requestId))return;state.picker.loading=false;state.picker.path=p.path||state.picker.path;state.picker.parentPath=p.parentPath||'';state.picker.entries=p.entries||[];state.picker.error=p.error||'';renderPicker();}
function selectTab(id){const t=getTab(id);if(!t)return;state.activeTabId=id;state.activeConnectionId=t.connection.id;t.newInactive=0;render();scrollBottom();}
function closeTabStatusLabel(status){if(status==='opening')return'Opening';if(status==='following')return'Running';if(status==='paused')return'Paused';if(status==='failed')return'Failed';if(status==='disconnected')return'Disconnected';return'Stopped'}function shouldConfirmCloseTab(tab){if(!tab)return false;const emptyDraft=!!(tab.draft&&!normalizeUiPath(tab.path||'')&&(!tab.lines||!tab.lines.length));if(emptyDraft)return false;return tab.status!=='stopped';}function closeConfirmMessage(tab){if(!tab)return'Closing this tab will remove the loaded log content.';if(tab.status==='paused')return'This log session is paused. Closing it will remove the loaded log content.';if(tab.status==='opening'||tab.status==='following')return'This log session is still running. Closing it will stop the stream and remove the loaded log content.';return'This log session is not stopped. Closing it will remove the loaded log content.';}function showCloseTabConfirm(id){const tab=getTab(id);if(!tab||!shouldConfirmCloseTab(tab)){closeTab(id);return;}state.closeConfirm.tabId=id;hidePicker();hideLogFavoritesPopover();hideJsonDropdown();hideConnectionDropdown();hideWebviewTooltip();hideCustomContextMenus();if(els.closeTabConfirmTitle)els.closeTabConfirmTitle.textContent='Close log tab?';if(els.closeTabConfirmMessage)els.closeTabConfirmMessage.textContent=closeConfirmMessage(tab);if(els.closeTabConfirmDetails){const connectionName=tab.connection&&(tab.connection.name||tab.connection.host)?(tab.connection.name||tab.connection.host):'Connection';const path=tab.path||'(not set)';const status=closeTabStatusLabel(tab.status);const loaded=tab.lines&&tab.lines.length?String(tab.lines.length):'0';els.closeTabConfirmDetails.textContent='Connection: '+connectionName+'\\nRemote file: '+path+'\\nStatus: '+status+'\\nLoaded lines: '+loaded;}if(els.closeTabConfirmBackdrop){els.closeTabConfirmBackdrop.classList.add('visible');els.closeTabConfirmBackdrop.setAttribute('aria-hidden','false');}setTimeout(()=>{if(els.closeTabConfirmCancel)els.closeTabConfirmCancel.focus();},0);}function hideCloseTabConfirm(){state.closeConfirm.tabId='';if(els.closeTabConfirmBackdrop){els.closeTabConfirmBackdrop.classList.remove('visible');els.closeTabConfirmBackdrop.setAttribute('aria-hidden','true');}}function showBinaryLogConfirm(payload){state.binaryConfirm.requestId=payload.requestId||'';hidePicker();hideLogFavoritesPopover();hideJsonDropdown();hideConnectionDropdown();hideCloseTabConfirm();hideWebviewTooltip();hideCustomContextMenus();if(els.binaryLogConfirmTitle)els.binaryLogConfirmTitle.textContent='Binary data detected';if(els.binaryLogConfirmMessage)els.binaryLogConfirmMessage.textContent=payload.message||'This file appears to contain binary data. Opening it in Log Viewer may display incorrectly, affect performance, or cause unexpected issues.';if(els.binaryLogConfirmDetails){const connectionName=payload.connectionName||'Connection';const path=payload.path||'(not set)';const sampleBytes=Number(payload.sampleBytes||0);els.binaryLogConfirmDetails.textContent='Connection: '+connectionName+'\\nRemote file: '+path+(sampleBytes?'\\nSample checked: '+sampleBytes+' bytes':'');}if(els.binaryLogConfirmBackdrop){els.binaryLogConfirmBackdrop.classList.add('visible');els.binaryLogConfirmBackdrop.setAttribute('aria-hidden','false');}setTimeout(()=>{if(els.binaryLogConfirmCancel)els.binaryLogConfirmCancel.focus();},0);}function hideBinaryLogConfirm(){state.binaryConfirm.requestId='';if(els.binaryLogConfirmBackdrop){els.binaryLogConfirmBackdrop.classList.remove('visible');els.binaryLogConfirmBackdrop.setAttribute('aria-hidden','true');}}function respondBinaryLogOpen(allowOpen){const requestId=state.binaryConfirm.requestId;hideBinaryLogConfirm();if(requestId)post('binaryLogOpenResponse',{requestId:requestId,allowOpen:!!allowOpen});}function handleOpenLogCancelled(payload){const draftId=payload.draftTabId||'';const path=normalizeUiPath(payload.path||'');let t=draftId?getTab(draftId):active();if(!t&&path)t=state.tabs.find(tab=>normalizeUiPath(tab.path||'')===path);if(!t)return;t.status='stopped';t.paused=false;t.pausedBuffer=[];t.message=payload.message||'';t.continuity='';t.stdoutPartial='';t.stderrPartial='';render();}function requestCloseTab(id){const tab=getTab(id);if(shouldConfirmCloseTab(tab)){showCloseTabConfirm(id);return;}closeTab(id);}function confirmCloseTab(){const id=state.closeConfirm.tabId;hideCloseTabConfirm();if(id)closeTab(id);}function closeTab(id){const idx=state.tabs.findIndex(t=>t.id===id);if(idx<0)return;const closingTab=state.tabs[idx];if(state.closeConfirm.tabId===id)hideCloseTabConfirm();post('closeTab',{tabId:id});state.tabs.splice(idx,1);if(!state.tabs.length){state.activeTabId='';state.activeConnectionId=(closingTab&&closingTab.connection&&closingTab.connection.id)||state.activeConnectionId;openNewLogTab();return;}if(state.activeTabId===id)state.activeTabId=state.tabs[Math.max(0,idx-1)]?.id||'';const t=active();if(t)state.activeConnectionId=t.connection.id;render();}
function reorderTab(tabId,toIndex){const from=state.tabs.findIndex(t=>t.id===tabId);if(from<0)return;let target=Math.max(0,Math.min(toIndex,state.tabs.length));if(target>from)target-=1;if(target===from)return;const item=state.tabs.splice(from,1)[0];state.tabs.splice(target,0,item);renderTabs();updateActiveTabDivider();}
function tabsArray(){return Array.from(els.tabs.querySelectorAll('.session-tab[data-id]'));}
function getInsertionIndex(event){const tabs=tabsArray();if(!tabs.length)return 0;for(let i=0;i<tabs.length;i++){const rect=tabs[i].getBoundingClientRect();if(event.clientX<rect.left+rect.width/2)return i;}return tabs.length;}
function showDropLine(index){const line=els.tabs.querySelector('.session-tab-drop-line');const tabs=tabsArray();if(!line||!tabs.length){return;}const clamped=Math.max(0,Math.min(index,tabs.length));let left=0;if(clamped===0){left=tabs[0].offsetLeft;}else if(clamped>=tabs.length){const last=tabs[tabs.length-1];left=last.offsetLeft+last.offsetWidth;}else{left=tabs[clamped].offsetLeft;}line.style.left=left+'px';line.style.display='block';}
function clearDrag(){state.drag.id='';state.drag.index=-1;const line=els.tabs.querySelector('.session-tab-drop-line');if(line)line.style.display='none';for(const tab of tabsArray())tab.classList.remove('dragging');}
function isAtBottom(){return els.content.scrollTop+els.content.clientHeight>=els.content.scrollHeight-30}function scrollBottom(){const maxScroll=Math.max(0,els.content.scrollHeight-els.content.clientHeight);els.content.scrollTop=maxScroll;if(maxScroll===0)els.content.scrollTop=0;if(els.newLinesButton)els.newLinesButton.classList.add('hidden')}function wireNewLines(){if(els.newLinesButton)els.newLinesButton.addEventListener('click',()=>{const t=active();if(t)t.autoScroll=true;scrollBottom();renderStatus();});}
function setGlobalStatusMessage(message,isError){state.globalMessage=String(message||'');state.globalError=!!isError;renderStatus();}
function clearGlobalStatusMessage(){if(state.globalMessage){state.globalMessage='';state.globalError=false;renderStatus();}}
function markPathInvalid(){if(els.pathInput){els.pathInput.classList.add('input-invalid');els.pathInput.focus();}}
function reportLogError(message){const text=String(message||'Log Viewer error');const t=active();if(t){t.message=text;if(t.status==='opening'||t.status==='following'||t.status==='paused'){t.status='failed';t.paused=false;t.pausedBuffer=[];}render();}else{setGlobalStatusMessage(text,true);}}
let searchTimer=null;function applyOptions(){const t=active();if(!t)return;t.search=els.searchInput.value;t.showMatchesOnly=isSearchToggleActive(els.matchesOnlyToggle);t.caseSensitive=isSearchToggleActive(els.caseToggle);t.highlight=els.highlightToggle.checked;t.jsonMode=els.jsonMode.value;t.wrap=els.wrapToggle.checked;t.lineNumbers=els.lineNumbersToggle.checked;t.autoScroll=els.autoScrollToggle.checked;if(searchTimer)clearTimeout(searchTimer);searchTimer=setTimeout(()=>{renderContent();renderStatus();},180)}
function nextMatch(delta){const t=active();if(!t||!t.matchIndexes.length)return;t.currentMatch=(t.currentMatch+delta+t.matchIndexes.length)%t.matchIndexes.length;renderContent();renderStatus();const lineNumber=t.matchIndexes[t.currentMatch]+1;const row=Array.from(els.content.querySelectorAll('.line')).find(el=>Number(el.getAttribute('data-line-number')||0)===lineNumber);if(row)row.scrollIntoView({block:'center'});}
if(els.showOutputButton)els.showOutputButton.addEventListener('click',()=>post('showOutput',{}));if(els.connectionSelect)els.connectionSelect.addEventListener('change',()=>changeActiveConnection(els.connectionSelect.value));if(els.connectionDropdownButton)els.connectionDropdownButton.addEventListener('click',e=>{e.stopPropagation();if(els.connectionDropdownButton.disabled)return;hideJsonDropdown();const open=els.connectionPicker&&els.connectionPicker.classList.contains('open');if(open)hideConnectionDropdown();else{els.connectionPicker.classList.add('open');els.connectionDropdownButton.setAttribute('aria-expanded','true');}});if(els.connectionDropdownMenu)els.connectionDropdownMenu.addEventListener('click',e=>{const item=e.target.closest('[data-connection-id]');if(!item||els.connectionDropdownButton.disabled)return;changeActiveConnection(item.getAttribute('data-connection-id')||'');hideConnectionDropdown();});if(els.fontDecreaseButton)els.fontDecreaseButton.addEventListener('click',()=>{const t=active();if(t){t.fontSize=Math.max(8,Number(t.fontSize||DEFAULT_LOG_FONT_SIZE)-1);updateFontControls(t);}});if(els.fontIncreaseButton)els.fontIncreaseButton.addEventListener('click',()=>{const t=active();if(t){t.fontSize=Math.min(22,Number(t.fontSize||DEFAULT_LOG_FONT_SIZE)+1);updateFontControls(t);}});if(els.fontSizeLabel){els.fontSizeLabel.addEventListener('click',()=>{const t=active();if(t){t.fontSize=DEFAULT_LOG_FONT_SIZE;updateFontControls(t);}});els.fontSizeLabel.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const t=active();if(t){t.fontSize=DEFAULT_LOG_FONT_SIZE;updateFontControls(t);}}});}els.filePickerButton.addEventListener('click',()=>{const t=active();if(!t)return;hideLogFavoritesPopover();showPicker(t.connection.id,els.pathInput.value.trim()||t.path||'');});els.toggleLogFavoriteButton.addEventListener('click',()=>{const t=active();if(!t)return;const path=normalizeUiPath(els.pathInput.value||t.path||'');if(!path){markPathInvalid();return;}post('toggleLogFavorite',{connectionId:t.connection.id,path:path});});els.logFavoritesButton.addEventListener('click',()=>{const t=active();if(t&&(t.status==='following'||t.status==='paused'||t.status==='opening')){hideLogFavoritesPopover();return;}hidePicker();toggleLogFavoritesPopover();});els.logFavoritesList.addEventListener('click',e=>{const remove=e.target.closest('[data-log-favorite-remove]');if(remove){const t=active();if(t)post('removeLogFavorite',{connectionId:t.connection.id,path:remove.dataset.logFavoriteRemove});return;}const item=e.target.closest('[data-log-favorite-path]');if(item){const t=active();if(!t)return;t.path=item.dataset.logFavoritePath||'';els.pathInput.value=t.path;els.pathInput.classList.remove('input-invalid');clearGlobalStatusMessage();hideLogFavoritesPopover();renderTabs();renderLogFavoriteControls();}});els.pathInput.addEventListener('input',()=>{const t=active();if(!t)return;t.path=els.pathInput.value;els.pathInput.classList.remove('input-invalid');clearGlobalStatusMessage();renderTabs();renderLogFavoriteControls();});els.pathInput.addEventListener('keydown',e=>{if(e.key==='Enter')els.followButton.click();if(e.key==='Escape'){hidePicker();hideLogFavoritesPopover();}});els.followButton.addEventListener('click',()=>{const t=active();if(!t)return;if(t.status==='following'||t.status==='paused'||t.status==='opening'){post('stopLog',{tabId:t.id});t.status='stopped';t.paused=false;t.pausedBuffer=[];render();}else{const path=els.pathInput.value.trim();if(!path){markPathInvalid();return;}const changedPath=normalizeUiPath(path)!==normalizeUiPath(t.path||'');t.path=path;t.status='opening';t.paused=false;t.pausedBuffer=[];t.discardedPaused=0;t.discardedBackground=0;t.discardedOld=0;t.newInactive=0;t.message='';t.continuity='';t.lines=[];t.stdoutPartial='';t.stderrPartial='';render();post('openLog',{connectionId:t.connection.id,path:path,useSudo:!!t.useSudo,draftTabId:(t.draft||changedPath)?t.id:''});}});els.pauseButton.addEventListener('click',()=>{const t=active();if(!t)return;if(t.paused){if(t.discardedPaused)t.lines.push({raw:'--- '+t.discardedPaused+' lines discarded while paused ---',marker:true});for(const l of t.pausedBuffer)t.lines.push(parseLine(l.raw,t,l.stderr));t.pausedBuffer=[];t.paused=false;t.status='following';post('pauseLog',{tabId:t.id,paused:false});}else{t.paused=true;t.status='paused';post('pauseLog',{tabId:t.id,paused:true});}render();});els.clearButton.addEventListener('click',()=>{const t=active();if(t){t.lines=[];t.pausedBuffer=[];t.stdoutPartial='';t.stderrPartial='';t.discardedOld=0;t.discardedPaused=0;t.discardedBackground=0;post('clearLog',{tabId:t.id});render();}});els.copyButton.addEventListener('click',()=>{const t=active();if(t)post('copy',{text:t.lines.map(l=>l.raw).join(String.fromCharCode(10))});});els.jumpButton.addEventListener('click',()=>{const t=active();if(t)t.autoScroll=true;scrollBottom();renderStatus();});for(const e of [els.searchInput,els.highlightToggle,els.jsonMode,els.wrapToggle,els.lineNumbersToggle,els.autoScrollToggle])e.addEventListener('input',applyOptions);els.matchesOnlyToggle.addEventListener('click',()=>toggleSearchButton(els.matchesOnlyToggle));els.caseToggle.addEventListener('click',()=>toggleSearchButton(els.caseToggle));if(els.jsonDropdownButton)els.jsonDropdownButton.addEventListener('click',e=>{e.stopPropagation();if(!els.jsonPicker)return;const open=els.jsonPicker.classList.contains('open');if(open)hideJsonDropdown();else{positionJsonDropdown();els.jsonPicker.classList.add('open');els.jsonDropdownButton.setAttribute('aria-expanded','true');positionJsonDropdown();}});if(els.jsonDropdownMenu)els.jsonDropdownMenu.addEventListener('click',e=>{const item=e.target.closest('[data-json-mode]');if(!item)return;setJsonMode(item.getAttribute('data-json-mode')||'auto',true);hideJsonDropdown();});els.nextButton.addEventListener('click',()=>nextMatch(1));els.prevButton.addEventListener('click',()=>nextMatch(-1));if(els.closeTabConfirmCancel)els.closeTabConfirmCancel.addEventListener('click',hideCloseTabConfirm);if(els.closeTabConfirmClose)els.closeTabConfirmClose.addEventListener('click',confirmCloseTab);if(els.binaryLogConfirmCancel)els.binaryLogConfirmCancel.addEventListener('click',()=>respondBinaryLogOpen(false));if(els.binaryLogConfirmOpen)els.binaryLogConfirmOpen.addEventListener('click',()=>respondBinaryLogOpen(true));
function openNewLogTab(){const c=connectionById(activeConnectionId())||state.connections[0];if(c)newDraftTab({tabId:c.id+':draft:'+Date.now(),connection:c,path:''});else setGlobalStatusMessage('Open Log Viewer from an active SSH/SFTP connection',false);}if(els.newLogTabButton)els.newLogTabButton.addEventListener('click',e=>{e.stopPropagation();openNewLogTab();});els.tabs.addEventListener('click',e=>{const close=e.target.closest('[data-close]');if(close){e.stopPropagation();requestCloseTab(close.dataset.close);return;}if(e.target.closest('[data-new-tab]')){openNewLogTab();return;}const tab=e.target.closest('.session-tab[data-id]');if(tab)selectTab(tab.dataset.id);});els.tabs.addEventListener('dragstart',e=>{const tab=e.target.closest('.session-tab[data-id]');if(!tab)return;state.drag.id=tab.dataset.id;tab.classList.add('dragging');try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',state.drag.id);}catch(err){}});els.tabs.addEventListener('dragover',e=>{if(!state.drag.id)return;e.preventDefault();const idx=getInsertionIndex(e);state.drag.index=idx;showDropLine(idx);});els.tabs.addEventListener('drop',e=>{if(!state.drag.id)return;e.preventDefault();reorderTab(state.drag.id,state.drag.index);clearDrag();});els.tabs.addEventListener('dragend',clearDrag);els.tabs.addEventListener('dragleave',e=>{if(!els.tabs.contains(e.relatedTarget))clearDrag();});
els.content.addEventListener('scroll',()=>{const t=active();if(!t)return;if(!isAtBottom()){t.autoScroll=false;els.autoScrollToggle.checked=false;}else if(els.newLinesButton){els.newLinesButton.classList.add('hidden');}});
if(els.textContextUndo)els.textContextUndo.addEventListener('click',()=>handleTextContextAction('undo'));if(els.textContextRedo)els.textContextRedo.addEventListener('click',()=>handleTextContextAction('redo'));if(els.textContextCut)els.textContextCut.addEventListener('click',()=>handleTextContextAction('cut'));if(els.textContextCopy)els.textContextCopy.addEventListener('click',()=>handleTextContextAction('copy'));if(els.textContextPaste)els.textContextPaste.addEventListener('click',()=>handleTextContextAction('paste'));if(els.textContextSelectAll)els.textContextSelectAll.addEventListener('click',()=>handleTextContextAction('selectAll'));if(els.logContextCopy)els.logContextCopy.addEventListener('click',()=>{const text=selectedLogText();if(text)post('copy',{text:text});hideCustomContextMenus();});document.addEventListener('contextmenu',e=>{hideWebviewTooltip();const target=e.target instanceof Element?e.target:null;const editable=target?getTextEditableTarget(target):null;if(editable){e.preventDefault();e.stopPropagation();showTextContextMenu(editable,e.clientX,e.clientY);return;}if(target&&target.closest('#content')){e.preventDefault();e.stopPropagation();showLogContextMenu(e.clientX,e.clientY);return;}e.preventDefault();e.stopPropagation();hideCustomContextMenus();},true);document.addEventListener('selectionchange',()=>{if(els.logContextMenu&&els.logContextMenu.classList.contains('visible')&&!selectedLogText())hideLogContextMenu();});document.addEventListener('mouseover',e=>{const target=getTooltipTarget(e.target);if(!target||target===activeTooltipTarget)return;showWebviewTooltip(target);});document.addEventListener('mouseout',e=>{const target=getTooltipTarget(e.target);if(!target||target!==activeTooltipTarget)return;const related=e.relatedTarget;if(related&&target.contains(related))return;hideWebviewTooltip();});document.addEventListener('focusin',e=>{const target=getTooltipTarget(e.target);if(target)showWebviewTooltip(target);});document.addEventListener('focusout',e=>{const target=getTooltipTarget(e.target);if(target&&target===activeTooltipTarget)hideWebviewTooltip();});window.addEventListener('scroll',()=>{hideWebviewTooltip();hideCustomContextMenus();},true);window.addEventListener('resize',()=>{hideWebviewTooltip();hideCustomContextMenus();if(els.jsonPicker&&els.jsonPicker.classList.contains('open'))positionJsonDropdown();});if(els.pickerPopover){els.pickerPopover.addEventListener('mousedown',e=>e.stopPropagation());els.pickerPopover.addEventListener('click',e=>e.stopPropagation());}if(els.pickerCancel)els.pickerCancel.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();hidePicker();});if(els.pickerList)els.pickerList.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const row=e.target.closest('.file-picker-item');if(!row)return;const path=row.dataset.path;const type=row.dataset.type;if(type==='directory'){requestDirectory(path);}else{selectFileFromPicker(path);}});
function reportWebviewVisibility(){post('visibilityChanged',{visible:document.visibilityState==='visible'});}document.addEventListener('visibilitychange',reportWebviewVisibility);window.addEventListener('focus',reportWebviewVisibility);window.addEventListener('pageshow',reportWebviewVisibility);window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(els.binaryLogConfirmBackdrop&&els.binaryLogConfirmBackdrop.classList.contains('visible')){respondBinaryLogOpen(false);return;}if(els.closeTabConfirmBackdrop&&els.closeTabConfirmBackdrop.classList.contains('visible')){hideCloseTabConfirm();return;}hidePicker();hideLogFavoritesPopover();hideJsonDropdown();hideConnectionDropdown();hideWebviewTooltip();hideCustomContextMenus();}});document.addEventListener('click',e=>{hideWebviewTooltip();if(!e.target.closest||(!e.target.closest('.context-menu')))hideCustomContextMenus();if(els.jsonPicker&&els.jsonPicker.classList.contains('open')&&!els.jsonPicker.contains(e.target))hideJsonDropdown();if(els.connectionPicker&&els.connectionPicker.classList.contains('open')&&!els.connectionPicker.contains(e.target))hideConnectionDropdown();if(els.logFavoritesPopover&&els.logFavoritesPopover.classList.contains('visible')&&!els.logFavoritesPopover.contains(e.target)&&!els.logFavoritesButton.contains(e.target))hideLogFavoritesPopover();const pickerWrap=els.pickerPopover?els.pickerPopover.closest('.remote-file-field'):null;if(state.picker.visible&&pickerWrap&&e.target instanceof Node&&!pickerWrap.contains(e.target))hidePicker();});window.addEventListener('message',event=>{const m=event.data||{};const p=m.payload||{};switch(m.type){case'config':state.config=p;break;case'connections':state.connections=p.connections||[];for(const t of state.tabs){const c=connectionById(t.connection.id);if(c)t.connection=c;}if(p.activeConnectionId)state.activeConnectionId=p.activeConnectionId;else if(!state.activeConnectionId&&state.connections[0])state.activeConnectionId=state.connections[0].id;render();break;case'showOpenPrompt':state.activeConnectionId=p.connectionId||state.activeConnectionId;{const c=connectionById(state.activeConnectionId);if(c)newDraftTab({tabId:c.id+':draft:'+Date.now(),connection:c,path:''});}break;case'newDraftTab':newDraftTab(p);break;case'snapshot':applySnapshot(p);break;case'confirmBinaryLogOpen':showBinaryLogConfirm(p);break;case'openLogCancelled':handleOpenLogCancelled(p);break;case'tabStarted':newTab(p);break;case'lines':{const t=getTab(p.tabId);if(t)addLines(t,p.lines||[],!!p.fromStderr);break;}case'partialLine':{const t=getTab(p.tabId);if(t)setPartialLine(t,p.raw||'',!!p.fromStderr);break;}case'tabStatus':{const t=getTab(p.tabId);if(t)setStatus(t,p);break;}case'tabClosed':break;case'focusTab':selectTab(p.tabId);break;case'logDirectoryList':handleDirectoryList(p);break;case'logFavorites':setConnectionLogFavorites(p.connectionId,p.favorites||[]);renderLogFavoriteControls();break;case'error':reportLogError(p.message||'Log Viewer error');break;case'copyFeedback':break;}});
render();post('ready',{});reportWebviewVisibility();setTimeout(()=>{post('ready',{});reportWebviewVisibility();},100);setTimeout(()=>{post('ready',{});reportWebviewVisibility();},500);
})();
</script>
</body></html>`;
  }
}
