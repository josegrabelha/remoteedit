import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ConnectOptions } from '../ssh/SftpSessionManager';

export type AuthType = 'password' | 'privateKey';

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  startPath: string;
  privateKeyPath?: string;
  hasSavedPassword?: boolean;
  hasSavedPassphrase?: boolean;
  keepAlive: boolean;
  favoriteRemotePaths?: string[];
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
  connectionType: 'sftp' | string;
  name: string;
  host: string;
  port: number;
  username?: string;
  authType: AuthType;
  startPath: string;
  privateKeyPath?: string;
  keepAlive: boolean;
  remotePathFavorites?: string[];
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

export interface RemoteEditBackupFile {
  remoteEditExportVersion: number;
  exportedAt: string;
  extensionVersion?: string;
  settings?: Record<string, unknown>;
  connections?: RemoteEditBackupConnection[];
  encryptedCredentials?: RemoteEditEncryptedCredentials | null;
}

export interface RemoteEditBackupSummary {
  hasSettings: boolean;
  connectionCount: number;
  supportedConnectionCount: number;
  unsupportedConnectionCount: number;
  remotePathFavoriteCount: number;
  usernamesIncluded: boolean;
  hasEncryptedCredentials: boolean;
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
}

interface StoredCredentialMap {
  [profileId: string]: {
    password?: string;
    passphrase?: string;
  };
}

const CONFIG_SECTION = 'remoteedit';
const SUPPORTED_BACKUP_VERSION = 1;
const SFTP_CONNECTION_TYPE = 'sftp';
const REMOTE_EDIT_SETTING_KEYS = [
  'showStatusBarButton',
  'statusBarButtonStyle',
  'statusBarButtonAlignment',
  'statusBarButtonPriority',
  'sshReadyTimeout',
  'sshKeepAliveInterval',
  'sshKeepAliveCountMax',
  'sudoTempDirectory',
  'restoreSpecialPermissionBits'
] as const;
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
  startPath?: string;
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  rememberPassword?: boolean;
  rememberPassphrase?: boolean;
  keepAlive?: boolean;
}

const CONNECTIONS_KEY = 'remoteedit.connectionProfiles';
const SECRET_PREFIX = 'remoteedit.connectionSecret';

export class ConnectionManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async listProfiles(): Promise<ConnectionProfile[]> {
    const storedProfiles = this.context.globalState.get<ConnectionProfile[]>(CONNECTIONS_KEY, []);
    const profiles = await Promise.all(storedProfiles.map(async profile => {
      const normalized = this.normalizeStoredProfile(profile);
      return {
        ...normalized,
        hasSavedPassword: Boolean(await this.context.secrets.get(secretKey(normalized.id, 'password'))),
        hasSavedPassphrase: Boolean(await this.context.secrets.get(secretKey(normalized.id, 'passphrase')))
      };
    }));

    return profiles.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getProfile(profileId: string): Promise<ConnectionProfile | undefined> {
    const profiles = await this.listProfiles();
    return profiles.find(profile => profile.id === profileId);
  }

