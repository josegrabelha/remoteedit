import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AuthType, ConnectionBackupExportOptions, ConnectionBackupImportOptions, ConnectionManager, ConnectionProfile, ConnectionProfileInput, RemoteEditBackupFile, RemoteEditBackupImportResult, RemoteEditBackupSummary } from '../connection/ConnectionManager';
import { buildRemoteEditUri } from '../filesystem/RemoteEditFileSystemProvider';
import { RemoteEditPanel } from '../panel/RemoteEditPanel';
import { getDefaultPortForConnectionType, normalizeConnectionType, type RemoteConnectionType } from '../remote/RemoteConnectionTypes';
import type { RemoteArchiveFormat, RemoteEntry, RemoteEntryType, RemoteSessionManager } from '../remote/RemoteSessionManager';
import { SshTerminalService } from '../ssh/SshTerminalService';
import { RemoteEditSharedState } from '../state/RemoteEditSharedState';
import {
  ConnectionsTreeProvider,
  RemoteEditActionsTreeProvider,
  OpenConnectionsTreeProvider,
  TransfersTreeProvider
} from './SidebarTreeProviders';
import { getParentRemotePath, normalizeRemotePath, type ConnectionDetailField, RemoteEditSidebarItem } from './SidebarItems';

interface ConnectionChangeNotifier {
  onDidChangeConnections?: vscode.Event<void>;
}

const QUICK_CONNECT_ID = '__remoteeditQuickConnect';

type SidebarConnectionDraft = ConnectionProfileInput & {
  password?: string;
  passphrase?: string;
};

