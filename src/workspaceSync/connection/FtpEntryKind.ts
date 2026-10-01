import type { WorkspaceSyncEntryKind } from '../types';

/** FTP listings are not guaranteed to describe every filesystem object.
 * basic-ftp FileInfo exposes type 1=file, 2=directory, 3=symlink, 0=unknown;
 * never assume that "not directory" means "regular file". */
export function classifyFtpEntry(entry: {
  type?: unknown;
  isFile?: boolean;
  isDirectory?: boolean;
  isSymbolicLink?: boolean;
}): WorkspaceSyncEntryKind {
  if (entry.isSymbolicLink === true || entry.type === 3) return 'link';
  if (entry.isDirectory === true || entry.type === 2) return 'directory';
  if (entry.isFile === true || entry.type === 1) return 'file';
  return 'unknown';
}
