import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { ConnectOptions } from '../remote/RemoteSessionManager';
import { appendDebugLog, appendPerformanceLog, createPerformanceTimer } from '../utils/outputLogger';
import { DEFAULT_CONNECTION_TYPE, getDefaultPortForConnectionType, isKnownConnectionType, normalizeConnectionType, SFTP_CONNECTION_TYPE, type RemoteConnectionType } from '../remote/RemoteConnectionTypes';

export type AuthType = 'password' | 'privateKey';

export interface ConnectionProfile {
  id: string;
  name: string;
  connectionType: RemoteConnectionType;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  startPath: string;
  privateKeyPath?: string;
  hasSavedPassword?: boolean;
  hasSavedPassphrase?: boolean;
  keepAlive: boolean;
  ftpsAllowSelfSignedCertificate?: boolean;
  ftpsCaCertificatePath?: string;
  favoriteRemotePaths?: string[];
  groupId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}


export type RemoteEditImportMode = 'merge' | 'replace';

export interface ConnectionBackupExportOptions {
  includeSettings: boolean;
  includeConnections: boolean;
  includeFavorites: boolean;
  includeUsernames: boolean;
  includeCredentials: boolean;
  credentialPassword?: string;
  extensionVersion?: string;
}

export interface ConnectionBackupImportOptions {
  includeSettings: boolean;
  includeConnections: boolean;
  includeFavorites: boolean;
  includeUsernames: boolean;
  restoreCredentials: boolean;
  credentialPassword?: string;
  importMode: RemoteEditImportMode;
}

export interface RemoteEditBackupConnection {
  id: string;
  connectionType: RemoteConnectionType | string;
  name: string;
  host: string;
  port: number;
  username?: string;
  authType: AuthType;
  startPath: string;
  privateKeyPath?: string;
  keepAlive: boolean;
  ftpsAllowSelfSignedCertificate?: boolean;
  ftpsCaCertificatePath?: string;
  remotePathFavorites?: string[];
  createdAt?: number;
  groupId?: string;
  updatedAt?: number;
}

export interface RemoteEditBackupConnectionGroup {
  id: string;
  name: string;
  order?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface RemoteEditEncryptedCredentials {
  version: number;
  kdf: 'scrypt';
  kdfParams: {
    salt: string;
    keyLength: number;
    N: number;
    r: number;
    p: number;
  };
  cipher: 'aes-256-gcm';
  iv: string;
  authTag: string;
  data: string;
}

export interface RemoteEditPersistentWebviewStorage {
  savedCommands?: Record<string, unknown[]>;
  serverLogShortcuts?: Record<string, unknown[]>;
  portForwards?: Record<string, unknown[]>;
}

export interface RemoteEditBackupFile {
  remoteEditExportVersion: number;
  exportedAt: string;
  extensionVersion?: string;
  settings?: Record<string, unknown>;
  settingsKeys?: string[];
  connections?: RemoteEditBackupConnection[];
  connectionGroups?: RemoteEditBackupConnectionGroup[];
  encryptedCredentials?: RemoteEditEncryptedCredentials | null;
  savedCommands?: Record<string, unknown[]>;
  serverLogShortcuts?: Record<string, unknown[]>;
  portForwards?: Record<string, unknown[]>;
  logViewerFavorites?: Record<string, string[]>;
}

export interface RemoteEditBackupSummary {
  hasSettings: boolean;
  connectionCount: number;
  connectionGroupCount: number;
  supportedConnectionCount: number;
  unsupportedConnectionCount: number;
  remotePathFavoriteCount: number;
  usernamesIncluded: boolean;
  hasEncryptedCredentials: boolean;
  savedCommandCount: number;
  serverLogShortcutCount: number;
  portForwardCount: number;
  logViewerFavoriteCount: number;
}

export interface RemoteEditBackupImportResult {
  settingsImported: boolean;
  added: number;
  updated: number;
  replaced: boolean;
  skippedUnsupported: number;
  credentialsRestored: number;
  favoritesImported: number;
  usernamesImported: number;
  connectionGroupsImported: number;
  savedCommandsImported: number;
  serverLogShortcutsImported: number;
  portForwardsImported: number;
  logViewerFavoritesImported: number;
}

interface StoredCredentialMap {
  [profileId: string]: {
    password?: string;
    passphrase?: string;
  };
}

const CONFIG_SECTION = 'remoteedit';
const SUPPORTED_BACKUP_VERSION = 2;
const REMOTE_EDIT_SETTING_DEFAULTS = {
  editorTitleButtonPosition: 'hidden',
  statusBarButtonPosition: 'left',
  statusBarButtonStyle: 'iconAndText',
  statusBarButtonPriority: 1000,
  'webview.remotePathBreadcrumb.showDirectoryDetails': true,
  'webview.fileList.openOnNameClick': true,
  'sidebar.showItemInfoOnHover': false,
  'sidebar.showParentPath': true,
  directoryListingCacheTtl: 30,
  sshReadyTimeout: 30000,
  sshKeepAliveInterval: 30000,
  sshKeepAliveCountMax: 3,
  sftpResolveOwnerGroupNames: false,
  ftpKeepAliveInterval: 30000,
  'ftp.enableModifiedDateFallback': false,
  maxConcurrentTransfers: 2,
  sudoTempDirectory: '/tmp',
  restoreSpecialPermissionBits: true,
  'logViewer.maxBackgroundBufferLines': 5000
} as const;
const REMOTE_EDIT_SETTING_KEYS = Object.keys(REMOTE_EDIT_SETTING_DEFAULTS) as Array<keyof typeof REMOTE_EDIT_SETTING_DEFAULTS>;
const LEGACY_SETTING_KEY_ALIASES: Record<string, keyof typeof REMOTE_EDIT_SETTING_DEFAULTS> = {
  'remotePathBreadcrumb.showDirectoryDetails': 'webview.remotePathBreadcrumb.showDirectoryDetails',
  'fileList.openOnNameClick': 'webview.fileList.openOnNameClick'
};
const CANONICAL_SETTING_KEY_LEGACY_ALIASES = Object.entries(LEGACY_SETTING_KEY_ALIASES).reduce<Record<string, string[]>>((aliases, [legacyKey, canonicalKey]) => {
  const key = String(canonicalKey);
  aliases[key] = [...(aliases[key] || []), legacyKey];
  return aliases;
}, {});
const SCRYPT_PARAMS = {
  keyLength: 32,
  N: 16384,
  r: 8,
  p: 1
} as const;

export interface ConnectionProfileInput {
  id?: string;
  name?: string;
  host?: string;
  port?: number | string;
  username?: string;
  authType?: AuthType;
  connectionType?: RemoteConnectionType | string;
  startPath?: string;
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  rememberPassword?: boolean;
  rememberPassphrase?: boolean;
  keepAlive?: boolean;
  groupId?: string;
  ftpsAllowSelfSignedCertificate?: boolean;
  ftpsCaCertificatePath?: string;
}

const CONNECTIONS_KEY = 'remoteedit.connectionProfiles';
const CONNECTION_GROUPS_KEY = 'remoteedit.connectionGroups';
const SAVED_REMOTE_COMMANDS_KEY = 'remoteedit.savedRemoteCommands';
const SERVER_LOG_SHORTCUTS_KEY = 'remoteedit.serverLogShortcuts';
const SERVER_PORT_FORWARDS_KEY = 'remoteedit.serverPortForwards';
const LOG_VIEWER_FAVORITES_KEY = 'remoteedit.logViewer.favorites.v1';
const SECRET_PREFIX = 'remoteedit.connectionSecret';
const FTPS_CA_CERTIFICATE_REQUIRED_MESSAGE = 'CA certificate path is required for FTPS unless self-signed/untrusted certificates are allowed.';

export class ConnectionManager {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output?: vscode.OutputChannel
  ) {}

