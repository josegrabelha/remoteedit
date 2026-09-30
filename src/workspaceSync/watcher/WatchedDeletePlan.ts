import type { SyncBaseline } from '../types';

/**
 * Returns only paths that were mirrored on both sides in the trusted baseline.
 * Remote-only descendants are intentionally excluded so a local directory
 * deletion can never erase content that Workspace Sync did not previously own
 * on the Local side.
 */
export function collectWatchedDeletePaths(
  baseline: SyncBaseline,
  relativePath: string
): string[] {
  const root = baseline.entries[relativePath];
  if (!root?.local || !root.remote) return [];
  if (root.local.kind !== 'directory') return [relativePath];

  const prefix = `${relativePath.replace(/\/+$/, '')}/`;
  return Object.entries(baseline.entries)
    .filter(([candidate, entry]) =>
      (candidate === relativePath || candidate.startsWith(prefix))
      && Boolean(entry.local)
      && Boolean(entry.remote)
    )
    .map(([candidate]) => candidate)
    .sort((a, b) => {
      const depth = b.split('/').length - a.split('/').length;
      return depth || b.localeCompare(a);
    });
}
