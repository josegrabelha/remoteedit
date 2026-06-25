import { Readable, Writable } from 'stream';
import type SftpClient from 'ssh2-sftp-client';
import type { RemoteOwnerGroupSuggestions, RemotePrincipalSuggestion } from '../remote/RemoteSessionManager';
import type { ConnectionCancellationToken, RemoteEntry, RemoteEntryType } from '../remote/RemoteSessionTypes';
import { RemoteEditOperationCancelledError, type RemoteEditProgressReporter } from '../utils/progressUtils';
import { getBooleanSetting, getStringSetting } from '../utils/settingsUtils';

export function shouldRestoreSpecialPermissionBits(originalMode: number | undefined): originalMode is number {
  return Boolean(
    getBooleanSetting('restoreSpecialPermissionBits', true) &&
    originalMode !== undefined &&
    hasSpecialPermissionBits(originalMode)
  );
}

export function hasSpecialPermissionBits(mode: number): boolean {
  return (mode & 0o7000) !== 0;
}

export function hasSpecialPermissionBitsChanged(originalMode: number, currentMode: number | undefined): boolean {
  return currentMode === undefined || (originalMode & 0o7000) !== (currentMode & 0o7000);
}

export function normalizeFileMode(value: unknown): number | undefined {
  const mode = Number(value);

  if (!Number.isFinite(mode) || mode < 0) {
    return undefined;
  }

  return mode & 0o7777;
}

export function modeFromPermissionString(permissions: string): number | undefined {
  if (!/^[bcdlps-][rwxStTs-]{9}/.test(permissions)) {
    return undefined;
  }

  let mode = 0;
  const chars = permissions.slice(1, 10);

  if (chars[0] === 'r') { mode |= 0o400; }
  if (chars[1] === 'w') { mode |= 0o200; }
  if (chars[2] === 'x' || chars[2] === 's') { mode |= 0o100; }
  if (chars[2] === 's' || chars[2] === 'S') { mode |= 0o4000; }

  if (chars[3] === 'r') { mode |= 0o040; }
  if (chars[4] === 'w') { mode |= 0o020; }
  if (chars[5] === 'x' || chars[5] === 's') { mode |= 0o010; }
  if (chars[5] === 's' || chars[5] === 'S') { mode |= 0o2000; }

  if (chars[6] === 'r') { mode |= 0o004; }
  if (chars[7] === 'w') { mode |= 0o002; }
  if (chars[8] === 'x' || chars[8] === 't') { mode |= 0o001; }
  if (chars[8] === 't' || chars[8] === 'T') { mode |= 0o1000; }

  return mode;
}

export function formatMode(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export function getSudoTempDirectory(): string {
  return normalizeRemotePath(getStringSetting('sudoTempDirectory', '/tmp'));
}

export interface RemoteSpaceInfo {
  filesystem: string;
  availableBytes: number;
  mountPoint: string;
}

export function parseDfSpaceInfo(output: string, remotePath: string): RemoteSpaceInfo {
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error(`Could not parse free space information for ${remotePath}.`);
  }

  const dataLine = lines[lines.length - 1];
  const columns = dataLine.split(/\s+/);
  const percentIndex = columns.findIndex(column => /^\d+%$/.test(column));

  if (percentIndex < 2) {
    throw new Error(`Could not parse available space for ${remotePath}.`);
  }

  const availableKilobytes = Number(columns[percentIndex - 1]);

  if (!Number.isFinite(availableKilobytes) || availableKilobytes < 0) {
    throw new Error(`Could not parse available space for ${remotePath}.`);
  }

  return {
    filesystem: columns[0] || '',
    availableBytes: availableKilobytes * 1024,
    mountPoint: columns.slice(percentIndex + 1).join(' ') || ''
  };
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return 'unknown';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function cloneRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.map(entry => ({ ...entry }));
}

