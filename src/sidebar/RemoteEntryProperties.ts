import type { RemoteEntry, RemoteEntryType, RemoteSessionManager } from '../remote/RemoteSessionManager';
import { formatPermissionsPropertyValue, permissionModeFromString as permissionModeFromStringValue } from '../utils/permissionFormatUtils';
import { isWindowsRemotePlatform } from '../remote/RemotePlatform';
import type { RemoteEditSidebarItem } from './Items';

export interface SidebarRemoteEntryStat {
  type: 'file' | 'directory' | 'unknown';
  size: number;
  modifyTime: number;
  accessTime: number;
}

export function buildRemoteEntryProperties(
  item: RemoteEditSidebarItem,
  itemName: string,
  connection: ReturnType<RemoteSessionManager['getConnection']>,
  stats?: SidebarRemoteEntryStat
): { title: string; rows: Array<[string, string]> } {
  const entry = item.remoteEntry;
  const entryType = getEffectiveEntryType(entry, stats?.type);
  const isDirectory = entryType === 'directory';
  const isFile = entryType === 'file';
  const isLink = entry?.type === 'link';
  const title = isDirectory
    ? 'Directory Properties'
    : isLink
      ? 'Link Properties'
      : isFile
        ? 'File Properties'
        : 'Item Properties';
  const pathLabel = isDirectory
    ? 'Remote directory'
    : isLink
      ? 'Remote link'
      : isFile
        ? 'Remote file'
        : 'Remote Path';
  const name = entry?.name || itemName || '—';
  const remotePath = entry?.path || item.remotePath || '—';
  const isWindows = isWindowsRemotePlatform(connection?.remotePlatform);

  const rows: Array<[string, string]> = [
    ['Name', name],
    [pathLabel, remotePath],
    ['Type', formatPropertyType(entry, entryType)]
  ];

  if (!isDirectory) {
    rows.push(['Size', formatBytes(entry?.size ?? stats?.size)]);
  }

  rows.push(['Modified', formatPropertyDate(entry?.modifyTime ?? stats?.modifyTime) || '—']);

  const accessed = formatPropertyDate(entry?.accessTime ?? stats?.accessTime);
  if (accessed) {
    rows.push(['Accessed', accessed]);
  }

  if (!isWindows) {
    rows.push(
      ['Permissions', formatPermissionsPropertyValue(entry?.permissions)],
      ['Owner', formatMetadata(entry?.owner) || '—'],
      ['Group', formatMetadata(entry?.group) || '—']
    );
  }

  if (isLink && entry?.linkTarget) {
    rows.push(['Symlink target', entry.linkTarget]);
  }

  if (isLink && entry?.effectiveType) {
    rows.push(['Resolved type', capitalizeText(entry.effectiveType)]);
  }

  rows.push(
    ['Connection', connection ? connection.name : '—'],
    ['Host', connection ? formatSessionTarget(connection) : '—']
  );

  return { title, rows };
}

export function getEffectiveEntryType(entry: RemoteEntry | undefined, statType?: 'file' | 'directory' | 'unknown'): RemoteEntryType {
  if (entry?.effectiveType) {
    return entry.effectiveType;
  }

  if (entry?.type) {
    return entry.type;
  }

  return statType || 'unknown';
}

export function formatBytes(size: unknown): string {
  const value = Number(size || 0);

  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function permissionModeFromString(permissions: string): string | undefined {
  return permissionModeFromStringValue(permissions);
}

export function formatChecksumLine(checksum: { value?: string; error?: string; command?: string }): string {
  if (checksum.value) {
    return checksum.command ? `${checksum.value} (${checksum.command})` : checksum.value;
  }

  return checksum.error || 'Not available';
}

function formatPropertyType(entry: RemoteEntry | undefined, entryType: RemoteEntryType): string {
  if (entry?.type === 'link') {
    const resolvedType = entry.effectiveType ? ` (${capitalizeText(entry.effectiveType)})` : '';
    return `Symbolic link${resolvedType}`;
  }

  return capitalizeText(entry?.type || entryType || 'unknown');
}

function formatPropertyDate(value: unknown): string {
  const timestamp = Number(value || 0);
  return timestamp ? new Date(timestamp).toLocaleString() : '';
}

function formatMetadata(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  return String(value);
}

function formatSessionTarget(connection: { username?: string; host: string; port: number }): string {
  const userPart = connection.username ? `${connection.username}@` : '';
  return `${userPart}${connection.host}:${connection.port}`;
}

function capitalizeText(value: unknown): string {
  const text = String(value || 'unknown');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