  async listGroups(): Promise<ConnectionGroup[]> {
    const timer = createPerformanceTimer();
    const storedGroups = this.context.globalState.get<ConnectionGroup[]>(CONNECTION_GROUPS_KEY, []);
    const groups = normalizeConnectionGroups(storedGroups);
    this.logPerformance('Loaded connection groups', timer(), { Groups: groups.length });
    return groups;
  }

  async createGroup(name: string): Promise<ConnectionGroup> {
    const timer = createPerformanceTimer();
    const groups = await this.listGroups();
    const trimmedName = normalizeGroupName(name);
    if (!trimmedName) {
      throw new Error('Group name is required.');
    }

    if (groups.some(group => group.name.toLowerCase() === trimmedName.toLowerCase())) {
      throw new Error('A connection group with this name already exists.');
    }

    const now = Date.now();
    const group: ConnectionGroup = {
      id: buildGroupId(trimmedName),
      name: trimmedName,
      order: groups.length,
      createdAt: now,
      updatedAt: now
    };

    await this.context.globalState.update(CONNECTION_GROUPS_KEY, normalizeConnectionGroups([...groups, group]));
    this.logDebug('Created connection group.', { Group: group.name, Groups: groups.length + 1 });
    this.logPerformance('Created connection group', timer(), { Groups: groups.length + 1 });
    return group;
  }

  async renameGroup(groupId: string, name: string): Promise<ConnectionGroup> {
    const timer = createPerformanceTimer();
    const id = String(groupId || '').trim();
    const trimmedName = normalizeGroupName(name);
    if (!id) {
      throw new Error('Select a connection group to rename.');
    }
    if (!trimmedName) {
      throw new Error('Group name is required.');
    }

    const groups = await this.listGroups();
    if (groups.some(group => group.id !== id && group.name.toLowerCase() === trimmedName.toLowerCase())) {
      throw new Error('A connection group with this name already exists.');
    }

    let updatedGroup: ConnectionGroup | undefined;
    const nextGroups = groups.map(group => {
      if (group.id !== id) {
        return group;
      }
      updatedGroup = { ...group, name: trimmedName, updatedAt: Date.now() };
      return updatedGroup;
    });

    if (!updatedGroup) {
      throw new Error('The selected connection group no longer exists.');
    }

    await this.context.globalState.update(CONNECTION_GROUPS_KEY, normalizeConnectionGroups(nextGroups));
    this.logDebug('Renamed connection group.', { GroupId: id, Name: updatedGroup.name });
    this.logPerformance('Renamed connection group', timer(), { Groups: nextGroups.length });
    return updatedGroup;
  }

  async deleteGroup(groupId: string, deleteConnections = false): Promise<string[]> {
    const timer = createPerformanceTimer();
    const id = String(groupId || '').trim();
    if (!id) {
      throw new Error('Select a connection group to delete.');
    }

    const groups = await this.listGroups();
    const deletedGroup = groups.find(group => group.id === id);
    const nextGroups = groups.filter(group => group.id !== id);
    if (nextGroups.length === groups.length) {
      throw new Error('The selected connection group no longer exists.');
    }

    const storedProfiles = this.context.globalState.get<ConnectionProfile[]>(CONNECTIONS_KEY, []);
    const affectedProfileCount = storedProfiles
      .map(storedProfile => this.normalizeStoredProfile(storedProfile))
      .filter(profile => profile.groupId === id)
      .length;
    const removedProfileIds: string[] = [];
    const nextProfiles = storedProfiles
      .map(storedProfile => this.normalizeStoredProfile(storedProfile))
      .filter(profile => {
        if (profile.groupId !== id) {
          return true;
        }
        if (deleteConnections) {
          removedProfileIds.push(profile.id);
          return false;
        }
        return true;
      })
      .map(profile => {
        if (profile.groupId !== id) {
          return profile;
        }
        const { groupId: _groupId, ...profileWithoutGroup } = profile;
        return { ...profileWithoutGroup, updatedAt: Date.now() };
      });

    await this.context.globalState.update(CONNECTION_GROUPS_KEY, normalizeConnectionGroups(nextGroups));
    await this.context.globalState.update(CONNECTIONS_KEY, nextProfiles);

    if (deleteConnections) {
      await Promise.all(removedProfileIds.flatMap(profileId => [
        this.context.secrets.delete(secretKey(profileId, 'password')),
        this.context.secrets.delete(secretKey(profileId, 'passphrase'))
      ]));
    }

    this.logDebug('Removed connection group.', {
      Group: deletedGroup?.name || id,
      Mode: deleteConnections ? 'deleteConnections' : 'groupOnly',
      Connections: affectedProfileCount
    });
    this.logPerformance('Removed connection group', timer(), {
      Groups: nextGroups.length,
      Connections: affectedProfileCount,
      ConnectionsDeleted: removedProfileIds.length
    });
    return removedProfileIds;
  }

  async listProfiles(): Promise<ConnectionProfile[]> {
    const timer = createPerformanceTimer();
    const storedProfiles = this.context.globalState.get<ConnectionProfile[]>(CONNECTIONS_KEY, []);
    const profiles = await Promise.all(storedProfiles.map(async profile => {
      const normalized = this.normalizeStoredProfile(profile);
      return {
        ...normalized,
        hasSavedPassword: Boolean(await this.context.secrets.get(secretKey(normalized.id, 'password'))),
        hasSavedPassphrase: Boolean(await this.context.secrets.get(secretKey(normalized.id, 'passphrase')))
      };
    }));

    this.logPerformance('Loaded saved connection profiles', timer(), { Profiles: profiles.length });
    return profiles;
  }

  async getProfile(profileId: string): Promise<ConnectionProfile | undefined> {
    const profiles = await this.listProfiles();
    return profiles.find(profile => profile.id === profileId);
  }


