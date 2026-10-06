import { SearchBatch, normalizeSearchQuery, formatSearchResults, type SearchQuery, type SearchExecution, type SearchTarget } from '../multiTargetSearch/SearchBatch';
import { formatMultiTargetSearchCompletedStatus } from './MultiTargetFeedback';
import * as vscode from 'vscode';
import type { ConnectionManager } from '../connection/ConnectionManager';
import { SftpSessionManager } from '../ssh/SftpSessionManager';
import { RemoteCommandService } from '../commands/RemoteCommandService';
import { isWindowsRemotePlatform } from '../remote/RemotePlatform';
import { CommandBatch, type CommandExecution, type CommandTarget } from '../multiTargetCommands/CommandBatch';
import { CommandSessions } from '../multiTargetCommands/CommandSessions';
import { renderMultiTargetHtml } from './MultiTargetHtml';
import { MULTI_TARGET_SAVED_COMMANDS_STORAGE_KEY, MULTI_TARGET_TARGET_SETS_STORAGE_KEY, normalizeSavedMultiTargetCommands, normalizeSavedMultiTargetSets, updateSharedTargetSets, type SavedMultiTargetCommand, type SavedMultiTargetSet } from '../multiTarget/MultiTargetStorage';
import { formatMultiTargetCommandsCompletedStatus, formatMultiTargetConnectionFailureStatus, formatMultiTargetOperationStatus, formatMultiTargetSkippedStatus, formatMultiTargetUnavailableStatus } from '../multiTarget/MultiTargetFeedback';
import { RemoteEditSharedState } from '../state/RemoteEditSharedState';
import { appendDebugLog, appendPerformanceLog, createPerformanceTimer } from '../utils/outputLogger';

export const COMMAND_OPEN_MULTI_TARGET = 'remoteedit.multiTarget.open';
const LEGACY_RUNTIME_STORAGE_KEY = 'remoteedit.multiTarget';
type ResultFilter = 'All' | 'Running' | 'Finished' | 'Failed';
interface ScrollState { output: number; table: number; }
interface Preferences {
  activeTab: 'commands' | 'search';
  search: { query: SearchQuery; filter: ResultFilter; selectedCommandId: string; scroll: ScrollState };
  targetSetId: string;
  targets: Array<{ connectionId: string; workingDirectory: string }>;
  directories: Record<string, string>;
  ratio: number;
  command: string;
  useSudo: boolean;
  filter: ResultFilter;
  selectedCommandId: string;
  scroll: ScrollState;
}
interface InputRequest { options: vscode.InputBoxOptions; resolve: (value: string | undefined) => void; cancellation?: vscode.Disposable; }

export class MultiTargetFeature implements vscode.Disposable {
  private runtime: MultiTargetPanel | undefined;
  private readonly registration: vscode.Disposable;
  private readonly multiTargetChangedSubscription: vscode.Disposable;
  constructor(context: vscode.ExtensionContext, profiles: ConnectionManager, output: vscode.OutputChannel) {
    // Runtime UI state is intentionally session-only. Remove the pre-release
    // persisted snapshot if it exists so drafts, loaded sets, results settings,
    // and section state never survive an extension/VS Code restart.
    if (context.globalState.get<unknown>(LEGACY_RUNTIME_STORAGE_KEY) !== undefined) {
      void context.globalState.update(LEGACY_RUNTIME_STORAGE_KEY, undefined);
    }
    this.registration = vscode.commands.registerCommand(COMMAND_OPEN_MULTI_TARGET, () => {
      if (!this.runtime) this.runtime = new MultiTargetPanel(context, profiles, output);
      this.runtime.reveal();
    });
    this.multiTargetChangedSubscription = RemoteEditSharedState.onMultiTargetChanged(() => {
      void this.runtime?.refreshSavedDataAfterImport();
    });
  }
  dispose(): void {
    this.registration.dispose();
    this.multiTargetChangedSubscription.dispose();
    this.runtime?.dispose();
    this.runtime = undefined;
  }
}

