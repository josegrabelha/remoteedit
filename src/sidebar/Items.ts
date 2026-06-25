import * as path from 'path';
import * as vscode from 'vscode';
import type { AuthType, ConnectionGroup, ConnectionProfile } from '../connection/ConnectionManager';
import type { ActiveConnection, RemoteEntry, RemoteEntryType } from '../remote/RemoteSessionManager';
import type { TransferQueueItemSnapshot } from '../panel/RemoteEditPanel';
import { buildConnectionDetail, buildGoParentTooltipOrEmpty, buildMarkdownTooltip, buildRemoteBrowseTooltipOrEmpty, buildRemoteEntryDescription, buildRemoteEntryTooltipOrEmpty, buildRemotePathTooltipOrEmpty, buildSidebarPathDisplay, buildTransferItemTooltipContent, formatCredentialStatus, formatOpenConnectionLabel, formatTooltipPlainText, formatTransferItemDescription, formatTransferItemLabel, getConnectionDetailContextValue, getParentRemotePath, getRemoteEntryIcon, getRemoteEntryResourceUri, getRemotePathBasename, getSavedConnectionIcon, getSidebarDecorationResourceUri, isPathAncestorOrSelf, isSftpConnection, normalizeRemotePath, normalizeRemoteRootStartPath, resolveRemoteEntryType, type ConnectionDetailField } from './ItemHelpers';
export { getConnectionDetailFields, getParentRemotePath, normalizeRemotePath, sortRemoteEntries, type ConnectionDetailField } from './ItemHelpers';

export type RemoteEditSidebarItemKind =
  | 'action'
  | 'placeholder'
  | 'connectionFilter'
  | 'quickConnect'
  | 'connectionGroup'
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
  readonly groupId?: string;
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
    groupId?: string;
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
    this.groupId = options.groupId;
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



  static connectionGroup(group: ConnectionGroup, count: number, options?: { expanded?: boolean; renderVersion?: number }): RemoteEditSidebarItem {
    const renderVersion = Number.isFinite(options?.renderVersion) ? options?.renderVersion : 0;

    return new RemoteEditSidebarItem({
      label: group.name || 'Connections',
      kind: 'connectionGroup',
      id: `connectionGroup:${group.id}:${renderVersion}`,
      collapsibleState: options?.expanded === false ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
      icon: new vscode.ThemeIcon('folder'),
      description: count > 0 ? String(count) : undefined,
      tooltip: `${group.name || 'Connections'}: ${count} saved connection${count === 1 ? '' : 's'}`,
      groupId: group.id,
      contextValue: 'remoteedit.connectionGroup'
    });
  }

  static connectionDetail(profile: ConnectionProfile, field: ConnectionDetailField, options?: { quickConnect?: boolean; modified?: boolean; connected?: boolean }): RemoteEditSidebarItem {
    const detail = buildConnectionDetail(profile, field, { quickConnect: Boolean(options?.quickConnect) });
    const isQuickConnect = Boolean(options?.quickConnect);
    const isCredentials = field === 'credentials';
    const isReadOnly = !isQuickConnect && Boolean(options?.connected);
    const contextValue = isReadOnly
      ? field === 'ftpsCaCertificatePath'
        ? 'remoteedit.connectionDetail.ftpsCaCertificatePath.readonly'
        : isCredentials
          ? 'remoteedit.connectionDetail.credentials.readonly'
          : 'remoteedit.connectionDetail.readonly'
      : getConnectionDetailContextValue(field, isQuickConnect, isCredentials);

    return new RemoteEditSidebarItem({
      label: detail.label,
      kind: 'connectionDetail',
      id: `${isQuickConnect ? 'quick' : 'saved'}:${profile.id}:detail:${field}`,
      icon: detail.icon,
      tooltip: isReadOnly ? `${detail.label}\n\nDisconnect to edit this connection.` : detail.tooltip,
      profileId: profile.id,
      host: profile.host,
      connectionDetailField: field,
      connectionDetailValue: detail.value,
      command: isReadOnly
        ? undefined
        : {
            command: isCredentials ? 'remoteedit.sidebar.manageConnectionCredentials' : 'remoteedit.sidebar.editConnectionDetail',
            title: isCredentials ? 'Manage Credentials' : 'Edit Connection Field',
            arguments: [profile.id, field]
          },
      contextValue
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
