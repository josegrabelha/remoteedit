import type { SnapshotEntry, SyncSnapshot } from '../types';

export function createSyncSnapshot(
  entries: Iterable<SnapshotEntry>,
  incompletePaths: string[] = [],
  incompleteErrors: Record<string, string> = {}
): SyncSnapshot {
  const byPath: Record<string, SnapshotEntry> = {};
  const physicalByCanonical = new Map<string, string>();

  for (const entry of entries) {
    const physicalRelativePath = normalizeRelativePath(entry.physicalRelativePath || entry.relativePath);
    const relativePath = canonicalRelativePath(entry.relativePath || physicalRelativePath);
    const previousPhysical = physicalByCanonical.get(relativePath);
    if (previousPhysical !== undefined && previousPhysical !== physicalRelativePath) {
      throw new Error(
        `Workspace Sync found multiple paths that differ only by Unicode normalization: '${previousPhysical}' and '${physicalRelativePath}'. Rename one of them before syncing.`
      );
    }
    physicalByCanonical.set(relativePath, physicalRelativePath);
    byPath[relativePath] = {
      ...entry,
      relativePath,
      physicalRelativePath
    };
  }
  return {
    capturedAt: Date.now(),
    entries: byPath,
    incompletePaths: [...new Set(incompletePaths.map(canonicalRelativePath))],
    ...(Object.keys(incompleteErrors).length
      ? { incompleteErrors: Object.fromEntries(Object.entries(incompleteErrors).map(([key, detail]) => [canonicalRelativePath(key), detail])) }
      : {})
  };
}

/** Normalizes separators only; preserves the exact Unicode spelling for I/O. */
export function normalizeRelativePath(value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  return normalized === '.' ? '' : normalized;
}

/** Canonical logical path identity shared by Local and Remote. */
export function canonicalRelativePath(value: string): string {
  return normalizeRelativePath(value).normalize('NFC');
}
