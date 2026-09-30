import type { DiffStatus, SyncOperation, WorkspaceSyncDirection } from '../types';

export type WorkspaceLocalChangeSource = 'watcher' | 'save' | 'both';
export type WorkspaceWatchSourceSide = 'local' | 'remote';

/**
 * Files saved inside VS Code can produce both an onDidSaveTextDocument event
 * and a filesystem watcher event. Preserve both origins while debouncing so
 * disabling Upload on Save cannot accidentally suppress an enabled filesystem
 * watcher (and vice versa).
 */
export function mergeLocalChangeSource(
  previous: WorkspaceLocalChangeSource | undefined,
  incoming: WorkspaceLocalChangeSource
): WorkspaceLocalChangeSource {
  if (!previous || previous === incoming) return incoming;
  if (previous === 'both' || incoming === 'both') return 'both';
  return 'both';
}

export function isLocalChangeEnabled(
  source: WorkspaceLocalChangeSource,
  options: { uploadOnSave: boolean; watchLocalChanges: boolean }
): boolean {
  const saveEnabled = source !== 'watcher' && options.uploadOnSave;
  const watcherEnabled = source !== 'save' && options.watchLocalChanges;
  return saveEnabled || watcherEnabled;
}

/**
 * One-way automatic sync treats the configured source side as authoritative.
 * Bidirectional automation must continue using baseline/conflict protection.
 */
export function isWatchSourceAuthoritative(
  direction: WorkspaceSyncDirection,
  sourceSide: WorkspaceWatchSourceSide
): boolean {
  return (direction === 'localToRemote' && sourceSide === 'local')
    || (direction === 'remoteToLocal' && sourceSide === 'remote');
}




/**
 * During the initial Bidirectional Watch reconciliation the Refresh result is
 * the source of truth. Operations are therefore taken directly from the plan
 * produced by that Refresh and filtered only by which watcher is enabled.
 * This prevents a second baseline interpretation from turning a proven
 * localChanged/remoteChanged result into a spurious conflict.
 */
export function isInitialBidirectionalWatchOperationEnabled(
  type: SyncOperation['type'],
  options: { watchLocalChanges: boolean; watchRemoteChanges: boolean }
): boolean {
  switch (type) {
    case 'upload':
    case 'createRemoteDirectory':
    case 'deleteRemote':
      return options.watchLocalChanges;
    case 'download':
    case 'createLocalDirectory':
    case 'deleteLocal':
      return options.watchRemoteChanges;
    case 'skip':
      return false;
  }
}

export interface InitialWatchReconcileDecision {
  local: boolean;
  remote: boolean;
  conflict: boolean;
}

/**
 * Selects which enabled watcher owns a difference that already exists when
 * Watch starts. One-way modes keep their configured source authoritative. In
 * Bidirectional mode only changes attributable to one side are automatic; an
 * existing conflict/different state has no trustworthy event ordering and must
 * remain manual.
 */
export function initialWatchReconcileDecision(
  direction: WorkspaceSyncDirection,
  status: DiffStatus,
  options: { watchLocalChanges: boolean; watchRemoteChanges: boolean }
): InitialWatchReconcileDecision {
  const none = { local: false, remote: false, conflict: false };
  if (status === 'same' || status === 'unknown') return none;

  if (direction === 'localToRemote') {
    if (!options.watchLocalChanges || status === 'remoteOnly') return none;
    return { local: true, remote: false, conflict: false };
  }

  if (direction === 'remoteToLocal') {
    if (!options.watchRemoteChanges || status === 'localOnly') return none;
    return { local: false, remote: true, conflict: false };
  }

  if (status === 'conflict' || status === 'different') {
    return {
      local: false,
      remote: false,
      conflict: options.watchLocalChanges || options.watchRemoteChanges
    };
  }

  const local = options.watchLocalChanges
    && (status === 'localOnly' || status === 'localChanged' || status === 'localDeleted');
  const remote = options.watchRemoteChanges
    && (status === 'remoteOnly' || status === 'remoteChanged' || status === 'remoteDeleted');
  return { local, remote, conflict: false };
}
