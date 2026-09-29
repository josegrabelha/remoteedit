import type { DiffEntry, SyncSnapshot, WorkspaceSyncDirection } from '../types';

export interface PathCollisionOptions {
  direction: WorkspaceSyncDirection;
  localCaseSensitive?: boolean;
  remoteCaseSensitive?: boolean;
}

/**
 * Protects sync plans from path aliases on case-insensitive or unknown target
 * filesystems. A compare can otherwise see `Readme.md` and `README.md` as two
 * independent paths even though the destination may resolve them to the same
 * object. We fail closed only when a side that may receive data cannot be
 * proven case-sensitive.
 */
export function protectCaseCollisions(
  diffs: DiffEntry[],
  local: SyncSnapshot,
  remote: SyncSnapshot,
  options: PathCollisionOptions
): DiffEntry[] {
  const localCaseSensitive = inferSnapshotCaseSensitivity(local, options.localCaseSensitive);
  const remoteCaseSensitive = inferSnapshotCaseSensitivity(remote, options.remoteCaseSensitive);
  const remoteIsDestination = options.direction === 'localToRemote' || options.direction === 'bidirectional';
  const localIsDestination = options.direction === 'remoteToLocal' || options.direction === 'bidirectional';

  if ((!remoteIsDestination || remoteCaseSensitive === true)
    && (!localIsDestination || localCaseSensitive === true)) {
    return diffs;
  }

  const localPaths = new Set(Object.keys(local.entries));
  const remotePaths = new Set(Object.keys(remote.entries));
  const groups = buildCollisionGroups([...localPaths, ...remotePaths]);
  if (!groups.size) return diffs;

  const unsafe = new Map<string, string>();
  for (const paths of groups.values()) {
    const sourceCanCollideOnRemote = remoteIsDestination
      && remoteCaseSensitive !== true
      && paths.some(relativePath => localPaths.has(relativePath));
    const sourceCanCollideOnLocal = localIsDestination
      && localCaseSensitive !== true
      && paths.some(relativePath => remotePaths.has(relativePath));
    if (!sourceCanCollideOnRemote && !sourceCanCollideOnLocal) continue;

    const sides: string[] = [];
    if (sourceCanCollideOnLocal) sides.push(localCaseSensitive === false ? 'Local filesystem is case-insensitive' : 'Local filesystem case sensitivity is unknown');
    if (sourceCanCollideOnRemote) sides.push(remoteCaseSensitive === false ? 'Remote filesystem is case-insensitive' : 'Remote filesystem case sensitivity is unknown');
    const reason = `Paths differ only by letter case (${paths.join(', ')}). ${sides.join('; ')}. Resolve the naming collision before syncing.`;
    for (const relativePath of paths) unsafe.set(relativePath, reason);
  }

  if (!unsafe.size) return diffs;
  return diffs.map(diff => {
    const reason = unsafe.get(diff.relativePath);
    if (!reason) return diff;
    return {
      ...diff,
      status: 'conflict',
      reason
    };
  });
}

/**
 * Distinct paths that differ only by case are direct evidence that the scanned
 * filesystem can represent both names. This lets us avoid false conflicts on
 * case-sensitive filesystems even when the protocol could not report the
 * capability explicitly.
 */
export function inferSnapshotCaseSensitivity(
  snapshot: SyncSnapshot,
  fallback?: boolean
): boolean | undefined {
  return buildCollisionGroups(Object.keys(snapshot.entries)).size ? true : fallback;
}

/**
 * Node does not expose filesystem case-sensitivity portably. Windows is
 * case-insensitive and the default macOS filesystems are case-insensitive; we
 * therefore choose the conservative value on those platforms. A case-sensitive
 * macOS volume will only see an extra conflict when it actually contains a
 * case-only naming collision.
 */
export function defaultLocalCaseSensitivity(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32' && platform !== 'darwin';
}

function buildCollisionGroups(paths: Iterable<string>): Map<string, string[]> {
  const grouped = new Map<string, Set<string>>();
  for (const relativePath of paths) {
    const normalized = String(relativePath || '').replace(/\\/g, '/').normalize('NFC');
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    let values = grouped.get(key);
    if (!values) {
      values = new Set<string>();
      grouped.set(key, values);
    }
    values.add(relativePath);
  }

  const collisions = new Map<string, string[]>();
  for (const [key, values] of grouped) {
    if (values.size > 1) collisions.set(key, [...values].sort((a, b) => a.localeCompare(b)));
  }
  return collisions;
}
