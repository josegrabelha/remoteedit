import * as fs from 'fs/promises';
import * as path from 'path';
import type { WorkspaceSyncRemoteSession } from '../connection/WorkspaceSyncSession';
import { safeLocalPath } from '../scan/LocalScanner';
import { joinRemotePath } from '../scan/RemoteScanner';

/**
 * Refuses to traverse symlink/non-directory ancestors below the configured
 * Local root. Lexical root checks alone are insufficient because a directory
 * can be replaced by a symlink after Preview and redirect a write/delete
 * outside the mapping.
 */
export async function assertLocalPathAncestorsSafe(localRoot: string, relativePath: string): Promise<void> {
  const normalized = normalizedSegments(relativePath);
  safeLocalPath(localRoot, relativePath); // lexical traversal guard
  let current = path.resolve(localRoot);
  for (const segment of normalized.slice(0, -1)) {
    current = path.join(current, segment);
    let stat: import('fs').Stats;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Workspace Sync blocked '${relativePath}' because Local ancestor '${segment}' is a symbolic link.`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Workspace Sync blocked '${relativePath}' because a Local ancestor is not a directory.`);
    }
  }
}

/**
 * Same containment rule for Remote paths. The mapping root itself is trusted
 * (it may intentionally be a server-managed symlink such as /var/www/current),
 * but Workspace Sync never traverses a symlink discovered below that root.
 */
export async function assertRemotePathAncestorsSafe(
  session: WorkspaceSyncRemoteSession,
  remoteRoot: string,
  relativePath: string
): Promise<void> {
  const segments = normalizedSegments(relativePath);
  let prefix = '';
  for (const segment of segments.slice(0, -1)) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    const remotePath = joinRemotePath(remoteRoot, prefix);
    const stat = await session.stat(remotePath);
    if (!stat) return;
    if (stat.kind === 'link') {
      throw new Error(`Workspace Sync blocked '${relativePath}' because Remote ancestor '${prefix}' is a symbolic link.`);
    }
    if (stat.kind !== 'directory') {
      throw new Error(`Workspace Sync blocked '${relativePath}' because Remote ancestor '${prefix}' is not a directory.`);
    }
  }
}

export async function assertLocalRegularFile(filePath: string, relativePath: string): Promise<void> {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Workspace Sync upload source '${relativePath}' is no longer a regular file.`);
  }
}

function normalizedSegments(relativePath: string): string[] {
  const value = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = value.split('/').filter(Boolean);
  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error(`Workspace Sync path escapes or ambiguously addresses the mapping root: ${relativePath}`);
  }
  return segments;
}
