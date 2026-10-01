import type { SyncOperation, SyncPlan, WorkspaceSyncMapping, WorkspaceSyncTarget } from '../types';
import type { WorkspaceSyncRemoteSession } from '../connection/WorkspaceSyncSession';
import { fingerprintsEqual } from '../snapshot/FileFingerprint';
import { resolveSyncPaths } from '../execution/SyncPathUtils';
import { readLocalFingerprint, readRemoteFingerprint } from '../snapshot/CurrentState';
import { assertLocalPathAncestorsSafe, assertRemotePathAncestorsSafe } from '../execution/PathSafety';

export interface RevalidationResult {
  valid: SyncOperation[];
  stale: Array<{ operation: SyncOperation; reason: string }>;
}

export async function revalidateSyncPlan(
  mapping: WorkspaceSyncMapping,
  target: WorkspaceSyncTarget,
  plan: SyncPlan,
  session: WorkspaceSyncRemoteSession,
  cancellationToken?: { readonly isCancellationRequested: boolean }
): Promise<RevalidationResult> {
  const valid: SyncOperation[] = [];
  const stale: Array<{ operation: SyncOperation; reason: string }> = [];

  for (const operation of plan.operations) {
    if (cancellationToken?.isCancellationRequested) throw new Error('Workspace Sync operation cancelled.');
    if (operation.type === 'skip') {
      valid.push(operation);
      continue;
    }
    const { localPath, remotePath, localRelativePath, remoteRelativePath } = resolveSyncPaths(mapping, target, operation.relativePath, operation);
    try {
      await Promise.all([
        assertLocalPathAncestorsSafe(mapping.localRoot, localRelativePath),
        assertRemotePathAncestorsSafe(session, target.remoteRoot, remoteRelativePath)
      ]);
    } catch (error) {
      stale.push({ operation, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const includeLocalHash = Boolean(operation.expectedLocal?.hash);
    const includeRemoteHash = Boolean(operation.expectedRemote?.hash) || !session.capabilities.reliableMtime;
    const [currentLocal, currentRemote] = await Promise.all([
      readLocalFingerprint(localPath, includeLocalHash),
      readRemoteFingerprint(session, remotePath, includeRemoteHash)
    ]);

    if (!fingerprintsEqual(currentLocal, operation.expectedLocal, {
      mtimeReliable: true,
      requireHashWhenAvailable: includeLocalHash
    })) {
      stale.push({ operation, reason: 'Local state changed after the sync plan was created.' });
      continue;
    }
    if (!fingerprintsEqual(currentRemote, operation.expectedRemote, {
      mtimeReliable: session.capabilities.reliableMtime,
      requireHashWhenAvailable: includeRemoteHash
    })) {
      stale.push({ operation, reason: 'Remote state changed after the sync plan was created.' });
      continue;
    }
    valid.push(operation);
  }

  // Directory deletes have an explicit dependency on every descendant delete
  // in the same plan. If a child becomes stale during revalidation, keeping an
  // ancestor rmdir valid is unsafe: the parent may now contain data that was
  // not removed by this execution. Cascade the stale state upward so the
  // executor never attempts the parent based on a partially-invalidated plan.
  cascadeStaleDirectoryDeletes(valid, stale);
  cascadeStaleDirectoryDeleteDescendants(valid, stale);
  return { valid, stale };
}

function cascadeStaleDirectoryDeletes(
  valid: SyncOperation[],
  stale: Array<{ operation: SyncOperation; reason: string }>
): void {
  if (!valid.length || !stale.length) return;

  let changed = true;
  while (changed) {
    changed = false;
    for (let index = valid.length - 1; index >= 0; index -= 1) {
      const operation = valid[index];
      const localDirectoryDelete = operation.type === 'deleteLocal' && operation.expectedLocal?.kind === 'directory';
      const remoteDirectoryDelete = operation.type === 'deleteRemote' && operation.expectedRemote?.kind === 'directory';
      if (!localDirectoryDelete && !remoteDirectoryDelete) continue;

      const prefix = `${operation.relativePath.replace(/\/+$/, '')}/`;
      const dependent = stale.find(item =>
        item.operation.type === operation.type
        && item.operation.relativePath.startsWith(prefix)
      );
      if (!dependent) continue;

      valid.splice(index, 1);
      stale.push({
        operation,
        reason: `Directory delete deferred because descendant '${dependent.operation.relativePath}' changed after the sync plan was created.`
      });
      changed = true;
    }
  }
}


/** If the directory root itself changed, none of the descendant deletes that
 * were expanded from that root may continue. This is the inverse dependency of
 * cascadeStaleDirectoryDeletes(): stale children block the parent, and a stale
 * parent blocks every generated child. */
function cascadeStaleDirectoryDeleteDescendants(
  valid: SyncOperation[],
  stale: Array<{ operation: SyncOperation; reason: string }>
): void {
  if (!valid.length || !stale.length) return;
  const staleDirectories = stale
    .map(item => item.operation)
    .filter(operation => (operation.type === 'deleteLocal' && operation.expectedLocal?.kind === 'directory')
      || (operation.type === 'deleteRemote' && operation.expectedRemote?.kind === 'directory'));
  if (!staleDirectories.length) return;

  for (let index = valid.length - 1; index >= 0; index -= 1) {
    const operation = valid[index];
    const ancestor = staleDirectories.find(directory =>
      directory.type === operation.type
      && operation.relativePath.startsWith(`${directory.relativePath.replace(/\/+$/, '')}/`)
    );
    if (!ancestor) continue;
    valid.splice(index, 1);
    stale.push({
      operation,
      reason: `Delete deferred because ancestor directory '${ancestor.relativePath}' changed after the sync plan was created.`
    });
  }
}