  async saveProfile(input: ConnectionProfileInput): Promise<ConnectionProfile> {
    const timer = createPerformanceTimer();
    const profiles = await this.listProfiles();
    const existing = input.id ? profiles.find(profile => profile.id === input.id) : undefined;
    const now = Date.now();

    const host = String(input.host !== undefined ? input.host : existing?.host || '').trim();
    const username = String(input.username !== undefined ? input.username : existing?.username || '').trim();
    const name = resolveProfileName(input.name, existing?.name, host, username);
    const connectionType = normalizeConnectionType(input.connectionType ?? existing?.connectionType ?? DEFAULT_CONNECTION_TYPE);
    const authType = normalizeAuthTypeForConnection(input.authType || existing?.authType || 'password', connectionType);
    const port = normalizePort(input.port ?? existing?.port ?? getDefaultPortForConnectionType(connectionType));
    const startPath = String(input.startPath ?? existing?.startPath ?? '').trim();
    const privateKeyPath = String(input.privateKeyPath ?? existing?.privateKeyPath ?? '').trim();
    const keepAlive = typeof input.keepAlive === 'boolean' ? input.keepAlive : existing?.keepAlive !== false;
    const ftpsAllowSelfSignedCertificate = Boolean(input.ftpsAllowSelfSignedCertificate ?? existing?.ftpsAllowSelfSignedCertificate ?? false);
    const ftpsCaCertificatePath = String(input.ftpsCaCertificatePath ?? existing?.ftpsCaCertificatePath ?? '').trim();
    const groupId = await this.normalizeProfileGroupId(input.groupId ?? existing?.groupId);

    if (!name) {
      throw new Error('Connection name is required.');
    }

    if (!host) {
      throw new Error('Host is required.');
    }


    const profile: ConnectionProfile = {
      id: existing?.id || buildProfileId(name, host, username),
      name,
      host,
      connectionType,
      port,
      username,
      authType,
      startPath,
      privateKeyPath: authType === 'privateKey' ? privateKeyPath : undefined,
      keepAlive,
      ftpsAllowSelfSignedCertificate: connectionType === 'ftps' ? ftpsAllowSelfSignedCertificate : false,
      ftpsCaCertificatePath: connectionType === 'ftps' ? ftpsCaCertificatePath : '',
      favoriteRemotePaths: normalizeFavoriteRemotePaths(existing?.favoriteRemotePaths || []),
      groupId,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    const nextProfiles = existing
      ? profiles.map(item => (item.id === profile.id ? profile : item))
      : [...profiles, profile];

    await this.context.globalState.update(CONNECTIONS_KEY, nextProfiles);

    await this.applyCredentialPreferences(profile.id, authType, input);

    this.logDebug(existing ? 'Updated saved connection profile.' : 'Created saved connection profile.', {
      Profile: profile.name,
      ConnectionType: profile.connectionType,
      GroupId: profile.groupId || 'none'
    });
    this.logPerformance(existing ? 'Updated saved connection profile' : 'Created saved connection profile', timer(), {
      Profiles: nextProfiles.length,
      Groups: (await this.listGroups()).length
    });

    return {
      ...profile,
      hasSavedPassword: Boolean(await this.context.secrets.get(secretKey(profile.id, 'password'))),
      hasSavedPassphrase: Boolean(await this.context.secrets.get(secretKey(profile.id, 'passphrase')))
    };
  }


  async addFavoriteRemotePath(profileId: string, remotePath: string): Promise<ConnectionProfile> {
    return this.updateFavoriteRemotePath(profileId, remotePath, true);
  }

  async removeFavoriteRemotePath(profileId: string, remotePath: string): Promise<ConnectionProfile> {
    return this.updateFavoriteRemotePath(profileId, remotePath, false);
  }



  async renameProfile(profileId: string, name: string): Promise<ConnectionProfile> {
    const timer = createPerformanceTimer();
    const trimmedName = String(name || '').trim();

    if (!profileId) {
      throw new Error('Select a saved connection to rename.');
    }

    if (!trimmedName) {
      throw new Error('Connection name is required.');
    }

    const storedProfiles = this.context.globalState.get<ConnectionProfile[]>(CONNECTIONS_KEY, []);
    let updatedProfile: ConnectionProfile | undefined;

    const nextProfiles = storedProfiles.map(storedProfile => {
      const profile = this.normalizeStoredProfile(storedProfile);

      if (profile.id !== profileId) {
        return profile;
      }

      updatedProfile = {
        ...profile,
        name: trimmedName,
        updatedAt: Date.now()
      };

      return updatedProfile;
    });

    if (!updatedProfile) {
      throw new Error('The selected saved connection no longer exists.');
    }

    await this.context.globalState.update(CONNECTIONS_KEY, nextProfiles);
    this.logDebug('Renamed saved connection profile.', { Profile: updatedProfile.name, ProfileId: profileId });
    this.logPerformance('Renamed saved connection profile', timer(), { Profiles: nextProfiles.length });

    return {
      ...updatedProfile,
      hasSavedPassword: Boolean(await this.context.secrets.get(secretKey(updatedProfile.id, 'password'))),
      hasSavedPassphrase: Boolean(await this.context.secrets.get(secretKey(updatedProfile.id, 'passphrase')))
    };
  }

  async deleteProfile(profileId: string): Promise<void> {
    const timer = createPerformanceTimer();
    const profiles = await this.listProfiles();
    const deletedProfile = profiles.find(profile => profile.id === profileId);
    const nextProfiles = profiles.filter(profile => profile.id !== profileId);

    await this.context.globalState.update(CONNECTIONS_KEY, nextProfiles);
    await this.context.secrets.delete(secretKey(profileId, 'password'));
    await this.context.secrets.delete(secretKey(profileId, 'passphrase'));
    this.logDebug('Deleted saved connection profile.', { Profile: deletedProfile?.name || profileId, Profiles: nextProfiles.length });
    this.logPerformance('Deleted saved connection profile', timer(), { Profiles: nextProfiles.length });
  }

  async moveProfileToGroup(profileId: string, groupId?: string): Promise<ConnectionProfile> {
    const timer = createPerformanceTimer();
    const id = String(profileId || '').trim();
    if (!id) {
      throw new Error('Select a saved connection to move.');
    }

    const normalizedGroupId = await this.normalizeProfileGroupId(groupId);
    const storedProfiles = this.context.globalState.get<ConnectionProfile[]>(CONNECTIONS_KEY, []);
    let updatedProfile: ConnectionProfile | undefined;
    let previousGroupId: string | undefined;

    const nextProfiles = storedProfiles.map(storedProfile => {
      const profile = this.normalizeStoredProfile(storedProfile);

      if (profile.id !== id) {
        return profile;
      }

      previousGroupId = profile.groupId;

      if (normalizedGroupId) {
        updatedProfile = { ...profile, groupId: normalizedGroupId, updatedAt: Date.now() };
        return updatedProfile;
      }

      const { groupId: _groupId, ...profileWithoutGroup } = profile;
      updatedProfile = { ...profileWithoutGroup, updatedAt: Date.now() };
      return updatedProfile;
    });

    if (!updatedProfile) {
      throw new Error('The selected saved connection no longer exists.');
    }

    await this.context.globalState.update(CONNECTIONS_KEY, nextProfiles);
    this.logDebug('Moved saved connection profile to group.', {
      Profile: updatedProfile.name,
      FromGroupId: previousGroupId || 'none',
      ToGroupId: updatedProfile.groupId || 'none'
    });
    this.logPerformance('Moved saved connection profile to group', timer(), { Profiles: nextProfiles.length });

    return {
      ...updatedProfile,
      hasSavedPassword: Boolean(await this.context.secrets.get(secretKey(updatedProfile.id, 'password'))),
      hasSavedPassphrase: Boolean(await this.context.secrets.get(secretKey(updatedProfile.id, 'passphrase')))
    };
  }

  async reorderProfiles(profileIds: string[], groupsByProfileId?: Record<string, string | undefined>): Promise<ConnectionProfile[]> {
    const timer = createPerformanceTimer();
    const requestedIds = Array.isArray(profileIds)
      ? profileIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];

    if (!requestedIds.length) {
      return this.listProfiles();
    }

    const validGroupIds = new Set((await this.listGroups()).map(group => group.id));
    const normalizedGroupsByProfileId = normalizeProfileGroupAssignments(groupsByProfileId || {}, validGroupIds);
    const storedProfiles = this.context.globalState.get<ConnectionProfile[]>(CONNECTIONS_KEY, []);
    const profiles = storedProfiles.map(profile => this.normalizeStoredProfile(profile));
    const profileById = new Map(profiles.map(profile => [profile.id, profile]));
    const nextProfiles: ConnectionProfile[] = [];
    const addedIds = new Set<string>();

    for (const profileId of requestedIds) {
      const profile = profileById.get(profileId);
      if (!profile || addedIds.has(profile.id)) {
        continue;
      }

      nextProfiles.push(applyProfileGroupAssignment(profile, normalizedGroupsByProfileId));
      addedIds.add(profile.id);
    }

    for (const profile of profiles) {
      if (!addedIds.has(profile.id)) {
        nextProfiles.push(applyProfileGroupAssignment(profile, normalizedGroupsByProfileId));
      }
    }

    await this.context.globalState.update(CONNECTIONS_KEY, nextProfiles);
    const affectedGroups = new Set(nextProfiles.map(profile => profile.groupId || 'none')).size;
    this.logDebug('Reordered saved connection profiles.', { Profiles: nextProfiles.length, AffectedGroups: affectedGroups });
    this.logPerformance('Reordered saved connection profiles', timer(), { Profiles: nextProfiles.length, AffectedGroups: affectedGroups });
    return this.listProfiles();
  }


