import * as path from 'path';
import * as vscode from 'vscode';
import type { AuthType, ConnectionProfile } from '../connection/ConnectionManager';
import type { ActiveConnection, RemoteEntry, RemoteEntryType } from '../remote/RemoteSessionManager';
import type { TransferQueueItemSnapshot } from '../panel/RemoteEditPanel';
import { formatPermissionsPropertyValue } from '../utils/permissionFormatUtils';

export function getConnectionDetailContextValue(field: ConnectionDetailField, isQuickConnect: boolean, isCredentials: boolean): string {
  if (field === 'ftpsCaCertificatePath') {
    return isQuickConnect
      ? 'remoteedit.quickConnectionDetail.ftpsCaCertificatePath'
      : 'remoteedit.connectionDetail.ftpsCaCertificatePath';
  }

  if (isCredentials) {
    return isQuickConnect
      ? 'remoteedit.quickConnectionDetail.credentials'
      : 'remoteedit.connectionDetail.credentials';
  }

  return isQuickConnect
    ? 'remoteedit.quickConnectionDetail'
    : 'remoteedit.connectionDetail';
}

export function isSftpConnection(connectionType: unknown): boolean {
  return String(connectionType || 'sftp').toLowerCase() === 'sftp';
}


export type ConnectionDetailField =
  | 'host'
  | 'port'
  | 'connectionType'
  | 'username'
  | 'authType'
  | 'privateKeyPath'
  | 'startPath'
  | 'keepAlive'
  | 'ftpsAllowSelfSignedCertificate'
  | 'ftpsCaCertificatePath'
  | 'credentials';


export function getSavedConnectionIcon(options?: { modified?: boolean; connected?: boolean; draft?: boolean; connecting?: boolean }): vscode.TreeItem['iconPath'] {
  if (options?.connecting) {
    return new vscode.ThemeIcon('loading~spin');
  }

  if (options?.draft || options?.modified) {
    return getResourceIcon('connection-draft.svg');
  }

  if (options?.connected) {
    return getResourceIcon('connection-active.svg');
  }

  return {
    light: getResourceIcon('connection-light.svg'),
    dark: getResourceIcon('connection-dark.svg')
  };
}

export function getResourceIcon(fileName: string): vscode.Uri {
  return vscode.Uri.file(path.join(__dirname, '..', '..', 'resources', fileName));
}

export function getConnectionDetailFields(profile: ConnectionProfile): ConnectionDetailField[] {
  const connectionType = String(profile.connectionType || 'sftp');
  const isSftp = connectionType === 'sftp';
  const isFtps = connectionType === 'ftps';
  const isPrivateKey = isSftp && profile.authType === 'privateKey';
  const fields: ConnectionDetailField[] = [
    'host',
    'port',
    'connectionType'
  ];

  if (isFtps) {
    fields.push('ftpsAllowSelfSignedCertificate');
    if (!profile.ftpsAllowSelfSignedCertificate) {
      fields.push('ftpsCaCertificatePath');
    }
  }

  fields.push('username');

  if (isSftp) {
    fields.push('authType');
    if (isPrivateKey) {
      fields.push('privateKeyPath');
    }
    fields.push('credentials');
  } else {
    fields.push('credentials');
  }

  fields.push('keepAlive', 'startPath');
  return fields;
}

