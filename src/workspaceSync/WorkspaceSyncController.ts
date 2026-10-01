import { settlesWithin } from './connection/SessionLifetime';
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
import { WorkspaceMappingStore, getWorkspaceSyncPreferences, setWorkspaceSyncPreferences } from './mapping/WorkspaceMappingStore';
import { BaselineStore } from './baseline/BaselineStore';
import { WorkspaceSyncSessionManager } from './connection/WorkspaceSyncSessionManager';
import { scanLocalTree } from './scan/LocalScanner';
import { scanRemoteTree } from './scan/RemoteScanner';
import { scanLocalSubtree, scanRemoteSubtree } from './scan/SubtreeScanner';
import { diffSnapshots } from './compare/DiffEngine';
import { verifyComparisonContent } from './compare/ContentVerifier';
import { baselineRequiresStrongFingerprint, readAndClassifyCurrentPath } from './compare/CurrentPathClassifier';
import { suggestConflictResolution } from './compare/ResolutionSuggestions';
import { protectCaseCollisions } from './compare/PathCollisionDetector';
import { detectLocalCaseSensitivity } from './compare/LocalFilesystemCapabilities';
import { WorkspaceSyncDiffTempStore } from './compare/DiffTempStore';
import { buildSyncPlan } from './planning/SyncPlanner';
import { localFilenameStyle } from './planning/PathCompatibility';
import { revalidateSyncPlan } from './planning/SyncRevalidator';
import { expandDirectoryDeletePlan } from './planning/DirectoryDeleteExpansion';
import { executeSyncPlan } from './execution/SyncExecutor';
import { describeSyncOperationFailure } from './execution/OperationFailureDetails';
import { TargetOperationQueue } from './execution/TargetOperationQueue';
import { LocalRootOperationCoordinator, localRootsOverlap, type LocalPathAccess } from './execution/LocalRootOperationCoordinator';
import { validateUniqueMappingRoutes, validateUniqueTargetDestinations, type WorkspaceMappingInput } from './mapping/WorkspaceMapping';
import { loadEffectiveIgnorePatterns } from './ignore/IgnoreRules';
import { IgnoreMatcher } from './ignore/IgnoreMatcher';
import { OperationJournal } from './watcher/OperationJournal';
import { WorkspaceWatcher, type WorkspaceLocalChange } from './watcher/WorkspaceWatcher';
import { WatchRetryQueue } from './watcher/WatchRetryQueue';
import type { WorkspaceSyncRemoteSession } from './connection/WorkspaceSyncSession';
import { RemoteWorkspaceWatcher } from './watcher/RemoteWorkspaceWatcher';
import { collectRemoteWatchChangedPaths } from './watcher/RemoteWatchDiff';
import { initialWatchReconcileDecision, isLocalChangeEnabled, isWatchSourceAuthoritative } from './watcher/WatcherCoalescing';
import { collectWatchedDeletePaths } from './watcher/WatchedDeletePlan';
import { readLocalFingerprint, readRemoteFingerprint } from './snapshot/CurrentState';
import { resolveSyncPaths } from './execution/SyncPathUtils';
import { WorkspaceSyncLastKnownViewStore } from './view/LastKnownViewStore';
import type {
  BaselineEntry,
  DiffEntry,
  FileFingerprint,
  SyncOperation,
  SyncPlan,
  SyncSnapshot,
  SyncBaseline,
  WorkspaceSyncConflictResolution,
  WorkspaceSyncConnectionSummary,
  WorkspaceSyncMapping,
  WorkspaceSyncProgress,
  WorkspaceSyncTarget,
  WorkspaceSyncTargetSummary
} from './types';


interface RemoteWatchSnapshotState {
  retryPaths?: string[];
  snapshot: SyncSnapshot;
  connectionIdentity: string;
  mappingUpdatedAt: number;
  targetUpdatedAt: number;
}

interface LocalWatchRetry {
  mapping: WorkspaceSyncMapping;
  target: WorkspaceSyncTarget;
  change: WorkspaceLocalChange;
  session: WorkspaceSyncRemoteSession;
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
  localMutationEpoch?: number;
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
const MAX_DEFERRED_DELETE_REEVALUATIONS = 3;

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
  kind: 'refresh' | 'watch';
  label: string;
  mappingId?: string;
  targetId?: string;
  detail?: string;
  cancellable?: boolean;
}

export interface WorkspaceSyncViewState {
  connections: WorkspaceSyncConnectionSummary[];
  mappings: WorkspaceSyncMapping[];
  activeMappingId?: string;
  activeTargetId?: string;
  targetStates: WorkspaceSyncTargetSummary[];
  targetViews: WorkspaceSyncTargetViewState[];
  mappingInitializing?: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  connectionMessage?: string;
  connectionConfigChanged?: boolean;
  diffs: DiffEntry[];
  plan?: SyncPlan;
  lastComparedAt?: number;
  showingLastKnownState?: boolean;
  hideUnsupportedFiles: boolean;
  showModifiedTimes: boolean;
  defaultCompare: 'internal' | 'vscode';
}


