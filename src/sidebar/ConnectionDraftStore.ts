import type { AuthType, ConnectionProfile, ConnectionProfileInput } from '../connection/ConnectionManager';
import { getDefaultPortForConnectionType, normalizeConnectionType, type RemoteConnectionType } from '../remote/RemoteConnectionTypes';
import type { ConnectionDetailField } from './Items';

export const QUICK_CONNECT_ID = '__remoteeditQuickConnect';

export type SidebarConnectionDraft = ConnectionProfileInput & {
  password?: string;
  passphrase?: string;
};

export class SidebarConnectionDraftStore {
  private readonly draftConnections = new Map<string, SidebarConnectionDraft>();
  private quickConnectDraft: SidebarConnectionDraft = this.createDefaultQuickConnectDraft();

  clear(): void {
    this.draftConnections.clear();
  }

  clearAll(): void {
    this.clear();
    this.resetQuickConnect();
  }

  resetQuickConnect(): void {
    this.quickConnectDraft = this.createDefaultQuickConnectDraft();
  }

  hasDraft(profileId: string): boolean {
    return this.draftConnections.has(profileId);
  }

  getDraft(profileId: string): SidebarConnectionDraft | undefined {
    return this.draftConnections.get(profileId);
  }

  getQuickConnectDraft(): SidebarConnectionDraft {
    return { ...this.quickConnectDraft };
  }

  setNewDraft(name: string): string {
    const profileId = this.buildNewDraftId();
    this.draftConnections.set(profileId, this.normalizeDraftForType({
      id: profileId,
      name,
      connectionType: 'sftp',
      port: getDefaultPortForConnectionType('sftp'),
      authType: 'password',
      startPath: '/',
      keepAlive: true
    }));
    return profileId;
  }

  deleteDraft(profileId: string): boolean {
    return this.draftConnections.delete(profileId);
  }

  buildQuickConnectProfile(): ConnectionProfile {
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

  mergeProfileWithDraft(profile: ConnectionProfile): ConnectionProfile {
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

  getNewDraftProfiles(): ConnectionProfile[] {
    return Array.from(this.draftConnections.entries())
      .filter(([profileId]) => this.isNewDraftId(profileId))
      .map(([, draft]) => this.buildDraftProfile(draft));
  }

  getDraftProfileById(profileId: string): ConnectionProfile | undefined {
    const draft = this.draftConnections.get(profileId);
    return draft ? this.buildDraftProfile(draft) : undefined;
  }

  updateDraftValue(profileId: string, value: SidebarConnectionDraft): void {
    if (this.isQuickConnectId(profileId)) {
      this.quickConnectDraft = this.normalizeDraftForType({ ...this.quickConnectDraft, ...value });
      return;
    }

    const current = this.draftConnections.get(profileId) || { id: profileId };
    this.draftConnections.set(profileId, this.normalizeDraftForType({ ...current, ...value, id: profileId }));
  }

  updateConnectionDetailDraft(profileId: string, field: ConnectionDetailField, value: string): void {
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

  isNewDraftId(profileId: string | undefined): boolean {
    return Boolean(profileId && profileId.startsWith('__remoteeditNewConnection:'));
  }

  isQuickConnectId(profileId: string | undefined): boolean {
    return profileId === QUICK_CONNECT_ID;
  }

  buildDraftProfile(draftInput: SidebarConnectionDraft): ConnectionProfile {
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

  private buildNewDraftId(): string {
    return `__remoteeditNewConnection:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
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
}