  async buildBackupFile(options: ConnectionBackupExportOptions): Promise<RemoteEditBackupFile> {
    const timer = createPerformanceTimer();
    const includeConnections = Boolean(options.includeConnections);
    const includeCredentials = includeConnections && Boolean(options.includeCredentials);
    const profiles = includeConnections ? await this.listProfiles() : [];
    const connectionGroups = includeConnections ? await this.listGroups() : [];
    const backupConnections = includeConnections
      ? profiles.map(profile => this.toBackupConnection(profile, options))
      : [];

    const persistentStorage = includeConnections ? this.getPersistentWebviewStorageSnapshot() : undefined;

    const backup: RemoteEditBackupFile = {
      remoteEditExportVersion: SUPPORTED_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      extensionVersion: options.extensionVersion || undefined,
      settings: options.includeSettings ? this.exportSettings() : undefined,
      settingsKeys: options.includeSettings ? [...REMOTE_EDIT_SETTING_KEYS] : undefined,
      connections: includeConnections ? backupConnections : undefined,
      connectionGroups: includeConnections ? connectionGroups.map(group => this.toBackupConnectionGroup(group)) : undefined,
      encryptedCredentials: null,
      savedCommands: persistentStorage?.savedCommands,
      serverLogShortcuts: persistentStorage?.serverLogShortcuts,
      portForwards: persistentStorage?.portForwards,
      logViewerFavorites: includeConnections ? this.getLogViewerFavoritesSnapshot() : undefined
    };

    if (includeCredentials) {
      const credentials = await this.collectStoredCredentials(profiles);
      if (Object.keys(credentials).length > 0) {
        const password = String(options.credentialPassword || '');
        if (!password) {
          throw new Error('Export password is required to include encrypted passwords/passphrases.');
        }

        backup.encryptedCredentials = await encryptCredentials(credentials, password);
      }
    }

    this.logDebug('Built Remote Edit backup file.', {
      Settings: Boolean(backup.settings),
      Profiles: backup.connections?.length || 0,
      Groups: backup.connectionGroups?.length || 0,
      Credentials: Boolean(backup.encryptedCredentials)
    });
    this.logPerformance('Built Remote Edit backup file', timer(), {
      Profiles: backup.connections?.length || 0,
      Groups: backup.connectionGroups?.length || 0
    });
    return backup;
  }

  summarizeBackupFile(backup: RemoteEditBackupFile): RemoteEditBackupSummary {
    validateBackupVersion(backup);

    const connections = Array.isArray(backup.connections) ? backup.connections : [];
    const connectionGroups = normalizeBackupConnectionGroups(backup.connectionGroups || []);
    const supportedConnections = connections.filter(connection => isSupportedBackupConnection(connection));

    return {
      hasSettings: Boolean(backup.settings && typeof backup.settings === 'object'),
      connectionCount: connections.length,
      connectionGroupCount: connectionGroups.length,
      supportedConnectionCount: supportedConnections.length,
      unsupportedConnectionCount: Math.max(0, connections.length - supportedConnections.length),
      remotePathFavoriteCount: supportedConnections.reduce((count, connection) => {
        const favorites = Array.isArray(connection.remotePathFavorites) ? connection.remotePathFavorites : [];
        return count + favorites.length;
      }, 0),
      usernamesIncluded: supportedConnections.some(connection => typeof connection.username === 'string' && connection.username.trim().length > 0),
      hasEncryptedCredentials: Boolean(backup.encryptedCredentials),
      savedCommandCount: countCollectionItems(backup.savedCommands),
      serverLogShortcutCount: countCollectionItems(backup.serverLogShortcuts),
      portForwardCount: countCollectionItems(backup.portForwards),
      logViewerFavoriteCount: countCollectionItems(backup.logViewerFavorites)
    };
  }

  async importBackupFile(backup: RemoteEditBackupFile, options: ConnectionBackupImportOptions): Promise<RemoteEditBackupImportResult> {
    const timer = createPerformanceTimer();
    validateBackupVersion(backup);

    if (!options.includeSettings && !options.includeConnections) {
      throw new Error('Select at least one import option.');
    }

    const result: RemoteEditBackupImportResult = {
      settingsImported: false,
      added: 0,
      updated: 0,
      replaced: options.importMode === 'replace' && Boolean(options.includeConnections),
      skippedUnsupported: 0,
      credentialsRestored: 0,
      favoritesImported: 0,
      usernamesImported: 0,
      connectionGroupsImported: 0,
      savedCommandsImported: 0,
      serverLogShortcutsImported: 0,
      portForwardsImported: 0,
      logViewerFavoritesImported: 0
    };

    if (options.includeSettings && backup.settings && typeof backup.settings === 'object') {
      await this.importSettings(backup.settings, Array.isArray(backup.settingsKeys) ? backup.settingsKeys : undefined);
      result.settingsImported = true;
    }

    if (!options.includeConnections) {
      return result;
    }

    const importedGroups = normalizeBackupConnectionGroups(backup.connectionGroups || []);
    const importedGroupIds = new Set(importedGroups.map(group => group.id));
    const normalizedBackupConnections = this.normalizeBackupConnections(backup.connections || [], options);
    const missingGroupReferenceCount = normalizedBackupConnections.filter(profile => profile.groupId && !importedGroupIds.has(profile.groupId)).length;
    const importedConnections = normalizedBackupConnections
      .map(profile => sanitizeProfileGroupId(profile, importedGroupIds));
    result.connectionGroupsImported = importedGroups.length;
    result.skippedUnsupported = Math.max(0, (backup.connections || []).length - importedConnections.length);
    result.favoritesImported = options.includeFavorites
      ? importedConnections.reduce((count, profile) => count + normalizeFavoriteRemotePaths(profile.favoriteRemotePaths || []).length, 0)
      : 0;
    result.usernamesImported = options.includeUsernames
      ? importedConnections.filter(profile => String(profile.username || '').trim().length > 0).length
      : 0;

    const existingProfiles = await this.listProfiles();
    const existingGroups = await this.listGroups();
    const now = Date.now();
    const nextGroups = mergeConnectionGroups(existingGroups, importedGroups, options.importMode, now);
    const nextGroupIds = new Set(nextGroups.map(group => group.id));
    let nextProfiles: ConnectionProfile[];

    if (options.importMode === 'replace') {
      for (const profile of existingProfiles) {
        await this.deleteStoredCredentials(profile.id);
      }

      nextProfiles = importedConnections.map(profile => sanitizeProfileGroupId({
        ...profile,
        createdAt: profile.createdAt || now,
        updatedAt: now
      }, nextGroupIds));
      result.added = nextProfiles.length;
    } else {
      const importedById = new Map(importedConnections.map(profile => [profile.id, profile]));
      nextProfiles = existingProfiles.map(existing => {
        const imported = importedById.get(existing.id);

        if (!imported) {
          return existing;
        }

        result.updated += 1;
        importedById.delete(existing.id);

        return sanitizeProfileGroupId({
          ...existing,
          ...imported,
          username: options.includeUsernames ? imported.username : existing.username,
          favoriteRemotePaths: options.includeFavorites ? imported.favoriteRemotePaths : existing.favoriteRemotePaths,
          createdAt: existing.createdAt || imported.createdAt || now,
          updatedAt: now
        }, nextGroupIds);
      });

      for (const imported of importedById.values()) {
        nextProfiles.push(sanitizeProfileGroupId({
          ...imported,
          createdAt: imported.createdAt || now,
          updatedAt: now
        }, nextGroupIds));
        result.added += 1;
      }
    }

    await this.context.globalState.update(CONNECTION_GROUPS_KEY, nextGroups);
    await this.context.globalState.update(CONNECTIONS_KEY, nextProfiles);

    if (options.restoreCredentials) {
      if (!backup.encryptedCredentials) {
        throw new Error('This backup does not contain encrypted passwords/passphrases.');
      }

      const password = String(options.credentialPassword || '');
      if (!password) {
        throw new Error('Export password is required to restore encrypted passwords/passphrases.');
      }

      const credentials = await decryptCredentials(backup.encryptedCredentials, password);
      const importedIds = new Set(importedConnections.map(profile => profile.id));

      for (const profileId of importedIds) {
        const profileCredentials = credentials[profileId];
        if (!profileCredentials) {
          continue;
        }

        if (profileCredentials.password) {
          await this.context.secrets.store(secretKey(profileId, 'password'), profileCredentials.password);
          result.credentialsRestored += 1;
        }

        if (profileCredentials.passphrase) {
          await this.context.secrets.store(secretKey(profileId, 'passphrase'), profileCredentials.passphrase);
          result.credentialsRestored += 1;
        }
      }
    }

    const persistentResult = await this.importPersistentBackupData(backup, options.importMode);
    result.savedCommandsImported = persistentResult.savedCommandsImported;
    result.serverLogShortcutsImported = persistentResult.serverLogShortcutsImported;
    result.portForwardsImported = persistentResult.portForwardsImported;
    result.logViewerFavoritesImported = persistentResult.logViewerFavoritesImported;

    this.logDebug('Imported Remote Edit backup file.', {
      Mode: options.importMode,
      Added: result.added,
      Updated: result.updated,
      Groups: result.connectionGroupsImported,
      MissingGroupReferences: missingGroupReferenceCount,
      SkippedUnsupported: result.skippedUnsupported
    });
    this.logPerformance('Imported Remote Edit backup file', timer(), {
      Added: result.added,
      Updated: result.updated,
      Groups: result.connectionGroupsImported
    });

    return result;
  }

