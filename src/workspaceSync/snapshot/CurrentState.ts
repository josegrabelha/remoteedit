import * as fs from 'fs/promises';
import type { FileFingerprint } from '../types';
import { hashLocalFile } from './FileFingerprint';
import type { WorkspaceSyncRemoteSession } from '../connection/WorkspaceSyncSession';

export async function readLocalFingerprint(filePath: string, includeHash = false): Promise<FileFingerprint | undefined> {
  try {
    const stat = await fs.lstat(filePath);
    const fingerprint: FileFingerprint = {
      kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'link' : 'unknown',
      size: stat.size,
      mtimeMs: stat.mtimeMs
    };
    if (includeHash && fingerprint.kind === 'file') fingerprint.hash = await hashLocalFile(filePath);
    return fingerprint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function readRemoteFingerprint(
  session: WorkspaceSyncRemoteSession,
  remotePath: string,
  includeHash = false
): Promise<FileFingerprint | undefined> {
  const entry = await session.stat(remotePath);
  if (!entry) return undefined;
  const fingerprint: FileFingerprint = { kind: entry.kind, size: entry.size, mtimeMs: entry.mtimeMs };
  if (includeHash && fingerprint.kind === 'file') fingerprint.hash = await session.hashFile(remotePath);
  return fingerprint;
}
