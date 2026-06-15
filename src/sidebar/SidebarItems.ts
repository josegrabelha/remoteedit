import * as path from 'path';
import * as vscode from 'vscode';
import type { AuthType, ConnectionProfile } from '../connection/ConnectionManager';
import type { ActiveConnection, RemoteEntry, RemoteEntryType } from '../remote/RemoteSessionManager';
import type { TransferQueueItemSnapshot } from '../panel/RemoteEditPanel';

export type RemoteEditSidebarItemKind =
  | 'action'
  | 'placeholder'
  | 'connectionFilter'
  | 'quickConnect'
  | 'savedConnection'
  | 'connectionDetail'
  | 'openConnection'
  | 'favoritesGroup'
  | 'favoritePath'
  | 'filesGroup'
  | 'goParentFolder'
  | 'remoteDirectory'
  | 'remoteFile'
  | 'remoteEntry'
  | 'transferGroup'
  | 'transferItem';

export class RemoteEditSidebarItem extends vscode.TreeItem {
  readonly kind: RemoteEditSidebarItemKind;
  readonly profileId?: string;
  readonly connectionId?: string;
  readonly host?: string;
  readonly remotePath?: string;
  readonly transferId?: string;
  readonly transferStatus?: string;
  readonly transferDetails?: string;
  readonly canCancelTransfer?: boolean;
  readonly connectionDetailField?: ConnectionDetailField;
  readonly connectionDetailValue?: string;
  readonly connectionDetails?: string;
  readonly remoteEntry?: RemoteEntry;
  readonly sudoModeEnabled?: boolean;

  constructor(options: {
    label: string;
    kind: RemoteEditSidebarItemKind;
    collapsibleState?: vscode.TreeItemCollapsibleState;
    icon?: vscode.TreeItem['iconPath'];
    resourceUri?: vscode.Uri;
    description?: string;
    tooltip?: string | vscode.MarkdownString;
    command?: vscode.Command;
    contextValue?: string;
    id?: string;
    profileId?: string;
    connectionId?: string;
    host?: string;
    remotePath?: string;
    transferId?: string;
    transferStatus?: string;
    transferDetails?: string;
    canCancelTransfer?: boolean;
    connectionDetailField?: ConnectionDetailField;
    connectionDetailValue?: string;
    connectionDetails?: string;
    remoteEntry?: RemoteEntry;
    sudoModeEnabled?: boolean;
  }) {
    super(options.label, options.collapsibleState ?? vscode.TreeItemCollapsibleState.None);

    this.kind = options.kind;
    this.profileId = options.profileId;
    this.connectionId = options.connectionId;
    this.host = options.host;
    this.remotePath = options.remotePath;
    this.transferId = options.transferId;
    this.transferStatus = options.transferStatus;
    this.transferDetails = options.transferDetails;
    this.canCancelTransfer = options.canCancelTransfer;
    this.connectionDetailField = options.connectionDetailField;
    this.connectionDetailValue = options.connectionDetailValue;
    this.connectionDetails = options.connectionDetails;
    this.remoteEntry = options.remoteEntry;
    this.sudoModeEnabled = options.sudoModeEnabled;
    this.iconPath = options.icon;
    this.resourceUri = options.resourceUri;
    this.description = options.description;
    this.tooltip = options.tooltip;
    this.command = options.command;
    this.contextValue = options.contextValue;
    this.id = options.id;
  }



  static connectionsFilter(filterText: string): RemoteEditSidebarItem {
    const value = filterText.trim();

    return new RemoteEditSidebarItem({
      label: value ? `Filter: ${value}` : 'Filter Connections',
      kind: 'connectionFilter',
      id: 'connections:filter',
      icon: new vscode.ThemeIcon('filter'),
      description: 'Active',
      tooltip: value
        ? `Saved connections are filtered by "${value}". Click to edit the filter.`
        : 'Click to filter saved connections.',
      command: {
        command: 'remoteedit.sidebar.filterConnections',
        title: 'Edit Connection Filter'
      },
      contextValue: 'remoteedit.connectionsFilter'
    });
  }

  static quickConnect(profile: ConnectionProfile, options?: { connecting?: boolean }): RemoteEditSidebarItem {
    const tooltip = new vscode.MarkdownString(undefined, true);

    tooltip.isTrusted = false;
    tooltip.appendMarkdown('**Quick Connect**\n\n');
    tooltip.appendMarkdown('Temporary connection. Fields are not saved as a profile.');

    return new RemoteEditSidebarItem({
      label: 'Quick Connect',
      kind: 'quickConnect',
      id: 'quickConnect',
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      icon: options?.connecting ? new vscode.ThemeIcon('loading~spin') : new vscode.ThemeIcon('zap'),
      tooltip,
      profileId: profile.id,
      host: profile.host,
      contextValue: 'remoteedit.quickConnect'
    });
  }