  private toBackupConnection(profile: ConnectionProfile, options: ConnectionBackupExportOptions): RemoteEditBackupConnection {
    const backupConnection: RemoteEditBackupConnection = {
      id: profile.id,
      connectionType: profile.connectionType || DEFAULT_CONNECTION_TYPE,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      authType: profile.authType,
      startPath: profile.startPath || '',
      privateKeyPath: profile.authType === 'privateKey' ? profile.privateKeyPath || '' : undefined,
      keepAlive: profile.keepAlive !== false,
      ftpsAllowSelfSignedCertificate: profile.connectionType === 'ftps' ? Boolean(profile.ftpsAllowSelfSignedCertificate) : undefined,
      ftpsCaCertificatePath: profile.connectionType === 'ftps' ? String(profile.ftpsCaCertificatePath || '').trim() : undefined,
      groupId: profile.groupId || undefined,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    };

    if (options.includeUsernames) {
      backupConnection.username = profile.username || '';
    }

    if (options.includeFavorites) {
      backupConnection.remotePathFavorites = normalizeFavoriteRemotePaths(profile.favoriteRemotePaths || []);
    }

    return backupConnection;
  }

  private toBackupConnectionGroup(group: ConnectionGroup): RemoteEditBackupConnectionGroup {
    return {
      id: group.id,
      name: group.name,
      order: group.order,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt
    };
  }

  private exportSettings(): Record<string, unknown> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const settings: Record<string, unknown> = {};

    for (const key of REMOTE_EDIT_SETTING_KEYS) {
      settings[key] = getSettingValueWithLegacyFallback(config, String(key));
    }