export class RemoteEditSidebarController implements vscode.Disposable {
  private readonly actionsProvider = new RemoteEditActionsTreeProvider();
  private readonly connectionsProvider: ConnectionsTreeProvider;
  private readonly openConnectionsProvider: OpenConnectionsTreeProvider;
  private readonly connectionsTreeView: vscode.TreeView<RemoteEditSidebarItem>;
  private readonly openConnectionsTreeView: vscode.TreeView<RemoteEditSidebarItem>;
  private readonly transfersProvider = new TransfersTreeProvider();
  private readonly sudoModeDecorationProvider: SudoModeDecorationProvider;
  private readonly sshTerminalService: SshTerminalService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly draftConnections = new Map<string, SidebarConnectionDraft>();
  private readonly connectingProfileIds = new Set<string>();
  private openConnectionsNavigationSequence = 0;
  private openConnectionsRevealChain: Promise<void> = Promise.resolve();
  private quickConnectDraft: SidebarConnectionDraft = this.createDefaultQuickConnectDraft();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessions: RemoteSessionManager,
    private readonly connectionManager: ConnectionManager,
    private readonly output: vscode.OutputChannel
  ) {
    this.connectionsProvider = new ConnectionsTreeProvider(connectionManager, {
      getQuickConnectProfile: () => this.buildQuickConnectProfile(),
      getDraftProfile: profile => this.mergeProfileWithDraft(profile),
      getNewDraftProfiles: () => this.getNewDraftProfiles(),
      getDraftProfileById: profileId => this.getDraftProfileById(profileId),
      hasDraft: profileId => this.draftConnections.has(profileId),
      isConnected: profileId => this.sessions.hasConnection(profileId),
      isConnecting: profileId => this.connectingProfileIds.has(profileId)
    });
    this.openConnectionsProvider = new OpenConnectionsTreeProvider(sessions, connectionManager, output);
    this.sudoModeDecorationProvider = new SudoModeDecorationProvider(sessions);
    this.sshTerminalService = new SshTerminalService(sessions);
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
        this.connectionsProvider.refresh();
        this.refreshSudoModeVisualState();

        if (this.shouldRevealOpenConnectionsView()) {
          void this.revealStartPaths();
        }
      }));
    }

    this.disposables.push(this.connectionsTreeView.onDidChangeSelection(event => this.expandSelectedConnection(event.selection[0])));
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

      this.draftConnections.clear();
      this.connectionsProvider.refresh();
      this.openConnectionsProvider.refresh();
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
      vscode.commands.registerCommand('remoteedit.sidebar.refreshConnections', () => this.connectionsProvider.refresh()),
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
      vscode.commands.registerCommand('remoteedit.sidebar.deleteSavedConnection', item => this.deleteSavedConnection(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.connectQuickConnect', () => this.connectQuickConnect()),
      vscode.commands.registerCommand('remoteedit.sidebar.clearQuickConnect', () => this.clearQuickConnect()),
      vscode.commands.registerCommand('remoteedit.sidebar.saveConnectionChanges', item => this.saveConnectionChanges(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.discardConnectionChanges', item => this.discardConnectionChanges(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.openConnection', item => this.openConnection(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.disconnectConnection', item => this.disconnectConnection(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.enableSudoMode', item => this.enableSudoMode(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.disableSudoMode', item => this.disableSudoMode(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.openSshTerminal', item => this.openSshTerminal(item)),
      vscode.commands.registerCommand('remoteedit.primary.openDirectoryAsRootDirectory', (itemOrConnectionId, maybePath) => this.openDirectoryAsRootDirectory(itemOrConnectionId, maybePath)),
      vscode.commands.registerCommand('remoteedit.sidebar.openFavoritePath', (itemOrConnectionId, maybePath) => this.openFavoritePath(itemOrConnectionId, maybePath)),
      vscode.commands.registerCommand('remoteedit.sidebar.goParentFolder', (itemOrConnectionId, maybePath) => this.goParentFolder(itemOrConnectionId, maybePath)),
      vscode.commands.registerCommand('remoteedit.sidebar.openRemoteDirectory', item => this.openRemoteDirectory(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.openRemoteFile', (itemOrConnectionId, maybePath) => this.openRemoteFile(itemOrConnectionId, maybePath)),
      vscode.commands.registerCommand('remoteedit.sidebar.openRemoteFileReadOnly', item => this.openRemoteFileReadOnly(item)),
      vscode.commands.registerCommand('remoteedit.sidebar.createRemoteFile', item => this.createRemoteEntry(item, 'file')),
      vscode.commands.registerCommand('remoteedit.sidebar.createRemoteDirectory', item => this.createRemoteEntry(item, 'directory')),
      vscode.commands.registerCommand('remoteedit.sidebar.renameRemoteEntry', item => this.renameRemoteEntry(item)),
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
    try {
      const options = await this.pickBackupExportOptions();

      if (!options) {
        return;
      }

      if (!options.includeSettings && !options.includeConnections) {
        void vscode.window.showWarningMessage('Remote Edit: Select at least one export option.');
        return;
      }

      const target = await vscode.window.showSaveDialog({
        filters: { 'JSON backup': ['json'], 'All files': ['*'] },
        saveLabel: 'Export',
        title: 'Export Remote Edit backup',
        defaultUri: vscode.Uri.file(path.join(os.homedir(), `remoteedit-backup-${this.formatBackupFileDate(new Date())}.json`))
      });

      if (!target) {
        return;
      }

      const backup = await this.connectionManager.buildBackupFile({
        ...options,
        extensionVersion: String((this.context.extension.packageJSON as { version?: string })?.version || '')
      });

      await fs.writeFile(target.fsPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
      this.output.appendLine(`[Sidebar] Exported Remote Edit backup: ${target.fsPath}`);
      void vscode.window.showInformationMessage('Remote Edit: Export completed successfully.');
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private async importBackup(): Promise<void> {
    try {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'JSON backup': ['json'], 'All files': ['*'] },
        openLabel: 'Import',
        title: 'Import Remote Edit backup'
      });

      const selectedPath = selected?.[0]?.fsPath;
      if (!selectedPath) {
        return;
      }

      let backup: RemoteEditBackupFile;
      try {
        const raw = await fs.readFile(selectedPath, 'utf8');
        backup = JSON.parse(raw) as RemoteEditBackupFile;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`[Sidebar] Could not read Remote Edit backup: ${message}`);
        void vscode.window.showErrorMessage('Remote Edit: Import failed. Invalid backup file.');
        return;
      }

      const summary = this.connectionManager.summarizeBackupFile(backup);
      const shouldContinue = await vscode.window.showInformationMessage(
        'Remote Edit backup summary',
        { modal: true, detail: this.buildImportSummaryDetails(summary) },
        'Continue'
      );

      if (shouldContinue !== 'Continue') {
        return;
      }

      const options = await this.pickBackupImportOptions(summary);

      if (!options) {
        return;
      }

      if (!options.includeSettings && !options.includeConnections) {
        void vscode.window.showWarningMessage('Remote Edit: Select at least one import option.');
        return;
      }

      const result = await this.connectionManager.importBackupFile(backup, options);
      this.draftConnections.clear();
      this.quickConnectDraft = this.createDefaultQuickConnectDraft();
      this.connectionsProvider.refresh();
      this.openConnectionsProvider.refresh();
      RemoteEditSharedState.fireProfilesChanged(undefined, 'sidebar');
      this.output.appendLine(`[Sidebar] Imported Remote Edit backup: ${selectedPath}`);
      void vscode.window.showInformationMessage(this.buildImportResultMessage(result));
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private async pickBackupExportOptions(): Promise<ConnectionBackupExportOptions | undefined> {
    const items: Array<vscode.QuickPickItem & { option: 'settings' | 'connections' | 'favorites' | 'usernames' | 'credentials' }> = [
      { label: 'Remote Edit settings', description: 'Export extension settings', option: 'settings', picked: true },
      { label: 'Saved connections', description: 'Export saved connection profiles', option: 'connections', picked: true },
      { label: 'Remote path favorites', description: 'Export favorites stored with saved connections', option: 'favorites', picked: true },
      { label: 'Include usernames', description: 'Include saved usernames in exported connections', option: 'usernames', picked: true },
      { label: 'Include encrypted saved passwords/passphrases', description: 'Requires an export password', option: 'credentials' }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Export Remote Edit backup',
      placeHolder: 'Select what to export',
      canPickMany: true,
      ignoreFocusOut: true
    });

    if (!selected) {
      return undefined;
    }

    const selectedOptions = new Set(selected.map(item => item.option));
    const includeConnections = selectedOptions.has('connections');
    const includeUsernames = includeConnections && selectedOptions.has('usernames');
    const includeCredentials = includeConnections && includeUsernames && selectedOptions.has('credentials');
    let credentialPassword = '';

    if (includeCredentials) {
      credentialPassword = await this.promptBackupPassword('Export Remote Edit backup', 'Enter a password to encrypt saved passwords/passphrases in the backup.', true) || '';

      if (!credentialPassword) {
        return undefined;
      }
    }

    return {
      includeSettings: selectedOptions.has('settings'),
      includeConnections,
      includeFavorites: includeConnections && selectedOptions.has('favorites'),
      includeUsernames,
      includeCredentials,
      credentialPassword
    };
  }

  private async pickBackupImportOptions(summary: RemoteEditBackupSummary): Promise<ConnectionBackupImportOptions | undefined> {
    const items: Array<vscode.QuickPickItem & { option: 'settings' | 'connections' | 'favorites' | 'usernames' | 'credentials' }> = [
      { label: 'Remote Edit settings', description: summary.hasSettings ? 'Import extension settings' : 'Not available in this backup', option: 'settings', picked: summary.hasSettings },
      { label: 'Saved connections', description: `${summary.supportedConnectionCount} supported connection(s)`, option: 'connections', picked: summary.supportedConnectionCount > 0 },
      { label: 'Remote path favorites', description: `${summary.remotePathFavoriteCount} favorite path(s)`, option: 'favorites', picked: summary.remotePathFavoriteCount > 0 },
      { label: 'Include usernames', description: summary.usernamesIncluded ? 'Restore usernames from backup' : 'No usernames found in this backup', option: 'usernames', picked: summary.usernamesIncluded },
      { label: 'Restore encrypted saved passwords/passphrases', description: summary.hasEncryptedCredentials ? 'Requires the export password' : 'No encrypted credentials found', option: 'credentials' }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Import Remote Edit backup',
      placeHolder: 'Select what to import',
      canPickMany: true,
      ignoreFocusOut: true
    });

    if (!selected) {
      return undefined;
    }

    const selectedOptions = new Set(selected.map(item => item.option));
    const includeConnections = selectedOptions.has('connections') && summary.supportedConnectionCount > 0;
    const includeUsernames = includeConnections && selectedOptions.has('usernames');
    const restoreCredentials = includeConnections && includeUsernames && summary.hasEncryptedCredentials && selectedOptions.has('credentials');
    let credentialPassword = '';

    const mode = includeConnections
      ? await vscode.window.showQuickPick([
        { label: 'Merge', description: 'Add new connections and update matching IDs', value: 'merge' as const },
        { label: 'Replace', description: 'Replace all saved connections with the backup connections', value: 'replace' as const }
      ], {
        title: 'Import Mode',
        placeHolder: 'Choose how saved connections should be imported',
        ignoreFocusOut: true
      })
      : { value: 'merge' as const };

    if (!mode) {
      return undefined;
    }

    if (restoreCredentials) {
      credentialPassword = await this.promptBackupPassword('Import Remote Edit backup', 'Enter the export password to restore encrypted saved passwords/passphrases.', false) || '';

      if (!credentialPassword) {
        return undefined;
      }
    }

    return {
      includeSettings: selectedOptions.has('settings') && summary.hasSettings,
      includeConnections,
      includeFavorites: includeConnections && selectedOptions.has('favorites'),
      includeUsernames,
      restoreCredentials,
      credentialPassword,
      importMode: mode.value
    };
  }

  private async promptBackupPassword(title: string, prompt: string, confirm: boolean): Promise<string | undefined> {
    const password = await vscode.window.showInputBox({
      title,
      prompt,
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Backup password'
    });

    if (!password) {
      return undefined;
    }

    if (!confirm) {
      return password;
    }

    const confirmation = await vscode.window.showInputBox({
      title,
      prompt: 'Confirm the backup password.',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Confirm backup password'
    });

    if (confirmation === undefined) {
      return undefined;
    }

    if (password !== confirmation) {
      void vscode.window.showErrorMessage('Remote Edit: Backup passwords do not match.');
      return undefined;
    }

    return password;
  }

  private buildImportSummaryDetails(summary: RemoteEditBackupSummary): string {
    const lines = [
      `Settings: ${summary.hasSettings ? 'Yes' : 'No'}`,
      `Connections: ${summary.supportedConnectionCount}${summary.unsupportedConnectionCount ? ` supported, ${summary.unsupportedConnectionCount} unsupported` : ''}`,
      `Remote path favorites: ${summary.remotePathFavoriteCount}`,
      `Usernames: ${summary.usernamesIncluded ? 'Yes' : 'No'}`,
      `Encrypted credentials: ${summary.hasEncryptedCredentials ? 'Yes' : 'No'}`
    ];

    return lines.join('\n');
  }

  private buildImportResultMessage(result: RemoteEditBackupImportResult): string {
    const parts = ['Remote Edit: Import completed successfully.'];

    if (result.settingsImported) {
      parts.push('Settings imported.');
    }

    if (result.added || result.updated || result.replaced) {
      parts.push(`Connections added: ${result.added}.`);
      parts.push(`Connections updated: ${result.updated}.`);
    }

    if (result.favoritesImported) {
      parts.push(`Favorites imported: ${result.favoritesImported}.`);
    }

    if (result.credentialsRestored) {
      parts.push(`Credentials restored: ${result.credentialsRestored}.`);
    }

    if (result.skippedUnsupported) {
      parts.push(`Unsupported connections skipped: ${result.skippedUnsupported}.`);
    }

    return parts.join(' ');
  }

  private formatBackupFileDate(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');

    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join('') + '-' + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds())
    ].join('');
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
    await vscode.commands.executeCommand(
      'setContext',
      'remoteedit.connectionsFilterActive',
      Boolean(this.connectionsProvider.getFilterText())
    );
  }


  dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }

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


  private createDefaultQuickConnectDraft(): SidebarConnectionDraft {
    return {
      id: QUICK_CONNECT_ID,
      name: 'Quick Connect',
      connectionType: 'sftp',
      port: getDefaultPortForConnectionType('sftp'),
      authType: 'password',
      startPath: '/',
      keepAlive: true
    };
  }

  private buildQuickConnectProfile(): ConnectionProfile {
    const draft = this.normalizeDraftForType(this.quickConnectDraft);
    const connectionType = normalizeConnectionType(draft.connectionType || 'sftp');
    const authType = this.normalizeAuthTypeForDraft(draft.authType, connectionType);
    const now = Date.now();

    return {
      id: QUICK_CONNECT_ID,
      name: 'Quick Connect',
      host: String(draft.host || '').trim(),
      port: Number(draft.port || getDefaultPortForConnectionType(connectionType)),
      connectionType,
      username: String(draft.username || '').trim(),
      authType,
      startPath: String(draft.startPath || '/').trim(),
      privateKeyPath: authType === 'privateKey' ? String(draft.privateKeyPath || '').trim() : undefined,
      keepAlive: draft.keepAlive !== false,
      ftpsAllowSelfSignedCertificate: connectionType === 'ftps' ? Boolean(draft.ftpsAllowSelfSignedCertificate) : false,
      ftpsCaCertificatePath: connectionType === 'ftps' ? String(draft.ftpsCaCertificatePath || '').trim() : '',
      hasSavedPassword: authType === 'password' && Boolean(draft.password),
      hasSavedPassphrase: authType === 'privateKey' && Boolean(draft.passphrase),
      favoriteRemotePaths: [],
      createdAt: now,
      updatedAt: now
    };
  }

  private mergeProfileWithDraft(profile: ConnectionProfile): ConnectionProfile {
    const draft = this.draftConnections.get(profile.id);

    if (!draft) {
      return profile;
    }

    const mergedInput = this.normalizeDraftForType({ ...profile, ...draft });
    const connectionType = normalizeConnectionType(mergedInput.connectionType || profile.connectionType || 'sftp');
    const authType = this.normalizeAuthTypeForDraft(mergedInput.authType || profile.authType, connectionType);

    return {
      ...profile,
      host: String(mergedInput.host ?? profile.host ?? '').trim(),
      port: Number(mergedInput.port ?? profile.port ?? getDefaultPortForConnectionType(connectionType)),
      connectionType,
      username: String(mergedInput.username ?? profile.username ?? '').trim(),
      authType,
      startPath: String(mergedInput.startPath ?? profile.startPath ?? '').trim(),
      privateKeyPath: authType === 'privateKey' ? String(mergedInput.privateKeyPath ?? profile.privateKeyPath ?? '').trim() : undefined,
      keepAlive: typeof mergedInput.keepAlive === 'boolean' ? mergedInput.keepAlive : profile.keepAlive !== false,
      ftpsAllowSelfSignedCertificate: connectionType === 'ftps' ? Boolean(mergedInput.ftpsAllowSelfSignedCertificate ?? profile.ftpsAllowSelfSignedCertificate ?? false) : false,
      ftpsCaCertificatePath: connectionType === 'ftps' ? String(mergedInput.ftpsCaCertificatePath ?? profile.ftpsCaCertificatePath ?? '').trim() : '',
      hasSavedPassword: authType === 'password' ? (typeof draft.password === 'string' ? Boolean(draft.password) : draft.rememberPassword === false ? false : profile.hasSavedPassword) : false,
      hasSavedPassphrase: authType === 'privateKey' ? (typeof draft.passphrase === 'string' ? Boolean(draft.passphrase) : draft.rememberPassphrase === false ? false : profile.hasSavedPassphrase) : false
    };
  }

  private getNewDraftProfiles(): ConnectionProfile[] {
    return Array.from(this.draftConnections.entries())
      .filter(([profileId]) => this.isNewDraftId(profileId))
      .map(([, draft]) => this.buildDraftProfile(draft));
  }

  private getDraftProfileById(profileId: string): ConnectionProfile | undefined {
    const draft = this.draftConnections.get(profileId);
    return draft ? this.buildDraftProfile(draft) : undefined;
  }

  private buildDraftProfile(draftInput: SidebarConnectionDraft): ConnectionProfile {
    const draft = this.normalizeDraftForType(draftInput);
    const connectionType = normalizeConnectionType(draft.connectionType || 'sftp');
    const authType = this.normalizeAuthTypeForDraft(draft.authType, connectionType);
    const now = Date.now();

    return {
      id: String(draft.id || this.buildNewDraftId()),
      name: String(draft.name || 'New Connection').trim(),
      host: String(draft.host || '').trim(),
      port: Number(draft.port || getDefaultPortForConnectionType(connectionType)),
      connectionType,
      username: String(draft.username || '').trim(),
      authType,
      startPath: String(draft.startPath || '/').trim(),
      privateKeyPath: authType === 'privateKey' ? String(draft.privateKeyPath || '').trim() : undefined,
      keepAlive: draft.keepAlive !== false,
      ftpsAllowSelfSignedCertificate: connectionType === 'ftps' ? Boolean(draft.ftpsAllowSelfSignedCertificate) : false,
      ftpsCaCertificatePath: connectionType === 'ftps' ? String(draft.ftpsCaCertificatePath || '').trim() : '',
      hasSavedPassword: authType === 'password' && Boolean(draft.password),
      hasSavedPassphrase: authType === 'privateKey' && Boolean(draft.passphrase),
      favoriteRemotePaths: [],
      createdAt: now,
      updatedAt: now
    };
  }

  private buildNewDraftId(): string {
    return `__remoteeditNewConnection:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  }

  private isNewDraftId(profileId: string | undefined): boolean {
    return Boolean(profileId && profileId.startsWith('__remoteeditNewConnection:'));
  }


  private normalizeDraftForType(draft: SidebarConnectionDraft): SidebarConnectionDraft {
    const connectionType = normalizeConnectionType(draft.connectionType || 'sftp');
    const authType = this.normalizeAuthTypeForDraft(draft.authType, connectionType);

    return {
      ...draft,
      connectionType,
      authType,
      privateKeyPath: authType === 'privateKey' ? draft.privateKeyPath : undefined,
      ftpsAllowSelfSignedCertificate: connectionType === 'ftps' ? Boolean(draft.ftpsAllowSelfSignedCertificate) : false,
      ftpsCaCertificatePath: connectionType === 'ftps' ? draft.ftpsCaCertificatePath : undefined
    };
  }

  private normalizeAuthTypeForDraft(authType: AuthType | undefined, connectionType: RemoteConnectionType): AuthType {
    return connectionType === 'sftp' && authType === 'privateKey' ? 'privateKey' : 'password';
  }

  private isQuickConnectId(profileId: string | undefined): boolean {
    return profileId === QUICK_CONNECT_ID;
  }

  private revealQuickConnect(): void {
    const item = RemoteEditSidebarItem.quickConnect(this.buildQuickConnectProfile());
    void this.connectionsTreeView.reveal(item, { expand: true, focus: true, select: true });
  }

  private async addConnection(): Promise<void> {
    const profiles = await this.connectionManager.listProfiles();
    const existingNames = new Set([
      ...profiles.map(profile => profile.name.trim().toLowerCase()),
      ...this.getNewDraftProfiles().map(profile => profile.name.trim().toLowerCase())
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

    const profileId = this.buildNewDraftId();
    this.draftConnections.set(profileId, this.normalizeDraftForType({
      id: profileId,
      name: name.trim(),
      connectionType: 'sftp',
      port: getDefaultPortForConnectionType('sftp'),
      authType: 'password',
      startPath: '/',
      keepAlive: true
    }));

    this.connectionsProvider.refresh();

    const item = RemoteEditSidebarItem.fromConnectionProfile(this.buildDraftProfile(this.draftConnections.get(profileId)!), {
      draft: true,
      connected: false
    });
    void this.connectionsTreeView.reveal(item, { expand: true, focus: true, select: true });
  }

  private openRemoteEdit(): void {
    RemoteEditPanel.open(this.context, this.sessions, this.connectionManager, this.output);
    this.connectionsProvider.refresh();
    this.refreshOpenConnectionsAndRevealStartPaths();
  }

  private refreshOpenConnections(): void {
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
      const properties = this.buildRemoteEntryProperties(item, connection, stats);
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

  private buildRemoteEntryProperties(
    item: RemoteEditSidebarItem,
    connection: ReturnType<RemoteSessionManager['getConnection']>,
    stats?: { type: 'file' | 'directory' | 'unknown'; size: number; modifyTime: number; accessTime: number }
  ): { title: string; rows: Array<[string, string]> } {
    const entry = item.remoteEntry;
    const entryType = this.getEffectiveEntryType(entry, stats?.type);
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
    const name = entry?.name || this.getRemoteItemName(item) || '—';
    const remotePath = entry?.path || item.remotePath || '—';

    const rows: Array<[string, string]> = [
      ['Name', name],
      [pathLabel, remotePath],
      ['Type', this.formatPropertyType(entry, entryType)]
    ];

    if (!isDirectory) {
      rows.push(['Size', this.formatPropertySize(entry?.size ?? stats?.size)]);
    }

    rows.push(
      ['Modified', this.formatPropertyDate(entry?.modifyTime ?? stats?.modifyTime) || '—'],
      ['Permissions', this.formatPermissionsValue(entry?.permissions)],
      ['Owner', this.formatMetadata(entry?.owner) || '—'],
      ['Group', this.formatMetadata(entry?.group) || '—']
    );

    if (isLink && entry?.linkTarget) {
      rows.push(['Symlink target', entry.linkTarget]);
    }

    if (isLink && entry?.effectiveType) {
      rows.push(['Resolved type', this.capitalizeText(entry.effectiveType)]);
    }

    rows.push(
      ['Connection', connection ? connection.name : '—'],
      ['Host', connection ? this.formatSessionTarget(connection) : '—']
    );

    return { title, rows };
  }

  private getEffectiveEntryType(entry: RemoteEntry | undefined, statType?: 'file' | 'directory' | 'unknown'): RemoteEntryType {
    if (entry?.effectiveType) {
      return entry.effectiveType;
    }

    if (entry?.type) {
      return entry.type;
    }

    return statType || 'unknown';
  }

  private formatPropertyType(entry: RemoteEntry | undefined, entryType: RemoteEntryType): string {
    if (entry?.type === 'link') {
      const resolvedType = entry.effectiveType ? ` (${this.capitalizeText(entry.effectiveType)})` : '';
      return `Symbolic link${resolvedType}`;
    }

    return this.capitalizeText(entry?.type || entryType || 'unknown');
  }

  private formatPermissionsValue(permissions: unknown): string {
    const text = String(permissions || '').trim();

    if (!text) {
      return '—';
    }

    const mode = this.permissionModeFromSymbolic(text);
    return mode ? `${text} (${mode})` : text;
  }

  private permissionModeFromSymbolic(permissions: string): string {
    const text = String(permissions || '').trim();

    if (text.length < 10) {
      return '';
    }

    const chars = text.slice(-9);
    const valueFor = (read: string, write: string, execute: string): number => {
      let value = 0;
      if (read === 'r') value += 4;
      if (write === 'w') value += 2;
      if (execute === 'x' || execute === 's' || execute === 't') value += 1;
      return value;
    };
    const owner = valueFor(chars[0], chars[1], chars[2]);
    const group = valueFor(chars[3], chars[4], chars[5]);
    const other = valueFor(chars[6], chars[7], chars[8]);
    let special = 0;

    if (chars[2] === 's' || chars[2] === 'S') special += 4;
    if (chars[5] === 's' || chars[5] === 'S') special += 2;
    if (chars[8] === 't' || chars[8] === 'T') special += 1;

    return `${special ? String(special) : ''}${owner}${group}${other}`;
  }

  private formatPropertySize(size: unknown): string {
    const value = Number(size || 0);

    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }

  private formatPropertyDate(value: unknown): string {
    const timestamp = Number(value || 0);
    return timestamp ? new Date(timestamp).toLocaleString() : '';
  }

  private formatMetadata(value: unknown): string {
    if (value === undefined || value === null || value === '') {
      return '';
    }

    return String(value);
  }

  private formatSessionTarget(connection: { username?: string; host: string; port: number }): string {
    const userPart = connection.username ? `${connection.username}@` : '';
    return `${userPart}${connection.host}:${connection.port}`;
  }

  private capitalizeText(value: unknown): string {
    const text = String(value || 'unknown');
    return text.charAt(0).toUpperCase() + text.slice(1);
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

      const sha256 = this.formatChecksumLine(result.sha256);
      const md5 = this.formatChecksumLine(result.md5);
      const copyContent = [
        `Checksums for ${name}`,
        '',
        `Remote file: ${item.remotePath}`,
        `Size: ${this.formatBytes(stats.size)}`,
        `Modified: ${this.formatTimestamp(stats.modifyTime)}`,
        '',
        `SHA-256: ${sha256}`,
        '',
        `MD5: ${md5}`
      ].join('\n');
      const detail = [
        `Remote file: ${item.remotePath}`,
        `Size: ${this.formatBytes(stats.size)}`,
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
        const normalized = this.normalizeArchiveName(value, format);
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

    const archiveName = this.normalizeArchiveName(archiveNameInput, format);
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
    if (!item?.connectionId || !item.remotePath || this.getRemoteItemType(item) !== 'directory') {
      return;
    }

    RemoteEditPanel.requestUploadEntriesFromSidebar(
      this.context,
      this.sessions,
      this.connectionManager,
      this.output,
      {
        connectionId: item.connectionId,
        targetDirectory: item.remotePath
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

  private normalizeArchiveName(value: string, format: RemoteArchiveFormat): string {
    const extension = `.${format}`;
    const trimmed = String(value || '').trim();

    if (!trimmed) {
      return '';
    }

    return trimmed.endsWith(extension) ? trimmed : `${trimmed}${extension}`;
  }

  private async buildDefaultArchiveName(connectionId: string, baseDirectory: string, entries: Array<{ name: string }>, format: RemoteArchiveFormat): Promise<string> {
    const baseName = this.buildArchiveBaseName(entries);
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

  private buildArchiveBaseName(entries: Array<{ name: string }>): string {
    if (entries.length !== 1) {
      return 'archive';
    }

    const rawName = entries[0].name || 'archive';
    const withoutKnownArchiveExtension = rawName
      .replace(/\.tar\.gz$/i, '')
      .replace(/\.tar\.bz2$/i, '')
      .replace(/\.tar\.xz$/i, '')
      .replace(/\.tar\.z$/i, '');

    return withoutKnownArchiveExtension || rawName || 'archive';
  }

  private async setRemotePermissions(item: RemoteEditSidebarItem | undefined): Promise<void> {
    if (!item?.connectionId || !item.remotePath) {
      return;
    }

    const currentPermissions = String(item.remoteEntry?.permissions || '').trim();
    const currentMode = this.permissionModeFromString(currentPermissions);
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

    const visibleProfile = this.mergeProfileWithDraft(profile);
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

  private formatBytes(size: number): string {
    if (!Number.isFinite(size) || size < 0) {
      return '0 B';
    }

    if (size < 1024) {
      return `${size} B`;
    }

    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = size / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`;
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


  private permissionModeFromString(permissions: string): string | undefined {
    const text = String(permissions || '').trim();

    if (/^[0-7]{3,4}$/.test(text)) {
      return text.padStart(4, '0');
    }

    if (!/^[bcdlps-]?[rwxStTs-]{9}$/.test(text)) {
      return undefined;
    }

    const symbolic = text.length === 10 ? text.slice(1) : text;
    const triples = [symbolic.slice(0, 3), symbolic.slice(3, 6), symbolic.slice(6, 9)];
    const special = [symbolic[2], symbolic[5], symbolic[8]];
    let specialValue = 0;

    if (special[0] === 's' || special[0] === 'S') specialValue += 4;
    if (special[1] === 's' || special[1] === 'S') specialValue += 2;
    if (special[2] === 't' || special[2] === 'T') specialValue += 1;

    const digits = triples.map(part => {
      let value = 0;
      if (part[0] === 'r') value += 4;
      if (part[1] === 'w') value += 2;
      if (part[2] === 'x' || part[2] === 's' || part[2] === 't') value += 1;
      return String(value);
    }).join('');

    return `${specialValue}${digits}`;
  }

  private formatChecksumLine(checksum: { value?: string; error?: string; command?: string }): string {
    if (checksum.value) {
      return checksum.command ? `${checksum.value} (${checksum.command})` : checksum.value;
    }

    return checksum.error || 'Not available';
  }

  private showSidebarCommandError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.output.appendLine(`[Sidebar] Remote command failed: ${message}`);
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

    if (field === 'credentials') {
      await this.manageConnectionCredentials(profileId);
      return;
    }

    const isQuickConnect = this.isQuickConnectId(profileId);
    const storedProfile = isQuickConnect ? undefined : await this.connectionManager.getProfile(profileId);
    const draftProfile = isQuickConnect
      ? this.buildQuickConnectProfile()
      : storedProfile
        ? this.mergeProfileWithDraft(storedProfile)
        : this.getDraftProfileById(profileId);

    if (!draftProfile) {
      this.connectionsProvider.refresh();
      void vscode.window.showWarningMessage('The selected saved connection no longer exists.');
      return;
    }

    const currentProfile = draftProfile;

    try {
      if (field === 'keepAlive') {
        this.updateDraftValue(profileId, { keepAlive: currentProfile.keepAlive === false });
        this.connectionsProvider.refresh();
        return;
      }

      if (field === 'ftpsAllowSelfSignedCertificate') {
        this.updateDraftValue(profileId, {
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

        this.updateDraftValue(profileId, {
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

        this.updateDraftValue(profileId, { authType: selected.value });
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

      this.updateConnectionDetailDraft(profileId, field, value);
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

    const isQuickConnect = this.isQuickConnectId(profileId);
    const storedProfile = isQuickConnect ? undefined : await this.connectionManager.getProfile(profileId);
    const profile = isQuickConnect
      ? this.buildQuickConnectProfile()
      : storedProfile
        ? this.mergeProfileWithDraft(storedProfile)
        : this.getDraftProfileById(profileId);

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

      this.updateDraftValue(profileId, { ftpsCaCertificatePath: selectedPath });
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

    const isQuickConnect = this.isQuickConnectId(profileId);
    const storedProfile = isQuickConnect ? undefined : await this.connectionManager.getProfile(profileId);
    const profile = isQuickConnect
      ? this.buildQuickConnectProfile()
      : storedProfile
        ? this.mergeProfileWithDraft(storedProfile)
        : this.getDraftProfileById(profileId);

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

        this.updateDraftValue(profileId, { password, rememberPassword: !isQuickConnect });
      } else if (selected.action === 'clearPassword') {
        this.updateDraftValue(profileId, { password: '', rememberPassword: false });
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

        this.updateDraftValue(profileId, { passphrase, rememberPassphrase: !isQuickConnect });
      } else if (selected.action === 'clearPassphrase') {
        this.updateDraftValue(profileId, { passphrase: '', rememberPassphrase: false });
      }

      this.connectionsProvider.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  }

  private updateDraftValue(profileId: string, value: SidebarConnectionDraft): void {
    if (this.isQuickConnectId(profileId)) {
      this.quickConnectDraft = this.normalizeDraftForType({ ...this.quickConnectDraft, ...value });
      return;
    }

    const current = this.draftConnections.get(profileId) || { id: profileId };
    this.draftConnections.set(profileId, this.normalizeDraftForType({ ...current, ...value, id: profileId }));
  }

  private updateConnectionDetailDraft(profileId: string, field: ConnectionDetailField, value: string): void {
    switch (field) {
      case 'host':
        this.updateDraftValue(profileId, { host: value });
        break;
      case 'port':
        this.updateDraftValue(profileId, { port: value });
        break;
      case 'username':
        this.updateDraftValue(profileId, { username: value });
        break;
      case 'startPath':
        this.updateDraftValue(profileId, { startPath: value });
        break;
      case 'privateKeyPath':
        this.updateDraftValue(profileId, { privateKeyPath: value });
        break;
      case 'ftpsCaCertificatePath':
        this.updateDraftValue(profileId, { ftpsCaCertificatePath: value });
        break;
      default:
        break;
    }
  }


  private async renameSavedConnection(item: RemoteEditSidebarItem | string | undefined): Promise<void> {
    const profileId = typeof item === 'string' ? item : item?.profileId;

    if (!profileId || this.isQuickConnectId(profileId)) {
      return;
    }

    const storedProfile = await this.connectionManager.getProfile(profileId);
    const draftProfile = storedProfile ? this.mergeProfileWithDraft(storedProfile) : this.getDraftProfileById(profileId);

    if (!draftProfile) {
      void vscode.window.showErrorMessage('The selected saved connection no longer exists.');
      this.connectionsProvider.refresh();
      return;
    }

    const profiles = await this.connectionManager.listProfiles();
    const existingNames = new Set([
      ...profiles.filter(profile => profile.id !== profileId).map(profile => profile.name.trim().toLowerCase()),
      ...this.getNewDraftProfiles().filter(profile => profile.id !== profileId).map(profile => profile.name.trim().toLowerCase())
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
      if (this.isNewDraftId(profileId)) {
        this.updateDraftValue(profileId, { name: name.trim() });
      } else {
        await this.connectionManager.renameProfile(profileId, name);
        RemoteEditSharedState.fireProfilesChanged(profileId, 'sidebar');
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

    if (!profileId || this.isQuickConnectId(profileId)) {
      return;
    }

    const profile = await this.connectionManager.getProfile(profileId);
    const draftProfile = profile ? this.mergeProfileWithDraft(profile) : this.getDraftProfileById(profileId);

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

      this.draftConnections.delete(profileId);

      if (profile) {
        await this.connectionManager.deleteProfile(profileId);
        RemoteEditSharedState.fireProfilesChanged(undefined, 'sidebar');
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

    if (!profileId || this.isQuickConnectId(profileId)) {
      return undefined;
    }

    const draft = this.draftConnections.get(profileId);

    if (!draft) {
      void vscode.window.showInformationMessage('No pending changes to save.');
      return await this.connectionManager.getProfile(profileId);
    }

    try {
      const savedProfile = await this.connectionManager.saveProfile({
        ...draft,
        id: this.isNewDraftId(profileId) ? undefined : profileId
      });
      this.draftConnections.delete(profileId);
      this.connectionsProvider.refresh();
      RemoteEditSharedState.fireProfilesChanged(savedProfile.id, 'sidebar');
      void vscode.window.showInformationMessage(this.isNewDraftId(profileId) ? 'Connection saved.' : 'Connection changes saved.');
      return savedProfile;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
      return undefined;
    }
  }


  private discardConnectionChanges(item: RemoteEditSidebarItem | string | undefined): void {
    const profileId = typeof item === 'string' ? item : item?.profileId;

    if (!profileId || this.isQuickConnectId(profileId)) {
      return;
    }

    this.draftConnections.delete(profileId);
    this.connectionsProvider.refresh();
    void vscode.window.showInformationMessage('Connection changes discarded.');
  }

  private clearQuickConnect(): void {
    this.quickConnectDraft = this.createDefaultQuickConnectDraft();
    this.connectionsProvider.refresh();
  }

  private async connectQuickConnect(): Promise<void> {
    const profile = this.buildQuickConnectProfile();

    if (!profile.host) {
      void vscode.window.showWarningMessage('Hostname is required for Quick Connect.');
      return;
    }

    if (!profile.username) {
      void vscode.window.showWarningMessage('Username is required for Quick Connect.');
      return;
    }

    const payload = {
      ...this.quickConnectDraft,
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

    if (!this.draftConnections.has(profileId)) {
      await this.connectSavedConnection(profileId);
      return;
    }

    const isNewDraft = this.isNewDraftId(profileId);
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

    await this.connectSavedConnection(profileId, this.getDraftProfileById(profileId));
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


class SudoModeDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.onDidChangeFileDecorationsEmitter.event;

  constructor(private readonly sessions: RemoteSessionManager) {}

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    const connectionId = getSidebarDecorationConnectionId(uri);

    if (!connectionId || !this.sessions.isSudoModeEnabled(connectionId)) {
      return undefined;
    }

    return {
      color: new vscode.ThemeColor('remoteedit.sudoForeground'),
      tooltip: 'Sudo Mode is enabled for this connection.'
    };
  }

  refresh(): void {
    this.onDidChangeFileDecorationsEmitter.fire(undefined);
  }

  dispose(): void {
    this.onDidChangeFileDecorationsEmitter.dispose();
  }
}

function getSidebarDecorationConnectionId(uri: vscode.Uri): string | undefined {
  if (!uri.query) {
    return undefined;
  }

  try {
    return new URLSearchParams(uri.query).get('connectionId') || undefined;
  } catch {
    return undefined;
  }
}
