import * as vscode from 'vscode';
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

  async deleteProfile(profileId: string): Promise<void> {
    const profiles = await this.listProfiles();
    const nextProfiles = profiles.filter(profile => profile.id !== profileId);

    await this.context.globalState.update(CONNECTIONS_KEY, nextProfiles);
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

function secretKey(profileId: string, field: 'password' | 'passphrase'): string {
  return `${SECRET_PREFIX}.${profileId}.${field}`;
}
