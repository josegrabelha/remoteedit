import type { WorkspaceSyncEntryKind, FileFingerprint } from '../types';

/** Uses Node's platform-neutral lstat flags. Reparse points / junctions on
 * Windows are not followed, and Unix sockets/FIFOs/devices are non-transferable. */
export function classifyLocalStat(stat: {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  isSocket(): boolean;
  isFIFO(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
}): Pick<FileFingerprint, 'kind' | 'specialType'> {
  let kind: WorkspaceSyncEntryKind;
  if (stat.isSymbolicLink()) kind = 'link';
  else if (stat.isDirectory()) kind = 'directory';
  else if (stat.isFile()) kind = 'file';
  else kind = 'unknown';
  if (kind !== 'unknown') return { kind };
  const specialType = stat.isSocket() ? 'socket' as const
    : stat.isFIFO() ? 'fifo' as const
      : (stat.isBlockDevice() || stat.isCharacterDevice()) ? 'device' as const
        : 'other' as const;
  return { kind, specialType };
}
