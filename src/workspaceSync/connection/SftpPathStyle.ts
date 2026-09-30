export type WorkspaceSyncSftpPathStyle = 'posix' | 'windowsDrive' | 'windowsSlashDrive';

export function inferSftpPathStyle(cwd: string): WorkspaceSyncSftpPathStyle {
  const normalized = String(cwd || '').replace(/\\/g, '/');
  if (/^\/[A-Za-z]:\//.test(normalized)) return 'windowsSlashDrive';
  if (/^[A-Za-z]:\//.test(normalized)) return 'windowsDrive';
  return 'posix';
}

export function adaptSftpPath(remotePath: string, style: WorkspaceSyncSftpPathStyle): string {
  let normalized = String(remotePath || '/').replace(/\\/g, '/');
  if (style === 'windowsSlashDrive' && /^[A-Za-z]:\//.test(normalized)) {
    normalized = `/${normalized}`;
  } else if (style === 'windowsDrive' && /^\/[A-Za-z]:\//.test(normalized)) {
    normalized = normalized.slice(1);
  }
  return normalized || '/';
}
