import * as vscode from 'vscode';
import type { AuthType, ConnectionGroup, ConnectionManager, ConnectionProfile, ConnectionProfileInput } from '../connection/ConnectionManager';
import { buildRemoteEditUri } from '../filesystem/RemoteEditFileSystemProvider';
import { RemoteEditPanel } from '../panel/RemoteEditPanel';
import { buildCopyFileName } from '../panel/FileNameUtils';
import { buildArchiveBaseName, normalizeArchiveName } from '../panel/ArchiveUtils';
import { getDefaultPortForConnectionType, normalizeConnectionType, type RemoteConnectionType } from '../remote/RemoteConnectionTypes';
import type { RemoteArchiveFormat, RemoteEntry, RemoteEntryType, RemoteSessionManager } from '../remote/RemoteSessionManager';
import { SshTerminalService } from '../ssh/SshTerminalService';
import { RemoteEditSharedState } from '../state/RemoteEditSharedState';
import {
  ConnectionsTreeProvider,
  RemoteEditActionsTreeProvider,
  OpenConnectionsTreeProvider,
  TransfersTreeProvider
} from './TreeProviders';
import { getParentRemotePath, normalizeRemotePath, type ConnectionDetailField, RemoteEditSidebarItem } from './Items';
import { SidebarBackupController } from './BackupController';
import { QUICK_CONNECT_ID, SidebarConnectionDraftStore } from './ConnectionDraftStore';
import { buildRemoteEntryProperties, formatBytes, formatChecksumLine, permissionModeFromString } from './RemoteEntryProperties';
import { SudoModeDecorationProvider } from './SudoModeDecorationProvider';
import { appendDebugLog, appendPerformanceLog, createPerformanceTimer } from '../utils/outputLogger';

interface ConnectionChangeNotifier {
  onDidChangeConnections?: vscode.Event<void>;
}


