import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/ConnectionManager';
import { buildRemoteEditUri } from '../filesystem/RemoteEditFileSystemProvider';
import { dirnameRemotePath, joinRemotePath, normalizeRemotePath, RemoteEntry, SftpSessionManager } from '../ssh/SftpSessionManager';
import { buildDeleteEntriesConfirmationDetail } from '../utils/deleteConfirmationUtils';
import { getNonce } from '../utils/webviewUtils';
import { renderRemoteEditHtml } from './RemoteEditHtml';
import { handleRemoteEditPanelMessage } from './RemoteEditPanelHandlers';
import { RemoteEditIncomingMessageType, RemoteEditOutboundMessageType, type RemoteEditWebviewMessage } from './RemoteEditPanelMessages';
import { RemoteEditPanelState } from './RemoteEditPanelState';
import { calculateModeFromPermissionState, parsePermissionString, type SetPermissionsPanelOptions } from './RemoteEditPermissions';

export class RemoteEditPanel {
  private static currentPanel: RemoteEditPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly state = new RemoteEditPanelState();
  private pendingPermissionsDialogResolve: ((mode?: string) => void) | undefined;

  static open(
    context: vscode.ExtensionContext,
    sessions: SftpSessionManager,
    connectionManager: ConnectionManager,
    output: vscode.OutputChannel
  ): void {
    if (RemoteEditPanel.currentPanel) {
      RemoteEditPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'remoteedit.home',
      'RemoteEdit',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    panel.iconPath = new vscode.ThemeIcon('remote-explorer');

    RemoteEditPanel.currentPanel = new RemoteEditPanel(panel, context, sessions, connectionManager, output);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly sessions: SftpSessionManager,
    private readonly connectionManager: ConnectionManager,
    private readonly output: vscode.OutputChannel
  ) {
    this.state.initializeFromSessions(this.sessions.listConnections());

    this.panel.webview.html = this.renderHtml(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => this.handleMessage(message), null, this.disposables);
  }

  private async handleMessage(message: RemoteEditWebviewMessage): Promise<void> {
    try {
      await handleRemoteEditPanelMessage(message, {
        getActiveConnectionId: () => this.state.getActiveConnectionId(),
        getActivePath: () => this.getActivePath(),
        onReady: async () => {
          await this.sendProfiles();
          await this.restoreActiveSession();
        },
        saveConnection: payload => this.saveConnection(payload),
        pickPrivateKeyPath: () => this.pickPrivateKeyPath(),
        deleteConnection: payload => this.deleteConnection(payload),
        connect: payload => this.connect(payload),
        disconnect: connectionId => this.disconnect(connectionId),
        switchSession: connectionId => this.switchSession(connectionId),
        enableSudoMode: () => this.enableSudoMode(),
        disableSudoMode: connectionId => this.disableSudoMode(connectionId),
        listDirectory: remotePath => this.listDirectory(remotePath),
        openParent: () => this.listDirectory(dirnameRemotePath(this.getActivePath())),
        openEntry: payload => this.openEntry(payload),
        openEntries: payload => this.openEntries(payload),
        openPath: payload => this.openPath(payload),
        requestCreateFile: payload => this.requestCreateEntry(payload, 'file'),
        requestCreateDirectory: payload => this.requestCreateEntry(payload, 'directory'),
        requestRenameEntry: payload => this.requestRenameEntry(payload),
        requestDeleteEntry: payload => this.requestDeleteEntry(payload),
        requestDeleteEntries: payload => this.requestDeleteEntries(payload),
        requestSetPermissions: payload => this.requestSetPermissions(payload),
        applyPermissions: payload => this.applyPermissionsFromDialog(payload),
        cancelPermissions: () => this.cancelPermissionsDialog(),
        showOutput: () => this.output.show(true),
        copyRemotePath: payload => this.copyRemotePath(payload),
        log: logMessage => this.output.appendLine(logMessage),
        unknown: messageType => this.postError(`Unknown webview message: ${messageType}`)
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const friendlyMessage = this.formatError(message.type, message.payload, messageText);
      this.output.appendLine(`[ERROR] ${friendlyMessage}`);
      if (friendlyMessage !== messageText) {
        this.output.appendLine(`[ERROR] Details: ${messageText}`);
      }
      this.postError(friendlyMessage);
    }
  }

  private setActiveConnection(connectionId: string | undefined): void {
    this.state.setActiveConnectionId(connectionId);
  }

  private async restoreActiveSession(): Promise<void> {
    const connectedSessions = this.sessions.listConnections();

    if (!connectedSessions.length) {
      this.state.clearRetainedCurrentPaths();
      this.setActiveConnection(undefined);
      this.sendSessions();
      this.postMessage(RemoteEditOutboundMessageType.Disconnected, {});
      return;
    }

    const lastActiveId = this.state.getLastActiveConnectionId();
    const nextActiveId = lastActiveId && this.sessions.hasConnection(lastActiveId)
      ? lastActiveId
      : connectedSessions[0].id;

    this.setActiveConnection(nextActiveId);
    this.sendSessions();
    await this.listDirectory(this.getActivePath());
  }

  private async sendProfiles(selectedId?: string): Promise<void> {
    const profiles = await this.connectionManager.listProfiles();
    this.postMessage(RemoteEditOutboundMessageType.ProfilesLoaded, { profiles, selectedId });
  }

  private sendSessions(): void {
    const sessions = this.sessions.listConnections().map(connection => ({
      ...connection,
      currentPath: this.state.getCurrentPath(connection.id, connection.startPath || '/'),
      sudoModeEnabled: this.sessions.isSudoModeEnabled(connection.id)
    }));

    this.postMessage(RemoteEditOutboundMessageType.SessionsChanged, {
      sessions,
      activeConnectionId: this.state.getActiveConnectionId()
    });
  }

  private async enableSudoMode(): Promise<void> {
    const connectionId = this.state.getActiveConnectionId();

    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId: '', enabled: false });
      this.postBusy(false, 'Connect to a host before enabling sudo mode.');
      return;
    }

    const password = await vscode.window.showInputBox({
      title: 'Enable sudo mode',
      prompt: 'Enter the sudo password for this connection. The password is kept only in memory for the current session.',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Sudo password'
    });

    if (!password) {
      this.sessions.disableSudoMode(connectionId);
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: false });
      this.postBusy(false, 'Sudo mode not enabled.');
      return;
    }

    try {
      await this.sessions.enableSudoMode(connectionId, password);
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: true });
      this.postBusy(false, 'Sudo mode enabled for this session.');
      this.output.appendLine(`[INFO] Sudo mode enabled for ${connectionId}.`);
    } catch (error) {
      this.sessions.disableSudoMode(connectionId);
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: false });
      this.postBusy(false, message || 'Could not enable sudo mode.');
      this.output.appendLine(`[WARN] Could not enable sudo mode for ${connectionId}: ${message}`);
    }
  }

  private disableSudoMode(connectionId: string): void {
    if (!connectionId) {
      this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId: '', enabled: false });
      this.postBusy(false, 'No active connection.');
      return;
    }

    this.sessions.disableSudoMode(connectionId);
    this.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: false });
    this.postBusy(false, 'Sudo mode disabled.');
    this.output.appendLine(`[INFO] Sudo mode disabled for ${connectionId}.`);
  }

  private async saveConnection(payload: any): Promise<void> {
    this.postBusy(true, 'Saving bookmarked connection...');
    const profile = await this.connectionManager.saveProfile(payload || {});
    await this.sendProfiles(profile.id);
    this.postBusy(false, `Saved bookmarked connection: ${profile.name}.`);
    this.output.appendLine(`[INFO] Saved bookmarked connection '${profile.name}' (${profile.username ? profile.username + '@' : ''}${profile.host}:${profile.port}).`);
  }

  private async pickPrivateKeyPath(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select',
      title: 'Select private key file'
    });

    const selectedPath = selected?.[0]?.fsPath;
    if (selectedPath) {
      this.postMessage(RemoteEditOutboundMessageType.PrivateKeyPathSelected, { path: selectedPath });
    }
  }

  private async deleteConnection(payload: any): Promise<void> {
    const profileId = String(payload?.id || '').trim();

    if (!profileId) {
      throw new Error('Select a bookmarked connection to remove.');
    }

    const profile = await this.connectionManager.getProfile(profileId);

    if (!profile) {
      await this.sendProfiles();
      throw new Error('The selected bookmarked connection no longer exists.');
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Remove bookmarked connection "${profile.name}"? Stored secrets for this connection will also be removed.`,
      { modal: true },
      'Remove'
    );

    if (confirmation !== 'Remove') {
      this.postBusy(false, 'Remove canceled.');
      return;
    }

    this.postBusy(true, 'Removing bookmarked connection...');

    if (this.sessions.hasConnection(profileId)) {
      await this.disconnect(profileId);
    }

    await this.connectionManager.deleteProfile(profileId);
    await this.sendProfiles('');
    this.postMessage(RemoteEditOutboundMessageType.ConnectionFormCleared, {});
    this.postBusy(false, `Removed bookmarked connection: ${profile.name}.`);
    this.output.appendLine(`[INFO] Removed bookmarked connection '${profile.name}' (${profileId}).`);
  }

  private async connect(payload: any): Promise<void> {
    const options = await this.connectionManager.buildConnectOptions(payload || {});
    const target = `${options.username}@${options.host}:${options.port}`;

    this.postBusy(true, `Connecting to ${options.host}...`);
    this.output.appendLine(`[INFO] Connecting to ${target} using ${options.authType} authentication.`);

    const connection = await this.sessions.connect(options);

    if (payload?.id) {
      await this.connectionManager.applyCredentialPreferences(connection.id, options.authType, payload || {});
      await this.sendProfiles(connection.id);
    }

    this.setActiveConnection(connection.id);
    this.state.setCurrentPath(connection.id, connection.startPath);
    this.updatePanelTitle();

    this.sendSessions();
    await this.listDirectory(connection.startPath);
    this.postBusy(false, 'Connected.');
  }

  private async disconnect(connectionId: string): Promise<void> {
    if (!connectionId) {
      this.postStatus('No active connection.');
      return;
    }

    const connection = this.sessions.getConnection(connectionId);
    this.postBusy(true, 'Disconnecting...');
    await this.sessions.disconnect(connectionId);
    this.state.deleteConnectionPath(connectionId);
    this.sessions.disableSudoMode(connectionId);

    if (this.state.getActiveConnectionId() === connectionId) {
      const remaining = this.sessions.listConnections();
      this.setActiveConnection(remaining[0]?.id);
    }

    this.updatePanelTitle();
    this.sendSessions();

    if (this.state.getActiveConnectionId()) {
      await this.listDirectory(this.getActivePath());
    } else {
      this.postMessage(RemoteEditOutboundMessageType.Disconnected, {});
    }

    this.postBusy(false, 'Disconnected.');
    this.output.appendLine(`[INFO] Disconnected ${connectionId}.`);
  }

  private async switchSession(connectionId: string): Promise<void> {
    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected RemoteEdit connection is not connected.');
    }

    this.setActiveConnection(connectionId);
    this.updatePanelTitle();
    this.sendSessions();
    await this.listDirectory(this.getActivePath());
  }

  private async listDirectory(remotePath: string): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const normalizedPath = normalizeRemotePath(remotePath);
    this.postBusy(true, `Loading ${normalizedPath}...`);
    const entries = await this.sessions.listDirectory(connectionId, normalizedPath);
    const visibleEntries = normalizedPath === '/' ? entries : [this.buildParentEntry(normalizedPath), ...entries];

    this.state.setCurrentPath(connectionId, normalizedPath);
    this.postMessage(RemoteEditOutboundMessageType.DirectoryListed, {
      connectionId,
      path: normalizedPath,
      entries: visibleEntries
    });
    this.sendSessions();

    this.postBusy(false, `Listed ${entries.length} item(s).`);
  }

  private buildParentEntry(currentPath: string): RemoteEntry {
    return {
      name: '..',
      type: 'directory',
      effectiveType: 'directory',
      size: 0,
      modifyTime: 0,
      accessTime: 0,
      owner: '',
      group: '',
      permissions: '',
      path: dirnameRemotePath(currentPath)
    };
  }

  private async openEntry(payload: any): Promise<void> {
    this.requireActiveConnectionId();

    const entryType = String(payload?.type || '');
    const entryEffectiveType = String(payload?.effectiveType || '');
    const entryName = String(payload?.name || '');
    const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : joinRemotePath(this.getActivePath(), entryName);
    const resolvedType = await this.resolveOpenableEntryType(entryPath, entryType, entryEffectiveType);

    if (resolvedType === 'directory') {
      await this.listDirectory(entryPath);
      return;
    }

    if (resolvedType !== 'file') {
      throw new Error(`Cannot open entry type '${entryType || resolvedType}'.`);
    }

    await this.openFile(entryPath);
  }

  private async openEntries(payload: any): Promise<void> {
    this.requireActiveConnectionId();

    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    const entries = rawEntries
      .map((entry: any) => ({
        name: String(entry?.name || ''),
        type: String(entry?.type || ''),
        effectiveType: String(entry?.effectiveType || ''),
        path: entry?.path ? normalizeRemotePath(String(entry.path)) : ''
      }))
      .filter((entry: any) => Boolean(entry.path) && entry.name !== '..');

    if (!entries.length) {
      throw new Error('Select a remote file to view/edit.');
    }

    const resolvedEntries: Array<{ name: string; type: string; effectiveType: string; path: string; resolvedType: string }> = [];

    for (const entry of entries) {
      resolvedEntries.push({
        ...entry,
        resolvedType: await this.resolveOpenableEntryType(entry.path, entry.type, entry.effectiveType)
      });
    }

    if (resolvedEntries.length === 1 && resolvedEntries[0].resolvedType === 'directory') {
      await this.listDirectory(resolvedEntries[0].path);
      return;
    }

    const unsupportedEntry = resolvedEntries.find(entry => entry.resolvedType !== 'file');

    if (unsupportedEntry) {
      throw new Error('Only files can be opened when multiple items are selected.');
    }

    this.postBusy(true, resolvedEntries.length === 1
      ? `Opening ${resolvedEntries[0].name || resolvedEntries[0].path}...`
      : `Opening ${resolvedEntries.length} remote files...`);

    const connectionId = this.requireActiveConnectionId();

    const failedEntries: Array<{ path: string; error: string }> = [];

    for (const entry of resolvedEntries) {
      const uri = buildRemoteEditUri(connectionId, entry.path, this.getActiveUriAuthority());

      try {
        await this.sessions.prepareFileForOpen(connectionId, entry.path);
        await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
        this.output.appendLine(`[INFO] Opened ${this.buildRemoteReference(entry.path)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failedEntries.push({ path: entry.path, error: message });
        this.output.appendLine(`[WARN] Failed to open ${this.buildRemoteReference(entry.path)}: ${message}`);
      }
    }

    if (failedEntries.length) {
      const detail = failedEntries.map(item => `${item.path}: ${item.error}`).join('\n');
      await vscode.window.showWarningMessage(
        `Opened ${resolvedEntries.length - failedEntries.length} of ${resolvedEntries.length} remote file(s).`,
        { modal: false, detail }
      );
    }

    this.postBusy(false, failedEntries.length
      ? `Opened ${resolvedEntries.length - failedEntries.length} of ${resolvedEntries.length} remote file(s).`
      : resolvedEntries.length === 1
        ? `Opened ${resolvedEntries[0].name || resolvedEntries[0].path}.`
        : `Opened ${resolvedEntries.length} remote files.`);
  }

  private async resolveOpenableEntryType(remotePath: string, entryType?: string, entryEffectiveType?: string): Promise<'file' | 'directory' | 'unknown'> {
    if (entryEffectiveType === 'file' || entryEffectiveType === 'directory') {
      return entryEffectiveType;
    }

    if (entryType === 'file' || entryType === 'directory') {
      return entryType;
    }

    const stats = await this.sessions.stat(this.requireActiveConnectionId(), remotePath);
    return stats.type;
  }

  private async openPath(payload: any): Promise<void> {
    this.requireActiveConnectionId();

    const rawPath = String(payload?.path || '').trim();

    if (!rawPath) {
      throw new Error('Enter a remote path to open.');
    }

    const remotePath = normalizeRemotePath(rawPath);
    this.postBusy(true, `Opening ${remotePath}...`);
    const stats = await this.sessions.stat(this.requireActiveConnectionId(), remotePath);

    if (stats.type === 'directory') {
      await this.listDirectory(remotePath);
      return;
    }

    await this.openFile(remotePath);
  }

  private async openFile(remotePath: string): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const normalizedPath = normalizeRemotePath(remotePath);
    const uri = buildRemoteEditUri(connectionId, normalizedPath, this.getActiveUriAuthority());

    await this.sessions.prepareFileForOpen(connectionId, normalizedPath);
    await vscode.commands.executeCommand('vscode.open', uri, { preview: false });

    this.output.appendLine(`[INFO] Opened ${this.buildRemoteReference(normalizedPath)}`);
    this.postBusy(false, `Opened ${normalizedPath}.`);
  }

  private async copyRemotePath(payload: any): Promise<void> {
    this.requireActiveConnectionId();

    const remotePath = normalizeRemotePath(String(payload?.path || this.getActivePath() || '/'));
    const remoteReference = this.buildRemoteReference(remotePath);
    await vscode.env.clipboard.writeText(remoteReference);
    this.postStatus(`Copied remote path: ${remotePath}`);
  }

  private async requestCreateEntry(_payload: any, entryKind: 'file' | 'directory'): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const targetDirectory = normalizeRemotePath(this.getActivePath());
    const label = entryKind === 'directory' ? 'directory' : 'file';

    if (!targetDirectory) {
      throw new Error(`Select a remote location to create a new ${label}.`);
    }

    const newName = await vscode.window.showInputBox({
      title: entryKind === 'directory' ? 'RemoteEdit: Create New Directory' : 'RemoteEdit: Create New File',
      prompt: `Enter the name for the new remote ${label}.`,
      placeHolder: entryKind === 'directory' ? 'new-folder' : 'new-file.txt',
      validateInput: value => {
        const trimmed = value.trim();
        if (!trimmed) {
          return `The ${label} name cannot be empty.`;
        }
        if (trimmed === '.' || trimmed === '..') {
          return `The ${label} name cannot be '.' or '..'.`;
        }
        if (trimmed.includes('/') || trimmed.includes('\\')) {
          return `The ${label} name must not contain path separators.`;
        }
        return undefined;
      }
    });

    if (newName === undefined) {
      this.postStatus(entryKind === 'directory' ? 'Create directory cancelled.' : 'Create file cancelled.');
      return;
    }

    const trimmedName = newName.trim();
    const newPath = joinRemotePath(targetDirectory, trimmedName);

    await this.ensureRemotePathDoesNotExist(connectionId, newPath, label);

    this.postBusy(true, `Creating ${label} ${trimmedName}...`);

    if (entryKind === 'directory') {
      await this.sessions.createDirectory(connectionId, newPath);
    } else {
      await this.sessions.writeFile(connectionId, newPath, new Uint8Array());
    }

    this.output.appendLine(`[INFO] Created remote ${label} ${this.buildRemoteReference(newPath)}.`);
    await this.listDirectory(targetDirectory);
    this.postBusy(false, `Created ${trimmedName}.`);
  }

  private async ensureRemotePathDoesNotExist(connectionId: string, remotePath: string, label: string): Promise<void> {
    try {
      await this.sessions.stat(connectionId, remotePath);
    } catch {
      return;
    }

    throw new Error(`A remote ${label} already exists at ${remotePath}.`);
  }

  private async requestRenameEntry(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || ''));
    const currentName = String(payload?.name || remotePath.split('/').filter(Boolean).pop() || '').trim();

    if (!remotePath || remotePath === '/' || currentName === '..') {
      throw new Error('Select a remote item to rename.');
    }

    const newName = await vscode.window.showInputBox({
      title: 'RemoteEdit: Rename',
      prompt: 'Enter the new name for the selected remote item.',
      value: currentName,
      valueSelection: [0, currentName.length],
      validateInput: value => {
        const trimmed = value.trim();
        if (!trimmed) {
          return 'The new name cannot be empty.';
        }
        if (trimmed.includes('/') || trimmed.includes('\\')) {
          return 'The new name must not contain path separators.';
        }
        return undefined;
      }
    });

    if (newName === undefined) {
      this.postStatus('Rename cancelled.');
      return;
    }

    const trimmedName = newName.trim();

    if (trimmedName === currentName) {
      this.postStatus('Rename skipped: the new name is the same as the current name.');
      return;
    }

    const parentPath = dirnameRemotePath(remotePath);
    const newPath = joinRemotePath(parentPath, trimmedName);

    this.postBusy(true, `Renaming ${currentName}...`);
    await this.sessions.rename(connectionId, remotePath, newPath);
    this.output.appendLine(`[INFO] Renamed ${this.buildRemoteReference(remotePath)} to ${this.buildRemoteReference(newPath)}.`);
    await this.listDirectory(parentPath);
    this.postBusy(false, `Renamed to ${trimmedName}.`);
  }

  private async requestDeleteEntry(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || ''));
    const entryType = String(payload?.type || 'item');
    const entryName = String(payload?.name || remotePath.split('/').filter(Boolean).pop() || remotePath);

    if (!remotePath || remotePath === '/' || entryName === '..') {
      throw new Error('Select a remote item to delete.');
    }

    const kind = entryType === 'directory' ? 'folder' : entryType === 'file' ? 'file' : 'item';
    const confirmation = await vscode.window.showWarningMessage(
      `Delete remote ${kind} '${entryName}'? This action cannot be undone.`,
      { modal: true, detail: remotePath },
      'Delete'
    );

    if (confirmation !== 'Delete') {
      this.postStatus('Delete cancelled.');
      return;
    }

    const parentPath = dirnameRemotePath(remotePath);
    this.postBusy(true, `Deleting ${entryName}...`);
    await this.sessions.delete(connectionId, remotePath);
    this.output.appendLine(`[INFO] Deleted ${this.buildRemoteReference(remotePath)}.`);
    await this.listDirectory(parentPath);
    this.postBusy(false, `Deleted ${entryName}.`);
  }

  private async requestDeleteEntries(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    const entries = rawEntries
      .map((entry: any) => ({
        name: String(entry?.name || ''),
        type: String(entry?.type || 'item'),
        path: entry?.path ? normalizeRemotePath(String(entry.path)) : ''
      }))
      .filter((entry: any) => Boolean(entry.path) && entry.path !== '/' && entry.name !== '..');

    if (!entries.length) {
      throw new Error('Select one or more remote items to delete.');
    }

    if (entries.length === 1) {
      await this.requestDeleteEntry(entries[0]);
      return;
    }

    const detail = buildDeleteEntriesConfirmationDetail(entries);
    const confirmation = await vscode.window.showWarningMessage(
      `Delete ${entries.length} remote items? This action cannot be undone.`,
      { modal: true, detail },
      'Delete'
    );

    if (confirmation !== 'Delete') {
      this.postStatus('Delete cancelled.');
      return;
    }

    this.postBusy(true, `Deleting ${entries.length} remote items...`);

    for (const entry of entries) {
      await this.sessions.delete(connectionId, entry.path);
      this.output.appendLine(`[INFO] Deleted ${this.buildRemoteReference(entry.path)}.`);
    }

    await this.listDirectory(this.getActivePath());
    this.postBusy(false, `Deleted ${entries.length} items.`);
  }

  private async requestSetPermissions(payload: any): Promise<void> {
    const connectionId = this.requireActiveConnectionId();
    const remotePath = normalizeRemotePath(String(payload?.path || ''));
    const entryType = String(payload?.type || '');
    const entryName = String(payload?.name || remotePath.split('/').filter(Boolean).pop() || remotePath);
    const currentPermissions = String(payload?.permissions || '');

    if (!remotePath || remotePath === '/' || entryName === '..') {
      throw new Error('Select a remote item to update permissions.');
    }

    const isDirectory = entryType === 'directory';
    const permissionState = parsePermissionString(currentPermissions, isDirectory);
    const initialMode = calculateModeFromPermissionState(permissionState);
    const selectedMode = await this.openSetPermissionsPanel({
      entryName,
      entryType,
      remotePath,
      currentPermissions,
      isDirectory,
      initialMode,
      permissionState
    });

    if (!selectedMode) {
      this.postStatus('Set permissions cancelled.');
      return;
    }

    this.postBusy(true, `Setting permissions ${selectedMode} on ${entryName}...`);
    await this.sessions.chmod(connectionId, remotePath, selectedMode);
    this.output.appendLine(`[INFO] Set permissions ${selectedMode} on ${this.buildRemoteReference(remotePath)}.`);
    await this.listDirectory(this.getActivePath());
    this.postBusy(false, `Permissions set to ${selectedMode}.`);
  }

  private openSetPermissionsPanel(options: SetPermissionsPanelOptions): Promise<string | undefined> {
    this.cancelPermissionsDialog();

    return new Promise<string | undefined>(resolve => {
      this.pendingPermissionsDialogResolve = resolve;
      this.postMessage(RemoteEditOutboundMessageType.ShowPermissionsDialog, {
        entryName: options.entryName,
        entryType: options.entryType,
        remotePath: options.remotePath,
        currentPermissions: options.currentPermissions,
        isDirectory: options.isDirectory,
        initialMode: options.initialMode,
        permissionState: options.permissionState
      });
    });
  }

  private applyPermissionsFromDialog(payload: any): void {
    const mode = String(payload?.mode || '').trim();

    if (!/^[0-7]{4}$/.test(mode)) {
      this.postMessage(RemoteEditOutboundMessageType.PermissionsValidationError, {
        message: 'Enter a valid octal mode using 3 or 4 digits from 0 to 7.'
      });
      return;
    }

    this.finishPermissionsDialog(mode);
  }

  private cancelPermissionsDialog(): void {
    this.finishPermissionsDialog(undefined);
  }

  private finishPermissionsDialog(mode?: string): void {
    const resolve = this.pendingPermissionsDialogResolve;

    if (!resolve) {
      return;
    }

    this.pendingPermissionsDialogResolve = undefined;
    resolve(mode);
    this.postMessage(RemoteEditOutboundMessageType.HidePermissionsDialog, {});
  }

  private getActivePath(): string {
    const activeConnectionId = this.state.getActiveConnectionId();

    if (!activeConnectionId) {
      return '/';
    }

    return this.state.getCurrentPath(activeConnectionId, this.sessions.getConnection(activeConnectionId)?.startPath || '/');
  }

  private requireActiveConnectionId(): string {
    const activeConnectionId = this.state.getActiveConnectionId();

    if (!activeConnectionId || !this.sessions.hasConnection(activeConnectionId)) {
      throw new Error('Connect to a host before browsing or opening remote files.');
    }

    return activeConnectionId;
  }

  private buildRemoteReference(remotePath: string): string {
    const activeConnectionId = this.state.getActiveConnectionId();

    if (!activeConnectionId) {
      return normalizeRemotePath(remotePath);
    }

    const connection = this.sessions.getConnection(activeConnectionId);

    if (!connection) {
      return `${activeConnectionId}:${normalizeRemotePath(remotePath)}`;
    }

    return `[${connection.name}] ${connection.username}@${connection.host}:${normalizeRemotePath(remotePath)}`;
  }

  private getActiveUriAuthority(): string | undefined {
    const activeConnectionId = this.state.getActiveConnectionId();

    if (!activeConnectionId) {
      return undefined;
    }

    return this.sessions.getConnection(activeConnectionId)?.host;
  }

  private updatePanelTitle(): void {
    this.panel.title = 'RemoteEdit';
  }

  private formatError(messageType: string, payload: any, details: string): string {
    if (messageType === RemoteEditIncomingMessageType.Connect) {
      const host = String(payload?.host || '').trim() || 'remote host';
      const port = String(payload?.port || '22').trim() || '22';
      const username = String(payload?.username || '').trim();
      const authType = String(payload?.authType || 'password') === 'privateKey' ? 'private key' : 'password';
      const target = username ? `${username}@${host}:${port}` : `${host}:${port}`;
      return `Connection failed for ${target} using ${authType} authentication. Check host, port, credentials, VPN/firewall, SSH/SFTP access, and private key path/passphrase when applicable. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.SaveConnection) {
      return `Could not save the connection profile. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.DeleteConnection) {
      return `Could not delete the connection profile. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.ListDirectory || messageType === RemoteEditIncomingMessageType.OpenPath) {
      const rawPath = String(payload?.path || this.getActivePath() || '/').trim() || '/';
      const remotePath = normalizeRemotePath(rawPath);
      return `Remote path not found or not accessible: ${remotePath}. Check the path and permissions. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.OpenEntry) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : String(payload?.name || 'selected entry');
      return `Could not open remote entry: ${entryPath}. Check the path, file type, and permissions. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestRenameEntry) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not rename remote entry: ${entryPath}. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestDeleteEntry) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not delete remote entry: ${entryPath}. Details: ${details}`;
    }

    if (messageType === RemoteEditIncomingMessageType.RequestSetPermissions) {
      const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
      return `Could not set permissions on remote entry: ${entryPath}. Details: ${details}`;
    }

    return details;
  }

  private postStatus(message: string): void {
    this.postMessage(RemoteEditOutboundMessageType.Status, { message });
  }

  private postBusy(isBusy: boolean, message: string): void {
    this.postMessage(RemoteEditOutboundMessageType.Busy, { isBusy, message });
  }

  private postError(message: string): void {
    this.postMessage(RemoteEditOutboundMessageType.Error, { message });
  }

  private postMessage(type: RemoteEditOutboundMessageType, payload: any): void {
    void this.panel.webview.postMessage({ type, payload });
  }

  private dispose(): void {
    this.cancelPermissionsDialog();
    RemoteEditPanel.currentPanel = undefined;

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    return renderRemoteEditHtml(webview, getNonce());
  }
}