  async saveProfile(input: ConnectionProfileInput): Promise<ConnectionProfile> {
    const profiles = await this.listProfiles();
    const existing = input.id ? profiles.find(profile => profile.id === input.id) : undefined;
    const now = Date.now();

    const host = String(input.host !== undefined ? input.host : existing?.host || '').trim();
    const username = String(input.username !== undefined ? input.username : existing?.username || '').trim();
    const name = resolveProfileName(input.name, existing?.name, host, username);
    const authType = normalizeAuthType(input.authType || existing?.authType || 'password');
    const port = normalizePort(input.port ?? existing?.port ?? 22);
    const startPath = String(input.startPath ?? existing?.startPath ?? '').trim();
    const privateKeyPath = String(input.privateKeyPath ?? existing?.privateKeyPath ?? '').trim();
    const keepAlive = typeof input.keepAlive === 'boolean' ? input.keepAlive : existing?.keepAlive !== false;

    if (!name) {
      throw new Error('Connection name is required.');
    }

    if (!host) {
      throw new Error('Host is required.');
    }


    if (authType === 'privateKey' && !privateKeyPath) {
      throw new Error('Private key path is required for private key authentication.');
    }

    const profile: ConnectionProfile = {
      id: existing?.id || buildProfileId(name, host, username),
      name,
      host,
      port,
      username,
      authType,
      startPath,
      privateKeyPath: authType === 'privateKey' ? privateKeyPath : undefined,
      keepAlive,
      favoriteRemotePaths: normalizeFavoriteRemotePaths(existing?.favoriteRemotePaths || []),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    const nextProfiles = existing
      ? profiles.map(item => (item.id === profile.id ? profile : item))
      : [...profiles, profile];

    await this.context.globalState.update(CONNECTIONS_KEY, nextProfiles);

    await this.applyCredentialPreferences(profile.id, authType, input);

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

    return {
      ...updatedProfile,
      hasSavedPassword: Boolean(await this.context.secrets.get(secretKey(updatedProfile.id, 'password'))),
      hasSavedPassphrase: Boolean(await this.context.secrets.get(secretKey(updatedProfile.id, 'passphrase')))
    };
  }

  async deleteProfile(profileId: string): Promise<void> {
    const profiles = await this.listProfiles();
    const nextProfiles = profiles.filter(profile => profile.id !== profileId);

    await this.context.globalState.update(CONNECTIONS_KEY, nextProfiles);
    await this.context.secrets.delete(secretKey(profileId, 'password'));
    await this.context.secrets.delete(secretKey(profileId, 'passphrase'));
  }


  async buildBackupFile(options: ConnectionBackupExportOptions): Promise<RemoteEditBackupFile> {
    const includeConnections = Boolean(options.includeConnections);
    const includeCredentials = includeConnections && Boolean(options.includeCredentials);
    const profiles = includeConnections ? await this.listProfiles() : [];
    const backupConnections = includeConnections
      ? profiles.map(profile => this.toBackupConnection(profile, options))
      : [];

    const backup: RemoteEditBackupFile = {
      remoteEditExportVersion: SUPPORTED_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      extensionVersion: options.extensionVersion || undefined,
      settings: options.includeSettings ? this.exportSettings() : undefined,
      connections: includeConnections ? backupConnections : undefined,
      encryptedCredentials: null
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

    return backup;
  }

  summarizeBackupFile(backup: RemoteEditBackupFile): RemoteEditBackupSummary {
    validateBackupVersion(backup);

    const connections = Array.isArray(backup.connections) ? backup.connections : [];
    const supportedConnections = connections.filter(connection => isSupportedBackupConnection(connection));

    return {
      hasSettings: Boolean(backup.settings && typeof backup.settings === 'object'),
      connectionCount: connections.length,
      supportedConnectionCount: supportedConnections.length,
      unsupportedConnectionCount: Math.max(0, connections.length - supportedConnections.length),
      remotePathFavoriteCount: supportedConnections.reduce((count, connection) => {
        const favorites = Array.isArray(connection.remotePathFavorites) ? connection.remotePathFavorites : [];
        return count + favorites.length;
      }, 0),
      usernamesIncluded: supportedConnections.some(connection => typeof connection.username === 'string' && connection.username.trim().length > 0),
      hasEncryptedCredentials: Boolean(backup.encryptedCredentials)
    };
  }

  async importBackupFile(backup: RemoteEditBackupFile, options: ConnectionBackupImportOptions): Promise<RemoteEditBackupImportResult> {
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
      usernamesImported: 0
    };

    if (options.includeSettings && backup.settings && typeof backup.settings === 'object') {
      await this.importSettings(backup.settings);
      result.settingsImported = true;
    }

    if (!options.includeConnections) {
      return result;
    }

    const importedConnections = this.normalizeBackupConnections(backup.connections || [], options);
    result.skippedUnsupported = Math.max(0, (backup.connections || []).length - importedConnections.length);
    result.favoritesImported = options.includeFavorites
      ? importedConnections.reduce((count, profile) => count + normalizeFavoriteRemotePaths(profile.favoriteRemotePaths || []).length, 0)
      : 0;
    result.usernamesImported = options.includeUsernames
      ? importedConnections.filter(profile => String(profile.username || '').trim().length > 0).length
      : 0;

    const existingProfiles = await this.listProfiles();
    const existingById = new Map(existingProfiles.map(profile => [profile.id, profile]));
    const now = Date.now();
    let nextProfiles: ConnectionProfile[];

    if (options.importMode === 'replace') {
      for (const profile of existingProfiles) {
        await this.deleteStoredCredentials(profile.id);
      }

      nextProfiles = importedConnections.map(profile => ({
        ...profile,
        createdAt: profile.createdAt || now,
        updatedAt: now
      }));
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

        return {
          ...existing,
          ...imported,
          username: options.includeUsernames ? imported.username : existing.username,
          favoriteRemotePaths: options.includeFavorites ? imported.favoriteRemotePaths : existing.favoriteRemotePaths,
          createdAt: existing.createdAt || imported.createdAt || now,
          updatedAt: now
        };
      });

      for (const imported of importedById.values()) {
        nextProfiles.push({
          ...imported,
          createdAt: imported.createdAt || now,
          updatedAt: now
        });
        result.added += 1;
      }
    }

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