  static connectionDetail(profile: ConnectionProfile, field: ConnectionDetailField, options?: { quickConnect?: boolean; modified?: boolean }): RemoteEditSidebarItem {
    const detail = buildConnectionDetail(profile, field, { quickConnect: Boolean(options?.quickConnect) });
    const isQuickConnect = Boolean(options?.quickConnect);
    const isCredentials = field === 'credentials';

    return new RemoteEditSidebarItem({
      label: detail.label,
      kind: 'connectionDetail',
      id: `${isQuickConnect ? 'quick' : 'saved'}:${profile.id}:detail:${field}`,
      icon: detail.icon,
      tooltip: detail.tooltip,
      profileId: profile.id,
      host: profile.host,
      connectionDetailField: field,
      connectionDetailValue: detail.value,
      command: {
        command: isCredentials ? 'remoteedit.sidebar.manageConnectionCredentials' : 'remoteedit.sidebar.editConnectionDetail',
        title: isCredentials ? 'Manage Credentials' : 'Edit Connection Field',
        arguments: [profile.id, field]
      },
      contextValue: getConnectionDetailContextValue(field, isQuickConnect, isCredentials)
    });
  }


  static transferGroup(label: string, count: number, id: string): RemoteEditSidebarItem {
    return new RemoteEditSidebarItem({
      label,
      kind: 'transferGroup',
      id: `transferGroup:${id}`,
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      icon: new vscode.ThemeIcon(id === 'completed' ? 'checklist' : id === 'pending' ? 'clock' : 'sync'),
      description: count > 0 ? String(count) : undefined,
      tooltip: `${label}: ${count}`,
      contextValue: 'remoteedit.transferGroup'
    });
  }

  static transferItem(item: TransferQueueItemSnapshot, group: 'current' | 'pending' | 'completed'): RemoteEditSidebarItem {
    const label = formatTransferItemLabel(item);
    const tooltipContent = buildTransferItemTooltipContent(item);
    const tooltip = buildMarkdownTooltip(tooltipContent.title, tooltipContent.lines);
    const contextValue = group === 'pending'
      ? 'remoteedit.transferItem.pending'
      : item.canCancel
        ? 'remoteedit.transferItem.cancelable'
        : 'remoteedit.transferItem';

    return new RemoteEditSidebarItem({
      label,
      kind: 'transferItem',
      id: `transfer:${group}:${item.id}`,
      icon: new vscode.ThemeIcon(item.operation === 'Upload' ? 'arrow-up' : 'arrow-down'),
      description: formatTransferItemDescription(item, label),
      tooltip,
      transferId: item.id,
      transferStatus: item.status,
      transferDetails: formatTooltipPlainText(tooltipContent.title, tooltipContent.lines),
      canCancelTransfer: item.canCancel || group === 'pending',
      contextValue
    });
  }


  static fromConnectionProfile(profile: ConnectionProfile, options?: { modified?: boolean; connected?: boolean; draft?: boolean; connecting?: boolean }): RemoteEditSidebarItem {
    const protocol = String(profile.connectionType || 'sftp').toUpperCase();
    const credentialStatus = formatCredentialStatus(profile);
    const tooltipLines = [
      `Protocol: ${protocol}`,
      `Host: ${profile.host}:${profile.port}`
    ];

    if (profile.username) {
      tooltipLines.push(`Username: ${profile.username}`);
    }

    tooltipLines.push(`Auth: ${profile.authType === 'privateKey' ? 'Private key' : 'Password'}`);

    if (credentialStatus) {
      tooltipLines.push(credentialStatus);
    }

    if (profile.startPath) {
      tooltipLines.push(`Start path: ${profile.startPath}`);
    }

    const tooltip = buildMarkdownTooltip(profile.name, tooltipLines);

    const contextValue = options?.draft
      ? 'remoteedit.savedConnection.draft'
      : options?.modified
        ? options?.connected
          ? 'remoteedit.savedConnection.modified.connected'
          : 'remoteedit.savedConnection.modified.disconnected'
        : options?.connected
          ? 'remoteedit.savedConnection.connected'
          : 'remoteedit.savedConnection.disconnected';

    const icon = getSavedConnectionIcon(options);

    const description = options?.draft
      ? 'Draft'
      : options?.modified
        ? 'Modified'
        : undefined;

    return new RemoteEditSidebarItem({
      label: profile.name,
      kind: 'savedConnection',
      id: `saved:${profile.id}`,
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      icon,
      description,
      tooltip,
      connectionDetails: formatTooltipPlainText(profile.name, tooltipLines),
      profileId: profile.id,
      host: profile.host,
      contextValue
    });
  }

