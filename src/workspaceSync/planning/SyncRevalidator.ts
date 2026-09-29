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
  return { valid, stale };
}