export function buildConnectionDetail(profile: ConnectionProfile, field: ConnectionDetailField, options?: { quickConnect?: boolean }): {
  label: string;
  value: string;
  icon: vscode.ThemeIcon;
  tooltip: string;
} {
  const protocol = String(profile.connectionType || 'sftp').toUpperCase();
  const isSftp = String(profile.connectionType || 'sftp') === 'sftp';
  const isFtps = String(profile.connectionType || 'sftp') === 'ftps';
  const isPrivateKey = isSftp && profile.authType === 'privateKey';
  const authLabel = formatAuthType(profile.authType);
  const savedCredentials = getSavedCredentialLabel(profile, Boolean(options?.quickConnect));
  const details: Record<ConnectionDetailField, { name: string; value: string; icon: string }> = {
    host: { name: 'Hostname', value: profile.host || '', icon: 'globe' },
    port: { name: 'Port', value: String(profile.port || ''), icon: 'plug' },
    connectionType: { name: 'Type', value: protocol, icon: 'remote' },
    username: { name: 'Username', value: profile.username || '', icon: 'account' },
    authType: { name: 'Auth Method', value: isSftp ? authLabel : 'Password', icon: 'key' },
    privateKeyPath: { name: 'Private Key Path', value: isPrivateKey ? profile.privateKeyPath || '' : 'Not used', icon: 'key' },
    ftpsAllowSelfSignedCertificate: { name: 'Allow Self-Signed Certificate', value: isFtps && profile.ftpsAllowSelfSignedCertificate ? 'On' : 'Off', icon: 'shield' },
    ftpsCaCertificatePath: { name: 'CA Certificate Path', value: isFtps ? profile.ftpsCaCertificatePath || '' : 'Not used', icon: 'certificate' },
    startPath: { name: 'Start Path', value: profile.startPath || '/', icon: 'folder-opened' },
    keepAlive: { name: 'Keep Alive', value: profile.keepAlive !== false ? 'On' : 'Off', icon: 'pulse' },
    credentials: { name: isPrivateKey ? 'Passphrase' : 'Password', value: savedCredentials, icon: 'lock' }
  };
  const detail = details[field];
  const value = detail.value || 'Not set';
  return {
    label: `${detail.name}: ${value}`,
    value,
    icon: new vscode.ThemeIcon(detail.icon),
    tooltip: field === 'credentials'
      ? isPrivateKey ? 'Click to manage passphrase.' : 'Click to manage password.'
      : field === 'keepAlive' || field === 'ftpsAllowSelfSignedCertificate'
        ? `Click to toggle ${detail.name}.`
        : `Click to edit ${detail.name}.`
  };
}

export function formatAuthType(value: AuthType): string {
  return value === 'privateKey' ? 'Private key' : 'Password';
}

export function getSavedCredentialLabel(profile: ConnectionProfile, quickConnect: boolean): string {
  if (profile.authType === 'privateKey') {
    if (quickConnect) {
      return profile.hasSavedPassphrase ? 'Set' : 'Not set';
    }
    return profile.hasSavedPassphrase ? 'Saved' : 'Not saved';
  }

  if (quickConnect) {
    return profile.hasSavedPassword ? 'Set' : 'Not set';
  }

  return profile.hasSavedPassword ? 'Saved' : 'Not saved';
}