  static fromActiveConnection(connection: ActiveConnection, options?: { sudoModeEnabled?: boolean }): RemoteEditSidebarItem {
    const protocol = String(connection.connectionType || 'sftp').toUpperCase();
    const isSftp = String(connection.connectionType || 'sftp').toLowerCase() === 'sftp';
    const sudoModeEnabled = Boolean(isSftp && options?.sudoModeEnabled);
    const tooltipLines = [
      `Protocol: ${protocol}`,
      `Host: ${connection.host}:${connection.port}`,
      `Username: ${connection.username}`,
      `Start path: ${connection.startPath || '/'}`
    ];

    if (sudoModeEnabled) {
      tooltipLines.push('Sudo Mode: On');
    }

    const tooltip = buildMarkdownTooltip(connection.name, tooltipLines);
    const contextValue = isSftp
      ? sudoModeEnabled
        ? 'remoteedit.openConnection.sudoOn'
        : 'remoteedit.openConnection.sudoOff'
      : 'remoteedit.openConnection';

    return new RemoteEditSidebarItem({
      label: formatOpenConnectionLabel(connection),
      kind: 'openConnection',
      id: `open:${connection.id}`,
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      icon: new vscode.ThemeIcon('vm-active', new vscode.ThemeColor('icon.foreground')),
      description: sudoModeEnabled ? `${protocol} · Sudo On` : protocol,
      tooltip,
      profileId: connection.id,
      connectionId: connection.id,
      host: connection.host,
      resourceUri: getSidebarDecorationResourceUri(connection.id, connection.host || connection.name || connection.id, 'connection'),
      sudoModeEnabled,
      contextValue
    });
  }

  static favoritesGroup(connection: ActiveConnection): RemoteEditSidebarItem {
    return new RemoteEditSidebarItem({
      label: 'Favorites',
      kind: 'favoritesGroup',
      id: `favorites:${connection.id}`,
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      icon: new vscode.ThemeIcon('star-full', new vscode.ThemeColor('icon.foreground')),
      tooltip: `Favorite remote paths for ${connection.name}.`,
      resourceUri: getSidebarDecorationResourceUri(connection.id, 'Favorites', 'favorites'),
      profileId: connection.id,
      connectionId: connection.id,
      host: connection.host,
      contextValue: 'remoteedit.favoritesGroup'
    });
  }

  static favoritePath(connectionId: string, remotePath: string, options?: { isSftp?: boolean }): RemoteEditSidebarItem {
    const pathDisplay = buildSidebarPathDisplay(remotePath);

    return new RemoteEditSidebarItem({
      label: pathDisplay.label,
      kind: 'favoritePath',
      id: `favorite:${connectionId}:${remotePath}`,
      description: pathDisplay.description,
      tooltip: remotePath,
      profileId: connectionId,
      connectionId,
      remotePath,
      command: {
        command: 'remoteedit.sidebar.openFavoritePath',
        title: 'Open Favorite Path',
        arguments: [connectionId, remotePath]
      },
      contextValue: options?.isSftp ? 'remoteedit.favoritePath.sftp' : 'remoteedit.favoritePath'
    });
  }

  static filesGroup(connection: ActiveConnection, rootPath?: string, options?: { isFavorite?: boolean }): RemoteEditSidebarItem {
    const normalizedRoot = normalizeRemotePath(rootPath || connection.startPath || '/');
    const pathDisplay = buildSidebarPathDisplay(normalizedRoot);

    return new RemoteEditSidebarItem({
      label: pathDisplay.label,
      kind: 'filesGroup',
      id: `files:${connection.id}:${normalizedRoot}`,
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      icon: new vscode.ThemeIcon('root-folder', new vscode.ThemeColor('icon.foreground')),
      description: pathDisplay.description,
      tooltip: buildRemoteBrowseTooltipOrEmpty(normalizedRoot),
      resourceUri: getSidebarDecorationResourceUri(connection.id, normalizedRoot, 'root'),
      profileId: connection.id,
      connectionId: connection.id,
      host: connection.host,
      remotePath: normalizedRoot,
      contextValue: options?.isFavorite
        ? isSftpConnection(connection.connectionType) ? 'remoteedit.filesGroup.favorite.sftp' : 'remoteedit.filesGroup.favorite'
        : isSftpConnection(connection.connectionType) ? 'remoteedit.filesGroup.sftp' : 'remoteedit.filesGroup'
    });
  }

