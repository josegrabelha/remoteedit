import type { FileFingerprint, SyncSnapshot } from '../types';

/**
 * Compares consecutive snapshots of the same remote endpoint. Remote-to-remote
 * comparison deliberately uses raw metadata rather than Local/Remote mtime
 * semantics: size + mtime are stable enough to detect candidate file changes,
 * and the controller revalidates/hash-checks a candidate before changing Local.
 */
export function collectRemoteWatchChangedPaths(previous: SyncSnapshot, current: SyncSnapshot): string[] {
  const paths = new Set([...Object.keys(previous.entries), ...Object.keys(current.entries)]);
  return [...paths]
    .filter(relativePath => !sameRemoteWatchFingerprint(
      previous.entries[relativePath]?.fingerprint,
      current.entries[relativePath]?.fingerprint
    ))
    .sort((a, b) => a.localeCompare(b));
}

export function sameRemoteWatchFingerprint(
  previous: FileFingerprint | undefined,
  current: FileFingerprint | undefined
): boolean {
  if (!previous || !current) return previous === current;
  if (previous.kind !== current.kind) return false;
  // Directory mtime commonly changes when a child changes. Child paths are
  // scanned recursively and carry the meaningful change signal themselves.
  if (previous.kind === 'directory') return true;
  return previous.size === current.size && previous.mtimeMs === current.mtimeMs;
}