export function sortRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return [...entries].sort((a, b) => {
    const aType = resolveRemoteEntryType(a);
    const bType = resolveRemoteEntryType(b);

    if (aType === 'directory' && bType !== 'directory') {
      return -1;
    }

    if (aType !== 'directory' && bType === 'directory') {
      return 1;
    }

    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}


export function normalizeRemotePath(value: string | undefined): string {
  const text = String(value || '/').trim();

  if (!text) {
    return '/';
  }

  const withRoot = text.startsWith('/') ? text : `/${text}`;
  const normalized = withRoot.replace(/\/+/g, '/').replace(/\/$/, '');
  return normalized || '/';
}

export function isPathAncestorOrSelf(candidatePath: string, targetPath: string): boolean {
  const candidate = normalizeRemotePath(candidatePath);
  const target = normalizeRemotePath(targetPath);

  return candidate === '/' || candidate === target || target.startsWith(`${candidate}/`);
}

export function getParentRemotePath(remotePath: string): string {
  const normalized = normalizeRemotePath(remotePath);

  if (normalized === '/') {
    return '/';
  }

  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex <= 0 ? '/' : normalized.slice(0, slashIndex);
}

export function normalizeRemoteRootStartPath(startPath: string | undefined): string {
  return normalizeRemotePath(startPath);
}

const SIDEBAR_PARENT_PATH_SEGMENTS = 3;

export function buildSidebarPathDisplay(remotePath: string): { label: string; description?: string } {
  const normalizedPath = normalizeRemotePath(remotePath);

  if (normalizedPath === '/') {
    return { label: normalizedPath };
  }

  const showParentPath = shouldShowSidebarParentPath();

  return {
    label: `…/${getRemotePathBasename(normalizedPath)}`,
    description: showParentPath ? `parent: ${formatSidebarParentPath(getParentRemotePath(normalizedPath))}` : undefined
  };
}

export function shouldShowSidebarParentPath(): boolean {
  return vscode.workspace.getConfiguration('remoteedit.sidebar').get<boolean>('showParentPath', true);
}

export function formatSidebarParentPath(parentPath: string): string {
  const normalizedParent = normalizeRemotePath(parentPath);

  if (normalizedParent === '/') {
    return '/';
  }

  const segments = normalizedParent.split('/').filter(Boolean);

  if (segments.length <= SIDEBAR_PARENT_PATH_SEGMENTS) {
    return normalizedParent;
  }

  return `…/${segments.slice(-SIDEBAR_PARENT_PATH_SEGMENTS).join('/')}`;
}

export function getRemotePathBasename(remotePath: string): string {
  const normalizedPath = normalizeRemotePath(remotePath);

  if (normalizedPath === '/') {
    return '/';
  }

  return normalizedPath.split('/').filter(Boolean).pop() || normalizedPath;
}


export function formatOpenConnectionLabel(connection: ActiveConnection): string {
  const name = String(connection.name || '').trim();
  const host = String(connection.host || '').trim();

  return name || host || connection.id;
}

export function formatCredentialStatus(profile: ConnectionProfile): string {
  if (profile.authType === 'privateKey') {
    return profile.hasSavedPassphrase ? 'Saved passphrase available.' : '';
  }

  return profile.hasSavedPassword ? 'Saved password available.' : '';
}

export function resolveRemoteEntryType(entry: RemoteEntry): RemoteEntryType {
  return entry.effectiveType || entry.type || 'unknown';
}

export function getRemoteEntryIcon(entry: RemoteEntry, _resolvedType: RemoteEntryType): vscode.ThemeIcon | undefined {
  // Keep directories aligned with the native TreeView rendering. File icons are
  // driven by resourceUri so the active VS Code file icon theme can decide.
  if (entry.type === 'link') {
    return undefined;
  }

  return undefined;
}

export function getRemoteEntryResourceUri(entry: RemoteEntry, resolvedType: RemoteEntryType, remotePath: string, connectionId: string): vscode.Uri | undefined {
  if (entry.type === 'link') {
    const linkName = entry.name || remotePath.split('/').filter(Boolean).pop() || 'link';
    const fileName = linkName.includes('.') ? linkName : `${linkName}.txt`;
    return withSidebarDecorationQuery(vscode.Uri.file(fileName), connectionId, 'link', remotePath);
  }

  if (resolvedType === 'file') {
    return withSidebarDecorationQuery(vscode.Uri.file(entry.name || remotePath), connectionId, 'file', remotePath);
  }

  return getSidebarDecorationResourceUri(connectionId, remotePath, resolvedType);
}

export function getSidebarDecorationResourceUri(connectionId: string, value: string, kind: string): vscode.Uri {
  const safePath = `/${encodeURIComponent(kind)}/${encodeURIComponent(value || connectionId)}`;
  return vscode.Uri.from({
    scheme: 'remoteedit-sidebar',
    path: safePath,
    query: `connectionId=${encodeURIComponent(connectionId)}`
  });
}

export function withSidebarDecorationQuery(uri: vscode.Uri, connectionId: string, kind: string, remotePath: string): vscode.Uri {
  return uri.with({
    query: `connectionId=${encodeURIComponent(connectionId)}&kind=${encodeURIComponent(kind)}&remotePath=${encodeURIComponent(remotePath)}`
  });
}

export function buildRemoteEntryDescription(entry: RemoteEntry, resolvedType: RemoteEntryType): string | undefined {
  if (entry.type === 'link') {
    return 'link';
  }

  if (resolvedType === 'file' && typeof entry.size === 'number') {
    return formatBytes(entry.size);
  }

  return undefined;
}

export function shouldShowItemInfoOnHover(): boolean {
  return vscode.workspace.getConfiguration('remoteedit.sidebar').get<boolean>('showItemInfoOnHover', false);
}

export function buildEmptyHoverTooltip(): vscode.MarkdownString {
  // VS Code falls back to resourceUri hover text when TreeItem.tooltip is
  // undefined or an empty string. Keep resourceUri available for file icons and
  // sidebar decorations, but provide an explicit empty MarkdownString so remote
  // file/folder rows do not show the automatic URI hover when disabled.
  const tooltip = new vscode.MarkdownString('', true);
  tooltip.isTrusted = false;
  return tooltip;
}

export function buildRemoteEntryTooltipOrEmpty(entry: RemoteEntry, resolvedType: RemoteEntryType): vscode.MarkdownString {
  return shouldShowItemInfoOnHover()
    ? buildRemoteEntryTooltip(entry, resolvedType)
    : buildEmptyHoverTooltip();
}

export function buildRemotePathTooltipOrEmpty(remotePath: string): string | vscode.MarkdownString {
  return shouldShowItemInfoOnHover() ? remotePath : buildEmptyHoverTooltip();
}

export function buildRemoteBrowseTooltipOrEmpty(remotePath: string): string | vscode.MarkdownString {
  return shouldShowItemInfoOnHover() ? `Browse ${remotePath}.` : buildEmptyHoverTooltip();
}

export function buildGoParentTooltipOrEmpty(parentPath: string): string | vscode.MarkdownString {
  return shouldShowItemInfoOnHover() ? `Go to ${parentPath}.` : buildEmptyHoverTooltip();
}

export function buildRemoteEntryTooltip(entry: RemoteEntry, resolvedType: RemoteEntryType): vscode.MarkdownString {
  const lines = [
    formatTooltipField('Path', entry.path),
    formatTooltipField('Type', resolvedType)
  ];

  if (entry.type === 'link' && entry.linkTarget) {
    lines.push(formatTooltipField('Link target', entry.linkTarget));
  }

  if (typeof entry.size === 'number' && resolvedType === 'file') {
    lines.push(formatTooltipField('Size', `${formatBytes(entry.size)} (${entry.size} bytes)`));
  }

  if (entry.permissions) {
    lines.push(formatTooltipField('Permissions', formatPermissionsPropertyValue(entry.permissions)));
  }

  if (entry.owner !== undefined || entry.group !== undefined) {
    lines.push(formatTooltipField('Owner/Group', `${String(entry.owner ?? '')}:${String(entry.group ?? '')}`));
  }

  if (entry.modifyTime) {
    lines.push(formatTooltipField('Modified', formatRemoteTimestamp(entry.modifyTime)));
  }

  return buildMarkdownTooltip(entry.name || entry.path || 'Remote item', lines);
}

export function formatRemoteTimestamp(value: number): string {
  const timestamp = value > 0 && value < 100000000000 ? value * 1000 : value;
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

export function formatBytes(value: number): string {

  if (!Number.isFinite(value)) {
    return String(value);
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${Math.round(size)} ${units[unitIndex]}`;
  }

  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`.replace(/\.0+ /, ' ');
}


export function formatTransferItemLabel(item: TransferQueueItemSnapshot): string {
  const title = String(item.title || '').trim();

  if (title) {
    return title;
  }

  const source = item.operation === 'Upload' ? item.from : item.to;
  const fallback = source.split(/[\\/]/).filter(Boolean).pop() || source || item.operation;
  return `${item.operation} ${fallback}`;
}


export function formatTransferItemDescription(item: TransferQueueItemSnapshot, label: string): string {
  const status = String(item.status || '').trim();
  const progress = String(item.progress || '').trim();

  if (status === 'Running' && progress && progress !== '--') {
    return `Running - ${stripLeadingTransferItemLabel(stripTrailingSentencePunctuation(progress), label)}`;
  }

  return status;
}

export function stripLeadingTransferItemLabel(value: string, label: string): string {
  const cleanValue = String(value || '').trim();
  const cleanLabel = String(label || '').trim();

  if (!cleanValue || !cleanLabel) {
    return cleanValue;
  }

  const labels = new Set<string>([cleanLabel]);
  const basename = cleanLabel.split(/[\\/]/).filter(Boolean).pop();

  if (basename) {
    labels.add(basename);
  }

  for (const candidate of labels) {
    if (cleanValue === candidate) {
      return cleanValue;
    }

    for (const separator of [' - ', ' – ', ': ']) {
      const prefix = `${candidate}${separator}`;

      if (cleanValue.startsWith(prefix)) {
        return cleanValue.slice(prefix.length).trim();
      }
    }
  }

  return cleanValue;
}

export function stripTrailingSentencePunctuation(value: string): string {
  return value.replace(/[.!?…]+$/g, '');
}

export function buildTransferItemTooltipContent(item: TransferQueueItemSnapshot): { title: string; lines: string[] } {
  const progress = String(item.progress || '').trim();
  const lines = [
    `Status: ${item.status}`,
    `Connection: ${item.connection}`
  ];

  if (progress && progress !== '--') {
    lines.push(`Progress: ${stripTrailingSentencePunctuation(progress)}`);
  }

  if (item.operation === 'Upload') {
    lines.push(`Local path: ${item.from}`);
    lines.push(`Remote path: ${item.to}`);
  } else {
    lines.push(`Remote path: ${item.from}`);
    lines.push(`Local path: ${item.to}`);
  }

  const timestampLine = formatTransferItemTimestampLine(item);

  if (timestampLine) {
    lines.push(timestampLine);
  }

  return { title: item.operation, lines };
}

export function formatTransferItemTimestampLine(item: TransferQueueItemSnapshot): string {
  if (item.finishedAt) {
    if (item.status === 'Failed') {
      return `Failed: ${item.finishedAt}`;
    }

    if (item.status === 'Canceled') {
      return `Canceled: ${item.finishedAt}`;
    }

    return `Completed: ${item.finishedAt}`;
  }

  if (item.startedAt) {
    return `Started: ${item.startedAt}`;
  }

  if (item.queuedAt) {
    return `Queued: ${item.queuedAt}`;
  }

  return '';
}


export function formatTooltipPlainText(title: string, lines: string[]): string {
  const filteredLines = lines.map(line => String(line || '').trim()).filter(Boolean);
  return [String(title || '').trim(), '', ...filteredLines].filter((line, index) => index !== 0 || line).join('\n');
}

export function buildMarkdownTooltip(title: string, lines: string[]): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  const filteredLines = lines.map(line => String(line || '').trim()).filter(Boolean);

  tooltip.isTrusted = false;
  tooltip.supportHtml = true;
  tooltip.value = `<strong>${escapeHtml(title)}</strong>`;

  if (filteredLines.length > 0) {
    tooltip.value += `<div style="margin-top: 0.35em; font-size: 0.92em;">${filteredLines.map(escapeHtml).join('<br>')}</div>`;
  }

  return tooltip;
}

export function formatTooltipField(label: string, value: unknown): string {
  return `${label}: ${String(value ?? '')}`;
}


export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, '\\$&');
}
