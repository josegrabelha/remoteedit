import * as vscode from 'vscode';
import { ConnectionTester } from '../connection/ConnectionTester';
import type { ConnectionManager } from '../connection/ConnectionManager';
import { RemoteEditSharedState } from '../state/RemoteEditSharedState';
import { hostKeyTrust } from '../ssh/hostKeys/HostKeyRuntime';
import { appendPerformanceLog, createPerformanceTimer, type OutputLogDetails } from '../utils/outputLogger';
import { RemoteEditOutboundMessageType } from './PanelMessages';
import type { ConfirmDialogOptions, ConfirmDialogDecision } from './PanelTypes';
import { ConnectionImportController } from './ConnectionImportController';
import { PanelBackupController } from './PanelBackupController';
import { SshKeyToolsController } from './SshKeyToolsController';

interface ConnectionManagementOptions {
  context: vscode.ExtensionContext;
  connectionManager: ConnectionManager;
  output: vscode.OutputChannel;
  origin?: string;
  postMessage(type: RemoteEditOutboundMessageType, payload: any): void;
  showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean>;
  showConfirmDialogDecision(options: ConfirmDialogOptions): Promise<ConfirmDialogDecision>;
  postBusy(isBusy: boolean, message: string, cancelAction?: boolean | 'transfer' | 'connection', cancelLabel?: string, connectionId?: string): void;
  logInfo(message: string, details?: OutputLogDetails): void;
  logError(message: string, details?: OutputLogDetails): void;
  hasConnection?(id: string): boolean;
  disconnect?(id: string): Promise<void>;
  postPersistentStorageSnapshot(): void;
}

/** One implementation of management actions, with presentation owned by the caller. */
export class ConnectionManagementController implements vscode.Disposable {
  readonly connectionImportController: ConnectionImportController;
  readonly backupController: PanelBackupController;
  private readonly connectionTester: ConnectionTester;
  private testRequest?: string;
  private sshKeyToolsController?: SshKeyToolsController;
  private readonly disposables: vscode.Disposable[] = [];
  private get connectionManager() { return this.options.connectionManager; }
  private get output() { return this.options.output; }
  private postMessage = (type: RemoteEditOutboundMessageType, payload: any) => this.options.postMessage(type, payload);
  private showConfirmDialog = (options: ConfirmDialogOptions) => this.options.showConfirmDialog(options);
  private postBusy = (...args: Parameters<ConnectionManagementOptions['postBusy']>) => this.options.postBusy(...args);
  private logInfo = (message: string, details?: OutputLogDetails) => this.options.logInfo(message, details);

  constructor(private readonly options: ConnectionManagementOptions) {
    this.connectionTester = new ConnectionTester(this.connectionManager);
    this.connectionImportController = new ConnectionImportController(this.connectionManager, this.postMessage, async () => { await this.sendProfiles(); this.fireProfilesChanged(undefined, 'webview', 'connectionImport'); });
    this.backupController = new PanelBackupController({
      ...options, sendProfiles: () => this.sendProfiles(),
      postMessage: this.postMessage
    });
  }
  private fireProfilesChanged(selectedId?: string, source?: 'webview', reason?: string): void {
    RemoteEditSharedState.fireProfilesChanged(selectedId, source, reason, this.options.origin);
  }
  async testConnection(payload: any): Promise<void> {
    const requestId = String(payload?.requestId || "");
    if (!requestId) return;
    if (this.testRequest) {
      this.postMessage(RemoteEditOutboundMessageType.ConnectionTestResult, { requestId, error: "The previous connection test is still closing. Try again shortly." });
      return;
    }
    this.testRequest = requestId;
    const result = await this.connectionTester.test(payload.profile || {});
    if (this.testRequest === requestId) {
      this.testRequest = undefined;
      this.postMessage(RemoteEditOutboundMessageType.ConnectionTestResult, { requestId, ...result });
    }
  }
  cancelConnectionTest(payload?: any): void {
    if (payload?.requestId && payload.requestId !== this.testRequest) return;
    this.connectionTester.cancel();
  }
  dispose(): void {
    this.cancelConnectionTest();
    this.testRequest = undefined;
    this.connectionImportController.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.backupController.clearPendingImport();
  }

