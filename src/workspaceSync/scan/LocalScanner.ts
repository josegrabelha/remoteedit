import * as fs from 'fs/promises';
import * as path from 'path';
import type { SnapshotEntry, SyncSnapshot } from '../types';
import { canonicalRelativePath, createSyncSnapshot, normalizeRelativePath } from '../snapshot/SyncSnapshot';
import { IgnoreMatcher } from '../ignore/IgnoreMatcher';
import { assertSafeSyncPathSegment } from './PathSegment';

export interface LocalScanOptions {
  ignorePatterns?: string[];
  concurrency?: number;
  cancellationToken?: { readonly isCancellationRequested: boolean };
  onProgress?: (scanned: number, relativePath: string) => void;
}

export async function scanLocalTree(root: string, options: LocalScanOptions = {}): Promise<SyncSnapshot> {
  const absoluteRoot = path.resolve(root);
  await assertLocalRootIsDirectory(absoluteRoot);
  const matcher = new IgnoreMatcher(options.ignorePatterns || []);
  const queue: string[] = [''];
  const entries: SnapshotEntry[] = [];
  const incompletePaths: string[] = [];
  let scanned = 0;
  const concurrency = Math.max(1, Math.min(32, Math.floor(options.concurrency || 8)));

  while (queue.length) {
    throwIfCancelled(options.cancellationToken);
    const batch = queue.splice(0, concurrency);
    const discovered = await Promise.all(batch.map(async relativeDir => {
      const childDirectories: string[] = [];
      const absoluteDir = safeLocalPath(absoluteRoot, relativeDir);
      let children: import('fs').Dirent[];
      try {
        children = await fs.readdir(absoluteDir, { withFileTypes: true });
      } catch (error) {
        if (!relativeDir) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Workspace Sync cannot scan Local root '${absoluteRoot}': ${message}`);
        }
        incompletePaths.push(relativeDir);
        return childDirectories;
      }

      for (const child of children) {
        throwIfCancelled(options.cancellationToken);
        assertSafeSyncPathSegment(child.name, 'Local');
        const physicalRelativePath = normalizeRelativePath(relativeDir ? `${relativeDir}/${child.name}` : child.name);
        const relativePath = canonicalRelativePath(physicalRelativePath);
        const isDirectory = child.isDirectory();
        if (matcher.ignores(relativePath, isDirectory)) {
          continue;
        }

        const absolutePath = safeLocalPath(absoluteRoot, physicalRelativePath);
        try {
          const stat = await fs.lstat(absolutePath);
          const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'link' : 'unknown';
          entries.push({
            relativePath,
            physicalRelativePath,
            fingerprint: {
              kind,
              size: stat.size,
              mtimeMs: stat.mtimeMs
            }
          });
          scanned += 1;
          options.onProgress?.(scanned, relativePath);
          if (kind === 'directory') {
            childDirectories.push(physicalRelativePath);
          }
        } catch {
          incompletePaths.push(relativePath);
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

export function safeLocalPath(root: string, relativePath: string): string {
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Local path escapes the mapping root: ${relativePath}`);
  }
  return resolved;
}

function throwIfCancelled(token?: { readonly isCancellationRequested: boolean }): void {
  if (token?.isCancellationRequested) {
    throw new Error('Workspace Sync scan cancelled.');
  }
}


async function assertLocalRootIsDirectory(absoluteRoot: string): Promise<void> {
  try {
    const stat = await fs.lstat(absoluteRoot);
    if (stat.isSymbolicLink()) {
      throw new Error(`Workspace Sync Local root cannot be a symbolic link: ${absoluteRoot}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Workspace Sync Local root is not a directory: ${absoluteRoot}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Workspace Sync Local root')) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Workspace Sync cannot scan Local root '${absoluteRoot}': ${message}`);
  }
}