    return settings;
  }

  private async importSettings(settings: Record<string, unknown>, settingsKeys?: string[]): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const normalizedSettings = normalizeImportedSettingValues(settings);
    const normalizedSettingsKeys = Array.isArray(settingsKeys)
      ? normalizeImportedSettingKeys(settingsKeys)
      : undefined;

    if (
      !Object.prototype.hasOwnProperty.call(normalizedSettings, 'statusBarButtonPosition') &&
      (Object.prototype.hasOwnProperty.call(normalizedSettings, 'showStatusBarButton') ||
        Object.prototype.hasOwnProperty.call(normalizedSettings, 'statusBarButtonAlignment'))
    ) {
      const showStatusBarButton = normalizedSettings.showStatusBarButton !== false;
      const statusBarButtonAlignment = normalizedSettings.statusBarButtonAlignment === 'right' ? 'right' : 'left';
      normalizedSettings.statusBarButtonPosition = showStatusBarButton ? statusBarButtonAlignment : 'hidden';
      if (normalizedSettingsKeys && !normalizedSettingsKeys.includes('statusBarButtonPosition')) {
        normalizedSettingsKeys.push('statusBarButtonPosition');
      }
    }

    const keysToApply = normalizedSettingsKeys && normalizedSettingsKeys.length > 0
      ? normalizedSettingsKeys
      : Object.keys(normalizedSettings).filter(key => isExportableSettingKey(key));

    for (const key of keysToApply) {
      const defaultValue = REMOTE_EDIT_SETTING_DEFAULTS[key as keyof typeof REMOTE_EDIT_SETTING_DEFAULTS];
      const importedValue = Object.prototype.hasOwnProperty.call(normalizedSettings, key)
        ? normalizedSettings[key]
        : defaultValue;

      await config.update(
        key,
        areSettingValuesEqual(importedValue, defaultValue) ? undefined : importedValue,
        vscode.ConfigurationTarget.Global
      );

      for (const legacyKey of CANONICAL_SETTING_KEY_LEGACY_ALIASES[String(key)] || []) {
        await config.update(legacyKey, undefined, vscode.ConfigurationTarget.Global);
      }
    }
  }

  getPersistentWebviewStorageSnapshot(): RemoteEditPersistentWebviewStorage {
    return {
      savedCommands: normalizePersistentObject(this.context.globalState.get<Record<string, unknown[]>>(SAVED_REMOTE_COMMANDS_KEY, {})),
      serverLogShortcuts: normalizePersistentObject(this.context.globalState.get<Record<string, unknown[]>>(SERVER_LOG_SHORTCUTS_KEY, {})),
      portForwards: normalizePersistentObject(this.context.globalState.get<Record<string, unknown[]>>(SERVER_PORT_FORWARDS_KEY, {}))
    };
  }

  async syncPersistentWebviewStorageSnapshot(
    snapshot: RemoteEditPersistentWebviewStorage,
    options?: { migrationOnly?: boolean }
  ): Promise<RemoteEditPersistentWebviewStorage> {
    await this.syncPersistentCollection(SAVED_REMOTE_COMMANDS_KEY, snapshot.savedCommands, options);
    await this.syncPersistentCollection(SERVER_LOG_SHORTCUTS_KEY, snapshot.serverLogShortcuts, options);
    await this.syncPersistentCollection(SERVER_PORT_FORWARDS_KEY, snapshot.portForwards, options);
    return this.getPersistentWebviewStorageSnapshot();
  }

  private async syncPersistentCollection(
    key: string,
    incoming: Record<string, unknown[]> | undefined,
    options?: { migrationOnly?: boolean }
  ): Promise<void> {
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return;
    }

    const normalizedIncoming = normalizePersistentObject(incoming);
    if (!Object.keys(normalizedIncoming).length) {
      return;
    }

    if (options?.migrationOnly) {
      const existing = normalizePersistentObject(this.context.globalState.get<Record<string, unknown[]>>(key, {}));
      if (Object.keys(existing).length) {
        return;
      }
    }

    await this.context.globalState.update(key, normalizedIncoming);
  }

  private getLogViewerFavoritesSnapshot(): Record<string, string[]> {
    return normalizeStringCollection(this.context.globalState.get<Record<string, string[]>>(LOG_VIEWER_FAVORITES_KEY, {}));
  }

  private async importPersistentBackupData(backup: RemoteEditBackupFile, importMode: RemoteEditImportMode): Promise<{
    savedCommandsImported: number;
    serverLogShortcutsImported: number;
    portForwardsImported: number;
    logViewerFavoritesImported: number;
  }> {
    const savedCommandsImported = await this.importPersistentCollection(SAVED_REMOTE_COMMANDS_KEY, backup, 'savedCommands', importMode);
    const serverLogShortcutsImported = await this.importPersistentCollection(SERVER_LOG_SHORTCUTS_KEY, backup, 'serverLogShortcuts', importMode);
    const portForwardsImported = await this.importPersistentCollection(SERVER_PORT_FORWARDS_KEY, backup, 'portForwards', importMode);
    const logViewerFavoritesImported = await this.importStringCollection(LOG_VIEWER_FAVORITES_KEY, backup, 'logViewerFavorites', importMode);

    return { savedCommandsImported, serverLogShortcutsImported, portForwardsImported, logViewerFavoritesImported };
  }

  private async importPersistentCollection(
    storageKey: string,
    backup: RemoteEditBackupFile,
    backupKey: 'savedCommands' | 'serverLogShortcuts' | 'portForwards',
    importMode: RemoteEditImportMode
  ): Promise<number> {
    if (!Object.prototype.hasOwnProperty.call(backup, backupKey)) {
      return 0;
    }

    const imported = normalizePersistentObject(backup[backupKey]);
    const next = importMode === 'replace'
      ? imported
      : {
        ...normalizePersistentObject(this.context.globalState.get<Record<string, unknown[]>>(storageKey, {})),
        ...imported
      };

    await this.context.globalState.update(storageKey, next);
    return countCollectionItems(imported);
  }

  private async importStringCollection(
    storageKey: string,
    backup: RemoteEditBackupFile,
    backupKey: 'logViewerFavorites',
    importMode: RemoteEditImportMode
  ): Promise<number> {
    if (!Object.prototype.hasOwnProperty.call(backup, backupKey)) {
      return 0;
    }

    const imported = normalizeStringCollection(backup[backupKey]);
    const next = importMode === 'replace'
      ? imported
      : {
        ...normalizeStringCollection(this.context.globalState.get<Record<string, string[]>>(storageKey, {})),
        ...imported
      };

    await this.context.globalState.update(storageKey, next);
    return countCollectionItems(imported);
  }

  private normalizeBackupConnections(connections: RemoteEditBackupConnection[], options: ConnectionBackupImportOptions): ConnectionProfile[] {
    const normalizedProfiles: ConnectionProfile[] = [];
    const seenIds = new Set<string>();

    for (const connection of connections) {
      if (!isSupportedBackupConnection(connection)) {
        continue;
      }

      const id = String(connection.id || '').trim();
      const host = String(connection.host || '').trim();
      const name = String(connection.name || '').trim() || buildDefaultProfileName(host, String(connection.username || '').trim());

      if (!id || !host || seenIds.has(id)) {
        continue;
      }

      seenIds.add(id);

      const connectionType = normalizeConnectionType(connection.connectionType);
      const authType = normalizeAuthTypeForConnection(String(connection.authType || 'password'), connectionType);
      const privateKeyPath = String(connection.privateKeyPath || '').trim();
      const profile: ConnectionProfile = {
        id,
        name,
        host,
        connectionType,
        port: normalizePort(connection.port || getDefaultPortForConnectionType(connectionType)),
        username: options.includeUsernames ? String(connection.username || '').trim() : '',
        authType,
        startPath: String(connection.startPath || '').trim(),
        privateKeyPath: authType === 'privateKey' ? privateKeyPath : undefined,
        keepAlive: connection.keepAlive !== false,
        ftpsAllowSelfSignedCertificate: connectionType === 'ftps' ? Boolean(connection.ftpsAllowSelfSignedCertificate) : false,
        ftpsCaCertificatePath: connectionType === 'ftps' ? String(connection.ftpsCaCertificatePath || '').trim() : '',
        favoriteRemotePaths: options.includeFavorites ? normalizeFavoriteRemotePaths(connection.remotePathFavorites || []) : [],
        groupId: String(connection.groupId || '').trim() || undefined,
        createdAt: Number(connection.createdAt || Date.now()),
        updatedAt: Number(connection.updatedAt || Date.now())
      };

      normalizedProfiles.push(profile);
    }

    return normalizedProfiles;
  }

  private async collectStoredCredentials(profiles: ConnectionProfile[]): Promise<StoredCredentialMap> {
    const credentials: StoredCredentialMap = {};

    for (const profile of profiles) {
      const password = await this.context.secrets.get(secretKey(profile.id, 'password'));
      const passphrase = await this.context.secrets.get(secretKey(profile.id, 'passphrase'));

      if (password || passphrase) {
        credentials[profile.id] = {};

        if (password) {
          credentials[profile.id].password = password;
        }

        if (passphrase) {
          credentials[profile.id].passphrase = passphrase;
        }
      }
    }

    return credentials;
  }

  private async deleteStoredCredentials(profileId: string): Promise<void> {
    await this.context.secrets.delete(secretKey(profileId, 'password'));
    await this.context.secrets.delete(secretKey(profileId, 'passphrase'));
  }

  private async updateFavoriteRemotePath(profileId: string, remotePath: string, shouldAdd: boolean): Promise<ConnectionProfile> {
    const normalizedPath = normalizeFavoriteRemotePath(remotePath);

    if (!normalizedPath) {
      throw new Error('Remote path is required.');
    }

    const storedProfiles = this.context.globalState.get<ConnectionProfile[]>(CONNECTIONS_KEY, []);
    let updatedProfile: ConnectionProfile | undefined;

    const nextProfiles = storedProfiles.map(storedProfile => {
      const profile = this.normalizeStoredProfile(storedProfile);

      if (profile.id !== profileId) {
        return profile;
      }

      const favoriteRemotePaths = normalizeFavoriteRemotePaths(profile.favoriteRemotePaths || []);
      const existingIndex = favoriteRemotePaths.indexOf(normalizedPath);

      if (shouldAdd && existingIndex === -1) {
        favoriteRemotePaths.push(normalizedPath);
      }

      if (!shouldAdd && existingIndex !== -1) {
        favoriteRemotePaths.splice(existingIndex, 1);
      }

      updatedProfile = {
        ...profile,
        favoriteRemotePaths,
        updatedAt: Date.now()
      };

      return updatedProfile;
    });

    if (!updatedProfile) {
      throw new Error('Save this connection to use remote path favorites.');
    }

    await this.context.globalState.update(CONNECTIONS_KEY, nextProfiles);
    return {
      ...updatedProfile,
      hasSavedPassword: Boolean(await this.context.secrets.get(secretKey(updatedProfile.id, 'password'))),
      hasSavedPassphrase: Boolean(await this.context.secrets.get(secretKey(updatedProfile.id, 'passphrase')))
    };
  }

  async buildConnectOptions(input: ConnectionProfileInput): Promise<ConnectOptions> {
    const profile = input.id ? await this.getProfile(input.id) : undefined;

    const host = String(input.host || profile?.host || '').trim();
    const username = String(input.username || profile?.username || '').trim();
    const name = resolveProfileName(input.name, profile?.name, host, username);
    const connectionType = normalizeConnectionType(input.connectionType ?? profile?.connectionType ?? DEFAULT_CONNECTION_TYPE);
    const authType = normalizeAuthTypeForConnection(input.authType || profile?.authType || 'password', connectionType);
    const port = normalizePort(input.port ?? profile?.port ?? getDefaultPortForConnectionType(connectionType));
    const startPath = String(input.startPath ?? profile?.startPath ?? '').trim();
    const privateKeyPath = String(input.privateKeyPath ?? profile?.privateKeyPath ?? '').trim();
    const connectionId = profile?.id || buildProfileId(name || buildDefaultProfileName(host, username), host, username);
    const keepAlive = typeof input.keepAlive === 'boolean' ? input.keepAlive : profile?.keepAlive !== false;
    const ftpsAllowSelfSignedCertificate = Boolean(input.ftpsAllowSelfSignedCertificate ?? profile?.ftpsAllowSelfSignedCertificate ?? false);
    const ftpsCaCertificatePath = String(input.ftpsCaCertificatePath ?? profile?.ftpsCaCertificatePath ?? '').trim();

    if (!host) {
      throw new Error('Host is required.');
    }

    if (!username) {
      throw new Error('Username is required to connect. It can be omitted from the saved profile, but must be entered before connecting.');
    }

    let password = typeof input.password === 'string' ? input.password : '';
    let passphrase = typeof input.passphrase === 'string' ? input.passphrase : '';

    if (!password && profile?.id) {
      password = await this.context.secrets.get(secretKey(profile.id, 'password')) || '';
    }

    if (!passphrase && profile?.id) {
      passphrase = await this.context.secrets.get(secretKey(profile.id, 'passphrase')) || '';
    }

    if (authType === 'password' && !password) {
      throw new Error('Password is required for password authentication. Enter it or save it in the connection profile.');
    }

    if (connectionType === SFTP_CONNECTION_TYPE && authType === 'privateKey' && !privateKeyPath) {
      throw new Error('Private key path is required for private key authentication.');
    }

    validateFtpsCaCertificateRequirement(connectionType, ftpsAllowSelfSignedCertificate, ftpsCaCertificatePath);

    return {
      connectionId,
      name,
      host,
      connectionType,
      port,
      username,
      authType,
      password: authType === 'password' ? password : undefined,
      privateKeyPath: authType === 'privateKey' ? privateKeyPath : undefined,
      passphrase: authType === 'privateKey' && passphrase ? passphrase : undefined,
      startPath,
      keepAlive,
      ftpsAllowSelfSignedCertificate: connectionType === 'ftps' ? ftpsAllowSelfSignedCertificate : false,
      ftpsCaCertificatePath: connectionType === 'ftps' ? ftpsCaCertificatePath : undefined,
      isQuickConnect: !profile?.id
    };
  }


  async applyCredentialPreferences(profileId: string, authType: AuthType, input: ConnectionProfileInput): Promise<void> {
    const password = typeof input.password === 'string' ? input.password : '';
    const passphrase = typeof input.passphrase === 'string' ? input.passphrase : '';
    const rememberPassword = Boolean(input.rememberPassword);
    const rememberPassphrase = Boolean(input.rememberPassphrase);

    if (authType === 'password') {
      if (password) {
        if (rememberPassword) {
          await this.context.secrets.store(secretKey(profileId, 'password'), password);
        } else {
          await this.context.secrets.delete(secretKey(profileId, 'password'));
        }
      } else if (!rememberPassword) {
        await this.context.secrets.delete(secretKey(profileId, 'password'));
      }

      await this.context.secrets.delete(secretKey(profileId, 'passphrase'));
      return;
    }

    await this.context.secrets.delete(secretKey(profileId, 'password'));

    if (passphrase) {
      if (rememberPassphrase) {
        await this.context.secrets.store(secretKey(profileId, 'passphrase'), passphrase);
      } else {
        await this.context.secrets.delete(secretKey(profileId, 'passphrase'));
      }
    } else if (!rememberPassphrase) {
      await this.context.secrets.delete(secretKey(profileId, 'passphrase'));
    }
  }

  private async normalizeProfileGroupId(value: string | undefined): Promise<string | undefined> {
    const groupId = String(value || '').trim();
    if (!groupId) {
      return undefined;
    }

    const groups = await this.listGroups();
    return groups.some(group => group.id === groupId) ? groupId : undefined;
  }

  private normalizeStoredProfile(profile: ConnectionProfile): ConnectionProfile {
    return {
      ...profile,
      connectionType: normalizeConnectionType(profile.connectionType),
      port: normalizePort(profile.port || getDefaultPortForConnectionType(profile.connectionType)),
      authType: normalizeAuthTypeForConnection(profile.authType, profile.connectionType),
      startPath: profile.startPath || '',
      keepAlive: profile.keepAlive !== false,
      ftpsAllowSelfSignedCertificate: normalizeConnectionType(profile.connectionType) === 'ftps' ? Boolean(profile.ftpsAllowSelfSignedCertificate) : false,
      ftpsCaCertificatePath: normalizeConnectionType(profile.connectionType) === 'ftps' ? String(profile.ftpsCaCertificatePath || '').trim() : '',
      favoriteRemotePaths: normalizeFavoriteRemotePaths(profile.favoriteRemotePaths || []),
      groupId: String(profile.groupId || '').trim() || undefined,
      createdAt: Number(profile.createdAt || Date.now()),
      updatedAt: Number(profile.updatedAt || Date.now())
    };
  }

  private logDebug(message: string, details?: Record<string, string | number | boolean | undefined | null>): void {
    appendDebugLog(this.output, 'Profiles', message, details);
  }

  private logPerformance(message: string, elapsedMs: number, details?: Record<string, string | number | boolean | undefined | null>): void {
    appendPerformanceLog(this.output, 'Profiles', `${message} in ${elapsedMs}ms`, details);
  }
}


