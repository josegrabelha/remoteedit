import * as vscode from 'vscode';
import { ConnectionManager, type ConnectionGroup, type ConnectionProfile } from '../connection/ConnectionManager';
import { RemoteEditPanel } from '../panel/RemoteEditPanel';
import { RemoteEditSharedState } from '../state/RemoteEditSharedState';
import { isWindowsRemotePlatform } from '../remote/RemotePlatform';
import type { RemoteEntry, RemoteSessionManager } from '../remote/RemoteSessionManager';
import { getConnectionDetailFields, getParentRemotePath, getSidebarOpenConnectionsPathView, isPathAncestorOrSelf, normalizeRemotePath, RemoteEditSidebarItem, sortRemoteEntries } from './Items';
import { appendPerformanceLog, createPerformanceTimer } from '../utils/outputLogger';

const COMMAND_OPEN = 'remoteedit.open';
const COMMAND_OPEN_SETTINGS = 'remoteedit.sidebar.openSettings';
const COMMAND_EXPORT_BACKUP = 'remoteedit.sidebar.exportBackup';
const COMMAND_IMPORT_BACKUP = 'remoteedit.sidebar.importBackup';
const COMMAND_OPEN_LOG_VIEWER = 'remoteedit.sidebar.openLogViewer';

export interface RemoteEditActionsTreeProviderOptions {
  hasLogViewerConnection(): boolean;
}

export class RemoteEditActionsTreeProvider implements vscode.TreeDataProvider<RemoteEditSidebarItem>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RemoteEditSidebarItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly options: RemoteEditActionsTreeProviderOptions) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }

  getTreeItem(element: RemoteEditSidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: RemoteEditSidebarItem): vscode.ProviderResult<RemoteEditSidebarItem[]> {
    if (element) {
      return [];
    }

    const canOpenLogViewer = this.options.hasLogViewerConnection();

    return [
      new RemoteEditSidebarItem({
        label: 'Remote Edit (Advanced View)',
        kind: 'action',
        id: 'action:advancedView',
        icon: new vscode.ThemeIcon('remote-explorer'),
        tooltip: 'Open the main Remote Edit panel.',
        command: {
          command: COMMAND_OPEN,
          title: 'Remote Edit (Advanced View)'
        },
        contextValue: 'remoteedit.action.advancedView'
      }),
      new RemoteEditSidebarItem({
        label: 'Log Viewer',
        kind: 'action',
        id: 'action:logViewer',
        icon: canOpenLogViewer
          ? new vscode.ThemeIcon('output')
          : new vscode.ThemeIcon('output', new vscode.ThemeColor('disabledForeground')),
        tooltip: canOpenLogViewer
          ? 'Open Log Viewer for the active SSH/SFTP connection.'
          : 'Log Viewer requires an active SSH/SFTP connection.',
        command: canOpenLogViewer
          ? {
            command: COMMAND_OPEN_LOG_VIEWER,
            title: 'Log Viewer'
          }
          : undefined,
        contextValue: canOpenLogViewer
          ? 'remoteedit.action.logViewer'
          : 'remoteedit.action.logViewer.disabled'
      }),
      new RemoteEditSidebarItem({
        label: 'Export Backup',
        kind: 'action',
        id: 'action:exportBackup',
        icon: new vscode.ThemeIcon('sign-out'),
        tooltip: 'Export Remote Edit data.',
        command: {
          command: COMMAND_EXPORT_BACKUP,
          title: 'Export Backup'
        },
        contextValue: 'remoteedit.action.exportBackup'
      }),
      new RemoteEditSidebarItem({
        label: 'Import Backup',
        kind: 'action',
        id: 'action:importBackup',
        icon: new vscode.ThemeIcon('sign-in'),
        tooltip: 'Import Remote Edit data.',
        command: {
          command: COMMAND_IMPORT_BACKUP,
          title: 'Import Backup'
        },
        contextValue: 'remoteedit.action.importBackup'
      }),
      new RemoteEditSidebarItem({
        label: 'Settings',
        kind: 'action',
        id: 'action:settings',
        icon: new vscode.ThemeIcon('settings-gear'),
        tooltip: 'Open Remote Edit settings.',
        command: {
          command: COMMAND_OPEN_SETTINGS,
          title: 'Settings'
        },
        contextValue: 'remoteedit.action.settings'
      })
    ];
  }
}

export interface ConnectionsTreeProviderOptions {
  getQuickConnectProfile(): ConnectionProfile;
  getDraftProfile(profile: ConnectionProfile): ConnectionProfile;
  getNewDraftProfiles(): ConnectionProfile[];
  getDraftProfileById(profileId: string): ConnectionProfile | undefined;
  hasDraft(profileId: string): boolean;
  isConnected(profileId: string): boolean;
  isConnecting(profileId: string): boolean;
}