  async manageSshKeyTools(payload: any): Promise<void> {
    if (!this.sshKeyToolsController) {
      this.sshKeyToolsController = new SshKeyToolsController(this.connectionManager, state => this.postMessage(RemoteEditOutboundMessageType.SshKeyToolsState, state), async () => { await this.sendProfiles(); this.fireProfilesChanged(undefined, 'webview', 'sshKeyTools'); });
      this.disposables.push(this.sshKeyToolsController);
    }
    await this.sshKeyToolsController.handle(payload);
  }

  async manageTrustedSshHosts(payload: any): Promise<void> {
    try {
      const service = hostKeyTrust();
      if (payload?.action === 'delete') {
        const item = (await service.store.list()).find(host => host.id === String(payload.id))
          || (await service.knownHosts.list()).find(host => host.id === String(payload.id));
        if (!item || item.publicKey !== payload.publicKey || item.fileDigest !== payload.fileDigest) throw new Error('The selected trusted SSH host changed. Refresh the list before deleting.');
        if (item.source === 'Remote Edit') {
          if (await this.showConfirmDialog({ title: 'Delete Trusted SSH Host?', message: `Remove trust for ${item.host}:${item.port}? The next connection will consult OpenSSH known_hosts or require approval.`, details: item.fingerprint, confirmLabel: 'Delete', cancelLabel: 'Cancel', danger: true })) await service.store.remove(item.id);
        } else if (item.source === 'OpenSSH (User)' && item.removable) {
          const confirmed = await this.showConfirmDialog({ title: 'Remove SSH Host Key?', message: 'Remove the selected host key from your OpenSSH known_hosts file?', details: `${item.host}${item.port ? ':' + item.port : ''}\nFingerprint: ${item.fingerprint}\nSource: ${item.source}\nFile: ${item.filePath}\n\nThis may affect other SSH applications. The server identity will need to be verified again if no other trusted key exists. A backup of the original file will be created before deletion.`, confirmLabel: 'Delete', cancelLabel: 'Cancel', danger: true });
          if (confirmed) {
            const backup = await service.knownHosts.remove(item);
            this.logInfo('Removed OpenSSH user host key.', { File: item.filePath, Backup: backup });
          }
        } else throw new Error('This OpenSSH record is read-only.');
      }
      this.postMessage(RemoteEditOutboundMessageType.TrustedSshHostsState, { hosts: await service.list(), environment: `${process.platform} · ${vscode.env.remoteName || 'Local extension host'}` });
    } catch (error) {
      let hosts: unknown[] | undefined;
      try { hosts = await hostKeyTrust().store.list(); } catch { /* Preserve the original storage/read error. */ }
      this.postMessage(RemoteEditOutboundMessageType.TrustedSshHostsState, { hosts, error: error instanceof Error ? error.message : 'Could not load trusted SSH hosts.' });
    }
  }

  async manageProxyProfiles(payload: any): Promise<void> {
    try {
      let savedProfileId: string | undefined;
      if (payload?.action === 'save') savedProfileId = (await this.connectionManager.proxyProfiles.save(payload.profile)).id;
      else if (payload?.action === 'delete') {
        const id = String(payload.id);
        const proxy = (await this.connectionManager.proxyProfiles.list()).find(profile => profile.id === id);
        if (!proxy) throw new Error('The selected proxy profile no longer exists.');
        const confirmed = await this.showConfirmDialog({
          title: 'Delete proxy profile?',
          message: `Delete proxy profile "${proxy.name}"? Stored credentials for this proxy will also be removed.`,
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
          danger: true
        });
        if (confirmed) await this.connectionManager.proxyProfiles.delete(id, await this.connectionManager.listProfiles());
      }
      this.postMessage(RemoteEditOutboundMessageType.ProxyProfilesState, { profiles: await this.connectionManager.proxyProfiles.list(), savedProfileId, completed: payload?.action === 'save' || payload?.action === 'delete' });
      if (payload?.action === 'save' || payload?.action === 'delete') {
        this.fireProfilesChanged(undefined, 'webview', 'proxyProfilesChanged');
      }
    } catch (error) {
      this.postMessage(RemoteEditOutboundMessageType.ProxyProfilesState, { error: error instanceof Error ? error.message : 'Unable to update proxy profiles.' });
    }
  }