  static goParentFolder(connectionId: string, currentPath: string): RemoteEditSidebarItem {
    const normalizedCurrentPath = normalizeRemotePath(currentPath);
    const parentPath = getParentRemotePath(normalizedCurrentPath);

    return new RemoteEditSidebarItem({
      label: '.. Go Parent Folder',
      kind: 'goParentFolder',
      id: `goParent:${connectionId}:${normalizedCurrentPath}`,
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      icon: new vscode.ThemeIcon('arrow-up', new vscode.ThemeColor('icon.foreground')),
      tooltip: buildGoParentTooltipOrEmpty(parentPath),
      resourceUri: getSidebarDecorationResourceUri(connectionId, parentPath, 'parent'),
      profileId: connectionId,
      connectionId,
      remotePath: parentPath,
      command: {
        command: 'remoteedit.sidebar.goParentFolder',
        title: 'Go Parent Folder',
        arguments: [connectionId, parentPath]
      },
      contextValue: 'remoteedit.goParentFolder'
    });
  }

  static remoteDirectoryPlaceholder(connectionId: string, remotePath: string, startPath?: string, options?: { isFavorite?: boolean; isSftp?: boolean }): RemoteEditSidebarItem {
    const normalizedPath = normalizeRemotePath(remotePath);
    const name = normalizedPath === '/' ? '/' : normalizedPath.split('/').filter(Boolean).pop() || normalizedPath;
    const normalizedStartPath = normalizeRemoteRootStartPath(startPath);

    return new RemoteEditSidebarItem({
      label: name,
      kind: 'remoteDirectory',
      id: `remote:${connectionId}:${normalizedPath}`,
      collapsibleState: isPathAncestorOrSelf(normalizedPath, normalizedStartPath)
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
      tooltip: buildRemotePathTooltipOrEmpty(normalizedPath),
      resourceUri: getSidebarDecorationResourceUri(connectionId, normalizedPath, 'directory'),
      profileId: connectionId,
      connectionId,
      remotePath: normalizedPath,
      command: {
        command: 'remoteedit.primary.openDirectoryAsRootDirectory',
        title: 'Open as Root Directory',
        arguments: [connectionId, normalizedPath]
      },
      contextValue: options?.isFavorite
        ? options?.isSftp ? 'remoteedit.remoteDirectory.favorite.sftp' : 'remoteedit.remoteDirectory.favorite'
        : options?.isSftp ? 'remoteedit.remoteDirectory.sftp' : 'remoteedit.remoteDirectory'
    });
  }

  static fromRemoteEntry(connectionId: string, entry: RemoteEntry, startPath?: string, options?: { isFavorite?: boolean; isSftp?: boolean }): RemoteEditSidebarItem {
    const resolvedType = resolveRemoteEntryType(entry);
    const isDirectory = resolvedType === 'directory';
    const isFile = resolvedType === 'file';
    const itemKind: RemoteEditSidebarItemKind = isDirectory ? 'remoteDirectory' : isFile ? 'remoteFile' : 'remoteEntry';
    const remotePath = normalizeRemotePath(entry.path || entry.name || '/');
    const normalizedStartPath = normalizeRemoteRootStartPath(startPath);
    const shouldExpand = isDirectory && isPathAncestorOrSelf(remotePath, normalizedStartPath);
    const tooltip = buildRemoteEntryTooltipOrEmpty(entry, resolvedType);
    const resourceUri = getRemoteEntryResourceUri(entry, resolvedType, remotePath, connectionId);
    const description = buildRemoteEntryDescription(entry, resolvedType);

    return new RemoteEditSidebarItem({
      label: entry.name || remotePath,
      kind: itemKind,
      id: `remote:${connectionId}:${remotePath}`,
      collapsibleState: isDirectory
        ? shouldExpand
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      icon: getRemoteEntryIcon(entry, resolvedType),
      resourceUri,
      description,
      tooltip,
      profileId: connectionId,
      connectionId,
      remotePath,
      remoteEntry: entry,
      command: isDirectory
        ? {
            command: 'remoteedit.primary.openDirectoryAsRootDirectory',
            title: 'Open as Root Directory',
            arguments: [connectionId, remotePath]
          }
        : isFile
          ? {
              command: 'remoteedit.sidebar.openRemoteFile',
              title: 'Open Remote File',
              arguments: [connectionId, remotePath]
            }
          : undefined,
      contextValue: isDirectory
        ? options?.isFavorite
          ? options?.isSftp ? 'remoteedit.remoteDirectory.favorite.sftp' : 'remoteedit.remoteDirectory.favorite'
          : options?.isSftp ? 'remoteedit.remoteDirectory.sftp' : 'remoteedit.remoteDirectory'
        : isFile
          ? options?.isSftp ? 'remoteedit.remoteFile.sftp' : 'remoteedit.remoteFile'
          : 'remoteedit.remoteEntry'
    });
  }
}


