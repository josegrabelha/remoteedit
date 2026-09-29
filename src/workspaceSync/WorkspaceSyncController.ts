import { WorkspaceSyncUi, type SyncActivity } from './ui/WorkspaceSyncUi';
import { WorkspaceSyncActivityStore } from './ui/WorkspaceSyncActivityStore';
import { compareText } from './compare/TextComparison';
import { assertLocalPathAncestorsSafe, assertLocalRegularFile, assertRemotePathAncestorsSafe } from './execution/PathSafety';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { WorkspaceSyncConnectionConfigSource } from './connection/WorkspaceSyncConnectionConfigSource';
import { appendOutputLog } from '../utils/outputLogger';
import type { WorkspaceSyncDiagnostics } from './WorkspaceSyncDiagnostics';
import { createWorkspaceSyncDiagnostics } from './WorkspaceSyncDiagnosticsFactory';
import { WorkspaceMappingStore } from './mapping/WorkspaceMappingStore';
import { BaselineStore } from './baseline/BaselineStore';
import { WorkspaceSyncSessionManager } from './connection/WorkspaceSyncSessionManager';
import { scanLocalTree } from './scan/LocalScanner';
import { scanRemoteTree } from './scan/RemoteScanner';
import { diffSnapshots } from './compare/DiffEngine';
import { verifyComparisonContent } from './compare/ContentVerifier';
import { protectCaseCollisions } from './compare/PathCollisionDetector';
import { detectLocalCaseSensitivity } from './compare/LocalFilesystemCapabilities';
import { WorkspaceSyncDiffTempStore } from './compare/DiffTempStore';
import { buildSyncPlan } from './planning/SyncPlanner';
import { localFilenameStyle } from './planning/PathCompatibility';
import { revalidateSyncPlan } from './planning/SyncRevalidator';
import { executeSyncPlan } from './execution/SyncExecutor';
import { describeSyncOperationFailure } from './execution/OperationFailureDetails';
import { TargetOperationQueue } from './execution/TargetOperationQueue';
import { LocalRootOperationCoordinator } from './execution/LocalRootOperationCoordinator';
import { validateUniqueMappingRoutes, validateUniqueTargetDestinations, type WorkspaceMappingInput } from './mapping/WorkspaceMapping';
import { loadEffectiveIgnorePatterns } from './ignore/IgnoreRules';
import { IgnoreMatcher } from './ignore/IgnoreMatcher';
import { OperationJournal } from './watcher/OperationJournal';
import { WorkspaceWatcher, type WorkspaceLocalChange } from './watcher/WorkspaceWatcher';
import { RemoteWorkspaceWatcher } from './watcher/RemoteWorkspaceWatcher';
import { collectRemoteWatchChangedPaths } from './watcher/RemoteWatchDiff';
import { initialWatchReconcileDecision, isLocalChangeEnabled, isWatchSourceAuthoritative } from './watcher/WatcherCoalescing';
import { collectWatchedDeletePaths } from './watcher/WatchedDeletePlan';
import { readLocalFingerprint, readRemoteFingerprint } from './snapshot/CurrentState';
import { fingerprintsEqual } from './snapshot/FileFingerprint';
import { resolveSyncPaths } from './execution/SyncPathUtils';
import { WorkspaceSyncLastKnownViewStore } from './view/LastKnownViewStore';
import type {
  BaselineEntry,
  DiffEntry,
  FileFingerprint,
  SyncOperation,
  SyncPlan,
  SyncSnapshot,
  WorkspaceSyncConflictResolution,
  WorkspaceSyncConnectionSummary,
  WorkspaceSyncMapping,
  WorkspaceSyncProgress,
  WorkspaceSyncTarget,
  WorkspaceSyncTargetSummary
} from './types';


interface RemoteWatchSnapshotState {
  snapshot: SyncSnapshot;
  connectionIdentity: string;
  mappingUpdatedAt: number;
  targetUpdatedAt: number;
}

interface AutomaticPathObservation {
  local?: FileFingerprint;
  remote?: FileFingerprint;
  localKnown?: boolean;
  remoteKnown?: boolean;
  localRelativePath?: string;
  remoteRelativePath?: string;
  forceConflictReason?: string;
}

interface MappingRuntimeState {
  local?: SyncSnapshot;
  remote?: SyncSnapshot;
  diffs: DiffEntry[];
  plan?: SyncPlan;
  lastComparedAt?: number;
}

interface RefreshFlight {
  desiredStamp: string;
  desiredRun: () => Promise<MappingRuntimeState>;
  promise: Promise<MappingRuntimeState>;
}

interface SharedRefreshContext {
  ignorePatterns: string[];
  getLocalSnapshot: () => Promise<SyncSnapshot>;
}

const MAX_PARALLEL_TARGET_REFRESHES = 4;
const MAX_PARALLEL_TARGET_SYNCS = 2;

export interface WorkspaceSyncTargetViewState {
  targetId: string;
  targetName: string;
  diffs: DiffEntry[];
  plan?: SyncPlan;
  lastComparedAt?: number;
  showingLastKnownState?: boolean;
}

export interface WorkspaceSyncBackgroundActivity {
  active: boolean;
  kind: 'refresh';
  label: string;
  mappingId?: string;
  detail?: string;
}

export interface WorkspaceSyncViewState {
  connections: WorkspaceSyncConnectionSummary[];
  mappings: WorkspaceSyncMapping[];
  activeMappingId?: string;
  activeTargetId?: string;
  targetStates: WorkspaceSyncTargetSummary[];
  targetViews: WorkspaceSyncTargetViewState[];
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  connectionMessage?: string;
  connectionConfigChanged?: boolean;
  diffs: DiffEntry[];
  plan?: SyncPlan;
  lastComparedAt?: number;
  showingLastKnownState?: boolean;
}