export function sortRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') {
      return -1;
    }
    if (a.type !== 'directory' && b.type === 'directory') {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export function parseLongListing(output: string, parentPath: string): RemoteEntry[] {
  return output
    .split(/\r?\n/)
    .map(line => parseLongListingLine(line, parentPath))
    .filter((entry): entry is RemoteEntry => Boolean(entry && entry.name !== '.' && entry.name !== '..'));
}

export function parseLongListingLine(line: string, parentPath: string): RemoteEntry | undefined {
  const trimmedLine = line.trim();

  if (!trimmedLine || trimmedLine.startsWith('total ')) {
    return undefined;
  }

  const match = trimmedLine.match(/^([bcdlps-][rwxStTs-]{9}[+.]?)\s+\S+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);

  if (!match) {
    return undefined;
  }

  const permissions = match[1];
  const owner = match[2];
  const group = match[3];
  const size = Number(match[4] || 0);
  const month = match[5];
  const day = match[6];
  const timeOrYear = match[7];
  const rawName = match[8];
  const linkSplitIndex = permissions.startsWith('l') ? rawName.indexOf(' -> ') : -1;
  const name = linkSplitIndex >= 0 ? rawName.slice(0, linkSplitIndex) : rawName;
  const linkTarget = linkSplitIndex >= 0 ? rawName.slice(linkSplitIndex + 4) : undefined;
  const type = mapPermissionTypeToEntryType(permissions.charAt(0));

  return {
    name,
    type,
    effectiveType: undefined,
    linkTarget,
    size,
    modifyTime: parseLongListingTimestamp(month, day, timeOrYear),
    accessTime: 0,
    owner,
    group,
    permissions,
    path: joinRemotePath(parentPath, name)
  };
}

export function parseLongListingTimestamp(month: string, day: string, timeOrYear: string): number {
  const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    .findIndex(value => value.toLowerCase() === month.slice(0, 3).toLowerCase());

  if (monthIndex < 0) {
    return 0;
  }

  const now = new Date();
  const parsedDay = Number(day);
  let parsedDate: Date;

  if (/^\d{1,2}:\d{2}$/.test(timeOrYear)) {
    const [hour, minute] = timeOrYear.split(':').map(Number);
    parsedDate = new Date(now.getFullYear(), monthIndex, parsedDay, hour, minute, 0, 0);

    if (parsedDate.getTime() - now.getTime() > 24 * 60 * 60 * 1000) {
      parsedDate.setFullYear(parsedDate.getFullYear() - 1);
    }
  } else {
    parsedDate = new Date(Number(timeOrYear), monthIndex, parsedDay, 0, 0, 0, 0);
  }

  const timestamp = parsedDate.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function mapPermissionTypeToEntryType(typeChar: string): RemoteEntryType {
  switch (typeChar) {
    case 'd':
      return 'directory';
    case 'l':
      return 'link';
    case '-':
      return 'file';
    default:
      return 'unknown';
  }
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



export async function toBuffer(data: unknown, remotePath: string): Promise<Buffer> {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  if (typeof data === 'string') {
    return Buffer.from(data);
  }

  if (data instanceof Readable || isReadableStream(data)) {
    return await readableToBuffer(data as Readable);
  }

  if (data === undefined || data === null) {
    return Buffer.alloc(0);
  }

  throw new Error(`Unsupported data returned while reading ${remotePath}.`);
}

export function isReadableStream(value: unknown): value is Readable {
  return Boolean(value && typeof (value as any).pipe === 'function' && typeof (value as any).on === 'function');
}

export async function readableToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(String(chunk)));
    }
  }

  return Buffer.concat(chunks);
}

export async function readRemoteFileToBuffer(
  client: SftpClient,
  remotePath: string,
  cancellationToken?: ConnectionCancellationToken,
  progress?: RemoteEditProgressReporter,
  totalBytes?: number
): Promise<Buffer> {
  throwIfOperationCancelled(cancellationToken);

  const sftp = (client as any).sftp;

  if (sftp && typeof sftp.createReadStream === 'function') {
    return await readRemoteFileStreamToBuffer(sftp.createReadStream(remotePath), cancellationToken, progress, totalBytes);
  }

  const chunks: Buffer[] = [];
  let transferredBytes = 0;
  let sink: Writable | undefined;

  const operation = new Promise<Buffer>((resolve, reject) => {
    sink = new Writable({
      write(chunk, _encoding, callback) {
        if (cancellationToken?.isCancellationRequested) {
          callback(new Error('Operation cancelled.'));
          return;
        }

        const bufferChunk = Buffer.isBuffer(chunk)
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk)
            : Buffer.from(String(chunk));

        chunks.push(bufferChunk);

        if (progress && Number(totalBytes || 0) > 0) {
          transferredBytes += bufferChunk.length;
          progress.reportBytes('Opening remote file...', transferredBytes, Number(totalBytes || 0));
        }

        callback();
      }
    });

    client.get(remotePath, sink as any)
      .then(() => {
        throwIfOperationCancelled(cancellationToken);
        resolve(Buffer.concat(chunks));
      })
      .catch(reject);
  });

  const cancellationDisposable = cancellationToken?.onCancellationRequested(() => {
    try {
      sink?.destroy(new Error('Operation cancelled.'));
    } catch {
      // Ignore sink destroy errors while cancelling read.
    }
  });

  try {
    return await operation;
  } finally {
    cancellationDisposable?.dispose();
  }
}

