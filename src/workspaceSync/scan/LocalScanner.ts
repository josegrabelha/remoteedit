import * as fs from 'fs/promises';
import * as path from 'path';
import type { SnapshotEntry, SyncSnapshot } from '../types';
import { canonicalRelativePath, createSyncSnapshot, normalizeRelativePath } from '../snapshot/SyncSnapshot';
import { IgnoreMatcher } from '../ignore/IgnoreMatcher';
import { assertSafeSyncPathSegment } from './PathSegment';
import { classifyLocalStat } from './LocalEntryKind';

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
  const incompleteErrors: Record<string, string> = {};
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
        // A directory listed by its parent may disappear before traversal.
        // Confirm that it is really gone instead of keeping a permanent
        // Unknown result for an ephemeral entry. Other errors fail closed.
        if (isMissingPath(error)) {
          throwIfCancelled(options.cancellationToken);
          // The name may now refer to a regular file, symlink or special
          // entry instead of the directory previously returned by readdir.
          // Keep its current type, but never descend into the replacement.
          try {
            const replacement = await fs.lstat(absoluteDir);
            const { kind, specialType } = classifyLocalStat(replacement);
            if (kind !== 'directory') {
              const canonical = canonicalRelativePath(relativeDir);
              const previous = entries.find(entry => entry.relativePath === canonical);
              if (previous) {
                previous.fingerprint = {
                  kind,
                  ...(specialType ? { specialType } : {}),
                  size: replacement.size,
                  mtimeMs: replacement.mtimeMs
                };
              }
              return childDirectories;
            }
          } catch {
            // Only a confirmed disappearance can be omitted. Any other
            // failure remains visible as an incomplete scan below.
          }
          const absent = await confirmMissingChild(path.dirname(absoluteDir), path.basename(absoluteDir), absoluteDir);
          throwIfCancelled(options.cancellationToken);
          if (absent) {
            const canonical = canonicalRelativePath(relativeDir);
            const previousIndex = entries.findIndex(entry => entry.relativePath === canonical);
            if (previousIndex !== -1) entries.splice(previousIndex, 1);
            return childDirectories;
          }
        }
        incompletePaths.push(relativeDir);
        incompleteErrors[canonicalRelativePath(relativeDir)] = scanErrorDetail(error);
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
        let stat: import('fs').Stats;
        try {
          stat = await fs.lstat(absolutePath);
        } catch (error) {
          if (isMissingPath(error)) {
            // Recheck the entry, then confirm it is absent from its parent.
            // A missing entry is not an incomplete scan; a permission or
            // other I/O failure is still an Unknown and must stay visible.
            throwIfCancelled(options.cancellationToken);
            try {
              stat = await fs.lstat(absolutePath);
            } catch (retryError) {
              if (isMissingPath(retryError)) {
                const absent = await confirmMissingChild(absoluteDir, child.name, absolutePath);
                throwIfCancelled(options.cancellationToken);
                if (absent) continue;
              }
              incompletePaths.push(relativePath);
              incompleteErrors[relativePath] = scanErrorDetail(retryError);
              continue;
            }
          } else {
            incompletePaths.push(relativePath);
            incompleteErrors[relativePath] = scanErrorDetail(error);
            continue;
          }
        }
        try {
          const { kind, specialType } = classifyLocalStat(stat);
          entries.push({
            relativePath,
            physicalRelativePath,
            fingerprint: {
              kind,
              ...(specialType ? { specialType } : {}),
              size: stat.size,
              mtimeMs: stat.mtimeMs
            }
          });
          scanned += 1;
          options.onProgress?.(scanned, relativePath);
          if (kind === 'directory') {
            childDirectories.push(physicalRelativePath);
          }
        } catch (error) {
          incompletePaths.push(relativePath);
          incompleteErrors[relativePath] = scanErrorDetail(error);
        }
      }
      return childDirectories;
    }));
    for (const childDirectories of discovered) {
      queue.push(...childDirectories);
    }
  }

  return createSyncSnapshot(entries, incompletePaths, incompleteErrors);
}

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** An extra lstat + parent listing guards against a transient ENOENT race. */
async function confirmMissingChild(parent: string, childName: string, absolutePath: string): Promise<boolean> {
  try {
    await fs.lstat(absolutePath);
    return false;
  } catch (error) {
    if (!isMissingPath(error)) return false;
  }
  try {
    const names = await fs.readdir(parent);
    return !names.includes(childName);
  } catch {
    // An inaccessible parent cannot be mistaken for a confirmed deletion.
    return false;
  }
}

function scanErrorDetail(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && code ? code : error instanceof Error ? error.message : String(error);
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
