import * as crypto from 'crypto';
import type { DiffEntry, SyncOperation, SyncPlan, WorkspaceSyncConflictResolution, WorkspaceSyncDirection } from '../types';
import { validateRelativePathForDestination, type WorkspaceSyncFilenameStyle } from './PathCompatibility';

export interface SyncPlannerOptions {
  direction: WorkspaceSyncDirection;
  propagateDeletes: boolean;
  conflictProtection: boolean;
  localFilenameStyle?: WorkspaceSyncFilenameStyle;
  remoteFilenameStyle?: WorkspaceSyncFilenameStyle;
}

export function buildSyncPlan(mappingId: string, targetId: string, diffs: DiffEntry[], options: SyncPlannerOptions): SyncPlan {
  const operations: SyncOperation[] = [];
  const conflicts: DiffEntry[] = [];
  const errors: DiffEntry[] = [];

  for (const diff of diffs) {
    if (diff.status === 'same') {
      continue;
    }
    if (diff.status === 'unknown') {
      errors.push(diff);
      continue;
    }
    if ((diff.status === 'conflict' || diff.status === 'different') && diff.resolution) {
      const operation = planResolution(diff, diff.resolution);
      const compatibilityError = operationDestinationCompatibilityError(operation, options);
      if (compatibilityError) {
        errors.push({ ...diff, status: 'unknown', reason: compatibilityError });
      } else {
        operations.push(operation);
      }
      continue;
    }
    if (diff.status === 'conflict' || (diff.status === 'different' && options.conflictProtection)) {
      conflicts.push(diff.status === 'different'
        ? { ...diff, reason: diff.reason || 'Local and remote differ and there is no trusted baseline to choose a winner safely.' }
        : diff);
      continue;
    }

    const operation = planEntry(diff, options);
    if (operation) {
      const compatibilityError = operationDestinationCompatibilityError(operation, options);
      if (compatibilityError) {
        errors.push({ ...diff, status: 'unknown', reason: compatibilityError });
      } else {
        operations.push(operation);
      }
    }
  }

  guardDirectoryDeletes(diffs, operations, conflicts);

  return {
    mappingId,
    targetId,
    createdAt: Date.now(),
    direction: options.direction,
    operations,
    conflicts,
    errors
  };
}

/**
 * A recursive directory delete is never safe merely because the directory
 * itself was deleted on the source side. A descendant may have appeared or
 * changed independently on the destination after the baseline. Keep the
 * Preview honest by blocking the parent delete unless every currently present
 * destination descendant is also explicitly scheduled for deletion. The
 * executor additionally performs only empty-directory removal as a final
 * fail-closed guard.
 */
function guardDirectoryDeletes(
  diffs: DiffEntry[],
  operations: SyncOperation[],
  conflicts: DiffEntry[]
): void {
  const operationByPath = new Map(operations.map(operation => [operation.relativePath, operation]));
  const unsafeIds = new Set<string>();

  for (const operation of operations) {
    const deleteRemoteDirectory = operation.type === 'deleteRemote' && operation.expectedRemote?.kind === 'directory';
    const deleteLocalDirectory = operation.type === 'deleteLocal' && operation.expectedLocal?.kind === 'directory';
    if (!deleteRemoteDirectory && !deleteLocalDirectory) continue;

    const prefix = `${operation.relativePath.replace(/\/+$/, '')}/`;
    const expectedDeleteType: SyncOperation['type'] = deleteRemoteDirectory ? 'deleteRemote' : 'deleteLocal';
    const unsafeDescendant = diffs.find(diff => {
      if (!diff.relativePath.startsWith(prefix)) return false;
      const destinationExists = deleteRemoteDirectory ? Boolean(diff.remote) : Boolean(diff.local);
      if (!destinationExists) return false;
      return operationByPath.get(diff.relativePath)?.type !== expectedDeleteType;
    });

    if (!unsafeDescendant) continue;
    unsafeIds.add(operation.id);
    if (!conflicts.some(conflict => conflict.relativePath === operation.relativePath)) {
      conflicts.push({
        relativePath: operation.relativePath,
        localRelativePath: operation.localRelativePath,
        remoteRelativePath: operation.remoteRelativePath,
        status: 'conflict',
        local: operation.expectedLocal,
        remote: operation.expectedRemote,
        reason: `Directory delete is blocked because '${unsafeDescendant.relativePath}' is not part of the same delete plan.`
      });
    }
  }

  if (!unsafeIds.size) return;
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    if (unsafeIds.has(operations[index].id)) operations.splice(index, 1);
  }
}