export async function readRemoteFileStreamToBuffer(
  stream: Readable,
  cancellationToken?: ConnectionCancellationToken,
  progress?: RemoteEditProgressReporter,
  totalBytes?: number
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let transferredBytes = 0;

  const cancellationDisposable = cancellationToken?.onCancellationRequested(() => {
    try {
      stream.destroy(new Error('Operation cancelled.'));
    } catch {
      // Ignore stream destroy errors while cancelling read.
    }
  });

  try {
    for await (const chunk of stream) {
      throwIfOperationCancelled(cancellationToken);

      const bufferChunk = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : Buffer.from(String(chunk));

      chunks.push(bufferChunk);

      if (progress && Number(totalBytes || 0) > 0) {
        transferredBytes += bufferChunk.length;
        progress.reportBytes('Opening remote file...', transferredBytes, Number(totalBytes || 0));
      }
    }

    throwIfOperationCancelled(cancellationToken);
    return Buffer.concat(chunks);
  } finally {
    cancellationDisposable?.dispose();
  }
}

export function throwIfOperationCancelled(cancellationToken?: ConnectionCancellationToken): void {
  if (cancellationToken?.isCancellationRequested) {
    throw new RemoteEditOperationCancelledError('Operation cancelled.');
  }
}

export function getOwnerFromFileInfo(item: SftpClient.FileInfo): number | string {
  return parseLongnameOwnerGroup(item).owner || (item as any).owner || '';
}

export function getGroupFromFileInfo(item: SftpClient.FileInfo): number | string {
  return parseLongnameOwnerGroup(item).group || (item as any).group || '';
}

export function parseLongnameOwnerGroup(item: SftpClient.FileInfo): { owner: string; group: string } {
  const longname = String((item as any).longname || '').trim();

  if (!longname) {
    return { owner: '', group: '' };
  }

  const parts = longname.split(/\s+/);

  if (parts.length >= 4 && /^[dlpscb-]/.test(parts[0])) {
    return { owner: parts[2] || '', group: parts[3] || '' };
  }

  return { owner: '', group: '' };
}