  async manageMasterPassword(payload: any): Promise<void> {
    try {
      if (payload?.action === 'save') {
        await this.connectionManager.setMasterPassword(payload.password, payload.confirmation);
      } else if (payload?.action === 'remove') {
        await this.connectionManager.removeMasterPassword();
      }
      this.postMessage(RemoteEditOutboundMessageType.MasterPasswordState, {
        ...await this.connectionManager.getMasterPasswordState(),
        completed: payload?.action === 'save' || payload?.action === 'remove'
      });
      if (payload?.action === 'save' || payload?.action === 'remove') this.fireProfilesChanged(undefined, 'webview', 'masterPassword');
    } catch (error) {
      this.postMessage(RemoteEditOutboundMessageType.MasterPasswordState, {
        error: error instanceof Error ? error.message : 'Unable to update Master Password.'
      });
    }
  }

  async sendProfiles(selectedId?: string, options?: { renameProfileId?: string; editedProfileId?: string; preserveSelection?: boolean }): Promise<void> {
    const timer = createPerformanceTimer();
    const profiles = await this.connectionManager.listProfiles();
    const connectionGroups = await this.connectionManager.listGroups();
    this.postMessage(RemoteEditOutboundMessageType.ProfilesLoaded, {
      profiles,
      proxyProfiles: await this.connectionManager.proxyProfiles.list(),
      masterPasswordState: await this.connectionManager.getMasterPasswordState(),
      connectionGroups,
      selectedId,
      renameProfileId: options?.renameProfileId,
      editorRefresh: Boolean(options?.editedProfileId) || Boolean(options?.preserveSelection),
      editedProfileId: options?.editedProfileId
    });
    appendPerformanceLog(this.output, 'Panel', `Posted profiles snapshot in ${timer()}ms`, {
      Profiles: profiles.length,
      Groups: connectionGroups.length,
      SelectedId: selectedId || ''
    });
  }

  async saveConnection(payload: any): Promise<void> {
    const statusConnectionId = this.getOperationStatusConnectionId(payload);
    const profilePayload = { ...(payload || {}) };
    const editorSave = Boolean(profilePayload.editorSave);
    delete profilePayload.editorSave;
    const newGroupName = String(profilePayload.newGroupName || '').trim();
    delete profilePayload.statusConnectionId;
    delete profilePayload.newGroupName;

    this.postBusy(true, 'Saving connection...', false, undefined, statusConnectionId);

    try {
      if (editorSave && !(await this.connectionManager.getProfile(String(profilePayload.id || '')))) {
        throw new Error('This saved connection no longer exists.');
      }
      if (editorSave) {
        const all = await this.connectionManager.listProfiles();
        if (all.some(p => p.id !== profilePayload.id && p.name.trim().toLowerCase() === String(profilePayload.name || '').trim().toLowerCase())) throw new Error('A connection with this name already exists.');
      }
      if (newGroupName) {
        const group = await this.connectionManager.createGroup(newGroupName);
        profilePayload.groupId = group.id;
      }
      const profile = await this.connectionManager.saveProfile(profilePayload);
      await this.sendProfiles(editorSave ? undefined : profile.id, editorSave ? { editedProfileId: profile.id } : undefined);
      this.fireProfilesChanged(profile.id, 'webview', 'saveProfile');
      if (editorSave) this.postMessage(RemoteEditOutboundMessageType.ConnectionEditResult, { id: profile.id, saved: true });
      this.postBusy(false, 'Connection saved.', false, undefined, statusConnectionId);
      this.logInfo('Saved connection.', { Name: profile.name, Target: `${profile.username ? profile.username + '@' : ''}${profile.host}:${profile.port}` });
    } catch (error) {
      this.postBusy(false, 'Connection save failed.', false, undefined, statusConnectionId);
      if (editorSave) {
        this.postMessage(RemoteEditOutboundMessageType.ConnectionEditResult, { id: profilePayload.id, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      throw error;
    }
  }

  async saveConnectionAs(payload: any): Promise<void> {
    const statusConnectionId = this.getOperationStatusConnectionId(payload);
    const profilePayload = { ...(payload || {}) };
    const sourceProfileId = String(profilePayload.sourceProfileId || '').trim();
    const newGroupName = String(profilePayload.newGroupName || '').trim();
    delete profilePayload.statusConnectionId;
    delete profilePayload.sourceProfileId;
    delete profilePayload.newGroupName;
    delete profilePayload.id;

    this.postBusy(true, 'Saving connection as...', false, undefined, statusConnectionId);

    try {
      if (newGroupName) {
        const group = await this.connectionManager.createGroup(newGroupName);
        profilePayload.groupId = group.id;
      }
      const profile = await this.connectionManager.saveProfileAs(sourceProfileId, profilePayload);
      await this.sendProfiles(profile.id);
      this.fireProfilesChanged(profile.id, 'webview', 'saveProfileAs');
      this.postBusy(false, 'Connection saved.', false, undefined, statusConnectionId);
      this.logInfo('Saved connection as a new profile.', {
        Name: profile.name,
        ProfileId: profile.id,
        SourceProfileId: sourceProfileId,
        Target: `${profile.username ? profile.username + '@' : ''}${profile.host}:${profile.port}`
      });
    } catch (error) {
      this.postBusy(false, 'Connection save failed.', false, undefined, statusConnectionId);
      throw error;
    }
  }

  getOperationStatusConnectionId(payload: any): string | undefined {
    const statusConnectionId = String(payload?.statusConnectionId || '').trim();
    return statusConnectionId || undefined;
  }

  async pickPrivateKeyPath(payload?: any): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select',
      title: 'Select private key file'
    });

    const selectedPath = selected?.[0]?.fsPath;
    if (selectedPath || payload?.editorProfileId) {
      this.postMessage(RemoteEditOutboundMessageType.PrivateKeyPathSelected, { path: selectedPath, editorProfileId: payload?.editorProfileId });
    }
  }