function planResolution(diff: DiffEntry, resolution: WorkspaceSyncConflictResolution): SyncOperation {
  const make = (type: SyncOperation['type'], reason: string): SyncOperation => ({
    id: `resolve-${crypto.randomUUID()}`,
    type,
    relativePath: diff.relativePath,
    localRelativePath: diff.localRelativePath,
    remoteRelativePath: diff.remoteRelativePath,
    reason,
    expectedLocal: diff.local,
    expectedRemote: diff.remote
  });

  if (resolution === 'skip') return make('skip', 'This path is selected to be skipped during the next Sync.');
  if (diff.local && diff.remote && diff.local.kind !== diff.remote.kind) {
    throw new Error('File/directory structural conflicts must be corrected manually before Sync can continue.');
  }

  const useLocal = resolution === 'useLocal';
  const source = useLocal ? diff.local : diff.remote;
  const destination = useLocal ? diff.remote : diff.local;
  if (!source) {
    if (!destination) throw new Error('The conflict no longer has a Local or Remote version to resolve.');
    return make(useLocal ? 'deleteRemote' : 'deleteLocal', useLocal
      ? 'The next Sync will apply the Local deletion.'
      : 'The next Sync will apply the Remote deletion.');
  }
  if (source.kind === 'file') {
    return make(useLocal ? 'upload' : 'download', useLocal
      ? 'The next Sync will use the Local version.'
      : 'The next Sync will use the Remote version.');
  }
  if (source.kind === 'directory') {
    return make(useLocal ? 'createRemoteDirectory' : 'createLocalDirectory', useLocal
      ? 'The next Sync will use the Local directory.'
      : 'The next Sync will use the Remote directory.');
  }
  throw new Error('Symbolic links and unsupported file types cannot be selected as a conflict winner automatically.');
}

function planEntry(diff: DiffEntry, options: SyncPlannerOptions): SyncOperation | undefined {
  const make = (type: SyncOperation['type'], reason: string): SyncOperation => ({
    id: `op-${crypto.randomUUID()}`,
    type,
    relativePath: diff.relativePath,
    localRelativePath: diff.localRelativePath,
    remoteRelativePath: diff.remoteRelativePath,
    reason,
    expectedLocal: diff.local,
    expectedRemote: diff.remote
  });

  const fromLocal = (reason: string): SyncOperation => {
    if (diff.local?.kind === 'directory') return make('createRemoteDirectory', reason);
    if (diff.local?.kind === 'file') return make('upload', reason);
    return make('skip', diff.local?.kind === 'link'
      ? 'Symbolic links are not transferred automatically.'
      : 'Unsupported Local file type.');
  };

  const fromRemote = (reason: string): SyncOperation => {
    if (diff.remote?.kind === 'directory') return make('createLocalDirectory', reason);
    if (diff.remote?.kind === 'file') return make('download', reason);
    return make('skip', diff.remote?.kind === 'link'
      ? 'Symbolic links are not transferred automatically.'
      : 'Unsupported Remote file type.');
  };

  switch (options.direction) {
    case 'localToRemote':
      switch (diff.status) {
        case 'localOnly':
        case 'localChanged':
          return fromLocal('Local side is the source for this mapping.');
        case 'remoteDeleted':
          return fromLocal('Remote destination is missing; restore it from Local.');
        case 'different':
          return fromLocal('Local side is the source for this mapping.');
        case 'localDeleted':
          return options.propagateDeletes
            ? make('deleteRemote', 'Local deletion is being propagated.')
            : make('skip', 'Delete propagation is disabled.');
        case 'remoteOnly':
        case 'remoteChanged':
          return make('skip', 'Remote-only changes are preserved in Local to Remote mode.');
      }
      break;

    case 'remoteToLocal':
      switch (diff.status) {
        case 'remoteOnly':
        case 'remoteChanged':
          return fromRemote('Remote side is the source for this mapping.');
        case 'localDeleted':
          return fromRemote('Local destination is missing; restore it from Remote.');
        case 'different':
          return fromRemote('Remote side is the source for this mapping.');
        case 'remoteDeleted':
          return options.propagateDeletes
            ? make('deleteLocal', 'Remote deletion is being propagated.')
            : make('skip', 'Delete propagation is disabled.');
        case 'localOnly':
        case 'localChanged':
          return make('skip', 'Local-only changes are preserved in Remote to Local mode.');
      }
      break;

    case 'bidirectional':
      switch (diff.status) {
        case 'localOnly':
        case 'localChanged':
          return fromLocal('Local side changed.');
        case 'remoteOnly':
        case 'remoteChanged':
          return fromRemote('Remote side changed.');
        case 'localDeleted':
          return options.propagateDeletes
            ? make('deleteRemote', 'Local deletion is being propagated.')
            : make('skip', 'Delete propagation is disabled.');
        case 'remoteDeleted':
          return options.propagateDeletes
            ? make('deleteLocal', 'Remote deletion is being propagated.')
            : make('skip', 'Delete propagation is disabled.');
        case 'different':
          return undefined;
      }
      break;
  }

  return undefined;
}

function operationDestinationCompatibilityError(
  operation: SyncOperation,
  options: SyncPlannerOptions
): string | undefined {
  const destinationStyle = operation.type === 'upload' || operation.type === 'createRemoteDirectory'
    ? options.remoteFilenameStyle
    : operation.type === 'download' || operation.type === 'createLocalDirectory'
      ? options.localFilenameStyle
      : undefined;
  if (!destinationStyle) return undefined;
  const destinationRelativePath = operation.type === 'upload' || operation.type === 'createRemoteDirectory'
    ? (operation.remoteRelativePath || operation.relativePath)
    : (operation.localRelativePath || operation.relativePath);
  const reason = validateRelativePathForDestination(destinationRelativePath, destinationStyle);
  return reason ? `${reason}. Workspace Sync will not create '${operation.relativePath}' on that destination.` : undefined;
}
