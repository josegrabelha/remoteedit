import { renderWorkspaceSyncHtml } from './WorkspaceSyncHtml';
import { listLocalFolders } from '../ui/LocalFolderBrowser';
import * as vscode from 'vscode';
import * as fs from 'fs';
import type { WorkspaceSyncController } from '../WorkspaceSyncController';
import { RemoteEditSharedState } from '../../state/RemoteEditSharedState';

type WorkspaceSyncOperationKind =
  | 'connect'
  | 'reconnect'
  | 'disconnect'
  | 'refresh'
  | 'resetBaseline'
  | 'sync'
  | 'upload'
  | 'download'
  | 'comparison'
  | 'deleteMapping';

function formatWorkspaceSyncTimestamp(value: number): string {
  const date = new Date(value);
  const pad = (part: number): string => String(part).padStart(2, '0');
  const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
  const time = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':');
  return `${day} ${time}`;
}

export class WorkspaceSyncPanel implements vscode.Disposable {
  private static currentPanel: WorkspaceSyncPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel;
  private disposed = false;
  private handling = false;
  private detachUi?: () => void;
  private cancelConnect?: () => Promise<void>;
  private activeOperation: {
    id: number;
    source: vscode.CancellationTokenSource;
    cancelling: boolean;
    cancellable: boolean;
    kind: WorkspaceSyncOperationKind;
  } | undefined;
  private operationSequence = 0;
  private stateRequestSequence = 0;
  /** Refresh and baseline maintenance must not monopolize navigation or the
   * whole panel: work is scoped to a mapping and coordinated by the controller.
   */
  private readonly maintenanceOperations = new Map<string, {
    id: number;
    source: vscode.CancellationTokenSource;
  }>();