  async pickCaCertificatePath(payload?: any): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Select',
      title: 'Select FTPS CA certificate file',
      filters: { 'PEM certificates': ['pem', 'crt', 'cer'], 'All files': ['*'] }
    });

    const selectedPath = selected?.[0]?.fsPath;
    if (selectedPath || payload?.editorProfileId) {
      this.postMessage(RemoteEditOutboundMessageType.CaCertificatePathSelected, { path: selectedPath, editorProfileId: payload?.editorProfileId });
    }
  }

  async cloneConnection(payload: any): Promise<void> {
    const profileId = String(payload?.id || '').trim();

    this.postBusy(true, 'Cloning connection...');
    const profile = await this.connectionManager.cloneProfile(profileId);
    await this.sendProfiles(profile.id, { renameProfileId: profile.id });
    this.postBusy(false, 'Connection cloned.');
    this.fireProfilesChanged(profile.id, 'webview', 'cloneProfile');
    this.logInfo('Cloned saved connection.', { Name: profile.name, ProfileId: profile.id, SourceProfileId: profileId });
  }

  async renameConnection(payload: any): Promise<void> {
    const profileId = String(payload?.id || '').trim();
    const name = String(payload?.name || '').trim();

    this.postBusy(true, 'Renaming connection...');
    const profile = await this.connectionManager.renameProfile(profileId, name);
    await this.sendProfiles(profile.id);
    this.fireProfilesChanged(profile.id, 'webview', 'saveProfile');
    this.postBusy(false, 'Connection renamed.');
    this.logInfo('Renamed saved connection.', { Name: profile.name, ProfileId: profileId });
  }

  async reorderConnections(payload: any): Promise<void> {
    const profileIds = Array.isArray(payload?.profileIds)
      ? payload.profileIds.map((profileId: unknown) => String(profileId || '').trim()).filter(Boolean)
      : [];
    const groupsByProfileId = payload?.groupsByProfileId && typeof payload.groupsByProfileId === 'object' && !Array.isArray(payload.groupsByProfileId)
      ? payload.groupsByProfileId as Record<string, string | undefined>
      : undefined;

    await this.connectionManager.reorderProfiles(profileIds, groupsByProfileId);
    await this.sendProfiles(String(payload?.selectedId || ''));
    this.fireProfilesChanged(String(payload?.selectedId || '') || undefined, 'webview', 'profileListChanged');
    this.logInfo('Reordered saved connections.', { Count: String(profileIds.length) });
  }

  async createConnectionGroup(payload: any): Promise<void> {
    const name = String(payload?.name || '').trim();

    this.postBusy(true, 'Creating connection group...');
    const group = await this.connectionManager.createGroup(name);
    await this.sendProfiles(String(payload?.selectedId || ''));
    this.postBusy(false, 'Connection group created.');
    this.fireProfilesChanged(String(payload?.selectedId || '') || undefined, 'webview', 'profileListChanged');
    this.logInfo('Created connection group.', { Name: group.name, GroupId: group.id });
  }

  async renameConnectionGroup(payload: any): Promise<void> {
    const groupId = String(payload?.id || '').trim();
    const name = String(payload?.name || '').trim();

    this.postBusy(true, 'Renaming connection group...');
    const group = await this.connectionManager.renameGroup(groupId, name);
    await this.sendProfiles(String(payload?.selectedId || ''));
    this.postBusy(false, 'Connection group renamed.');
    this.fireProfilesChanged(String(payload?.selectedId || '') || undefined, 'webview', 'profileListChanged');
    this.logInfo('Renamed connection group.', { Name: group.name, GroupId: group.id });
  }

  async deleteConnectionGroup(payload: any): Promise<void> {
    const groupId = String(payload?.id || '').trim();
    const name = String(payload?.name || '').trim() || 'connection group';
    const deleteConnections = Boolean(payload?.deleteConnections);
    const selectedId = String(payload?.selectedId || '');
    const profiles = await this.connectionManager.listProfiles();
    const profileIdsInGroup = profiles
      .filter(profile => profile.groupId === groupId)
      .map(profile => profile.id)
      .filter(Boolean);

    this.postBusy(true, deleteConnections ? 'Deleting connection group and connections...' : 'Deleting connection group...');

    if (deleteConnections) {
      for (const profileId of profileIdsInGroup) {
        if (this.options.hasConnection?.(profileId)) {
          await this.options.disconnect?.(profileId);
        }
      }
    }

    const removedProfileIds = await this.connectionManager.deleteGroup(groupId, deleteConnections);
    const nextSelectedId = deleteConnections && removedProfileIds.includes(selectedId) ? '' : selectedId;
    await this.sendProfiles(nextSelectedId);
    this.fireProfilesChanged(nextSelectedId || undefined, 'webview', 'deleteGroup');

    if (!nextSelectedId && deleteConnections && selectedId) {
      this.postMessage(RemoteEditOutboundMessageType.ConnectionFormCleared, {});
    }

    this.postBusy(false, deleteConnections ? 'Connection group and connections deleted.' : 'Connection group deleted.');
    this.logInfo('Deleted connection group.', { Name: name, GroupId: groupId, ConnectionsDeleted: String(deleteConnections ? removedProfileIds.length : 0) });
  }

  async deleteConnection(payload: any): Promise<void> {
    const profileId = String(payload?.id || '').trim();

    if (!profileId) {
      throw new Error('Select a saved connection to remove.');
    }

    const profile = await this.connectionManager.getProfile(profileId);

    if (!profile) {
      await this.sendProfiles();
      throw new Error('The selected saved connection no longer exists.');
    }

    const confirmed = await this.showConfirmDialog({
      title: 'Remove saved connection?',
      message: `Remove saved connection "${profile.name}"? Stored secrets for this profile will also be removed.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      danger: true
    });

    if (!confirmed) {
      return;
    }

    this.postBusy(true, 'Removing connection...');

    if (this.options.hasConnection?.(profileId)) {
      await this.options.disconnect?.(profileId);
    }

    await this.connectionManager.deleteProfile(profileId);
    await this.sendProfiles('');
    this.fireProfilesChanged(undefined, 'webview', 'importBackup');
    this.postMessage(RemoteEditOutboundMessageType.ConnectionFormCleared, {});
    this.postBusy(false, 'Connection removed.');
    this.logInfo('Removed saved connection.', { Name: profile.name, ProfileId: profileId });
  }
}