export function collectNumericIds(values: Array<number | string>): string[] {
  const ids = new Set<string>();

  for (const value of values) {
    const id = normalizeNumericId(value);
    if (id) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

export function normalizeNumericId(value: number | string): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return String(value);
  }

  const trimmed = String(value || '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : undefined;
}

export function buildPrincipalLookupCommand(kind: 'user' | 'group', ids: string[]): string {
  const database = kind === 'user' ? 'passwd' : 'group';
  const filePath = kind === 'user' ? '/etc/passwd' : '/etc/group';
  const idList = ids.filter(id => /^\d+$/.test(id)).join(' ');

  return [
    `for remoteedit_id in ${idList}; do`,
    '  remoteedit_name=""',
    '  if command -v getent >/dev/null 2>&1; then',
    `    remoteedit_name="$(getent ${database} "$remoteedit_id" 2>/dev/null | awk -F: 'NR == 1 { print $1 }')"`,
    '  fi',
    '  if [ -z "$remoteedit_name" ]; then',
    `    remoteedit_name="$(awk -F: -v id="$remoteedit_id" '$3 == id { print $1; exit }' ${filePath} 2>/dev/null)"`,
    '  fi',
    '  if [ -n "$remoteedit_name" ]; then',
    `    printf '%s:%s\\n' "$remoteedit_id" "$remoteedit_name"`,
    '  fi',
    'done'
  ].join('\n');
}

export function parsePrincipalLookupOutput(output: string): Map<string, string> {
  const names = new Map<string, string>();

  for (const line of output.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');

    if (separatorIndex <= 0) {
      continue;
    }

    const id = line.slice(0, separatorIndex).trim();
    const name = line.slice(separatorIndex + 1).trim();

    if (/^\d+$/.test(id) && name) {
      names.set(id, name);
    }
  }

  return names;
}

export function buildPermissionString(item: SftpClient.FileInfo): string {
  const longname = String((item as any).longname || '');

  if (longname.length >= 10) {
    return longname.slice(0, 10);
  }

  const typePrefix = item.type === 'd' ? 'd' : item.type === 'l' ? 'l' : item.type === '-' ? '-' : '?';
  const rights = (item as any).rights || {};

  return typePrefix +
    formatRights(String(rights.user || '')) +
    formatRights(String(rights.group || '')) +
    formatRights(String(rights.other || ''));
}

export function formatRights(value: string): string {
  return `${value.includes('r') ? 'r' : '-'}${value.includes('w') ? 'w' : '-'}${value.includes('x') ? 'x' : '-'}`;
}

export function inferLinkTargetType(target: string | undefined): RemoteEntryType | undefined {
  const targetText = String(target || '').trim();

  if (!targetText) {
    return undefined;
  }

  if (targetText.endsWith('/')) {
    return 'directory';
  }

  return undefined;
}

export function extractLinkTargetFromLongname(longname: string): string | undefined {
  const marker = ' -> ';
  const markerIndex = longname.indexOf(marker);

  if (markerIndex === -1) {
    return undefined;
  }

  const target = longname.slice(markerIndex + marker.length).trim();
  return target || undefined;
}

export function mapModeToEntryType(mode: number): RemoteEntryType {
  const typeBits = mode & 0o170000;

  switch (typeBits) {
    case 0o040000:
      return 'directory';
    case 0o100000:
      return 'file';
    case 0o120000:
      return 'link';
    default:
      return 'unknown';
  }
}

export function statFlag(stats: unknown, propertyName: string): boolean {
  const value = (stats as any)?.[propertyName];

  if (typeof value === 'function') {
    return Boolean(value.call(stats));
  }

  return Boolean(value);
}

export function mapEntryType(type: string): RemoteEntryType {
  switch (type) {
    case 'd':
      return 'directory';
    case '-':
      return 'file';
    case 'l':
      return 'link';
    default:
      return 'unknown';
  }
}


export function buildOwnerGroupSuggestionCommand(): string {
  return [
    "printf '__REMOTE_EDIT_USERS__\\n'",
    "if command -v getent >/dev/null 2>&1; then getent passwd 2>/dev/null; elif command -v lsuser >/dev/null 2>&1; then lsuser -a id ALL 2>/dev/null; elif [ -r /etc/passwd ]; then cat /etc/passwd 2>/dev/null; fi",
    "printf '__REMOTE_EDIT_GROUPS__\\n'",
    "if command -v getent >/dev/null 2>&1; then getent group 2>/dev/null; elif command -v lsgroup >/dev/null 2>&1; then lsgroup -a id ALL 2>/dev/null; elif [ -r /etc/group ]; then cat /etc/group 2>/dev/null; fi"
  ].join('; ');
}

export function parseOwnerGroupSuggestionOutput(output: string): RemoteOwnerGroupSuggestions {
  const owners: RemotePrincipalSuggestion[] = [];
  const groups: RemotePrincipalSuggestion[] = [];
  let section: 'owners' | 'groups' | '' = '';

  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === '__REMOTE_EDIT_USERS__') {
      section = 'owners';
      continue;
    }
    if (line === '__REMOTE_EDIT_GROUPS__') {
      section = 'groups';
      continue;
    }

    const parsed = section === 'owners'
      ? parseOwnerGroupUserLine(line)
      : section === 'groups'
        ? parseOwnerGroupGroupLine(line)
        : undefined;

    if (!parsed) continue;
    if (section === 'owners') owners.push(parsed);
    if (section === 'groups') groups.push(parsed);
  }

  return {
    owners: dedupeOwnerGroupSuggestions(owners).slice(0, 500),
    groups: dedupeOwnerGroupSuggestions(groups).slice(0, 500)
  };
}

export function parseOwnerGroupUserLine(line: string): RemotePrincipalSuggestion | undefined {
  const passwdParts = line.split(':');
  if (passwdParts.length >= 3 && passwdParts[0]) {
    return {
      name: passwdParts[0],
      id: passwdParts[2] || '',
      detail: passwdParts[2] ? `uid ${passwdParts[2]}` : ''
    };
  }

  const aixMatch = line.match(/^(\S+)\s+.*?\bid=(\d+)/);
  if (aixMatch) {
    return { name: aixMatch[1], id: aixMatch[2], detail: `uid ${aixMatch[2]}` };
  }

  return undefined;
}

export function parseOwnerGroupGroupLine(line: string): RemotePrincipalSuggestion | undefined {
  const groupParts = line.split(':');
  if (groupParts.length >= 3 && groupParts[0]) {
    return {
      name: groupParts[0],
      id: groupParts[2] || '',
      detail: groupParts[2] ? `gid ${groupParts[2]}` : ''
    };
  }

  const aixMatch = line.match(/^(\S+)\s+.*?\bid=(\d+)/);
  if (aixMatch) {
    return { name: aixMatch[1], id: aixMatch[2], detail: `gid ${aixMatch[2]}` };
  }

  return undefined;
}

export function dedupeOwnerGroupSuggestions(values: RemotePrincipalSuggestion[]): RemotePrincipalSuggestion[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const name = String(value?.name || '').trim();
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