  static open(
    context: vscode.ExtensionContext,
    controller: WorkspaceSyncController,
    output: vscode.OutputChannel
  ): WorkspaceSyncPanel {
    if (WorkspaceSyncPanel.currentPanel && !WorkspaceSyncPanel.currentPanel.disposed) {
      WorkspaceSyncPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      void WorkspaceSyncPanel.currentPanel.postState();
      return WorkspaceSyncPanel.currentPanel;
    }
    WorkspaceSyncPanel.currentPanel = new WorkspaceSyncPanel(context, controller, output);
    return WorkspaceSyncPanel.currentPanel;
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: WorkspaceSyncController,
    private readonly output: vscode.OutputChannel
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'remoteedit.workspaceSync',
      'Remote Edit · Workspace Sync',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    this.panel.iconPath = new vscode.ThemeIcon('sync');
    this.panel.webview.html = renderWorkspaceSyncHtml(
      this.panel.webview,
      loadWorkspaceSyncSvg(this.context.extensionUri, 'question.svg'),
      loadWorkspaceSyncSvg(this.context.extensionUri, 'arrow-swap.svg')
    );
    this.panel.webview.onDidReceiveMessage(message => void this.handleMessage(message), null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.disposables.push(this.controller.sessions.onDidChange(() => void this.postState()));
    this.disposables.push(this.controller.onDidChangeViewState(() => void this.postState()));
    this.disposables.push(this.controller.onDidChangeBackgroundActivity(activity => {
      void this.post({ type: 'backgroundOperationState', ...activity });
    }));
    this.disposables.push(RemoteEditSharedState.onWorkspaceSyncChanged(() => {
      void this.controller.reloadPersistentConfiguration().then(() => this.postState());
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachUi?.();
    this.activeOperation?.source.cancel();
    for (const maintenance of this.maintenanceOperations.values()) maintenance.source.cancel();
    void this.cancelConnect?.();
    this.activeOperation?.source.dispose();
    this.activeOperation = undefined;
    while (this.disposables.length) this.disposables.pop()?.dispose();
    if (WorkspaceSyncPanel.currentPanel === this) WorkspaceSyncPanel.currentPanel = undefined;
  }

  private async handleMessage(message: any): Promise<void> {
    if (message?.type === 'uiResponse') { this.controller.ui.respond(String(message.id), message.value); return; }
    if (message?.type === 'browseLocal') {
      if (!this.controller.ui.isFolderRequest(String(message.id))) return;
      try {
        const listing = await listLocalFolders(String(message.path || ''), vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || []);
        await this.post({ type: 'folderListing', id: message.id, sequence: message.sequence, listing });
      } catch (error) { await this.post({ type: 'folderListing', id: message.id, sequence: message.sequence, error: String((error as Error).message || error) }); }
      return;
    }
    if (message?.type === 'clearActivity') { this.controller.ui.clear(); return; }
    if (message?.type === 'copyActivity') {
      const text = this.controller.ui.snapshot().map(entry => `${formatWorkspaceSyncTimestamp(entry.time)} [${entry.target || 'Workspace Sync'}] ${entry.message}`).join('\n');
      try { await vscode.env.clipboard.writeText(text); await this.post({ type: 'copiedActivity' }); }
      catch { this.controller.ui.notify('Could not copy the activity log.', 'error'); }
      return;
    }
    if (message?.type === 'copyText') {
      try { await vscode.env.clipboard.writeText(String(message.text || '')); }
      catch { this.controller.ui.notify('Could not copy the selected text.', 'error'); }
      return;
    }
    if (message?.type === 'setConflictResolution') {
      await this.handleConflictResolutionMessage(message);
      return;
    }
    if (message?.type === 'previewPlan') {
      await this.handlePreviewPlanMessage(message);
      return;
    }
    if (message?.type === 'ready') {
      this.detachUi = this.controller.ui.attach(data => { void this.post(data); });
      await this.post({ type: 'activitySnapshot', entries: this.controller.ui.snapshot() });
      await this.postState(); return;
    }
    if (message?.type === 'cancelOperation') {
      const requestedOperationId = Number(message?.operationId || 0);
      const operation = this.activeOperation;
      if (!operation) {
        // A late Cancel click must also repair a stale webview state instead of
        // resurrecting a cancellation label after the operation has finished.
        this.controller.ui.cancelPending();
        await this.post({ type: 'operationState', active: false, operationId: this.operationSequence });
        return;
      }
      // A delayed Cancel click belongs to the operation the user actually saw.
      // Never let it cancel a newer operation that started in the meantime.
      if (requestedOperationId > 0 && requestedOperationId !== operation.id) return;
      if (!operation.cancellable || operation.cancelling) return;

      operation.cancelling = true;
      await this.post({
        type: 'operationState',
        active: true,
        label: 'Cancelling...',
        kind: operation.kind,
        operationId: operation.id,
        cancelling: true,
        cancellable: false
      });
      operation.source.cancel();
      this.controller.ui.cancelPending();

      // Connection cleanup may be serialized behind the operation that is being
      // cancelled. Never await it here: doing so used to let the operation's
      // final inactive state arrive first and then overwrite it with a stale
      // "Cancelling..." state. The operation lifecycle owns the final UI state.
      const cancelConnect = this.cancelConnect;
      if (cancelConnect) {
        void cancelConnect().catch(error => {
          const text = this.controller.ui.sanitize(error instanceof Error ? error.message : String(error));
          this.output.appendLine(`[Workspace Sync] Cancellation cleanup failed: ${text}`);
          this.controller.ui.log(`Cancellation cleanup failed: ${text}`, 'warning');
        });
      }
      return;
    }
    if (message?.type === 'cancelMaintenance') {
      const mappingId = String(message.mappingId || '');
      const maintenance = this.maintenanceOperations.get(mappingId);
      if (maintenance && Number(message.maintenanceId) === maintenance.id) maintenance.source.cancel();
      return;
    }
    if (message?.type === 'cancelInitialRefresh') {
      this.controller.cancelInitialRefresh(String(message.mappingId || ''));
      return;
    }
    if (message?.type === 'setHideUnsupportedFiles') {
      await this.controller.setHideUnsupportedFiles(Boolean(message.value));
      await this.postState();
      return;
    }
    if (message?.type === 'setShowModifiedTimes') {
      await this.controller.setShowModifiedTimes(Boolean(message.value));
      await this.postState();
      return;
    }
    if (message?.type === 'setDefaultCompare') {
      await this.controller.setDefaultCompare(message.value === 'vscode' ? 'vscode' : 'internal');
      await this.postState();
      return;
    }
    if (message?.type === 'clientActivity') {
      const text = String(message.message || '').trim();
      if (text) this.controller.ui.log(text, message.level === 'warning' ? 'warning' : 'info');
      return;
    }
    if (this.handling) return;
    this.handling = true;
    await this.post({ type: 'interactionState', active: true });
    try {
      const mappingId = String(message?.mappingId || '');
      const targetId = String(message?.targetId || '');
      switch (message?.type) {
        case 'selectMapping':
          await this.controller.selectMapping(mappingId);
          await this.postState();
          return;
        case 'selectTarget':
          await this.controller.selectTarget(mappingId, targetId);
          await this.postState();
          return;
        case 'setConflictResolutionsBulk': {
          const requestedTargets = Array.isArray(message.targets)
            ? message.targets.map((item: any) => ({
              targetId: String(item?.targetId || ''),
              resolutions: this.parseConflictResolutionChanges(item?.resolutions)
            })).filter((item: { targetId: string; resolutions: Record<string, 'useLocal' | 'useRemote' | 'skip' | undefined> }) => item.targetId && Object.keys(item.resolutions).length)
            : [];
          if (!requestedTargets.length) return;
          // Validate every target before mutating any runtime plan so a stale
          // row cannot produce a partial bulk application.
          for (const item of requestedTargets) {
            await this.controller.previewPlanWithResolutions(mappingId, item.targetId, item.resolutions);
          }
          for (const item of requestedTargets) {
            await this.controller.setConflictResolutions(mappingId, item.targetId, item.resolutions, false);
          }
          await this.postState();
          return;
        }
        case 'pickLocalRoot': {
          const selected = await this.controller.ui.request({ kind: 'folder', title: 'Select Local Root', value: String(message.current || '') });
          if (selected) await this.post({ type: 'localRootPicked', value: selected });
          return;
        }
        case 'saveMapping':
          if (this.maintenanceOperations.has(String(message.mapping?.id || ''))) {
            throw new Error('Wait until Refresh or Reset Baseline finishes before changing this mapping.');
          }
          await this.controller.saveMapping(message.mapping || {});
          await this.post({ type: 'mappingSaved' });
          await this.postState();
          return;
        case 'deleteMapping': {
          if (this.maintenanceOperations.has(mappingId)) {
            throw new Error('Wait until Refresh or Reset Baseline finishes before deleting this mapping.');
          }
          const confirmed = await this.confirm('Delete this Workspace Sync mapping and its saved baselines?', { modal: true }, 'Delete');
          if (confirmed !== 'Delete') return;
          await this.withProgressOperation(
            'Deleting mapping...',
            () => this.controller.deleteMapping(mappingId),
            { cancellable: false, kind: 'deleteMapping' }
          );
          this.controller.ui.notify('Mapping deleted.', 'success');
          await this.post({ type: 'mappingSaved' });
          await this.postState();
          return;
        }
        case 'connect':
          this.cancelConnect = () => this.controller.disconnect(mappingId, targetId);
          await this.withProgressOperation('Connecting...', (progress, token) => this.controller.connect(mappingId, targetId, progress, token), { kind: 'connect' });
          await this.post({ type: 'clearSelection' });
          await this.postState();
          return;
        case 'connectEnabled':
          this.cancelConnect = () => this.controller.disconnectEnabledTargets(mappingId);
          await this.withProgressOperation('Connecting targets...', (progress, token) =>
            this.controller.connectEnabledTargets(mappingId, progress, token),
            { kind: 'connect' }
          );
          await this.postState();
          return;
        case 'disconnect':
          this.maintenanceOperations.get(mappingId)?.source.cancel();
          await this.withProgressOperation(
            'Disconnecting...',
            () => this.controller.disconnect(mappingId, targetId),
            { cancellable: false, kind: 'disconnect' }
          );
          await this.postState();
          return;
        case 'disconnectEnabled':
          this.maintenanceOperations.get(mappingId)?.source.cancel();
          await this.withProgressOperation(
            'Disconnecting targets...',
            progress => this.controller.disconnectEnabledTargets(mappingId, progress),
            { cancellable: false, kind: 'disconnect' }
          );
          await this.postState();
          return;
        case 'reconnect':
          this.cancelConnect = () => this.controller.disconnect(mappingId, targetId);
          await this.withProgressOperation('Reconnecting...', (progress, token) => this.controller.reconnect(mappingId, targetId, progress, token), { kind: 'reconnect' });
          await this.post({ type: 'clearSelection' });
          await this.postState();
          return;
        case 'compare':
          this.startMaintenance(mappingId, 'Refreshing...', (progress, token) => this.controller.compare(mappingId, targetId, progress, token));
          await this.post({ type: 'clearSelection' });
          await this.postState();
          return;
        case 'compareEnabled':
          this.startMaintenance(mappingId, 'Refreshing targets...', (progress, token) =>
            this.controller.compareEnabledTargets(mappingId, progress, token));
          await this.post({ type: 'clearSelection' });
          await this.postState();
          return;
        case 'resetBaseline': {
          const mapping = this.controller.mappings.get(mappingId);
          const allEnabled = targetId === '__all_enabled__';
          const targets = allEnabled ? mapping?.targets.filter(item => item.enabled) || []
            : mapping?.targets.filter(item => item.id === targetId && item.enabled) || [];
          if (!mapping || !targets.length) throw new Error('The selected Workspace Sync mapping target no longer exists or is disabled.');
          // Validate the complete selection before displaying a destructive
          // history-maintenance confirmation or clearing any baseline.
          if (allEnabled) {
            for (const target of targets) {
              const key = `mapping:${mapping.id}:target:${target.id}`;
              if (this.controller.sessions.getState(key).status !== 'connected'
                || !this.controller.sessions.getSession(key)) {
                throw new Error(`Connect all enabled targets before resetting their baselines (${target.name} is not connected).`);
              }
            }
          }
          const confirmed = await this.confirm(
            allEnabled
              ? `Reset the synchronization baselines for all ${targets.length} enabled targets of '${mapping.name}'?`
              : `Reset the synchronization baseline for '${mapping.name} / ${targets[0].name}'?`,
            {
              modal: true,
              detail: 'Local and Remote files will not be modified. Workspace Sync will no longer know which side changed for differing paths until a new baseline is established.'
            },
            'Reset Baseline'
          );
          if (confirmed !== 'Reset Baseline') return;
          this.startMaintenance(mappingId, 'Resetting baseline...', (progress, token) =>
            allEnabled
              ? this.controller.resetBaselineEnabledTargets(mappingId, progress, token)
              : this.controller.resetBaseline(mappingId, targetId, progress, token));
          await this.post({ type: 'clearSelection' });
          await this.postState();
          return;
        }
        case 'sync': {
          const resolutions = this.parseConflictResolutionChanges(message.resolutions);
          if (Object.keys(resolutions).length) {
            await this.controller.setConflictResolutions(mappingId, targetId, resolutions);
          }
          const result = await this.withProgressOperation('Syncing...', (progress, token) => this.controller.executeCurrentPlan(mappingId, targetId, progress, token), { kind: 'sync' });
          this.showExecutionResult(result);
          await this.postState();
          return;
        }
        case 'syncEnabled': {
          const requestedTargets = Array.isArray(message.targets)
            ? message.targets
              .map((item: any) => ({
                targetId: String(item?.targetId || ''),
                resolutions: this.parseConflictResolutionChanges(item?.resolutions)
              }))
              .filter((item: { targetId: string }) => Boolean(item.targetId))
            : [];
          if (!requestedTargets.length) throw new Error('No connected Workspace Sync target has a sync plan to execute.');
          for (const item of requestedTargets) {
            if (Object.keys(item.resolutions).length) {
              await this.controller.setConflictResolutions(mappingId, item.targetId, item.resolutions);
            }
          }
          const result = await this.withProgressOperation('Syncing targets...', (progress, token) =>
            this.controller.executeCurrentPlansAcrossTargets(mappingId, requestedTargets.map((item: { targetId: string }) => item.targetId), progress, token),
            { kind: 'sync' }
          );
          this.showExecutionResult(result);
          await this.postState();
          return;
        }
        case 'uploadSelected':
        case 'downloadSelected': {
          const direction = message.type === 'uploadSelected' ? 'upload' : 'download';
          const paths = Array.isArray(message.paths) ? message.paths.map(String) : [];
          const selections = Array.isArray(message.selections)
            ? message.selections
              .map((selection: any) => ({
                targetId: String(selection?.targetId || ''),
                relativePaths: Array.isArray(selection?.paths) ? selection.paths.map(String) : []
              }))
              .filter((selection: { targetId: string; relativePaths: string[] }) => selection.targetId && selection.relativePaths.length)
            : [];
          const selectedCount = selections.length
            ? selections.reduce((count: number, selection: { relativePaths: string[] }) => count + selection.relativePaths.length, 0)
            : paths.length;
          const confirmed = await this.confirm(
            `${direction === 'upload' ? 'Upload' : 'Download'} ${selectedCount} selected path(s)?`,
            { modal: true },
            direction === 'upload' ? 'Upload' : 'Download'
          );
          if (!confirmed) return;
          const result = await this.withProgressOperation(direction === 'upload' ? 'Uploading...' : 'Downloading...', (progress, token) =>
            selections.length
              ? this.controller.executeSelectedAcrossTargets(mappingId, selections, direction, progress, token)
              : this.controller.executeSelected(mappingId, targetId, paths, direction, progress, token),
            { kind: direction }
          );
          this.showExecutionResult(result);
          await this.postState();
          return;
        }
        case 'openDiff':
          await this.withBusy('Loading comparison...', async () => {
            const comparison = await this.controller.openDiff(mappingId, targetId, String(message.relativePath || ''));
            await this.post({ type: 'comparison', comparison });
          });
          return;
        case 'openDiffInVsCode':
          await this.withBusy('Opening VS Code comparison...', async () => {
            await this.controller.openDiffInVsCode(mappingId, targetId, String(message.relativePath || ''));
          });
          return;
      }
    } catch (error) {
      const text = this.controller.ui.sanitize(error instanceof Error ? error.message : String(error));
      if (/cancelled/i.test(text)) {
        this.output.appendLine(`[Workspace Sync] ${text}`);
        this.controller.ui.notify('Workspace Sync operation cancelled.', 'warning');
        await this.postState();
        return;
      }
      this.output.appendLine(`[Workspace Sync] ${text}`);
      await this.post({ type: 'error', message: text });
      this.controller.ui.notify(text, 'error');
    } finally {
      this.handling = false;
      this.cancelConnect = undefined;
      await this.post({ type: 'interactionState', active: false });
    }
  }

  private async handlePreviewPlanMessage(message: any): Promise<void> {
    const mappingId = String(message?.mappingId || '');
    const requestId = Number(message?.requestId || 0);
    const requestedTargets = Array.isArray(message?.targets)
      ? message.targets
        .map((item: any) => ({
          targetId: String(item?.targetId || ''),
          resolutions: this.parseConflictResolutionChanges(item?.resolutions)
        }))
        .filter((item: { targetId: string }) => Boolean(item.targetId))
      : [];
    if (!requestedTargets.length) {
      await this.post({ type: 'previewPlanResult', requestId, mappingId, plans: [], error: 'No Workspace Sync target is available for Sync Review.' });
      return;
    }
    try {
      const plans = [];
      for (const item of requestedTargets) {
        plans.push({
          targetId: item.targetId,
          plan: await this.controller.previewPlanWithResolutions(mappingId, item.targetId, item.resolutions)
        });
      }
      await this.post({ type: 'previewPlanResult', requestId, mappingId, plans });
    } catch (error) {
      await this.post({
        type: 'previewPlanResult', requestId, mappingId, plans: [],
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async handleConflictResolutionMessage(message: any): Promise<void> {
    const mappingId = String(message?.mappingId || '');
    const targetId = String(message?.targetId || '');
    const relativePath = String(message?.relativePath || '');
    const requestId = Number(message?.requestId || 0);
    const rawResolution = message?.resolution;
    const resolution = rawResolution === null || rawResolution === undefined || rawResolution === ''
      ? undefined
      : String(rawResolution);

    try {
      if (resolution !== undefined && resolution !== 'useLocal' && resolution !== 'useRemote' && resolution !== 'skip') {
        throw new Error('Invalid Workspace Sync conflict resolution.');
      }
      await this.controller.setConflictResolution(mappingId, targetId, relativePath, resolution, false);
      const stateSequence = ++this.stateRequestSequence;
      await this.post({ type: 'resolutionState', state: await this.controller.getViewState(), stateSequence, mappingId, targetId, relativePath, requestId });
    } catch (error) {
      const text = this.controller.ui.sanitize(error instanceof Error ? error.message : String(error));
      this.output.appendLine(`[Workspace Sync] ${text}`);
      const stateSequence = ++this.stateRequestSequence;
      await this.post({ type: 'resolutionState', state: await this.controller.getViewState(), stateSequence, mappingId, targetId, relativePath, requestId, rejected: true });
      await this.post({ type: 'error', message: text });
      this.controller.ui.notify(text, 'error');
    }
  }

  private parseConflictResolutionChanges(value: unknown): Record<string, 'useLocal' | 'useRemote' | 'skip' | undefined> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Record<string, 'useLocal' | 'useRemote' | 'skip' | undefined> = {};
    for (const [relativePath, resolution] of Object.entries(value as Record<string, unknown>)) {
      if (!relativePath || (resolution !== null && resolution !== undefined
        && resolution !== 'useLocal' && resolution !== 'useRemote' && resolution !== 'skip')) {
        throw new Error('Invalid Workspace Sync conflict resolution.');
      }
      result[relativePath] = resolution === null || resolution === undefined ? undefined : resolution;
    }
    return result;
  }

  private confirm(message: string, options: { modal?: boolean; detail?: string }, ...choices: string[]): Promise<string | undefined> {
    return this.controller.ui.confirm(message, choices, options.detail);
  }


  private showExecutionResult(result: { failed: number; stale: number; cancelled: boolean }): void {
    if (result.cancelled) this.controller.ui.notify('Workspace Sync was cancelled.');
    else if (result.stale) this.controller.ui.notify(`Workspace Sync stopped: ${result.stale} path(s) failed validation. See Activity for details and run Refresh again.`, 'warning');
    else if (result.failed) this.controller.ui.notify(`Workspace Sync finished with ${result.failed} failed operation(s). See Activity for the original error and suggested action.`, 'error');
    else this.controller.ui.notify('Workspace Sync completed.', 'success');
  }


  private async withBusy<T>(label: string, action: () => Promise<T>): Promise<T> {
    return this.withProgressOperation(label, () => action(), { cancellable: false, kind: 'comparison' });
  }

  private startMaintenance(
    mappingId: string,
    label: string,
    action: (
      progress: (progress: import('../types').WorkspaceSyncProgress) => void,
      token: vscode.CancellationToken
    ) => Promise<unknown>
  ): void {
    if (this.maintenanceOperations.has(mappingId)) {
      throw new Error('Refresh or Reset Baseline is already running for this mapping.');
    }
    const source = new vscode.CancellationTokenSource();
    const id = ++this.operationSequence;
    this.maintenanceOperations.set(mappingId, { id, source });
    void this.post({ type: 'maintenanceState', mappingId, maintenanceId: id, active: true, label });
    this.controller.ui.log(label);
    // Deliberately detached: the mapping/target selectors, Connect, New and
    // Manage remain responsive while the operation queues do the actual work.
    void Promise.resolve().then(() => action(progress => {
      void this.post({ type: 'maintenanceProgress', mappingId, maintenanceId: id, progress });
    }, source.token)).catch(error => {
      const detail = this.controller.ui.sanitize(error instanceof Error ? error.message : String(error));
      if (source.token.isCancellationRequested || /cancelled/i.test(detail)) {
        this.controller.ui.notify('Workspace Sync maintenance cancelled.', 'warning');
      } else {
        this.output.appendLine(`[Workspace Sync] ${detail}`);
        this.controller.ui.notify(detail, 'error');
      }
    }).finally(async () => {
      // A previous task must never remove a newer one's status.
      if (this.maintenanceOperations.get(mappingId)?.id === id) this.maintenanceOperations.delete(mappingId);
      source.dispose();
      await this.post({ type: 'maintenanceState', mappingId, maintenanceId: id, active: false });
      await this.postState();
    });
  }

  private async withProgressOperation<T>(
    title: string,
    action: (
      report: (progress: import('../types').WorkspaceSyncProgress) => void,
      cancellationToken: vscode.CancellationToken
    ) => Promise<T>,
    options: { cancellable?: boolean; kind?: WorkspaceSyncOperationKind } = {}
  ): Promise<T> {
    if (this.activeOperation) throw new Error('Another Workspace Sync operation is already running.');
    const source = new vscode.CancellationTokenSource();
    const operation = {
      id: ++this.operationSequence,
      source,
      cancelling: false,
      cancellable: options.cancellable !== false,
      kind: options.kind || 'sync'
    };
    this.activeOperation = operation;
    await this.post({
      type: 'operationState',
      active: true,
      label: title,
      kind: operation.kind,
      operationId: operation.id,
      cancellable: operation.cancellable
    });
    try {
      this.controller.ui.log(title);
      return await action(state => {
        void this.post({ type: 'operationProgress', progress: state, operationId: operation.id });
      }, source.token);
    } finally {
      if (this.activeOperation?.id === operation.id) this.activeOperation = undefined;
      source.dispose();
      await this.post({ type: 'operationState', active: false, operationId: operation.id });
    }
  }

  private async postState(): Promise<void> {
    const stateSequence = ++this.stateRequestSequence;
    await this.post({ type: 'state', state: await this.controller.getViewState(), stateSequence });
  }

  private async post(message: unknown): Promise<void> {
    if (!this.disposed) await this.panel.webview.postMessage(message);
  }
}

function loadWorkspaceSyncSvg(extensionUri: vscode.Uri, fileName: string): string {
  const icon = vscode.Uri.joinPath(extensionUri, 'resources', fileName);
  try {
    const svg = fs.readFileSync(icon.fsPath, 'utf8').trim();
    return /^<svg\b/i.test(svg) ? svg : '';
  } catch {
    return '';
  }
}
