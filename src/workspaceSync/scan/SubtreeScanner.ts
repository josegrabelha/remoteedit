import * as fs from 'fs/promises';
import type { SnapshotEntry, SyncSnapshot } from '../types';
import type { WorkspaceSyncRemoteEntry, WorkspaceSyncRemoteSession } from '../connection/WorkspaceSyncSession';
import { IgnoreMatcher } from '../ignore/IgnoreMatcher';
import { canonicalRelativePath, createSyncSnapshot, normalizeRelativePath } from '../snapshot/SyncSnapshot';
import { classifyLocalStat } from './LocalEntryKind';
import { safeLocalPath, scanLocalTree } from './LocalScanner';
import { joinRemotePath, scanRemoteTree } from './RemoteScanner';

export interface SubtreeScanOptions {
  ignorePatterns?: string[];
  concurrency?: number;
  cancellationToken?: { readonly isCancellationRequested: boolean };
}

/**
 * Scan one Local subtree while keeping paths relative to the mapping root.
 * Hidden entries are ordinary filesystem entries; only explicit ignore rules
 * remove them from the returned snapshot.
 */
export async function scanLocalSubtree(
  mappingRoot: string,
  logicalRoot: string,
  physicalRoot = logicalRoot,
  options: SubtreeScanOptions = {}
): Promise<SyncSnapshot> {
  const logical = canonicalRelativePath(logicalRoot);
  const physical = normalizeRelativePath(physicalRoot || logicalRoot);
  const absolute = safeLocalPath(mappingRoot, physical);
  let stat: import('fs').Stats;
  try {
    stat = await fs.lstat(absolute);
  } catch (error) {
    if (isMissing(error)) return createSyncSnapshot([]);
    return createSyncSnapshot([], logical ? [logical] : [''], logical ? { [logical]: errorCode(error) } : { '': errorCode(error) });
  }

  const matcher = new IgnoreMatcher(options.ignorePatterns || []);
  const entries: SnapshotEntry[] = [];
  const rootKind = classifyLocalStat(stat);
  if (!logical || !matcher.ignores(logical, rootKind.kind === 'directory')) {
    entries.push({
      relativePath: logical,
      physicalRelativePath: physical,
      fingerprint: {
        kind: rootKind.kind,
        ...(rootKind.specialType ? { specialType: rootKind.specialType } : {}),
        size: stat.size,
        mtimeMs: stat.mtimeMs
      }
    });
  }
  if (rootKind.kind !== 'directory') return createSyncSnapshot(entries);

  let nested: SyncSnapshot;
  try {
    nested = await scanLocalTree(absolute, {
      ignorePatterns: [],
      concurrency: options.concurrency,
      cancellationToken: options.cancellationToken
    });
  } catch (error) {
    if (isMissing(error)) return createSyncSnapshot(entries);
    const key = logical || '';
    return createSyncSnapshot(entries, [key], { [key]: errorCode(error) });
  }

  for (const entry of Object.values(nested.entries)) {
    const fullPhysical = normalizeRelativePath(physical ? `${physical}/${entry.physicalRelativePath || entry.relativePath}` : (entry.physicalRelativePath || entry.relativePath));
    const fullLogical = canonicalRelativePath(logical ? `${logical}/${entry.relativePath}` : entry.relativePath);
    if (matcher.ignores(fullLogical, entry.fingerprint.kind === 'directory')) continue;
    entries.push({ ...entry, relativePath: fullLogical, physicalRelativePath: fullPhysical, fingerprint: { ...entry.fingerprint } });
  }

  const incompletePaths = nested.incompletePaths.map(candidate => canonicalRelativePath(logical ? `${logical}/${candidate}` : candidate));
  const incompleteErrors = Object.fromEntries(Object.entries(nested.incompleteErrors || {}).map(([candidate, detail]) => [
    canonicalRelativePath(logical ? `${logical}/${candidate}` : candidate), detail
  ]));
  return createSyncSnapshot(entries, incompletePaths, incompleteErrors);
}

/** Scan one Remote subtree while keeping paths relative to target.remoteRoot. */
export async function scanRemoteSubtree(
  session: WorkspaceSyncRemoteSession,
  remoteRoot: string,
  logicalRoot: string,
  physicalRoot = logicalRoot,
  options: SubtreeScanOptions = {}
): Promise<SyncSnapshot> {
  const logical = canonicalRelativePath(logicalRoot);
  const physical = normalizeRelativePath(physicalRoot || logicalRoot);
  const absolute = joinRemotePath(remoteRoot, physical);
  let stat: WorkspaceSyncRemoteEntry | undefined;
  try {
    stat = await session.stat(absolute);
  } catch (error) {
    const key = logical || '';
    return createSyncSnapshot([], [key], { [key]: errorCode(error) });
  }
  if (!stat) return createSyncSnapshot([]);

  const matcher = new IgnoreMatcher(options.ignorePatterns || []);
  const entries: SnapshotEntry[] = [];
  if (!logical || !matcher.ignores(logical, stat.kind === 'directory')) {
    entries.push({
      relativePath: logical,
      physicalRelativePath: physical,
      fingerprint: { kind: stat.kind, size: stat.size, mtimeMs: stat.mtimeMs }
    });
  }
  if (stat.kind !== 'directory') return createSyncSnapshot(entries);

  let nested: SyncSnapshot;
  try {
    nested = await scanRemoteTree(session, absolute, {
      ignorePatterns: [],
      concurrency: options.concurrency,
      cancellationToken: options.cancellationToken
    });
  } catch (error) {
    const key = logical || '';
    return createSyncSnapshot(entries, [key], { [key]: errorCode(error) });
  }

  for (const entry of Object.values(nested.entries)) {
    const fullPhysical = normalizeRelativePath(physical ? `${physical}/${entry.physicalRelativePath || entry.relativePath}` : (entry.physicalRelativePath || entry.relativePath));
    const fullLogical = canonicalRelativePath(logical ? `${logical}/${entry.relativePath}` : entry.relativePath);
    if (matcher.ignores(fullLogical, entry.fingerprint.kind === 'directory')) continue;
    entries.push({ ...entry, relativePath: fullLogical, physicalRelativePath: fullPhysical, fingerprint: { ...entry.fingerprint } });
  }
  const incompletePaths = nested.incompletePaths.map(candidate => canonicalRelativePath(logical ? `${logical}/${candidate}` : candidate));
  const incompleteErrors = Object.fromEntries(Object.entries(nested.incompleteErrors || {}).map(([candidate, detail]) => [
    canonicalRelativePath(logical ? `${logical}/${candidate}` : candidate), detail
  ]));
  return createSyncSnapshot(entries, incompletePaths, incompleteErrors);
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException | undefined)?.code || (error instanceof Error ? error.message : String(error));
}