function normalizeGroupName(value: string): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeConnectionGroups(groups: ConnectionGroup[] | RemoteEditBackupConnectionGroup[]): ConnectionGroup[] {
  const normalizedGroups: ConnectionGroup[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const now = Date.now();

  for (const rawGroup of groups || []) {
    const name = normalizeGroupName(rawGroup?.name || '');
    if (!name) {
      continue;
    }

    const id = String(rawGroup?.id || '').trim() || buildGroupId(name);
    const nameKey = name.toLowerCase();
    if (!id || seenIds.has(id) || seenNames.has(nameKey)) {
      continue;
    }

    const orderValue = Number(rawGroup?.order);
    normalizedGroups.push({
      id,
      name,
      order: Number.isFinite(orderValue) ? orderValue : normalizedGroups.length,
      createdAt: Number(rawGroup?.createdAt || now),
      updatedAt: Number(rawGroup?.updatedAt || now)
    });
    seenIds.add(id);
    seenNames.add(nameKey);
  }

  return normalizedGroups
    .sort((a, b) => {
      const nameCompare = String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
      return nameCompare || String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true, sensitivity: 'base' });
    })
    .map((group, index) => ({ ...group, order: index }));
}

function normalizeBackupConnectionGroups(groups: RemoteEditBackupConnectionGroup[]): ConnectionGroup[] {
  return normalizeConnectionGroups(groups || []);
}

function mergeConnectionGroups(
  existingGroups: ConnectionGroup[],
  importedGroups: ConnectionGroup[],
  importMode: RemoteEditImportMode,
  now: number
): ConnectionGroup[] {
  if (importMode === 'replace') {
    return normalizeConnectionGroups(importedGroups.map(group => ({ ...group, updatedAt: now })));
  }

  const importedById = new Map(importedGroups.map(group => [group.id, group]));
  const nextGroups = existingGroups.map(existing => {
    const imported = importedById.get(existing.id);
    if (!imported) {
      return existing;
    }

    importedById.delete(existing.id);
    return {
      ...existing,
      ...imported,
      createdAt: existing.createdAt || imported.createdAt || now,
      updatedAt: now
    };
  });

  for (const imported of importedById.values()) {
    nextGroups.push({
      ...imported,
      createdAt: imported.createdAt || now,
      updatedAt: now
    });
  }

  return normalizeConnectionGroups(nextGroups);
}

function sanitizeProfileGroupId<T extends ConnectionProfile>(profile: T, validGroupIds: Set<string>): T {
  const groupId = String(profile.groupId || '').trim();
  if (!groupId || !validGroupIds.has(groupId)) {
    const { groupId: _groupId, ...withoutGroup } = profile;
    return withoutGroup as T;
  }

  return { ...profile, groupId };
}

function normalizeProfileGroupAssignments(assignments: Record<string, string | undefined>, validGroupIds: Set<string>): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [profileId, rawGroupId] of Object.entries(assignments || {})) {
    const id = String(profileId || '').trim();
    if (!id) {
      continue;
    }

    const groupId = String(rawGroupId || '').trim();
    normalized[id] = groupId && validGroupIds.has(groupId) ? groupId : '';
  }

  return normalized;
}

function applyProfileGroupAssignment(profile: ConnectionProfile, assignments: Record<string, string>): ConnectionProfile {
  if (!Object.prototype.hasOwnProperty.call(assignments, profile.id)) {
    return profile;
  }

  const groupId = assignments[profile.id];
  if (!groupId) {
    const { groupId: _groupId, ...withoutGroup } = profile;
    return { ...withoutGroup, updatedAt: Date.now() };
  }

  return { ...profile, groupId, updatedAt: Date.now() };
}

function validateFtpsCaCertificateRequirement(connectionType: RemoteConnectionType | string | undefined, allowSelfSignedCertificate: boolean, caCertificatePath: string | undefined): void {
  if (normalizeConnectionType(connectionType) === 'ftps' && !allowSelfSignedCertificate && !String(caCertificatePath || '').trim()) {
    throw new Error(FTPS_CA_CERTIFICATE_REQUIRED_MESSAGE);
  }
}

