import * as fs from 'fs/promises';
import { FileInfo, FileType } from 'basic-ftp';
import { normalizeConnectionType } from '../remote/RemoteConnectionTypes';
import type { RemoteStat } from '../remote/RemoteSessionManager';
import type { ConnectOptions, ConnectionCancellationToken, RemoteEntry, RemoteEntryType } from '../remote/RemoteSessionTypes';
import { RemoteEditOperationCancelledError } from '../utils/progressUtils';

export function isMlsdListCommand(command: string): boolean {
  return String(command || '').trim().toUpperCase().startsWith('MLSD');
}

export function isListAllCommand(command: string): boolean {
  return /^LIST\s+-A(?:\s|$)/i.test(String(command || '').trim());
}

export function appendFtpListCommandContext(command: string, context: string): string {
  const normalizedCommand = String(command || '').trim() || 'unknown';
  return `${normalizedCommand} (${context})`;
}

export function hasUsableFtpListItems(items: FileInfo[]): boolean {
  return items.some(item => item.name !== '.' && item.name !== '..');
}

export function mergeFtpMetadata(primaryItems: FileInfo[], listItems: FileInfo[]): FileInfo[] {
  const listItemsByName = new Map<string, FileInfo>();

  for (const item of listItems) {
    if (item.name && !listItemsByName.has(item.name)) {
      listItemsByName.set(item.name, item);
    }
  }

  return primaryItems.map(primaryItem => {
    const listItem = listItemsByName.get(primaryItem.name);

    if (!listItem) {
      return primaryItem;
    }

    return mergeFtpFileInfo(primaryItem, listItem);
  });
}

export function mergeFtpFileInfo(primaryItem: FileInfo, listItem: FileInfo): FileInfo {
  if (hasListMetadata(listItem)) {
    if (hasPositiveSize(listItem) && !hasPositiveSize(primaryItem)) {
      primaryItem.size = listItem.size;
    }

    if (listItem.modifiedAt && !primaryItem.modifiedAt) {
      primaryItem.modifiedAt = listItem.modifiedAt;
    }

    if (listItem.user) {
      primaryItem.user = listItem.user;
    }

    if (listItem.group) {
      primaryItem.group = listItem.group;
    }

    if (listItem.permissions) {
      primaryItem.permissions = listItem.permissions;
    }

    if (listItem.link && !primaryItem.link) {
      primaryItem.link = listItem.link;
    }
  }

  return primaryItem;
}

export function getSelfListingEntry(items: FileInfo[], normalizedPath: string): FileInfo | undefined {
  if (items.length !== 1) {
    return undefined;
  }

  const item = items[0];
  const itemName = String(item.name || '').trim();

  if (!itemName || itemName === '.' || itemName === '..') {
    return undefined;
  }

  const targetName = basenameRemotePath(normalizedPath);

  if (itemName === targetName) {
    return item;
  }

  if (itemName.includes('/')) {
    const normalizedItemPath = normalizeRemotePath(itemName);
    if (normalizedItemPath === normalizedPath || basenameRemotePath(normalizedItemPath) === targetName) {
      return item;
    }
  }

  return undefined;
}

export function hasListMetadata(item: FileInfo): boolean {
  return Boolean(
    hasPositiveSize(item) ||
    item.modifiedAt ||
    item.user ||
    item.group ||
    item.permissions ||
    item.link
  );
}

export function hasPositiveSize(item: FileInfo): boolean {
  return Number.isFinite(Number(item.size)) && Number(item.size) > 0;
}

export function mapFtpFileInfo(item: FileInfo, parentPath: string): RemoteEntry {
  const linkTarget = String(item.link || '').trim() || undefined;
  const type = mapFtpEntryType(item);

  return {
    name: item.name,
    type,
    effectiveType: undefined,
    linkTarget,
    size: Number(item.size || 0),
    modifyTime: getFtpModifyTime(item),
    accessTime: 0,
    owner: item.user || '',
    group: item.group || '',
    permissions: buildFtpPermissionString(item),
    path: joinRemotePath(parentPath, item.name)
  };
}

