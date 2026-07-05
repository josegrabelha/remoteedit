import { isWindowsRemotePlatform, normalizeRemotePlatform, type RemotePlatform } from './RemotePlatform';

export type WindowsSftpPathStyle = 'slashDrive' | 'drive';

export function normalizeRemotePathForPlatform(remotePath: string | undefined, platform: RemotePlatform | string | undefined): string {
  return isWindowsRemotePlatform(platform)
    ? normalizeWindowsRemotePath(remotePath)
    : normalizePosixRemotePath(remotePath);
}

export function normalizePosixRemotePath(remotePath: string | undefined): string {
  const trimmed = String(remotePath || '/').trim();

  if (!trimmed || trimmed === '.') {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+/g, '/').replace(/\/\/$/, '') || '/';
}

export function normalizeWindowsRemotePath(remotePath: string | undefined): string {
  let text = String(remotePath || '/').trim().replace(/\\/g, '/');

  if (!text || text === '.') {
    return '/';
  }

  text = text.replace(/\/+/g, '/');

  const driveMatch = text.match(/^\/?([A-Za-z]):(?:\/(.*))?$/);
  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase();
    const rest = String(driveMatch[2] || '').replace(/^\/+|\/+$/g, '');
    return rest ? `/${drive}:/${rest}` : `/${drive}:`;
  }

  if (/^[A-Za-z]:\//.test(text)) {
    text = `/${text.charAt(0).toUpperCase()}:${text.slice(2)}`;
  } else if (!text.startsWith('/')) {
    text = `/${text}`;
  }

  text = text.replace(/\/+/g, '/');
  if (text.length > 1) {
    text = text.replace(/\/+$/g, '');
  }

  return text || '/';
}

export function joinRemotePathForPlatform(parent: string, child: string, platform: RemotePlatform | string | undefined): string {
  const normalizedParent = normalizeRemotePathForPlatform(parent, platform);
  const childText = String(child || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

  if (!childText) {
    return normalizedParent;
  }

  if (normalizedParent === '/') {
    return normalizeRemotePathForPlatform(`/${childText}`, platform);
  }

  return normalizeRemotePathForPlatform(`${normalizedParent}/${childText}`, platform);
}

export function dirnameRemotePathForPlatform(remotePath: string, platform: RemotePlatform | string | undefined): string {
  const normalizedPath = normalizeRemotePathForPlatform(remotePath, platform);

  if (normalizedPath === '/') {
    return '/';
  }

  const index = normalizedPath.lastIndexOf('/');
  return index <= 0 ? '/' : normalizedPath.slice(0, index);
}

export function basenameRemotePathForPlatform(remotePath: string, platform: RemotePlatform | string | undefined): string {
  const normalizedPath = normalizeRemotePathForPlatform(remotePath, platform);

  if (normalizedPath === '/') {
    return '/';
  }

  return normalizedPath.split('/').filter(Boolean).pop() || normalizedPath;
}

export function toWindowsSftpPath(canonicalPath: string, style: WindowsSftpPathStyle): string {
  const normalized = normalizeWindowsRemotePath(canonicalPath);
  const driveMatch = normalized.match(/^\/([A-Z]):(?:\/(.*))?$/);

  if (!driveMatch) {
    return normalized;
  }

  const drivePath = `${driveMatch[1]}:/${driveMatch[2] || ''}`.replace(/\/+$/g, '');
  const withDriveRoot = drivePath.length === 2 ? `${drivePath}/` : drivePath;
  const slashDriveRoot = `/${driveMatch[1]}:`;
  const withSlashDriveRoot = normalized === slashDriveRoot ? `${slashDriveRoot}/` : normalized;

  return style === 'drive' ? withDriveRoot : withSlashDriveRoot;
}

export function getWindowsSftpPathCandidates(canonicalPath: string, preferredStyle?: WindowsSftpPathStyle): string[] {
  const styles: WindowsSftpPathStyle[] = preferredStyle === 'drive'
    ? ['drive', 'slashDrive']
    : ['slashDrive', 'drive'];
  const candidates = styles.map(style => toWindowsSftpPath(canonicalPath, style));
  return Array.from(new Set(candidates));
}

export function inferWindowsSftpPathStyle(actualPath: string): WindowsSftpPathStyle {
  return String(actualPath || '').trim().startsWith('/') ? 'slashDrive' : 'drive';
}

export function toRemoteCommandPath(remotePath: string, platform: RemotePlatform | string | undefined): string {
  if (!isWindowsRemotePlatform(platform)) {
    return normalizePosixRemotePath(remotePath);
  }

  const normalized = normalizeWindowsRemotePath(remotePath);
  const driveMatch = normalized.match(/^\/([A-Z]):(?:\/(.*))?$/);

  if (!driveMatch) {
    return normalized.replace(/\//g, '\\');
  }

  const rest = driveMatch[2] ? `\\${driveMatch[2].replace(/\//g, '\\')}` : '\\';
  return `${driveMatch[1]}:${rest}`;
}

export function shouldUseWindowsRemotePath(platform: RemotePlatform | string | undefined): boolean {
  return normalizeRemotePlatform(platform) === 'windows';
}
