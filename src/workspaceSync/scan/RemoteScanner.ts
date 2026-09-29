import type { SnapshotEntry, SyncSnapshot, WorkspaceSyncEntryKind } from '../types';
import { canonicalRelativePath, createSyncSnapshot, normalizeRelativePath } from '../snapshot/SyncSnapshot';
import { IgnoreMatcher } from '../ignore/IgnoreMatcher';
import type { WorkspaceSyncRemoteEntry, WorkspaceSyncRemoteSession } from '../connection/WorkspaceSyncSession';
import { assertSafeSyncPathSegment } from './PathSegment';

export interface RemoteScanOptions {
  ignorePatterns?: string[];
  concurrency?: number;
  cancellationToken?: { readonly isCancellationRequested: boolean };
  onProgress?: (scanned: number, relativePath: string) => void;
}

export async function scanRemoteTree(
  session: WorkspaceSyncRemoteSession,
  remoteRoot: string,
  options: RemoteScanOptions = {}
): Promise<SyncSnapshot> {
  const matcher = new IgnoreMatcher(options.ignorePatterns || []);
  const queue: string[] = [''];
  const entries: SnapshotEntry[] = [];
  const incompletePaths: string[] = [];
  let scanned = 0;
  const concurrency = Math.max(1, Math.min(16, Math.floor(options.concurrency || 6)));

  while (queue.length) {
    throwIfCancelled(options.cancellationToken);
    const batch = queue.splice(0, concurrency);
    const discovered = await Promise.all(batch.map(async relativeDir => {
      const childDirectories: string[] = [];
      const remoteDir = joinRemotePath(remoteRoot, relativeDir);
      let children: WorkspaceSyncRemoteEntry[];
      try {
        children = await session.list(remoteDir);
      } catch (error) {
        if (!relativeDir) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Workspace Sync cannot scan Remote root '${remoteRoot}': ${message}`);
        }
        incompletePaths.push(relativeDir);
        return childDirectories;
      }

      // list() already returns the metadata needed for the Refresh snapshot.
      // Deliberately do not stat every child: that would add one remote
      // round-trip per entry and becomes prohibitively slow on large trees.
      for (const child of children) {
        throwIfCancelled(options.cancellationToken);
        if (!child.name || child.name === '.' || child.name === '..') {
          continue;
        }
        assertSafeSyncPathSegment(child.name, 'Remote');
        const physicalRelativePath = normalizeRelativePath(relativeDir ? `${relativeDir}/${child.name}` : child.name);
        const relativePath = canonicalRelativePath(physicalRelativePath);
        if (matcher.ignores(relativePath, child.kind === 'directory')) {
          continue;
        }
        entries.push({
          relativePath,
          physicalRelativePath,
          fingerprint: {
            kind: child.kind,
            size: child.size,
            mtimeMs: child.mtimeMs
          }
        });
        scanned += 1;
        options.onProgress?.(scanned, relativePath);
        if (child.kind === 'directory') {
          childDirectories.push(physicalRelativePath);
        }
      }
      return childDirectories;
    }));
    for (const childDirectories of discovered) {
      queue.push(...childDirectories);
    }
  }

  return createSyncSnapshot(entries, incompletePaths);
}

export function joinRemotePath(root: string, relativePath: string): string {
  const normalizedRoot = normalizeRemoteRootForJoin(root);
  const normalizedRelative = normalizeRelativePath(relativePath);
  if (!normalizedRelative) {
    return normalizedRoot;
  }
  if (normalizedRelative.split('/').some(segment => segment === '..')) {
    throw new Error(`Remote path escapes the mapping root: ${relativePath}`);
  }
  if (normalizedRoot === '/') {
    return `/${normalizedRelative}`;
  }
  if (normalizedRoot.endsWith('/')) {
    return `${normalizedRoot}${normalizedRelative}`;
  }
  return `${normalizedRoot}/${normalizedRelative}`;
}

function normalizeRemoteRootForJoin(value: string): string {
  let normalized = String(value || '/').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (/^\/?[A-Za-z]:\/$/.test(normalized)) return normalized;
  normalized = normalized.replace(/\/+$/, '');
  return normalized || '/';
}

export function normalizeRemoteEntryKind(value: unknown): WorkspaceSyncEntryKind {
  const type = String(value || '').toLowerCase();
  if (type === 'd' || type === 'directory') return 'directory';
  if (type === 'l' || type === 'link' || type === 'symlink') return 'link';
  if (type === '-' || type === 'file') return 'file';
  return 'unknown';
}

function throwIfCancelled(token?: { readonly isCancellationRequested: boolean }): void {
  if (token?.isCancellationRequested) {
    throw new Error('Workspace Sync scan cancelled.');
  }
}
