import type { SyncBaseline, SyncSnapshot } from '../types';
import { fingerprintsEqual } from '../snapshot/FileFingerprint';

export function buildConservativeBaseline(
  mappingId: string,
  targetId: string,
  local: SyncSnapshot,
  remote: SyncSnapshot,
  previous?: SyncBaseline
): SyncBaseline {
  const entries: SyncBaseline['entries'] = {};
  const paths = new Set([
    ...Object.keys(local.entries),
    ...Object.keys(remote.entries),
    ...Object.keys(previous?.entries || {})
  ]);

  for (const relativePath of paths) {
    const localFingerprint = local.entries[relativePath]?.fingerprint;
    const remoteFingerprint = remote.entries[relativePath]?.fingerprint;
    if (!localFingerprint && !remoteFingerprint) continue;
    if (localFingerprint && remoteFingerprint && fingerprintsEqual(localFingerprint, remoteFingerprint)) {
      entries[relativePath] = {
        local: localFingerprint,
        remote: remoteFingerprint,
        localRelativePath: local.entries[relativePath]?.physicalRelativePath,
        remoteRelativePath: remote.entries[relativePath]?.physicalRelativePath
      };
      continue;
    }
    const previousEntry = previous?.entries[relativePath];
    if (previousEntry) entries[relativePath] = previousEntry;
  }

  return { mappingId, targetId, capturedAt: Date.now(), entries };
}