function getConnectionDetailContextValue(field: ConnectionDetailField, isQuickConnect: boolean, isCredentials: boolean): string {
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

function isSftpConnection(connectionType: unknown): boolean {
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


function getSavedConnectionIcon(options?: { modified?: boolean; connected?: boolean; draft?: boolean; connecting?: boolean }): vscode.TreeItem['iconPath'] {
  if (options?.connecting) {
    return new vscode.ThemeIcon('loading~spin');
  }

  if (options?.draft) {
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

function getResourceIcon(fileName: string): vscode.Uri {
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
  }

  fields.push('startPath', 'keepAlive', 'credentials');
  return fields;
}

function buildConnectionDetail(profile: ConnectionProfile, field: ConnectionDetailField, options?: { quickConnect?: boolean }): {
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

function formatAuthType(value: AuthType): string {
  return value === 'privateKey' ? 'Private key' : 'Password';
}

function getSavedCredentialLabel(profile: ConnectionProfile, quickConnect: boolean): string {
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

function normalizeRemoteRootStartPath(startPath: string | undefined): string {
  return normalizeRemotePath(startPath);
}

const SIDEBAR_PARENT_PATH_SEGMENTS = 3;

function buildSidebarPathDisplay(remotePath: string): { label: string; description?: string } {
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

function shouldShowSidebarParentPath(): boolean {
  return vscode.workspace.getConfiguration('remoteedit.sidebar').get<boolean>('showParentPath', true);
}

function formatSidebarParentPath(parentPath: string): string {
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

function getRemotePathBasename(remotePath: string): string {
  const normalizedPath = normalizeRemotePath(remotePath);

  if (normalizedPath === '/') {
    return '/';
  }

  return normalizedPath.split('/').filter(Boolean).pop() || normalizedPath;
}


function formatOpenConnectionLabel(connection: ActiveConnection): string {
  const name = String(connection.name || '').trim();
  const host = String(connection.host || '').trim();

  return name || host || connection.id;
}

function formatCredentialStatus(profile: ConnectionProfile): string {
  if (profile.authType === 'privateKey') {
    return profile.hasSavedPassphrase ? 'Saved passphrase available.' : '';
  }

  return profile.hasSavedPassword ? 'Saved password available.' : '';
}

function resolveRemoteEntryType(entry: RemoteEntry): RemoteEntryType {
  return entry.effectiveType || entry.type || 'unknown';
}

function getRemoteEntryIcon(entry: RemoteEntry, _resolvedType: RemoteEntryType): vscode.ThemeIcon | undefined {
  // Keep directories aligned with the native TreeView rendering. File icons are
  // driven by resourceUri so the active VS Code file icon theme can decide.
  if (entry.type === 'link') {
    return undefined;
  }

  return undefined;
}

function getRemoteEntryResourceUri(entry: RemoteEntry, resolvedType: RemoteEntryType, remotePath: string, connectionId: string): vscode.Uri | undefined {
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

function getSidebarDecorationResourceUri(connectionId: string, value: string, kind: string): vscode.Uri {
  const safePath = `/${encodeURIComponent(kind)}/${encodeURIComponent(value || connectionId)}`;
  return vscode.Uri.from({
    scheme: 'remoteedit-sidebar',
    path: safePath,
    query: `connectionId=${encodeURIComponent(connectionId)}`
  });
}

function withSidebarDecorationQuery(uri: vscode.Uri, connectionId: string, kind: string, remotePath: string): vscode.Uri {
  return uri.with({
    query: `connectionId=${encodeURIComponent(connectionId)}&kind=${encodeURIComponent(kind)}&remotePath=${encodeURIComponent(remotePath)}`
  });
}

function buildRemoteEntryDescription(entry: RemoteEntry, resolvedType: RemoteEntryType): string | undefined {
  if (entry.type === 'link') {
    return 'link';
  }

  if (resolvedType === 'file' && typeof entry.size === 'number') {
    return formatBytes(entry.size);
  }

  return undefined;
}

function shouldShowItemInfoOnHover(): boolean {
  return vscode.workspace.getConfiguration('remoteedit.sidebar').get<boolean>('showItemInfoOnHover', false);
}

function buildEmptyHoverTooltip(): vscode.MarkdownString {
  // VS Code falls back to resourceUri hover text when TreeItem.tooltip is
  // undefined or an empty string. Keep resourceUri available for file icons and
  // sidebar decorations, but provide an explicit empty MarkdownString so remote
  // file/folder rows do not show the automatic URI hover when disabled.
  const tooltip = new vscode.MarkdownString('', true);
  tooltip.isTrusted = false;
  return tooltip;
}

function buildRemoteEntryTooltipOrEmpty(entry: RemoteEntry, resolvedType: RemoteEntryType): vscode.MarkdownString {
  return shouldShowItemInfoOnHover()
    ? buildRemoteEntryTooltip(entry, resolvedType)
    : buildEmptyHoverTooltip();
}

function buildRemotePathTooltipOrEmpty(remotePath: string): string | vscode.MarkdownString {
  return shouldShowItemInfoOnHover() ? remotePath : buildEmptyHoverTooltip();
}

function buildRemoteBrowseTooltipOrEmpty(remotePath: string): string | vscode.MarkdownString {
  return shouldShowItemInfoOnHover() ? `Browse ${remotePath}.` : buildEmptyHoverTooltip();
}

function buildGoParentTooltipOrEmpty(parentPath: string): string | vscode.MarkdownString {
  return shouldShowItemInfoOnHover() ? `Go to ${parentPath}.` : buildEmptyHoverTooltip();
}

function buildRemoteEntryTooltip(entry: RemoteEntry, resolvedType: RemoteEntryType): vscode.MarkdownString {
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
    lines.push(formatTooltipField('Permissions', entry.permissions));
  }

  if (entry.owner !== undefined || entry.group !== undefined) {
    lines.push(formatTooltipField('Owner/Group', `${String(entry.owner ?? '')}:${String(entry.group ?? '')}`));
  }

  if (entry.modifyTime) {
    lines.push(formatTooltipField('Modified', formatRemoteTimestamp(entry.modifyTime)));
  }

  return buildMarkdownTooltip(entry.name || entry.path || 'Remote item', lines);
}

function formatRemoteTimestamp(value: number): string {
  const timestamp = value > 0 && value < 100000000000 ? value * 1000 : value;
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function formatBytes(value: number): string {

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


function formatTransferItemLabel(item: TransferQueueItemSnapshot): string {
  const title = String(item.title || '').trim();

  if (title) {
    return title;
  }

  const source = item.operation === 'Upload' ? item.from : item.to;
  const fallback = source.split(/[\\/]/).filter(Boolean).pop() || source || item.operation;
  return `${item.operation} ${fallback}`;
}


function formatTransferItemDescription(item: TransferQueueItemSnapshot, label: string): string {
  const status = String(item.status || '').trim();
  const progress = String(item.progress || '').trim();

  if (status === 'Running' && progress && progress !== '--') {
    return `Running - ${stripLeadingTransferItemLabel(stripTrailingSentencePunctuation(progress), label)}`;
  }

  return status;
}

function stripLeadingTransferItemLabel(value: string, label: string): string {
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

function stripTrailingSentencePunctuation(value: string): string {
  return value.replace(/[.!?…]+$/g, '');
}

function buildTransferItemTooltipContent(item: TransferQueueItemSnapshot): { title: string; lines: string[] } {
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

function formatTransferItemTimestampLine(item: TransferQueueItemSnapshot): string {
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


function formatTooltipPlainText(title: string, lines: string[]): string {
  const filteredLines = lines.map(line => String(line || '').trim()).filter(Boolean);
  return [String(title || '').trim(), '', ...filteredLines].filter((line, index) => index !== 0 || line).join('\n');
}

function buildMarkdownTooltip(title: string, lines: string[]): vscode.MarkdownString {
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

function formatTooltipField(label: string, value: unknown): string {
  return `${label}: ${String(value ?? '')}`;
}


function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, '\\$&');
}
