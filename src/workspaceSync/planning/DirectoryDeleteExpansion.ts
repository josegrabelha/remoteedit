import * as crypto from 'crypto';
import type { SyncOperation, SyncPlan, WorkspaceSyncMapping, WorkspaceSyncTarget } from '../types';
import type { WorkspaceSyncRemoteSession } from '../connection/WorkspaceSyncSession';
import { fingerprintsEqual } from '../snapshot/FileFingerprint';
import { scanLocalSubtree, scanRemoteSubtree } from '../scan/SubtreeScanner';

/**
 * Expand a directory delete into explicit deepest-first descendant operations.
 * The expansion intentionally ignores Workspace Sync Ignore Patterns: once a
 * directory deletion itself has been approved by the planner, deleting that
 * directory means deleting its complete destination subtree. Hidden/ignored
 * descendants therefore cannot strand the parent with ENOTEMPTY.
 *
 * The executor still uses non-recursive directory removal. New content that
 * appears after this manifest is captured is never in the plan and causes the
 * final rmdir/deleteDirectory to fail closed instead of being erased.
 */
export async function expandDirectoryDeletePlan(
  mapping: WorkspaceSyncMapping,
  target: WorkspaceSyncTarget,
  plan: SyncPlan,
  session: WorkspaceSyncRemoteSession,
  cancellationToken?: { readonly isCancellationRequested: boolean }
): Promise<SyncPlan> {
  const operations = [...plan.operations];
  const byKey = new Map(operations.map(operation => [`${operation.type}:${operation.relativePath}`, operation]));
  const roots = operations.filter(operation => isDirectoryDelete(operation))
    .filter(operation => !operations.some(candidate => candidate !== operation
      && candidate.type === operation.type
      && isDirectoryDelete(candidate)
      && operation.relativePath.startsWith(`${candidate.relativePath.replace(/\/+$/, '')}/`)))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const root of roots) {
    if (cancellationToken?.isCancellationRequested) throw new Error('Workspace Sync operation cancelled.');
    if (root.type === 'deleteLocal') {
      const snapshot = await scanLocalSubtree(
        mapping.localRoot,
        root.relativePath,
        root.localRelativePath || root.relativePath,
        { ignorePatterns: [], cancellationToken }
      );
      const currentRoot = snapshot.entries[root.relativePath]?.fingerprint;
      if (!fingerprintsEqual(currentRoot, root.expectedLocal, { mtimeReliable: true, requireHashWhenAvailable: Boolean(root.expectedLocal?.hash) })) {
        continue;
      }
      for (const entry of Object.values(snapshot.entries)) {
        if (entry.relativePath === root.relativePath) continue;
        const key = `deleteLocal:${entry.relativePath}`;
        if (byKey.has(key)) continue;
        const operation: SyncOperation = {
          id: `delete-tree-${crypto.randomUUID()}`,
          type: 'deleteLocal',
          relativePath: entry.relativePath,
          localRelativePath: entry.physicalRelativePath || entry.relativePath,
          remoteRelativePath: entry.relativePath,
          reason: `Remote directory deletion includes '${root.relativePath}'.`,
          expectedLocal: entry.fingerprint,
          expectedRemote: undefined
        };
        operations.push(operation);
        byKey.set(key, operation);
      }
    } else if (root.type === 'deleteRemote') {
      const snapshot = await scanRemoteSubtree(
        session,
        target.remoteRoot,
        root.relativePath,
        root.remoteRelativePath || root.relativePath,
        { ignorePatterns: [], concurrency: session.capabilities.maxConcurrentMetadata, cancellationToken }
      );
      const currentRoot = snapshot.entries[root.relativePath]?.fingerprint;
      if (!fingerprintsEqual(currentRoot, root.expectedRemote, {
        mtimeReliable: session.capabilities.reliableMtime,
        requireHashWhenAvailable: Boolean(root.expectedRemote?.hash)
      })) {
        continue;
      }
      for (const entry of Object.values(snapshot.entries)) {
        if (entry.relativePath === root.relativePath) continue;
        const key = `deleteRemote:${entry.relativePath}`;
        if (byKey.has(key)) continue;
        const operation: SyncOperation = {
          id: `delete-tree-${crypto.randomUUID()}`,
          type: 'deleteRemote',
          relativePath: entry.relativePath,
          localRelativePath: entry.relativePath,
          remoteRelativePath: entry.physicalRelativePath || entry.relativePath,
          reason: `Local directory deletion includes '${root.relativePath}'.`,
          expectedLocal: undefined,
          expectedRemote: entry.fingerprint
        };
        operations.push(operation);
        byKey.set(key, operation);
      }
    }
  }

  return operations.length === plan.operations.length ? plan : { ...plan, operations };
}

function isDirectoryDelete(operation: SyncOperation): boolean {
  return operation.type === 'deleteLocal'
    ? operation.expectedLocal?.kind === 'directory'
    : operation.type === 'deleteRemote'
      ? operation.expectedRemote?.kind === 'directory'
      : false;
}