function normalizeFavoriteRemotePaths(values: string[]): string[] {
  const favoriteRemotePaths: string[] = [];

  for (const value of values || []) {
    const normalizedPath = normalizeFavoriteRemotePath(value);

    if (normalizedPath && !favoriteRemotePaths.includes(normalizedPath)) {
      favoriteRemotePaths.push(normalizedPath);
    }
  }

  return favoriteRemotePaths;
}

function normalizeFavoriteRemotePath(value: string): string {
  const trimmed = String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');

  if (!trimmed) {
    return '';
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function normalizePort(value: number | string | undefined): number {
  const port = Number(value || 22);

  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error('Port must be a number between 1 and 65535.');
  }

  return port;
}

function normalizeAuthType(value: string | undefined): AuthType {
  return value === 'privateKey' ? 'privateKey' : 'password';
}

function normalizeAuthTypeForConnection(value: string | undefined, connectionType: RemoteConnectionType | string | undefined): AuthType {
  return normalizeConnectionType(connectionType) === SFTP_CONNECTION_TYPE ? normalizeAuthType(value) : 'password';
}

function resolveProfileName(
  inputName: string | undefined,
  existingName: string | undefined,
  host: string,
  username: string
): string {
  if (typeof inputName === 'string') {
    const trimmedInputName = inputName.trim();
    return trimmedInputName || buildDefaultProfileName(host, username);
  }

  return String(existingName || buildDefaultProfileName(host, username)).trim();
}

function buildDefaultProfileName(host: string, username: string): string {
  const hostName = buildHostNameLabel(host);

  if (username && hostName) {
    return `${username}@${hostName}`;
  }

  return hostName || username || 'New connection';
}

function buildHostNameLabel(host: string): string {
  const trimmedHost = String(host || '').trim();

  if (!trimmedHost) {
    return '';
  }

  return trimmedHost.split('.')[0] || trimmedHost;
}

function buildProfileId(name: string, host: string, username: string): string {
  const base = `${name || username || 'connection'}-${host || 'host'}-${username || 'user'}`
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'remoteedit-connection';

  return `${base}-${Date.now().toString(36)}`;
}

function buildGroupId(name: string): string {
  const base = String(name || 'group')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'connection-group';

  return `${base}-${Date.now().toString(36)}`;
}



function isExportableSettingKey(key: string): key is keyof typeof REMOTE_EDIT_SETTING_DEFAULTS {
  return Object.prototype.hasOwnProperty.call(REMOTE_EDIT_SETTING_DEFAULTS, key);
}

function getCanonicalSettingKey(key: string): keyof typeof REMOTE_EDIT_SETTING_DEFAULTS | undefined {
  const normalizedKey = String(key || '').trim();

  if (isExportableSettingKey(normalizedKey)) {
    return normalizedKey;
  }

  return LEGACY_SETTING_KEY_ALIASES[normalizedKey];
}

function normalizeImportedSettingValues(settings: Record<string, unknown>): Record<string, unknown> {
  const normalizedSettings: Record<string, unknown> = {};

  for (const [rawKey, value] of Object.entries(settings)) {
    const normalizedKey = String(rawKey || '').trim();
    const canonicalKey = getCanonicalSettingKey(normalizedKey);

    if (!canonicalKey) {
      continue;
    }

    if (isExportableSettingKey(normalizedKey) || !Object.prototype.hasOwnProperty.call(normalizedSettings, canonicalKey)) {
      normalizedSettings[canonicalKey] = value;
    }
  }

  return normalizedSettings;
}

function normalizeImportedSettingKeys(settingsKeys: string[]): string[] {
  const normalizedKeys: string[] = [];
  const seen = new Set<string>();

  for (const rawKey of settingsKeys) {
    const canonicalKey = getCanonicalSettingKey(String(rawKey || '').trim());

    if (!canonicalKey || seen.has(canonicalKey)) {
      continue;
    }

    normalizedKeys.push(canonicalKey);
    seen.add(canonicalKey);
  }

  return normalizedKeys;
}

function getSettingValueWithLegacyFallback(config: vscode.WorkspaceConfiguration, key: string): unknown {
  if (hasConfiguredSetting(config, key)) {
    return config.get(key);
  }

  for (const legacyKey of CANONICAL_SETTING_KEY_LEGACY_ALIASES[key] || []) {
    if (hasConfiguredSetting(config, legacyKey)) {
      return config.get(legacyKey);
    }
  }

  return config.get(key);
}

function hasConfiguredSetting(config: vscode.WorkspaceConfiguration, key: string): boolean {
  const inspected = config.inspect(key) as { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown } | undefined;

  return inspected?.globalValue !== undefined || inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined;
}

function areSettingValuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizePersistentObject(value: unknown): Record<string, unknown[]> {
  const normalized: Record<string, unknown[]> = {};

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return normalized;
  }

  for (const [key, items] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || !Array.isArray(items)) {
      continue;
    }

    normalized[normalizedKey] = items
      .filter(item => item && typeof item === 'object')
      .map(item => ({ ...(item as Record<string, unknown>) }));
  }

  return normalized;
}

function normalizeStringCollection(value: unknown): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return normalized;
  }

  for (const [key, items] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || !Array.isArray(items)) {
      continue;
    }

    const seen = new Set<string>();
    normalized[normalizedKey] = items
      .map(item => String(item || '').trim())
      .filter(item => {
        if (!item || seen.has(item)) {
          return false;
        }
        seen.add(item);
        return true;
      });
  }

  return normalized;
}

function countCollectionItems(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 0;
  }

  return Object.values(value as Record<string, unknown>).reduce<number>((count, items) => {
    return count + (Array.isArray(items) ? items.length : 0);
  }, 0);
}

function validateBackupVersion(backup: RemoteEditBackupFile): void {
  const version = Number(backup?.remoteEditExportVersion || 0);

  if (!version) {
    throw new Error('Invalid Remote Edit backup file.');
  }

  if (version > SUPPORTED_BACKUP_VERSION) {
    throw new Error(`This backup was created by a newer Remote Edit export format (version ${version}).`);
  }
}

function isSupportedBackupConnection(connection: RemoteEditBackupConnection): boolean {
  if (!connection || typeof connection !== 'object') {
    return false;
  }

  return isKnownConnectionType(connection.connectionType);
}

async function encryptCredentials(credentials: StoredCredentialMap, password: string): Promise<RemoteEditEncryptedCredentials> {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveBackupKey(password, salt, SCRYPT_PARAMS);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.from(JSON.stringify(credentials), 'utf8');
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    kdf: 'scrypt',
    kdfParams: {
      salt: salt.toString('base64'),
      keyLength: SCRYPT_PARAMS.keyLength,
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p
    },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64')
  };
}

async function decryptCredentials(encryptedCredentials: RemoteEditEncryptedCredentials, password: string): Promise<StoredCredentialMap> {
  if (!encryptedCredentials || encryptedCredentials.version !== 1 || encryptedCredentials.kdf !== 'scrypt' || encryptedCredentials.cipher !== 'aes-256-gcm') {
    throw new Error('Unsupported encrypted passwords/passphrases format.');
  }

  try {
    const salt = Buffer.from(encryptedCredentials.kdfParams.salt, 'base64');
    const iv = Buffer.from(encryptedCredentials.iv, 'base64');
    const authTag = Buffer.from(encryptedCredentials.authTag, 'base64');
    const data = Buffer.from(encryptedCredentials.data, 'base64');
    const key = await deriveBackupKey(password, salt, encryptedCredentials.kdfParams);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString('utf8')) as StoredCredentialMap;

    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    throw new Error('Could not restore saved passwords/passphrases. Check the export password and try again.');
  }
}

async function deriveBackupKey(
  password: string,
  salt: Buffer,
  params: { keyLength: number; N: number; r: number; p: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, params.keyLength, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: 64 * 1024 * 1024
    }, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(key);
    });
  });
}

function secretKey(profileId: string, field: 'password' | 'passphrase'): string {
  return `${SECRET_PREFIX}.${profileId}.${field}`;
}