export function mapFtpEntryType(item: FileInfo): RemoteEntryType {
  if (item.type === FileType.Directory || item.isDirectory) {
    return 'directory';
  }

  if (item.type === FileType.SymbolicLink || item.isSymbolicLink) {
    return 'link';
  }

  if (item.type === FileType.File || item.isFile) {
    return 'file';
  }

  return 'unknown';
}


export function mapFtpStatType(item: FileInfo): RemoteStat['type'] {
  const entryType = mapFtpEntryType(item);
  return entryType === 'link' ? 'unknown' : entryType;
}

export function buildFtpPermissionString(item: FileInfo): string {
  const typePrefix = mapFtpEntryType(item) === 'directory'
    ? 'd'
    : mapFtpEntryType(item) === 'link'
      ? 'l'
      : mapFtpEntryType(item) === 'file'
        ? '-'
        : '?';

  if (!item.permissions) {
    return `${typePrefix}?????????`;
  }

  return typePrefix +
    formatPermissionBits(item.permissions.user) +
    formatPermissionBits(item.permissions.group) +
    formatPermissionBits(item.permissions.world);
}

export function formatPermissionBits(value: number): string {
  const safeValue = Number(value || 0);
  return `${safeValue & FileInfo.UnixPermission.Read ? 'r' : '-'}${safeValue & FileInfo.UnixPermission.Write ? 'w' : '-'}${safeValue & FileInfo.UnixPermission.Execute ? 'x' : '-'}`;
}

export function getFtpModifyTime(item: FileInfo): number {
  const modifiedAt = item.modifiedAt?.getTime();
  return Number.isFinite(modifiedAt) ? Number(modifiedAt) : 0;
}

export function cloneRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.map(entry => ({ ...entry }));
}

export function sortRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.sort((a, b) => {
    const aDirectory = a.type === 'directory' || a.effectiveType === 'directory';
    const bDirectory = b.type === 'directory' || b.effectiveType === 'directory';

    if (aDirectory !== bDirectory) {
      return aDirectory ? -1 : 1;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function normalizeRemotePath(remotePath: string): string {
  const trimmed = (remotePath || '/').trim();

  if (!trimmed || trimmed === '.') {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+/g, '/').replace(/\/\/$/, '') || '/';
}

export function joinRemotePath(parent: string, child: string): string {
  const normalizedParent = normalizeRemotePath(parent);

  if (normalizedParent === '/') {
    return `/${child}`;
  }

  return `${normalizedParent}/${child}`.replace(/\/+/g, '/');
}

export function dirnameRemotePath(remotePath: string): string {
  const normalizedPath = normalizeRemotePath(remotePath);

  if (normalizedPath === '/') {
    return '/';
  }

  const index = normalizedPath.lastIndexOf('/');
  return index <= 0 ? '/' : normalizedPath.slice(0, index);
}

export function basenameRemotePath(remotePath: string): string {
  const normalizedPath = normalizeRemotePath(remotePath);

  if (normalizedPath === '/') {
    return '';
  }

  const index = normalizedPath.lastIndexOf('/');
  return index === -1 ? normalizedPath : normalizedPath.slice(index + 1);
}


export async function buildFtpsSecureOptions(options: ConnectOptions): Promise<Record<string, unknown> | undefined> {
  if (normalizeConnectionType(options.connectionType) !== 'ftps') {
    return undefined;
  }

  if (options.ftpsAllowSelfSignedCertificate) {
    return { rejectUnauthorized: false };
  }

  const caCertificatePath = String(options.ftpsCaCertificatePath || '').trim();

  if (!caCertificatePath) {
    throw new Error('CA certificate path is required for FTPS unless self-signed/untrusted certificates are allowed.');
  }

  try {
    return {
      rejectUnauthorized: true,
      ca: await fs.readFile(caCertificatePath)
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read FTPS CA certificate file: ${caCertificatePath}. Check the path and file permissions. Details: ${details}`);
  }
}

export function throwIfOperationCancelled(cancellationToken?: ConnectionCancellationToken): void {
  if (cancellationToken?.isCancellationRequested) {
    throw new RemoteEditOperationCancelledError('Operation cancelled.');
  }
}

export function createUnsupportedError(actionName: string): Error {
  return new Error(`${actionName} is available only for SFTP connections.`);
}