class MultiTargetPanel implements vscode.Disposable {
  private searchBatch?: SearchBatch;
  private searchBusy = false;
  private searchGeneration = 0;
  private resultView: Record<string, unknown> = {};
  private readonly searchDirty = new Map<string, SearchExecution>();
  private readonly sentResults = new Map<string, number>();
  private searchFlushTimer?: NodeJS.Timeout;
  private readonly closeListener: vscode.Disposable;
  private readonly targetOperations = new Map<string, Promise<unknown>>();
  private readonly feedbackMessages = new Map<string, any>();
  private get anyBusy(): boolean { return this.busy || this.searchBusy; }
  private async withTarget<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.targetOperations.get(id) || Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.targetOperations.set(id, next);
    try { return await next; }
    finally { if (this.targetOperations.get(id) === next) this.targetOperations.delete(id); }
  }
  private sudoPasswords(raw: unknown, targets: Array<{ connectionId: string }>): Map<string, string> {
    const allowed = new Set(targets.map(target => target.connectionId));
    const passwords = new Map<string, string>();
    if (Array.isArray(raw)) for (const item of raw) {
      if (item && allowed.has(item.connectionId) && typeof item.password === 'string' && item.password) passwords.set(item.connectionId, item.password);
    }
    return passwords;
  }
  private async prepareTargetSudo(id: string, useSudo: boolean, passwords: Map<string, string>): Promise<void> {
    if (!useSudo) {
      this.sessions.remote.disableSudoMode(id);
      await this.service.prepareSudo(id, false, async () => passwords.get(id));
      return;
    }
    const timer = createPerformanceTimer();
    appendDebugLog(this.output, 'MultiTarget', 'Sudo preparation started.', { connectionId: id });
    try {
      const enabled = await this.service.prepareSudo(id, true, async () => passwords.get(id));
      appendDebugLog(this.output, 'MultiTarget', 'Sudo preparation completed.', {
        connectionId: id,
        enabled
      });
      appendPerformanceLog(this.output, 'MultiTarget', 'sudo preparation completed', {
        connectionId: id,
        enabled,
        total: `${timer()}ms`
      });
    } catch (error) {
      appendDebugLog(this.output, 'MultiTarget', 'Sudo preparation failed.', { connectionId: id });
      appendPerformanceLog(this.output, 'MultiTarget', 'sudo preparation failed', {
        connectionId: id,
        total: `${timer()}ms`
      });
      throw error;
    }
  }
  private panel: vscode.WebviewPanel | undefined;
  private readonly sessions: CommandSessions;
  private readonly service: RemoteCommandService;
  private preferences: Preferences;
  private batch?: CommandBatch;
  private busy = false;
  private disposed = false;
  private readonly viewDisposables: vscode.Disposable[] = [];
  private readonly dirty = new Map<string, CommandExecution>();
  private readonly sentOutput = new Map<string, string>();
  private flushTimer?: NodeJS.Timeout;
  private targetQueue: Promise<unknown> = Promise.resolve();
  private stateVersion = 0;
  private snapshotRequested = false;
  private runGeneration = 0;
  private inputRequestSerial = 0;
  private readonly inputRequests = new Map<string, InputRequest>();
  private loadedTargetSetSnapshot: SavedMultiTargetSet | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly profiles: ConnectionManager,
    private readonly output: vscode.OutputChannel) {
    this.preferences = {
      activeTab: 'commands',
      targetSetId: '',
      search: { query: normalizeSearchQuery(undefined), filter: 'All', selectedCommandId: '', scroll: { output: 0, table: 0 } },
      targets: [],
      directories: {},
      ratio: .3,
      command: '',
      useSudo: false,
      filter: 'All',
      selectedCommandId: '',
      scroll: { output: 0, table: 0 }
    };
    const remote = new SftpSessionManager(output);
    this.sessions = new CommandSessions(remote, profiles, () => { void this.sendState(); }, (options, token) => this.requestInput(options, token), output);
    this.service = new RemoteCommandService(remote);
    this.closeListener = remote.onDidCloseConnection(id => this.searchBatch?.connectionClosed(id));
    this.openPanel();
  }
  private cloneTargetSet(value: SavedMultiTargetSet | undefined): SavedMultiTargetSet | undefined {
    return value ? { id: value.id, title: value.title, targets: value.targets.map(target => ({ ...target })) } : undefined;
  }
  private targetSetsEqual(left: SavedMultiTargetSet | undefined, right: SavedMultiTargetSet | undefined): boolean {
    if (!left || !right || left.id !== right.id || left.title !== right.title || left.targets.length !== right.targets.length) return false;
    return left.targets.every((target, index) => target.connectionId === right.targets[index]?.connectionId
      && target.workingDirectory === right.targets[index]?.workingDirectory);
  }
  async refreshSavedDataAfterImport(): Promise<void> {
    if (this.disposed) return;
    const loadedId = this.preferences.targetSetId;
    if (loadedId) {
      const importedSet = this.getTargetSets().find(item => item.id === loadedId);
      if (!this.targetSetsEqual(importedSet, this.loadedTargetSetSnapshot)) {
        this.preferences.targetSetId = '';
        this.loadedTargetSetSnapshot = undefined;
        this.persist();
      }
    }
    await this.sendState(true);
    await this.sendSavedCommands(false);
    await this.sendTargetSets(false);
  }
  private openPanel(): void {
    if (this.disposed || this.panel) return;
    const panel = vscode.window.createWebviewPanel('remoteeditMultiTarget', 'Remote Edit · Multi-Target Commands & Search', vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    this.panel = panel;
    panel.iconPath = new vscode.ThemeIcon('terminal');
    panel.webview.html = renderMultiTargetHtml(panel.webview);
    this.viewDisposables.push(panel.onDidDispose(() => this.closePanel(panel)),
      panel.webview.onDidReceiveMessage(message => {
        void this.handle(message).catch(error => this.post({ type: 'error', mode: message?.mode === 'search' ? 'search' : this.preferences.activeTab, message: error instanceof Error ? error.message : String(error) }));
      }), panel.onDidChangeViewState(event => { if (event.webviewPanel.visible) void this.sendState(true); }));
  }
  private closePanel(panel: vscode.WebviewPanel): void {
    if (this.panel !== panel) return;
    this.panel = undefined;
    for (const requestId of [...this.inputRequests.keys()]) this.completeInputRequest(requestId, undefined, false);
    while (this.viewDisposables.length) this.viewDisposables.pop()?.dispose();
  }
  reveal(): void {
    if (this.disposed) return;
    if (!this.panel) this.openPanel();
    this.panel?.reveal();
    void this.sendState(true);
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.runGeneration++; this.searchGeneration++; this.batch?.stop(); this.searchBatch?.stop(); this.closeListener.dispose(); this.sessions.dispose();
    if (this.searchFlushTimer) clearTimeout(this.searchFlushTimer);
    for (const requestId of [...this.inputRequests.keys()]) this.completeInputRequest(requestId, undefined, false);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    const panel = this.panel; this.panel = undefined;
    while (this.viewDisposables.length) this.viewDisposables.pop()?.dispose();
    panel?.dispose();
  }
  private post(message: any): void {
    if (message.type === 'notice' || message.type === 'error') {
      const mode = message.mode || 'shared';
      const channel = message.channel || 'secondary';
      const key = mode + ':' + channel;
      const previous = this.feedbackMessages.get(key);
      const rank = (value: any) => value?.type === 'error' || value?.severity === 'error' ? 3 : value?.severity === 'warning' ? 2 : 1;
      if (channel === 'primary' || !previous || rank(message) >= rank(previous)) this.feedbackMessages.set(key, message);
    }
    if (!this.disposed && this.panel) void this.panel.webview.postMessage(message);
  }
  private postCommands(message: any): void { this.post({ ...message, mode: 'commands' }); }
  private postSearch(message: any): void { this.post({ ...message, mode: 'search' }); }
  private resetFeedback(mode: string): void {
    for (const key of [...this.feedbackMessages.keys()]) if (key.startsWith(mode + ':')) this.feedbackMessages.delete(key);
  }
  private requestInput(options: vscode.InputBoxOptions, token?: vscode.CancellationToken): Promise<string | undefined> {
    if (this.disposed || !this.panel || token?.isCancellationRequested) return Promise.resolve(undefined);
    const requestId = `input-${++this.inputRequestSerial}`;
    return new Promise(resolve => {
      const request: InputRequest = { options, resolve };
      this.inputRequests.set(requestId, request);
      if (token) request.cancellation = token.onCancellationRequested(() => this.completeInputRequest(requestId, undefined, true));
      this.post({ type: 'inputPrompt', requestId, title: options.title || 'Multi-Target Commands & Search', prompt: options.prompt || '',
        placeHolder: options.placeHolder || '', password: Boolean(options.password), value: options.value || '' });
    });
  }
  private completeInputRequest(requestId: string, value: string | undefined, close: boolean): void {
    const request = this.inputRequests.get(requestId);
    if (!request) return;
    this.inputRequests.delete(requestId); request.cancellation?.dispose();
    if (close) this.post({ type: 'inputPromptClose', requestId });
    request.resolve(value);
  }
  private async handleInputPromptResult(message: any): Promise<void> {
    const requestId = typeof message?.requestId === 'string' ? message.requestId : '';
    const request = this.inputRequests.get(requestId);
    if (!request) return;
    if (message.cancelled) { this.completeInputRequest(requestId, undefined, false); return; }
    const value = typeof message.value === 'string' ? message.value : '';
    const validation = request.options.validateInput ? await request.options.validateInput(value) : undefined;
    if (validation) { this.post({ type: 'inputPromptValidation', requestId, message: validation }); return; }
    this.completeInputRequest(requestId, value, true);
  }
  private persist(): void {
    for (const target of this.preferences.targets) this.preferences.directories[target.connectionId] = target.workingDirectory;
  }
  private async sendState(includeBatch = false): Promise<void> {
    this.snapshotRequested ||= includeBatch;
    this.postCommands({ type: 'busy', busy: this.busy });
    this.postSearch({ type: 'busy', busy: this.searchBusy });
    try {
      const version = ++this.stateVersion;
      const [profiles, groups] = await Promise.all([this.profiles.listProfiles(), this.profiles.listGroups()]);
      if (version !== this.stateVersion || this.disposed) return;
      const compatible = profiles.filter(profile => profile.connectionType === 'sftp');
      const shared = { type: 'state', activeTab: this.preferences.activeTab, anyBusy: this.anyBusy, targetSetId: this.preferences.targetSetId, busy: this.busy, ratio: this.preferences.ratio, command: this.preferences.command, useSudo: this.preferences.useSudo, filter: this.preferences.filter, selectedCommandId: this.preferences.selectedCommandId, scroll: this.preferences.scroll, savedCommands: this.getSavedCommands(), targetSets: this.getTargetSets(),
        profiles: compatible.map(({ id, name, groupId, host, username }) => ({ id, name, groupId, host, username })),
        groups: groups.map(({ id, name }) => ({ id, name })),
        targets: this.preferences.targets.map(target => {
          const profile = compatible.find(p => p.id === target.connectionId);
          const connection = this.sessions.remote.getConnection(target.connectionId);
          const sudoPasswordRequired = Boolean(profile && profile.username.toLowerCase() !== 'root'
            && !isWindowsRemotePlatform(connection?.remotePlatform));
          return { ...target, name: profile?.name || 'Unavailable connection',
            status: this.sessions.states.get(target.connectionId) || 'Disconnected', sudoPasswordRequired };
        }) };
      this.postCommands(shared);
      this.postSearch({ ...shared, busy: this.searchBusy, query: this.preferences.search.query, resultView: this.resultView,
        filter: this.preferences.search.filter, selectedCommandId: this.preferences.search.selectedCommandId, scroll: this.preferences.search.scroll });
      if (this.snapshotRequested) {
        this.snapshotRequested = false;
        this.sendBatchSnapshot(); this.sendSearchBatchSnapshot();
        for (const message of this.feedbackMessages.values()) {
          if (this.panel) void this.panel.webview.postMessage(message);
        }
      }
    } catch (error) { this.post({ type: 'error', message: `Could not load saved connections: ${String(error)}` }); }
  }
  private sendBatchSnapshot(): void {
    if (!this.batch) { this.postCommands({ type: 'batch', batchId: '', executions: [] }); return; }
    const executions = this.batch.executions.map(item => ({ ...item }));
    this.sentOutput.clear();
    for (const item of executions) this.sentOutput.set(item.commandId, item.output);
    this.postCommands({ type: 'batch', batchId: this.batch.id, command: this.batch.command, executions, selectedCommandId: this.preferences.selectedCommandId });
  }
  private queueExecution(execution: CommandExecution): void {
    if (this.disposed) return;
    this.dirty.set(execution.commandId, execution);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.postCommands({ type: 'executions', batchId: this.batch?.id, executions: [...this.dirty.values()].map(item => {
        const { stdout, stderr, output, ...metadata } = item;
        const previous = this.sentOutput.get(item.commandId) || '';
        this.sentOutput.set(item.commandId, output);
        return output.startsWith(previous) ? { ...metadata, appendOutput: output.slice(previous.length) } : { ...metadata, output };
      }) }); this.dirty.clear();
    }, 100);
  }
  private async handle(message: any): Promise<void> {
    const mode = message?.mode === 'search' ? 'search' : 'commands';
    if (message?.type === 'activeTab') { this.preferences.activeTab = mode; this.persist(); await this.sendState(true); return; }
    if (message?.type === 'clear') { this.resetFeedback(mode); this.resetFeedback('shared'); }
    if (message?.type === 'run') this.resetFeedback(mode);
    if (mode === 'search') {
      switch (message?.type) {
      case 'uiState':
      case 'preferences':
        if (message.query && typeof message.query === 'object') this.preferences.search.query = normalizeSearchQuery(message.query);
        if (message.resultView && typeof message.resultView === 'object') this.resultView = message.resultView;
        if (['All', 'Running', 'Finished', 'Failed'].includes(message.filter)) this.preferences.search.filter = message.filter;
        if (typeof message.selectedCommandId === 'string') this.preferences.search.selectedCommandId = message.selectedCommandId;
        if (typeof message.ratio === 'number' && Number.isFinite(message.ratio)) this.preferences.ratio = Math.max(.1, Math.min(.8, message.ratio));
        if (message.scroll && typeof message.scroll === 'object') {
          const output = Number(message.scroll.output), table = Number(message.scroll.table);
          this.preferences.search.scroll = {
            output: Number.isFinite(output) && output >= 0 ? output : this.preferences.search.scroll.output,
            table: Number.isFinite(table) && table >= 0 ? table : this.preferences.search.scroll.table
          };
        }
        if (message.type === 'preferences') this.persist();
        return;
      case 'run': await this.runSearch(normalizeSearchQuery(message.query), message.sudoPasswords); return;
      case 'stop': {
        const batch = this.searchBatch;
        if (batch && message.batchId === batch.id) {
          const commandId = typeof message.commandId === 'string' ? message.commandId : undefined;
          const affected = batch.executions.filter(item => (!commandId || item.commandId === commandId)
            && (item.status === 'Pending' || item.status === 'Running')).length;
          appendDebugLog(this.output, 'MultiTargetSearch', 'Stop requested.', {
            batchId: batch.id,
            scope: commandId ? 'target' : 'all',
            targets: affected
          });
          batch.stop(commandId);
        }
        return;
      }
      case 'clear': if (!this.searchBusy) { this.searchBatch = undefined; this.searchDirty.clear(); this.sentResults.clear(); this.preferences.search.selectedCommandId = ''; this.persist(); this.postSearch({ type: 'batch', batchId: '', executions: [] }); } return;
      case 'copyOutput': {
        const item = this.searchBatch?.executions.find(item => item.commandId === message.commandId && Boolean(item.results.length));
        if (item) {
          await vscode.env.clipboard.writeText(formatSearchResults(item.results));
          this.postSearch({ type: 'copied', target: 'output' });
        }
        return;
      }
      case 'copyAllOutputs': {
        const items = this.searchBatch?.executions.filter(item => Boolean(item.results.length)) || [];
        if (items.length) {
          const text = items.map(item => {
            const output = formatSearchResults(item.results);
            return `===== ${item.name} =====\n${output.trimEnd()}`;
          }).join('\n\n');
          await vscode.env.clipboard.writeText(text);
          this.postSearch({ type: 'copied', target: 'allOutputs' });
        }
        return;
      }
      }
    }
    switch (message?.type) {
      case 'clearFeedback': this.resetFeedback(mode); this.resetFeedback('shared'); break;
      case 'ready': await this.sendState(true); break;
      case 'inputPromptResult': await this.handleInputPromptResult(message); break;
      case 'uiState':
      case 'preferences':
        if (typeof message.ratio === 'number' && Number.isFinite(message.ratio)) this.preferences.ratio = Math.max(.1, Math.min(.8, message.ratio));
        if (typeof message.command === 'string') this.preferences.command = message.command;
        if (typeof message.useSudo === 'boolean') this.preferences.useSudo = message.useSudo;
        if (['All', 'Running', 'Finished', 'Failed'].includes(String(message.filter))) this.preferences.filter = message.filter as ResultFilter;
        if (typeof message.selectedCommandId === 'string') this.preferences.selectedCommandId = message.selectedCommandId;
        if (message.scroll && typeof message.scroll === 'object') {
          const output = Number(message.scroll.output), table = Number(message.scroll.table);
          this.preferences.scroll = {
            output: Number.isFinite(output) && output >= 0 ? output : this.preferences.scroll.output,
            table: Number.isFinite(table) && table >= 0 ? table : this.preferences.scroll.table
          };
        }
        if (message.type === 'preferences') this.persist(); break;
      case 'targets': {
        if (this.anyBusy) return;
        const update = this.targetQueue.then(async () => {
          const allowed = new Set((await this.profiles.listProfiles()).filter(p => p.connectionType === 'sftp').map(p => p.id));
          const ids = [...new Set<string>(Array.isArray(message.ids) ? message.ids.filter((id: unknown) => typeof id === 'string' && allowed.has(id)) : [])];
          const old = this.preferences.targets;
          this.preferences.targets = ids.map(id => old.find(t => t.connectionId === id) || { connectionId: id, workingDirectory: this.preferences.directories[id] || '' });
          this.persist();
          await Promise.allSettled(old.filter(t => !ids.includes(t.connectionId)).map(t => this.sessions.disconnect(t.connectionId)));
          await this.sendState();
        });
        this.targetQueue = update.catch(() => undefined); await update; break;
      }
      case 'directory':
        if (this.anyBusy || typeof message.value !== 'string') return;
        if (message.value.includes('\0') || /[\r\n]/.test(message.value)) throw new Error('Enter a working directory on one line.');
        this.preferences.targets.forEach(target => { if (message.ids?.includes(target.connectionId)) target.workingDirectory = message.value.trim(); });
        this.persist(); await this.sendState(); break;
      case 'connect': {
        if (this.anyBusy) return;
        await this.targetQueue;
        const targets = this.preferences.targets.filter(target => {
          const status = this.sessions.states.get(target.connectionId);
          return status !== 'Connected' && status !== 'Connecting';
        });
        const failures: string[] = [];
        await Promise.allSettled(targets.map(async target => {
          try { await this.sessions.connect(target.connectionId); }
          catch (error) { failures.push(`${target.connectionId}: ${error instanceof Error ? error.message : String(error)}`); }
        }));
        if (failures.length) this.post({ type: 'notice', severity: 'error', channel: 'secondary', scope: 'connection', persistent: true,
          message: formatMultiTargetConnectionFailureStatus(failures.length), tooltip: failures.join('\n') });
        break;
      }
      case 'disconnect':
        this.runGeneration++; this.searchGeneration++;
        if (this.batch?.active) appendDebugLog(this.output, 'MultiTargetCommands', 'Stop requested.', {
          batchId: this.batch.id,
          scope: 'all',
          reason: 'disconnect',
          targets: this.batch.executions.filter(item => item.status === 'Pending' || item.status === 'Connecting' || item.status === 'Running').length
        });
        if (this.searchBatch?.executions.some(item => item.status === 'Pending' || item.status === 'Running')) appendDebugLog(this.output, 'MultiTargetSearch', 'Stop requested.', {
          batchId: this.searchBatch.id,
          scope: 'all',
          reason: 'disconnect',
          targets: this.searchBatch.executions.filter(item => item.status === 'Pending' || item.status === 'Running').length
        });
        this.batch?.stop(); this.searchBatch?.stop();
        await Promise.allSettled(this.preferences.targets.map(target => this.sessions.disconnect(target.connectionId))); break;
      case 'connectTarget': {
        if (this.anyBusy) return;
        const connectionId = typeof message.connectionId === 'string' ? message.connectionId : '';
        if (!this.preferences.targets.some(target => target.connectionId === connectionId)) return;
        const status = this.sessions.states.get(connectionId);
        if (status === 'Connected' || status === 'Connecting') return;
        try { await this.sessions.connect(connectionId); }
        catch (error) {
          const detail = `${connectionId}: ${error instanceof Error ? error.message : String(error)}`;
          this.post({ type: 'notice', severity: 'error', channel: 'secondary', scope: 'connection', persistent: true,
            message: formatMultiTargetConnectionFailureStatus(1), tooltip: detail });
        }
        break;
      }
      case 'disconnectTarget': {
        const connectionId = typeof message.connectionId === 'string' ? message.connectionId : '';
        if (!this.preferences.targets.some(target => target.connectionId === connectionId)) return;
        const execution = this.batch?.executions.find(item => item.connectionId === connectionId);
        if (execution && (execution.status === 'Pending' || execution.status === 'Connecting' || execution.status === 'Running')) {
          appendDebugLog(this.output, 'MultiTargetCommands', 'Stop requested.', {
            batchId: this.batch?.id,
            scope: 'target',
            reason: 'disconnectTarget',
            connectionId,
            targets: 1
          });
          this.batch?.stop(execution.commandId);
        }
        const searchExecution = this.searchBatch?.executions.find(item => item.connectionId === connectionId);
        if (searchExecution && (searchExecution.status === 'Pending' || searchExecution.status === 'Running')) {
          appendDebugLog(this.output, 'MultiTargetSearch', 'Stop requested.', {
            batchId: this.searchBatch?.id,
            scope: 'target',
            reason: 'disconnectTarget',
            connectionId,
            targets: 1
          });
          this.searchBatch?.stop(searchExecution.commandId);
        }
        await this.sessions.disconnect(connectionId);
        break;
      }
      case 'removeTarget': {
        if (this.anyBusy) return;
        const connectionId = typeof message.connectionId === 'string' ? message.connectionId : '';
        if (!connectionId || !this.preferences.targets.some(target => target.connectionId === connectionId)) return;
        const update = this.targetQueue.then(async () => {
          const searchExecution = this.searchBatch?.executions.find(item => item.connectionId === connectionId);
        if (searchExecution) this.searchBatch?.stop(searchExecution.commandId);
        await this.sessions.disconnect(connectionId);
          this.preferences.targets = this.preferences.targets.filter(target => target.connectionId !== connectionId);
          this.persist();
          await this.sendState();
        });
        this.targetQueue = update.catch(() => undefined);
        await update;
        break;
      }
      case 'run': await this.run(String(message.command || ''), Boolean(message.useSudo), message.sudoPasswords); break;
      case 'stop': {
        const batch = this.batch;
        if (batch && message.batchId === batch.id) {
          const commandId = typeof message.commandId === 'string' ? message.commandId : undefined;
          const affected = batch.executions.filter(item => (!commandId || item.commandId === commandId)
            && (item.status === 'Pending' || item.status === 'Connecting' || item.status === 'Running')).length;
          appendDebugLog(this.output, 'MultiTargetCommands', 'Stop requested.', {
            batchId: batch.id,
            scope: commandId ? 'target' : 'all',
            targets: affected
          });
          batch.stop(commandId);
        }
        break;
      }
      case 'clear': if (!this.busy) { this.batch = undefined; this.dirty.clear(); this.sentOutput.clear(); this.preferences.selectedCommandId = ''; this.persist(); this.postCommands({ type: 'batch', batchId: '', executions: [] }); } break;
      case 'copyOutput': {
        const item = this.batch?.executions.find(item => item.commandId === message.commandId && Boolean(item.output));
        if (item) {
          await vscode.env.clipboard.writeText((item.truncated ? '[Earlier output truncated]\n' : '') + item.output);
          this.postCommands({ type: 'copied', target: 'output' });
        }
        break;
      }
      case 'copyAllOutputs': {
        const items = this.batch?.executions.filter(item => Boolean(item.output)) || [];
        if (items.length) {
          const text = items.map(item => {
            const output = (item.truncated ? '[Earlier output truncated]\n' : '') + item.output;
            return `===== ${item.name} =====\n${output.trimEnd()}`;
          }).join('\n\n');
          await vscode.env.clipboard.writeText(text);
          this.postCommands({ type: 'copied', target: 'allOutputs' });
        }
        break;
      }
      case 'copyText':
        if (typeof message.text === 'string' && message.text) await vscode.env.clipboard.writeText(message.text);
        break;
      case 'savedCommands': await this.sendSavedCommands(true); break;
      case 'saveSavedCommand': await this.saveSavedCommand(message); break;
      case 'deleteSavedCommand': await this.deleteSavedCommand(message); break;
      case 'targetSets': await this.sendTargetSets(true); break;
      case 'saveTargetSet': await this.saveTargetSet(message); break;
      case 'deleteTargetSet': await this.deleteTargetSet(message); break;
      case 'loadTargetSet': await this.loadTargetSet(message); break;
    }
  }
  private getSavedCommands(): SavedMultiTargetCommand[] {
    return normalizeSavedMultiTargetCommands(this.context.globalState.get<unknown>(MULTI_TARGET_SAVED_COMMANDS_STORAGE_KEY, []));
  }
  private getTargetSets(): SavedMultiTargetSet[] {
    return normalizeSavedMultiTargetSets(this.context.globalState.get<unknown>(MULTI_TARGET_TARGET_SETS_STORAGE_KEY, []));
  }
  private async sendSavedCommands(open = false): Promise<void> {
    this.post({ type: 'savedCommands', open, items: this.getSavedCommands() });
  }
  private async saveSavedCommand(message: any): Promise<void> {
    if (this.busy) return;
    const title = typeof message?.title === 'string' ? message.title.trim() : '';
    const command = typeof message?.command === 'string' ? message.command : '';
    const requestedId = typeof message?.id === 'string' ? message.id : '';
    const replaceId = typeof message?.replaceId === 'string' ? message.replaceId : '';
    if (!title) throw new Error('Enter a title for the saved command.');
    if (!command.trim()) throw new Error('Enter a command to save.');
    if (title.length > 160) throw new Error('Saved command titles must be 160 characters or fewer.');

    const items = this.getSavedCommands();
    const editingIndex = requestedId ? items.findIndex(item => item.id === requestedId) : -1;
    const duplicateIndex = items.findIndex(item => item.id !== requestedId && item.title.localeCompare(title, undefined, { sensitivity: 'accent' }) === 0);
    if (duplicateIndex >= 0 && items[duplicateIndex].id !== replaceId) throw new Error(`A saved command named "${title}" already exists.`);

    if (editingIndex >= 0) {
      if (duplicateIndex >= 0) items.splice(duplicateIndex, 1);
      const currentIndex = items.findIndex(item => item.id === requestedId);
      if (currentIndex >= 0) items[currentIndex] = { id: requestedId, title, command };
    } else if (duplicateIndex >= 0) {
      const existing = items[duplicateIndex];
      items[duplicateIndex] = { id: existing.id, title, command };
    } else {
      const id = `multi-command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      items.push({ id, title, command });
    }
    await this.context.globalState.update(MULTI_TARGET_SAVED_COMMANDS_STORAGE_KEY, items);
    await this.sendSavedCommands(Boolean(message?.reopen));
  }
  private async deleteSavedCommand(message: any): Promise<void> {
    if (this.busy) return;
    const id = typeof message?.id === 'string' ? message.id : '';
    if (!id) return;
    const items = this.getSavedCommands();
    const filtered = items.filter(item => item.id !== id);
    if (filtered.length === items.length) return;
    await this.context.globalState.update(MULTI_TARGET_SAVED_COMMANDS_STORAGE_KEY, filtered);
    await this.sendSavedCommands(Boolean(message?.reopen));
  }
  private async sendTargetSets(open = false): Promise<void> {
    this.post({ type: 'targetSets', open, items: this.getTargetSets() });
  }
  private async saveTargetSet(message: any): Promise<void> {
    if (this.anyBusy) return;
    const title = typeof message?.title === 'string' ? message.title.trim() : '';
    const saveAsNew = Boolean(message?.saveAsNew);
    const requestedId = saveAsNew ? '' : (typeof message?.id === 'string' ? message.id : '');
    const replaceId = saveAsNew ? '' : (typeof message?.replaceId === 'string' ? message.replaceId : '');
    const loadAfterSave = Boolean(message?.loadAfterSave);
    if (!title) throw new Error('Enter a title for the target set.');
    if (title.length > 160) throw new Error('Target set titles must be 160 characters or fewer.');

    const rawTargets = Array.isArray(message?.targets) ? message.targets : [];
    const seen = new Set<string>();
    const targets: Array<{ connectionId: string; workingDirectory: string }> = [];
    for (const target of rawTargets) {
      const connectionId = typeof target?.connectionId === 'string' ? target.connectionId.trim() : '';
      if (!connectionId || seen.has(connectionId)) continue;
      const workingDirectory = typeof target?.workingDirectory === 'string' ? target.workingDirectory.trim() : '';
      if (workingDirectory.includes('\0') || /[\r\n]/.test(workingDirectory)) throw new Error('Enter each working directory on one line.');
      seen.add(connectionId);
      targets.push({ connectionId, workingDirectory });
    }
    if (!targets.length) throw new Error('Select at least one target for the set.');

    let savedId = '';
    await updateSharedTargetSets(this.context.globalState, items => {
      const editingIndex = requestedId ? items.findIndex(item => item.id === requestedId) : -1;
      const duplicateIndex = items.findIndex(item => item.id !== requestedId && item.title.localeCompare(title, undefined, { sensitivity: 'accent' }) === 0);
      if (saveAsNew && duplicateIndex >= 0) throw new Error(`A target set named "${title}" already exists.`);
      if (duplicateIndex >= 0 && items[duplicateIndex].id !== replaceId) throw new Error(`A target set named "${title}" already exists.`);

      if (editingIndex >= 0) {
        if (duplicateIndex >= 0) items.splice(duplicateIndex, 1);
        const currentIndex = items.findIndex(item => item.id === requestedId);
        if (currentIndex >= 0) {
          items[currentIndex] = { id: requestedId, title, targets };
          savedId = requestedId;
        }
      } else if (duplicateIndex >= 0) {
        const existing = items[duplicateIndex];
        items[duplicateIndex] = { id: existing.id, title, targets };
        savedId = existing.id;
      } else {
        const id = `multi-target-set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
        items.push({ id, title, targets });
        savedId = id;
      }
      return items;
    });
    const savedSet = savedId ? this.getTargetSets().find(item => item.id === savedId) : undefined;
    if (savedId && savedId === this.preferences.targetSetId) {
      this.loadedTargetSetSnapshot = this.cloneTargetSet(savedSet);
    }
    if (loadAfterSave && savedId) {
      this.preferences.targetSetId = savedId;
      this.loadedTargetSetSnapshot = this.cloneTargetSet(savedSet);
      this.persist();
      await this.sendState();
    }
    await this.sendTargetSets(Boolean(message?.reopen));
  }
  private async deleteTargetSet(message: any): Promise<void> {
    if (this.anyBusy) return;
    const id = typeof message?.id === 'string' ? message.id : '';
    if (!id) return;
    await updateSharedTargetSets(this.context.globalState, items => items.filter(item => item.id !== id));
    if (this.preferences.targetSetId === id) {
      this.preferences.targetSetId = '';
      this.loadedTargetSetSnapshot = undefined;
      this.persist();
      await this.sendState();
    }
    await this.sendTargetSets(Boolean(message?.reopen));
  }
  private async loadTargetSet(message: any): Promise<void> {
    if (this.anyBusy) return;
    const id = typeof message?.id === 'string' ? message.id : '';
    const targetSet = this.getTargetSets().find(item => item.id === id);
    if (!targetSet) throw new Error('The selected target set no longer exists.');

    const update = this.targetQueue.then(async () => {
      const allowed = new Set((await this.profiles.listProfiles()).filter(profile => profile.connectionType === 'sftp').map(profile => profile.id));
      const next = targetSet.targets.filter(target => allowed.has(target.connectionId));
      if (!next.length) throw new Error('None of the connections in this target set are currently available.');
      this.preferences.targetSetId = id;
      this.loadedTargetSetSnapshot = this.cloneTargetSet(targetSet);
      const old = this.preferences.targets;
      this.preferences.targets = next.map(target => ({ connectionId: target.connectionId, workingDirectory: target.workingDirectory }));
      this.persist();
      await Promise.allSettled(old.filter(target => !next.some(item => item.connectionId === target.connectionId)).map(target => this.sessions.disconnect(target.connectionId)));
      await this.sendState();
      const skipped = targetSet.targets.length - next.length;
      if (skipped > 0) this.post({ type: 'notice', severity: 'warning', persistent: true, message: formatMultiTargetUnavailableStatus(skipped, targetSet.title) });
    });
    this.targetQueue = update.catch(() => undefined);
    await update;
  }
  private async run(command: string, useSudo: boolean, rawSudoPasswords?: unknown): Promise<void> {
    if (this.busy) return;
    if (!command.trim()) throw new Error('Enter a command to run.');
    this.busy = true;
    const generation = ++this.runGeneration;
    try {
      await this.targetQueue;
      const profiles = await this.profiles.listProfiles();
      if (this.disposed || generation !== this.runGeneration) return;
      const configuredTargets: CommandTarget[] = this.preferences.targets.map(target => {
        const profile = profiles.find(p => p.id === target.connectionId && p.connectionType === 'sftp');
        return { ...target, name: profile?.name || 'Unavailable connection' };
      });
      if (!configuredTargets.length) throw new Error('Select at least one target.');
      const targets = configuredTargets.filter(target =>
        this.sessions.states.get(target.connectionId) === 'Connected' && Boolean(this.sessions.remote.getConnection(target.connectionId)));
      if (!targets.length) throw new Error('Connect at least one target before running commands.');
      const skippedTargets = configuredTargets.length - targets.length;
      const sudoPasswords = this.sudoPasswords(rawSudoPasswords, targets);
      this.preferences.command = command; this.preferences.useSudo = useSudo; this.preferences.selectedCommandId = ''; this.persist(); this.dirty.clear(); this.sentOutput.clear();
      const batch = new CommandBatch(targets, command, item => this.queueExecution(item));
      this.batch = batch;
      const batchTimer = createPerformanceTimer();
      appendDebugLog(this.output, 'MultiTargetCommands', 'Batch started.', {
        batchId: batch.id,
        targets: targets.length,
        skippedTargets,
        useSudo,
        concurrency: 5,
        commandLines: command.split(/\r?\n/).filter(line => line.trim()).length
      });
      this.postCommands({ type: 'batch', batchId: batch.id, command, executions: batch.executions });
      this.postCommands({ type: 'notice', channel: 'primary', scope: 'operation', severity: 'info', persistent: false,
        message: formatMultiTargetOperationStatus('Running on', targets.length) });
      if (skippedTargets > 0) this.postCommands({ type: 'notice', channel: 'secondary', scope: 'operation', severity: 'warning', persistent: true,
        message: formatMultiTargetSkippedStatus(skippedTargets) });
      await this.sendState();
      try {
        await batch.run(async context => {
          const { execution } = context;
          const source = new vscode.CancellationTokenSource();
          const targetTimer = createPerformanceTimer();
          let targetStatus: 'Finished' | 'Failed' | 'Stopped' = 'Failed';
          appendDebugLog(this.output, 'MultiTargetCommands', 'Target execution started.', {
            batchId: batch.id,
            commandId: execution.commandId,
            connectionId: execution.connectionId,
            target: execution.name,
            useSudo
          });
          context.setStop(() => source.cancel());
          try {
            // Serialize only Sudo preparation and command launch. The executor captures
            // its credentials synchronously, so both modes can then stream concurrently.
            const { completion } = await this.withTarget(execution.connectionId, async () => {
              if (context.isStopped()) throw new Error('Stopped.');
              await this.prepareTargetSudo(execution.connectionId, useSudo, sudoPasswords);
              if (context.isStopped()) throw new Error('Stopped.');
              context.setStatus('Running');
              return { completion: this.service.run(execution.connectionId, execution.workingDirectory, command, {
                onControl: context.setControl,
                onCommand: text => context.append(`$ ${text}\n`),
                onCommandStatus: (_index, code) => { if (code !== 0) execution.failedCommands++; },
                onStdout: text => context.append(text, 'stdout'), onStderr: text => context.append(text, 'stderr')
              }, source.token) };
            });
            const result = await completion;
            targetStatus = context.isStopped() ? 'Stopped' : result.code === 0 && !execution.failedCommands ? 'Finished' : 'Failed';
            if (targetStatus === 'Stopped') {
              appendDebugLog(this.output, 'MultiTargetCommands', 'Target execution stopped.', {
                batchId: batch.id,
                commandId: execution.commandId,
                connectionId: execution.connectionId,
                target: execution.name
              });
            } else if (targetStatus === 'Failed') {
              appendDebugLog(this.output, 'MultiTargetCommands', 'Target execution failed.', {
                batchId: batch.id,
                commandId: execution.commandId,
                connectionId: execution.connectionId,
                target: execution.name,
                exitCode: result.code,
                failedCommands: execution.failedCommands
              });
            } else {
              appendDebugLog(this.output, 'MultiTargetCommands', 'Target execution completed.', {
                batchId: batch.id,
                commandId: execution.commandId,
                connectionId: execution.connectionId,
                target: execution.name,
                exitCode: result.code
              });
            }
            return result;
          } catch (error) {
            targetStatus = context.isStopped() ? 'Stopped' : 'Failed';
            appendDebugLog(this.output, 'MultiTargetCommands', targetStatus === 'Stopped' ? 'Target execution stopped.' : 'Target execution failed.', {
              batchId: batch.id,
              commandId: execution.commandId,
              connectionId: execution.connectionId,
              target: execution.name
            });
            throw error;
          } finally {
            appendPerformanceLog(this.output, 'MultiTargetCommands', 'target execution completed', {
              batchId: batch.id,
              commandId: execution.commandId,
              connectionId: execution.connectionId,
              target: execution.name,
              status: targetStatus,
              total: `${targetTimer()}ms`
            });
            source.dispose();
          }
        });
      } catch (error) {
        appendDebugLog(this.output, 'MultiTargetCommands', 'Batch failed.', {
          batchId: batch.id,
          targets: targets.length
        });
        appendPerformanceLog(this.output, 'MultiTargetCommands', 'batch failed', {
          batchId: batch.id,
          targets: targets.length,
          total: `${batchTimer()}ms`
        });
        throw error;
      }
      const finished = batch.executions.filter(item => item.status === 'Finished').length;
      const failed = batch.executions.filter(item => item.status === 'Failed').length;
      const stopped = batch.executions.filter(item => item.status === 'Stopped').length;
      appendDebugLog(this.output, 'MultiTargetCommands', 'Batch completed.', {
        batchId: batch.id,
        targets: batch.executions.length,
        finished,
        failed,
        stopped
      });
      appendPerformanceLog(this.output, 'MultiTargetCommands', 'batch completed', {
        batchId: batch.id,
        targets: batch.executions.length,
        finished,
        failed,
        stopped,
        total: `${batchTimer()}ms`
      });
      this.postCommands({ type: 'notice', channel: 'primary', scope: 'operation', severity: 'info', persistent: true,
        message: formatMultiTargetCommandsCompletedStatus(finished, failed, stopped) });
    } finally { this.busy = false; await this.sendState(); }
  }
  private sendSearchBatchSnapshot(): void {
    if (!this.searchBatch) { this.postSearch({ type: 'batch', batchId: '', executions: [] }); return; }
    const executions = this.searchBatch.executions.map(item => ({ ...item }));
    this.sentResults.clear();
    for (const item of executions) this.sentResults.set(item.commandId, item.results.length);
    this.postSearch({ type: 'batch', batchId: this.searchBatch.id, query: this.searchBatch.query, executions, selectedCommandId: this.preferences.search.selectedCommandId });
  }
  private queueSearchExecution(execution: SearchExecution): void {
    if (this.disposed) return;
    this.searchDirty.set(execution.commandId, execution);
    if (!this.searchFlushTimer) this.searchFlushTimer = setTimeout(() => {
      this.searchFlushTimer = undefined;
      this.postSearch({ type: 'executions', batchId: this.searchBatch?.id, executions: [...this.searchDirty.values()].map(item => {
        const { results, ...metadata } = item;
        const previous = this.sentResults.get(item.commandId) || 0;
        this.sentResults.set(item.commandId, results.length);
        return { ...metadata, appendResults: results.slice(previous), totalResults: results.length };
      }) }); this.searchDirty.clear();
    }, 100);
  }
  private async runSearch(query: SearchQuery, rawSudoPasswords?: unknown): Promise<void> {
    if (this.searchBusy) return;
    if (query.searchInsideFiles && !query.textToFind) throw new Error('Enter text to find.');
    this.searchBusy = true;
    const generation = ++this.searchGeneration;
    try {
      await this.targetQueue;
      const profiles = await this.profiles.listProfiles();
      if (this.disposed || generation !== this.searchGeneration) return;
      const targets: SearchTarget[] = this.preferences.targets.filter(target =>
        this.sessions.states.get(target.connectionId) === 'Connected' && Boolean(this.sessions.remote.getConnection(target.connectionId)))
        .map(target => ({ ...target, name: profiles.find(p => p.id === target.connectionId)?.name || 'Unavailable connection' }));
      if (!targets.length) throw new Error('Connect at least one target before searching.');
      const skipped = this.preferences.targets.length - targets.length;
      const sudoPasswords = this.sudoPasswords(rawSudoPasswords, targets);
      this.preferences.search.query = query; this.preferences.search.selectedCommandId = ''; this.resultView = {}; this.persist();
      if (this.searchFlushTimer) { clearTimeout(this.searchFlushTimer); this.searchFlushTimer = undefined; }
      this.searchDirty.clear(); this.sentResults.clear();
      const batch = new SearchBatch(targets, query, this.sessions.remote, this.output, item => this.queueSearchExecution(item), 5, async execution => {
        await this.prepareTargetSudo(execution.connectionId, query.useSudo, sudoPasswords);
      }, (id, operation) => this.withTarget(id, operation));
      this.searchBatch = batch;
      const batchTimer = createPerformanceTimer();
      appendDebugLog(this.output, 'MultiTargetSearch', 'Batch started.', {
        batchId: batch.id,
        targets: targets.length,
        skippedTargets: skipped,
        searchInsideFiles: query.searchInsideFiles,
        includeSubdirectories: query.includeSubdirectories,
        includeHiddenFiles: query.includeHiddenFiles,
        caseSensitive: query.caseSensitive,
        useSudo: query.useSudo,
        concurrency: 5
      });
      this.postSearch({ type: 'batch', batchId: batch.id, query, executions: batch.executions });
      this.postSearch({ type: 'notice', channel: 'primary', scope: 'operation', severity: 'info', persistent: false,
        message: formatMultiTargetOperationStatus('Searching', targets.length) });
      if (skipped > 0) this.postSearch({ type: 'notice', channel: 'secondary', scope: 'operation', severity: 'warning', persistent: true,
        message: formatMultiTargetSkippedStatus(skipped) });
      await this.sendState();
      try {
        await batch.run();
      } catch (error) {
        appendDebugLog(this.output, 'MultiTargetSearch', 'Batch failed.', {
          batchId: batch.id,
          targets: targets.length
        });
        appendPerformanceLog(this.output, 'MultiTargetSearch', 'batch failed', {
          batchId: batch.id,
          targets: targets.length,
          total: `${batchTimer()}ms`
        });
        throw error;
      }
      const failed = batch.executions.filter(item => item.status === 'Failed').length;
      const stopped = batch.executions.filter(item => item.status === 'Stopped').length;
      const results = batch.executions.reduce((total, item) => total + item.results.length, 0);
      appendDebugLog(this.output, 'MultiTargetSearch', 'Batch completed.', {
        batchId: batch.id,
        targets: batch.executions.length,
        results,
        failed,
        stopped
      });
      appendPerformanceLog(this.output, 'MultiTargetSearch', 'batch completed', {
        batchId: batch.id,
        targets: batch.executions.length,
        results,
        failed,
        stopped,
        total: `${batchTimer()}ms`
      });
      this.postSearch({ type: 'notice', channel: 'primary', scope: 'operation', severity: 'info', persistent: true,
        message: formatMultiTargetSearchCompletedStatus(batch.executions.length, results, failed, stopped) });
    } finally { this.searchBusy = false; await this.sendState(); }
  }
}