export class ConnectionsTreeProvider implements vscode.TreeDataProvider<RemoteEditSidebarItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RemoteEditSidebarItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private readonly collapsedGroupIds = new Set<string>();
  private connectionGroupRenderVersion = 0;
  private filterText = '';

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly options: ConnectionsTreeProviderOptions
  ) {}

  getTreeItem(element: RemoteEditSidebarItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RemoteEditSidebarItem): Promise<RemoteEditSidebarItem[]> {
    if (element?.kind === 'quickConnect') {
      const profile = this.options.getQuickConnectProfile();
      return getConnectionDetailFields(profile)
        .map(field => RemoteEditSidebarItem.connectionDetail(profile, field, { quickConnect: true }));
    }

    if (element?.kind === 'connectionGroup' && element.groupId) {
      const profiles = await this.connectionManager.listProfiles();
      const connectionGroups = await this.connectionManager.listGroups();
      const filterText = this.normalizeFilterText(this.filterText);
      return profiles
        .filter(profile => profile.groupId === element.groupId)
        .filter(profile => !filterText || this.matchesFilter(this.options.getDraftProfile(profile), filterText, connectionGroups))
        .map(profile => RemoteEditSidebarItem.fromConnectionProfile(
          this.options.getDraftProfile(profile),
          { modified: this.options.hasDraft(profile.id), connected: this.options.isConnected(profile.id), connecting: this.options.isConnecting(profile.id) }
        ));
    }

    if (element?.kind === 'savedConnection' && element.profileId) {
      const profile = await this.connectionManager.getProfile(element.profileId);
      const draftProfile = profile
        ? this.options.getDraftProfile(profile)
        : this.options.getDraftProfileById(element.profileId);

      if (!draftProfile) {
        return [];
      }

      return getConnectionDetailFields(draftProfile)
        .map(field => RemoteEditSidebarItem.connectionDetail(draftProfile, field, { connected: this.options.isConnected(element.profileId!) }));
    }

    if (element) {
      return [];
    }

    const profiles = await this.connectionManager.listProfiles();
    const connectionGroups = await this.connectionManager.listGroups();
    const newDraftProfiles = this.options.getNewDraftProfiles();
    const filterText = this.normalizeFilterText(this.filterText);
    const filteredNewDraftProfiles = filterText
      ? newDraftProfiles.filter(profile => this.matchesFilter(profile, filterText, connectionGroups))
      : newDraftProfiles;
    const filteredProfiles = filterText
      ? profiles.filter(profile => this.matchesFilter(this.options.getDraftProfile(profile), filterText, connectionGroups))
      : profiles;
    const groupedProfiles = connectionGroups.length
      ? this.groupProfiles(filteredProfiles, connectionGroups)
      : undefined;
    void vscode.commands.executeCommand('setContext', 'remoteedit.connectionsHaveGroups', Boolean(groupedProfiles?.grouped.length));
    const items: RemoteEditSidebarItem[] = [];

    if (filterText) {
      items.push(RemoteEditSidebarItem.connectionsFilter(this.filterText));
    }

    items.push(RemoteEditSidebarItem.quickConnect(
      this.options.getQuickConnectProfile(),
      { connecting: this.options.isConnecting('__remoteeditQuickConnect') }
    ));

    if (profiles.length === 0 && newDraftProfiles.length === 0) {
      items.push(new RemoteEditSidebarItem({
        label: 'No saved connections',
        kind: 'placeholder',
        icon: new vscode.ThemeIcon('info'),
        tooltip: 'Saved connections created in Remote Edit will appear here.',
        contextValue: 'remoteedit.placeholder'
      }));
      return items;
    }

    if (filterText && filteredProfiles.length === 0 && filteredNewDraftProfiles.length === 0) {
      items.push(new RemoteEditSidebarItem({
        label: 'No matching connections',
        kind: 'placeholder',
        icon: new vscode.ThemeIcon('search'),
        description: this.filterText,
        tooltip: `No saved connections match "${this.filterText}".`,
        contextValue: 'remoteedit.placeholder'
      }));
      return items;
    }

    items.push(...filteredNewDraftProfiles.map(profile => RemoteEditSidebarItem.fromConnectionProfile(
      profile,
      { draft: true, connected: false, connecting: this.options.isConnecting(profile.id) }
    )));

    if (groupedProfiles) {
      for (const bucket of groupedProfiles.grouped) {
        items.push(RemoteEditSidebarItem.connectionGroup(bucket.group, bucket.profiles.length, { expanded: !this.collapsedGroupIds.has(bucket.group.id), renderVersion: this.connectionGroupRenderVersion }));
      }

      items.push(...groupedProfiles.loose.map(profile => RemoteEditSidebarItem.fromConnectionProfile(
        this.options.getDraftProfile(profile),
        { modified: this.options.hasDraft(profile.id), connected: this.options.isConnected(profile.id), connecting: this.options.isConnecting(profile.id) }
      )));
    } else {
      items.push(...filteredProfiles.map(profile => RemoteEditSidebarItem.fromConnectionProfile(
        this.options.getDraftProfile(profile),
        { modified: this.options.hasDraft(profile.id), connected: this.options.isConnected(profile.id), connecting: this.options.isConnecting(profile.id) }
      )));
    }
    return items;
  }

  getFilterText(): string {
    return this.filterText;
  }

  setFilterText(value: string): void {
    this.filterText = value.trim();
    this.refresh();
  }

  refresh(element?: RemoteEditSidebarItem): void {
    this.onDidChangeTreeDataEmitter.fire(element);
  }

  markGroupExpanded(groupId: string): void {
    this.collapsedGroupIds.delete(groupId);
  }

  markGroupCollapsed(groupId: string): void {
    this.collapsedGroupIds.add(groupId);
  }

  expandAllGroups(): void {
    this.collapsedGroupIds.clear();
    this.connectionGroupRenderVersion += 1;
    this.refresh();
  }

  async hasVisibleConnectionGroups(): Promise<boolean> {
    const profiles = await this.connectionManager.listProfiles();
    const connectionGroups = await this.connectionManager.listGroups();

    if (!connectionGroups.length) {
      return false;
    }

    const filterText = this.normalizeFilterText(this.filterText);
    const filteredProfiles = filterText
      ? profiles.filter(profile => this.matchesFilter(this.options.getDraftProfile(profile), filterText, connectionGroups))
      : profiles;

    return this.groupProfiles(filteredProfiles, connectionGroups).grouped.length > 0;
  }

  private normalizeFilterText(value: string): string {
    return value.trim().toLowerCase();
  }

  private matchesFilter(profile: ConnectionProfile, filterText: string, groups: ConnectionGroup[] = []): boolean {
    const groupName = groups.find(group => group.id === profile.groupId)?.name || '';
    const searchableText = [
      profile.name,
      profile.host,
      profile.username,
      profile.connectionType,
      groupName
    ].filter(Boolean).join(' ').toLowerCase();

    return searchableText.includes(filterText);
  }

  private groupProfiles(profiles: ConnectionProfile[], groups: ConnectionGroup[]): { grouped: Array<{ group: ConnectionGroup; profiles: ConnectionProfile[] }>; loose: ConnectionProfile[] } {
    const orderedGroups = [...groups].sort((a, b) => {
      const nameCompare = String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
      return nameCompare || String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
    const grouped = orderedGroups.map(group => ({ group, profiles: [] as ConnectionProfile[] }));
    const bucketById = new Map(grouped.map(bucket => [bucket.group.id, bucket]));
    const loose: ConnectionProfile[] = [];

    for (const profile of profiles) {
      const bucket = bucketById.get(profile.groupId || '');
      if (bucket) {
        bucket.profiles.push(profile);
      } else {
        loose.push(profile);
      }
    }

    return {
      grouped: grouped.filter(bucket => bucket.profiles.length > 0),
      loose
    };
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}

export class OpenConnectionsTreeProvider implements vscode.TreeDataProvider<RemoteEditSidebarItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RemoteEditSidebarItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private readonly rootPaths = new Map<string, string>();
  private readonly directoryListSequences = new Map<string, number>();
  private readonly directoryListChains = new Map<string, Promise<void>>();
  private readonly forceRefreshPaths = new Set<string>();
  private readonly fullPathTreeTrailPaths = new Map<string, string>();
  private readonly fullPathTreeDirectoryEntrySnapshots = new Map<string, RemoteEntry[]>();
  private readonly breadcrumbCollapseVersions = new Map<string, number>();

  constructor(
    private readonly sessions: RemoteSessionManager,
    private readonly connectionManager: ConnectionManager,
    private readonly output?: vscode.OutputChannel
  ) {}

  getTreeItem(element: RemoteEditSidebarItem): vscode.TreeItem {
    return element;
  }

  getParent(element: RemoteEditSidebarItem): vscode.ProviderResult<RemoteEditSidebarItem> {
    if (element.kind === 'favoritesGroup') {
      const connection = element.connectionId ? this.sessions.getConnection(element.connectionId) : undefined;
      return connection ? RemoteEditSidebarItem.fromActiveConnection(connection, { sudoModeEnabled: this.sessions.isSudoModeEnabled(connection.id) }) : undefined;
    }

    if (element.kind === 'filesGroup') {
      const connection = element.connectionId ? this.sessions.getConnection(element.connectionId) : undefined;

      if (!connection) {
        return undefined;
      }

      const rootPath = this.getRootPath(connection);
      const normalizedRootPath = normalizeRemotePath(rootPath);

      if (this.isPathTreeView() && normalizedRootPath !== '/') {
        return RemoteEditSidebarItem.pathSegment(connection, getParentRemotePath(normalizedRootPath));
      }

      return RemoteEditSidebarItem.fromActiveConnection(connection, { sudoModeEnabled: this.sessions.isSudoModeEnabled(connection.id) });
    }

    if (element.kind === 'pathSegment' && element.connectionId && element.remotePath) {
      const connection = this.sessions.getConnection(element.connectionId);

      if (!connection) {
        return undefined;
      }

      const normalizedPath = normalizeRemotePath(element.remotePath);
      return normalizedPath === '/'
        ? RemoteEditSidebarItem.fromActiveConnection(connection, { sudoModeEnabled: this.sessions.isSudoModeEnabled(connection.id) })
        : RemoteEditSidebarItem.pathSegment(connection, getParentRemotePath(normalizedPath));
    }

    if (element.kind === 'goParentFolder' && element.connectionId) {
      const connection = this.sessions.getConnection(element.connectionId);
      return connection ? RemoteEditSidebarItem.filesGroup(connection, this.getRootPath(connection)) : undefined;
    }

    if (element.kind === 'favoritePath' && element.connectionId) {
      const connection = this.sessions.getConnection(element.connectionId);
      return connection ? RemoteEditSidebarItem.favoritesGroup(connection) : undefined;
    }

    if ((element.kind === 'remoteDirectory' || element.kind === 'remoteFile' || element.kind === 'remoteEntry') && element.connectionId && element.remotePath) {
      const connection = this.sessions.getConnection(element.connectionId);
      const parentPath = getParentRemotePath(element.remotePath);

      if (!connection) {
        return undefined;
      }

      const rootPath = this.getRootPath(connection);
      return parentPath === rootPath || parentPath === '/'
        ? RemoteEditSidebarItem.filesGroup(connection, rootPath)
        : RemoteEditSidebarItem.remoteDirectoryPlaceholder(element.connectionId, parentPath, rootPath, {
          isSftp: isSftpConnection(connection.connectionType) && !isWindowsRemotePlatform(connection.remotePlatform),
          isWindowsSftp: isSftpConnection(connection.connectionType) && isWindowsRemotePlatform(connection.remotePlatform)
        });
    }

    return undefined;
  }

  async getChildren(element?: RemoteEditSidebarItem): Promise<RemoteEditSidebarItem[]> {
    if (!element) {
      return this.getOpenConnectionItems();
    }

    if (element.kind === 'openConnection' && element.connectionId) {
      const connection = this.sessions.getConnection(element.connectionId);

      if (!connection) {
        return [];
      }

      const rootPath = this.getRootPath(connection);
      const favoriteRemotePaths = await this.getFavoriteRemotePaths(element.connectionId);

      const pathItems = this.isPathTreeView()
        ? this.getPathTreeRootItems(connection, rootPath, favoriteRemotePaths)
        : [RemoteEditSidebarItem.filesGroup(connection, rootPath, { isFavorite: isFavoriteRemotePath(rootPath, favoriteRemotePaths) })];

      return [
        RemoteEditSidebarItem.favoritesGroup(connection),
        ...pathItems
      ];
    }

    if (element.kind === 'favoritesGroup' && element.connectionId) {
      return this.getFavoritePathItems(element.connectionId);
    }

    if (element.kind === 'pathSegment' && element.connectionId && element.remotePath) {
      return this.getPathSegmentChildren(element.connectionId, element.remotePath);
    }

    if ((element.kind === 'filesGroup' || element.kind === 'remoteDirectory') && element.connectionId && element.remotePath) {
      return this.getRemoteDirectoryItems(element.connectionId, element.remotePath, element.kind === 'filesGroup');
    }

    return [];
  }

  async getStartPathItem(connectionId: string): Promise<RemoteEditSidebarItem | undefined> {
    const connection = this.sessions.getConnection(connectionId);

    if (!connection) {
      return undefined;
    }

    const startPath = this.getRootPath(connection);
    const favoriteRemotePaths = await this.getFavoriteRemotePaths(connectionId);

    return RemoteEditSidebarItem.filesGroup(connection, startPath, { isFavorite: isFavoriteRemotePath(startPath, favoriteRemotePaths) });
  }

  setRootPath(connectionId: string, remotePath: string, source: 'sidebar' | 'webview' | 'session' = 'sidebar'): void {
    const normalizedPath = normalizeRemotePath(remotePath);
    const previousPath = this.rootPaths.get(connectionId) || RemoteEditSharedState.getNavigation(connectionId)?.rootPath;

    if (previousPath && normalizeRemotePath(previousPath) !== normalizedPath) {
      this.bumpBreadcrumbCollapseVersion(connectionId);
    }

    this.rootPaths.set(connectionId, normalizedPath);
    this.updateFullPathTreeTrailPath(connectionId, normalizedPath);
    RemoteEditSharedState.setNavigation(connectionId, normalizedPath, normalizedPath, source);
    this.refresh();
  }

  getRootPathForConnection(connectionId: string): string | undefined {
    const connection = this.sessions.getConnection(connectionId);
    return connection ? this.getRootPath(connection) : undefined;
  }

  refresh(element?: RemoteEditSidebarItem, options: { forceRefresh?: boolean } = {}): void {
    if (options.forceRefresh && element?.connectionId && element.remotePath) {
      this.forceRefreshPaths.add(this.buildRefreshKey(element.connectionId, element.remotePath));
    }
    this.onDidChangeTreeDataEmitter.fire(element);
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }

  private buildRefreshKey(connectionId: string, remotePath: string): string {
    return `${connectionId}:${normalizeRemotePath(remotePath)}`;
  }

  private getRootPath(connection: { id: string; startPath?: string }): string {
    return this.rootPaths.get(connection.id)
      || RemoteEditSharedState.getNavigation(connection.id)?.rootPath
      || normalizeRemotePath(connection.startPath || '/');
  }

  private async getFavoriteRemotePaths(connectionId: string): Promise<string[]> {
    const profile = await this.connectionManager.getProfile(connectionId);
    return profile?.favoriteRemotePaths || [];
  }

  private bumpBreadcrumbCollapseVersion(connectionId: string): void {
    this.breadcrumbCollapseVersions.set(connectionId, (this.breadcrumbCollapseVersions.get(connectionId) || 0) + 1);
  }

  private getBreadcrumbDirectoryIdentityScope(connectionId: string, remotePath: string): string | undefined {
    if (!this.isBreadcrumbPathView()) {
      return undefined;
    }

    const version = this.breadcrumbCollapseVersions.get(connectionId) || 0;
    return `breadcrumb:${version}:${normalizeRemotePath(remotePath)}`;
  }

  private getOpenConnectionItems(): RemoteEditSidebarItem[] {
    const connections = this.sessions.listConnections();

    if (connections.length === 0) {
      return [];
    }

    return connections.map(connection => RemoteEditSidebarItem.fromActiveConnection(connection, { sudoModeEnabled: this.sessions.isSudoModeEnabled(connection.id) }));
  }

  private getPathView(): ReturnType<typeof getSidebarOpenConnectionsPathView> {
    return getSidebarOpenConnectionsPathView();
  }

  private isFullPathTreeView(): boolean {
    return this.getPathView() === 'fullPathTree';
  }

  private isBreadcrumbPathView(): boolean {
    return this.getPathView() === 'breadcrumb';
  }

  private isPathTreeView(): boolean {
    return this.isBreadcrumbPathView() || this.isFullPathTreeView();
  }

  private getPathTreeRootItems(connection: { id: string; startPath?: string }, rootPath: string, favoriteRemotePaths: string[]): RemoteEditSidebarItem[] {
    const activeConnection = this.sessions.getConnection(connection.id);

    if (!activeConnection) {
      return [];
    }

    const normalizedRootPath = normalizeRemotePath(rootPath);

    if (normalizedRootPath === '/') {
      return [RemoteEditSidebarItem.filesGroup(activeConnection, normalizedRootPath, { isFavorite: isFavoriteRemotePath(normalizedRootPath, favoriteRemotePaths) })];
    }

    return [RemoteEditSidebarItem.pathSegment(activeConnection, '/', { isFavorite: isFavoriteRemotePath('/', favoriteRemotePaths) })];
  }

  private async getPathSegmentChildren(connectionId: string, segmentPath: string): Promise<RemoteEditSidebarItem[]> {
    const connection = this.sessions.getConnection(connectionId);

    if (!connection) {
      return [];
    }

    const currentPath = normalizeRemotePath(this.getRootPath(connection));
    const trailPath = this.getFullPathTreeTrailPath(connectionId, currentPath);
    const normalizedSegmentPath = normalizeRemotePath(segmentPath);

    if (normalizedSegmentPath === currentPath) {
      return this.getRemoteDirectoryItems(connectionId, currentPath, true);
    }

    if (this.isBreadcrumbPathView()) {
      return this.getBreadcrumbPathSegmentChildren(connectionId, connection, normalizedSegmentPath, currentPath, trailPath);
    }

    const cachedItems = await this.getCachedFullPathTreeDirectoryItems(connectionId, normalizedSegmentPath);

    if (cachedItems) {
      return cachedItems;
    }

    const nextSegmentPath = this.getNextFullPathTreeSegmentPath(normalizedSegmentPath, trailPath);

    if (!nextSegmentPath) {
      return [];
    }

    if (nextSegmentPath === currentPath) {
      const favoriteRemotePaths = await this.getFavoriteRemotePaths(connectionId);
      return [RemoteEditSidebarItem.filesGroup(connection, currentPath, { isFavorite: isFavoriteRemotePath(currentPath, favoriteRemotePaths) })];
    }

    const favoriteRemotePaths = await this.getFavoriteRemotePaths(connectionId);
    return [RemoteEditSidebarItem.pathSegment(connection, nextSegmentPath, { isFavorite: isFavoriteRemotePath(nextSegmentPath, favoriteRemotePaths) })];
  }

  private async getBreadcrumbPathSegmentChildren(
    connectionId: string,
    connection: NonNullable<ReturnType<RemoteSessionManager['getConnection']>>,
    segmentPath: string,
    currentPath: string,
    trailPath: string
  ): Promise<RemoteEditSidebarItem[]> {
    const nextSegmentPath = this.getNextFullPathTreeSegmentPath(segmentPath, trailPath);

    if (!nextSegmentPath) {
      return [];
    }

    const favoriteRemotePaths = await this.getFavoriteRemotePaths(connectionId);

    if (nextSegmentPath === currentPath) {
      return [RemoteEditSidebarItem.filesGroup(connection, currentPath, { isFavorite: isFavoriteRemotePath(currentPath, favoriteRemotePaths) })];
    }

    return [RemoteEditSidebarItem.pathSegment(connection, nextSegmentPath, { isFavorite: isFavoriteRemotePath(nextSegmentPath, favoriteRemotePaths) })];
  }

  private updateFullPathTreeTrailPath(connectionId: string, remotePath: string): void {
    const nextPath = normalizeRemotePath(remotePath || '/');
    const currentTrailPath = this.fullPathTreeTrailPaths.get(connectionId);

    if (!currentTrailPath) {
      this.fullPathTreeTrailPaths.set(connectionId, nextPath);
      return;
    }

    const normalizedTrailPath = normalizeRemotePath(currentTrailPath);

    if (isPathAncestorOrSelf(nextPath, normalizedTrailPath)) {
      return;
    }

    if (isPathAncestorOrSelf(normalizedTrailPath, nextPath)) {
      this.fullPathTreeTrailPaths.set(connectionId, nextPath);
      return;
    }

    this.fullPathTreeTrailPaths.set(connectionId, nextPath);
  }

  private getFullPathTreeTrailPath(connectionId: string, currentPath: string): string {
    const normalizedCurrentPath = normalizeRemotePath(currentPath || '/');
    const storedTrailPath = this.fullPathTreeTrailPaths.get(connectionId);

    if (!storedTrailPath) {
      this.fullPathTreeTrailPaths.set(connectionId, normalizedCurrentPath);
      return normalizedCurrentPath;
    }

    const normalizedTrailPath = normalizeRemotePath(storedTrailPath);

    if (isPathAncestorOrSelf(normalizedCurrentPath, normalizedTrailPath) || isPathAncestorOrSelf(normalizedTrailPath, normalizedCurrentPath)) {
      return normalizedTrailPath;
    }

    this.fullPathTreeTrailPaths.set(connectionId, normalizedCurrentPath);
    return normalizedCurrentPath;
  }

  private getNextFullPathTreeSegmentPath(segmentPath: string, trailPath: string): string | undefined {
    const normalizedSegmentPath = normalizeRemotePath(segmentPath);
    const normalizedTrailPath = normalizeRemotePath(trailPath);

    if (normalizedSegmentPath === normalizedTrailPath) {
      return undefined;
    }

    if (normalizedSegmentPath !== '/' && !isPathAncestorOrSelf(normalizedSegmentPath, normalizedTrailPath)) {
      return undefined;
    }

    const remainingPath = normalizedSegmentPath === '/'
      ? normalizedTrailPath.slice(1)
      : normalizedTrailPath.slice(normalizedSegmentPath.length + 1);
    const nextSegmentName = remainingPath.split('/').filter(Boolean)[0];

    if (!nextSegmentName) {
      return undefined;
    }

    return normalizedSegmentPath === '/'
      ? normalizeRemotePath(`/${nextSegmentName}`)
      : normalizeRemotePath(`${normalizedSegmentPath}/${nextSegmentName}`);
  }

  private async getCachedFullPathTreeDirectoryItems(connectionId: string, remotePath: string): Promise<RemoteEditSidebarItem[] | undefined> {
    if (!this.isFullPathTreeView()) {
      return undefined;
    }

    const connection = this.sessions.getConnection(connectionId);

    if (!connection) {
      return undefined;
    }

    const normalizedRemotePath = normalizeRemotePath(remotePath);
    const directoryListKey = this.buildRefreshKey(connectionId, normalizedRemotePath);
    const cachedEntries = this.fullPathTreeDirectoryEntrySnapshots.get(directoryListKey);

    if (!cachedEntries) {
      return undefined;
    }

    const favoriteRemotePaths = await this.getFavoriteRemotePaths(connectionId);
    let items = this.buildRemoteDirectoryItems(connectionId, connection, normalizedRemotePath, cachedEntries, favoriteRemotePaths);
    items = this.mergeFullPathTreeTrailChild(items, connection, connectionId, normalizedRemotePath, favoriteRemotePaths);
    return items;
  }

  private buildRemoteDirectoryItems(
    connectionId: string,
    connection: NonNullable<ReturnType<RemoteSessionManager['getConnection']>>,
    remotePath: string,
    entries: RemoteEntry[],
    favoriteRemotePaths: string[]
  ): RemoteEditSidebarItem[] {
    const startPath = connection.startPath || '/';
    const breadcrumbIdentityScope = this.getBreadcrumbDirectoryIdentityScope(connectionId, remotePath);

    return sortRemoteEntries(entries).map(entry =>
      RemoteEditSidebarItem.fromRemoteEntry(connectionId, entry, startPath, {
        isFavorite: isFavoriteRemotePath(entry.path || entry.name || '/', favoriteRemotePaths),
        isSftp: isSftpConnection(connection.connectionType) && !isWindowsRemotePlatform(connection.remotePlatform),
        isWindowsSftp: isSftpConnection(connection.connectionType) && isWindowsRemotePlatform(connection.remotePlatform),
        forceCollapsed: Boolean(breadcrumbIdentityScope),
        identityScope: breadcrumbIdentityScope
      })
    );
  }

  private mergeFullPathTreeTrailChild(
    items: RemoteEditSidebarItem[],
    connection: NonNullable<ReturnType<RemoteSessionManager['getConnection']>>,
    connectionId: string,
    currentPath: string,
    favoriteRemotePaths: string[]
  ): RemoteEditSidebarItem[] {
    if (!this.isFullPathTreeView()) {
      return items;
    }

    const normalizedCurrentPath = normalizeRemotePath(currentPath);
    const trailPath = this.getFullPathTreeTrailPath(connectionId, normalizedCurrentPath);
    const nextSegmentPath = this.getNextFullPathTreeSegmentPath(normalizedCurrentPath, trailPath);

    if (!nextSegmentPath) {
      return items;
    }

    const pathSegmentItem = RemoteEditSidebarItem.pathSegment(connection, nextSegmentPath, { isFavorite: isFavoriteRemotePath(nextSegmentPath, favoriteRemotePaths) });
    const existingIndex = items.findIndex(item => item.remotePath && normalizeRemotePath(item.remotePath) === nextSegmentPath);

    if (existingIndex >= 0) {
      const nextItems = [...items];
      nextItems[existingIndex] = pathSegmentItem;
      return nextItems;
    }

    const nextItems = [...items];
    const insertIndex = this.findFullPathTreeTrailInsertIndex(nextItems, String(pathSegmentItem.label || ''));
    nextItems.splice(insertIndex, 0, pathSegmentItem);
    return nextItems;
  }

  private findFullPathTreeTrailInsertIndex(items: RemoteEditSidebarItem[], label: string): number {
    const normalizedLabel = label.toLocaleLowerCase();
    const firstNonParentIndex = items.findIndex(item => item.kind !== 'goParentFolder');
    const startIndex = firstNonParentIndex >= 0 ? firstNonParentIndex : items.length;

    for (let index = startIndex; index < items.length; index += 1) {
      const itemLabel = String(items[index].label || '').toLocaleLowerCase();

      if (normalizedLabel.localeCompare(itemLabel, undefined, { numeric: true, sensitivity: 'base' }) < 0) {
        return index;
      }
    }

    return items.length;
  }

  private async getFavoritePathItems(connectionId: string): Promise<RemoteEditSidebarItem[]> {
    const profile = await this.connectionManager.getProfile(connectionId);
    const connection = this.sessions.getConnection(connectionId);
    const favoriteRemotePaths = profile?.favoriteRemotePaths || [];

    if (favoriteRemotePaths.length === 0) {
      return [
        new RemoteEditSidebarItem({
          label: 'No favorite paths',
          kind: 'placeholder',
          icon: new vscode.ThemeIcon('info'),
          description: 'Add favorites in Remote Edit',
          tooltip: 'Favorite remote paths saved in Remote Edit will appear here.',
          contextValue: 'remoteedit.placeholder'
        })
      ];
    }

    return favoriteRemotePaths.map(remotePath => RemoteEditSidebarItem.favoritePath(connectionId, remotePath, {
      isSftp: isSftpConnection(profile?.connectionType) && !isWindowsRemotePlatform(connection?.remotePlatform),
      isWindowsSftp: isSftpConnection(profile?.connectionType) && isWindowsRemotePlatform(connection?.remotePlatform)
    }));
  }

  private async getRemoteDirectoryItems(connectionId: string, remotePath: string, includeGoParent: boolean): Promise<RemoteEditSidebarItem[]> {
    const directoryListKey = this.buildRefreshKey(connectionId, remotePath);
    const requestSequence = this.nextDirectoryListSequence(directoryListKey);
    const releaseListSlot = await this.reserveDirectoryListSlot(connectionId);
    const totalTimer = createPerformanceTimer();
    let listMs = 0;
    let favoriteMs = 0;
    let buildItemsMs = 0;
    let entriesCount = 0;
    let forceRefresh = false;

    try {
      if (this.isStaleDirectoryListRequest(connectionId, directoryListKey, requestSequence)) {
        return [];
      }

      const forceRefreshKey = this.buildRefreshKey(connectionId, remotePath);
      forceRefresh = this.forceRefreshPaths.delete(forceRefreshKey);
      const listTimer = createPerformanceTimer();
      const entries = await this.sessions.listDirectory(connectionId, remotePath, { forceRefresh });
      listMs = listTimer();
      entriesCount = entries.length;

      if (this.isStaleDirectoryListRequest(connectionId, directoryListKey, requestSequence)) {
        return [];
      }

      const connection = this.sessions.getConnection(connectionId);
      const favoriteTimer = createPerformanceTimer();
      const favoriteRemotePaths = await this.getFavoriteRemotePaths(connectionId);
      favoriteMs = favoriteTimer();

      if (this.isStaleDirectoryListRequest(connectionId, directoryListKey, requestSequence)) {
        return [];
      }

      const buildItemsTimer = createPerformanceTimer();
      const normalizedRemotePath = normalizeRemotePath(remotePath);
      if (connection && this.isFullPathTreeView()) {
        this.fullPathTreeDirectoryEntrySnapshots.set(directoryListKey, [...entries]);
      }

      let items = connection
        ? this.buildRemoteDirectoryItems(connectionId, connection, normalizedRemotePath, entries, favoriteRemotePaths)
        : [];

      if (connection) {
        items = this.mergeFullPathTreeTrailChild(items, connection, connectionId, normalizedRemotePath, favoriteRemotePaths);
      }

      if (includeGoParent && normalizedRemotePath !== '/' && !this.isPathTreeView()) {
        items.unshift(RemoteEditSidebarItem.goParentFolder(connectionId, normalizedRemotePath));
      }
      buildItemsMs = buildItemsTimer();

      appendPerformanceLog(this.output, 'Sidebar', `getRemoteDirectoryItems ${normalizedRemotePath}`, {
        items: items.length,
        entries: entriesCount,
        forceRefresh,
        list: `${listMs}ms`,
        favorites: `${favoriteMs}ms`,
        buildItems: `${buildItemsMs}ms`,
        total: `${totalTimer()}ms`
      });

      if (items.length === 0) {
        return [
          new RemoteEditSidebarItem({
            label: 'No files',
            kind: 'placeholder',
            icon: new vscode.ThemeIcon('info'),
            tooltip: `${remotePath} is empty.`,
            contextValue: 'remoteedit.placeholder'
          })
        ];
      }

      return items;
    } catch (error) {
      if (this.isStaleDirectoryListRequest(connectionId, directoryListKey, requestSequence)) {
        return [];
      }

      appendPerformanceLog(this.output, 'Sidebar', `getRemoteDirectoryItems failed ${normalizeRemotePath(remotePath)}`, {
        entries: entriesCount,
        forceRefresh,
        list: `${listMs}ms`,
        favorites: `${favoriteMs}ms`,
        buildItems: `${buildItemsMs}ms`,
        total: `${totalTimer()}ms`
      });

      const message = error instanceof Error ? error.message : String(error);
      const normalizedRemotePath = normalizeRemotePath(remotePath);
      const items: RemoteEditSidebarItem[] = [];

      if (includeGoParent && normalizedRemotePath !== '/' && !this.isPathTreeView()) {
        items.push(RemoteEditSidebarItem.goParentFolder(connectionId, normalizedRemotePath));
      }

      items.push(new RemoteEditSidebarItem({
        label: 'Unable to load files',
        kind: 'placeholder',
        icon: new vscode.ThemeIcon('warning'),
        description: message,
        tooltip: message,
        contextValue: 'remoteedit.placeholder'
      }));

      return items;
    } finally {
      releaseListSlot();
    }
  }

  private nextDirectoryListSequence(directoryListKey: string): number {
    const nextSequence = (this.directoryListSequences.get(directoryListKey) || 0) + 1;
    this.directoryListSequences.set(directoryListKey, nextSequence);
    return nextSequence;
  }

  private isStaleDirectoryListRequest(connectionId: string, directoryListKey: string, requestSequence: number): boolean {
    return this.directoryListSequences.get(directoryListKey) !== requestSequence
      || !this.sessions.hasConnection(connectionId);
  }

  hasPendingDirectoryList(connectionId: string): boolean {
    return this.directoryListChains.has(connectionId);
  }

  private async reserveDirectoryListSlot(connectionId: string): Promise<() => void> {
    const previousChain = this.directoryListChains.get(connectionId) || Promise.resolve();
    let releaseCurrentChain!: () => void;
    const currentChain = previousChain
      .catch(() => undefined)
      .then(() => new Promise<void>(resolve => {
        releaseCurrentChain = resolve;
      }));

    this.directoryListChains.set(connectionId, currentChain);
    await previousChain.catch(() => undefined);

    let released = false;
    return () => {
      if (released) {
        return;
      }

      released = true;
      releaseCurrentChain();

      if (this.directoryListChains.get(connectionId) === currentChain) {
        this.directoryListChains.delete(connectionId);
      }
    };
  }
}

export class TransfersTreeProvider implements vscode.TreeDataProvider<RemoteEditSidebarItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RemoteEditSidebarItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  getTreeItem(element: RemoteEditSidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: RemoteEditSidebarItem): Promise<RemoteEditSidebarItem[]> {
    const state = RemoteEditPanel.getTransferQueueState();

    if (!element) {
      return Promise.resolve([
        RemoteEditSidebarItem.transferGroup('Current', (state.currentTransfers || []).length, 'current'),
        RemoteEditSidebarItem.transferGroup('Pending', state.pending.length, 'pending'),
        RemoteEditSidebarItem.transferGroup('Completed', state.completed.length, 'completed')
      ]);
    }

    if (element.kind !== 'transferGroup' || !element.id) {
      return Promise.resolve([]);
    }

    if (element.id === 'transferGroup:current') {
      return Promise.resolve((state.currentTransfers || []).map(item => RemoteEditSidebarItem.transferItem(item, 'current')));
    }

    if (element.id === 'transferGroup:pending') {
      return Promise.resolve(state.pending.map(item => RemoteEditSidebarItem.transferItem(item, 'pending')));
    }

    if (element.id === 'transferGroup:completed') {
      return Promise.resolve(state.completed.slice().reverse().map(item => RemoteEditSidebarItem.transferItem(item, 'completed')));
    }

    return Promise.resolve([]);
  }

  refresh(element?: RemoteEditSidebarItem): void {
    this.onDidChangeTreeDataEmitter.fire(element);
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}

function isSftpConnection(connectionType: unknown): boolean {
  return String(connectionType || 'sftp').toLowerCase() === 'sftp';
}

function isFavoriteRemotePath(remotePath: string, favoriteRemotePaths: string[]): boolean {
  const normalizedPath = normalizeRemotePath(remotePath);
  return favoriteRemotePaths.some(favoritePath => normalizeRemotePath(favoritePath) === normalizedPath);
}