export class WorkspaceSyncController implements vscode.Disposable {
  readonly ui: WorkspaceSyncUi;
  private readonly uiSubscriptions: vscode.Disposable[] = [];
  readonly mappings: WorkspaceMappingStore;
  readonly baselines: BaselineStore;
  readonly sessions: WorkspaceSyncSessionManager;
  private readonly journal = new OperationJournal();
  private readonly operations = new TargetOperationQueue();
  private readonly localRootOperations = new LocalRootOperationCoordinator();
  /** Manual Disconnect takes effect immediately for queued automatic work. */
  private readonly disconnectRequested = new Set<string>();
  private readonly watcher: WorkspaceWatcher;
  private readonly remoteWatcher: RemoteWorkspaceWatcher;
  private readonly remoteWatchSnapshots = new Map<string, RemoteWatchSnapshotState>();
  private readonly runtimeByTarget = new Map<string, MappingRuntimeState>();
  /** Coalesces duplicate Refresh requests for the same target/config revision. */
  private readonly refreshFlights = new Map<string, RefreshFlight>();
  private readonly lastViews: WorkspaceSyncLastKnownViewStore;
  private readonly diffTempStore: WorkspaceSyncDiffTempStore;
  private readonly localCaseSensitivityByRoot = new Map<string, boolean | undefined>();
  private readonly localCaseSensitivityFlights = new Map<string, Promise<boolean | undefined>>();
  /** Paths that require hash verification after a failed/interrupted transfer. */
  private readonly strongVerificationPaths = new Map<string, Set<string>>();
  /** Exact internal atomic-upload temp paths whose best-effort cleanup failed. */
  private readonly orphanedRemoteTemps = new Map<string, Map<string, string>>();
  private watchRefreshGeneration = 0;
  private automaticViewNotificationTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly automaticViewDirtyMappings = new Set<string>();
  private readonly viewStateChangedEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeViewState = this.viewStateChangedEmitter.event;
  private readonly backgroundActivityEmitter = new vscode.EventEmitter<WorkspaceSyncBackgroundActivity>();
  readonly onDidChangeBackgroundActivity = this.backgroundActivityEmitter.event;
  private readonly diagnostics: WorkspaceSyncDiagnostics;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connectionManager: WorkspaceSyncConnectionConfigSource,
    private readonly output: vscode.OutputChannel
  ) {
    this.ui = new WorkspaceSyncUi(new WorkspaceSyncActivityStore(context.globalState));
    this.diagnostics = createWorkspaceSyncDiagnostics(output);
    this.mappings = new WorkspaceMappingStore(context);
    this.baselines = new BaselineStore(context);
    this.lastViews = new WorkspaceSyncLastKnownViewStore(context);
    this.sessions = new WorkspaceSyncSessionManager(connectionManager, output, undefined, this.ui);
    this.diffTempStore = new WorkspaceSyncDiffTempStore(path.join(context.globalStorageUri.fsPath, 'workspace-sync', 'diff'));
    this.watcher = new WorkspaceWatcher(change => this.handleWatchedChange(change), output);
    this.remoteWatcher = new RemoteWorkspaceWatcher(
      request => this.pollRemoteChanges(request.mappingId, request.targetId),
      output,
      (request, message) => {
        const mapping = this.mappings.get(request.mappingId);
        const target = mapping?.targets.find(item => item.id === request.targetId);
        this.log('WARN', `Remote Watch failed${mapping && target ? `: ${mapping.name} / ${target.name}` : ''}. ${message}`);
      }
    );
    this.uiSubscriptions.push(this.sessions.onDidChange(state => {
      for (const mapping of this.mappings.list()) {
        const target = mapping.targets.find(item => this.sessionKey(mapping.id, item.id) === state.sessionKey);
        if (target) this.ui.log(state.message || `${state.status[0].toUpperCase()}${state.status.slice(1)}.`, state.status === 'error' ? 'error' : state.status === 'connected' ? 'success' : 'info', `${mapping.name} / ${target.name}`);
      }
    }));
    // Register Watch handlers, but never connect or reconcile automatically at startup.
    // Watch reconciliation begins only after the user explicitly connects a target.
    this.refreshWatchers();
  }

  dispose(): void {
    this.uiSubscriptions.forEach(item => item.dispose());
    this.ui.dispose();
    this.watcher.dispose();
    this.remoteWatcher.dispose();
    this.remoteWatchSnapshots.clear();
    this.refreshFlights.clear();
    this.localCaseSensitivityFlights.clear();
    this.strongVerificationPaths.clear();
    this.orphanedRemoteTemps.clear();
    if (this.automaticViewNotificationTimer) clearTimeout(this.automaticViewNotificationTimer);
    this.automaticViewNotificationTimer = undefined;
    this.automaticViewDirtyMappings.clear();
    this.sessions.dispose();
    this.baselines.dispose();
    this.viewStateChangedEmitter.dispose();
    this.backgroundActivityEmitter.dispose();
  }

  async getViewState(): Promise<WorkspaceSyncViewState> {
    const profiles = await this.connectionManager.listProfiles();
    const mappings = this.mappings.list();
    const activeMapping = this.mappings.getActive() || mappings[0];
    const activeTarget = activeMapping ? this.mappings.getActiveTarget(activeMapping) : undefined;
    const connectionProfiles = new Map(profiles.map(profile => [profile.id, profile]));

    const targetStates: WorkspaceSyncTargetSummary[] = activeMapping
      ? activeMapping.targets.map(target => {
        const state = this.sessions.getState(this.sessionKey(activeMapping.id, target.id));
        const profile = connectionProfiles.get(target.connectionId);
        return {
          targetId: target.id,
          targetName: target.name,
          connectionName: profile?.name || 'Missing connection',
          status: state.status,
          message: state.message,
          connectionConfigChanged: state.status === 'connected'
            && state.profileUpdatedAt !== undefined
            && profile !== undefined
            && profile.updatedAt !== state.profileUpdatedAt
        };
      })
      : [];

    // Keep a lightweight view for every target in the active mapping so the
    // webview can render All Enabled without changing the active target or
    // merging target baselines. Runtime/baseline ownership remains strictly
    // mapping + target.
    const targetViews: WorkspaceSyncTargetViewState[] = activeMapping
      ? await Promise.all(activeMapping.targets.map(async target => {
        const runtime = this.runtimeByTarget.get(this.runtimeKey(activeMapping.id, target.id));
        const lastKnown = runtime ? undefined : await this.lastViews.get(activeMapping, target);
        const sessionState = this.sessions.getState(this.sessionKey(activeMapping.id, target.id));
        return {
          targetId: target.id,
          targetName: target.name,
          diffs: runtime?.diffs || lastKnown?.diffs || [],
          plan: target.enabled && sessionState.status === 'connected' ? runtime?.plan : undefined,
          lastComparedAt: runtime?.lastComparedAt || lastKnown?.lastRefreshedAt,
          showingLastKnownState: Boolean((runtime || lastKnown) && sessionState.status !== 'connected') || Boolean(!runtime && lastKnown)
        };
      }))
      : [];

    const activeView = activeTarget
      ? targetViews.find(view => view.targetId === activeTarget.id)
      : undefined;
    const sessionState = activeMapping && activeTarget
      ? this.sessions.getState(this.sessionKey(activeMapping.id, activeTarget.id))
      : { status: 'disconnected' as const, message: undefined };
    const activeProfile = activeTarget ? connectionProfiles.get(activeTarget.connectionId) : undefined;
    const connectionConfigChanged = sessionState.status === 'connected'
      && sessionState.profileUpdatedAt !== undefined
      && activeProfile !== undefined
      && activeProfile.updatedAt !== sessionState.profileUpdatedAt;

    return {
      connections: profiles.map(profile => ({
        id: profile.id,
        name: profile.name,
        connectionType: profile.connectionType,
        host: profile.host,
        port: profile.port,
        username: profile.username
      })),
      mappings,
      activeMappingId: activeMapping?.id,
      activeTargetId: activeTarget?.id,
      targetStates,
      targetViews,
      connectionStatus: sessionState.status,
      connectionMessage: sessionState.message,
      connectionConfigChanged,
      diffs: activeView?.diffs || [],
      plan: activeView?.plan,
      lastComparedAt: activeView?.lastComparedAt,
      showingLastKnownState: activeView?.showingLastKnownState
    };
  }

  async saveMapping(input: WorkspaceMappingInput): Promise<WorkspaceSyncMapping> {
    await this.validateMappingInput(input);
    const before = input.id ? this.mappings.get(input.id) : undefined;
    const mapping = await this.mappings.save(input);
    const ignorePatternsChanged = before !== undefined
      && !stringArraysEqual(before.options.ignorePatterns, mapping.options.ignorePatterns);

    if (before) {
      const localRootChanged = before.localRoot !== mapping.localRoot;
      if (localRootChanged) {
        this.localCaseSensitivityByRoot.delete(before.localRoot);
        this.localCaseSensitivityFlights.delete(before.localRoot);
        await this.baselines.clear(mapping.id);
        await this.lastViews.clear(mapping.id);
      }

      const nextTargets = new Map(mapping.targets.map(target => [target.id, target]));
      for (const previousTarget of before.targets) {
        const nextTarget = nextTargets.get(previousTarget.id);
        if (!nextTarget) {
          this.disconnectRequested.add(this.sessionKey(mapping.id, previousTarget.id));
          await this.operations.run(this.runtimeKey(mapping.id, previousTarget.id), () =>
            this.sessions.disconnect(this.sessionKey(mapping.id, previousTarget.id))
          );
          this.runtimeByTarget.delete(this.runtimeKey(mapping.id, previousTarget.id));
          await this.lastViews.clear(mapping.id, previousTarget.id);
          if (!localRootChanged) await this.baselines.clear(mapping.id, previousTarget.id);
          continue;
        }

        const connectionChanged = previousTarget.connectionId !== nextTarget.connectionId;
        const remoteRootChanged = previousTarget.remoteRoot !== nextTarget.remoteRoot;
        const disabled = previousTarget.enabled && !nextTarget.enabled;
        if (!localRootChanged && (connectionChanged || remoteRootChanged)) {
          await this.baselines.clear(mapping.id, nextTarget.id);
          await this.lastViews.clear(mapping.id, nextTarget.id);
        }
        if (connectionChanged || disabled) {
          this.disconnectRequested.add(this.sessionKey(mapping.id, nextTarget.id));
          await this.operations.run(this.runtimeKey(mapping.id, nextTarget.id), () =>
            this.sessions.disconnect(this.sessionKey(mapping.id, nextTarget.id))
          );
        }
      }
    }

    for (const target of mapping.targets) {
      this.runtimeByTarget.delete(this.runtimeKey(mapping.id, target.id));
    }

    if (ignorePatternsChanged) {
      // A cached view was built with the previous Ignore rules. It cannot be
      // filtered safely in memory because removing an Ignore pattern can reveal
      // paths that were never scanned. Clear the stale list synchronously so a
      // successful Save can close the modal immediately, then rebuild connected
      // targets asynchronously in the normal Workspace Sync view.
      await this.lastViews.clear(mapping.id);
      this.refreshWatchers();
      void this.refreshConnectedTargetsAfterIgnoreChange(mapping).catch(error => {
        this.log('WARN', `Workspace Sync refresh after Ignore change failed: ${mapping.name}. ${error instanceof Error ? error.message : String(error)}`);
      });
    } else {
      this.refreshWatchers([mapping.id]);
    }

    this.ui.notify(`Mapping saved: ${mapping.name}.`, 'success');
    return mapping;
  }

  async deleteMapping(mappingId: string): Promise<void> {
    const mapping = this.mappings.get(mappingId);
    if (mapping) {
      for (const target of mapping.targets) this.disconnectRequested.add(this.sessionKey(mappingId, target.id));
      await Promise.all(mapping.targets.map(target =>
        this.operations.run(this.runtimeKey(mappingId, target.id), () =>
          this.sessions.disconnect(this.sessionKey(mappingId, target.id))
        )
      ));
      for (const target of mapping.targets) this.runtimeByTarget.delete(this.runtimeKey(mappingId, target.id));
    }
    await this.baselines.clear(mappingId);
    await this.lastViews.clear(mappingId);
    await this.mappings.delete(mappingId);
    this.refreshWatchers();
  }

  async selectMapping(mappingId: string): Promise<void> {
    const mapping = this.mappings.get(mappingId);
    if (!mapping) throw new Error('The selected Workspace Sync mapping no longer exists.');
    await this.mappings.setActiveId(mappingId);
    const activeTargetId = this.mappings.getActiveTargetId(mapping.id);
    const activeTarget = activeTargetId ? mapping.targets.find(target => target.id === activeTargetId) : undefined;
    if (!activeTarget || (!activeTarget.enabled && mapping.targets.some(target => target.enabled))) {
      await this.mappings.setActiveTargetId(mapping.id, mapping.targets.find(target => target.enabled)?.id || activeTarget?.id || mapping.targets[0]?.id);
    }
  }

  async selectTarget(mappingId: string, targetId: string): Promise<void> {
    const mapping = this.requireMapping(mappingId);
    this.requireTarget(mapping, targetId);
    await this.mappings.setActiveTargetId(mappingId, targetId);
  }

  async reloadPersistentConfiguration(): Promise<void> {
    for (const mapping of this.mappings.list()) {
      for (const target of mapping.targets) this.disconnectRequested.add(this.sessionKey(mapping.id, target.id));
    }
    await this.sessions.disconnectAll();
    this.runtimeByTarget.clear();
    this.remoteWatchSnapshots.clear();
    // Restore Watch registrations without opening remote connections.
    this.refreshWatchers();
    this.ui.log('Workspace Sync configuration reloaded from persistent storage.');
  }

  async connect(
    mappingId: string,
    targetId: string,
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<void> {
    const mapping = this.requireMapping(mappingId);
    const target = this.requireEnabledTarget(mapping, targetId);
    const key = this.runtimeKey(mapping.id, target.id);
    const sessionKey = this.sessionKey(mapping.id, target.id);
    this.disconnectRequested.delete(sessionKey);
    this.runtimeByTarget.delete(key);
    const connectTimer = this.diagnostics.timer();
    this.diagnostics.debug('Controller', 'Connect started.', { Mapping: mapping.name, Target: target.name });
    let connectOutcome = 'completed';
    try {
      await this.operations.run(key, async () => {
        let session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession | undefined;
        try {
          session = await this.sessions.connect(sessionKey, target.connectionId);
          await this.ensureBaselineContext(mapping, target, session);
          await this.cleanupKnownOrphanedRemoteTemps(mapping, target, session);
          await this.localRootOperations.run(mapping.localRoot, async () => {
            const runtime = await this.compareTargetCore(mapping, target, progress, cancellationToken);
            if (cancellationToken?.isCancellationRequested) return;
            await this.reconcileWatchRuntimeCore(mapping, target, session!, runtime, this.watchRefreshGeneration);
          });

          if (cancellationToken?.isCancellationRequested) {
            await this.sessions.disconnectSessionIfCurrent(sessionKey, session);
          }
        } catch (error) {
          if (session) {
            if (cancellationToken?.isCancellationRequested) {
              await this.sessions.disconnectSessionIfCurrent(sessionKey, session);
            } else {
              await this.sessions.failConnectedSession(sessionKey, session, error);
            }
          }
          throw error;
        }
      });
      if (cancellationToken?.isCancellationRequested) connectOutcome = 'cancelled';
      this.diagnostics.debug('Controller', 'Connect preparation completed.', { Mapping: mapping.name, Target: target.name, Outcome: connectOutcome });
    } catch (error) {
      connectOutcome = cancellationToken?.isCancellationRequested ? 'cancelled' : 'failed';
      this.diagnostics.debug('Controller', 'Connect preparation failed.', {
        Mapping: mapping.name,
        Target: target.name,
        Outcome: connectOutcome,
        Error: this.ui.sanitize(error instanceof Error ? error.message : String(error))
      });
      throw error;
    } finally {
      this.diagnostics.performance('Controller', `Connect ${connectOutcome} in ${formatDuration(connectTimer())}.`, { Mapping: mapping.name, Target: target.name });
      // Automatic handlers are registered only after the complete
      // Connect -> Compare -> initial Watch reconciliation sequence succeeds.
      // A failed/cancelled preparation closes the private session first.
      this.refreshWatchers();
    }
  }

  async disconnect(mappingId: string, targetId: string): Promise<void> {
    const disconnectTimer = this.diagnostics.timer();
    this.diagnostics.debug('Controller', 'Disconnect started.', { MappingId: mappingId, TargetId: targetId });
    const sessionKey = this.sessionKey(mappingId, targetId);
    // Record the user's intent before waiting for the target queue. Automatic
    // work already waiting behind another target/root operation must not run
    // merely because the physical session has not closed yet.
    this.disconnectRequested.add(sessionKey);
    // Stop Local Watch / Upload on Save / Remote Watch immediately, even if
    // the physical disconnect must wait behind already queued target work.
    this.refreshWatchers();
    try {
      await this.operations.run(this.runtimeKey(mappingId, targetId), () =>
        this.sessions.disconnect(sessionKey)
      );
    } finally {
      this.refreshWatchers();
      this.diagnostics.performance('Controller', `Disconnect completed in ${formatDuration(disconnectTimer())}.`, { MappingId: mappingId, TargetId: targetId });
    }
  }

  async connectEnabledTargets(
    mappingId: string,
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<void> {
    const mapping = this.requireMapping(mappingId);
    const connectAllTimer = this.diagnostics.timer();
    const enabled = mapping.targets.filter(target => target.enabled);
    if (!enabled.length) throw new Error('This mapping has no enabled Workspace Sync targets.');
    if (cancellationToken?.isCancellationRequested) return;

    const profiles = new Map((await this.connectionManager.listProfiles()).map(profile => [profile.id, profile]));
    if (cancellationToken?.isCancellationRequested) return;

    const failures: unknown[] = [];
    // Connect enabled targets in mapping order. Each target must finish its
    // Connect -> Compare -> initial Watch reconciliation before the next target
    // can inspect or modify the same Local Root. Failures do not prevent later
    // targets from being attempted.
    for (const target of enabled) {
      if (cancellationToken?.isCancellationRequested) return;
      try {
        const sessionKey = this.sessionKey(mapping.id, target.id);
        const state = this.sessions.getState(sessionKey);
        const profile = profiles.get(target.connectionId);
        const configChanged = state.status === 'connected'
          && state.profileUpdatedAt !== undefined
          && profile !== undefined
          && profile.updatedAt !== state.profileUpdatedAt;
        if (state.status === 'connected' && !configChanged) {
          // All Enabled is explicit user intent to keep this target connected,
          // even when no new physical connection is necessary.
          this.disconnectRequested.delete(sessionKey);
          continue;
        }
        if (configChanged) await this.reconnect(mapping.id, target.id, progress, cancellationToken);
        else await this.connect(mapping.id, target.id, progress, cancellationToken);
      } catch (error) {
        failures.push(error);
      }
    }

    // An already-connected target may only have needed its Disconnect intent
    // cleared above, so refresh registrations even when no physical Connect ran.
    this.refreshWatchers();

    // Cancellation is not a partial-connect failure. The panel's cancellation
    // cleanup disconnects enabled targets after the current serialized target
    // operation unwinds.
    if (cancellationToken?.isCancellationRequested) return;

    this.diagnostics.performance('Controller', `Connect All Enabled completed in ${formatDuration(connectAllTimer())}.`, {
      Mapping: mapping.name,
      Targets: enabled.length,
      Failures: failures.length
    });
    if (failures.length) {
      const first = failures[0];
      const detail = first instanceof Error ? first.message : String(first);
      throw new Error(`Could not connect ${failures.length} of ${enabled.length} enabled target(s). ${detail}`);
    }
  }

  async disconnectEnabledTargets(
    mappingId: string,
    progress?: (progress: WorkspaceSyncProgress) => void
  ): Promise<void> {
    const mapping = this.requireMapping(mappingId);
    const enabled = mapping.targets.filter(target => target.enabled);
    if (!enabled.length) throw new Error('This mapping has no enabled Workspace Sync targets.');

    let completed = 0;
    progress?.({ completed, total: enabled.length, phase: `Disconnecting 0 of ${enabled.length} target(s)...` });
    const results = await Promise.allSettled(enabled.map(async target => {
      try {
        await this.disconnect(mapping.id, target.id);
      } finally {
        completed += 1;
        progress?.({
          completed,
          total: enabled.length,
          currentPath: target.name,
          phase: `Disconnected ${completed} of ${enabled.length} target(s).`
        });
      }
    }));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) {
      const first = failures[0].reason;
      const detail = first instanceof Error ? first.message : String(first);
      throw new Error(`Could not disconnect ${failures.length} of ${enabled.length} enabled target(s). ${detail}`);
    }
  }

  async reconnect(
    mappingId: string,
    targetId: string,
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<void> {
    const mapping = this.requireMapping(mappingId);
    const target = this.requireEnabledTarget(mapping, targetId);
    const key = this.runtimeKey(mapping.id, target.id);
    const sessionKey = this.sessionKey(mapping.id, target.id);
    this.disconnectRequested.delete(sessionKey);
    this.runtimeByTarget.delete(key);
    const reconnectTimer = this.diagnostics.timer();
    this.diagnostics.debug('Controller', 'Reconnect started.', { Mapping: mapping.name, Target: target.name });
    let reconnectOutcome = 'completed';
    try {
      await this.operations.run(key, async () => {
        await this.sessions.disconnect(sessionKey);
        let session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession | undefined;
        try {
          session = await this.sessions.connect(sessionKey, target.connectionId);
          await this.ensureBaselineContext(mapping, target, session);
          await this.cleanupKnownOrphanedRemoteTemps(mapping, target, session);
          await this.localRootOperations.run(mapping.localRoot, async () => {
            const runtime = await this.compareTargetCore(mapping, target, progress, cancellationToken);
            if (cancellationToken?.isCancellationRequested) return;
            await this.reconcileWatchRuntimeCore(mapping, target, session!, runtime, this.watchRefreshGeneration);
          });

          if (cancellationToken?.isCancellationRequested) {
            await this.sessions.disconnectSessionIfCurrent(sessionKey, session);
          }
        } catch (error) {
          if (session) {
            if (cancellationToken?.isCancellationRequested) {
              await this.sessions.disconnectSessionIfCurrent(sessionKey, session);
            } else {
              await this.sessions.failConnectedSession(sessionKey, session, error);
            }
          }
          throw error;
        }
      });
    } catch (error) {
      reconnectOutcome = cancellationToken?.isCancellationRequested ? 'cancelled' : 'failed';
      this.diagnostics.debug('Controller', 'Reconnect failed.', { Mapping: mapping.name, Target: target.name, Error: this.ui.sanitize(error instanceof Error ? error.message : String(error)) });
      throw error;
    } finally {
      if (cancellationToken?.isCancellationRequested && reconnectOutcome === 'completed') reconnectOutcome = 'cancelled';
      this.refreshWatchers();
      this.diagnostics.performance('Controller', `Reconnect ${reconnectOutcome} in ${formatDuration(reconnectTimer())}.`, { Mapping: mapping.name, Target: target.name });
    }
  }

  async compare(
    mappingId: string,
    targetId: string,
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<MappingRuntimeState> {
    const mapping = this.requireMapping(mappingId);
    const target = this.requireEnabledTarget(mapping, targetId);
    return this.requestCoalescedRefresh(mapping, target, () =>
      this.operations.run(this.runtimeKey(mapping.id, target.id), () =>
        this.localRootOperations.runShared(mapping.localRoot, () =>
          this.compareTargetCore(mapping, target, progress, cancellationToken)
        )
      )
    );
  }

  async compareEnabledTargets(
    mappingId: string,
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<void> {
    const mapping = this.requireMapping(mappingId);
    const enabled = mapping.targets.filter(target => target.enabled);
    if (!enabled.length) throw new Error('This mapping has no enabled Workspace Sync targets.');

    // Refresh All Enabled never establishes sessions. Validate every target
    // before changing any runtime view so connection readiness is deterministic.
    for (const target of enabled) {
      if (this.sessions.getState(this.sessionKey(mapping.id, target.id)).status !== 'connected'
        || !this.sessions.getSession(this.sessionKey(mapping.id, target.id))) {
        throw new Error('Connect all enabled targets before refreshing All Enabled.');
      }
    }

    await this.refreshTargetsInParallel(mapping, enabled, progress, cancellationToken, false);
  }

  async resetBaseline(
    mappingId: string,
    targetId: string,
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<MappingRuntimeState> {
    const mapping = this.requireMapping(mappingId);
    const target = this.requireEnabledTarget(mapping, targetId);
    const runtimeKey = this.runtimeKey(mapping.id, target.id);
    const sessionKey = this.sessionKey(mapping.id, target.id);

    return this.operations.run(runtimeKey, async () => {
      if (this.sessions.getState(sessionKey).status !== 'connected' || !this.sessions.getSession(sessionKey)) {
        throw new Error('Connect the selected target before resetting its Workspace Sync baseline.');
      }

      return this.localRootOperations.run(mapping.localRoot, async () => {
        // Reset only synchronization history for this exact mapping/target. Local
        // and Remote content are never modified by this maintenance action. Any
        // view/verification state derived from the old baseline is invalid too.
        await this.baselines.clear(mapping.id, target.id);
        await this.lastViews.clear(mapping.id, target.id);
        this.runtimeByTarget.delete(runtimeKey);
        this.remoteWatchSnapshots.delete(runtimeKey);
        this.strongVerificationPaths.delete(runtimeKey);
        this.viewStateChangedEmitter.fire();
        this.ui.log('Baseline reset. Local and Remote files were not modified.', 'info', `${mapping.name} / ${target.name}`);

        return this.compareTargetCore(mapping, target, progress, cancellationToken);
      });
    });
  }

  private async compareTargetCore(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean },
    shared?: SharedRefreshContext
  ): Promise<MappingRuntimeState> {
    const refreshStartedAt = Date.now();
    this.diagnostics.debug('Refresh', 'Refresh started.', { Mapping: mapping.name, Target: target.name });
    const session = this.requireSession(mapping.id, target.id);
    await this.ensureBaselineContext(mapping, target, session);
    this.ui.log('Refreshing local and remote files...', 'info', `${mapping.name} / ${target.name}`);
    const ignorePatterns = shared?.ignorePatterns || await loadEffectiveIgnorePatterns(mapping);
    let localCount = 0;
    let remoteCount = 0;
    progress?.({ completed: 0, total: 0, phase: 'Scanning local and remote files...' });

    const localStartedAt = Date.now();
    const localPromise = shared
      ? shared.getLocalSnapshot()
      : scanLocalTree(mapping.localRoot, {
        ignorePatterns,
        cancellationToken,
        onProgress: (count, relativePath) => {
          localCount = count;
          progress?.({ completed: localCount + remoteCount, total: 0, currentPath: relativePath, phase: 'Scanning local files...' });
        }
      }).then(snapshot => {
        localCount = Object.keys(snapshot.entries).length;
        this.logRefreshTiming(mapping, undefined, `Local scan completed in ${formatDuration(Date.now() - localStartedAt)} (${localCount} entries).`);
        return snapshot;
      });

    const remoteStartedAt = Date.now();
    const remotePromise = scanRemoteTree(session, target.remoteRoot, {
      ignorePatterns,
      concurrency: session.capabilities.maxConcurrentMetadata,
      cancellationToken,
      onProgress: (count, relativePath) => {
        remoteCount = count;
        progress?.({ completed: localCount + remoteCount, total: 0, currentPath: relativePath, phase: 'Scanning remote files...' });
      }
    }).then(snapshot => {
      remoteCount = Object.keys(snapshot.entries).length;
      this.logRefreshTiming(mapping, target, `Remote scan completed in ${formatDuration(Date.now() - remoteStartedAt)} (${remoteCount} entries).`);
      return snapshot;
    });

    let [local, remote] = await Promise.all([localPromise, remotePromise]);
    if (shared) localCount = Object.keys(local.entries).length;

    const baseline = await this.baselines.get(mapping.id, target.id);
    progress?.({ completed: localCount + remoteCount, total: 0, phase: 'Verifying ambiguous file content...' });
    const verificationTimer = this.diagnostics.timer();
    const verified = await verifyComparisonContent(mapping.localRoot, target.remoteRoot, session, local, remote, baseline, {
      concurrency: Math.min(4, session.capabilities.maxConcurrentTransfers),
      cancellationToken,
      forceHashPaths: this.strongVerificationPaths.get(this.runtimeKey(mapping.id, target.id)),
      onProgress: (completed, total, relativePath) => progress?.({ completed, total, currentPath: relativePath, phase: 'Verifying file content...' })
    });
    this.diagnostics.performance('Refresh', `Content verification completed in ${formatDuration(verificationTimer())}.`, { Mapping: mapping.name, Target: target.name });
    local = verified.local;
    remote = verified.remote;
    const planningTimer = this.diagnostics.timer();
    const metadataDiffs = diffSnapshots(local, remote, baseline, {
      mtimeToleranceMs: 2000,
      remoteMtimeReliable: session.capabilities.reliableMtime
    });
    const localCaseSensitive = await this.getLocalCaseSensitivity(mapping.localRoot);
    const diffs = protectCaseCollisions(metadataDiffs, local, remote, {
      direction: mapping.options.direction,
      localCaseSensitive,
      remoteCaseSensitive: session.capabilities.caseSensitive
    });
    await this.trustEqualEntries(mapping.id, target.id, diffs);
    this.clearStrongVerificationForProvenSame(mapping.id, target.id, diffs);
    const plan = buildSyncPlan(mapping.id, target.id, diffs, {
      direction: mapping.options.direction,
      propagateDeletes: mapping.options.propagateDeletes,
      conflictProtection: mapping.options.conflictProtection,
      localFilenameStyle: localFilenameStyle(),
      remoteFilenameStyle: session.capabilities.filenameStyle
    });
    this.diagnostics.performance('Refresh', `Diff and planning completed in ${formatDuration(planningTimer())}.`, {
      Mapping: mapping.name,
      Target: target.name,
      Diffs: diffs.length,
      Operations: plan.operations.length,
      Conflicts: plan.conflicts.length,
      Errors: plan.errors.length
    });
    this.diagnostics.debug('Planner', 'Refresh plan built.', {
      Mapping: mapping.name,
      Target: target.name,
      Diffs: diffs.length,
      Operations: plan.operations.length,
      Conflicts: plan.conflicts.length,
      Errors: plan.errors.length
    });
    const runtime = { local, remote, diffs, plan, lastComparedAt: Date.now() };
    this.runtimeByTarget.set(this.runtimeKey(mapping.id, target.id), runtime);
    if (runtime.lastComparedAt) await this.lastViews.set(mapping, target, runtime.diffs, runtime.lastComparedAt);

    // Emit per target, not only after the All Enabled batch. The webview can
    // therefore render each completed target while slower Remote scans continue.
    this.viewStateChangedEmitter.fire();
    progress?.({ completed: localCount + remoteCount, total: localCount + remoteCount, phase: 'Refresh complete.' });
    const elapsed = Date.now() - refreshStartedAt;
    this.logRefreshTiming(mapping, target, `Refresh completed in ${formatDuration(elapsed)} (${diffs.length} entries, ${plan.conflicts.length} conflicts, ${plan.errors.length} errors).`);
    this.ui.log('Refresh completed.', 'success', `${mapping.name} / ${target.name}`);
    this.diagnostics.debug('Refresh', 'Refresh completed.', { Mapping: mapping.name, Target: target.name, Entries: diffs.length });
    return runtime;
  }

  async executeCurrentPlan(
    mappingId: string,
    targetId: string,
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<{ failed: number; stale: number; cancelled: boolean }> {
    const mapping = this.requireMapping(mappingId);
    const target = this.requireEnabledTarget(mapping, targetId);
    const key = this.runtimeKey(mapping.id, target.id);

    return this.operations.run(key, async () => {
      const session = this.requireSession(mapping.id, target.id);
      const runtime = this.runtimeByTarget.get(key);
      if (!runtime?.plan || !runtime.local || !runtime.remote) throw new Error('Refresh the target before starting Sync.');
      const unresolved = runtime.diffs.filter(diff =>
        (diff.status === 'conflict' || diff.status === 'different') && !diff.resolution
      );
      if (unresolved.length) throw new Error('Select Use Local, Use Remote, or Skip for every Different or Conflict path before starting Sync.');
      if (runtime.plan.conflicts.length) throw new Error('Resolve or skip conflicts before starting Sync.');
      if (runtime.plan.errors.length) throw new Error('Sync cannot start while the compare result contains unknown or incomplete paths.');

      return this.runWithPlanLocalRootProtection(mapping, runtime.plan, async () => {
        progress?.({ completed: 0, total: runtime.plan!.operations.length, phase: 'Revalidating sync plan...' });
        const revalidated = await this.revalidatePlan(mapping, target, runtime.plan!, session, cancellationToken);
        if (revalidated.stale.length) {
          const invalidated = this.invalidateStaleResolutions(runtime, revalidated.stale.map(item => item.operation.relativePath));
          if (invalidated) {
            runtime.plan = buildSyncPlan(mapping.id, target.id, runtime.diffs, {
              direction: mapping.options.direction,
              propagateDeletes: mapping.options.propagateDeletes,
              conflictProtection: mapping.options.conflictProtection,
              localFilenameStyle: localFilenameStyle(),
              remoteFilenameStyle: session.capabilities.filenameStyle
            });
            this.runtimeByTarget.set(key, runtime);
            this.viewStateChangedEmitter.fire();
          }
          return { failed: 0, stale: revalidated.stale.length, cancelled: false };
        }

        const result = await this.executePlan(mapping, target, runtime.plan!, session, {
          atomicTransfer: mapping.options.atomicTransfer,
          cancellationToken,
          onProgress: progress,
          journal: this.journal
        });

        const observations = await this.updateBaselineForOperations(mapping, target, session, result.completed);
        if (!result.cancelled && !result.failed.length) {
          await this.reflectSuccessfulManualOperationsInView(mapping, target, session, observations, runtime);
        } else {
          this.runtimeByTarget.delete(key);
          if (!result.cancelled) {
            this.ui.log('Running a full Refresh because the Sync did not complete cleanly.', 'info', `${mapping.name} / ${target.name}`);
            await this.compareTargetCore(mapping, target, progress, cancellationToken);
          }
        }
        this.log(result.failed.length ? 'WARN' : 'INFO', `Workspace Sync execution completed: ${mapping.name} / ${target.name} (${result.completed.length} completed, ${result.failed.length} failed${result.cancelled ? ', cancelled' : ''}).`);
        return { failed: result.failed.length, stale: 0, cancelled: result.cancelled };
      });
    });
  }

  async executeCurrentPlansAcrossTargets(
    mappingId: string,
    targetIds: string[],
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<{ failed: number; stale: number; cancelled: boolean }> {
    const mapping = this.requireMapping(mappingId);
    const requested = new Set(targetIds.map(String).filter(Boolean));
    const targets = mapping.targets.filter(target => target.enabled && requested.has(target.id));
    if (!targets.length) throw new Error('No connected Workspace Sync target has a sync plan to execute.');

    // All Enabled is only an aggregate action over sessions the user has
    // already connected and refreshed. Validate readiness up front so this
    // path can never become an implicit Connect operation.
    const totals = new Map<string, number>();
    for (const target of targets) {
      this.requireSession(mapping.id, target.id);
      const runtime = this.runtimeByTarget.get(this.runtimeKey(mapping.id, target.id));
      if (!runtime?.plan || !runtime.local || !runtime.remote) {
        throw new Error(`Refresh '${target.name}' before starting Sync.`);
      }
      totals.set(target.id, runtime.plan.operations.filter(operation => operation.type !== 'skip').length);
    }

    const aggregateProgress = createAggregateSyncProgress(targets, totals, progress);
    const results = await mapWithConcurrencyLimit(
      targets,
      MAX_PARALLEL_TARGET_SYNCS,
      async target => this.executeCurrentPlan(
        mapping.id,
        target.id,
        aggregateProgress.forTarget(target),
        cancellationToken
      ),
      () => Boolean(cancellationToken?.isCancellationRequested)
    );

    const failed = results.reduce((count, result) => count + result.failed, 0);
    const stale = results.reduce((count, result) => count + result.stale, 0);
    const cancelled = Boolean(cancellationToken?.isCancellationRequested) || results.some(result => result.cancelled);
    aggregateProgress.complete(cancelled);
    return { failed, stale, cancelled };
  }

  async executeSelected(
    mappingId: string,
    targetId: string,
    relativePaths: string[],
    direction: 'upload' | 'download',
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<{ failed: number; stale: number; cancelled: boolean }> {
    const mapping = this.requireMapping(mappingId);
    const target = this.requireEnabledTarget(mapping, targetId);
    const key = this.runtimeKey(mapping.id, target.id);

    return this.operations.run(key, async () => {
      const session = this.requireSession(mapping.id, target.id);
      const runtime = this.runtimeByTarget.get(key);
      if (!runtime?.diffs.length) throw new Error('Refresh the target before transferring selected files.');

      const selected = new Set(relativePaths);
      const selectedDirectoryPrefixes = runtime.diffs
        .filter(diff => selected.has(diff.relativePath))
        .filter(diff => {
          const source = direction === 'upload' ? diff.local : diff.remote;
          return source?.kind === 'directory';
        })
        .map(diff => `${diff.relativePath.replace(/\/+$/, '')}/`);
      const selectedDiffs = runtime.diffs.filter(diff =>
        selected.has(diff.relativePath) || selectedDirectoryPrefixes.some(prefix => diff.relativePath.startsWith(prefix))
      );
      if (selectedDiffs.some(diff => diff.status === 'conflict' || diff.status === 'different')) {
        throw new Error('Resolve selected conflicts with Use Local, Use Remote, or Skip before transferring other selected paths.');
      }
      const operations: SyncOperation[] = selectedDiffs
        .map(diff => explicitTransferOperation(diff, direction))
        .filter((operation): operation is SyncOperation => Boolean(operation));
      if (!operations.length) throw new Error(`No selected paths can be ${direction === 'upload' ? 'uploaded' : 'downloaded'}.`);

      const plan = singleOperationPlan(mapping, target, operations);
      return this.runWithPlanLocalRootProtection(mapping, plan, async () => {
        const revalidated = await this.revalidatePlan(mapping, target, plan, session, cancellationToken);
        if (revalidated.stale.length) return { failed: 0, stale: revalidated.stale.length, cancelled: false };
        const result = await this.executePlan(mapping, target, plan, session, {
          atomicTransfer: mapping.options.atomicTransfer,
          onProgress: progress,
          cancellationToken,
          journal: this.journal
        });
        const observations = await this.updateBaselineForOperations(mapping, target, session, result.completed);
        if (!result.cancelled && !result.failed.length) {
          await this.reflectSuccessfulManualOperationsInView(mapping, target, session, observations, runtime);
        } else {
          this.runtimeByTarget.delete(key);
          if (!result.cancelled) {
            this.ui.log('Running a full Refresh because the transfer did not complete cleanly.', 'info', `${mapping.name} / ${target.name}`);
            await this.compareTargetCore(mapping, target, progress, cancellationToken);
          }
        }
        return { failed: result.failed.length, stale: 0, cancelled: result.cancelled };
      });
    });
  }

  async executeSelectedAcrossTargets(
    mappingId: string,
    selections: Array<{ targetId: string; relativePaths: string[] }>,
    direction: 'upload' | 'download',
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<{ failed: number; stale: number; cancelled: boolean }> {
    const mapping = this.requireMapping(mappingId);
    const pathsByTarget = new Map<string, Set<string>>();
    for (const selection of selections) {
      const target = this.requireEnabledTarget(mapping, selection.targetId);
      const paths = pathsByTarget.get(target.id) || new Set<string>();
      for (const relativePath of selection.relativePaths) if (String(relativePath)) paths.add(String(relativePath));
      pathsByTarget.set(target.id, paths);
    }
    const normalized = mapping.targets
      .filter(target => pathsByTarget.has(target.id))
      .map(target => ({ target, relativePaths: [...(pathsByTarget.get(target.id) || [])] }))
      .filter(selection => selection.relativePaths.length > 0);
    if (!normalized.length) throw new Error('Select at least one Workspace Sync path first.');

    // Manual aggregate transfers are allowed only for sessions the user already
    // connected. Never let All Enabled become another path to auto-connect.
    for (const selection of normalized) this.requireSession(mapping.id, selection.target.id);

    const totals = new Map(normalized.map(selection => [selection.target.id, selection.relativePaths.length]));
    const aggregateProgress = createAggregateSyncProgress(normalized.map(selection => selection.target), totals, progress);
    const results = await mapWithConcurrencyLimit(
      normalized,
      MAX_PARALLEL_TARGET_SYNCS,
      async selection => this.executeSelected(
        mapping.id,
        selection.target.id,
        selection.relativePaths,
        direction,
        aggregateProgress.forTarget(selection.target),
        cancellationToken
      ),
      () => Boolean(cancellationToken?.isCancellationRequested)
    );

    const failed = results.reduce((count, result) => count + result.failed, 0);
    const stale = results.reduce((count, result) => count + result.stale, 0);
    const cancelled = Boolean(cancellationToken?.isCancellationRequested) || results.some(result => result.cancelled);
    aggregateProgress.complete(cancelled);
    return { failed, stale, cancelled };
  }

  private runWithPlanLocalRootProtection<T>(
    mapping: WorkspaceSyncMapping,
    plan: SyncPlan,
    task: () => Promise<T>
  ): Promise<T> {
    return planMutatesLocal(plan)
      ? this.localRootOperations.run(mapping.localRoot, task)
      : this.localRootOperations.runShared(mapping.localRoot, task);
  }

  async setConflictResolution(
    mappingId: string,
    targetId: string,
    relativePath: string,
    resolution?: WorkspaceSyncConflictResolution,
    notifyViewState = true
  ): Promise<void> {
    await this.setConflictResolutions(mappingId, targetId, { [relativePath]: resolution }, notifyViewState);
  }

  async setConflictResolutions(
    mappingId: string,
    targetId: string,
    resolutions: Record<string, WorkspaceSyncConflictResolution | undefined>,
    notifyViewState = true
  ): Promise<void> {
    const mapping = this.requireMapping(mappingId);
    const target = this.requireEnabledTarget(mapping, targetId);
    await this.operations.run(this.runtimeKey(mapping.id, target.id), async () => {
      const session = this.requireSession(mapping.id, target.id);
      const runtime = this.runtimeByTarget.get(this.runtimeKey(mapping.id, target.id));
      if (!runtime?.plan) throw new Error('Refresh the target before selecting conflict resolutions.');

      const requested = Object.entries(resolutions);
      for (const [relativePath, resolution] of requested) {
        if (resolution !== undefined && resolution !== 'useLocal' && resolution !== 'useRemote' && resolution !== 'skip') {
          throw new Error('Invalid Workspace Sync conflict resolution.');
        }
        const diff = runtime.diffs.find(item => item.relativePath === relativePath);
        if (!diff || (diff.status !== 'conflict' && diff.status !== 'different')) {
          throw new Error(`'${relativePath}' no longer requires a Workspace Sync resolution. Run Refresh again.`);
        }
        if (resolution !== undefined && resolution !== 'skip') validateConflictResolutionChoice(diff, resolution);
      }

      const resolutionByPath = new Map(requested);
      runtime.diffs = runtime.diffs.map(diff => {
        if (!resolutionByPath.has(diff.relativePath)) return diff;
        const resolution = resolutionByPath.get(diff.relativePath);
        if (resolution) return { ...diff, resolution };
        const reset = { ...diff };
        delete reset.resolution;
        return reset;
      });
      runtime.plan = buildSyncPlan(mapping.id, target.id, runtime.diffs, {
        direction: mapping.options.direction,
        propagateDeletes: mapping.options.propagateDeletes,
        conflictProtection: mapping.options.conflictProtection,
        localFilenameStyle: localFilenameStyle(),
        remoteFilenameStyle: session.capabilities.filenameStyle
      });
      this.runtimeByTarget.set(this.runtimeKey(mapping.id, target.id), runtime);
      if (notifyViewState) this.viewStateChangedEmitter.fire();
    });
  }

  async openDiff(mappingId: string, targetId: string, relativePath: string) {
    const mapping = this.requireMapping(mappingId);
    const target = this.requireEnabledTarget(mapping, targetId);
    return this.operations.run(this.runtimeKey(mapping.id, target.id), () =>
      this.localRootOperations.run(mapping.localRoot, async () => {
        const session = this.requireSession(mapping.id, target.id);
        const diff = this.runtimeByTarget.get(this.runtimeKey(mapping.id, target.id))?.diffs.find(item => item.relativePath === relativePath);
        if (diff?.local?.kind !== 'file' || diff.remote?.kind !== 'file') throw new Error('Diff is available only when the file exists on both Local and Remote.');
        const limit = 2 * 1024 * 1024;
        if (diff.local.size > limit || diff.remote.size > limit) throw new Error('The comparison viewer supports text files up to 2 MB per side.');
        const { localPath, remotePath, localRelativePath, remoteRelativePath } = resolveSyncPaths(mapping, target, relativePath, diff);
        await Promise.all([assertLocalPathAncestorsSafe(mapping.localRoot, localRelativePath), assertRemotePathAncestorsSafe(session, target.remoteRoot, remoteRelativePath)]);
        await assertLocalRegularFile(localPath, relativePath);
        const remoteCopy = await this.diffTempStore.allocate(relativePath);
        try {
          await session.download(remotePath, remoteCopy);
          const stats = await Promise.all([fs.stat(localPath), fs.stat(remoteCopy)]);
          if (stats.some(stat => stat.size > limit)) throw new Error('The comparison viewer supports text files up to 2 MB per side.');
          const buffers = await Promise.all([fs.readFile(localPath), fs.readFile(remoteCopy)]);
          let texts: string[];
          try {
            if (buffers.some(buffer => buffer.includes(0))) throw new Error('Binary');
            texts = buffers.map(buffer => new TextDecoder('utf-8', { fatal: true }).decode(buffer));
          } catch { throw new Error('This file is binary or is not UTF-8 text. Text comparison is unavailable.'); }
          if (texts.some(text => text.split('\n').length > 20000)) throw new Error('The comparison viewer supports up to 20,000 lines per side.');
          this.ui.log(`Opened comparison: ${relativePath}`, 'info', target.name);
          return { relativePath, targetName: target.name, lines: compareText(texts[0], texts[1]), identical: buffers[0].equals(buffers[1]) };
        } finally { await fs.rm(remoteCopy, { force: true }); }
      })
    );
  }

  private async validateMappingInput(input: WorkspaceMappingInput): Promise<void> {
    // Keep duplicate-destination validation on mutation paths only. Persisted
    // legacy mappings must remain loadable so the Mapping dialog can repair them.
    validateUniqueTargetDestinations(input.targets || []);
    validateUniqueMappingRoutes([
      ...this.mappings.list().filter(mapping => mapping.id !== input.id),
      input
    ]);
    const localRoot = path.resolve(String(input.localRoot || '').trim());
    if (!String(input.localRoot || '').trim()) throw new Error('Local root is required.');
    let localStat: import('fs').Stats;
    try {
      localStat = await fs.lstat(localRoot);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') throw new Error(`Workspace Sync Local root does not exist: ${localRoot}`);
      throw error;
    }
    if (localStat.isSymbolicLink()) {
      throw new Error('Workspace Sync Local root cannot be a symbolic link. Select the real directory instead.');
    }
    if (!localStat.isDirectory()) throw new Error(`Workspace Sync Local root is not a directory: ${localRoot}`);

    const profileIds = new Set((await this.connectionManager.listProfiles()).map(profile => profile.id));
    for (const target of input.targets || []) {
      const connectionId = String(target.connectionId || '').trim();
      if (connectionId && !profileIds.has(connectionId)) {
        throw new Error(`Saved connection for target '${String(target.name || 'Target').trim() || 'Target'}' no longer exists.`);
      }
    }
  }

  private async refreshTargetsInParallel(
    mapping: WorkspaceSyncMapping,
    targets: WorkspaceSyncTarget[],
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean },
    continueOnError = false
  ): Promise<Map<string, MappingRuntimeState>> {
    const startedAt = Date.now();
    const ignorePatterns = await loadEffectiveIgnorePatterns(mapping);
    const results = new Map<string, MappingRuntimeState>();
    const failures: Array<{ target: WorkspaceSyncTarget; error: unknown }> = [];
    let localSnapshotPromise: Promise<SyncSnapshot> | undefined;
    let completedTargets = 0;

    const shared: SharedRefreshContext = {
      ignorePatterns,
      getLocalSnapshot: () => {
        if (!localSnapshotPromise) {
          const localStartedAt = Date.now();
          let scanned = 0;
          localSnapshotPromise = scanLocalTree(mapping.localRoot, {
            ignorePatterns,
            cancellationToken,
            onProgress: (count, relativePath) => {
              scanned = count;
              progress?.({ completed: count, total: 0, currentPath: relativePath, phase: 'Scanning shared local files...' });
            }
          }).then(snapshot => {
            scanned = Object.keys(snapshot.entries).length;
            this.logRefreshTiming(mapping, undefined, `Shared Local scan completed in ${formatDuration(Date.now() - localStartedAt)} (${scanned} entries).`);
            return snapshot;
          });
        }
        return localSnapshotPromise;
      }
    };

    await runWithConcurrency(targets, MAX_PARALLEL_TARGET_REFRESHES, async target => {
      if (cancellationToken?.isCancellationRequested) return;
      try {
        const runtime = await this.requestCoalescedRefresh(mapping, target, () =>
          this.operations.run(this.runtimeKey(mapping.id, target.id), () =>
            this.localRootOperations.runShared(mapping.localRoot, () =>
              this.compareTargetCore(
                mapping,
                target,
                targetProgress => progress?.({
                  ...targetProgress,
                  phase: targetProgress.phase ? `${target.name}: ${targetProgress.phase}` : target.name
                }),
                cancellationToken,
                shared
              )
            )
          )
        );
        results.set(target.id, runtime);
        completedTargets += 1;
        progress?.({
          completed: completedTargets,
          total: targets.length,
          phase: `Refreshed ${completedTargets} of ${targets.length} target(s).`
        });
      } catch (error) {
        failures.push({ target, error });
        if (continueOnError) {
          this.log('WARN', `Workspace Sync refresh failed: ${mapping.name} / ${target.name}. ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });

    if (cancellationToken?.isCancellationRequested) {
      throw new Error('Workspace Sync refresh cancelled.');
    }
    this.logRefreshTiming(
      mapping,
      undefined,
      `Multi-target refresh completed in ${formatDuration(Date.now() - startedAt)} (${results.size}/${targets.length} targets, concurrency ${Math.min(MAX_PARALLEL_TARGET_REFRESHES, targets.length)}).`
    );

    if (failures.length && !continueOnError) {
      const first = failures[0];
      const detail = first.error instanceof Error ? first.error.message : String(first.error);
      throw new Error(`Refresh failed for ${failures.length} of ${targets.length} target(s). ${first.target.name}: ${detail}`);
    }
    return results;
  }

  private requestCoalescedRefresh(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    run: () => Promise<MappingRuntimeState>
  ): Promise<MappingRuntimeState> {
    const key = this.runtimeKey(mapping.id, target.id);
    const session = this.sessions.getSession(this.sessionKey(mapping.id, target.id));
    const stamp = `${mapping.updatedAt}:${target.updatedAt}:${session?.connectionIdentity || 'disconnected'}`;
    const existing = this.refreshFlights.get(key);
    if (existing) {
      // Identical requests reuse the current Refresh. A newer mapping/target or
      // connection revision replaces the desired run and executes once after
      // the current scan, rather than queuing every intermediate request.
      if (existing.desiredStamp !== stamp) {
        existing.desiredStamp = stamp;
        existing.desiredRun = run;
      }
      return existing.promise;
    }

    const flight = {} as RefreshFlight;
    flight.desiredStamp = stamp;
    flight.desiredRun = run;
    flight.promise = (async () => {
      let result!: MappingRuntimeState;
      while (true) {
        const runningStamp = flight.desiredStamp;
        const running = flight.desiredRun;
        try {
          result = await running();
        } catch (error) {
          if (flight.desiredStamp !== runningStamp) continue;
          throw error;
        }
        if (flight.desiredStamp === runningStamp) return result;
      }
    })().finally(() => {
      if (this.refreshFlights.get(key) === flight) this.refreshFlights.delete(key);
    });
    this.refreshFlights.set(key, flight);
    return flight.promise;
  }

  private logRefreshTiming(mapping: WorkspaceSyncMapping, target: WorkspaceSyncTarget | undefined, message: string): void {
    this.diagnostics.performance('Refresh', this.ui.sanitize(message), {
      Mapping: this.ui.sanitize(mapping.name),
      Target: target ? this.ui.sanitize(target.name) : undefined
    });
  }

  private async refreshConnectedTargetsAfterIgnoreChange(mapping: WorkspaceSyncMapping): Promise<void> {
    const generation = this.watchRefreshGeneration;
    const connectedTargets = mapping.targets.filter(target =>
      target.enabled && Boolean(this.getConnectedAutomaticSession(mapping.id, target.id))
    );
    if (!connectedTargets.length) return;

    this.backgroundActivityEmitter.fire({
      active: true,
      kind: 'refresh',
      label: 'Refreshing after mapping update...',
      mappingId: mapping.id,
      detail: connectedTargets.length > 1 ? `${connectedTargets.length} connected targets` : connectedTargets[0].name
    });
    try {
      const runtimes = await this.refreshTargetsInParallel(mapping, connectedTargets, undefined, undefined, true);

      // Initial Watch reconciliation may mutate Local/Remote state, so keep that
      // phase exclusive and ordered even though the read-only Refresh above ran
      // in parallel.
      for (const target of connectedTargets) {
        const runtime = runtimes.get(target.id);
        if (!runtime) continue;
        try {
          await this.operations.run(this.runtimeKey(mapping.id, target.id), async () => {
            const currentMapping = this.mappings.get(mapping.id);
            const currentTarget = currentMapping?.targets.find(item => item.id === target.id);
            if (!currentMapping || !currentTarget?.enabled) return;
            const session = this.getConnectedAutomaticSession(currentMapping.id, currentTarget.id);
            if (!session) return;
            await this.localRootOperations.run(currentMapping.localRoot, async () => {
              if (this.getConnectedAutomaticSession(currentMapping.id, currentTarget.id) !== session) return;
              if (currentMapping.options.watchLocalChanges || currentMapping.options.watchRemoteChanges) {
                await this.reconcileWatchRuntimeCore(currentMapping, currentTarget, session, runtime, generation);
              }
            });
          });
        } catch (error) {
          this.log('WARN', `Workspace Sync Watch reconciliation after Ignore change failed: ${mapping.name} / ${target.name}. ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      this.backgroundActivityEmitter.fire({
        active: false,
        kind: 'refresh',
        label: 'Refreshing after mapping update...',
        mappingId: mapping.id
      });
    }
  }

  private refreshWatchers(reconcileMappingIds: string[] = []): void {
    // Watchers are runtime resources, not merely mapping options. Keep only
    // targets with a currently usable session registered. This means a mapping
    // with Watch/Upload on Save enabled consumes no per-mapping watcher/polling
    // resources while all of its targets are disconnected.
    const mappings = this.mappings.list()
      .map(mapping => ({
        ...mapping,
        targets: mapping.targets.filter(target =>
          target.enabled && Boolean(this.getConnectedAutomaticSession(mapping.id, target.id))
        )
      }))
      .filter(mapping => mapping.targets.length > 0);
    const generation = ++this.watchRefreshGeneration;
    const targetCount = mappings.reduce((total, mapping) => total + mapping.targets.length, 0);
    this.diagnostics.debug('Watch', 'Watcher registrations refreshed.', {
      Generation: generation,
      Mappings: mappings.length,
      Targets: targetCount,
      ReconcileMappings: reconcileMappingIds.length
    });
    this.remoteWatchSnapshots.clear();
    this.watcher.refresh(mappings);
    this.remoteWatcher.refresh(mappings);

    const ids = [...new Set(reconcileMappingIds)];
    if (!ids.length) return;
    // Refresh is intentionally synchronous because it is also used from the
    // constructor. Reconciliation starts on the next microtask so all watcher
    // registrations and controller initialization are complete first.
    void Promise.resolve().then(() => this.reconcileInitialWatchState(ids, generation)).catch(error => {
      this.log('WARN', `Workspace Sync initial Watch reconciliation failed. ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async reconcileInitialWatchState(mappingIds: string[], generation: number): Promise<void> {
    for (const mappingId of mappingIds) {
      if (generation !== this.watchRefreshGeneration) return;
      const mapping = this.mappings.get(mappingId);
      if (!mapping || (!mapping.options.watchLocalChanges && !mapping.options.watchRemoteChanges)) continue;

      for (const target of mapping.targets.filter(item => item.enabled)) {
        if (generation !== this.watchRefreshGeneration) return;
        await this.reconcileConnectedWatchTarget(mapping.id, target.id, generation);
      }
    }
  }

  private async reconcileConnectedWatchTarget(mappingId: string, targetId: string, generation: number): Promise<void> {
    if (generation !== this.watchRefreshGeneration) return;
    const mapping = this.mappings.get(mappingId);
    const target = mapping?.targets.find(item => item.id === targetId);
    if (!mapping || !target?.enabled) return;
    if (!mapping.options.watchLocalChanges && !mapping.options.watchRemoteChanges) return;

    if (!this.getConnectedAutomaticSession(mapping.id, target.id)) return;

    const key = this.runtimeKey(mapping.id, target.id);
    await this.operations.run(key, async () => {
      if (generation !== this.watchRefreshGeneration) return;
      const currentMapping = this.mappings.get(mapping.id);
      const currentTarget = currentMapping?.targets.find(item => item.id === target.id);
      if (!currentMapping || !currentTarget?.enabled) return;
      if (!currentMapping.options.watchLocalChanges && !currentMapping.options.watchRemoteChanges) return;

      const session = this.getConnectedAutomaticSession(currentMapping.id, currentTarget.id);
      if (!session) return;

      await this.localRootOperations.run(currentMapping.localRoot, async () => {
        if (this.getConnectedAutomaticSession(currentMapping.id, currentTarget.id) !== session) return;
        await this.ensureBaselineContext(currentMapping, currentTarget, session);
        const runtime = await this.compareTargetCore(currentMapping, currentTarget);
        await this.reconcileWatchRuntimeCore(currentMapping, currentTarget, session, runtime, generation);
      });
    });
  }

  private async reconcileWatchRuntimeCore(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    runtime: MappingRuntimeState,
    generation: number
  ): Promise<void> {
    if (generation !== this.watchRefreshGeneration) return;
    if (!mapping.options.watchLocalChanges && !mapping.options.watchRemoteChanges) return;

    const reconciliationTimer = this.diagnostics.timer();
    this.diagnostics.debug('Watch', 'Initial reconciliation started.', {
      Mapping: mapping.name,
      Target: target.name,
      Direction: mapping.options.direction,
      WatchLocal: mapping.options.watchLocalChanges,
      WatchRemote: mapping.options.watchRemoteChanges,
      Diffs: runtime.diffs.length
    });
    this.ui.log('Watch initial reconciliation started.', 'info', `${mapping.name} / ${target.name}`);
    const operations: SyncOperation[] = [];
    let conflicts = 0;
    let unknown = 0;

    for (const diff of runtime.diffs) {
      if (diff.status === 'same') continue;
      if (diff.status === 'unknown') {
        unknown += 1;
        continue;
      }

      const decision = initialWatchReconcileDecision(mapping.options.direction, diff.status, mapping.options);
      if (decision.conflict) {
        conflicts += 1;
        await this.reportAutomaticConflict(
          mapping,
          target,
          diff.relativePath,
          diff.reason || 'Local and Remote differ and Watch cannot determine a safe winner from the trusted baseline.'
        );
        continue;
      }

      const structuralConflict = Boolean(diff.local && diff.remote && diff.local.kind !== diff.remote.kind);
      if (structuralConflict && (decision.local || decision.remote)) {
        conflicts += 1;
        await this.reportAutomaticConflict(mapping, target, diff.relativePath, `Local is ${diff.local?.kind} while Remote is ${diff.remote?.kind}.`);
        continue;
      }

      if (decision.local) {
        const operation = initialWatchOperation(diff, 'local', mapping.options.propagateDeletes);
        if (operation) operations.push(operation);
      }
      if (decision.remote) {
        const operation = initialWatchOperation(diff, 'remote', mapping.options.propagateDeletes);
        if (operation) operations.push(operation);
      }
    }

    let completed: SyncOperation[] = [];
    let stale = 0;
    let failed = 0;
    if (operations.length) {
      const plan = singleOperationPlan(mapping, target, operations);
      const revalidated = await this.revalidatePlan(mapping, target, plan, session);
      stale = revalidated.stale.length;
      for (const item of revalidated.stale) {
        await this.reportAutomaticConflict(mapping, target, item.operation.relativePath, `State changed after the initial Watch Refresh. ${item.reason}`);
      }

      if (revalidated.valid.length) {
        const validPlan = singleOperationPlan(mapping, target, revalidated.valid);
        const result = await this.executePlan(mapping, target, validPlan, session, {
          atomicTransfer: mapping.options.atomicTransfer,
          journal: this.journal
        });
        await this.updateBaselineForOperations(mapping, target, session, result.completed);
        completed = result.completed;
        failed = result.failed.length;
      }
    }

    await this.reflectAutomaticOperationsInView(mapping, target, session, completed, runtime);

    const warnings = conflicts + unknown + stale + failed;
    this.ui.log(
      `Watch initial reconciliation completed: ${completed.length} difference(s) processed${conflicts ? `, ${conflicts} conflict(s)` : ''}${stale ? `, ${stale} stale path(s)` : ''}${unknown ? `, ${unknown} incomplete/unknown path(s)` : ''}${failed ? `, ${failed} failed operation(s)` : ''}.`,
      warnings ? 'warning' : 'success',
      `${mapping.name} / ${target.name}`
    );
    this.diagnostics.debug('Watch', 'Initial reconciliation completed.', {
      Mapping: mapping.name,
      Target: target.name,
      Planned: operations.length,
      Completed: completed.length,
      Conflicts: conflicts,
      Unknown: unknown,
      Stale: stale,
      Failed: failed
    });
    this.diagnostics.performance('Watch', `Initial reconciliation completed in ${formatDuration(reconciliationTimer())}.`, { Mapping: mapping.name, Target: target.name });
  }

  private applyCompletedOperationsToRuntime(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    runtime: MappingRuntimeState,
    completed: SyncOperation[]
  ): MappingRuntimeState {
    if (!completed.length) return runtime;
    const byPath = new Map(completed.filter(operation => operation.type !== 'skip').map(operation => [operation.relativePath, operation]));
    const diffs: DiffEntry[] = [];

    for (const diff of runtime.diffs) {
      const operation = byPath.get(diff.relativePath);
      if (!operation) {
        diffs.push(diff);
        continue;
      }
      byPath.delete(diff.relativePath);

      if (operation.type === 'deleteLocal' || operation.type === 'deleteRemote') {
        continue;
      }
      if (operation.type === 'upload' || operation.type === 'createRemoteDirectory') {
        const fingerprint = diff.local || operation.expectedLocal;
        if (fingerprint) diffs.push({ relativePath: diff.relativePath, localRelativePath: operation.localRelativePath || diff.localRelativePath, remoteRelativePath: operation.remoteRelativePath || diff.remoteRelativePath, status: 'same', local: fingerprint, remote: fingerprint });
        continue;
      }
      if (operation.type === 'download' || operation.type === 'createLocalDirectory') {
        const fingerprint = diff.remote || operation.expectedRemote;
        if (fingerprint) diffs.push({ relativePath: diff.relativePath, localRelativePath: operation.localRelativePath || diff.localRelativePath, remoteRelativePath: operation.remoteRelativePath || diff.remoteRelativePath, status: 'same', local: fingerprint, remote: fingerprint });
        continue;
      }
      diffs.push(diff);
    }

    // Watch operations may target paths created after the last full Refresh.
    // Add those paths as Same after a successful transfer so Changes never
    // keeps a stale Local-only/Remote-only view until the next manual Refresh.
    for (const operation of byPath.values()) {
      if (operation.type === 'deleteLocal' || operation.type === 'deleteRemote') continue;
      const fingerprint = operation.type === 'upload' || operation.type === 'createRemoteDirectory'
        ? operation.expectedLocal
        : operation.type === 'download' || operation.type === 'createLocalDirectory'
          ? operation.expectedRemote
          : undefined;
      if (fingerprint) {
        diffs.push({ relativePath: operation.relativePath, localRelativePath: operation.localRelativePath, remoteRelativePath: operation.remoteRelativePath, status: 'same', local: fingerprint, remote: fingerprint });
      }
    }
    diffs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    const plan = buildSyncPlan(mapping.id, target.id, diffs, {
      direction: mapping.options.direction,
      propagateDeletes: mapping.options.propagateDeletes,
      conflictProtection: mapping.options.conflictProtection,
      localFilenameStyle: localFilenameStyle(),
      remoteFilenameStyle: session.capabilities.filenameStyle
    });
    return { ...runtime, diffs, plan };
  }

  private scheduleAutomaticViewStateChanged(mappingId: string): void {
    this.automaticViewDirtyMappings.add(mappingId);
    if (this.automaticViewNotificationTimer) return;
    // Coalesce bursts of watcher activity so bulk saves do not force the
    // webview to fully render once per filesystem event. Only the mapping
    // currently selected in the panel is ever pushed visually; background
    // mappings still keep their runtime cache current and render immediately
    // when the user selects them.
    this.automaticViewNotificationTimer = setTimeout(() => {
      this.automaticViewNotificationTimer = undefined;
      const activeMappingId = this.mappings.getActive()?.id;
      const shouldNotify = Boolean(activeMappingId && this.automaticViewDirtyMappings.has(activeMappingId));
      this.automaticViewDirtyMappings.clear();
      if (shouldNotify) this.viewStateChangedEmitter.fire();
    }, 40);
  }

  private async refreshAutomaticPathsInView(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    paths: Array<{ relativePath: string; observation?: AutomaticPathObservation }>,
    baseRuntime?: MappingRuntimeState,
    persistLastView = false,
    notifyImmediately = false
  ): Promise<void> {
    if (!paths.length) return;
    const key = this.runtimeKey(mapping.id, target.id);
    let runtime = baseRuntime || this.runtimeByTarget.get(key);
    if (!runtime) {
      const lastKnown = await this.lastViews.get(mapping, target);
      runtime = {
        diffs: lastKnown?.diffs ? [...lastKnown.diffs] : [],
        lastComparedAt: lastKnown?.lastRefreshedAt
      };
    }

    const baselineState = await this.baselines.get(mapping.id, target.id);
    const byPath = new Map(runtime.diffs.map(diff => [diff.relativePath, diff]));
    const uniquePaths = new Map<string, AutomaticPathObservation>();
    for (const item of paths) uniquePaths.set(item.relativePath, item.observation || {});

    for (const [relativePath, observation] of uniquePaths) {
      const previous = byPath.get(relativePath);
      const baseline = baselineState?.entries[relativePath];
      const localRelativePath = observation.localRelativePath || previous?.localRelativePath || baseline?.localRelativePath || relativePath;
      const remoteRelativePath = observation.remoteRelativePath || previous?.remoteRelativePath || baseline?.remoteRelativePath || relativePath;
      const resolved = resolveSyncPaths(mapping, target, relativePath, { localRelativePath, remoteRelativePath });
      const includeLocalHash = Boolean(baseline?.local?.hash) || !session.capabilities.reliableMtime;
      const includeRemoteHash = Boolean(baseline?.remote?.hash) || !session.capabilities.reliableMtime;

      let local = observation.localKnown
        ? observation.local
        : await readLocalFingerprint(resolved.localPath, includeLocalHash);
      let remote = observation.remoteKnown
        ? observation.remote
        : await readRemoteFingerprint(session, resolved.remotePath, includeRemoteHash);

      // A polling snapshot can provide a cheap metadata fingerprint. Upgrade
      // it only when trusted history or an unreliable Remote mtime makes a hash
      // necessary for the same one-path classification used by Refresh.
      if (local?.kind === 'file' && includeLocalHash && !local.hash) {
        local = await readLocalFingerprint(resolved.localPath, true) || local;
      }
      if (remote?.kind === 'file' && includeRemoteHash && !remote.hash) {
        remote = await readRemoteFingerprint(session, resolved.remotePath, true) || remote;
      }

      if (!local && !remote && !baseline) {
        byPath.delete(relativePath);
        continue;
      }

      const capturedAt = Date.now();
      const localSnapshot: SyncSnapshot = {
        capturedAt,
        entries: local ? { [relativePath]: { relativePath, physicalRelativePath: localRelativePath, fingerprint: local } } : {},
        incompletePaths: []
      };
      const remoteSnapshot: SyncSnapshot = {
        capturedAt,
        entries: remote ? { [relativePath]: { relativePath, physicalRelativePath: remoteRelativePath, fingerprint: remote } } : {},
        incompletePaths: []
      };
      const scopedBaseline = baseline ? {
        mappingId: mapping.id,
        targetId: target.id,
        capturedAt: baselineState?.capturedAt || capturedAt,
        entries: { [relativePath]: baseline }
      } : undefined;
      let diff = diffSnapshots(localSnapshot, remoteSnapshot, scopedBaseline, {
        mtimeToleranceMs: 2000,
        remoteMtimeReliable: session.capabilities.reliableMtime
      })[0];
      if (!diff) {
        byPath.delete(relativePath);
        continue;
      }
      if (observation.forceConflictReason) {
        diff = { ...diff, status: 'conflict', reason: observation.forceConflictReason };
        delete diff.resolution;
      }
      byPath.set(relativePath, diff);
    }

    const diffs = [...byPath.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const plan = buildSyncPlan(mapping.id, target.id, diffs, {
      direction: mapping.options.direction,
      propagateDeletes: mapping.options.propagateDeletes,
      conflictProtection: mapping.options.conflictProtection,
      localFilenameStyle: localFilenameStyle(),
      remoteFilenameStyle: session.capabilities.filenameStyle
    });
    const nextRuntime: MappingRuntimeState = { ...runtime, diffs, plan };
    this.runtimeByTarget.set(key, nextRuntime);
    if (persistLastView && nextRuntime.lastComparedAt) await this.lastViews.set(mapping, target, nextRuntime.diffs, nextRuntime.lastComparedAt);
    if (notifyImmediately) this.viewStateChangedEmitter.fire();
    else this.scheduleAutomaticViewStateChanged(mapping.id);
  }

  private async reflectSuccessfulManualOperationsInView(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    observations: Array<{ relativePath: string; observation: AutomaticPathObservation }>,
    baseRuntime: MappingRuntimeState
  ): Promise<void> {
    if (!observations.length) return;
    const startedAt = Date.now();
    await this.refreshAutomaticPathsInView(mapping, target, session, observations, baseRuntime, true, true);
    const elapsed = Date.now() - startedAt;
    this.diagnostics.performance('View', `Post-Sync Changes updated incrementally in ${formatDuration(elapsed)}.`, { Mapping: mapping.name, Target: target.name, Paths: observations.length });
    this.ui.log(
      'Post-Sync Changes updated incrementally; full Refresh was not required.',
      'success',
      `${mapping.name} / ${target.name}`
    );
  }

  private async reflectAutomaticOperationsInView(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    completed: SyncOperation[],
    baseRuntime?: MappingRuntimeState
  ): Promise<void> {
    if (!completed.length) return;
    const key = this.runtimeKey(mapping.id, target.id);
    let runtime = baseRuntime || this.runtimeByTarget.get(key);
    if (!runtime) {
      const lastKnown = await this.lastViews.get(mapping, target);
      runtime = { diffs: lastKnown?.diffs ? [...lastKnown.diffs] : [], lastComparedAt: lastKnown?.lastRefreshedAt };
    }
    const nextRuntime = this.applyCompletedOperationsToRuntime(mapping, target, session, runtime, completed);
    this.runtimeByTarget.set(key, nextRuntime);
    if (nextRuntime.lastComparedAt) await this.lastViews.set(mapping, target, nextRuntime.diffs, nextRuntime.lastComparedAt);
    this.scheduleAutomaticViewStateChanged(mapping.id);
  }

  private async pollRemoteChanges(mappingId: string, targetId: string): Promise<void> {
    const mapping = this.mappings.get(mappingId);
    if (!mapping || !mapping.options.watchRemoteChanges || mapping.options.direction === 'localToRemote') return;
    const target = mapping.targets.find(item => item.id === targetId);
    if (!target?.enabled) return;

    const key = this.runtimeKey(mapping.id, target.id);
    if (!this.getConnectedAutomaticSession(mapping.id, target.id)) return;

    const pollTimer = this.diagnostics.timer();
    this.diagnostics.debug('Remote Watch', 'Poll started.', { Mapping: mapping.name, Target: target.name });
    try {
      await this.operations.run(key, async () => {
      const currentMapping = this.mappings.get(mappingId);
      const currentTarget = currentMapping?.targets.find(item => item.id === targetId);
      if (!currentMapping || !currentTarget?.enabled) return;
      if (!currentMapping.options.watchRemoteChanges || currentMapping.options.direction === 'localToRemote') return;
      const session = this.getConnectedAutomaticSession(currentMapping.id, currentTarget.id);
      if (!session) return;

      const contextChanged = await this.ensureBaselineContext(currentMapping, currentTarget, session);
      const ignorePatterns = await loadEffectiveIgnorePatterns(currentMapping);
      const snapshot = await scanRemoteTree(session, currentTarget.remoteRoot, {
        ignorePatterns,
        concurrency: session.capabilities.maxConcurrentMetadata
      });
      if (snapshot.incompletePaths.length) {
        throw new Error(`Remote Watch scan was incomplete at ${snapshot.incompletePaths.slice(0, 3).join(', ')}${snapshot.incompletePaths.length > 3 ? '…' : ''}.`);
      }

      const previous = this.remoteWatchSnapshots.get(key);
      const currentState: RemoteWatchSnapshotState = {
        snapshot,
        connectionIdentity: session.connectionIdentity,
        mappingUpdatedAt: currentMapping.updatedAt,
        targetUpdatedAt: currentTarget.updatedAt
      };

      const reset = contextChanged
        || !previous
        || previous.connectionIdentity !== currentState.connectionIdentity
        || previous.mappingUpdatedAt !== currentState.mappingUpdatedAt
        || previous.targetUpdatedAt !== currentState.targetUpdatedAt;
      if (reset) {
        this.remoteWatchSnapshots.set(key, currentState);
        this.diagnostics.debug('Remote Watch', 'Polling baseline initialized or reset.', { Mapping: currentMapping.name, Target: currentTarget.name, Entries: Object.keys(snapshot.entries).length });
        this.ui.log('Remote Watch initialized.', 'info', `${currentMapping.name} / ${currentTarget.name}`);
        return;
      }

      const changedPaths = collectRemoteWatchChangedPaths(previous.snapshot, snapshot);
      if (!changedPaths.length) {
        this.remoteWatchSnapshots.set(key, currentState);
        this.diagnostics.debug('Remote Watch', 'Poll completed with no changes.', { Mapping: currentMapping.name, Target: currentTarget.name });
        return;
      }

      this.diagnostics.debug('Remote Watch', 'Remote changes detected.', { Mapping: currentMapping.name, Target: currentTarget.name, Changes: changedPaths.length });
      this.ui.log(`Remote Watch detected ${changedPaths.length} remote change(s).`, 'info', `${currentMapping.name} / ${currentTarget.name}`);
      await this.localRootOperations.run(currentMapping.localRoot, async () => {
        if (this.getConnectedAutomaticSession(currentMapping.id, currentTarget.id) !== session) return;
        await this.handleRemoteWatchChangesForTarget(currentMapping, currentTarget, session, snapshot, changedPaths);
      });
      if (this.getConnectedAutomaticSession(currentMapping.id, currentTarget.id) === session) {
        this.remoteWatchSnapshots.set(key, currentState);
      }
      });
    } finally {
      this.diagnostics.performance('Remote Watch', `Poll completed in ${formatDuration(pollTimer())}.`, { Mapping: mapping.name, Target: target.name });
    }
  }

  private async handleRemoteWatchChangesForTarget(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    remoteSnapshot: SyncSnapshot,
    changedPaths: string[]
  ): Promise<void> {
    const sourceIsAuthoritative = isWatchSourceAuthoritative(mapping.options.direction, 'remote');
    const baselineState = await this.baselines.get(mapping.id, target.id);
    const operations: SyncOperation[] = [];
    const baselineUpdates: Record<string, import('./types').BaselineEntry | undefined> = {};
    let conflicts = 0;

    for (const relativePath of changedPaths) {
      const baseline = baselineState?.entries[relativePath];
      const scannedRemoteEntry = remoteSnapshot.entries[relativePath];
      const scannedRemote = scannedRemoteEntry?.fingerprint;
      const localRelativePath = baseline?.localRelativePath || relativePath;
      const remoteRelativePath = scannedRemoteEntry?.physicalRelativePath || baseline?.remoteRelativePath || relativePath;
      const { localPath, remotePath } = resolveSyncPaths(mapping, target, relativePath, { localRelativePath, remoteRelativePath });

      if (!scannedRemote) {
        let local = await readLocalFingerprint(localPath, Boolean(baseline?.local?.hash));
        await this.refreshAutomaticPathsInView(mapping, target, session, [{
          relativePath,
          observation: {
            localKnown: true,
            local,
            remoteKnown: true,
            remote: undefined,
            localRelativePath,
            remoteRelativePath
          }
        }]).catch(() => undefined);
        if (!mapping.options.propagateDeletes) continue;

        if (!local) {
          baselineUpdates[relativePath] = undefined;
          continue;
        }

        if (sourceIsAuthoritative) {
          operations.push({
            id: `remote-watch-delete-${crypto.randomUUID()}`,
            type: 'deleteLocal',
            relativePath,
            localRelativePath,
            remoteRelativePath,
            reason: 'Remote deletion detected by Workspace Sync Remote Watch.',
            expectedLocal: local,
            expectedRemote: undefined
          });
          continue;
        }

        if (!baseline?.remote) continue;

        const localUnchanged = fingerprintsEqual(local, baseline.local, {
          mtimeReliable: true,
          requireHashWhenAvailable: true
        });
        if (!localUnchanged) {
          conflicts += 1;
          await this.reportAutomaticConflict(mapping, target, relativePath, 'Local changed before the remote deletion could be propagated.');
          continue;
        }

        operations.push({
          id: `remote-watch-delete-${crypto.randomUUID()}`,
          type: 'deleteLocal',
          relativePath,
          localRelativePath,
          remoteRelativePath,
          reason: 'Remote deletion detected by Workspace Sync Remote Watch.',
          expectedLocal: local,
          expectedRemote: undefined
        });
        continue;
      }

      if (scannedRemote.kind === 'link' || scannedRemote.kind === 'unknown') {
        await this.refreshAutomaticPathsInView(mapping, target, session, [{
          relativePath,
          observation: { remoteKnown: true, remote: scannedRemote, localRelativePath, remoteRelativePath }
        }]).catch(() => undefined);
        conflicts += 1;
        await this.reportAutomaticConflict(mapping, target, relativePath, `Remote Watch does not automatically transfer ${scannedRemote.kind} entries.`);
        continue;
      }

      const includeRemoteHash = scannedRemote.kind === 'file'
        && (!session.capabilities.reliableMtime || Boolean(baseline?.remote?.hash));
      const remote = scannedRemote.kind === 'file'
        ? (await readRemoteFingerprint(session, remotePath, includeRemoteHash) || scannedRemote)
        : scannedRemote;
      let local = await readLocalFingerprint(localPath, Boolean(baseline?.local?.hash));
      await this.refreshAutomaticPathsInView(mapping, target, session, [{
        relativePath,
        observation: {
          localKnown: true,
          local,
          remoteKnown: true,
          remote,
          localRelativePath,
          remoteRelativePath
        }
      }]).catch(() => undefined);

      if (baseline?.remote) {
        const remoteChangedFromBaseline = !fingerprintsEqual(remote, baseline.remote, {
          mtimeReliable: session.capabilities.reliableMtime,
          requireHashWhenAvailable: true,
          mtimeToleranceMs: 2000
        });
        if (!remoteChangedFromBaseline) {
          // The polling snapshot changed because of an operation already owned
          // by Workspace Sync. The trusted baseline is authoritative here.
          continue;
        }
      }

      if (remote.kind === 'directory') {
        if (local && local.kind !== 'directory') {
          conflicts += 1;
          await this.reportAutomaticConflict(mapping, target, relativePath, `Remote is a directory while Local is ${local.kind}.`);
          continue;
        }
        if (!sourceIsAuthoritative && baseline && local) {
          const localUnchanged = fingerprintsEqual(local, baseline.local, { mtimeReliable: true, requireHashWhenAvailable: true });
          if (!localUnchanged) {
            conflicts += 1;
            await this.reportAutomaticConflict(mapping, target, relativePath, 'Local changed while the remote directory changed.');
            continue;
          }
        }
        if (!local) {
          operations.push({
            id: `remote-watch-mkdir-${crypto.randomUUID()}`,
            type: 'createLocalDirectory',
            relativePath,
            localRelativePath,
            remoteRelativePath,
            reason: 'Remote directory creation detected by Workspace Sync Remote Watch.',
            expectedLocal: undefined,
            expectedRemote: remote
          });
        } else {
          baselineUpdates[relativePath] = { local, remote, localRelativePath, remoteRelativePath };
        }
        continue;
      }

      // Remote is a regular file from here on. For a path without a trusted
      // baseline, compare content once before deciding whether it is safe to
      // establish trust or whether the situation is a conflict.
      if (!baseline) {
        if (!local) {
          operations.push({
            id: `remote-watch-download-${crypto.randomUUID()}`,
            type: 'download',
            relativePath,
            localRelativePath,
            remoteRelativePath,
            reason: 'New remote file detected by Workspace Sync Remote Watch.',
            expectedLocal: undefined,
            expectedRemote: remote
          });
          continue;
        }
        if (local.kind !== 'file') {
          conflicts += 1;
          await this.reportAutomaticConflict(mapping, target, relativePath, `Remote is a file while Local is ${local.kind}.`);
          continue;
        }

        local = await readLocalFingerprint(localPath, true) || local;
        const remoteWithHash = remote.hash ? remote : (await readRemoteFingerprint(session, remotePath, true) || remote);
        if (fingerprintsEqual(local, remoteWithHash, { mtimeReliable: false, requireHashWhenAvailable: true })) {
          baselineUpdates[relativePath] = { local, remote: remoteWithHash, localRelativePath, remoteRelativePath };
          continue;
        }
        if (!sourceIsAuthoritative && mapping.options.conflictProtection) {
          conflicts += 1;
          await this.reportAutomaticConflict(mapping, target, relativePath, 'Remote file changed but there is no trusted sync baseline for an existing Local file.');
          continue;
        }
      } else if (!sourceIsAuthoritative) {
        const localUnchanged = fingerprintsEqual(local, baseline.local, {
          mtimeReliable: true,
          requireHashWhenAvailable: true
        });
        if (!localUnchanged) {
          conflicts += 1;
          await this.reportAutomaticConflict(mapping, target, relativePath, 'Local and Remote both changed since the last trusted sync state.');
          continue;
        }
      }

      if (local && local.kind !== 'file') {
        conflicts += 1;
        await this.reportAutomaticConflict(mapping, target, relativePath, `Remote is a file while Local is ${local.kind}.`);
        continue;
      }

      operations.push({
        id: `remote-watch-download-${crypto.randomUUID()}`,
        type: 'download',
        relativePath,
        localRelativePath,
        remoteRelativePath,
        reason: 'Remote file change detected by Workspace Sync Remote Watch.',
        expectedLocal: local,
        expectedRemote: remote
      });
    }

    const baselineUpdatePaths = Object.keys(baselineUpdates);
    if (baselineUpdatePaths.length) {
      await this.baselines.mergeEntries(mapping.id, target.id, baselineUpdates);
      await this.refreshAutomaticPathsInView(
        mapping,
        target,
        session,
        baselineUpdatePaths.map(relativePath => {
          const remoteEntry = remoteSnapshot.entries[relativePath];
          return {
            relativePath,
            observation: {
              remoteKnown: true,
              remote: remoteEntry?.fingerprint,
              remoteRelativePath: remoteEntry?.physicalRelativePath || relativePath
            }
          };
        }),
        undefined,
        true
      ).catch(() => undefined);
    }
    if (!operations.length) {
      if (conflicts) this.log('WARN', `Remote Watch found ${conflicts} conflict(s): ${mapping.name} / ${target.name}.`);
      return;
    }

    const plan = singleOperationPlan(mapping, target, operations);
    const revalidated = await this.revalidatePlan(mapping, target, plan, session);
    if (revalidated.stale.length) {
      this.log('WARN', `Remote Watch stopped because ${revalidated.stale.length} path(s) changed during validation: ${mapping.name} / ${target.name}.`);
      return;
    }

    const result = await this.executePlan(mapping, target, plan, session, {
      atomicTransfer: mapping.options.atomicTransfer,
      journal: this.journal
    });
    await this.updateBaselineForOperations(mapping, target, session, result.completed);
    await this.reflectAutomaticOperationsInView(mapping, target, session, result.completed);
    const level = result.failed.length || conflicts ? 'WARN' : 'INFO';
    this.log(level, `Remote Watch applied ${result.completed.length} change(s): ${mapping.name} / ${target.name}${result.failed.length ? `, ${result.failed.length} failed` : ''}${conflicts ? `, ${conflicts} conflict(s)` : ''}.`);
  }

  private async handleWatchedChange(change: WorkspaceLocalChange): Promise<void> {
    const mapping = this.mappings.get(change.mappingId);
    if (!mapping) return;
    const watchTimer = this.diagnostics.timer();
    this.diagnostics.debug('Local Watch', 'Local change received.', { Mapping: mapping.name, Path: change.relativePath, Kind: change.kind, Source: change.source });
    const ignorePatterns = await loadEffectiveIgnorePatterns(mapping);
    const matcher = new IgnoreMatcher(ignorePatterns);
    if (matcher.ignores(change.relativePath, false)) {
      this.diagnostics.debug('Local Watch', 'Local change ignored by mapping rules.', { Mapping: mapping.name, Path: change.relativePath });
      return;
    }
    if (!isLocalChangeEnabled(change.source, mapping.options)) {
      this.diagnostics.debug('Local Watch', 'Local change source is disabled.', { Mapping: mapping.name, Path: change.relativePath, Source: change.source });
      return;
    }
    if (mapping.options.direction === 'remoteToLocal') {
      this.diagnostics.debug('Local Watch', 'Local change skipped because Direction is Remote -> Local.', { Mapping: mapping.name, Path: change.relativePath });
      return;
    }

    try {
      for (const target of mapping.targets.filter(item => item.enabled)) {
      // Suppress only the echo back to the exact mapping/target that caused a
      // Local filesystem mutation. Other mappings/targets sharing this Local
      // Root must still observe and process the change.
      if (change.source === 'watcher'
        && this.journal.isLocalMutation(change.absolutePath, { mappingId: mapping.id, targetId: target.id })) continue;
      try {
        if (!this.getConnectedAutomaticSession(mapping.id, target.id)) continue;
        await this.operations.run(this.runtimeKey(mapping.id, target.id), () =>
          this.localRootOperations.run(mapping.localRoot, () =>
            this.handleWatchedChangeForTarget(mapping, target, change)
          )
        );
      } catch (error) {
        this.log('WARN', `Workspace Sync automatic operation failed: ${mapping.name} / ${target.name} / ${change.relativePath}. ${error instanceof Error ? error.message : String(error)}`);
      }
      }
    } finally {
      this.diagnostics.performance('Local Watch', `Local change processing completed in ${formatDuration(watchTimer())}.`, { Mapping: mapping.name, Path: change.relativePath, Source: change.source });
    }
  }

  private async handleWatchedChangeForTarget(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    change: WorkspaceLocalChange
  ): Promise<void> {
    const currentMapping = this.mappings.get(mapping.id);
    const currentTarget = currentMapping?.targets.find(item => item.id === target.id);
    if (!currentMapping || !currentTarget?.enabled) return;
    mapping = currentMapping;
    target = currentTarget;
    const sourceIsAuthoritative = isWatchSourceAuthoritative(mapping.options.direction, 'local');
    // Re-check after both target and Local Root queues. A Disconnect request can
    // arrive while this automatic event is waiting; automatic work must never
    // reconnect or continue from a stale queued event.
    const session = this.getConnectedAutomaticSession(mapping.id, target.id);
    if (!session) return;
    await this.ensureBaselineContext(mapping, target, session);
    const baselineState = await this.baselines.get(mapping.id, target.id);
    const baseline = baselineState?.entries[change.relativePath];
    const localRelativePath = change.physicalRelativePath || baseline?.localRelativePath || change.relativePath;
    const remoteRelativePath = baseline?.remoteRelativePath || change.relativePath;
    const { localPath, remotePath } = resolveSyncPaths(mapping, target, change.relativePath, { localRelativePath, remoteRelativePath });
    // Watcher event sequences can collapse delete/create cycles in different
    // orders (atomic saves are a common example). Re-read Local before any
    // destructive action and only propagate a delete when the path is truly gone.
    let local = await readLocalFingerprint(localPath);

    if (change.kind === 'delete' && !local) {
      await this.refreshAutomaticPathsInView(mapping, target, session, [{
        relativePath: change.relativePath,
        observation: { localKnown: true, local: undefined, localRelativePath, remoteRelativePath }
      }]).catch(() => undefined);
      if (!mapping.options.propagateDeletes) return;

      if (sourceIsAuthoritative) {
        // Preserve the existing deepest-first expansion when a baseline knows
        // about a deleted directory, but do not require the Remote side to be
        // unchanged from that baseline. Local is authoritative in one-way mode.
        // Without a baseline, the concrete watcher path can still be deleted;
        // non-empty directory removal remains fail-closed in the executor.
        const deletePaths = baselineState
          ? collectWatchedDeletePaths(baselineState, change.relativePath)
          : [];
        const pathsToDelete = deletePaths.length ? deletePaths : [change.relativePath];
        const operations: SyncOperation[] = [];

        for (const relativePath of pathsToDelete) {
          const baselineEntry = baselineState?.entries[relativePath];
          const paths = resolveSyncPaths(mapping, target, relativePath, {
            localRelativePath: baselineEntry?.localRelativePath || (relativePath === change.relativePath ? localRelativePath : relativePath),
            remoteRelativePath: baselineEntry?.remoteRelativePath || relativePath
          });
          const currentRemote = await readRemoteFingerprint(session, paths.remotePath, !session.capabilities.reliableMtime);
          if (!currentRemote) continue;
          operations.push({
            id: `watch-delete-${crypto.randomUUID()}`,
            type: 'deleteRemote',
            relativePath,
            localRelativePath: paths.localRelativePath,
            remoteRelativePath: paths.remoteRelativePath,
            reason: relativePath === change.relativePath
              ? 'Local deletion detected by Workspace Sync watcher.'
              : `Local directory deletion includes '${change.relativePath}'.`,
            expectedLocal: undefined,
            expectedRemote: currentRemote
          });
        }

        if (!operations.length) {
          await this.baselines.updatePath(mapping.id, target.id, change.relativePath, undefined, undefined);
          await this.refreshAutomaticPathsInView(mapping, target, session, [{
            relativePath: change.relativePath,
            observation: { localKnown: true, local: undefined, localRelativePath, remoteRelativePath }
          }], undefined, true).catch(() => undefined);
          return;
        }
        const plan = singleOperationPlan(mapping, target, operations);
        const revalidated = await this.revalidatePlan(mapping, target, plan, session);
        if (revalidated.stale.length) {
          await this.reportAutomaticConflict(mapping, target, change.relativePath, 'Local or Remote changed while the delete plan was being prepared.');
          return;
        }
        const result = await this.executePlan(mapping, target, plan, session, {
          atomicTransfer: mapping.options.atomicTransfer,
          journal: this.journal
        });
        await this.updateBaselineForOperations(mapping, target, session, result.completed);
        await this.reflectAutomaticOperationsInView(mapping, target, session, result.completed);
        if (!result.failed.length) {
          this.log('INFO', `Workspace Sync propagated local delete: ${mapping.name} / ${target.name} / ${change.relativePath}.`);
        } else {
          this.log('WARN', `Workspace Sync local delete was only partially propagated: ${mapping.name} / ${target.name} / ${change.relativePath}. ${result.failed.length} of ${operations.length} remote delete operation(s) failed. Refresh to inspect the remaining Remote contents before retrying.`);
        }
        return;
      }

      if (!baselineState || !baseline?.local || !baseline.remote) return;

      const deletePaths = collectWatchedDeletePaths(baselineState, change.relativePath);
      if (!deletePaths.length) return;
      const operations: SyncOperation[] = [];

      for (const relativePath of deletePaths) {
        const baselineEntry = baselineState.entries[relativePath];
        if (!baselineEntry?.local || !baselineEntry.remote) continue;
        const paths = resolveSyncPaths(mapping, target, relativePath, {
          localRelativePath: baselineEntry.localRelativePath || (relativePath === change.relativePath ? localRelativePath : relativePath),
          remoteRelativePath: baselineEntry.remoteRelativePath || relativePath
        });
        const currentRemote = await readRemoteFingerprint(session, paths.remotePath, !session.capabilities.reliableMtime);
        if (!fingerprintsEqual(currentRemote, baselineEntry.remote, {
          mtimeReliable: session.capabilities.reliableMtime,
          requireHashWhenAvailable: true
        })) {
          await this.reportAutomaticConflict(mapping, target, relativePath, 'Remote changed before the local delete could be propagated.');
          return;
        }
        operations.push({
          id: `watch-delete-${crypto.randomUUID()}`,
          type: 'deleteRemote',
          relativePath,
          localRelativePath: paths.localRelativePath,
          remoteRelativePath: paths.remoteRelativePath,
          reason: relativePath === change.relativePath
            ? 'Local deletion detected by Workspace Sync watcher.'
            : `Local directory deletion includes '${change.relativePath}'.`,
          expectedLocal: undefined,
          expectedRemote: currentRemote
        });
      }

      if (!operations.length) return;
      const plan = singleOperationPlan(mapping, target, operations);
      const revalidated = await this.revalidatePlan(mapping, target, plan, session);
      if (revalidated.stale.length) {
        await this.reportAutomaticConflict(mapping, target, change.relativePath, 'Local or Remote changed while the delete plan was being prepared.');
        return;
      }
      const result = await this.executePlan(mapping, target, plan, session, {
        atomicTransfer: mapping.options.atomicTransfer,
        journal: this.journal
      });
      await this.updateBaselineForOperations(mapping, target, session, result.completed);
      await this.reflectAutomaticOperationsInView(mapping, target, session, result.completed);
      if (!result.failed.length) {
        this.log('INFO', `Workspace Sync propagated local delete: ${mapping.name} / ${target.name} / ${change.relativePath}.`);
      } else {
        this.log('WARN', `Workspace Sync local delete was only partially propagated: ${mapping.name} / ${target.name} / ${change.relativePath}. ${result.failed.length} of ${operations.length} remote delete operation(s) failed. Refresh to inspect the remaining Remote contents before retrying.`);
      }
      return;
    }


    if (!local) {
      await this.refreshAutomaticPathsInView(mapping, target, session, [{
        relativePath: change.relativePath,
        observation: { localKnown: true, local: undefined, localRelativePath, remoteRelativePath }
      }]).catch(() => undefined);
      return;
    }
    if (local.kind === 'directory') {
      const remoteDirectoryState = await readRemoteFingerprint(session, remotePath);
      await this.refreshAutomaticPathsInView(mapping, target, session, [{
        relativePath: change.relativePath,
        observation: { localKnown: true, local, remoteKnown: true, remote: remoteDirectoryState, localRelativePath, remoteRelativePath }
      }]).catch(() => undefined);
      if (remoteDirectoryState && remoteDirectoryState.kind !== 'directory') {
        await this.reportAutomaticConflict(mapping, target, change.relativePath, `Local is a directory while Remote is ${remoteDirectoryState.kind}.`);
        return;
      }
      if (remoteDirectoryState?.kind === 'directory') {
        await this.baselines.updatePath(mapping.id, target.id, change.relativePath, local, remoteDirectoryState, { localRelativePath, remoteRelativePath });
        await this.refreshAutomaticPathsInView(mapping, target, session, [{
          relativePath: change.relativePath,
          observation: { localKnown: true, local, remoteKnown: true, remote: remoteDirectoryState, localRelativePath, remoteRelativePath }
        }], undefined, true).catch(() => undefined);
        return;
      }

      // Keep automatic directory creation on the same revalidation/execution
      // path as manual Sync. In particular, this preserves symlink-ancestor
      // containment checks instead of calling the remote client directly.
      const operation: SyncOperation = {
        id: `watch-mkdir-${crypto.randomUUID()}`,
        type: 'createRemoteDirectory',
        relativePath: change.relativePath,
        localRelativePath,
        remoteRelativePath,
        reason: change.source === 'save' ? 'Upload on Save directory preparation.' : 'Local directory creation detected.',
        expectedLocal: local,
        expectedRemote: undefined
      };
      const plan = singleOperationPlan(mapping, target, [operation]);
      const revalidated = await this.revalidatePlan(mapping, target, plan, session);
      if (revalidated.stale.length) {
        await this.reportAutomaticConflict(mapping, target, change.relativePath, 'Local or Remote changed while the directory-create plan was being prepared.');
        return;
      }
      const result = await this.executePlan(mapping, target, plan, session, {
        atomicTransfer: mapping.options.atomicTransfer,
        journal: this.journal
      });
      if (result.failed.length) return;
      await this.updateBaselineForOperations(mapping, target, session, result.completed);
      await this.reflectAutomaticOperationsInView(mapping, target, session, result.completed);
      return;
    }
    if (local.kind !== 'file') {
      await this.refreshAutomaticPathsInView(mapping, target, session, [{
        relativePath: change.relativePath,
        observation: { localKnown: true, local, localRelativePath, remoteRelativePath }
      }]).catch(() => undefined);
      return;
    }
    let remote = await readRemoteFingerprint(session, remotePath, !session.capabilities.reliableMtime);
    if (!session.capabilities.reliableMtime && remote?.kind === 'file' && remote.size === local.size) {
      local = await readLocalFingerprint(localPath, true) || local;
    }
    await this.refreshAutomaticPathsInView(mapping, target, session, [{
      relativePath: change.relativePath,
      observation: { localKnown: true, local, remoteKnown: true, remote, localRelativePath, remoteRelativePath }
    }]).catch(() => undefined);

    if (!sourceIsAuthoritative && !baseline && mapping.options.conflictProtection && remote && !fingerprintsEqual(local, remote, {
      mtimeReliable: session.capabilities.reliableMtime,
      requireHashWhenAvailable: true
    })) {
      await this.reportAutomaticConflict(mapping, target, change.relativePath, 'Remote file already exists and there is no trusted sync baseline.');
      return;
    }
    if (!sourceIsAuthoritative && baseline) {
      const localChanged = !fingerprintsEqual(local, baseline.local, { mtimeReliable: true });
      const remoteChanged = !fingerprintsEqual(remote, baseline.remote, {
        mtimeReliable: session.capabilities.reliableMtime,
        requireHashWhenAvailable: true
      });
      if (remoteChanged && localChanged) {
        await this.reportAutomaticConflict(mapping, target, change.relativePath, 'Local and Remote both changed since the last sync.');
        return;
      }
      if (remoteChanged && !localChanged) return;
    }

    if (remote && fingerprintsEqual(local, remote, {
      mtimeReliable: session.capabilities.reliableMtime,
      requireHashWhenAvailable: true
    })) {
      await this.baselines.updatePath(mapping.id, target.id, change.relativePath, local, remote, { localRelativePath, remoteRelativePath });
      await this.refreshAutomaticPathsInView(mapping, target, session, [{
        relativePath: change.relativePath,
        observation: { localKnown: true, local, remoteKnown: true, remote, localRelativePath, remoteRelativePath }
      }], undefined, true).catch(() => undefined);
      return;
    }

    this.ui.log(change.source === 'save' ? 'Upload on Save triggered.' : 'Watch triggered.', 'info', `${mapping.name} / ${target.name}`);
    const operation: SyncOperation = {
      id: `watch-upload-${Date.now()}`,
      type: 'upload',
      relativePath: change.relativePath,
      localRelativePath,
      remoteRelativePath,
      reason: change.source === 'save' ? 'Upload on Save.' : 'Local filesystem change detected.',
      expectedLocal: local,
      expectedRemote: remote
    };
    const plan = singleOperationPlan(mapping, target, [operation]);
    const revalidated = await this.revalidatePlan(mapping, target, plan, session);
    if (revalidated.stale.length) return;
    const result = await this.executePlan(mapping, target, plan, session, {
      atomicTransfer: mapping.options.atomicTransfer,
      journal: this.journal
    });
    if (result.failed.length) return;

    const [nextLocal, nextRemote] = await Promise.all([
      readLocalFingerprint(localPath, !session.capabilities.reliableMtime),
      readRemoteFingerprint(session, remotePath, !session.capabilities.reliableMtime)
    ]);
    await this.baselines.updatePath(mapping.id, target.id, change.relativePath, nextLocal, nextRemote, { localRelativePath, remoteRelativePath });
    await this.reflectAutomaticOperationsInView(mapping, target, session, result.completed);
    this.log('INFO', `Workspace Sync automatic upload: ${mapping.name} / ${target.name} / ${change.relativePath}.`);
  }

  private invalidateStaleResolutions(runtime: MappingRuntimeState, stalePaths: string[]): boolean {
    if (!runtime.plan || !stalePaths.length) return false;
    const stale = new Set(stalePaths);
    let invalidated = false;
    runtime.diffs = runtime.diffs.map(diff => {
      if (!stale.has(diff.relativePath) || !diff.resolution || (diff.status !== 'conflict' && diff.status !== 'different')) return diff;
      const reset: DiffEntry = { ...diff };
      delete reset.resolution;
      invalidated = true;
      return reset;
    });
    return invalidated;
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const safe = this.ui.sanitize(message);
    appendOutputLog(this.output, level, safe);
    this.ui.log(safe, level === 'ERROR' ? 'error' : level === 'WARN' ? 'warning' : 'info');
  }

  private async revalidatePlan(
    mapping: WorkspaceSyncMapping, target: WorkspaceSyncTarget, plan: SyncPlan,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ) {
    const revalidateTimer = this.diagnostics.timer();
    this.diagnostics.debug('Planner', 'Plan revalidation started.', { Mapping: mapping.name, Target: target.name, Operations: plan.operations.length });
    const result = await revalidateSyncPlan(mapping, target, plan, session, cancellationToken);
    this.diagnostics.performance('Planner', `Plan revalidation completed in ${formatDuration(revalidateTimer())}.`, {
      Mapping: mapping.name,
      Target: target.name,
      Valid: result.valid.length,
      Stale: result.stale.length
    });
    for (const { operation, reason } of result.stale) {
      this.log('WARN', `Workspace Sync validation blocked ${mapping.name} / ${target.name} / ${operation.relativePath} (${operation.type}): ${reason}`);
    }
    return result;
  }

  private async executePlan(
    mapping: WorkspaceSyncMapping, target: WorkspaceSyncTarget, plan: SyncPlan,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    options: import('./execution/SyncExecutor').SyncExecutionOptions
  ) {
    const executionTimer = this.diagnostics.timer();
    this.diagnostics.debug('Executor', 'Plan execution started.', {
      Mapping: mapping.name,
      Target: target.name,
      Operations: plan.operations.length,
      AtomicTransfer: options.atomicTransfer
    });
    this.ui.log(`Executing ${plan.operations.length} planned operation(s).`, 'info', `${mapping.name} / ${target.name}`);
    const mutationOrigin = { mappingId: mapping.id, targetId: target.id };
    const scopedJournal = {
      beginLocalMutation: (filePath: string) => this.journal.beginLocalMutation(filePath, mutationOrigin),
      markLocalMutation: (filePath: string) => this.journal.markLocalMutation(filePath, mutationOrigin)
    };
    const result = await executeSyncPlan(mapping, target, plan, session, {
      ...options,
      // Always scope Local mutation suppression to the target executing this
      // plan. This prevents one mapping from hiding filesystem changes from
      // another mapping that intentionally shares the same Local Root.
      journal: scopedJournal,
      onOrphanedRemoteTemp: (tempRemotePath, operation) => {
        this.recordOrphanedRemoteTemp(mapping, target, tempRemotePath, operation.relativePath);
        options.onOrphanedRemoteTemp?.(tempRemotePath, operation);
      },
      onActivity: event => {
        const level: SyncActivity['level'] = event.kind === 'failed' ? 'error' : event.kind === 'retry' ? 'warning' : event.kind === 'completed' ? 'success' : 'info';
        const action = { upload: 'Upload', download: 'Download', createLocalDirectory: 'Create local directory', createRemoteDirectory: 'Create remote directory', deleteLocal: 'Delete local', deleteRemote: 'Delete remote', skip: 'Skip' }[event.operation.type];
        const targetLabel = `${mapping.name} / ${target.name}`;
        const inlineMessage = event.kind === 'failed' ? '' : event.message ? ` — ${event.message}` : '';
        this.ui.log(`${action} ${event.kind}: ${event.operation.relativePath}${inlineMessage}`, level, targetLabel);
        if (event.kind === 'failed' && event.message) {
          if (event.errorOutput) this.ui.log(`Error output: ${event.errorOutput}`, 'error', targetLabel);
          const guidance = describeSyncOperationFailure(event.operation, event.message);
          if (guidance) this.ui.log(guidance, 'warning', targetLabel);
        }
        options.onActivity?.(event);
      }
    });
    this.markFailedTransfersForStrongVerification(mapping, target, plan, result);
    await this.cleanupKnownOrphanedRemoteTemps(mapping, target, session);
    this.ui.log(`${result.cancelled ? 'Cancelled' : 'Finished'}: ${result.completed.length} completed, ${result.failed.length} failed, ${result.skipped.length} skipped.`, result.failed.length ? 'error' : result.cancelled ? 'warning' : 'success', `${mapping.name} / ${target.name}`);
    this.diagnostics.debug('Executor', 'Plan execution completed.', {
      Mapping: mapping.name,
      Target: target.name,
      Completed: result.completed.length,
      Failed: result.failed.length,
      Skipped: result.skipped.length,
      Cancelled: result.cancelled
    });
    this.diagnostics.performance('Executor', `Plan execution completed in ${formatDuration(executionTimer())}.`, {
      Mapping: mapping.name,
      Target: target.name,
      Operations: plan.operations.length,
      Completed: result.completed.length,
      Failed: result.failed.length,
      Skipped: result.skipped.length
    });
    return result;
  }

  private getConnectedAutomaticSession(mappingId: string, targetId: string) {
    const key = this.sessionKey(mappingId, targetId);
    if (this.disconnectRequested.has(key)) return undefined;
    if (this.sessions.getState(key).status !== 'connected') return undefined;
    return this.sessions.getSession(key);
  }

  private async ensureBaselineContext(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession
  ): Promise<boolean> {
    const changed = await this.baselines.ensureContext(mapping.id, target.id, {
      localRoot: mapping.localRoot,
      remoteRoot: target.remoteRoot,
      connectionId: target.connectionId,
      connectionIdentity: session.connectionIdentity
    });
    if (changed) {
      this.runtimeByTarget.delete(this.runtimeKey(mapping.id, target.id));
      this.log('INFO', `Workspace Sync baseline reset because the mapping target changed: ${mapping.name} / ${target.name}.`);
    }
    return changed;
  }

  private async reportAutomaticConflict(mapping: WorkspaceSyncMapping, target: WorkspaceSyncTarget, relativePath: string, reason: string): Promise<void> {
    const session = this.getConnectedAutomaticSession(mapping.id, target.id);
    if (session) {
      await this.refreshAutomaticPathsInView(mapping, target, session, [{
        relativePath,
        observation: { forceConflictReason: reason }
      }], undefined, true).catch(() => undefined);
    }
    this.log('WARN', `Workspace Sync conflict: ${mapping.name} / ${target.name} / ${relativePath}. ${reason}`);
    this.ui.log('Next step: Refresh if needed, then resolve the path with Use Local, Use Remote, or Skip. No file was overwritten by this conflict.', 'warning', `${mapping.name} / ${target.name}`);
  }

  private async trustEqualEntries(mappingId: string, targetId: string, diffs: DiffEntry[]): Promise<void> {
    const updates: Record<string, BaselineEntry | undefined> = {};
    for (const diff of diffs) {
      if (diff.status !== 'same') continue;
      if (diff.local && diff.remote) {
        updates[diff.relativePath] = {
          local: diff.local,
          remote: diff.remote,
          localRelativePath: diff.localRelativePath || diff.relativePath,
          remoteRelativePath: diff.remoteRelativePath || diff.relativePath
        };
      } else if (!diff.local && !diff.remote && diff.baseline) {
        // Both sides converged on deletion. Drop the old baseline entry so a
        // future recreation on either side is treated as a new file rather
        // than as a change-vs-delete conflict against stale history.
        updates[diff.relativePath] = undefined;
      }
    }
    if (Object.keys(updates).length) await this.baselines.mergeEntries(mappingId, targetId, updates);
  }

  private async updateBaselineForOperations(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    operations: SyncOperation[]
  ): Promise<Array<{ relativePath: string; observation: AutomaticPathObservation }>> {
    const states = await Promise.all(operations.map(async operation => {
      if (operation.type === 'skip') return undefined;
      const { localPath, remotePath, localRelativePath, remoteRelativePath } = resolveSyncPaths(mapping, target, operation.relativePath, operation);
      const includeHash = !session.capabilities.reliableMtime;
      const [local, remote] = await Promise.all([
        readLocalFingerprint(localPath, includeHash),
        readRemoteFingerprint(session, remotePath, includeHash)
      ]);
      return { operation, local, remote, localRelativePath, remoteRelativePath };
    }));

    const updates: Record<string, BaselineEntry | undefined> = {};
    const observations: Array<{ relativePath: string; observation: AutomaticPathObservation }> = [];
    for (const state of states) {
      if (!state) continue;
      const { operation, local, remote, localRelativePath, remoteRelativePath } = state;
      updates[operation.relativePath] = local || remote
        ? {
          local,
          remote,
          localRelativePath: local ? localRelativePath : undefined,
          remoteRelativePath: remote ? remoteRelativePath : undefined
        }
        : undefined;
      observations.push({
        relativePath: operation.relativePath,
        observation: {
          localKnown: true,
          local,
          remoteKnown: true,
          remote,
          localRelativePath,
          remoteRelativePath
        }
      });
    }

    if (Object.keys(updates).length) await this.baselines.mergeEntries(mapping.id, target.id, updates);
    for (const operation of operations) {
      if (operation.type === 'upload' || operation.type === 'download') {
        this.clearStrongVerificationPath(mapping.id, target.id, operation.relativePath);
      }
    }
    return observations;
  }

  private markStrongVerificationPath(mappingId: string, targetId: string, relativePath: string): void {
    const key = this.runtimeKey(mappingId, targetId);
    const paths = this.strongVerificationPaths.get(key) || new Set<string>();
    paths.add(relativePath);
    this.strongVerificationPaths.set(key, paths);
  }

  private clearStrongVerificationPath(mappingId: string, targetId: string, relativePath: string): void {
    const key = this.runtimeKey(mappingId, targetId);
    const paths = this.strongVerificationPaths.get(key);
    if (!paths) return;
    paths.delete(relativePath);
    if (!paths.size) this.strongVerificationPaths.delete(key);
  }

  private clearStrongVerificationForProvenSame(mappingId: string, targetId: string, diffs: DiffEntry[]): void {
    for (const diff of diffs) {
      if (diff.status !== 'same' || diff.local?.kind !== 'file' || diff.remote?.kind !== 'file') continue;
      if (!diff.local.hash || !diff.remote.hash || diff.local.hash !== diff.remote.hash) continue;
      this.clearStrongVerificationPath(mappingId, targetId, diff.relativePath);
    }
  }

  private markFailedTransfersForStrongVerification(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    plan: SyncPlan,
    result: import('./execution/SyncExecutor').SyncExecutionResult
  ): void {
    for (const item of result.failed) {
      if (item.operation.type === 'upload' || item.operation.type === 'download') {
        this.markStrongVerificationPath(mapping.id, target.id, item.operation.relativePath);
      }
    }
    if (!result.cancelled) return;
    const completedIds = new Set(result.completed.map(operation => operation.id));
    for (const operation of plan.operations) {
      if ((operation.type === 'upload' || operation.type === 'download') && !completedIds.has(operation.id)) {
        this.markStrongVerificationPath(mapping.id, target.id, operation.relativePath);
      }
    }
  }

  private recordOrphanedRemoteTemp(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    tempRemotePath: string,
    relativePath: string
  ): void {
    // Only accept the exact UUID-based format generated by SyncExecutor. This
    // prevents cleanup from ever targeting arbitrary user *.tmp files.
    if (!/\.remoteedit-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i.test(tempRemotePath)) return;
    const key = this.runtimeKey(mapping.id, target.id);
    const items = this.orphanedRemoteTemps.get(key) || new Map<string, string>();
    items.set(tempRemotePath, relativePath);
    this.orphanedRemoteTemps.set(key, items);
    this.markStrongVerificationPath(mapping.id, target.id, relativePath);
  }

  private async cleanupKnownOrphanedRemoteTemps(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession
  ): Promise<void> {
    const key = this.runtimeKey(mapping.id, target.id);
    const items = this.orphanedRemoteTemps.get(key);
    if (!items?.size) return;

    for (const [tempRemotePath, relativePath] of [...items.entries()]) {
      try {
        const stat = await session.stat(tempRemotePath);
        if (!stat) {
          items.delete(tempRemotePath);
          continue;
        }
        if (stat.kind !== 'file') {
          this.log('WARN', `Workspace Sync left an internal temp path untouched because it is not a file: ${tempRemotePath}`);
          items.delete(tempRemotePath);
          continue;
        }
        await session.deleteFile(tempRemotePath);
        items.delete(tempRemotePath);
        this.markStrongVerificationPath(mapping.id, target.id, relativePath);
        this.ui.log(`Removed orphaned atomic-transfer temporary file: ${path.posix.basename(tempRemotePath)}`, 'info', `${mapping.name} / ${target.name}`);
      } catch {
        // Keep it queued. A broken connection may make cleanup impossible now;
        // the exact path will be retried after the next explicit reconnect.
      }
    }
    if (!items.size) this.orphanedRemoteTemps.delete(key);
  }

  private async getLocalCaseSensitivity(localRoot: string): Promise<boolean | undefined> {
    if (this.localCaseSensitivityByRoot.has(localRoot)) return this.localCaseSensitivityByRoot.get(localRoot);
    const existing = this.localCaseSensitivityFlights.get(localRoot);
    if (existing) return existing;

    const flight = detectLocalCaseSensitivity(localRoot).then(detected => {
      this.localCaseSensitivityByRoot.set(localRoot, detected);
      return detected;
    }).finally(() => {
      if (this.localCaseSensitivityFlights.get(localRoot) === flight) this.localCaseSensitivityFlights.delete(localRoot);
    });
    this.localCaseSensitivityFlights.set(localRoot, flight);
    return flight;
  }


  private requireMapping(mappingId: string): WorkspaceSyncMapping {
    const mapping = this.mappings.get(mappingId);
    if (!mapping) throw new Error('The selected Workspace Sync mapping no longer exists.');
    return mapping;
  }

  private requireTarget(mapping: WorkspaceSyncMapping, targetId: string): WorkspaceSyncTarget {
    const target = mapping.targets.find(item => item.id === targetId);
    if (!target) throw new Error('The selected Workspace Sync target no longer exists.');
    return target;
  }

  private requireEnabledTarget(mapping: WorkspaceSyncMapping, targetId: string): WorkspaceSyncTarget {
    const target = this.requireTarget(mapping, targetId);
    if (!target.enabled) {
      throw new Error(`Workspace Sync target '${target.name}' is disabled. Enable it in the mapping before running this operation.`);
    }
    return target;
  }

  private requireSession(mappingId: string, targetId: string) {
    const session = this.sessions.getSession(this.sessionKey(mappingId, targetId));
    if (!session) throw new Error('Connect Workspace Sync before running this operation.');
    return session;
  }

  private sessionKey(mappingId: string, targetId: string): string {
    return `mapping:${mappingId}:target:${targetId}`;
  }

  private runtimeKey(mappingId: string, targetId: string): string {
    return `${mappingId}::${targetId}`;
  }
}


function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}


function validateConflictResolutionChoice(diff: DiffEntry, resolution: Exclude<WorkspaceSyncConflictResolution, 'skip'>): void {
  if (diff.local && diff.remote && diff.local.kind !== diff.remote.kind) {
    throw new Error('File/directory structural conflicts must be corrected manually before Sync can continue.');
  }
  const source = resolution === 'useLocal' ? diff.local : diff.remote;
  if (source && source.kind !== 'file' && source.kind !== 'directory') {
    throw new Error('Symbolic links and unsupported file types cannot be selected as a conflict winner automatically.');
  }
}


function initialWatchOperation(
  diff: DiffEntry,
  source: 'local' | 'remote',
  propagateDeletes: boolean
): SyncOperation | undefined {
  const useLocal = source === 'local';
  const sourceFingerprint = useLocal ? diff.local : diff.remote;
  const destinationFingerprint = useLocal ? diff.remote : diff.local;

  if (!sourceFingerprint) {
    if (!destinationFingerprint || !propagateDeletes) return undefined;
    return {
      id: `watch-initial-${crypto.randomUUID()}`,
      type: useLocal ? 'deleteRemote' : 'deleteLocal',
      relativePath: diff.relativePath,
      localRelativePath: diff.localRelativePath,
      remoteRelativePath: diff.remoteRelativePath,
      reason: useLocal
        ? 'Initial Watch reconciliation is propagating the Local deletion.'
        : 'Initial Watch reconciliation is propagating the Remote deletion.',
      expectedLocal: diff.local,
      expectedRemote: diff.remote
    };
  }

  const type: SyncOperation['type'] = sourceFingerprint.kind === 'file'
    ? (useLocal ? 'upload' : 'download')
    : sourceFingerprint.kind === 'directory'
      ? (useLocal ? 'createRemoteDirectory' : 'createLocalDirectory')
      : 'skip';
  return {
    id: `watch-initial-${crypto.randomUUID()}`,
    type,
    relativePath: diff.relativePath,
    localRelativePath: diff.localRelativePath,
    remoteRelativePath: diff.remoteRelativePath,
    reason: sourceFingerprint.kind === 'link'
      ? 'Symbolic links are not transferred automatically.'
      : useLocal
        ? 'Initial Watch reconciliation is applying the Local version.'
        : 'Initial Watch reconciliation is applying the Remote version.',
    expectedLocal: diff.local,
    expectedRemote: diff.remote
  };
}

function explicitTransferOperation(diff: DiffEntry, direction: 'upload' | 'download'): SyncOperation | undefined {
  const source = direction === 'upload' ? diff.local : diff.remote;
  if (!source) return undefined;
  const type: SyncOperation['type'] = source.kind === 'file'
    ? direction
    : source.kind === 'directory'
      ? (direction === 'upload' ? 'createRemoteDirectory' : 'createLocalDirectory')
      : 'skip';
  return {
    id: `manual-${crypto.randomUUID()}`,
    type,
    relativePath: diff.relativePath,
    localRelativePath: diff.localRelativePath,
    remoteRelativePath: diff.remoteRelativePath,
    reason: source.kind === 'link'
      ? 'Symbolic links are not transferred automatically.'
      : `Explicit ${direction} selected by the user.`,
    expectedLocal: diff.local,
    expectedRemote: diff.remote
  };
}

function singleOperationPlan(
  mapping: WorkspaceSyncMapping,
  target: WorkspaceSyncTarget,
  operations: SyncOperation[]
): SyncPlan {
  return {
    mappingId: mapping.id,
    targetId: target.id,
    createdAt: Date.now(),
    direction: mapping.options.direction,
    operations,
    conflicts: [],
    errors: []
  };
}

function planMutatesLocal(plan: SyncPlan): boolean {
  return plan.operations.some(operation =>
    operation.type === 'download'
    || operation.type === 'createLocalDirectory'
    || operation.type === 'deleteLocal'
  );
}

async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
  shouldStop: () => boolean = () => false
): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(items.length, Math.floor(concurrency || 1)));
  const results: Array<R | undefined> = new Array(items.length);
  let nextIndex = 0;
  let firstError: unknown;

  const runWorker = async (): Promise<void> => {
    while (!firstError && !shouldStop()) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        firstError = firstError || error;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  if (firstError) throw firstError;
  return results.filter((result): result is R => result !== undefined);
}

function createAggregateSyncProgress(
  targets: WorkspaceSyncTarget[],
  initialTotals: Map<string, number>,
  report?: (progress: WorkspaceSyncProgress) => void
): {
  forTarget: (target: WorkspaceSyncTarget) => (progress: WorkspaceSyncProgress) => void;
  complete: (cancelled: boolean) => void;
} {
  const states = new Map(targets.map(target => [target.id, {
    completed: 0,
    total: Math.max(0, initialTotals.get(target.id) || 0),
    currentPath: undefined as string | undefined,
    phase: undefined as string | undefined
  }]));

  const emit = (activeTarget?: WorkspaceSyncTarget, finalPhase?: string): void => {
    if (!report) return;
    let completed = 0;
    let total = 0;
    for (const state of states.values()) {
      completed += Math.max(0, state.completed);
      total += Math.max(0, state.total);
    }
    const state = activeTarget ? states.get(activeTarget.id) : undefined;
    report({
      completed,
      total,
      currentPath: state?.currentPath,
      phase: finalPhase || (activeTarget && state?.phase ? `${activeTarget.name}: ${state.phase}` : state?.phase)
    });
  };

  return {
    forTarget: target => progress => {
      const state = states.get(target.id);
      if (!state) return;
      state.completed = progress.completed;
      state.total = Math.max(0, progress.total);
      state.currentPath = progress.currentPath ? `${target.name} / ${progress.currentPath}` : undefined;
      state.phase = progress.phase;
      emit(target);
    },
    complete: cancelled => emit(undefined, cancelled ? 'Cancelled.' : 'Sync complete.')
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (!items.length) return;
  const limit = Math.max(1, Math.min(items.length, Math.floor(concurrency || 1)));
  let nextIndex = 0;
  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}

function formatDuration(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  return safe < 1000 ? `${safe} ms` : `${(safe / 1000).toFixed(2)} s`;
}