export class WorkspaceSyncController implements vscode.Disposable {
  private disposed = false;
  readonly ui: WorkspaceSyncUi;
  private readonly uiSubscriptions: vscode.Disposable[] = [];
  readonly mappings: WorkspaceMappingStore;
  readonly baselines: BaselineStore;
  readonly sessions: WorkspaceSyncSessionManager;
  private readonly journal = new OperationJournal();
  private readonly operations = new TargetOperationQueue();
  private readonly localRootOperations = new LocalRootOperationCoordinator();
  /** Remote writes to the same endpoint remain serialized until remote-path
   * containment has been proven across all remote filesystem conventions. */
  private readonly remoteEndpointOperations = new LocalRootOperationCoordinator();
  /** Manual Disconnect takes effect immediately for queued automatic work. */
  private readonly disconnectRequested = new Set<string>();
  private readonly watcher: WorkspaceWatcher;
  private readonly remoteWatcher: RemoteWorkspaceWatcher;
  private readonly localWatchRetries = new WatchRetryQueue<LocalWatchRetry>(async retry => {
    if (!this.isLocalWatchRetryCurrent(retry)) return;
    await this.dispatchLocalWatchChange(retry.mapping, retry.target, retry.change, retry.session);
  });
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
  /** Connected sessions do not start Watch until their first Compare/reconciliation finishes. */
  private readonly preparingTargets = new Set<string>();
  /** An automatic Watch transfer is executing on this exact mapping/target. */
  private readonly watchingTargets = new Set<string>();
  /** Connected but deliberately not eligible for automatic Watch/Sync after Cancel. */
  private readonly suspendedTargets = new Set<string>();
  private readonly initializingMappings = new Map<string, number>();
  /** Cancellation belongs to the background INITIAL refresh, not the foreground Connect. */
  private readonly initialRefreshTokens = new Map<string, Set<vscode.CancellationTokenSource>>();
  /** Cross-mapping Local mutations are reclassified and, when Local Watch is
   * enabled, fed through the SAME target Watch pipeline as filesystem events.
   * The map coalesces paths per target while preserving delete semantics. */
  private readonly pendingSharedLocalPaths = new Map<string, Map<string, { kind: WorkspaceLocalChange['kind']; physicalRelativePath: string }>>();
  private localMutationEpoch = 0;
  private readonly lastLocalMutationByRoot = new Map<string, number>();
  private sharedLocalRefreshTimer: ReturnType<typeof setTimeout> | undefined;
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
        const sessionKey = this.sessionKey(request.mappingId, request.targetId);
        if (this.disconnectRequested.has(sessionKey)) {
          if (mapping && target) this.ui.log('Remote Watch stopped during disconnect.', 'info', `${mapping.name} / ${target.name}`);
          return true;
        }
        this.log('WARN', `Remote Watch failed${mapping && target ? `: ${mapping.name} / ${target.name}` : ''}. ${message}`);
        return false;
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
    if (this.disposed) return;
    this.disposed = true;
    this.localWatchRetries.dispose();
    this.operations.dispose();
    this.uiSubscriptions.forEach(item => item.dispose());
    this.ui.dispose();
    this.watcher.dispose();
    this.remoteWatcher.dispose();
    this.remoteWatchSnapshots.clear();
    this.refreshFlights.clear();
    this.localCaseSensitivityFlights.clear();
    this.strongVerificationPaths.clear();
    this.orphanedRemoteTemps.clear();
    this.preparingTargets.clear();
    this.suspendedTargets.clear();
    for (const sources of this.initialRefreshTokens.values()) for (const source of sources) { source.cancel(); source.dispose(); }
    this.initialRefreshTokens.clear();
    this.initializingMappings.clear();
    this.pendingSharedLocalPaths.clear();
    this.lastLocalMutationByRoot.clear();
    if (this.sharedLocalRefreshTimer) clearTimeout(this.sharedLocalRefreshTimer);
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
          preparing: state.status === 'connected' && this.preparingTargets.has(this.runtimeKey(activeMapping.id, target.id)),
          watching: state.status === 'connected' && this.watchingTargets.has(this.runtimeKey(activeMapping.id, target.id)),
          preparationCancelled: state.status === 'connected' && this.suspendedTargets.has(this.runtimeKey(activeMapping.id, target.id)),
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
        const profile = connectionProfiles.get(target.connectionId);
        const sourceDiffs = runtime?.diffs || lastKnown?.diffs || [];
        const diffs = sourceDiffs.map(diff => decorateResolutionSuggestion(diff, profile?.connectionType === 'sftp'));
        return {
          targetId: target.id,
          targetName: target.name,
          diffs,
          plan: target.enabled && sessionState.status === 'connected'
            && !this.preparingTargets.has(this.runtimeKey(activeMapping.id, target.id))
            && !this.suspendedTargets.has(this.runtimeKey(activeMapping.id, target.id)) ? runtime?.plan : undefined,
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
      mappingInitializing: Boolean(activeMapping && this.initializingMappings.has(activeMapping.id)),
      connectionStatus: sessionState.status,
      connectionMessage: sessionState.message,
      connectionConfigChanged,
      diffs: activeView?.diffs || [],
      plan: activeView?.plan,
      lastComparedAt: activeView?.lastComparedAt,
      showingLastKnownState: activeView?.showingLastKnownState,
      hideUnsupportedFiles: getWorkspaceSyncPreferences(this.context).hideUnsupportedFiles,
      showModifiedTimes: getWorkspaceSyncPreferences(this.context).showModifiedTimes,
      defaultCompare: this.getDefaultCompareSetting()
    };
  }

  async setHideUnsupportedFiles(value: boolean): Promise<void> {
    await setWorkspaceSyncPreferences(this.context, { hideUnsupportedFiles: value });
    this.viewStateChangedEmitter.fire();
  }

  async setShowModifiedTimes(value: boolean): Promise<void> {
    await setWorkspaceSyncPreferences(this.context, { showModifiedTimes: value });
    this.viewStateChangedEmitter.fire();
  }

  async setDefaultCompare(value: 'internal' | 'vscode'): Promise<void> {
    const normalized = value === 'vscode' ? 'vscode' : 'internal';
    await vscode.workspace.getConfiguration('remoteedit.workspaceSync').update(
      'defaultCompare',
      normalized,
      vscode.ConfigurationTarget.Global
    );
    // Keep the Workspace Sync backup payload backward-compatible and usable
    // even when the user exports only Workspace Sync state.
    await setWorkspaceSyncPreferences(this.context, { defaultCompare: normalized });
    this.viewStateChangedEmitter.fire();
  }

  notifyConfigurationChanged(): void {
    this.viewStateChangedEmitter.fire();
  }

  private getDefaultCompareSetting(): 'internal' | 'vscode' {
    const config = vscode.workspace.getConfiguration('remoteedit.workspaceSync');
    const inspection = config.inspect<'internal' | 'vscode'>('defaultCompare');
    const explicit = inspection?.workspaceFolderValue ?? inspection?.workspaceValue ?? inspection?.globalValue;
    if (explicit === 'vscode' || explicit === 'internal') return explicit;
    // One-release compatibility path for users who exercised the pre-Settings
    // implementation. WorkspaceSyncFeature migrates this value to Settings.
    return getWorkspaceSyncPreferences(this.context).defaultCompare;
  }

  async saveMapping(input: WorkspaceMappingInput): Promise<WorkspaceSyncMapping> {
    if (input.id && this.initializingMappings.has(input.id)) {
      throw new Error('Wait until this mapping finishes its initial Refresh before saving changes.');
    }
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
          await this.disconnect(mapping.id, previousTarget.id);
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
          await this.disconnect(mapping.id, nextTarget.id);
        }
      }
    }

    for (const target of mapping.targets) {
      this.runtimeByTarget.delete(this.runtimeKey(mapping.id, target.id));
    }

    if (ignorePatternsChanged) {
      // Removing an Ignore rule can reveal paths never scanned previously.
      await this.lastViews.clear(mapping.id);
    }

    // Save must follow the SAME two-phase pipeline as an explicit Connect:
    // refresh every already-connected target in parallel, then reconcile each
    // target under path-aware Local Root protection. A target selected in
    // the combobox, or an enabled but disconnected target, changes nothing here.
    // Mark every participant before returning from Save; otherwise Sync could
    // execute against a stale plan while the background task is being queued.
    const connected = mapping.targets.flatMap(target => {
      const sessionKey = this.sessionKey(mapping.id, target.id);
      const session = target.enabled && !this.disconnectRequested.has(sessionKey)
        && this.sessions.getState(sessionKey).status === 'connected'
        ? this.sessions.getSession(sessionKey) : undefined;
      return session ? [{ target, session }] : [];
    });
    for (const { target } of connected) this.preparingTargets.add(this.runtimeKey(mapping.id, target.id));
    this.refreshWatchers();
    if (connected.length) this.startPostConnectInitialization(mapping, connected);

    this.ui.notify(`Mapping saved: ${mapping.name}.`, 'success');
    return mapping;
  }

  async deleteMapping(mappingId: string): Promise<void> {
    if (this.initializingMappings.has(mappingId)) {
      throw new Error('Wait until this mapping finishes its initial Refresh before deleting it.');
    }
    const mapping = this.mappings.get(mappingId);
    if (mapping) {
      for (const target of mapping.targets) this.disconnectRequested.add(this.sessionKey(mappingId, target.id));
      await Promise.all(mapping.targets.map(target =>
        this.disconnect(mappingId, target.id)
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
    this.initializingMappings.clear();
    this.runtimeByTarget.clear();
    this.preparingTargets.clear();
    this.remoteWatchSnapshots.clear();
    // Restore Watch registrations without opening remote connections.
    this.refreshWatchers();
    this.ui.log('Workspace Sync configuration reloaded from persistent storage.');
  }

  /** Establish the private session first; initial Compare/Watch continues separately. */
  async connect(
    mappingId: string,
    targetId: string,
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<void> {
    const mapping = this.requireMapping(mappingId);
    const target = this.requireEnabledTarget(mapping, targetId);
    if (cancellationToken?.isCancellationRequested) return;
    const session = await this.openTargetConnection(mapping, target, false, cancellationToken);
    if (session && !cancellationToken?.isCancellationRequested) {
      this.startPostConnectInitialization(mapping, [{ target, session }], progress);
    }
  }

  private async openTargetConnection(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    reconnect: boolean,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession | undefined> {
    const key = this.runtimeKey(mapping.id, target.id);
    const sessionKey = this.sessionKey(mapping.id, target.id);
    this.disconnectRequested.delete(sessionKey);
    this.suspendedTargets.delete(key);
    this.preparingTargets.add(key);
    this.runtimeByTarget.delete(key);
    this.remoteWatchSnapshots.delete(key);
    this.refreshWatchers();
    const timer = this.diagnostics.timer();
    try {
      const session = await this.operations.run(key, async () => {
        if (cancellationToken?.isCancellationRequested || this.disconnectRequested.has(sessionKey)) return undefined;
        if (reconnect) await this.sessions.disconnect(sessionKey);
        const session = await this.sessions.connect(sessionKey, target.connectionId);
        if (cancellationToken?.isCancellationRequested || this.disconnectRequested.has(sessionKey)) {
          await this.sessions.disconnectSessionIfCurrent(sessionKey, session);
          this.preparingTargets.delete(key);
          return undefined;
        }
        return session;
      });
      // Cancellation before the target queue acquires its turn must not leave
      // the target stuck in the preparing state.
      if (!session) this.preparingTargets.delete(key);
      return session;
    } catch (error) {
      this.preparingTargets.delete(key);
      this.diagnostics.debug('Controller', 'Physical connection failed.', {
        Mapping: mapping.name, Target: target.name,
        Error: this.ui.sanitize(error instanceof Error ? error.message : String(error))
      });
      throw error;
    } finally {
      this.diagnostics.performance('Controller', `Physical ${reconnect ? 'Reconnect' : 'Connect'} finished in ${formatDuration(timer())}.`, {
        Mapping: mapping.name, Target: target.name
      });
      this.refreshWatchers();
    }
  }

  private startPostConnectInitialization(
    mapping: WorkspaceSyncMapping,
    connections: Array<{ target: WorkspaceSyncTarget; session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession }>,
    progress?: (progress: WorkspaceSyncProgress) => void
  ): void {
    if (this.disposed || !connections.length) return;
    const source = new vscode.CancellationTokenSource();
    let tokens = this.initialRefreshTokens.get(mapping.id);
    if (!tokens) this.initialRefreshTokens.set(mapping.id, tokens = new Set());
    tokens.add(source);
    this.initializingMappings.set(mapping.id, (this.initializingMappings.get(mapping.id) || 0) + 1);
    this.backgroundActivityEmitter.fire({
      active: true, kind: 'refresh', label: 'Refreshing connected targets...', mappingId: mapping.id,
      detail: `Refreshing: ${formatWorkspaceSyncTargetNames(connections.map(item => item.target.name))}`, cancellable: true
    });
    void this.initializeConnectedTargets(mapping, connections, progress, source.token).catch(async error => {
      if (source.token.isCancellationRequested) {
        for (const { target, session } of connections) {
          if (this.sessions.getSession(this.sessionKey(mapping.id, target.id)) !== session) continue;
          const key = this.runtimeKey(mapping.id, target.id);
          if (!this.preparingTargets.has(key)) continue;
          this.preparingTargets.delete(key);
          this.runtimeByTarget.delete(key);
          this.suspendedTargets.add(key);
        }
        this.refreshWatchers();
        this.ui.log('Initial Refresh cancelled. The connection remains open; run Refresh to complete Watch preparation.', 'warning', mapping.name);
        return;
      }
      for (const { target, session } of connections) {
        if (this.preparingTargets.has(this.runtimeKey(mapping.id, target.id))) {
          await this.failInitialPreparation(mapping, target, session, error);
        }
      }
      this.log('WARN', `Workspace Sync initial preparation failed: ${mapping.name}. ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => {
      // Cancellation can also arrive while reconciliation is finishing normally;
      // no cancelled target may acquire Watch or a stale Sync plan afterwards.
      if (source.token.isCancellationRequested) {
        for (const { target, session } of connections) {
          if (this.sessions.getSession(this.sessionKey(mapping.id, target.id)) !== session) continue;
          const key = this.runtimeKey(mapping.id, target.id);
          if (!this.preparingTargets.has(key)) continue;
          this.preparingTargets.delete(key);
          this.runtimeByTarget.delete(key);
          this.suspendedTargets.add(key);
        }
      }
      tokens!.delete(source);
      if (!tokens!.size) this.initialRefreshTokens.delete(mapping.id);
      source.dispose();
      const remaining = (this.initializingMappings.get(mapping.id) || 1) - 1;
      if (remaining > 0) this.initializingMappings.set(mapping.id, remaining);
      else {
        this.initializingMappings.delete(mapping.id);
        this.backgroundActivityEmitter.fire({
          active: false, kind: 'refresh', label: 'Refreshing connected targets...', mappingId: mapping.id
        });
      }
      this.refreshWatchers();
      this.viewStateChangedEmitter.fire();
    });
  }

  private async initializeConnectedTargets(
    mapping: WorkspaceSyncMapping,
    connections: Array<{ target: WorkspaceSyncTarget; session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession }>,
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: vscode.CancellationToken
  ): Promise<void> {
    const ready: typeof connections = [];
    // Network housekeeping is independent per target and never holds a Local Root lock.
    await runWithConcurrency(connections, MAX_PARALLEL_TARGET_REFRESHES, async connection => {
      if (cancellationToken?.isCancellationRequested) return;
      const { target, session } = connection;
      const sessionKey = this.sessionKey(mapping.id, target.id);
      try {
        await this.operations.run(this.runtimeKey(mapping.id, target.id), async () => {
          if (cancellationToken?.isCancellationRequested || this.sessions.getSession(sessionKey) !== session || this.disconnectRequested.has(sessionKey)) return;
          await this.ensureBaselineContext(mapping, target, session);
          if (cancellationToken?.isCancellationRequested) return;
          await this.cleanupKnownOrphanedRemoteTemps(mapping, target, session);
          if (cancellationToken?.isCancellationRequested) return;
          ready.push(connection);
        });
      } catch (error) {
        await this.failInitialPreparation(mapping, target, session, error);
      }
    });
    const current = ready.filter(({ target, session }) =>
      this.sessions.getSession(this.sessionKey(mapping.id, target.id)) === session
      && !this.disconnectRequested.has(this.sessionKey(mapping.id, target.id))
    );
    // Scan Local once while fetching every Remote snapshot concurrently. Plans
    // with independent Local paths can then reconcile at the same time.
    const refreshingTargets = new Set(current.map(item => item.target.name));
    let refreshedTargets = 0;
    let failedRefreshTargets = 0;
    const emitRefreshStatus = (): void => {
      const running = formatWorkspaceSyncTargetNames([...refreshingTargets]);
      const parts = [`${refreshedTargets}/${current.length} refreshed`];
      if (failedRefreshTargets) parts.push(`${failedRefreshTargets} failed`);
      if (running) parts.push(`Refreshing: ${running}`);
      this.backgroundActivityEmitter.fire({
        active: true, kind: 'refresh', label: 'Refreshing connected targets...', mappingId: mapping.id,
        detail: parts.join(' · '), cancellable: true
      });
    };
    emitRefreshStatus();
    const refreshed = await this.refreshTargetsInParallel(
      mapping,
      current.map(item => item.target),
      progress,
      cancellationToken,
      true,
      (target, state) => {
        if (state === 'started') return;
        refreshingTargets.delete(target.name);
        if (state === 'completed') refreshedTargets += 1;
        else failedRefreshTargets += 1;
        emitRefreshStatus();
      }
    );
    this.backgroundActivityEmitter.fire({
      active: true, kind: 'refresh', label: 'Reconciling connected targets...', mappingId: mapping.id,
      detail: `${refreshed.size}/${current.length} target(s) refreshed`, cancellable: true
    });
    let reconciledTargets = 0;
    await runWithConcurrency(current, MAX_PARALLEL_TARGET_SYNCS, async ({ target, session }) => {
      const key = this.runtimeKey(mapping.id, target.id);
      const sessionKey = this.sessionKey(mapping.id, target.id);
      try {
        await this.operations.run(key, async () => {
          if (cancellationToken?.isCancellationRequested || this.sessions.getSession(sessionKey) !== session || this.disconnectRequested.has(sessionKey)) return;
          let runtime = refreshed.get(target.id);
          if (!runtime) throw new Error('The initial Refresh could not complete.');
          // A previous writer might have completed after the shared scan. A
          // refreshed plan is still revalidated AFTER taking its path locks.
          if (this.localRootChangedAfter(mapping.localRoot, runtime.localMutationEpoch || 0)) {
            runtime = await this.localRootOperations.runShared(mapping.localRoot, () =>
              this.compareTargetCore(mapping, target, undefined, cancellationToken));
          }
          if (cancellationToken?.isCancellationRequested) return;
          await this.reconcileWatchRuntimeCore(mapping, target, session, runtime, this.watchRefreshGeneration, cancellationToken);
        });
      } catch (error) {
        await this.failInitialPreparation(mapping, target, session, error);
      } finally {
        reconciledTargets += 1;
        this.backgroundActivityEmitter.fire({
          active: true, kind: 'refresh', label: 'Reconciling connected targets...', mappingId: mapping.id,
          detail: `${reconciledTargets}/${current.length} target(s) processed`, cancellable: true
        });
        // Late completion from an old session must not alter a new Connect.
        if (this.sessions.getSession(sessionKey) === session && !this.disconnectRequested.has(sessionKey)) {
          if (cancellationToken?.isCancellationRequested) {
            this.runtimeByTarget.delete(key);
            this.suspendedTargets.add(key);
          }
          this.preparingTargets.delete(key);
        }
        this.refreshWatchers();
        this.viewStateChangedEmitter.fire();
      }
    });
    // A target whose housekeeping failed was already marked failed; targets
    // whose Refresh failed must also lose their half-prepared private session.
    for (const { target, session } of connections) {
      const key = this.runtimeKey(mapping.id, target.id);
      if (this.sessions.getSession(this.sessionKey(mapping.id, target.id)) !== session) continue;
      if (!this.preparingTargets.has(key)) continue;
      if (!refreshed.has(target.id)) {
        await this.failInitialPreparation(mapping, target, session, new Error('Initial Refresh failed. See Activity for details.'));
      }
      this.preparingTargets.delete(key);
    }
    this.refreshWatchers();
  }

  /** Cancel initial background preparation without disconnecting established sessions.
   * A manual Disconnect owns socket interruption separately, so Cancel remains a
   * soft cancellation and never turns a connected target into Disconnected. */
  cancelInitialRefresh(mappingId: string): void {
    const sources = this.initialRefreshTokens.get(mappingId);
    if (!sources?.size) return;
    for (const source of sources) source.cancel();
    this.backgroundActivityEmitter.fire({
      active: true, kind: 'refresh', label: 'Cancelling initial Refresh...', mappingId,
      detail: 'Waiting for active reads or reconciliation steps to stop safely.', cancellable: false
    });
    this.viewStateChangedEmitter.fire();
  }

  private async failInitialPreparation(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    error: unknown
  ): Promise<void> {
    const sessionKey = this.sessionKey(mapping.id, target.id);
    if (this.sessions.getSession(sessionKey) !== session || this.disconnectRequested.has(sessionKey)) return;
    const key = this.runtimeKey(mapping.id, target.id);
    this.runtimeByTarget.delete(key);
    this.preparingTargets.delete(key);
    await this.sessions.failConnectedSession(sessionKey, session, error);
    this.ui.log(`Initial Refresh failed: ${error instanceof Error ? error.message : String(error)}`, 'error', `${mapping.name} / ${target.name}`);
  }

  async disconnect(mappingId: string, targetId: string): Promise<void> {
    const disconnectTimer = this.diagnostics.timer();
    this.diagnostics.debug('Controller', 'Disconnect started.', { MappingId: mappingId, TargetId: targetId });
    const sessionKey = this.sessionKey(mappingId, targetId);
    // Record the user's intent before waiting for the target queue. Automatic
    // work already waiting behind another target/root operation must not run
    // merely because the physical session has not closed yet.
    this.disconnectRequested.add(sessionKey);
    const key = this.runtimeKey(mappingId, targetId);
    this.operations.cancelPending(key);
    this.sessions.cancelPendingConnection(sessionKey);
    // A Disconnect is stronger than Cancel: interrupt pending reads for this
    // target so the socket can close promptly, without cancelling unrelated targets.
    // Read-only metadata requests can hang waiting for a network response. Ask
    // the protocol adapter to interrupt reads, never in-flight writes.
    this.sessions.interruptPendingReads(sessionKey);
    this.preparingTargets.delete(this.runtimeKey(mappingId, targetId));
    this.suspendedTargets.delete(this.runtimeKey(mappingId, targetId));
    // Stop Local Watch / Upload on Save / Remote Watch immediately, even if
    // the physical disconnect must wait behind already queued target work.
    this.refreshWatchers();
    try {
      // Let an active mutation finish, but never put shutdown behind a stuck
      // transfer, NOOP, reconnect or cross-target lock indefinitely.
      if (!await settlesWithin(this.operations.waitForIdle(key), 5000)) {
        this.log('WARN', `Workspace Sync Disconnect: pending work did not finish within 5 seconds; closing the private session (${mappingId} / ${targetId}).`);
      }
      await this.sessions.disconnect(sessionKey);
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
    const enabled = mapping.targets.filter(target => target.enabled);
    if (!enabled.length) throw new Error('This mapping has no enabled Workspace Sync targets.');
    if (cancellationToken?.isCancellationRequested) return;
    const profiles = new Map((await this.connectionManager.listProfiles()).map(profile => [profile.id, profile]));
    const connected: Array<{ target: WorkspaceSyncTarget; session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession }> = [];
    const failures: unknown[] = [];
    let completed = 0;
    // Physical connections are independent, even when targets share Local Root.
    // Do not make target N wait for another target's Compare or Watch transfer.
    await runWithConcurrency(enabled, MAX_PARALLEL_TARGET_REFRESHES, async target => {
      if (cancellationToken?.isCancellationRequested) return;
      const sessionKey = this.sessionKey(mapping.id, target.id);
      try {
        const state = this.sessions.getState(sessionKey);
        const profile = profiles.get(target.connectionId);
        const changed = state.status === 'connected'
          && state.profileUpdatedAt !== undefined && profile !== undefined
          && profile.updatedAt !== state.profileUpdatedAt;
        if (state.status === 'connected' && !changed && this.sessions.getSession(sessionKey)) {
          this.disconnectRequested.delete(sessionKey);
        } else {
          const session = await this.openTargetConnection(mapping, target, changed, cancellationToken);
          if (session) connected.push({ target, session });
        }
      } catch (error) {
        failures.push(error);
      } finally {
        completed += 1;
        progress?.({ completed, total: enabled.length, currentPath: target.name, phase: `Connection attempts ${completed} of ${enabled.length}.` });
      }
    });
    if (cancellationToken?.isCancellationRequested) return;
    this.refreshWatchers();
    // The foreground Connect finishes here. Subsequent Refresh and initial
    // reconciliation report via Activity; Mapping/Target remain navigable.
    this.startPostConnectInitialization(mapping, connected);
    if (failures.length) {
      const error = failures[0];
      throw new Error(`Could not connect ${failures.length} of ${enabled.length} enabled target(s). ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnectEnabledTargets(
    mappingId: string,
    progress?: (progress: WorkspaceSyncProgress) => void
  ): Promise<void> {
    const mapping = this.requireMapping(mappingId);
    const enabled = mapping.targets.filter(target => target.enabled);
    if (!enabled.length) throw new Error('This mapping has no enabled Workspace Sync targets.');

    // All enabled targets are being disconnected, so cancel the shared initial
    // preparation token as well. Individual disconnects still interrupt only
    // their own pending reads.
    this.cancelInitialRefresh(mappingId);
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
    if (cancellationToken?.isCancellationRequested) return;
    const session = await this.openTargetConnection(mapping, target, true, cancellationToken);
    if (session && !cancellationToken?.isCancellationRequested) {
      this.startPostConnectInitialization(mapping, [{ target, session }], progress);
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

  /** Reset only the enabled targets of the requested mapping. Do not reset any
   * baseline unless every member of the selection is already connected. Each
   * clear is serialized with work on its target and overlapping Local Roots;
   * subsequent comparisons share one Local scan and run remote scans in parallel.
   */
  async resetBaselineEnabledTargets(
    mappingId: string,
    progress?: (progress: WorkspaceSyncProgress) => void,
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<void> {
    const mapping = this.requireMapping(mappingId);
    const enabled = mapping.targets.filter(target => target.enabled);
    if (!enabled.length) throw new Error('This mapping has no enabled Workspace Sync targets.');
    for (const target of enabled) {
      if (this.sessions.getState(this.sessionKey(mapping.id, target.id)).status !== 'connected'
        || !this.sessions.getSession(this.sessionKey(mapping.id, target.id))) {
        throw new Error(`Connect all enabled targets before resetting their baselines (${target.name} is not connected).`);
      }
      if (this.preparingTargets.has(this.runtimeKey(mapping.id, target.id))) {
        throw new Error(`Wait until ${target.name} finishes its initial Refresh before resetting baselines.`);
      }
    }

    // Suppress automatic Watch activity while the manual maintenance operation
    // clears historical state and refreshes. No local/remote file is modified.
    for (const target of enabled) this.preparingTargets.add(this.runtimeKey(mapping.id, target.id));
    this.refreshWatchers();
    this.viewStateChangedEmitter.fire();
    try {
      let completed = 0;
      const resetFailures: Array<{ target: WorkspaceSyncTarget; error: unknown }> = [];
      // Keep the existing lock order: target queue -> Local Root coordinator.
      // Acquiring a Local Root lock before a target queue could deadlock a
      // running Watch transfer that holds its target queue already.
      await runWithConcurrency(enabled, MAX_PARALLEL_TARGET_REFRESHES, async target => {
        if (cancellationToken?.isCancellationRequested) return;
        const key = this.runtimeKey(mapping.id, target.id);
        try {
          await this.operations.run(key, () => this.localRootOperations.run(mapping.localRoot, async () => {
            if (cancellationToken?.isCancellationRequested) return;
            if (this.sessions.getState(this.sessionKey(mapping.id, target.id)).status !== 'connected') {
              throw new Error(`Target '${target.name}' was disconnected before its baseline could be reset.`);
            }
            await this.baselines.clear(mapping.id, target.id);
            await this.lastViews.clear(mapping.id, target.id);
            this.runtimeByTarget.delete(key);
            this.remoteWatchSnapshots.delete(key);
            this.strongVerificationPaths.delete(key);
            this.ui.log('Baseline reset. Local and Remote files were not modified.', 'info', `${mapping.name} / ${target.name}`);
            completed += 1;
            progress?.({ completed, total: enabled.length, currentPath: target.name, phase: 'Resetting baselines...' });
            this.viewStateChangedEmitter.fire();
          }));
        } catch (error) {
          // Wait for every in-flight target to settle before re-enabling Watch.
          // Promise.all rejects on the first failure and would otherwise release
          // preparation guards while another reset still holds a target lock.
          resetFailures.push({ target, error });
        }
      });
      if (resetFailures.length) {
        const failure = resetFailures[0];
        throw new Error(`Reset Baseline failed for ${failure.target.name}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)} (${completed}/${enabled.length} target(s) reset).`);
      }
      if (cancellationToken?.isCancellationRequested) return;
      await this.refreshTargetsInParallel(mapping, enabled, progress, cancellationToken, false);
    } finally {
      for (const target of enabled) this.preparingTargets.delete(this.runtimeKey(mapping.id, target.id));
      this.refreshWatchers();
      this.viewStateChangedEmitter.fire();
    }
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
    const runtimeKey = this.runtimeKey(mapping.id, target.id);
    const preparationWasCancelled = this.suspendedTargets.has(runtimeKey);
    const session = preparationWasCancelled
      ? this.sessions.getSession(this.sessionKey(mapping.id, target.id))
      : this.requireSession(mapping.id, target.id);
    if (!session) throw new Error('Connect Workspace Sync before running this operation.');
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
    const runtime: MappingRuntimeState = {
      local, remote, diffs, plan, lastComparedAt: Date.now(), localMutationEpoch: this.localMutationEpoch
    };
    // A stale scan must never publish a Sync plan after Disconnect/Cancel or
    // replace the state of a newer private session (Reconnect racing Refresh).
    if (cancellationToken?.isCancellationRequested
      || this.disconnectRequested.has(this.sessionKey(mapping.id, target.id))
      || this.sessions.getSession(this.sessionKey(mapping.id, target.id)) !== session) {
      throw new Error('Workspace Sync Refresh cancelled or target disconnected.');
    }
    this.runtimeByTarget.set(this.runtimeKey(mapping.id, target.id), runtime);
    // A successful manual/maintenance Refresh makes a previously cancelled
    // preparation eligible for Watch again without requiring Reconnect.
    if (preparationWasCancelled) {
      this.suspendedTargets.delete(runtimeKey);
      this.refreshWatchers();
    }
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

  /**
   * Refresh only the affected subtrees and merge them into the last complete
   * target runtime. This is used by deferred directory-delete recovery: a
   * single .dotnet retry must not rescan an entire large target.
   */
  private async compareTargetScopesCore(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    scopes: string[],
    cancellationToken?: { readonly isCancellationRequested: boolean }
  ): Promise<MappingRuntimeState> {
    const normalizedScopes = normalizeReconcileScopes(scopes);
    if (!normalizedScopes.length) return this.compareTargetCore(mapping, target, undefined, cancellationToken);

    const key = this.runtimeKey(mapping.id, target.id);
    const current = this.runtimeByTarget.get(key);
    if (!current?.local || !current.remote) {
      return this.compareTargetCore(mapping, target, undefined, cancellationToken);
    }

    const runtimeKey = this.runtimeKey(mapping.id, target.id);
    const preparationWasCancelled = this.suspendedTargets.has(runtimeKey);
    const session = preparationWasCancelled
      ? this.sessions.getSession(this.sessionKey(mapping.id, target.id))
      : this.requireSession(mapping.id, target.id);
    if (!session) throw new Error('Connect Workspace Sync before running this operation.');
    await this.ensureBaselineContext(mapping, target, session);
    const baseline = await this.baselines.get(mapping.id, target.id);
    const ignorePatterns = await loadEffectiveIgnorePatterns(mapping);
    this.ui.log(
      `Re-evaluating affected subtree${normalizedScopes.length > 1 ? 's' : ''}: ${normalizedScopes.slice(0, 3).join(', ')}${normalizedScopes.length > 3 ? '…' : ''}`,
      'info',
      `${mapping.name} / ${target.name}`
    );

    const localParts: SyncSnapshot[] = [];
    const remoteParts: SyncSnapshot[] = [];
    await runWithConcurrency(normalizedScopes, Math.min(MAX_PARALLEL_TARGET_REFRESHES, normalizedScopes.length), async scope => {
      if (cancellationToken?.isCancellationRequested) throw new Error('Workspace Sync Refresh cancelled.');
      const localPhysical = current.local?.entries[scope]?.physicalRelativePath
        || baseline?.entries[scope]?.localRelativePath
        || scope;
      const remotePhysical = current.remote?.entries[scope]?.physicalRelativePath
        || baseline?.entries[scope]?.remoteRelativePath
        || scope;
      const [localPart, remotePart] = await Promise.all([
        scanLocalSubtree(mapping.localRoot, scope, localPhysical, { ignorePatterns, cancellationToken }),
        scanRemoteSubtree(session, target.remoteRoot, scope, remotePhysical, {
          ignorePatterns,
          concurrency: session.capabilities.maxConcurrentMetadata,
          cancellationToken
        })
      ]);
      localParts.push(localPart);
      remoteParts.push(remotePart);
    });

    const scopedLocal = combineSnapshots(localParts);
    const scopedRemote = combineSnapshots(remoteParts);
    const scopedBaseline = filterBaselineToScopes(baseline, normalizedScopes);
    const verified = await verifyComparisonContent(
      mapping.localRoot,
      target.remoteRoot,
      session,
      scopedLocal,
      scopedRemote,
      scopedBaseline,
      {
        concurrency: Math.min(4, session.capabilities.maxConcurrentTransfers),
        cancellationToken,
        forceHashPaths: [...(this.strongVerificationPaths.get(key) || [])].filter(candidate => pathInScopes(candidate, normalizedScopes))
      }
    );

    const local = replaceSnapshotScopes(current.local, verified.local, normalizedScopes);
    const remote = replaceSnapshotScopes(current.remote, verified.remote, normalizedScopes);
    const scopedMetadataDiffs = diffSnapshots(verified.local, verified.remote, scopedBaseline, {
      mtimeToleranceMs: 2000,
      remoteMtimeReliable: session.capabilities.reliableMtime
    });
    const localCaseSensitive = await this.getLocalCaseSensitivity(mapping.localRoot);
    const scopedDiffs = protectCaseCollisions(scopedMetadataDiffs, verified.local, verified.remote, {
      direction: mapping.options.direction,
      localCaseSensitive,
      remoteCaseSensitive: session.capabilities.caseSensitive
    });
    await this.trustEqualEntries(mapping.id, target.id, scopedDiffs);
    this.clearStrongVerificationForProvenSame(mapping.id, target.id, scopedDiffs);

    const diffs = [
      ...current.diffs.filter(diff => !pathInScopes(diff.relativePath, normalizedScopes)),
      ...scopedDiffs
    ].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const plan = buildSyncPlan(mapping.id, target.id, diffs, {
      direction: mapping.options.direction,
      propagateDeletes: mapping.options.propagateDeletes,
      conflictProtection: mapping.options.conflictProtection,
      localFilenameStyle: localFilenameStyle(),
      remoteFilenameStyle: session.capabilities.filenameStyle
    });
    const runtime: MappingRuntimeState = {
      local,
      remote,
      diffs,
      plan,
      lastComparedAt: Date.now(),
      localMutationEpoch: this.localMutationEpoch
    };

    if (cancellationToken?.isCancellationRequested
      || this.disconnectRequested.has(this.sessionKey(mapping.id, target.id))
      || this.sessions.getSession(this.sessionKey(mapping.id, target.id)) !== session) {
      throw new Error('Workspace Sync subtree Refresh cancelled or target disconnected.');
    }
    this.runtimeByTarget.set(key, runtime);
    if (runtime.lastComparedAt) await this.lastViews.set(mapping, target, runtime.diffs, runtime.lastComparedAt);
    this.viewStateChangedEmitter.fire();
    this.ui.log('Affected subtree re-evaluation completed.', 'success', `${mapping.name} / ${target.name}`);
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

    if (this.watchingTargets.has(key)) {
      throw new Error(`Wait for Watch reconciliation on '${target.name}' before starting Sync.`);
    }

    return this.operations.run(key, async () => {
      if (this.preparingTargets.has(key) || this.initializingMappings.has(mapping.id) || this.watchingTargets.has(key)) {
        throw new Error('Wait for the initial Refresh and Watch reconciliation before starting Sync.');
      }
      const session = this.requireSession(mapping.id, target.id);
      const runtime = this.runtimeByTarget.get(key);
      if (!runtime?.plan || !runtime.local || !runtime.remote) throw new Error('Refresh the target before starting Sync.');
      const unresolved = runtime.diffs.filter(diff =>
        (diff.status === 'conflict' || diff.status === 'different') && !diff.resolution
      );
      if (unresolved.length) throw new Error('Select Use Local, Use Remote, or Skip for every Different or Conflict path before starting Sync.');
      if (runtime.plan.conflicts.length) throw new Error('Resolve or skip conflicts before starting Sync.');
      if (runtime.plan.errors.length) throw new Error('Sync cannot start while the compare result contains unknown or incomplete paths.');

      return this.runWithPlanLocalRootProtection(mapping, target, runtime.plan, session, async () => {
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
        if (!result.cancelled && !result.failed.length && !result.deferred.length) {
          await this.reflectSuccessfulManualOperationsInView(mapping, target, session, observations, runtime);
        } else {
          this.runtimeByTarget.delete(key);
          if (!result.cancelled) {
            this.ui.log('Running a full Refresh because the Sync did not complete cleanly.', 'info', `${mapping.name} / ${target.name}`);
            await this.compareTargetCore(mapping, target, progress, cancellationToken);
          }
        }
        this.log(result.failed.length || result.deferred.length ? 'WARN' : 'INFO', `Workspace Sync execution completed: ${mapping.name} / ${target.name} (${result.completed.length} completed, ${result.failed.length} failed${result.deferred.length ? `, ${result.deferred.length} deferred` : ''}${result.cancelled ? ', cancelled' : ''}).`);
        return { failed: result.failed.length, stale: result.deferred.length, cancelled: result.cancelled };
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
      if (this.preparingTargets.has(this.runtimeKey(mapping.id, target.id)) || this.initializingMappings.has(mapping.id)
        || this.watchingTargets.has(this.runtimeKey(mapping.id, target.id))) {
        throw new Error(`Wait for the initial Refresh before syncing '${target.name}'.`);
      }
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
    if (this.watchingTargets.has(key)) {
      throw new Error(`Wait for Watch reconciliation on '${target.name}' before transferring files.`);
    }

    return this.operations.run(key, async () => {
      if (this.preparingTargets.has(key) || this.initializingMappings.has(mapping.id) || this.watchingTargets.has(key)) {
        throw new Error('Wait for the initial Refresh and Watch reconciliation before transferring selected files.');
      }
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
      return this.runWithPlanLocalRootProtection(mapping, target, plan, session, async () => {
        const revalidated = await this.revalidatePlan(mapping, target, plan, session, cancellationToken);
        if (revalidated.stale.length) return { failed: 0, stale: revalidated.stale.length, cancelled: false };
        const result = await this.executePlan(mapping, target, plan, session, {
          atomicTransfer: mapping.options.atomicTransfer,
          onProgress: progress,
          cancellationToken,
          journal: this.journal
        });
        const observations = await this.updateBaselineForOperations(mapping, target, session, result.completed);
        if (!result.cancelled && !result.failed.length && !result.deferred.length) {
          await this.reflectSuccessfulManualOperationsInView(mapping, target, session, observations, runtime);
        } else {
          this.runtimeByTarget.delete(key);
          if (!result.cancelled) {
            this.ui.log('Running a full Refresh because the transfer did not complete cleanly.', 'info', `${mapping.name} / ${target.name}`);
            await this.compareTargetCore(mapping, target, progress, cancellationToken);
          }
        }
        return { failed: result.failed.length, stale: result.deferred.length, cancelled: result.cancelled };
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
    for (const selection of normalized) {
      const key = this.runtimeKey(mapping.id, selection.target.id);
      if (this.preparingTargets.has(key) || this.initializingMappings.has(mapping.id) || this.watchingTargets.has(key)) {
        throw new Error(`Wait for Refresh or Watch reconciliation on '${selection.target.name}' before transferring files.`);
      }
      this.requireSession(mapping.id, selection.target.id);
    }

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
    target: WorkspaceSyncTarget,
    plan: SyncPlan,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    task: () => Promise<T>
  ): Promise<T> {
    const accesses = planLocalPathAccesses(mapping, target, plan);
    // Lock order for every transfer path: target queue -> remote endpoint ->
    // Local paths. This prevents circular waits between the Watchers and Sync.
    return this.remoteEndpointOperations.run(remoteEndpointLockRoot(session), () =>
      this.localRootOperations.runPaths(mapping.localRoot, accesses, task));
  }

  private runWithAutomaticPathProtection<T>(
    mapping: WorkspaceSyncMapping,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    accesses: LocalPathAccess[],
    task: () => Promise<T>
  ): Promise<T> {
    return this.remoteEndpointOperations.run(remoteEndpointLockRoot(session), () =>
      this.localRootOperations.runPaths(mapping.localRoot, accesses, task));
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

      const preview = this.buildRuntimePlanWithResolutions(mapping, target, session, runtime, resolutions);
      runtime.diffs = preview.diffs;
      runtime.plan = preview.plan;
      this.runtimeByTarget.set(this.runtimeKey(mapping.id, target.id), runtime);
      if (notifyViewState) this.viewStateChangedEmitter.fire();
    });
  }

  async previewPlanWithResolutions(
    mappingId: string,
    targetId: string,
    resolutions: Record<string, WorkspaceSyncConflictResolution | undefined>
  ): Promise<SyncPlan> {
    const mapping = this.requireMapping(mappingId);
    const target = this.requireEnabledTarget(mapping, targetId);
    const session = this.requireSession(mapping.id, target.id);
    const runtime = this.runtimeByTarget.get(this.runtimeKey(mapping.id, target.id));
    if (!runtime?.plan) throw new Error('Refresh the target before reviewing its Sync plan.');
    return this.buildRuntimePlanWithResolutions(mapping, target, session, runtime, resolutions).plan;
  }

  private buildRuntimePlanWithResolutions(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    runtime: MappingRuntimeState,
    resolutions: Record<string, WorkspaceSyncConflictResolution | undefined>
  ): { diffs: DiffEntry[]; plan: SyncPlan } {
    const requested = Object.entries(resolutions);
    for (const [relativePath, resolution] of requested) {
      if (resolution !== undefined && resolution !== 'useLocal' && resolution !== 'useRemote' && resolution !== 'skip') {
        throw new Error('Invalid Workspace Sync conflict resolution.');
      }
      const diff = runtime.diffs.find(item => item.relativePath === relativePath);
      const planConflict = runtime.plan?.conflicts.some(item => item.relativePath === relativePath);
      if (!diff || ((diff.status !== 'conflict' && diff.status !== 'different') && !planConflict)) {
        throw new Error(`'${relativePath}' no longer requires a Workspace Sync resolution. Run Refresh again.`);
      }
      if (resolution !== undefined && resolution !== 'skip') validateConflictResolutionChoice(diff, resolution);
    }

    const resolutionByPath = new Map(requested);
    const diffs = runtime.diffs.map(diff => {
      if (!resolutionByPath.has(diff.relativePath)) return { ...diff };
      const resolution = resolutionByPath.get(diff.relativePath);
      if (resolution) return { ...diff, resolution };
      const reset: DiffEntry = { ...diff };
      delete reset.resolution;
      return reset;
    });
    const plan = buildSyncPlan(mapping.id, target.id, diffs, {
      direction: mapping.options.direction,
      propagateDeletes: mapping.options.propagateDeletes,
      conflictProtection: mapping.options.conflictProtection,
      localFilenameStyle: localFilenameStyle(),
      remoteFilenameStyle: session.capabilities.filenameStyle
    });
    return { diffs, plan };
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
          } catch {
            // Put the guidance in the thrown message itself so the panel's
            // normal error path always records it in Activity. A separate info
            // log could be lost visually behind the subsequent error entry.
            throw new Error('This file is binary or is not UTF-8 text. Internal Compare is unavailable. Try Open in VS Code Compare; VS Code can handle additional binary file types.');
          }
          if (texts.some(text => text.split('\n').length > 20000)) throw new Error('The comparison viewer supports up to 20,000 lines per side.');
          this.ui.log(`Opened comparison: ${relativePath}`, 'info', target.name);
          return { relativePath, targetName: target.name, lines: compareText(texts[0], texts[1]), identical: buffers[0].equals(buffers[1]) };
        } finally { await fs.rm(remoteCopy, { force: true }); }
      })
    );
  }
  async openDiffInVsCode(mappingId: string, targetId: string, relativePath: string): Promise<void> {
    const mapping = this.requireMapping(mappingId);
    const target = this.requireEnabledTarget(mapping, targetId);
    await this.operations.run(this.runtimeKey(mapping.id, target.id), () =>
      this.localRootOperations.run(mapping.localRoot, async () => {
        const session = this.requireSession(mapping.id, target.id);
        const diff = this.runtimeByTarget.get(this.runtimeKey(mapping.id, target.id))?.diffs.find(item => item.relativePath === relativePath);
        if (diff?.local?.kind !== 'file' || diff.remote?.kind !== 'file') {
          throw new Error('Diff is available only when the file exists on both Local and Remote.');
        }
        const { localPath, remotePath, localRelativePath, remoteRelativePath } = resolveSyncPaths(mapping, target, relativePath, diff);
        await Promise.all([
          assertLocalPathAncestorsSafe(mapping.localRoot, localRelativePath),
          assertRemotePathAncestorsSafe(session, target.remoteRoot, remoteRelativePath)
        ]);
        await assertLocalRegularFile(localPath, relativePath);
        const remoteCopy = await this.diffTempStore.allocate(relativePath);
        await session.download(remotePath, remoteCopy);
        await vscode.commands.executeCommand(
          'vscode.diff',
          vscode.Uri.file(localPath),
          vscode.Uri.file(remoteCopy),
          `Workspace Sync: ${relativePath} (Local ↔ ${target.name})`
        );
        // Keep the downloaded side alive while VS Code owns the diff editor.
        // DiffTempStore prunes old copies on future comparisons.
        this.ui.log(`Opened VS Code comparison: ${relativePath}`, 'info', target.name);
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
    continueOnError = false,
    onTargetState?: (target: WorkspaceSyncTarget, state: 'started' | 'completed' | 'failed') => void
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
      onTargetState?.(target, 'started');
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
        onTargetState?.(target, 'completed');
        progress?.({
          completed: completedTargets,
          total: targets.length,
          phase: `Refreshed ${completedTargets} of ${targets.length} target(s).`
        });
      } catch (error) {
        failures.push({ target, error });
        onTargetState?.(target, 'failed');
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

  private refreshWatchers(): void {
    if (this.disposed) return;
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
      Targets: targetCount
    });
    const activeWatchKeys = new Set(mappings.flatMap(mapping => mapping.targets
      .filter(_target => mapping.options.watchRemoteChanges && mapping.options.direction !== 'localToRemote')
      .map(target => this.runtimeKey(mapping.id, target.id))));
    for (const key of this.remoteWatchSnapshots.keys()) {
      if (!activeWatchKeys.has(key)) this.remoteWatchSnapshots.delete(key);
    }
    this.localWatchRetries.retain(retry => this.isLocalWatchRetryCurrent(retry));
    this.watcher.refresh(mappings);
    this.remoteWatcher.refresh(mappings);
  }

  private async reconcileWatchRuntimeCore(
    mapping: WorkspaceSyncMapping,
    target: WorkspaceSyncTarget,
    session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession,
    runtime: MappingRuntimeState,
    generation: number,
    cancellationToken?: { readonly isCancellationRequested: boolean },
    internalReplanAttempts = 0,
    reconcileScopes?: string[],
    deferredReplanAttempts: Record<string, number> = {}
  ): Promise<boolean> {
    if (generation !== this.watchRefreshGeneration || cancellationToken?.isCancellationRequested) return false;
    if (!mapping.options.watchLocalChanges && !mapping.options.watchRemoteChanges) return false;

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
    const normalizedScopes = reconcileScopes?.length
      ? [...new Set(reconcileScopes.map(scope => scope.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')))]
        .filter(Boolean)
        .sort((left, right) => left.length - right.length || left.localeCompare(right))
        .filter((scope, index, all) => !all.slice(0, index).some(parent => scope === parent || scope.startsWith(`${parent}/`)))
      : undefined;

    for (const diff of runtime.diffs) {
      if (cancellationToken?.isCancellationRequested) return false;
      if (normalizedScopes && !normalizedScopes.some(scope => diff.relativePath === scope || diff.relativePath.startsWith(`${scope}/`))) continue;
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
      let replanAfterInternalMutation = false;
      let deferredReplanScopes: string[] = [];
      await this.runWithPlanLocalRootProtection(mapping, target, plan, session, async () => {
      // Validation belongs INSIDE the path/endpoint locks. If another target
      // completed a Local mutation while this target was waiting for those
      // locks, the old plan is known to be obsolete. Do not manufacture a
      // conflict from our own coordinated work: release the locks, Refresh,
      // and build a new plan from this target's own baseline instead.
      if (this.localRootChangedAfter(mapping.localRoot, runtime.localMutationEpoch || 0)) {
        replanAfterInternalMutation = true;
        return;
      }
      const revalidated = await this.revalidatePlan(mapping, target, plan, session, cancellationToken);
      if (cancellationToken?.isCancellationRequested) return;
      stale = revalidated.stale.length;
      for (const item of revalidated.stale) {
        await this.reportAutomaticConflict(mapping, target, item.operation.relativePath, `State changed after the initial Watch Refresh. ${item.reason}`);
      }

      if (revalidated.valid.length) {
        const validPlan = singleOperationPlan(mapping, target, revalidated.valid);
        const key = this.runtimeKey(mapping.id, target.id);
        const pendingViewUpdates: SyncOperation[] = [];
        let flushTimer: ReturnType<typeof setTimeout> | undefined;
        // A completed transfer has already passed executor validation. Publish
        // these successful paths to Changes in short batches without waiting
        // for every transfer in the plan. Failed/stale paths remain unchanged.
        const publishCompleted = () => {
          flushTimer = undefined;
          if (!pendingViewUpdates.length) return;
          const current = this.runtimeByTarget.get(key);
          if (!current || this.sessions.getSession(this.sessionKey(mapping.id, target.id)) !== session) {
            pendingViewUpdates.length = 0;
            return;
          }
          const operationsToPublish = pendingViewUpdates.splice(0);
          this.runtimeByTarget.set(key, this.applyCompletedOperationsToRuntime(
            mapping, target, session, current, operationsToPublish
          ));
          this.scheduleAutomaticViewStateChanged(mapping.id);
        };
        let result: Awaited<ReturnType<typeof executeSyncPlan>>;
        try {
          result = await this.executePlan(mapping, target, validPlan, session, {
            atomicTransfer: mapping.options.atomicTransfer,
            journal: this.journal,
            watchActivity: true,
            cancellationToken,
            onActivity: event => {
              if (event.kind === 'completed') {
                pendingViewUpdates.push(event.operation);
                if (!flushTimer) flushTimer = setTimeout(publishCompleted, 80);
                // Record changes for other mappings as each Local mutation
                // finishes. Shared-root readers cannot inspect an in-flight
                // write because the path lock conflicts with whole-tree scans.
                this.scheduleSharedLocalReclassification(mapping, target, [event.operation]);
              }
            }
          });
        } finally {
          if (flushTimer) clearTimeout(flushTimer);
          publishCompleted();
        }
        const observations = await this.updateBaselineForOperations(mapping, target, session, result.completed);
        // Verify the final state against actual post-transfer fingerprints, not
        // only the expected source metadata used for the live UI update.
        if (observations.length) {
          await this.refreshAutomaticPathsInView(mapping, target, session, observations,
            undefined, true);
        }
        if (result.deferred.length) {
          // ENOTEMPTY on an empty-directory delete means the directory changed
          // after validation. Keep the new contents intact and re-evaluate the
          // affected subtree automatically after releasing the path locks. A
          // deferred delete is therefore TRANSIENT, not a terminal Watch state.
          deferredReplanScopes = [...new Set(result.deferred.map(item => item.operation.relativePath))]
            .sort((left, right) => left.length - right.length || left.localeCompare(right))
            .filter((scope, index, all) => !all.slice(0, index).some(parent => scope === parent || scope.startsWith(`${parent}/`)));
          await this.refreshAutomaticPathsInView(
            mapping,
            target,
            session,
            deferredReplanScopes.map(relativePath => ({ relativePath })),
            undefined,
            true
          ).catch(() => undefined);
        }
        completed = result.completed;
        failed = result.failed.length;
      }
      });

      if (replanAfterInternalMutation) {
        if (internalReplanAttempts >= 3) {
          this.log('WARN', `Watch reconciliation could not stabilize after coordinated Local changes: ${mapping.name} / ${target.name}. A fresh Refresh is required.`);
          return false;
        }
        this.ui.log('Watch reconciliation replanning after another connected target changed the shared Local directory.', 'info', `${mapping.name} / ${target.name}`);
        const refreshedRuntime = await this.localRootOperations.runShared(mapping.localRoot, () =>
          this.compareTargetCore(mapping, target, undefined, cancellationToken));
        return this.reconcileWatchRuntimeCore(
          mapping, target, session, refreshedRuntime, generation, cancellationToken, internalReplanAttempts + 1, normalizedScopes, deferredReplanAttempts
        );
      }

      if (deferredReplanScopes.length) {
        const nextAttempts = { ...deferredReplanAttempts };
        const retryScopes: string[] = [];
        const exhaustedScopes: string[] = [];
        for (const scope of deferredReplanScopes) {
          const attempts = (nextAttempts[scope] || 0) + 1;
          nextAttempts[scope] = attempts;
          if (attempts <= MAX_DEFERRED_DELETE_REEVALUATIONS) retryScopes.push(scope);
          else exhaustedScopes.push(scope);
        }

        if (exhaustedScopes.length) {
          stale += exhaustedScopes.length;
          const listed = exhaustedScopes.slice(0, 3).join(', ');
          this.ui.log(
            `Delete remained unstable after ${MAX_DEFERRED_DELETE_REEVALUATIONS} automatic re-evaluation(s): ${listed}${exhaustedScopes.length > 3 ? '…' : ''}. The path remains in Changes.`,
            'warning',
            `${mapping.name} / ${target.name}`
          );
          this.log('WARN', `Watch delete remained unstable after automatic re-evaluation: ${mapping.name} / ${target.name} / ${listed}.`);
        }

        if (retryScopes.length && !cancellationToken?.isCancellationRequested) {
          const attempt = Math.max(...retryScopes.map(scope => nextAttempts[scope] || 1));
          this.ui.log(
            `Re-evaluating deferred Watch delete${retryScopes.length > 1 ? 's' : ''} (${attempt}/${MAX_DEFERRED_DELETE_REEVALUATIONS})…`,
            'info',
            `${mapping.name} / ${target.name}`
          );
          const refreshedRuntime = await this.localRootOperations.runShared(mapping.localRoot, () =>
            this.compareTargetScopesCore(mapping, target, retryScopes, cancellationToken));
          const changedAfterRetry = await this.reconcileWatchRuntimeCore(
            mapping, target, session, refreshedRuntime, generation, cancellationToken,
            internalReplanAttempts, retryScopes, nextAttempts
          );
          const changedThisAttempt = completed.some(operation => ['download', 'deleteLocal', 'createLocalDirectory'].includes(operation.type));
          return changedThisAttempt || changedAfterRetry;
        }
      }
    }

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
    return completed.some(operation => ['download', 'deleteLocal', 'createLocalDirectory'].includes(operation.type));
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
      const shouldNotify = this.automaticViewDirtyMappings.size > 0;
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
      const classified = await readAndClassifyCurrentPath(session, {
        relativePath,
        localPath: resolved.localPath,
        remotePath: resolved.remotePath,
        baseline,
        baselineCapturedAt: baselineState?.capturedAt,
        localRelativePath,
        remoteRelativePath,
        localKnown: observation.localKnown,
        local: observation.local,
        remoteKnown: observation.remoteKnown,
        remote: observation.remote,
        mtimeToleranceMs: 2000
      });
      const { local, remote } = classified;

      if (!local && !remote && !baseline) {
        byPath.delete(relativePath);
        continue;
      }

      let diff = classified.diff;
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
      const isCurrent = (): boolean => {
        const latest = this.mappings.get(mappingId);
        const latestTarget = latest?.targets.find(item => item.id === targetId);
        return latest?.updatedAt === currentMapping.updatedAt
          && latestTarget?.updatedAt === currentTarget.updatedAt
          && Boolean(latest.options.watchRemoteChanges)
          && this.getConnectedAutomaticSession(mappingId, targetId) === session;
      };

      const contextChanged = await this.ensureBaselineContext(currentMapping, currentTarget, session);
      const ignorePatterns = await loadEffectiveIgnorePatterns(currentMapping);
      const snapshot = await scanRemoteTree(session, currentTarget.remoteRoot, {
        ignorePatterns,
        concurrency: session.capabilities.maxConcurrentMetadata
      });
      if (snapshot.incompletePaths.length) {
        throw new Error(`Remote Watch scan was incomplete at ${snapshot.incompletePaths.slice(0, 3).join(', ')}${snapshot.incompletePaths.length > 3 ? '…' : ''}.`);
      }

      if (!isCurrent()) return;
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
      // The first poll must compare with trusted history, not accept the
      // current Remote contents as its starting state. An edit can occur after
      // initial Compare/reconciliation and before this first timer fires.
      const priorBaseline = await this.baselines.get(currentMapping.id, currentTarget.id);
      const previousSnapshot: SyncSnapshot = reset ? {
        capturedAt: priorBaseline?.capturedAt || snapshot.capturedAt,
        incompletePaths: [],
        entries: Object.fromEntries(Object.entries(priorBaseline?.entries || {})
          .filter(([, entry]) => entry.remote)
          .map(([relativePath, entry]) => [relativePath, {
            relativePath, physicalRelativePath: entry.remoteRelativePath || relativePath,
            fingerprint: entry.remote!
          }]))
      } : previous.snapshot;
      const matcher = new IgnoreMatcher(ignorePatterns);
      const changedPaths = [...new Set([
        ...collectRemoteWatchChangedPaths(previousSnapshot, snapshot),
        ...(!reset ? previous.retryPaths || [] : [])
      ])].filter(relativePath => {
        // A newly ignored subtree is absent from a scan, not remotely deleted.
        // Match ancestors too, just as the recursive scanner prunes them.
        const segments = relativePath.split('/');
        const entry = snapshot.entries[relativePath] || previousSnapshot.entries[relativePath];
        return !segments.some((_segment, index) => matcher.ignores(
          segments.slice(0, index + 1).join('/'),
          index < segments.length - 1 || entry?.fingerprint.kind === 'directory'
        ));
      });
      if (!changedPaths.length) {
        this.remoteWatchSnapshots.set(key, currentState);
        this.diagnostics.debug('Remote Watch', 'Poll completed with no changes.', { Mapping: currentMapping.name, Target: currentTarget.name });
        return;
      }

      this.diagnostics.debug('Remote Watch', 'Remote changes detected.', { Mapping: currentMapping.name, Target: currentTarget.name, Changes: changedPaths.length });
      const affectedLocalPaths = changedPaths.flatMap(relativePath => {
        // A remote directory removal may delete an entire Local subtree.
        // Also protect the baseline's PHYSICAL Local spelling (which may differ
        // from a logical/case-normalized name). Parent/child overlap in runPaths
        // blocks every descendant transfer under either spelling.
        const spellings = new Set([relativePath, priorBaseline?.entries[relativePath]?.localRelativePath || relativePath]);
        return [...spellings].map(spelling => ({
          path: resolveSyncPaths(currentMapping, currentTarget, spelling).localPath,
          mode: 'write' as const
        }));
      });
      let watchResult: { deferredDeletes: string[]; relevantChanges: number; retryPaths: string[] } = { deferredDeletes: [], relevantChanges: 0, retryPaths: [] };
      await this.runWithAutomaticPathProtection(currentMapping, session, affectedLocalPaths, async () => {
        if (!isCurrent()) return;
        watchResult = await this.handleRemoteWatchChangesForTarget(currentMapping, currentTarget, session, snapshot, changedPaths);
      });
      if (watchResult.relevantChanges > 0) {
        this.ui.log(`Remote Watch detected ${watchResult.relevantChanges} remote change(s).`, 'info', `${currentMapping.name} / ${currentTarget.name}`);
      }
      const deferredWatchDeletes = watchResult.deferredDeletes;
      if (deferredWatchDeletes.length && isCurrent()) {
        this.ui.log(
          `Re-evaluating deferred Remote Watch delete${deferredWatchDeletes.length > 1 ? 's' : ''} (1/${MAX_DEFERRED_DELETE_REEVALUATIONS})…`,
          'info',
          `${currentMapping.name} / ${currentTarget.name}`
        );
        const refreshedRuntime = await this.localRootOperations.runShared(currentMapping.localRoot, () =>
          this.compareTargetScopesCore(currentMapping, currentTarget, deferredWatchDeletes));
        const attemptCounts = Object.fromEntries(deferredWatchDeletes.map(relativePath => [relativePath, 1]));
        await this.reconcileWatchRuntimeCore(
          currentMapping, currentTarget, session, refreshedRuntime, this.watchRefreshGeneration,
          undefined, 0, deferredWatchDeletes, attemptCounts
        );
      }
      if (isCurrent()) {
        this.remoteWatchSnapshots.set(key, { ...currentState, retryPaths: watchResult.retryPaths });
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
  ): Promise<{ deferredDeletes: string[]; relevantChanges: number; retryPaths: string[] }> {
    const sourceIsAuthoritative = isWatchSourceAuthoritative(mapping.options.direction, 'remote');
    const baselineState = await this.baselines.get(mapping.id, target.id);
    const operations: SyncOperation[] = [];
    const baselineUpdates: Record<string, import('./types').BaselineEntry | undefined> = {};
    let conflicts = 0;
    let relevantChanges = 0;

    for (const relativePath of changedPaths) {
      const baseline = baselineState?.entries[relativePath];
      const scannedRemoteEntry = remoteSnapshot.entries[relativePath];
      const scannedRemote = scannedRemoteEntry?.fingerprint;
      const localRelativePath = baseline?.localRelativePath || relativePath;
      const remoteRelativePath = scannedRemoteEntry?.physicalRelativePath || baseline?.remoteRelativePath || relativePath;
      const { localPath, remotePath } = resolveSyncPaths(mapping, target, relativePath, { localRelativePath, remoteRelativePath });

      if (scannedRemote?.kind === 'link' || scannedRemote?.kind === 'unknown') {
        await this.refreshAutomaticPathsInView(mapping, target, session, [{
          relativePath,
          observation: { remoteKnown: true, remote: scannedRemote, localRelativePath, remoteRelativePath }
        }]).catch(() => undefined);
        conflicts += 1;
        relevantChanges += 1;
        await this.reportAutomaticConflict(mapping, target, relativePath, `Remote Watch does not automatically transfer ${scannedRemote.kind} entries.`);
        continue;
      }

      const classified = await readAndClassifyCurrentPath(session, {
        relativePath,
        localPath,
        remotePath,
        baseline,
        baselineCapturedAt: baselineState?.capturedAt,
        localRelativePath,
        remoteRelativePath,
        remoteKnown: true,
        remote: scannedRemote,
        // Same Remote endpoint: cross-server clock tolerance must not hide a real edit.
        mtimeToleranceMs: 0
      });
      const { local, remote, diff } = classified;

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

      // A candidate can disappear after the Remote tree scan and before this
      // per-path revalidation. If neither side nor the trusted baseline contains
      // it anymore, the observation is stale and there is nothing to propagate.
      // Do not let this benign race abort the rest of the Remote Watch batch.
      if (!local && !remote && !baseline) continue;

      // The same classifier is used by Refresh, Local Watch and Remote Watch.
      // If the polling snapshot merely noticed a Workspace Sync write already
      // captured by the baseline, there is no new Remote change to propagate.
      if (diff.status === 'same') {
        baselineUpdates[relativePath] = local || remote
          ? { local, remote, localRelativePath: local ? localRelativePath : undefined, remoteRelativePath: remote ? remoteRelativePath : undefined }
          : undefined;
        continue;
      }

      if (diff.status === 'unknown') {
        conflicts += 1;
        relevantChanges += 1;
        await this.reportAutomaticConflict(mapping, target, relativePath, diff.reason || 'Remote Watch could not classify this path safely.');
        continue;
      }

      let planningDiff = diff;
      if (sourceIsAuthoritative && (diff.status === 'conflict' || diff.status === 'different')) {
        // In Remote -> Local mode the Remote side is explicitly authoritative
        // for automatic Watch actions, even if both sides changed.
        planningDiff = { ...diff, resolution: 'useRemote' };
      } else if (!sourceIsAuthoritative && diff.status === 'different' && !mapping.options.conflictProtection) {
        // With Unknown Change Protection disabled, the side that generated the
        // Watch event wins for an unbaselined Different path.
        planningDiff = { ...diff, resolution: 'useRemote' };
      }

      const scopedPlan = buildSyncPlan(mapping.id, target.id, [planningDiff], {
        direction: mapping.options.direction,
        propagateDeletes: mapping.options.propagateDeletes,
        conflictProtection: mapping.options.conflictProtection,
        localFilenameStyle: localFilenameStyle(),
        remoteFilenameStyle: session.capabilities.filenameStyle
      });

      if (scopedPlan.errors.length) {
        conflicts += 1;
        relevantChanges += 1;
        const problem = scopedPlan.errors[0];
        await this.reportAutomaticConflict(mapping, target, relativePath, problem.reason || 'Remote Watch cannot safely apply this path.');
        continue;
      }
      if (scopedPlan.conflicts.length) {
        conflicts += 1;
        relevantChanges += 1;
        const conflict = scopedPlan.conflicts[0];
        await this.reportAutomaticConflict(mapping, target, relativePath,
          conflict.reason || 'Local and Remote both changed since the last trusted sync state.');
        continue;
      }

      const operation = scopedPlan.operations.find(item => item.type !== 'skip');
      if (!operation) continue;

      // Remote Watch may only execute operations whose source is Remote. If the
      // shared classifier says the trusted change belongs to Local, leave it to
      // Local Watch. This prevents the two watcher routes from racing to apply
      // opposite interpretations of the same baseline state.
      if (operation.type !== 'download'
        && operation.type !== 'createLocalDirectory'
        && operation.type !== 'deleteLocal') {
        continue;
      }
      operations.push(operation);
      relevantChanges += 1;
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
      return { deferredDeletes: [], relevantChanges, retryPaths: [] };
    }

    const plan = singleOperationPlan(mapping, target, operations);
    const revalidated = await this.revalidatePlan(mapping, target, plan, session);
    const retryPaths = revalidated.stale.map(item => item.operation.relativePath);
    if (retryPaths.length) {
      this.log('WARN', `Remote Watch will re-evaluate ${retryPaths.length} path(s) that changed during validation: ${mapping.name} / ${target.name}.`);
    }
    const validPlan = { ...plan, operations: revalidated.valid };
    const result = await this.executePlan(mapping, target, validPlan, session, {
      atomicTransfer: mapping.options.atomicTransfer,
      journal: this.journal,
      watchActivity: true
    });
    const completedIds = new Set(result.completed.map(operation => operation.id));
    retryPaths.push(...validPlan.operations.filter(operation => operation.type !== 'skip' && !completedIds.has(operation.id)).map(operation => operation.relativePath));
    await this.updateBaselineForOperations(mapping, target, session, result.completed);
    await this.reflectAutomaticOperationsInView(mapping, target, session, result.completed);
    if (result.deferred.length) {
      await this.refreshAutomaticPathsInView(
        mapping,
        target,
        session,
        result.deferred.map(item => ({ relativePath: item.operation.relativePath })),
        undefined,
        true
      ).catch(() => undefined);
    }
    const level = result.failed.length || result.deferred.length || conflicts ? 'WARN' : 'INFO';
    this.log(level, `Remote Watch applied ${result.completed.length} change(s): ${mapping.name} / ${target.name}${result.failed.length ? `, ${result.failed.length} failed` : ''}${result.deferred.length ? `, ${result.deferred.length} deferred for re-evaluation` : ''}${conflicts ? `, ${conflicts} conflict(s)` : ''}.`);
    return {
      deferredDeletes: [...new Set(result.deferred.map(item => item.operation.relativePath))],
      retryPaths: [...new Set(retryPaths)],
      relevantChanges
    };
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
      // Enqueue each target independently. Endpoint/path coordinators bound
      // execution; waiting for the first targets here would starve later ones.
      await Promise.all(mapping.targets.filter(item => item.enabled).map(async target => {
        // Suppress only the echo back to the exact mapping/target that caused a
        // Local filesystem mutation. Other mappings/targets sharing this Local
        // Root must still observe and process the change.
        if (change.source === 'watcher'
          && this.journal.isLocalMutation(change.absolutePath, { mappingId: mapping.id, targetId: target.id })) return;
        const session = this.getConnectedAutomaticSession(mapping.id, target.id);
        if (session) await this.dispatchLocalWatchChange(mapping, target, change, session);
      }));
    } finally {
      this.diagnostics.performance('Local Watch', `Local change processing completed in ${formatDuration(watchTimer())}.`, { Mapping: mapping.name, Path: change.relativePath, Source: change.source });
    }
  }

  private isLocalWatchRetryCurrent(retry: LocalWatchRetry): boolean {
    const mapping = this.mappings.get(retry.mapping.id);
    const target = mapping?.targets.find(item => item.id === retry.target.id);
    return !this.disposed && Boolean(mapping && target?.enabled
      && mapping.updatedAt === retry.mapping.updatedAt && target.updatedAt === retry.target.updatedAt
      && mapping.options.direction !== 'remoteToLocal' && isLocalChangeEnabled(retry.change.source, mapping.options)
      && this.getConnectedAutomaticSession(mapping.id, target.id) === retry.session);
  }

  private scheduleLocalWatchRetry(mapping: WorkspaceSyncMapping, target: WorkspaceSyncTarget, change: WorkspaceLocalChange, session: WorkspaceSyncRemoteSession): void {
    const retry = { mapping, target, change, session };
    if (!this.isLocalWatchRetryCurrent(retry)) return;
    this.localWatchRetries.schedule(`${this.runtimeKey(mapping.id, target.id)}:${change.relativePath}`, retry);
  }

  private async dispatchLocalWatchChange(mapping: WorkspaceSyncMapping, target: WorkspaceSyncTarget, change: WorkspaceLocalChange, session: WorkspaceSyncRemoteSession): Promise<void> {
    try {
      await this.operations.run(this.runtimeKey(mapping.id, target.id), async () => {
        if (!this.isLocalWatchRetryCurrent({ mapping, target, change, session })) return;
        await this.runWithAutomaticPathProtection(mapping, session,
          [{ path: change.absolutePath, mode: 'read' }], async () => {
            if (!this.isLocalWatchRetryCurrent({ mapping, target, change, session })) return;
            await this.handleWatchedChangeForTarget(mapping, target, change);
          });
      });
    } catch (error) {
      this.scheduleLocalWatchRetry(mapping, target, change, session);
      this.log('WARN', `Workspace Sync automatic operation failed: ${mapping.name} / ${target.name} / ${change.relativePath}. ${error instanceof Error ? error.message : String(error)}`);
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
    // orders (atomic saves are a common example). Read both sides through the
    // same one-path classifier used by incremental Refresh/Remote Watch so the
    // changed-side decision can never drift between automatic routes.
    let currentState = await readAndClassifyCurrentPath(session, {
      relativePath: change.relativePath,
      localPath,
      remotePath,
      baseline,
      baselineCapturedAt: baselineState?.capturedAt,
      localRelativePath,
      remoteRelativePath,
      mtimeToleranceMs: 2000
    });
    let local = currentState.local;
    let remote = currentState.remote;
    let currentDiff = currentState.diff;

    // A queued Local Watch event can change meaning before it executes. For
    // example, a create/change may prepare an upload, then the file can be
    // deleted before fastPut opens it. Retries must follow the current Local
    // filesystem state instead of the historical event kind, otherwise that
    // path is left unreconciled after the failed upload. Keep save-only events
    // upload-only: delete propagation belongs to the filesystem watcher.
    const localDeletionObserved = !local && change.source !== 'save';

    if (localDeletionObserved) {
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
          this.scheduleLocalWatchRetry(mapping, target, change, session);
          await this.reportAutomaticConflict(mapping, target, change.relativePath, 'Local or Remote changed while the delete plan was being prepared.');
          return;
        }
        const result = await this.executePlan(mapping, target, { ...plan, operations: revalidated.valid }, session, {
          atomicTransfer: mapping.options.atomicTransfer,
          journal: this.journal,
          watchActivity: true
        });
        await this.updateBaselineForOperations(mapping, target, session, result.completed);
        await this.reflectAutomaticOperationsInView(mapping, target, session, result.completed);
        if (result.completed.length < revalidated.valid.filter(operation => operation.type !== 'skip').length) {
          this.scheduleLocalWatchRetry(mapping, target, change, session);
        }
        if (!result.failed.length && !result.deferred.length && !result.cancelled) {
          this.log('INFO', `Workspace Sync propagated local delete: ${mapping.name} / ${target.name} / ${change.relativePath}.`);
        } else {
          this.log('WARN', `Workspace Sync local delete was only partially propagated: ${mapping.name} / ${target.name} / ${change.relativePath}. ${result.failed.length} of ${revalidated.valid.length} remote delete operation(s) failed. Watch will re-evaluate the remaining Remote contents automatically.`);
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
        const classifiedDelete = await readAndClassifyCurrentPath(session, {
          relativePath,
          localPath: paths.localPath,
          remotePath: paths.remotePath,
          baseline: baselineEntry,
          baselineCapturedAt: baselineState.capturedAt,
          localRelativePath: paths.localRelativePath,
          remoteRelativePath: paths.remoteRelativePath,
          localKnown: true,
          local: undefined,
          mtimeToleranceMs: 2000
        });
        if (classifiedDelete.diff.status === 'conflict') {
          await this.reportAutomaticConflict(mapping, target, relativePath,
            classifiedDelete.diff.reason || 'Remote changed before the local delete could be propagated.');
          return;
        }
        if (!classifiedDelete.remote) continue;
        if (classifiedDelete.diff.status !== 'localDeleted') continue;
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
          expectedRemote: classifiedDelete.remote
        });
      }

      if (!operations.length) return;
      const plan = singleOperationPlan(mapping, target, operations);
      const revalidated = await this.revalidatePlan(mapping, target, plan, session);
      if (revalidated.stale.length) {
        this.scheduleLocalWatchRetry(mapping, target, change, session);
        await this.reportAutomaticConflict(mapping, target, change.relativePath, 'Local or Remote changed while the delete plan was being prepared.');
        return;
      }
      const result = await this.executePlan(mapping, target, { ...plan, operations: revalidated.valid }, session, {
        atomicTransfer: mapping.options.atomicTransfer,
        journal: this.journal,
        watchActivity: true
      });
      await this.updateBaselineForOperations(mapping, target, session, result.completed);
      await this.reflectAutomaticOperationsInView(mapping, target, session, result.completed);
      if (result.completed.length < revalidated.valid.filter(operation => operation.type !== 'skip').length) {
        this.scheduleLocalWatchRetry(mapping, target, change, session);
      }
      if (!result.failed.length && !result.deferred.length && !result.cancelled) {
        this.log('INFO', `Workspace Sync propagated local delete: ${mapping.name} / ${target.name} / ${change.relativePath}.`);
      } else {
        this.log('WARN', `Workspace Sync local delete was only partially propagated: ${mapping.name} / ${target.name} / ${change.relativePath}. ${result.failed.length} of ${revalidated.valid.length} remote delete operation(s) failed. Watch will re-evaluate the remaining Remote contents automatically.`);
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
      const remoteDirectoryState = remote;
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
        this.scheduleLocalWatchRetry(mapping, target, change, session);
        await this.reportAutomaticConflict(mapping, target, change.relativePath, 'Local or Remote changed while the directory-create plan was being prepared.');
        return;
      }
      const result = await this.executePlan(mapping, target, { ...plan, operations: revalidated.valid }, session, {
        atomicTransfer: mapping.options.atomicTransfer,
        journal: this.journal,
        watchActivity: true
      });
      if (result.completed.length < revalidated.valid.filter(operation => operation.type !== 'skip').length) {
        this.scheduleLocalWatchRetry(mapping, target, change, session);
      }
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
    // currentState was read through the shared classifier above. Reuse that
    // exact result for both the UI and the Watch decision; do not independently
    // infer Local/Remote changes here.
    await this.refreshAutomaticPathsInView(mapping, target, session, [{
      relativePath: change.relativePath,
      observation: { localKnown: true, local, remoteKnown: true, remote, localRelativePath, remoteRelativePath }
    }]).catch(() => undefined);

    if (!sourceIsAuthoritative) {
      if (currentDiff.status === 'conflict' || (currentDiff.status === 'different' && mapping.options.conflictProtection)) {
        await this.reportAutomaticConflict(mapping, target, change.relativePath,
          currentDiff.reason || 'Local and Remote both changed since the last trusted sync state.');
        return;
      }
      // A Local watcher event can arrive while the only trusted change belongs
      // to Remote (or while Remote deletion is pending). Leave those operations
      // to Remote Watch rather than turning the Local event into an upload.
      if (currentDiff.status === 'remoteChanged' || currentDiff.status === 'remoteOnly' || currentDiff.status === 'remoteDeleted') return;
    }

    if (currentDiff.status === 'same') {
      if (local && remote) {
        await this.baselines.updatePath(mapping.id, target.id, change.relativePath, local, remote, { localRelativePath, remoteRelativePath });
      }
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
    if (revalidated.stale.length) {
      this.scheduleLocalWatchRetry(mapping, target, change, session);
      return;
    }
    const result = await this.executePlan(mapping, target, { ...plan, operations: revalidated.valid }, session, {
      atomicTransfer: mapping.options.atomicTransfer,
      journal: this.journal,
      watchActivity: true
    });
    if (result.completed.length < revalidated.valid.filter(operation => operation.type !== 'skip').length) {
      this.scheduleLocalWatchRetry(mapping, target, change, session);
    }
    if (result.failed.length) return;

    await this.updateBaselineForOperations(mapping, target, session, result.completed);
    await this.reflectAutomaticOperationsInView(mapping, target, session, result.completed);
    this.log('INFO', `Workspace Sync automatic upload: ${mapping.name} / ${target.name} / ${change.relativePath}.`);
  }

  private invalidateStaleResolutions(runtime: MappingRuntimeState, stalePaths: string[]): boolean {
    if (!runtime.plan || !stalePaths.length) return false;
    const stale = new Set(stalePaths);
    let invalidated = false;
    runtime.diffs = runtime.diffs.map(diff => {
      if (!stale.has(diff.relativePath) || !diff.resolution) return diff;
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
    // Directory deletions are expanded against the complete current subtree,
    // intentionally including hidden/ignored descendants. The planner has
    // already approved deletion of the directory itself; explicit descendant
    // operations let the normal revalidator/executor remove the complete tree
    // deepest-first without ever using an unsafe recursive delete. Anything
    // created after this manifest is captured remains outside the plan and the
    // final rmdir/deleteDirectory fails closed instead of erasing new data.
    const expandedPlan = await expandDirectoryDeletePlan(mapping, target, plan, session, cancellationToken);
    const result = await revalidateSyncPlan(mapping, target, expandedPlan, session, cancellationToken);
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

  private localRootChangedAfter(root: string, epoch: number): boolean {
    for (const [changedRoot, changedAt] of this.lastLocalMutationByRoot) {
      if (changedAt > epoch && localRootsOverlap(root, changedRoot)) return true;
    }
    return false;
  }

  /** Reclassify Local changes against every other connected target's own
   * baseline, including mappings without Local Watch. Never copy diff objects
   * across mappings. When Local Watch is enabled for a peer, route the change
   * through handleWatchedChangeForTarget() -- the exact same classifier,
   * planner, revalidator, executor, baseline and journal path used by a real
   * filesystem watcher event. This makes cross-target Local propagation
   * deterministic without creating a second automatic-sync implementation. */
  private scheduleSharedLocalReclassification(
    originMapping: WorkspaceSyncMapping, originTarget: WorkspaceSyncTarget, completed: SyncOperation[]
  ): void {
    const changed = completed.filter(operation =>
      ['download', 'deleteLocal', 'createLocalDirectory'].includes(operation.type));
    if (!changed.length) return;
    this.lastLocalMutationByRoot.set(originMapping.localRoot, ++this.localMutationEpoch);
    for (const mapping of this.mappings.list()) {
      for (const target of mapping.targets) {
        if (!target.enabled || (mapping.id === originMapping.id && target.id === originTarget.id)) continue;
        if (!this.sessions.getSession(this.sessionKey(mapping.id, target.id))) continue;
        const key = this.runtimeKey(mapping.id, target.id);
        let paths = this.pendingSharedLocalPaths.get(key);
        if (!paths) this.pendingSharedLocalPaths.set(key, paths = new Map());
        for (const operation of changed) {
          const absolute = path.resolve(originMapping.localRoot, operation.localRelativePath || operation.relativePath);
          const relative = path.relative(path.resolve(mapping.localRoot), absolute);
          if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
            const physicalRelativePath = relative.split(path.sep).join('/');
            const relativePath = physicalRelativePath.normalize('NFC');
            // Last completed operation wins if a batch touched the same path
            // more than once. Only a Local deletion needs special event
            // semantics; create/change are both classified from current state.
            paths.set(relativePath, {
              kind: operation.type === 'deleteLocal' ? 'delete' : 'change',
              physicalRelativePath
            });
          }
        }
        if (!paths.size) this.pendingSharedLocalPaths.delete(key);
      }
    }
    if (this.sharedLocalRefreshTimer || !this.pendingSharedLocalPaths.size) return;
    this.sharedLocalRefreshTimer = setTimeout(() => {
      this.sharedLocalRefreshTimer = undefined;
      const pending = [...this.pendingSharedLocalPaths];
      this.pendingSharedLocalPaths.clear();
      for (const [key, paths] of pending) {
        const mapping = this.mappings.list().find(item => item.targets.some(target => this.runtimeKey(item.id, target.id) === key));
        const target = mapping?.targets.find(item => this.runtimeKey(mapping.id, item.id) === key);
        if (!mapping || !target || !paths.size) continue;
        void this.operations.run(key, async () => {
          const currentMapping = this.mappings.get(mapping.id);
          const currentTarget = currentMapping?.targets.find(item => item.id === target.id);
          if (!currentMapping || !currentTarget?.enabled) return;
          const session = this.getConnectedAutomaticSession(mapping.id, target.id);
          if (!session) return;
          const ignore = new IgnoreMatcher(await loadEffectiveIgnorePatterns(currentMapping));

          for (const [relativePath, pendingPath] of paths) {
            if (ignore.ignores(relativePath, false)) continue;
            const absolutePath = path.resolve(currentMapping.localRoot, pendingPath.physicalRelativePath.split('/').join(path.sep));
            await this.runWithAutomaticPathProtection(
              currentMapping,
              session,
              [{ path: absolutePath, mode: 'read' }],
              async () => {
                // Re-check the session after waiting for endpoint/path locks.
                if (this.getConnectedAutomaticSession(currentMapping.id, currentTarget.id) !== session) return;

                if (currentMapping.options.watchLocalChanges && currentMapping.options.direction !== 'remoteToLocal') {
                  const change: WorkspaceLocalChange = {
                    mappingId: currentMapping.id,
                    relativePath,
                    physicalRelativePath: pendingPath.physicalRelativePath,
                    absolutePath,
                    kind: pendingPath.kind,
                    source: 'watcher'
                  };
                  try {
                    await this.handleWatchedChangeForTarget(currentMapping, currentTarget, change);
                  } catch (error) {
                    this.scheduleLocalWatchRetry(currentMapping, currentTarget, change, session);
                    this.log('WARN', `Shared Local change will be re-evaluated: ${currentMapping.name} / ${currentTarget.name} / ${relativePath}. ${error instanceof Error ? error.message : String(error)}`);
                  }
                  return;
                }

                // Watch Local may be disabled (or Direction may forbid Local ->
                // Remote) but Changes must still reflect the shared Local write.
                await this.refreshAutomaticPathsInView(
                  currentMapping,
                  currentTarget,
                  session,
                  [{ relativePath }],
                  undefined,
                  true
                );
              }
            );
          }
        }).catch(error => {
          this.log('WARN', `Shared Local change processing failed for ${mapping.name} / ${target.name}. ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }, 100);
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
    const watchKey = this.runtimeKey(mapping.id, target.id);
    let watchProcessed = 0;
    if (options.watchActivity) {
      this.watchingTargets.add(watchKey);
      this.backgroundActivityEmitter.fire({
        active: true, kind: 'watch', label: 'Watch reconciliation...',
        mappingId: mapping.id, targetId: target.id,
        detail: `${target.name} · 0/${plan.operations.length}`, cancellable: false
      });
      this.viewStateChangedEmitter.fire();
    }
    let result: Awaited<ReturnType<typeof executeSyncPlan>>;
    try {
      result = await executeSyncPlan(mapping, target, plan, session, {
        ...options,
        // Scope Local mutation suppression to the executing mapping + target.
        // Other mappings sharing the Local Root must still observe its writes.
        journal: scopedJournal,
        onOrphanedRemoteTemp: (tempRemotePath, operation) => {
          this.recordOrphanedRemoteTemp(mapping, target, tempRemotePath, operation.relativePath);
          options.onOrphanedRemoteTemp?.(tempRemotePath, operation);
        },
        onActivity: event => {
          const level: SyncActivity['level'] = event.kind === 'failed' ? 'error' : (event.kind === 'retry' || event.kind === 'deferred') ? 'warning' : event.kind === 'completed' ? 'success' : 'info';
          const action = { upload: 'Upload', download: 'Download', createLocalDirectory: 'Create local directory', createRemoteDirectory: 'Create remote directory', deleteLocal: 'Delete local', deleteRemote: 'Delete remote', skip: 'Skip' }[event.operation.type];
          const targetLabel = `${mapping.name} / ${target.name}`;
          const inlineMessage = event.kind === 'failed' ? '' : event.message ? ` — ${event.message}` : '';
          const activityLabel = event.kind === 'skipped' && event.operation.type === 'skip'
            ? `Skipped: ${event.operation.relativePath}${inlineMessage}`
            : event.kind === 'deferred'
              ? `${action} deferred: ${event.operation.relativePath}${inlineMessage}`
              : `${action} ${event.kind}: ${event.operation.relativePath}${inlineMessage}`;
          this.ui.log(activityLabel, level, targetLabel);
          if (event.kind === 'failed' && event.message) {
            if (event.errorOutput) this.ui.log(`Error output: ${event.errorOutput}`, 'error', targetLabel);
            const guidance = describeSyncOperationFailure(event.operation, event.message);
            if (guidance) this.ui.log(guidance, 'warning', targetLabel);
          }
          if (options.watchActivity && (event.kind === 'completed' || event.kind === 'failed' || event.kind === 'skipped' || event.kind === 'deferred')) {
            watchProcessed += 1;
            this.backgroundActivityEmitter.fire({
              active: true, kind: 'watch', label: 'Watch reconciliation...',
              mappingId: mapping.id, targetId: target.id,
              detail: `${target.name} · ${watchProcessed}/${plan.operations.length} · ${event.operation.relativePath}`,
              cancellable: false
            });
          }
          options.onActivity?.(event);
        }
      });
    } finally {
      if (options.watchActivity) {
        this.watchingTargets.delete(watchKey);
        this.backgroundActivityEmitter.fire({
          active: false, kind: 'watch', label: 'Watch reconciliation...',
          mappingId: mapping.id, targetId: target.id
        });
        this.viewStateChangedEmitter.fire();
      }
    }
    this.markFailedTransfersForStrongVerification(mapping, target, plan, result);
    this.scheduleSharedLocalReclassification(mapping, target, result.completed);
    await this.cleanupKnownOrphanedRemoteTemps(mapping, target, session);
    this.ui.log(`${result.cancelled ? 'Cancelled' : 'Finished'}: ${result.completed.length} completed, ${result.failed.length} failed, ${result.skipped.length} skipped${result.deferred.length ? `, ${result.deferred.length} deferred` : ''}.`, result.failed.length ? 'error' : (result.cancelled || result.deferred.length) ? 'warning' : 'success', `${mapping.name} / ${target.name}`);
    this.diagnostics.debug('Executor', 'Plan execution completed.', {
      Mapping: mapping.name,
      Target: target.name,
      Completed: result.completed.length,
      Failed: result.failed.length,
      Skipped: result.skipped.length,
      Deferred: result.deferred.length,
      Cancelled: result.cancelled
    });
    this.diagnostics.performance('Executor', `Plan execution completed in ${formatDuration(executionTimer())}.`, {
      Mapping: mapping.name,
      Target: target.name,
      Operations: plan.operations.length,
      Completed: result.completed.length,
      Failed: result.failed.length,
      Skipped: result.skipped.length,
      Deferred: result.deferred.length
    });
    return result;
  }

  private getConnectedAutomaticSession(mappingId: string, targetId: string) {
    const key = this.sessionKey(mappingId, targetId);
    if (this.disconnectRequested.has(key) || this.preparingTargets.has(this.runtimeKey(mappingId, targetId)) || this.suspendedTargets.has(this.runtimeKey(mappingId, targetId))) return undefined;
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
    const previousBaseline = await this.baselines.get(mapping.id, target.id);
    const strongPaths = this.strongVerificationPaths.get(this.runtimeKey(mapping.id, target.id));
    const states = await mapWithConcurrencyLimit(operations, session.capabilities.maxConcurrentMetadata, async operation => {
      if (operation.type === 'skip') return undefined;
      const { localPath, remotePath, localRelativePath, remoteRelativePath } = resolveSyncPaths(mapping, target, operation.relativePath, operation);
      const previous = previousBaseline?.entries[operation.relativePath];
      // A successful transfer must never weaken trusted history. If either side
      // previously required content hashing (or a failed transfer requested a
      // strong verification), capture hashes on both current files so the next
      // Local/Remote Watch uses the same-strength baseline as Refresh.
      const includeHash = baselineRequiresStrongFingerprint(
        previous,
        session.capabilities.reliableMtime,
        Boolean(strongPaths?.has(operation.relativePath))
      );
      const [local, remote] = await Promise.all([
        readLocalFingerprint(localPath, includeHash),
        readRemoteFingerprint(session, remotePath, includeHash)
      ]);
      return { operation, local, remote, localRelativePath, remoteRelativePath };
    });

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
    if (this.suspendedTargets.has(this.runtimeKey(mappingId, targetId))) {
      throw new Error('This target was cancelled during initial preparation. Run Refresh to complete its initial Refresh.');
    }
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


function formatWorkspaceSyncTargetNames(names: string[], maxVisible = 3): string {
  const clean = names.map(name => String(name || '').trim()).filter(Boolean);
  if (!clean.length) return '';
  if (clean.length <= maxVisible) return clean.join(', ');
  return `${clean.slice(0, maxVisible).join(', ')} +${clean.length - maxVisible}`;
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
      : sourceFingerprint.kind === 'unknown'
        ? `Unsupported ${useLocal ? 'Local' : 'Remote'} entry (not a regular file or directory, e.g. socket, FIFO or device). Watch does not transfer it.`
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


function normalizeReconcileScopes(scopes: string[]): string[] {
  return [...new Set(scopes
    .map(scope => String(scope || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').normalize('NFC'))
    .filter(Boolean))]
    .sort((left, right) => left.length - right.length || left.localeCompare(right))
    .filter((scope, index, all) => !all.slice(0, index).some(parent => scope === parent || scope.startsWith(`${parent}/`)));
}

function pathInScopes(relativePath: string, scopes: string[]): boolean {
  return scopes.some(scope => relativePath === scope || relativePath.startsWith(`${scope}/`));
}

function combineSnapshots(parts: SyncSnapshot[]): SyncSnapshot {
  const entries: SyncSnapshot['entries'] = {};
  const incomplete = new Set<string>();
  const errors: Record<string, string> = {};
  for (const snapshot of parts) {
    for (const [relativePath, entry] of Object.entries(snapshot.entries)) {
      entries[relativePath] = {
        ...entry,
        fingerprint: { ...entry.fingerprint }
      };
    }
    for (const relativePath of snapshot.incompletePaths) incomplete.add(relativePath);
    Object.assign(errors, snapshot.incompleteErrors || {});
  }
  return {
    capturedAt: Date.now(),
    entries,
    incompletePaths: [...incomplete],
    ...(Object.keys(errors).length ? { incompleteErrors: errors } : {})
  };
}

function replaceSnapshotScopes(base: SyncSnapshot, replacement: SyncSnapshot, scopes: string[]): SyncSnapshot {
  const entries: SyncSnapshot['entries'] = {};
  for (const [relativePath, entry] of Object.entries(base.entries)) {
    if (pathInScopes(relativePath, scopes)) continue;
    entries[relativePath] = { ...entry, fingerprint: { ...entry.fingerprint } };
  }
  for (const [relativePath, entry] of Object.entries(replacement.entries)) {
    entries[relativePath] = { ...entry, fingerprint: { ...entry.fingerprint } };
  }

  const incompletePaths = [
    ...base.incompletePaths.filter(relativePath => !pathInScopes(relativePath, scopes)),
    ...replacement.incompletePaths
  ];
  const incompleteErrors: Record<string, string> = {};
  for (const [relativePath, detail] of Object.entries(base.incompleteErrors || {})) {
    if (!pathInScopes(relativePath, scopes)) incompleteErrors[relativePath] = detail;
  }
  Object.assign(incompleteErrors, replacement.incompleteErrors || {});
  return {
    capturedAt: Date.now(),
    entries,
    incompletePaths: [...new Set(incompletePaths)],
    ...(Object.keys(incompleteErrors).length ? { incompleteErrors } : {})
  };
}

function filterBaselineToScopes(baseline: SyncBaseline | undefined, scopes: string[]): SyncBaseline | undefined {
  if (!baseline) return undefined;
  const entries: SyncBaseline['entries'] = {};
  for (const [relativePath, entry] of Object.entries(baseline.entries)) {
    if (!pathInScopes(relativePath, scopes)) continue;
    entries[relativePath] = {
      local: entry.local ? { ...entry.local } : undefined,
      remote: entry.remote ? { ...entry.remote } : undefined,
      localRelativePath: entry.localRelativePath,
      remoteRelativePath: entry.remoteRelativePath
    };
  }
  return { ...baseline, entries };
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

/** A plan reserves the complete set of concrete Local paths before revalidation.
 * Directories cover descendants. Unknown footprints revert to whole-root
 * serialization in the coordinator; no optimistic write is ever admitted.
 */
export function planLocalPathAccesses(
  mapping: WorkspaceSyncMapping,
  target: WorkspaceSyncTarget,
  plan: SyncPlan
): LocalPathAccess[] {
  const accesses: LocalPathAccess[] = [];
  for (const operation of plan.operations) {
    if (operation.type === 'skip') continue;
    const { localPath } = resolveSyncPaths(mapping, target, operation.relativePath, operation);
    // mkdir({recursive:true}) can write unlisted ancestors: keep the broad
    // lock until a more precise parent-directory acquisition is available.
    if (operation.type === 'createLocalDirectory') {
      return [{ path: mapping.localRoot, mode: 'write' }];
    }
    const mode: LocalPathAccess['mode'] = ['download', 'deleteLocal'].includes(operation.type)
      ? 'write' : 'read';
    accesses.push({ path: localPath, mode });
  }
  return accesses;
}

function remoteEndpointLockRoot(session: import('./connection/WorkspaceSyncSession').WorkspaceSyncRemoteSession): string {
  // A stable private lock namespace, never a physical path. Remote path rules
  // (Windows/SFTP/FTP/AIX) must not be interpreted with the Local path module.
  // Until proven safe, two writers on the same endpoint serialize.
  return path.resolve(path.sep, '__remoteedit_sync_endpoints__', session.connectionIdentity);
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


function decorateResolutionSuggestion(diff: DiffEntry, remoteTimestampAbsolute: boolean): DiffEntry {
  const next: DiffEntry = { ...diff };
  const suggestion = suggestConflictResolution(next, { remoteTimestampAbsolute, mtimeToleranceMs: 2000 });
  if (suggestion) next.suggestedResolution = suggestion;
  else delete next.suggestedResolution;
  return next;
}

function formatDuration(milliseconds: number): string {
  const safe = Math.max(0, Math.round(milliseconds));
  return safe < 1000 ? `${safe} ms` : `${(safe / 1000).toFixed(2)} s`;
}