export class RemoteEditSidebarController implements vscode.Disposable {
  private readonly actionsProvider: RemoteEditActionsTreeProvider;
  private readonly connectionsProvider: ConnectionsTreeProvider;
  private readonly openConnectionsProvider: OpenConnectionsTreeProvider;
  private readonly connectionsTreeView: vscode.TreeView<RemoteEditSidebarItem>;
  private readonly openConnectionsTreeView: vscode.TreeView<RemoteEditSidebarItem>;
  private readonly transfersProvider = new TransfersTreeProvider();
  private readonly backupController: SidebarBackupController;
  private readonly sudoModeDecorationProvider: SudoModeDecorationProvider;
  private readonly sshTerminalService: SshTerminalService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly connectionDrafts = new SidebarConnectionDraftStore();
  private readonly connectingProfileIds = new Set<string>();
  private openConnectionsNavigationSequence = 0;
  private openConnectionsRevealChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessions: RemoteSessionManager,
    private readonly connectionManager: ConnectionManager,
    private readonly output: vscode.OutputChannel
  ) {
    this.actionsProvider = new RemoteEditActionsTreeProvider({
      hasLogViewerConnection: () => Boolean(this.resolveLogViewerConnectionId())
    });
    this.connectionsProvider = new ConnectionsTreeProvider(connectionManager, {
      getQuickConnectProfile: () => this.connectionDrafts.buildQuickConnectProfile(),
      getDraftProfile: profile => this.connectionDrafts.mergeProfileWithDraft(profile),
      getNewDraftProfiles: () => this.connectionDrafts.getNewDraftProfiles(),
      getDraftProfileById: profileId => this.connectionDrafts.getDraftProfileById(profileId),
      hasDraft: profileId => this.connectionDrafts.hasDraft(profileId),
      isConnected: profileId => this.sessions.hasConnection(profileId),
      isConnecting: profileId => this.connectingProfileIds.has(profileId)
    });
    this.openConnectionsProvider = new OpenConnectionsTreeProvider(sessions, connectionManager, output);
    this.sudoModeDecorationProvider = new SudoModeDecorationProvider(sessions);
    this.sshTerminalService = new SshTerminalService(sessions);
    this.backupController = new SidebarBackupController({
      context,
      connectionManager,
      output,
      onImported: () => {
        this.connectionDrafts.clearAll();
        this.connectionsProvider.refresh();
        this.openConnectionsProvider.refresh();
        RemoteEditSharedState.fireProfilesChanged(undefined, 'sidebar', 'profileListChanged');
      }
    });
    this.connectionsTreeView = vscode.window.createTreeView('remoteedit.connectionsView', {
      treeDataProvider: this.connectionsProvider,
      showCollapseAll: true
    });
    this.openConnectionsTreeView = vscode.window.createTreeView('remoteedit.openConnectionsView', {
      treeDataProvider: this.openConnectionsProvider,
      showCollapseAll: true
    });

    const connectionChangeEvent = (sessions as RemoteSessionManager & ConnectionChangeNotifier).onDidChangeConnections;

    if (connectionChangeEvent) {
      this.disposables.push(connectionChangeEvent(() => {
        this.actionsProvider.refresh();
        this.connectionsProvider.refresh();
        this.refreshSudoModeVisualState();

        if (this.shouldRevealOpenConnectionsView()) {
          void this.revealStartPaths();
        }
      }));
    }

    this.disposables.push(RemoteEditSharedState.onActiveConnectionChanged(() => this.actionsProvider.refresh()));
    this.disposables.push(RemoteEditSharedState.onRemoteDirectoryChanged(event => {
      if (event.source === 'sidebar') {
        return;
      }

      this.refreshOpenConnectionDirectory(event.connectionId, event.remotePath);
    }));
    this.disposables.push(this.connectionsTreeView.onDidChangeSelection(event => this.expandSelectedConnection(event.selection[0])));
    this.disposables.push(this.connectionsTreeView.onDidExpandElement(event => {
      if (event.element.kind === 'connectionGroup' && event.element.groupId) {
        this.connectionsProvider.markGroupExpanded(event.element.groupId);
      }
    }));
    this.disposables.push(this.connectionsTreeView.onDidCollapseElement(event => {
      if (event.element.kind === 'connectionGroup' && event.element.groupId) {
        this.connectionsProvider.markGroupCollapsed(event.element.groupId);
      }
    }));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('remoteedit.sidebar.showItemInfoOnHover')) {
        this.openConnectionsProvider.refresh();
      }
    }));

    this.disposables.push(RemoteEditPanel.onDidChangeTransferQueue(() => this.transfersProvider.refresh()));
    this.disposables.push(RemoteEditSharedState.onNavigationChanged(event => {
      if (event.source === 'sidebar') {
        return;
      }

      this.openConnectionsProvider.setRootPath(event.connectionId, event.rootPath || event.currentPath, event.source || 'webview');
      this.openConnectionsProvider.refresh();

      if (this.shouldRevealOpenConnectionsView()) {
        void this.revealRemoteDirectory(event.connectionId, event.rootPath || event.currentPath);
      }
    }));
    this.disposables.push(RemoteEditSharedState.onFavoritesChanged(event => {
      this.connectionsProvider.refresh();
      this.openConnectionsProvider.refresh();
      RemoteEditPanel.refreshProfilesIfOpen(event.connectionId);
    }));
    this.disposables.push(RemoteEditSharedState.onProfilesChanged(event => {
      if (event.source === 'sidebar') {
        return;
      }

      const timer = createPerformanceTimer();
      appendDebugLog(this.output, 'Sidebar', 'Profiles changed event received.', {
        Source: event.source || 'unknown',
        Reason: event.reason || 'unspecified',
        SelectedId: event.selectedId || ''
      });
      this.connectionDrafts.clear();
      this.connectionsProvider.refresh();
      this.openConnectionsProvider.refresh();
      appendPerformanceLog(this.output, 'Sidebar', `Refreshed profile trees after profiles changed in ${timer()}ms`, {
        Source: event.source || 'unknown',
        Reason: event.reason || 'unspecified'
      });
    }));

    this.disposables.push(
      vscode.window.registerTreeDataProvider('remoteedit.actionsView', this.actionsProvider),
      vscode.window.registerFileDecorationProvider(this.sudoModeDecorationProvider),
      this.connectionsTreeView,
      this.openConnectionsTreeView,
      vscode.window.registerTreeDataProvider('remoteedit.transfersView', this.transfersProvider),
      vscode.commands.registerCommand('remoteedit.sidebar.newConnection', () => this.addConnection()),
      vscode.commands.registerCommand('remoteedit.sidebar.openSettings', () => this.openSettings()),
      vscode.commands.registerCommand('remoteedit.sidebar.exportBackup', () => this.exportBackup()),
      vscode.commands.registerCommand('remoteedit.sidebar.importBackup', () => this.importBackup()),
      vscode.commands.registerCommand('remoteedit.sidebar.quickConnect', () => this.revealQuickConnect()),
      vscode.commands.registerCommand('remoteedit.sidebar.refreshConnections', () => {
        this.connectionsProvider.refresh();
        void this.updateConnectionsFilterContext();
      }),
      vscode.commands.registerCommand('remoteedit.sidebar.expandConnectionGroups', () => this.expandConnectionGroups()),
      vscode.commands.registerCommand('remoteedit.sidebar.filterConnections', () => this.filterConnections()),
      vscode.commands.registerCommand('remoteedit.sidebar.clearConnectionsFilter', () => this.clearConnectionsFilter()),
      vscode.commands.registerCommand('remoteedit.sidebar.refreshOpenConnections', () => this.refreshOpenConnections()),
      vscode.commands.registerCommand('remoteedit.sidebar.refreshTransfers', () => this.transfersProvider.refresh()),
      vscode.commands.registerCommand('remoteedit.sidebar.openTransferQueue', () => this.openTransferQueue()),
      vscode.commands.registerCommand('remoteedit.sidebar.cancelTransfer', item => this.cancelTransfer(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.copyTransferDetails', item => this.copyTransferDetails(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.copyConnectionDetails', item => this.copyConnectionDetails(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.clearCompletedTransfers', () => this.clearCompletedTransfers()),
      vscode.commands.registerCommand('remoteedit.sidebar.openSavedConnection', item => this.openSavedConnection(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.renameSavedConnection', item => this.renameSavedConnection(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.moveConnectionToGroup', item => this.moveSavedConnectionToGroup(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.deleteSavedConnection', item => this.deleteSavedConnection(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.renameConnectionGroup', item => this.renameConnectionGroup(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.deleteConnectionGroup', item => this.deleteConnectionGroup(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.connectQuickConnect', () => this.connectQuickConnect()),
      vscode.commands.registerCommand('remoteedit.sidebar.clearQuickConnect', () => this.clearQuickConnect()),
      vscode.commands.registerCommand('remoteedit.sidebar.saveConnectionChanges', item => this.saveConnectionChanges(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.discardConnectionChanges', item => this.discardConnectionChanges(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.openConnection', item => this.openConnection(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.disconnectConnection', item => this.disconnectConnection(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.enableSudoMode', item => this.enableSudoMode(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.disableSudoMode', item => this.disableSudoMode(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.openSshTerminal', item => this.openSshTerminal(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.openLogViewer', item => this.openLogViewer(item)),
      vscode.commands.registerCommand('remoteedit.primary.openDirectoryAsRootDirectory', (itemOrConnectionId, maybePath) => this.openDirectoryAsRootDirectory(itemOrConnectionId, maybePath)),
      vscode.commands.registerCommand('remoteedit.sidebar.openFavoritePath', (itemOrConnectionId, maybePath) => this.openFavoritePath(itemOrConnectionId, maybePath)),
      vscode.commands.registerCommand('remoteedit.sidebar.goParentFolder', (itemOrConnectionId, maybePath) => this.goParentFolder(itemOrConnectionId, maybePath)),
      vscode.commands.registerCommand('remoteedit.sidebar.openRemoteDirectory', item => this.openRemoteDirectory(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.openRemoteFile', (itemOrConnectionId, maybePath) => this.openRemoteFile(itemOrConnectionId, maybePath)),
      vscode.commands.registerCommand('remoteedit.sidebar.openRemoteFileReadOnly', item => this.openRemoteFileReadOnly(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.createRemoteFile', item => this.createRemoteEntry(item, 'file')),
      vscode.commands.registerCommand('remoteedit.sidebar.createRemoteDirectory', item => this.createRemoteEntry(item, 'directory')),
      vscode.commands.registerCommand('remoteedit.sidebar.renameRemoteEntry', item => this.renameRemoteEntry(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.makeCopyRemoteFile', item => this.makeCopyRemoteFile(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.deleteRemoteEntry', item => this.deleteRemoteEntry(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.showRemoteEntryProperties', item => this.showRemoteEntryProperties(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.calculateRemoteChecksums', item => this.calculateRemoteChecksums(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.setRemotePermissions', item => this.setRemotePermissions(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.compressToArchive', item => this.compressToArchive(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.downloadRemoteEntry', item => this.downloadRemoteEntry(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.uploadToRemoteDirectory', item => this.uploadToRemoteDirectory(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.refreshRemoteDirectory', item => this.refreshRemoteDirectory(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.copyHostname', item => this.copyHostname(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.copyRemotePath', item => this.copyRemotePath(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.copyRemoteFilename', item => this.copyRemoteFilename(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.addFavoritePath', item => this.addFavoritePath(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.removeFavoritePath', item => this.removeFavoritePath(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.removeDirectoryFavoritePath', item => this.removeFavoritePath(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.editConnectionDetail', (itemOrProfileId, maybeField) => this.editConnectionDetail(itemOrProfileId, maybeField)),
      vscode.commands.registerCommand('remoteedit.sidebar.selectCaCertificatePath', (itemOrProfileId) => this.selectCaCertificatePath(itemOrProfileId)),
      vscode.commands.registerCommand('remoteedit.sidebar.manageConnectionCredentials', (itemOrProfileId) => this.manageConnectionCredentials(itemOrProfileId)),
      vscode.commands.registerCommand('remoteedit.sidebar.copyConnectionDetailValue', item => this.copyConnectionDetailValue(item))
    );

    void this.updateConnectionsFilterContext();
  }

  private async enableSudoMode(item: RemoteEditSidebarItem | undefined): Promise<void> {
    const connectionId = item?.connectionId;
    const connection = connectionId ? this.sessions.getConnection(connectionId) : undefined;

    if (!connectionId || !connection) {
      void vscode.window.showErrorMessage('No open Remote Edit connection selected.');
      return;
    }

    if (String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      void vscode.window.showInformationMessage('Sudo Mode is available for SFTP connections only.');
      return;
    }

    if (this.sessions.isSudoModeEnabled(connectionId)) {
      this.refreshSudoModeVisualState();
      return;
    }

    const password = await vscode.window.showInputBox({
      title: 'Enable Sudo Mode',
      prompt: 'Enter the sudo password for this connection. The password is kept only in memory for the current session.',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Sudo password'
    });

    if (!password) {
      this.sessions.disableSudoMode(connectionId);
      this.refreshSudoModeVisualState();
      return;
    }

    try {
      await this.sessions.enableSudoMode(connectionId, password);
      this.output.appendLine(`[Sidebar] Sudo Mode enabled: ${connectionId}`);
      void vscode.window.showInformationMessage('Sudo Mode enabled for this connection.');
    } catch (error) {
      this.sessions.disableSudoMode(connectionId);
      this.showSidebarCommandError(error);
    } finally {
      this.refreshSudoModeVisualState();
    }
  }

  private disableSudoMode(item: RemoteEditSidebarItem | undefined): void {
    const connectionId = item?.connectionId;

    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      return;
    }

    this.sessions.disableSudoMode(connectionId);
    this.output.appendLine(`[Sidebar] Sudo Mode disabled: ${connectionId}`);
    void vscode.window.showInformationMessage('Sudo Mode disabled.');
    this.refreshSudoModeVisualState();
  }

  private async openLogViewer(item: RemoteEditSidebarItem | undefined): Promise<void> {
    const connectionId = item?.connectionId || this.resolveLogViewerConnectionId();
    const connection = connectionId ? this.sessions.getConnection(connectionId) : undefined;

    if (!connectionId || !connection) {
      void vscode.window.showErrorMessage('No open Remote Edit SSH/SFTP connection selected.');
      return;
    }

    if (!this.canOpenLogViewerForConnection(connection)) {
      void vscode.window.showInformationMessage('Log Viewer is available for SSH/SFTP connections only.');
      return;
    }

    if (item?.kind === 'remoteFile' && item.remotePath) {
      RemoteEditPanel.openLogViewerForFile(this.context, this.sessions, this.connectionManager, this.output, connectionId, item.remotePath);
      return;
    }

    RemoteEditPanel.openLogViewerForConnection(this.context, this.sessions, this.connectionManager, this.output, connectionId);
  }

  private resolveLogViewerConnectionId(): string | undefined {
    const activeConnectionId = RemoteEditSharedState.getActiveConnectionId();
    const activeConnection = activeConnectionId ? this.sessions.getConnection(activeConnectionId) : undefined;

    if (activeConnection && this.canOpenLogViewerForConnection(activeConnection)) {
      return activeConnectionId;
    }

    return this.sessions.listConnections()
      .find(connection => this.canOpenLogViewerForConnection(connection))
      ?.id;
  }

  private canOpenLogViewerForConnection(connection: ReturnType<RemoteSessionManager['getConnection']>): boolean {
    return String(connection?.connectionType || '').toLowerCase() === 'sftp';
  }

  private async openSshTerminal(item: RemoteEditSidebarItem | undefined): Promise<void> {
    const connectionId = item?.connectionId;
    const connection = connectionId ? this.sessions.getConnection(connectionId) : undefined;

    if (!connectionId || !connection) {
      void vscode.window.showErrorMessage('No open Remote Edit connection selected.');
      return;
    }

    if (String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      void vscode.window.showInformationMessage('Open SSH Terminal is available for SFTP/SSH connections only.');
      return;
    }

    try {
      const workingDirectory = this.resolveSshTerminalWorkingDirectory(item, connectionId);
      await this.sshTerminalService.openTerminal(connectionId, workingDirectory);
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private resolveSshTerminalWorkingDirectory(item: RemoteEditSidebarItem | undefined, connectionId: string): string | undefined {
    if (!item) {
      return this.openConnectionsProvider.getRootPathForConnection(connectionId);
    }

    if (item.kind === 'openConnection') {
      return this.openConnectionsProvider.getRootPathForConnection(connectionId) || item.remotePath;
    }

    if (item.kind === 'remoteFile' && item.remotePath) {
      return getParentRemotePath(item.remotePath);
    }

    if ((item.kind === 'favoritePath' || item.kind === 'filesGroup' || item.kind === 'remoteDirectory') && item.remotePath) {
      return normalizeRemotePath(item.remotePath);
    }

    return this.openConnectionsProvider.getRootPathForConnection(connectionId);
  }

  private refreshSudoModeVisualState(): void {
    this.openConnectionsProvider.refresh();
    this.sudoModeDecorationProvider.refresh();
  }


  private openSettings(): void {
    void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:josegrabelha.remoteedit');
  }

  private async exportBackup(): Promise<void> {
    await this.backupController.exportBackup();
  }

  private async importBackup(): Promise<void> {
    await this.backupController.importBackup();
  }

  private async expandConnectionGroups(): Promise<void> {
    if (!(await this.connectionsProvider.hasVisibleConnectionGroups())) {
      await this.updateConnectionsFilterContext();
      return;
    }

    this.connectionsProvider.expandAllGroups();
    await this.updateConnectionsFilterContext();
  }

  private async filterConnections(): Promise<void> {
    const currentFilterText = this.connectionsProvider.getFilterText();
    const value = await vscode.window.showInputBox({
      title: 'Filter Connections',
      prompt: 'Filter saved connections by name, host, username, or type.',
      placeHolder: 'Type to filter saved connections',
      value: currentFilterText,
      valueSelection: [0, currentFilterText.length]
    });

    if (typeof value === 'undefined') {
      return;
    }

    this.connectionsProvider.setFilterText(value);
    await this.updateConnectionsFilterContext();
  }

  private async clearConnectionsFilter(): Promise<void> {
    this.connectionsProvider.setFilterText('');
    await this.updateConnectionsFilterContext();
  }

  private async updateConnectionsFilterContext(): Promise<void> {
    const hasConnectionGroups = await this.connectionsProvider.hasVisibleConnectionGroups();

    await Promise.all([
      vscode.commands.executeCommand(
        'setContext',
        'remoteedit.connectionsFilterActive',
        Boolean(this.connectionsProvider.getFilterText())
      ),
      vscode.commands.executeCommand(
        'setContext',
        'remoteedit.connectionsHaveGroups',
        hasConnectionGroups
      )
    ]);
  }


  dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }

    this.actionsProvider.dispose();
    this.connectionsProvider.dispose();
    this.openConnectionsProvider.dispose();
    this.transfersProvider.dispose();
    this.sudoModeDecorationProvider.dispose();
  }


  private expandSelectedConnection(item: RemoteEditSidebarItem | undefined): void {
    if (item?.kind !== 'savedConnection' && item?.kind !== 'quickConnect') {
      return;
    }

    void this.connectionsTreeView.reveal(item, { expand: true, focus: false, select: false });
  }


  private revealQuickConnect(): void {
    const item = RemoteEditSidebarItem.quickConnect(this.connectionDrafts.buildQuickConnectProfile());
    void this.connectionsTreeView.reveal(item, { expand: true, focus: true, select: true });
  }

  private async addConnection(): Promise<void> {
    const wizardTimer = createPerformanceTimer();
    const profiles = await this.connectionManager.listProfiles();
    const groups = await this.connectionManager.listGroups();
    const existingNames = new Set([
      ...profiles.map(profile => profile.name.trim().toLowerCase()),
      ...this.connectionDrafts.getNewDraftProfiles().map(profile => profile.name.trim().toLowerCase())
    ]);

    const name = await vscode.window.showInputBox({
      title: 'Add Connection',
      prompt: 'Enter a name for the saved connection.',
      placeHolder: 'Production Server',
      validateInput: value => {
        const trimmed = String(value || '').trim();

        if (!trimmed) {
          return 'Connection name is required.';
        }

        if (existingNames.has(trimmed.toLowerCase())) {
          return `A connection named "${trimmed}" already exists.`;
        }

        return undefined;
      },
      ignoreFocusOut: true
    });

    if (name === undefined) {
      return;
    }

    const groupSelection = await this.promptSidebarConnectionGroup(groups);
    if (!groupSelection) {
      return;
    }

    const selectedType = await vscode.window.showQuickPick([
      { label: 'SFTP', description: 'SSH File Transfer Protocol', value: 'sftp' as RemoteConnectionType },
      { label: 'FTPS', description: 'FTP over TLS/SSL', value: 'ftps' as RemoteConnectionType },
      { label: 'FTP', description: 'File Transfer Protocol', value: 'ftp' as RemoteConnectionType }
    ], {
      title: 'Add Connection',
      placeHolder: 'Select connection type',
      ignoreFocusOut: true
    });

    if (!selectedType) {
      return;
    }

    const connectionType = normalizeConnectionType(selectedType.value);
    const defaultPort = getDefaultPortForConnectionType(connectionType);
    const host = await vscode.window.showInputBox({
      title: 'Add Connection',
      prompt: 'Enter the remote hostname or IP address.',
      placeHolder: 'server.example.com',
      validateInput: value => this.validateConnectionDetailInput('host', value),
      ignoreFocusOut: true
    });

    if (host === undefined) {
      return;
    }

    const portValue = await vscode.window.showInputBox({
      title: 'Add Connection',
      prompt: 'Enter the remote port.',
      value: String(defaultPort),
      validateInput: value => this.validateConnectionDetailInput('port', value),
      ignoreFocusOut: true
    });

    if (portValue === undefined) {
      return;
    }

    const username = await vscode.window.showInputBox({
      title: 'Add Connection',
      prompt: 'Enter the username.',
      placeHolder: 'username',
      validateInput: value => String(value || '').trim() ? undefined : 'Username is required.',
      ignoreFocusOut: true
    });

    if (username === undefined) {
      return;
    }

    let ftpsAllowSelfSignedCertificate = false;
    let ftpsCaCertificatePath = '';

    if (connectionType === 'ftps') {
      const certificateMode = await vscode.window.showQuickPick([
        { label: 'Use CA certificate', description: 'Require a CA certificate path', value: 'ca' as const },
        { label: 'Allow self-signed/untrusted certificate', description: 'Skip CA certificate validation for this profile', value: 'selfSigned' as const }
      ], {
        title: 'Add Connection',
        placeHolder: 'Select FTPS certificate handling',
        ignoreFocusOut: true
      });

      if (!certificateMode) {
        return;
      }

      ftpsAllowSelfSignedCertificate = certificateMode.value === 'selfSigned';

      if (!ftpsAllowSelfSignedCertificate) {
        const caCertificatePath = await vscode.window.showInputBox({
          title: 'Add Connection',
          prompt: 'Enter the CA certificate path for this FTPS connection.',
          placeHolder: '/path/to/ca.pem',
          validateInput: value => this.validateConnectionDetailInput('ftpsCaCertificatePath', value),
          ignoreFocusOut: true
        });

        if (caCertificatePath === undefined) {
          return;
        }

        ftpsCaCertificatePath = caCertificatePath.trim();
      }
    }

    let authType: AuthType = 'password';
    let privateKeyPath = '';
    let password = '';
    let passphrase = '';

    if (connectionType === 'sftp') {
      const selectedAuth = await vscode.window.showQuickPick([
        { label: 'Password', value: 'password' as AuthType },
        { label: 'Private key', value: 'privateKey' as AuthType }
      ], {
        title: 'Add Connection',
        placeHolder: 'Select authentication method',
        ignoreFocusOut: true
      });

      if (!selectedAuth) {
        return;
      }

      authType = selectedAuth.value;
    }

    if (authType === 'privateKey') {
      const keyPath = await vscode.window.showInputBox({
        title: 'Add Connection',
        prompt: 'Enter the private key path.',
        placeHolder: '~/.ssh/id_rsa',
        validateInput: value => this.validateConnectionDetailInput('privateKeyPath', value),
        ignoreFocusOut: true
      });

      if (keyPath === undefined) {
        return;
      }

      privateKeyPath = keyPath.trim();
      const enteredPassphrase = await vscode.window.showInputBox({
        title: 'Add Connection',
        prompt: 'Enter the passphrase to save with this connection. Leave empty to save without a passphrase.',
        password: true,
        ignoreFocusOut: true
      });

      if (enteredPassphrase === undefined) {
        return;
      }

      passphrase = enteredPassphrase;
    } else {
      const enteredPassword = await vscode.window.showInputBox({
        title: 'Add Connection',
        prompt: 'Enter the password to save with this connection. Leave empty to save without a password.',
        password: true,
        ignoreFocusOut: true
      });

      if (enteredPassword === undefined) {
        return;
      }

      password = enteredPassword;
    }

    const startPath = await vscode.window.showInputBox({
      title: 'Add Connection',
      prompt: 'Enter the remote start path.',
      value: '/',
      validateInput: value => String(value || '').trim() ? undefined : 'Start path is required.',
      ignoreFocusOut: true
    });

    if (startPath === undefined) {
      return;
    }

    const keepAliveSelection = await vscode.window.showQuickPick([
      { label: 'On', description: 'Keep the connection alive when supported', value: true },
      { label: 'Off', description: 'Do not send keep-alive requests', value: false }
    ], {
      title: 'Add Connection',
      placeHolder: 'Keep Alive',
      ignoreFocusOut: true
    });

    if (!keepAliveSelection) {
      return;
    }

    let createdGroupId: string | undefined;

    try {
      let groupId = groupSelection.groupId;

      if (groupSelection.newGroupName) {
        const group = await this.connectionManager.createGroup(groupSelection.newGroupName);
        groupId = group.id;
        createdGroupId = group.id;
      }

      const savedProfile = await this.connectionManager.saveProfile({
        name: name.trim(),
        groupId,
        connectionType,
        host: host.trim(),
        port: Number(portValue),
        username: username.trim(),
        authType,
        privateKeyPath: authType === 'privateKey' ? privateKeyPath : undefined,
        password: authType === 'password' ? password : undefined,
        passphrase: authType === 'privateKey' ? passphrase : undefined,
        rememberPassword: authType === 'password' && Boolean(password),
        rememberPassphrase: authType === 'privateKey' && Boolean(passphrase),
        startPath: normalizeRemotePath(startPath),
        keepAlive: keepAliveSelection.value,
        ftpsAllowSelfSignedCertificate,
        ftpsCaCertificatePath
      });

      this.connectionsProvider.refresh();
      RemoteEditSharedState.fireProfilesChanged(savedProfile.id, 'sidebar', 'saveProfile');

      const item = RemoteEditSidebarItem.fromConnectionProfile(savedProfile, {
        connected: false,
        connecting: false
      });
      void this.connectionsTreeView.reveal(item, { expand: true, focus: true, select: true }).then(undefined, () => undefined);
      appendDebugLog(this.output, 'Sidebar', 'New connection guided flow completed.', {
        Profile: savedProfile.name,
        ConnectionType: savedProfile.connectionType,
        GroupId: savedProfile.groupId || 'none'
      });
      appendPerformanceLog(this.output, 'Sidebar', `New connection guided flow completed in ${wizardTimer()}ms`, {
        ConnectionType: savedProfile.connectionType,
        GroupId: savedProfile.groupId || 'none'
      });
      void vscode.window.showInformationMessage('Connection saved.');
    } catch (error) {
      if (createdGroupId) {
        await this.connectionManager.deleteGroup(createdGroupId, false).catch(() => undefined);
      }

      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }

  private async promptSidebarConnectionGroup(groups: ConnectionGroup[]): Promise<{ groupId?: string; newGroupName?: string } | undefined> {
    const orderedGroups = [...groups].sort((a, b) => {
      const nameCompare = String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
      return nameCompare || String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
    type SidebarGroupPickItem = vscode.QuickPickItem & { value: 'none' | 'existing' | 'new'; group?: ConnectionGroup };
    const existingGroupNames = new Set(orderedGroups.map(group => group.name.trim().toLowerCase()));
    const noGroupItem: SidebarGroupPickItem = {
      label: 'No group',
      description: 'Save without a connection group',
      value: 'none'
    };
    const newGroupItem: SidebarGroupPickItem = {
      label: '+ New group...',
      description: 'Create a connection group',
      value: 'new'
    };
    const selected = await this.showQuickPickWithActiveItem<SidebarGroupPickItem>({
      title: 'Add Connection',
      placeHolder: 'Select connection group',
      activeItem: noGroupItem,
      items: [
        newGroupItem,
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        noGroupItem,
        ...orderedGroups.map(group => ({ label: group.name, description: 'Connection group', value: 'existing' as const, group }))
      ]
    });

    if (!selected) {
      return undefined;
    }

    if (selected.value === 'existing') {
      return selected.group ? { groupId: selected.group.id } : undefined;
    }

    if (selected.value === 'new') {
      const groupName = await vscode.window.showInputBox({
        title: 'Add Connection Group',
        prompt: 'Enter a name for the new connection group.',
        placeHolder: 'Production',
        validateInput: value => {
          const trimmed = String(value || '').trim();

          if (!trimmed) {
            return 'Group name is required.';
          }

          if (existingGroupNames.has(trimmed.toLowerCase())) {
            return `A connection group named "${trimmed}" already exists.`;
          }

          return undefined;
        },
        ignoreFocusOut: true
      });

      if (groupName === undefined) {
        return undefined;
      }

      return { newGroupName: groupName.trim() };
    }

    return {};
  }

  private openRemoteEdit(): void {
    RemoteEditPanel.open(this.context, this.sessions, this.connectionManager, this.output);
    this.connectionsProvider.refresh();
    this.refreshOpenConnectionsAndRevealStartPaths();
  }

  private refreshOpenConnections(): void {
    this.openConnectionsProvider.refresh();
  }

  private refreshOpenConnectionDirectory(connectionId: string, remotePath: string): void {
    const connection = this.sessions.getConnection(connectionId);

    if (!connection) {
      return;
    }

    const normalizedPath = normalizeRemotePath(remotePath || '/');
    const rootPath = this.openConnectionsProvider.getRootPathForConnection(connectionId) || connection.startPath || '/';
    const normalizedRootPath = normalizeRemotePath(rootPath);
    const targetItem = normalizedPath === normalizedRootPath
      ? RemoteEditSidebarItem.filesGroup(connection, normalizedRootPath)
      : RemoteEditSidebarItem.remoteDirectoryPlaceholder(connectionId, normalizedPath, normalizedRootPath);

    this.openConnectionsProvider.refresh(targetItem, { forceRefresh: true });
    this.openConnectionsProvider.refresh();
  }

  private shouldRevealOpenConnectionsView(): boolean {
    return this.openConnectionsTreeView.visible;
  }

  private refreshOpenConnectionsAndRevealStartPaths(): void {
    this.openConnectionsProvider.refresh();

    if (this.shouldRevealOpenConnectionsView()) {
      void this.revealStartPaths();
    }
  }

  private async revealStartPaths(): Promise<void> {
    if (!this.shouldRevealOpenConnectionsView()) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 150));

    if (!this.shouldRevealOpenConnectionsView()) {
      return;
    }

    for (const connection of this.sessions.listConnections()) {
      try {
        const item = await this.openConnectionsProvider.getStartPathItem(connection.id);

        if (item) {
          await this.openConnectionsTreeView.reveal(item, { select: true, focus: false, expand: true });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`[Sidebar] Unable to reveal start path for ${connection.name || connection.id}: ${message}`);
      }
    }
  }

  private openConnection(item: RemoteEditSidebarItem | string | undefined): void {
    const connectionId = this.resolveConnectionId(item);

    if (!connectionId) {
      this.openRemoteEdit();
      return;
    }

    RemoteEditSharedState.setActiveConnection(connectionId);
    RemoteEditPanel.syncConnectionIfOpen(connectionId);
    this.refreshOpenConnectionsAndRevealStartPaths();
  }

  private disconnectConnection(item: RemoteEditSidebarItem | string | undefined): void {
    const connectionId = this.resolveConnectionId(item);

    if (!connectionId) {
      return;
    }

    if (!RemoteEditPanel.disconnectConnectionIfOpen(connectionId)) {
      void this.disconnectConnectionWithoutWebview(connectionId);
    }
  }

  private async disconnectConnectionWithoutWebview(connectionId: string): Promise<void> {
    try {
      await this.sessions.disconnect(connectionId);
      RemoteEditSharedState.deleteNavigation(connectionId);

      const activeConnectionId = RemoteEditSharedState.getActiveConnectionId();
      if (activeConnectionId === connectionId) {
        RemoteEditSharedState.setActiveConnection(this.sessions.listConnections()[0]?.id);
      }

      this.connectionsProvider.refresh();
      this.openConnectionsProvider.refresh();
      this.refreshSudoModeVisualState();
      void vscode.window.showInformationMessage('Disconnected.');
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private async openDirectoryAsRootDirectory(itemOrConnectionId: RemoteEditSidebarItem | string | undefined, maybePath?: string): Promise<void> {
    const connectionId = typeof itemOrConnectionId === 'string'
      ? itemOrConnectionId
      : itemOrConnectionId?.connectionId;
    const remotePath = typeof maybePath === 'string'
      ? maybePath
      : itemOrConnectionId instanceof RemoteEditSidebarItem
        ? itemOrConnectionId.remotePath
        : undefined;

    if (!connectionId || !remotePath) {
      return;
    }

    await this.setOpenConnectionRoot(connectionId, remotePath);
  }

  private async openFavoritePath(itemOrConnectionId: RemoteEditSidebarItem | string | undefined, maybePath?: string): Promise<void> {
    const connectionId = typeof itemOrConnectionId === 'string'
      ? itemOrConnectionId
      : itemOrConnectionId?.connectionId;
    const remotePath = typeof maybePath === 'string'
      ? maybePath
      : itemOrConnectionId instanceof RemoteEditSidebarItem
        ? itemOrConnectionId.remotePath
        : undefined;

    if (!connectionId || !remotePath) {
      return;
    }

    await this.setOpenConnectionRoot(connectionId, remotePath);
  }

  private async goParentFolder(itemOrConnectionId: RemoteEditSidebarItem | string | undefined, maybePath?: string): Promise<void> {
    const connectionId = typeof itemOrConnectionId === 'string'
      ? itemOrConnectionId
      : itemOrConnectionId?.connectionId;
    const remotePath = typeof maybePath === 'string'
      ? maybePath
      : itemOrConnectionId instanceof RemoteEditSidebarItem
        ? itemOrConnectionId.remotePath
        : undefined;

    if (!connectionId || !remotePath) {
      return;
    }

    await this.setOpenConnectionRoot(connectionId, remotePath);
  }

  private async setOpenConnectionRoot(connectionId: string, remotePath: string): Promise<void> {
    const connection = this.sessions.getConnection(connectionId);

    if (!connection) {
      void vscode.window.showErrorMessage('The selected Remote Edit connection is not connected.');
      return;
    }

    const normalizedPath = normalizeRemotePath(remotePath || '/');
    this.openConnectionsProvider.setRootPath(connectionId, normalizedPath, 'sidebar');
    RemoteEditPanel.syncRemotePathIfOpen(connectionId, normalizedPath);

    const targetItem = RemoteEditSidebarItem.filesGroup(connection, normalizedPath);

    await this.revealOpenConnectionItem(targetItem, ++this.openConnectionsNavigationSequence);
  }

  private async openRemoteDirectory(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    await this.revealRemoteDirectory(item.connectionId, item.remotePath, item);
  }

  private async revealRemoteDirectory(connectionId: string, remotePath: string, item?: RemoteEditSidebarItem): Promise<void> {
    const connection = this.sessions.getConnection(connectionId);

    if (!connection) {
      void vscode.window.showErrorMessage('The selected Remote Edit connection is not connected.');
      return;
    }

    const normalizedPath = normalizeRemotePath(remotePath || '/');

    if (item) {
      this.openConnectionsProvider.setRootPath(connectionId, normalizedPath, 'sidebar');
      RemoteEditPanel.syncRemotePathIfOpen(connectionId, normalizedPath);
    }

    const targetItem = item || (normalizedPath === '/'
      ? RemoteEditSidebarItem.filesGroup(connection, this.openConnectionsProvider.getRootPathForConnection(connectionId))
      : RemoteEditSidebarItem.remoteDirectoryPlaceholder(connectionId, normalizedPath, this.openConnectionsProvider.getRootPathForConnection(connectionId)));

    this.openConnectionsProvider.refresh(targetItem);
    await this.revealOpenConnectionItem(targetItem, ++this.openConnectionsNavigationSequence);
  }

  private async revealOpenConnectionItem(targetItem: RemoteEditSidebarItem, requestSequence: number): Promise<void> {
    if (!this.shouldRevealOpenConnectionsView()) {
      return;
    }

    const previousReveal = this.openConnectionsRevealChain;
    let releaseReveal!: () => void;
    const currentReveal = previousReveal
      .catch(() => undefined)
      .then(() => new Promise<void>(resolve => {
        releaseReveal = resolve;
      }));

    this.openConnectionsRevealChain = currentReveal;
    await previousReveal.catch(() => undefined);

    try {
      if (requestSequence !== this.openConnectionsNavigationSequence) {
        return;
      }

      await this.openConnectionsTreeView.reveal(targetItem, { select: true, focus: true, expand: true });
    } catch {
      if (requestSequence === this.openConnectionsNavigationSequence) {
        this.openConnectionsProvider.refresh();
      }
    } finally {
      releaseReveal();

      if (this.openConnectionsRevealChain === currentReveal) {
        this.openConnectionsRevealChain = Promise.resolve();
      }
    }
  }

  private async openRemoteFile(itemOrConnectionId: RemoteEditSidebarItem | string | undefined, maybePath?: string): Promise<void> {
    const connectionId = typeof itemOrConnectionId === 'string'
      ? itemOrConnectionId
      : itemOrConnectionId?.connectionId;
    const remotePath = typeof maybePath === 'string'
      ? maybePath
      : itemOrConnectionId instanceof RemoteEditSidebarItem
        ? itemOrConnectionId.remotePath
        : undefined;

    if (!connectionId || !remotePath) {
      return;
    }

    await this.openRemoteFileInEditor(connectionId, remotePath, false);
  }

  private async openRemoteFileReadOnly(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    await this.openRemoteFileInEditor(item.connectionId, item.remotePath, true);
  }

  private async openRemoteFileInEditor(connectionId: string, remotePath: string, readOnly: boolean): Promise<void> {
    if (!this.sessions.hasConnection(connectionId)) {
      void vscode.window.showErrorMessage('The selected Remote Edit connection is not connected.');
      return;
    }

    const connection = this.sessions.getConnection(connectionId);
    const displayAuthority = connection
      ? `${connection.username}@${connection.host}:${connection.port}`
      : connectionId;
    const uri = buildRemoteEditUri(connectionId, remotePath, displayAuthority, { readOnly });
    await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
  }

  private async createRemoteEntry(item: RemoteEditSidebarItem | undefined, entryKind: 'file' | 'directory'): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    const targetDirectory = normalizeRemotePath(item.remotePath);
    const label = entryKind === 'directory' ? 'directory' : 'file';
    const newName = await vscode.window.showInputBox({
      title: entryKind === 'directory' ? 'Remote Edit: Create New Directory' : 'Remote Edit: Create New File',
      prompt: `Enter the name for the new remote ${label}.`,
      placeHolder: entryKind === 'directory' ? 'new-folder' : 'new-file.txt',
      validateInput: value => this.validateRemoteEntryName(value, `The ${label} name cannot be empty.`)
    });

    if (newName === undefined) {
      return;
    }

    const trimmedName = newName.trim();
    const newPath = this.joinRemotePath(targetDirectory, trimmedName);

    try {
      await this.ensureRemotePathDoesNotExist(item.connectionId, newPath, label);

      if (entryKind === 'directory') {
        await this.sessions.createDirectory(item.connectionId, newPath);
      } else {
        await this.sessions.createFile(item.connectionId, newPath);
      }

      this.output.appendLine(`[Sidebar] Created remote ${label}: ${newPath}`);
      void vscode.window.showInformationMessage(`Created ${trimmedName}.`);
      this.refreshOpenConnections();
      RemoteEditSharedState.fireRemoteDirectoryChanged(item.connectionId, targetDirectory, 'sidebar');
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private async makeCopyRemoteFile(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    if (this.getRemoteItemType(item) !== 'file') {
      void vscode.window.showErrorMessage('Select a single remote file to make a copy.');
      return;
    }

    const currentName = this.getRemoteItemName(item);
    const parentPath = this.dirnameRemotePath(item.remotePath);
    const defaultName = await this.buildAvailableCopyName(item.connectionId, parentPath, currentName);
    const copyName = await vscode.window.showInputBox({
      title: 'Remote Edit: Make a Copy',
      prompt: 'Enter the name for the remote file copy.',
      value: defaultName,
      valueSelection: [0, defaultName.length],
      validateInput: value => {
        const nameError = this.validateRemoteEntryName(value, 'The copy name cannot be empty.');
        if (nameError) {
          return nameError;
        }

        if (value.trim() === currentName) {
          return 'The copy name must be different from the original file name.';
        }

        return undefined;
      }
    });

    if (copyName === undefined) {
      return;
    }

    const trimmedName = copyName.trim();
    const newPath = this.joinRemotePath(parentPath, trimmedName);
    let overwrite = false;

    try {
      const existingTarget = await this.tryStatRemotePath(item.connectionId, newPath);

      if (existingTarget) {
        if (existingTarget.type !== 'file') {
          throw new Error(`A remote ${existingTarget.type} already exists at ${newPath}. Choose another name.`);
        }

        const confirmed = await vscode.window.showWarningMessage(
          `Overwrite remote file '${trimmedName}'?`,
          { modal: true, detail: newPath },
          'Overwrite'
        );

        if (confirmed !== 'Overwrite') {
          return;
        }

        overwrite = true;
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: `Copying ${currentName}...`,
        cancellable: false
      }, async () => {
        await this.sessions.copyFile(item.connectionId!, item.remotePath!, newPath, overwrite);
      });

      this.output.appendLine(`[Sidebar] Copied remote file: ${item.remotePath} -> ${newPath}`);
      void vscode.window.showInformationMessage(`Copied to ${trimmedName}.`);
      this.refreshOpenConnections();
      RemoteEditSharedState.fireRemoteDirectoryChanged(item.connectionId, parentPath, 'sidebar');
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private async renameRemoteEntry(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    const currentName = this.getRemoteItemName(item);
    const newName = await vscode.window.showInputBox({
      title: 'Remote Edit: Rename',
      prompt: 'Enter the new name for the selected remote item.',
      value: currentName,
      valueSelection: [0, currentName.length],
      validateInput: value => this.validateRemoteEntryName(value, 'The new name cannot be empty.')
    });

    if (newName === undefined) {
      return;
    }

    const trimmedName = newName.trim();

    if (trimmedName === currentName) {
      void vscode.window.showInformationMessage('Rename skipped: the new name is the same as the current name.');
      return;
    }

    const parentPath = this.dirnameRemotePath(item.remotePath);
    const newPath = this.joinRemotePath(parentPath, trimmedName);

    try {
      await this.sessions.rename(item.connectionId, item.remotePath, newPath);
      this.output.appendLine(`[Sidebar] Renamed remote item: ${item.remotePath} -> ${newPath}`);
      void vscode.window.showInformationMessage('Item renamed.');
      this.refreshOpenConnections();
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private async deleteRemoteEntry(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    const entryName = this.getRemoteItemName(item);
    const entryType = this.getRemoteItemType(item);
    const kind = entryType === 'directory' ? 'folder' : entryType === 'file' ? 'file' : 'item';
    const confirmed = await vscode.window.showWarningMessage(
      `Delete remote ${kind} '${entryName}'? This action cannot be undone.`,
      { modal: true, detail: item.remotePath },
      'Delete'
    );

    if (confirmed !== 'Delete') {
      return;
    }

    try {
      await this.sessions.delete(item.connectionId, item.remotePath);
      this.output.appendLine(`[Sidebar] Deleted remote item: ${item.remotePath}`);
      void vscode.window.showInformationMessage(`Deleted ${entryName}.`);
      this.refreshOpenConnections();
      RemoteEditSharedState.fireRemoteDirectoryChanged(item.connectionId, this.dirnameRemotePath(item.remotePath), 'sidebar');
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private async showRemoteEntryProperties(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    try {
      const connection = this.sessions.getConnection(item.connectionId);
      const stats = item.remoteEntry ? undefined : await this.sessions.stat(item.connectionId, item.remotePath);
      const properties = buildRemoteEntryProperties(item, this.getRemoteItemName(item), connection, stats);
      const copyContent = [properties.title, '', ...properties.rows.map(row => `${row[0]}: ${row[1] || '—'}`)].join('\n');
      const detail = properties.rows.map(row => `${row[0]}: ${row[1] || '—'}`).join('\n');

      const copyItem: vscode.MessageItem = { title: 'Copy' };
      const closeItem: vscode.MessageItem = { title: 'Close', isCloseAffordance: true };
      const choice = await vscode.window.showInformationMessage(
        properties.title,
        { modal: true, detail },
        copyItem,
        closeItem
      );

      if (choice === copyItem) {
        await vscode.env.clipboard.writeText(copyContent);
        void vscode.window.showInformationMessage('Copied item properties.');
      }
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private async calculateRemoteChecksums(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    try {
      const name = this.getRemoteItemName(item);
      const stats = await this.sessions.stat(item.connectionId, item.remotePath);

      if (stats.type !== 'file') {
        void vscode.window.showWarningMessage('Select a single remote file to calculate checksums.');
        return;
      }

      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: 'Calculating remote checksums...',
        cancellable: false
      }, async progress => {
        progress.report({ message: 'Calculating SHA-256 and MD5 on the server...' });
        return await this.sessions.calculateChecksums(item.connectionId!, item.remotePath!);
      });

      const sha256 = formatChecksumLine(result.sha256);
      const md5 = formatChecksumLine(result.md5);
      const copyContent = [
        `Checksums for ${name}`,
        '',
        `Remote file: ${item.remotePath}`,
        `Size: ${formatBytes(stats.size)}`,
        `Modified: ${this.formatTimestamp(stats.modifyTime)}`,
        '',
        `SHA-256: ${sha256}`,
        '',
        `MD5: ${md5}`
      ].join('\n');
      const detail = [
        `Remote file: ${item.remotePath}`,
        `Size: ${formatBytes(stats.size)}`,
        `Modified: ${this.formatTimestamp(stats.modifyTime)}`,
        '',
        `SHA-256: ${sha256}`,
        '',
        `MD5: ${md5}`
      ].join('\n');

      const copyItem: vscode.MessageItem = { title: 'Copy' };
      const closeItem: vscode.MessageItem = { title: 'Close', isCloseAffordance: true };
      const choice = await vscode.window.showInformationMessage(
        `Checksums for ${name}`,
        { modal: true, detail },
        copyItem,
        closeItem
      );

      if (choice === copyItem) {
        await vscode.env.clipboard.writeText(copyContent);
        void vscode.window.showInformationMessage('Copied checksums.');
      }
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }


  private async compressToArchive(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    const formatPick = await vscode.window.showQuickPick([
      { label: 'tar.gz', value: 'tar.gz' as RemoteArchiveFormat },
      { label: 'tar.bz2', value: 'tar.bz2' as RemoteArchiveFormat },
      { label: 'tar.xz', value: 'tar.xz' as RemoteArchiveFormat },
      { label: 'tar.Z', value: 'tar.Z' as RemoteArchiveFormat }
    ], {
      title: 'Remote Edit: Compress to Archive',
      placeHolder: 'Select archive format.'
    });

    if (!formatPick) {
      return;
    }

    const format = formatPick.value;
    const baseDirectory = this.dirnameRemotePath(item.remotePath);
    const entryName = this.getRemoteItemName(item);
    const defaultName = await this.buildDefaultArchiveName(item.connectionId, baseDirectory, [{ name: entryName }], format);
    const archiveNameInput = await vscode.window.showInputBox({
      title: 'Remote Edit: Compress to Archive',
      prompt: 'Enter the archive filename to create in the selected item parent directory.',
      value: defaultName,
      valueSelection: [0, defaultName.length],
      validateInput: value => {
        const normalized = normalizeArchiveName(value, format);
        if (!normalized) {
          return 'The archive name cannot be empty.';
        }
        if (normalized === '.' || normalized === '..') {
          return "The archive name cannot be '.' or '..'.";
        }
        if (normalized.includes('/') || normalized.includes('\\')) {
          return 'The archive name must not contain path separators.';
        }
        if (normalized === entryName) {
          return 'The archive name must be different from the selected item name.';
        }
        return undefined;
      }
    });

    if (archiveNameInput === undefined) {
      return;
    }

    const archiveName = normalizeArchiveName(archiveNameInput, format);
    const archivePath = this.joinRemotePath(baseDirectory, archiveName);
    let overwrite = false;

    try {
      const existingTarget = await this.tryStatRemotePath(item.connectionId, archivePath);
      if (existingTarget?.type === 'directory') {
        throw new Error(`A remote directory already exists at ${archivePath}. Choose another name.`);
      }
      if (existingTarget) {
        const confirmed = await vscode.window.showWarningMessage(
          `Overwrite remote archive '${archiveName}'?`,
          { modal: true, detail: archivePath },
          'Overwrite'
        );
        if (confirmed !== 'Overwrite') {
          return;
        }
        overwrite = true;
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: `Creating ${archiveName}...`,
        cancellable: false
      }, async () => {
        await this.sessions.createArchive(item.connectionId!, baseDirectory, [entryName], archiveName, format, overwrite);
      });

      this.output.appendLine(`[Sidebar] Created remote archive: ${archivePath}`);
      void vscode.window.showInformationMessage(`Created ${archiveName}.`);
      this.refreshOpenConnections();
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private async downloadRemoteEntry(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    RemoteEditPanel.requestDownloadEntriesFromSidebar(
      this.context,
      this.sessions,
      this.connectionManager,
      this.output,
      {
        connectionId: item.connectionId,
        entries: [{
          name: this.getRemoteItemName(item),
          type: this.getRemoteItemType(item),
          effectiveType: this.getRemoteItemType(item),
          path: item.remotePath
        }]
      }
    );
  }

  private async uploadToRemoteDirectory(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    const itemType = this.getRemoteItemType(item);
    const targetDirectory = itemType === 'directory'
      ? item.remotePath
      : this.dirnameRemotePath(item.remotePath);

    RemoteEditPanel.requestUploadEntriesFromSidebar(
      this.context,
      this.sessions,
      this.connectionManager,
      this.output,
      {
        connectionId: item.connectionId,
        targetDirectory
      }
    );
  }

  private async tryStatRemotePath(connectionId: string, remotePath: string): Promise<{ type: 'file' | 'directory' | 'unknown'; size: number; modifyTime: number; accessTime: number } | undefined> {
    try {
      return await this.sessions.stat(connectionId, remotePath);
    } catch {
      return undefined;
    }
  }

  private async buildAvailableCopyName(connectionId: string, parentPath: string, fileName: string): Promise<string> {
    for (let index = 1; index <= 999; index += 1) {
      const candidate = buildCopyFileName(fileName, index);
      const candidatePath = this.joinRemotePath(parentPath, candidate);
      const existingTarget = await this.tryStatRemotePath(connectionId, candidatePath);

      if (!existingTarget) {
        return candidate;
      }
    }

    return buildCopyFileName(fileName, Date.now());
  }

  private async buildDefaultArchiveName(connectionId: string, baseDirectory: string, entries: Array<{ name: string }>, format: RemoteArchiveFormat): Promise<string> {
    const baseName = buildArchiveBaseName(entries);
    const extension = `.${format}`;

    for (let index = 0; index <= 999; index += 1) {
      const candidate = `${index === 0 ? baseName : `${baseName}-${index}`}${extension}`;
      const existingTarget = await this.tryStatRemotePath(connectionId, this.joinRemotePath(baseDirectory, candidate));

      if (!existingTarget && !entries.some(entry => entry.name === candidate)) {
        return candidate;
      }
    }

    return `${baseName}-${Date.now()}${extension}`;
  }

  private async setRemotePermissions(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    const currentPermissions = String(item.remoteEntry?.permissions || '').trim();
    const currentMode = permissionModeFromString(currentPermissions);
    const mode = await vscode.window.showInputBox({
      title: 'Remote Edit: Set Permissions',
      prompt: `Enter the octal permissions for ${this.getRemoteItemName(item) || item.remotePath}.`,
      placeHolder: currentMode || '0755',
      value: currentMode || '',
      validateInput: value => /^[0-7]{3,4}$/.test(String(value || '').trim()) ? undefined : 'Enter a valid octal mode using 3 or 4 digits from 0 to 7.'
    });

    if (mode === undefined) {
      return;
    }

    const normalizedMode = mode.trim().padStart(4, '0');
    let recursive = false;

    if (this.getRemoteItemType(item) === 'directory') {
      const choice = await vscode.window.showQuickPick(['This directory only', 'Apply recursively'], {
        title: 'Remote Edit: Set Permissions',
        placeHolder: 'Choose how to apply permissions.'
      });

      if (!choice) {
        return;
      }

      recursive = choice === 'Apply recursively';
    }

    try {
      await this.sessions.chmod(item.connectionId, item.remotePath, normalizedMode, { recursive });
      this.output.appendLine(`[Sidebar] Set remote permissions: ${normalizedMode} ${recursive ? '(recursive) ' : ''}${item.remotePath}`);
      void vscode.window.showInformationMessage(`Permissions set to ${normalizedMode}.`);
      this.refreshOpenConnections();
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private refreshRemoteDirectory(item: RemoteEditSidebarItem | undefined): void {
    this.openConnectionsProvider.refresh(item, { forceRefresh: true });
  }

  private async copyHostname(item: RemoteEditSidebarItem | string | undefined): Promise<void> {
    const profileId = typeof item === 'string' ? item : item?.profileId;
    const activeConnection = this.resolveConnectionId(item)
      ? this.sessions.getConnection(this.resolveConnectionId(item) || '')
      : undefined;

    if (activeConnection?.host) {
      await vscode.env.clipboard.writeText(activeConnection.host);
      void vscode.window.showInformationMessage(`Copied hostname: ${activeConnection.host}`);
      return;
    }

    if (!profileId) {
      return;
    }

    const profile = await this.connectionManager.getProfile(profileId);

    if (!profile) {
      this.connectionsProvider.refresh();
      void vscode.window.showWarningMessage('The selected saved connection no longer exists.');
      return;
    }

    const visibleProfile = this.connectionDrafts.mergeProfileWithDraft(profile);
    await vscode.env.clipboard.writeText(visibleProfile.host);
    void vscode.window.showInformationMessage(`Copied hostname: ${visibleProfile.host}`);
  }

  private async copyRemotePath(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.remotePath) {
      return;
    }

    await vscode.env.clipboard.writeText(item.remotePath);
    void vscode.window.showInformationMessage(`Copied remote path: ${item.remotePath}`);
  }

  private async copyRemoteFilename(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.remotePath) {
      return;
    }

    const filename = this.getRemoteItemName(item);

    if (!filename) {
      return;
    }

    await vscode.env.clipboard.writeText(filename);
    void vscode.window.showInformationMessage(`Copied filename: ${filename}`);
  }

  private validateRemoteEntryName(value: string, emptyMessage: string): string | undefined {
    const trimmed = value.trim();

    if (!trimmed) {
      return emptyMessage;
    }

    if (trimmed === '.' || trimmed === '..') {
      return "The name cannot be '.' or '..'.";
    }

    if (trimmed.includes('/') || trimmed.includes('\\')) {
      return 'The name must not contain path separators.';
    }

    return undefined;
  }

  private async ensureRemotePathDoesNotExist(connectionId: string, remotePath: string, label: string): Promise<void> {
    try {
      await this.sessions.stat(connectionId, remotePath);
    } catch {
      return;
    }

    throw new Error(`A remote ${label} already exists at ${remotePath}.`);
  }

  private dirnameRemotePath(remotePath: string): string {
    return getParentRemotePath(normalizeRemotePath(remotePath));
  }

  private joinRemotePath(parentPath: string, name: string): string {
    const normalizedParent = normalizeRemotePath(parentPath || '/');
    return normalizedParent === '/' ? `/${name}` : `${normalizedParent}/${name}`;
  }

  private formatTimestamp(value: number): string {
    if (!value) {
      return '—';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '—';
    }

    return date.toLocaleString();
  }


  private showSidebarCommandError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.output.appendLine(`[Sidebar] Operation failed: ${message}`);
    void vscode.window.showErrorMessage(message);
  }

  private getRemoteItemName(item: RemoteEditSidebarItem): string {
    const label = typeof item.label === 'string' ? item.label : String(item.label?.label || '');
    return item.remoteEntry?.name || label || item.remotePath?.split('/').filter(Boolean).pop() || item.remotePath || '';
  }

  private getRemoteItemType(item: RemoteEditSidebarItem): string {
    if (item.kind === 'remoteDirectory' || item.kind === 'filesGroup') {
      return 'directory';
    }

    if (item.kind === 'remoteFile') {
      return 'file';
    }

    return item.remoteEntry?.effectiveType || item.remoteEntry?.type || 'item';
  }

  private async addFavoritePath(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    try {
      await this.connectionManager.addFavoriteRemotePath(item.connectionId, item.remotePath);
      RemoteEditSharedState.fireFavoritesChanged(item.connectionId, 'sidebar');
      this.connectionsProvider.refresh();
      this.openConnectionsProvider.refresh();
      void vscode.window.showInformationMessage(`Added favorite path: ${item.remotePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }

  private async removeFavoritePath(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    try {
      await this.connectionManager.removeFavoriteRemotePath(item.connectionId, item.remotePath);
      RemoteEditSharedState.fireFavoritesChanged(item.connectionId, 'sidebar');
      this.connectionsProvider.refresh();
      this.openConnectionsProvider.refresh();
      void vscode.window.showInformationMessage(`Removed favorite path: ${item.remotePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }


  private async editConnectionDetail(itemOrProfileId: RemoteEditSidebarItem | string | undefined, maybeField?: ConnectionDetailField): Promise<void> {
    const profileId = typeof itemOrProfileId === 'string' ? itemOrProfileId : itemOrProfileId?.profileId;
    const field = typeof maybeField === 'string' ? maybeField : itemOrProfileId instanceof RemoteEditSidebarItem ? itemOrProfileId.connectionDetailField : undefined;

    if (!profileId || !field) {
      return;
    }

    if (!this.connectionDrafts.isQuickConnectId(profileId) && this.sessions.hasConnection(profileId)) {
      void vscode.window.showInformationMessage('Disconnect to edit this connection.');
      this.connectionsProvider.refresh();
      return;
    }

    if (field === 'credentials') {
      await this.manageConnectionCredentials(profileId);
      return;
    }

    const isQuickConnect = this.connectionDrafts.isQuickConnectId(profileId);
    const storedProfile = isQuickConnect ? undefined : await this.connectionManager.getProfile(profileId);
    const draftProfile = isQuickConnect
      ? this.connectionDrafts.buildQuickConnectProfile()
      : storedProfile
        ? this.connectionDrafts.mergeProfileWithDraft(storedProfile)
        : this.connectionDrafts.getDraftProfileById(profileId);

    if (!draftProfile) {
      this.connectionsProvider.refresh();
      void vscode.window.showWarningMessage('The selected saved connection no longer exists.');
      return;
    }

    const currentProfile = draftProfile;

    try {
      if (field === 'keepAlive') {
        this.connectionDrafts.updateDraftValue(profileId, { keepAlive: currentProfile.keepAlive === false });
        this.connectionsProvider.refresh();
        return;
      }

      if (field === 'ftpsAllowSelfSignedCertificate') {
        this.connectionDrafts.updateDraftValue(profileId, {
          ftpsAllowSelfSignedCertificate: !currentProfile.ftpsAllowSelfSignedCertificate
        });
        this.connectionsProvider.refresh();
        return;
      }

      if (field === 'connectionType') {
        const previousType = normalizeConnectionType(currentProfile.connectionType || 'sftp');
        const selected = await vscode.window.showQuickPick([
          { label: 'SFTP', value: 'sftp' as RemoteConnectionType },
          { label: 'FTPS', value: 'ftps' as RemoteConnectionType },
          { label: 'FTP', value: 'ftp' as RemoteConnectionType }
        ], {
          title: 'Select connection type',
          placeHolder: String(currentProfile.connectionType || 'sftp').toUpperCase()
        });

        if (!selected) {
          return;
        }

        const nextType = normalizeConnectionType(selected.value);
        const previousDefaultPort = getDefaultPortForConnectionType(previousType);
        const nextDefaultPort = getDefaultPortForConnectionType(nextType);
        const shouldUpdatePort = !currentProfile.port || currentProfile.port === previousDefaultPort;

        this.connectionDrafts.updateDraftValue(profileId, {
          connectionType: nextType,
          authType: nextType === 'sftp' ? currentProfile.authType : 'password',
          port: shouldUpdatePort ? nextDefaultPort : currentProfile.port,
          privateKeyPath: nextType === 'sftp' && currentProfile.authType === 'privateKey' ? currentProfile.privateKeyPath : undefined
        });
        this.connectionsProvider.refresh();
        return;
      }

      if (field === 'authType') {
        if (normalizeConnectionType(currentProfile.connectionType || 'sftp') !== 'sftp') {
          void vscode.window.showInformationMessage('FTP and FTPS use password authentication.');
          return;
        }

        const selected = await vscode.window.showQuickPick([
          { label: 'Password', value: 'password' as AuthType },
          { label: 'Private key', value: 'privateKey' as AuthType }
        ], {
          title: 'Select authentication method',
          placeHolder: currentProfile.authType === 'privateKey' ? 'Private key' : 'Password'
        });

        if (!selected) {
          return;
        }

        this.connectionDrafts.updateDraftValue(profileId, { authType: selected.value });
        this.connectionsProvider.refresh();
        return;
      }

      const currentValue = this.getProfileFieldValue(currentProfile, field);
      const label = this.getConnectionDetailLabel(field);
      const value = await vscode.window.showInputBox({
        title: `Edit ${label}`,
        prompt: `Enter ${label.toLowerCase()}.`,
        value: currentValue,
        password: false,
        validateInput: input => this.validateConnectionDetailInput(field, input)
      });

      if (value === undefined) {
        return;
      }

      this.connectionDrafts.updateConnectionDetailDraft(profileId, field, value);
      this.connectionsProvider.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }


  private async selectCaCertificatePath(itemOrProfileId: RemoteEditSidebarItem | string | undefined): Promise<void> {
    const profileId = typeof itemOrProfileId === 'string' ? itemOrProfileId : itemOrProfileId?.profileId;

    if (!profileId) {
      return;
    }

    if (!this.connectionDrafts.isQuickConnectId(profileId) && this.sessions.hasConnection(profileId)) {
      void vscode.window.showInformationMessage('Disconnect to edit this connection.');
      this.connectionsProvider.refresh();
      return;
    }

    const isQuickConnect = this.connectionDrafts.isQuickConnectId(profileId);
    const storedProfile = isQuickConnect ? undefined : await this.connectionManager.getProfile(profileId);
    const profile = isQuickConnect
      ? this.connectionDrafts.buildQuickConnectProfile()
      : storedProfile
        ? this.connectionDrafts.mergeProfileWithDraft(storedProfile)
        : this.connectionDrafts.getDraftProfileById(profileId);

    if (!profile) {
      this.connectionsProvider.refresh();
      void vscode.window.showWarningMessage('The selected saved connection no longer exists.');
      return;
    }

    if (normalizeConnectionType(profile.connectionType || 'sftp') !== 'ftps' || profile.ftpsAllowSelfSignedCertificate) {
      return;
    }

    try {
      const selected = await vscode.window.showOpenDialog({
        title: 'Select CA Certificate File',
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          'Certificate files': ['pem', 'crt', 'cer', 'ca'],
          'All files': ['*']
        }
      });

      const selectedPath = selected?.[0]?.fsPath;
      if (!selectedPath) {
        return;
      }

      this.connectionDrafts.updateDraftValue(profileId, { ftpsCaCertificatePath: selectedPath });
      this.connectionsProvider.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }

  private async manageConnectionCredentials(itemOrProfileId: RemoteEditSidebarItem | string | undefined): Promise<void> {
    const profileId = typeof itemOrProfileId === 'string' ? itemOrProfileId : itemOrProfileId?.profileId;

    if (!profileId) {
      return;
    }

    if (!this.connectionDrafts.isQuickConnectId(profileId) && this.sessions.hasConnection(profileId)) {
      void vscode.window.showInformationMessage('Disconnect to edit this connection.');
      this.connectionsProvider.refresh();
      return;
    }

    const isQuickConnect = this.connectionDrafts.isQuickConnectId(profileId);
    const storedProfile = isQuickConnect ? undefined : await this.connectionManager.getProfile(profileId);
    const profile = isQuickConnect
      ? this.connectionDrafts.buildQuickConnectProfile()
      : storedProfile
        ? this.connectionDrafts.mergeProfileWithDraft(storedProfile)
        : this.connectionDrafts.getDraftProfileById(profileId);

    if (!profile) {
      this.connectionsProvider.refresh();
      void vscode.window.showWarningMessage('The selected saved connection no longer exists.');
      return;
    }

    const isPrivateKey = normalizeConnectionType(profile.connectionType || 'sftp') === 'sftp' && profile.authType === 'privateKey';
    const actions = isPrivateKey
      ? [
          { label: isQuickConnect ? 'Set Passphrase' : 'Update Passphrase', action: 'updatePassphrase' },
          { label: isQuickConnect ? 'Clear Passphrase' : 'Clear Saved Passphrase', action: 'clearPassphrase' }
        ]
      : [
          { label: isQuickConnect ? 'Set Password' : 'Update Password', action: 'updatePassword' },
          { label: isQuickConnect ? 'Clear Password' : 'Clear Saved Password', action: 'clearPassword' }
        ];

    const selected = await vscode.window.showQuickPick(actions, {
      title: isQuickConnect ? 'Quick Connect Credentials' : `Manage credentials for ${profile.name}`,
      placeHolder: isPrivateKey ? 'Passphrase is handled securely.' : 'Password is handled securely.'
    });

    if (!selected) {
      return;
    }

    try {
      if (selected.action === 'updatePassword') {
        const password = await vscode.window.showInputBox({
          title: isQuickConnect ? 'Set Password' : 'Update Saved Password',
          prompt: isQuickConnect ? 'Enter the password for this quick connection.' : 'Enter the password to store securely after Save Changes.',
          password: true,
          ignoreFocusOut: true
        });

        if (password === undefined) {
          return;
        }

        if (!password) {
          void vscode.window.showWarningMessage('Password was not changed.');
          return;
        }

        this.connectionDrafts.updateDraftValue(profileId, { password, rememberPassword: !isQuickConnect });
      } else if (selected.action === 'clearPassword') {
        this.connectionDrafts.updateDraftValue(profileId, { password: '', rememberPassword: false });
      } else if (selected.action === 'updatePassphrase') {
        const passphrase = await vscode.window.showInputBox({
          title: isQuickConnect ? 'Set Passphrase' : 'Update Saved Passphrase',
          prompt: isQuickConnect ? 'Enter the private key passphrase for this quick connection.' : 'Enter the private key passphrase to store securely after Save Changes.',
          password: true,
          ignoreFocusOut: true
        });

        if (passphrase === undefined) {
          return;
        }

        if (!passphrase) {
          void vscode.window.showWarningMessage('Passphrase was not changed.');
          return;
        }

        this.connectionDrafts.updateDraftValue(profileId, { passphrase, rememberPassphrase: !isQuickConnect });
      } else if (selected.action === 'clearPassphrase') {
        this.connectionDrafts.updateDraftValue(profileId, { passphrase: '', rememberPassphrase: false });
      }

      this.connectionsProvider.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }


  private async renameConnectionGroup(item: RemoteEditSidebarItem | string | undefined): Promise<void> {
    const groupId = typeof item === 'string' ? item : item?.groupId;

    if (!groupId) {
      return;
    }

    const groups = await this.connectionManager.listGroups();
    const group = groups.find(candidate => candidate.id === groupId);

    if (!group) {
      void vscode.window.showErrorMessage('The selected connection group no longer exists.');
      this.connectionsProvider.refresh();
      return;
    }

    const existingNames = new Set(
      groups
        .filter(candidate => candidate.id !== group.id)
        .map(candidate => candidate.name.trim().toLowerCase())
    );

    const name = await vscode.window.showInputBox({
      title: 'Rename Connection Group',
      prompt: 'Enter the new connection group name.',
      value: group.name,
      validateInput: value => {
        const trimmed = String(value || '').trim();

        if (!trimmed) {
          return 'Group name is required.';
        }

        if (existingNames.has(trimmed.toLowerCase())) {
          return `A connection group named "${trimmed}" already exists.`;
        }

        return undefined;
      },
      ignoreFocusOut: true
    });

    if (name === undefined) {
      return;
    }

    try {
      await this.connectionManager.renameGroup(group.id, name);
      this.connectionsProvider.refresh();
      RemoteEditSharedState.fireProfilesChanged(undefined, 'sidebar', 'profileListChanged');
      void vscode.window.showInformationMessage('Connection group renamed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }

  private async moveSavedConnectionToGroup(item: RemoteEditSidebarItem | string | undefined): Promise<void> {
    const profileId = typeof item === 'string' ? item : item?.profileId;

    if (!profileId || this.connectionDrafts.isQuickConnectId(profileId) || this.connectionDrafts.isNewDraftId(profileId)) {
      return;
    }

    const profile = await this.connectionManager.getProfile(profileId);

    if (!profile) {
      void vscode.window.showErrorMessage('The selected saved connection no longer exists.');
      this.connectionsProvider.refresh();
      return;
    }

    const groups = await this.connectionManager.listGroups();
    const orderedGroups = [...groups].sort((a, b) => {
      const nameCompare = String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
      return nameCompare || String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true, sensitivity: 'base' });
    });
    type MoveGroupPickItem = vscode.QuickPickItem & { action: 'none' | 'existing' | 'new'; groupId?: string };
    const currentGroupId = String(profile.groupId || '').trim();
    const noGroupItem: MoveGroupPickItem = {
      label: 'No group',
      description: currentGroupId ? 'Remove from current group' : 'Current',
      action: 'none'
    };
    const newGroupItem: MoveGroupPickItem = {
      label: '+ New group...',
      description: 'Create a connection group',
      action: 'new'
    };
    const selected = await this.showQuickPickWithActiveItem<MoveGroupPickItem>({
      title: 'Move Connection to Group',
      placeHolder: `Select a group for ${profile.name}`,
      activeItem: noGroupItem,
      items: [
        newGroupItem,
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        noGroupItem,
        ...orderedGroups.map(group => ({
          label: group.name,
          description: currentGroupId === group.id ? 'Current' : 'Connection group',
          action: 'existing' as const,
          groupId: group.id
        }))
      ]
    });

    if (!selected) {
      return;
    }

    if (selected.action === 'new') {
      const existingGroupNames = new Set(orderedGroups.map(group => group.name.trim().toLowerCase()));
      const groupName = await vscode.window.showInputBox({
        title: 'New Connection Group',
        prompt: `Enter a group name for ${profile.name}.`,
        placeHolder: 'Production',
        validateInput: value => {
          const trimmed = String(value || '').trim();

          if (!trimmed) {
            return 'Group name is required.';
          }

          if (existingGroupNames.has(trimmed.toLowerCase())) {
            return `A connection group named "${trimmed}" already exists.`;
          }

          return undefined;
        },
        ignoreFocusOut: true
      });

      if (groupName === undefined) {
        return;
      }

      let createdGroup: ConnectionGroup | undefined;

      try {
        createdGroup = await this.connectionManager.createGroup(groupName);
        await this.connectionManager.moveProfileToGroup(profile.id, createdGroup.id);
        this.connectionsProvider.refresh();
        RemoteEditSharedState.fireProfilesChanged(profile.id, 'sidebar', 'moveToGroup');
        void vscode.window.showInformationMessage(`Group "${createdGroup.name}" created and connection moved.`);
      } catch (error) {
        if (createdGroup) {
          await this.connectionManager.deleteGroup(createdGroup.id, false).catch(() => undefined);
        }

        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(message);
      }
      return;
    }

    const targetGroupId = selected.action === 'existing' ? String(selected.groupId || '').trim() : '';

    if (targetGroupId === currentGroupId || (!targetGroupId && !currentGroupId)) {
      return;
    }

    try {
      await this.connectionManager.moveProfileToGroup(profile.id, targetGroupId || undefined);
      this.connectionsProvider.refresh();
      RemoteEditSharedState.fireProfilesChanged(profile.id, 'sidebar', 'moveToGroup');

      if (targetGroupId) {
        const targetGroup = orderedGroups.find(group => group.id === targetGroupId);
        void vscode.window.showInformationMessage(`Connection moved to "${targetGroup?.name || 'group'}".`);
      } else {
        void vscode.window.showInformationMessage('Connection removed from group.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }


  private showQuickPickWithActiveItem<T extends vscode.QuickPickItem>(options: {
    title: string;
    placeHolder: string;
    items: Array<T | vscode.QuickPickItem>;
    activeItem: T;
  }): Promise<T | undefined> {
    return new Promise(resolve => {
      const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem>();
      const disposables: vscode.Disposable[] = [];
      let resolved = false;

      const finish = (item: T | undefined): void => {
        if (resolved) {
          return;
        }

        resolved = true;
        while (disposables.length > 0) {
          disposables.pop()?.dispose();
        }
        quickPick.dispose();
        resolve(item);
      };

      quickPick.title = options.title;
      quickPick.placeholder = options.placeHolder;
      quickPick.ignoreFocusOut = true;
      quickPick.items = options.items;
      quickPick.activeItems = [options.activeItem];

      disposables.push(quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0] || quickPick.activeItems[0];

        if (!selected || selected.kind === vscode.QuickPickItemKind.Separator) {
          return;
        }

        finish(selected as T);
      }));
      disposables.push(quickPick.onDidHide(() => finish(undefined)));

      quickPick.show();
    });
  }


  private async deleteConnectionGroup(item: RemoteEditSidebarItem | string | undefined): Promise<void> {
    const groupId = typeof item === 'string' ? item : item?.groupId;

    if (!groupId) {
      return;
    }

    const groups = await this.connectionManager.listGroups();
    const group = groups.find(candidate => candidate.id === groupId);

    if (!group) {
      void vscode.window.showErrorMessage('The selected connection group no longer exists.');
      this.connectionsProvider.refresh();
      return;
    }

    const profiles = await this.connectionManager.listProfiles();
    const profilesInGroup = profiles.filter(profile => profile.groupId === group.id);
    const connectionCount = profilesInGroup.length;
    const deleteConnectionsLabel = 'Delete Group and Connections';
    const removeGroupOnlyLabel = 'Remove Group Only';
    const deleteGroupLabel = 'Delete';

    const confirmed = connectionCount > 0
      ? await vscode.window.showWarningMessage(
          `Delete group "${group.name}"? This group contains ${connectionCount} saved connection${connectionCount === 1 ? '' : 's'}.`,
          { modal: true },
          removeGroupOnlyLabel,
          deleteConnectionsLabel
        )
      : await vscode.window.showWarningMessage(
          `Delete group "${group.name}"?`,
          { modal: true },
          deleteGroupLabel
        );

    if (!confirmed) {
      return;
    }

    const deleteConnections = confirmed === deleteConnectionsLabel;

    try {
      if (deleteConnections) {
        for (const profile of profilesInGroup) {
          if (this.sessions.hasConnection(profile.id)) {
            await this.sessions.disconnect(profile.id);
          }
          this.connectionDrafts.deleteDraft(profile.id);
        }
      }

      await this.connectionManager.deleteGroup(group.id, deleteConnections);
      RemoteEditSharedState.fireProfilesChanged(undefined, 'sidebar', 'profileListChanged');
      this.connectionsProvider.refresh();
      this.openConnectionsProvider.refresh();
      void vscode.window.showInformationMessage(deleteConnections ? 'Connection group and connections deleted.' : 'Connection group deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }

  private async renameSavedConnection(item: RemoteEditSidebarItem | string | undefined): Promise<void> {
    const profileId = typeof item === 'string' ? item : item?.profileId;

    if (!profileId || this.connectionDrafts.isQuickConnectId(profileId)) {
      return;
    }

    const storedProfile = await this.connectionManager.getProfile(profileId);
    const draftProfile = storedProfile ? this.connectionDrafts.mergeProfileWithDraft(storedProfile) : this.connectionDrafts.getDraftProfileById(profileId);

    if (!draftProfile) {
      void vscode.window.showErrorMessage('The selected saved connection no longer exists.');
      this.connectionsProvider.refresh();
      return;
    }

    const profiles = await this.connectionManager.listProfiles();
    const existingNames = new Set([
      ...profiles.filter(profile => profile.id !== profileId).map(profile => profile.name.trim().toLowerCase()),
      ...this.connectionDrafts.getNewDraftProfiles().filter(profile => profile.id !== profileId).map(profile => profile.name.trim().toLowerCase())
    ]);

    const name = await vscode.window.showInputBox({
      title: 'Rename Connection',
      prompt: 'Enter the new connection name.',
      value: draftProfile.name,
      validateInput: value => {
        const trimmed = String(value || '').trim();

        if (!trimmed) {
          return 'Connection name is required.';
        }

        if (existingNames.has(trimmed.toLowerCase())) {
          return `A connection named "${trimmed}" already exists.`;
        }

        return undefined;
      },
      ignoreFocusOut: true
    });

    if (name === undefined) {
      return;
    }

    try {
      if (this.connectionDrafts.isNewDraftId(profileId)) {
        this.connectionDrafts.updateDraftValue(profileId, { name: name.trim() });
      } else {
        await this.connectionManager.renameProfile(profileId, name);
        RemoteEditSharedState.fireProfilesChanged(profileId, 'sidebar', 'saveProfile');
      }

      this.connectionsProvider.refresh();
      void vscode.window.showInformationMessage('Connection renamed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }


  private async deleteSavedConnection(item: RemoteEditSidebarItem | string | undefined): Promise<void> {
    const profileId = typeof item === 'string' ? item : item?.profileId;

    if (!profileId || this.connectionDrafts.isQuickConnectId(profileId)) {
      return;
    }

    const profile = await this.connectionManager.getProfile(profileId);
    const draftProfile = profile ? this.connectionDrafts.mergeProfileWithDraft(profile) : this.connectionDrafts.getDraftProfileById(profileId);

    if (!draftProfile) {
      void vscode.window.showErrorMessage('The selected saved connection no longer exists.');
      this.connectionsProvider.refresh();
      return;
    }

    const message = profile
      ? `Delete connection "${draftProfile.name}"? Stored secrets for this profile will also be removed.`
      : `Discard new connection "${draftProfile.name}"?`;
    const confirmed = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      profile ? 'Delete' : 'Discard'
    );

    if (confirmed !== (profile ? 'Delete' : 'Discard')) {
      return;
    }

    try {
      if (profile && this.sessions.hasConnection(profileId)) {
        await this.sessions.disconnect(profileId);
      }

      this.connectionDrafts.deleteDraft(profileId);

      if (profile) {
        await this.connectionManager.deleteProfile(profileId);
        RemoteEditSharedState.fireProfilesChanged(undefined, 'sidebar', 'profileListChanged');
      }

      this.connectionsProvider.refresh();
      this.openConnectionsProvider.refresh();
      void vscode.window.showInformationMessage(profile ? 'Connection deleted.' : 'New connection discarded.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }


  private async saveConnectionChanges(item: RemoteEditSidebarItem | string | undefined): Promise<ConnectionProfile | undefined> {
    const profileId = typeof item === 'string' ? item : item?.profileId;

    if (!profileId || this.connectionDrafts.isQuickConnectId(profileId)) {
      return undefined;
    }

    if (this.sessions.hasConnection(profileId)) {
      void vscode.window.showInformationMessage('Disconnect to save connection changes.');
      this.connectionsProvider.refresh();
      return await this.connectionManager.getProfile(profileId);
    }

    const draft = this.connectionDrafts.getDraft(profileId);

    if (!draft) {
      void vscode.window.showInformationMessage('No pending changes to save.');
      return await this.connectionManager.getProfile(profileId);
    }

    try {
      const savedProfile = await this.connectionManager.saveProfile({
        ...draft,
        id: this.connectionDrafts.isNewDraftId(profileId) ? undefined : profileId
      });
      this.connectionDrafts.deleteDraft(profileId);
      this.connectionsProvider.refresh();
      RemoteEditSharedState.fireProfilesChanged(savedProfile.id, 'sidebar', 'saveProfile');
      void vscode.window.showInformationMessage(this.connectionDrafts.isNewDraftId(profileId) ? 'Connection saved.' : 'Connection changes saved.');
      return savedProfile;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
      return undefined;
    }
  }


  private discardConnectionChanges(item: RemoteEditSidebarItem | string | undefined): void {
    const profileId = typeof item === 'string' ? item : item?.profileId;

    if (!profileId || this.connectionDrafts.isQuickConnectId(profileId)) {
      return;
    }

    this.connectionDrafts.deleteDraft(profileId);
    this.connectionsProvider.refresh();
    void vscode.window.showInformationMessage('Connection changes discarded.');
  }

  private clearQuickConnect(): void {
    this.connectionDrafts.resetQuickConnect();
    this.connectionsProvider.refresh();
  }

  private async connectQuickConnect(): Promise<void> {
    const profile = this.connectionDrafts.buildQuickConnectProfile();

    if (!profile.host) {
      void vscode.window.showWarningMessage('Hostname is required for Quick Connect.');
      return;
    }

    if (!profile.username) {
      void vscode.window.showWarningMessage('Username is required for Quick Connect.');
      return;
    }

    const payload = {
      ...this.connectionDrafts.getQuickConnectDraft(),
      id: undefined,
      name: profile.host,
      host: profile.host,
      port: profile.port,
      connectionType: profile.connectionType,
      username: profile.username,
      authType: profile.authType,
      startPath: profile.startPath,
      privateKeyPath: profile.privateKeyPath,
      keepAlive: profile.keepAlive,
      ftpsAllowSelfSignedCertificate: profile.ftpsAllowSelfSignedCertificate,
      ftpsCaCertificatePath: profile.ftpsCaCertificatePath
    };

    await this.connectWithPayload(payload);
  }

  private async openSavedConnection(item: RemoteEditSidebarItem | string | undefined): Promise<void> {
    const profileId = typeof item === 'string' ? item : item?.profileId;

    if (!profileId) {
      this.openRemoteEdit();
      return;
    }

    if (!this.connectionDrafts.hasDraft(profileId)) {
      await this.connectSavedConnection(profileId);
      return;
    }

    const isNewDraft = this.connectionDrafts.isNewDraftId(profileId);
    const choices = isNewDraft
      ? [
          { label: 'Save and Connect', action: 'saveAndConnect' },
          { label: 'Cancel', action: 'cancel' }
        ]
      : [
          { label: 'Save and Connect', action: 'saveAndConnect' },
          { label: 'Connect Without Saving', action: 'connectWithoutSaving' },
          { label: 'Cancel', action: 'cancel' }
        ];

    const choice = await vscode.window.showQuickPick(choices, {
      title: isNewDraft ? 'New connection' : 'Pending connection changes',
      placeHolder: isNewDraft ? 'Save this new connection before connecting.' : 'This connection has unsaved sidebar changes.'
    });

    if (!choice || choice.action === 'cancel') {
      return;
    }

    if (choice.action === 'saveAndConnect') {
      const savedProfile = await this.saveConnectionChanges(profileId);

      if (!savedProfile) {
        return;
      }

      await this.connectSavedConnection(savedProfile.id);
      return;
    }

    await this.connectSavedConnection(profileId, this.connectionDrafts.getDraftProfileById(profileId));
  }

  private async connectSavedConnection(profileId: string, draftProfile?: ConnectionProfile): Promise<void> {
    const payload = draftProfile ? { ...draftProfile, id: profileId } : { id: profileId };
    await this.connectWithPayload(payload);
  }

  private async connectWithPayload(payload: ConnectionProfileInput): Promise<void> {
    let options;

    try {
      options = await this.connectionManager.buildConnectOptions(payload || {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
      return;
    }

    const target = `${options.username}@${options.host}:${options.port}`;
    const connectingProfileId = payload.id || QUICK_CONNECT_ID;
    const cancellationSource = new vscode.CancellationTokenSource();

    this.setConnectionActivity(connectingProfileId, true);

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Connecting to ${options.name || options.host}...`,
          cancellable: true
        },
        async (_progress, token) => {
          const cancelDisposable = token.onCancellationRequested(() => cancellationSource.cancel());

          try {
            this.output.appendLine(`[Sidebar] Connecting to ${target} (${String(options.connectionType || 'sftp').toUpperCase()})...`);
            const connection = await this.sessions.connect(options, cancellationSource.token);
            const startPath = normalizeRemotePath(connection.startPath || options.startPath || '/');
            RemoteEditSharedState.setActiveConnection(connection.id);
            RemoteEditSharedState.setNavigation(connection.id, startPath, startPath, 'sidebar');
            RemoteEditPanel.syncConnectionIfOpen(connection.id);
            this.output.appendLine(`[Sidebar] Connected to ${connection.name || connection.host}.`);
          } finally {
            cancelDisposable.dispose();
          }
        }
      );

      this.connectionsProvider.refresh();
      await this.refreshOpenConnectionsAndRevealStartPaths();
      void vscode.window.showInformationMessage(`Connected to ${options.name || options.host}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (cancellationSource.token.isCancellationRequested || message.includes('Connection cancelled') || message.includes('Connection canceled')) {
        this.output.appendLine(`[Sidebar] Connection canceled for ${target}.`);
        void vscode.window.showInformationMessage('Connection canceled.');
        return;
      }

      this.output.appendLine(`[Sidebar] Connection failed for ${target}: ${message}`);
      void vscode.window.showErrorMessage(`Connection failed: ${message}`);
    } finally {
      this.setConnectionActivity(connectingProfileId, false);
      cancellationSource.dispose();
    }
  }

  private setConnectionActivity(profileId: string, isConnecting: boolean): void {
    if (isConnecting) {
      this.connectingProfileIds.add(profileId);
    } else {
      this.connectingProfileIds.delete(profileId);
    }

    this.connectionsProvider.refresh();
  }


  private async copyConnectionDetailValue(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionDetailValue) {
      return;
    }

    await vscode.env.clipboard.writeText(item.connectionDetailValue);
    void vscode.window.showInformationMessage('Copied connection detail.');
  }

  private getProfileFieldValue(profile: { host: string; port: number; username: string; startPath: string; privateKeyPath?: string; ftpsCaCertificatePath?: string }, field: ConnectionDetailField): string {
    switch (field) {
      case 'host':
        return profile.host || '';
      case 'port':
        return String(profile.port || '');
      case 'username':
        return profile.username || '';
      case 'startPath':
        return profile.startPath || '';
      case 'privateKeyPath':
        return profile.privateKeyPath || '';
      case 'ftpsCaCertificatePath':
        return profile.ftpsCaCertificatePath || '';
      default:
        return '';
    }
  }

  private getConnectionDetailLabel(field: ConnectionDetailField): string {
    switch (field) {
      case 'host':
        return 'Hostname';
      case 'port':
        return 'Port';
      case 'username':
        return 'Username';
      case 'startPath':
        return 'Start Path';
      case 'privateKeyPath':
        return 'Private Key Path';
      case 'ftpsCaCertificatePath':
        return 'CA Certificate Path';
      default:
        return 'Connection Field';
    }
  }

  private validateConnectionDetailInput(field: ConnectionDetailField, value: string): string | undefined {
    if (field === 'host' && !String(value || '').trim()) {
      return 'Hostname is required.';
    }

    if (field === 'port') {
      const port = Number(value);

      if (!Number.isFinite(port) || port <= 0 || port > 65535 || !Number.isInteger(port)) {
        return 'Port must be a number between 1 and 65535.';
      }
    }

    if (field === 'privateKeyPath' && !String(value || '').trim()) {
      return 'Private key path is required for private key authentication.';
    }

    if (field === 'ftpsCaCertificatePath' && !String(value || '').trim()) {
      return 'CA certificate path is required for FTPS unless self-signed/untrusted certificates are allowed.';
    }

    return undefined;
  }

  private async saveConnectionDetailValue(profileId: string, field: ConnectionDetailField, value: string): Promise<void> {
    switch (field) {
      case 'host':
        await this.connectionManager.saveProfile({ id: profileId, host: value });
        break;
      case 'port':
        await this.connectionManager.saveProfile({ id: profileId, port: value });
        break;
      case 'username':
        await this.connectionManager.saveProfile({ id: profileId, username: value });
        break;
      case 'startPath':
        await this.connectionManager.saveProfile({ id: profileId, startPath: value });
        break;
      case 'privateKeyPath':
        await this.connectionManager.saveProfile({ id: profileId, privateKeyPath: value });
        break;
      case 'ftpsCaCertificatePath':
        await this.connectionManager.saveProfile({ id: profileId, ftpsCaCertificatePath: value });
        break;
      default:
        break;
    }
  }

  private openTransferQueue(): void {
    RemoteEditPanel.openTransferQueue(this.context, this.sessions, this.connectionManager, this.output);
    this.transfersProvider.refresh();
  }

  private cancelTransfer(item: RemoteEditSidebarItem | undefined): void {
    if (!item?.transferId) {
      return;
    }

    if (item.transferStatus === 'Waiting') {
      RemoteEditPanel.removeQueuedTransfer(item.transferId);
    } else {
      RemoteEditPanel.cancelTransfer(item.transferId);
    }

    this.transfersProvider.refresh();
  }


  private async copyConnectionDetails(item: RemoteEditSidebarItem | undefined): Promise<void> {
    const details = String(item?.connectionDetails || '').trim();

    if (!details) {
      return;
    }

    await vscode.env.clipboard.writeText(details);
    void vscode.window.showInformationMessage('Copied connection details.');
  }

  private async copyTransferDetails(item: RemoteEditSidebarItem | undefined): Promise<void> {
    const details = String(item?.transferDetails || '').trim();

    if (!details) {
      return;
    }

    await vscode.env.clipboard.writeText(details);
    void vscode.window.showInformationMessage('Copied transfer details.');
  }

  private clearCompletedTransfers(): void {
    RemoteEditPanel.clearCompletedTransfers();
    this.transfersProvider.refresh();
  }

  private resolveConnectionId(item: RemoteEditSidebarItem | string | undefined): string | undefined {
    return typeof item === 'string' ? item : item?.connectionId || item?.profileId;
  }
}