    return result;
  }

  private toBackupConnection(profile: ConnectionProfile, options: ConnectionBackupExportOptions): RemoteEditBackupConnection {
    const backupConnection: RemoteEditBackupConnection = {
      id: profile.id,
      connectionType: SFTP_CONNECTION_TYPE,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      authType: profile.authType,
      startPath: profile.startPath || '',
      privateKeyPath: profile.authType === 'privateKey' ? profile.privateKeyPath || '' : undefined,
      keepAlive: profile.keepAlive !== false,
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

  private exportSettings(): Record<string, unknown> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const settings: Record<string, unknown> = {};

    for (const key of REMOTE_EDIT_SETTING_KEYS) {
      settings[key] = config.get(key);
    }

    return settings;
  }

  private async importSettings(settings: Record<string, unknown>): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

    for (const key of REMOTE_EDIT_SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        await config.update(key, settings[key], vscode.ConfigurationTarget.Global);
      }
    }
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

      const authType = normalizeAuthType(String(connection.authType || 'password'));
      const privateKeyPath = String(connection.privateKeyPath || '').trim();
      const profile: ConnectionProfile = {
        id,
        name,
        host,
        port: normalizePort(connection.port),
        username: options.includeUsernames ? String(connection.username || '').trim() : '',
        authType,
        startPath: String(connection.startPath || '').trim(),
        privateKeyPath: authType === 'privateKey' ? privateKeyPath : undefined,
        keepAlive: connection.keepAlive !== false,
        favoriteRemotePaths: options.includeFavorites ? normalizeFavoriteRemotePaths(connection.remotePathFavorites || []) : [],
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
    const authType = normalizeAuthType(input.authType || profile?.authType || 'password');
    const port = normalizePort(input.port ?? profile?.port ?? 22);
    const startPath = String(input.startPath ?? profile?.startPath ?? '').trim();
    const privateKeyPath = String(input.privateKeyPath ?? profile?.privateKeyPath ?? '').trim();
    const connectionId = profile?.id || buildProfileId(name || buildDefaultProfileName(host, username), host, username);
    const keepAlive = typeof input.keepAlive === 'boolean' ? input.keepAlive : profile?.keepAlive !== false;

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

    if (authType === 'privateKey' && !privateKeyPath) {
      throw new Error('Private key path is required for private key authentication.');
    }

    return {
      connectionId,
      name,
      host,
      port,
      username,
      authType,
      password: authType === 'password' ? password : undefined,
      privateKeyPath: authType === 'privateKey' ? privateKeyPath : undefined,
      passphrase: authType === 'privateKey' && passphrase ? passphrase : undefined,
      startPath,
      keepAlive
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

  private normalizeStoredProfile(profile: ConnectionProfile): ConnectionProfile {
    return {
      ...profile,
      port: normalizePort(profile.port),
      authType: normalizeAuthType(profile.authType),
      startPath: profile.startPath || '',
      keepAlive: profile.keepAlive !== false,
      favoriteRemotePaths: normalizeFavoriteRemotePaths(profile.favoriteRemotePaths || []),
      createdAt: Number(profile.createdAt || Date.now()),
      updatedAt: Number(profile.updatedAt || Date.now())
    };
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

function normalizeAuthType(value: string): AuthType {
  return value === 'privateKey' ? 'privateKey' : 'password';
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

  const connectionType = String(connection.connectionType || SFTP_CONNECTION_TYPE).toLowerCase();
  return connectionType === SFTP_CONNECTION_TYPE;
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
