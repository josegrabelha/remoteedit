import type { ProxyConnection } from '../../proxy/ProxyTransport';
import { resolveRouteProxy } from '../../proxy/ProxyRoute';
import type { SyncInput } from '../ui/WorkspaceSyncUi';
import type { ConnectionProfile } from '../../connection/ConnectionManager';
import type { WorkspaceSyncConnectionConfigSource } from './WorkspaceSyncConnectionConfigSource';
import { buildWorkspaceSyncConnectionIdentity } from './ConnectionIdentity';

export interface WorkspaceSyncJumpSnapshot {
  proxy?: ProxyConnection;
  profileId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  keepAlive: boolean;
}

export interface WorkspaceSyncConnectionSnapshot {
  proxy?: ProxyConnection;
  profileId: string;
  profileUpdatedAt: number;
  connectionIdentity: string;
  name: string;
  connectionType: 'sftp' | 'ftp' | 'ftps';
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  startPath: string;
  keepAlive: boolean;
  ftpsAllowSelfSignedCertificate: boolean;
  ftpsCaCertificatePath?: string;
  jumpChain: WorkspaceSyncJumpSnapshot[];
}

/**
 * Creates a private Workspace Sync runtime snapshot from the canonical saved
 * connection configuration. Only saved configuration and secure credentials
 * are shared with Remote Edit; none of Remote Edit's live connection/session
 * helpers are used here.
 */
export async function loadWorkspaceSyncConnectionSnapshot(
  connectionManager: WorkspaceSyncConnectionConfigSource,
  profileId: string,
  input: SyncInput = async () => undefined
): Promise<WorkspaceSyncConnectionSnapshot> {
  const profiles = await connectionManager.listProfiles();
  const profile = profiles.find(item => item.id === profileId);
  if (!profile) throw new Error('The selected saved connection no longer exists.');

  const connectionType = normalizeConnectionType(profile.connectionType);
  const username = await resolveUsername(profile, false, input);
  const credentials = await connectionManager.getProfileCredentials(profile.id);
  const auth = await resolveAuthentication(profile, username, credentials, false, input);
  const jumpProfiles = resolveWorkspaceSyncJumpChain(profile, profiles);
  const jumpChain: WorkspaceSyncJumpSnapshot[] = [];
  for (const jumpProfile of jumpProfiles) {
    const jumpUsername = await resolveUsername(jumpProfile, true, input);
    const jumpCredentials = await connectionManager.getProfileCredentials(jumpProfile.id);
    const jumpAuth = await resolveAuthentication(jumpProfile, jumpUsername, jumpCredentials, true, input);
    jumpChain.push({
      proxy: await connectionManager.resolveProxyProfile?.(jumpProfile.proxyProfileId),
      profileId: jumpProfile.id,
      name: jumpProfile.name,
      host: requiredHost(jumpProfile, true),
      port: normalizePort(jumpProfile.port, 22),
      username: jumpUsername,
      authType: jumpAuth.authType,
      password: jumpAuth.password,
      privateKeyPath: jumpAuth.privateKeyPath,
      passphrase: jumpAuth.passphrase,
      keepAlive: jumpProfile.keepAlive !== false
    });
  }

  if ([profile, ...jumpProfiles].some(p => p.proxyProfileId) && !connectionManager.resolveProxyProfile) throw new Error('Proxy configuration is unavailable.');
  const proxy = resolveRouteProxy(await connectionManager.resolveProxyProfile?.(profile.proxyProfileId), jumpChain);
  const host = requiredHost(profile, false);
  const port = normalizePort(profile.port, connectionType === 'sftp' ? 22 : 21);
  return {
    proxy,
    profileId: profile.id,
    profileUpdatedAt: Number(profile.updatedAt || 0),
    connectionIdentity: buildWorkspaceSyncConnectionIdentity({
      connectionType,
      proxy,
      host,
      port,
      username,
      jumpChain
    }),
    name: String(profile.name || host).trim() || host,
    connectionType,
    host,
    port,
    username,
    authType: auth.authType,
    password: auth.password,
    privateKeyPath: auth.privateKeyPath,
    passphrase: auth.passphrase,
    startPath: String(profile.startPath || '/').trim() || '/',
    keepAlive: profile.keepAlive !== false,
    ftpsAllowSelfSignedCertificate: connectionType === 'ftps' && Boolean(profile.ftpsAllowSelfSignedCertificate),
    ftpsCaCertificatePath: connectionType === 'ftps'
      ? String(profile.ftpsCaCertificatePath || '').trim() || undefined
      : undefined,
    jumpChain
  };
}

export function resolveWorkspaceSyncJumpChain(
  target: Pick<ConnectionProfile, 'id' | 'name' | 'connectionType' | 'jumpProfileId'>,
  profiles: readonly ConnectionProfile[]
): ConnectionProfile[] {
  const referenced = String(target.jumpProfileId || '').trim();
  if (!referenced) return [];
  if (target.connectionType !== 'sftp') {
    throw new Error(`Connection '${target.name}' cannot use a Jump Host because only SFTP connections support SSH jump chains.`);
  }

  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  const visited = new Set<string>([target.id]);
  const nearestToOutermost: ConnectionProfile[] = [];
  let currentId = referenced;

  while (currentId) {
    if (visited.has(currentId)) {
      throw new Error(`Workspace Sync detected a cycle in the Jump Host chain for '${target.name}'.`);
    }
    const profile = byId.get(currentId);
    if (!profile) throw new Error(`Jump Host '${currentId}' referenced by '${target.name}' no longer exists.`);
    if (profile.connectionType !== 'sftp') {
      throw new Error(`Jump Host '${profile.name}' must use SFTP.`);
    }
    visited.add(currentId);
    nearestToOutermost.push(profile);
    currentId = String(profile.jumpProfileId || '').trim();
  }

  return nearestToOutermost.reverse();
}

interface WorkspaceSyncResolvedAuth {
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

async function resolveAuthentication(
  profile: ConnectionProfile,
  username: string,
  credentials: { password?: string; passphrase?: string },
  isJumpHost: boolean,
  input: SyncInput
): Promise<WorkspaceSyncResolvedAuth> {
  if (profile.connectionType !== 'sftp' && profile.authType !== 'password') {
    throw new Error(`Workspace Sync ${profile.connectionType.toUpperCase()} connections require password authentication.`);
  }

  if (profile.authType === 'password') {
    let password = credentials.password || '';
    if (!password) {
      const host = requiredHost(profile, isJumpHost);
      const entered = await input({
        title: `Workspace Sync password for ${isJumpHost ? 'Jump Host ' : ''}"${profile.name}"`,
        prompt: `Enter the password for ${username}@${host}:${normalizePort(profile.port, profile.connectionType === 'sftp' ? 22 : 21)}.`,
        password: true,
        required: true
      });
      if (entered === undefined) throw new Error('Workspace Sync connection cancelled.');
      password = entered;
    }
    return { authType: 'password', password };
  }

  const privateKeyPath = String(profile.privateKeyPath || '').trim();
  if (!privateKeyPath) {
    throw new Error(`Private key path is required for ${isJumpHost ? `Jump Host '${profile.name}'` : `connection '${profile.name}'`}.`);
  }
  return {
    authType: 'privateKey',
    privateKeyPath,
    passphrase: credentials.passphrase || undefined
  };
}

async function resolveUsername(profile: ConnectionProfile, isJumpHost: boolean, input: SyncInput): Promise<string> {
  const saved = String(profile.username || '').trim();
  if (saved) return saved;
  const host = requiredHost(profile, isJumpHost);
  const entered = await input({
    title: `Workspace Sync username for ${isJumpHost ? 'Jump Host ' : ''}"${profile.name}"`,
    prompt: `Enter the username for ${host}:${normalizePort(profile.port, profile.connectionType === 'sftp' ? 22 : 21)}.`,
    required: true
  });
  if (entered === undefined) throw new Error('Workspace Sync connection cancelled.');
  return entered.trim();
}

function requiredHost(profile: Pick<ConnectionProfile, 'host' | 'name'>, isJumpHost: boolean): string {
  const host = String(profile.host || '').trim();
  if (!host) throw new Error(`Host is required for ${isJumpHost ? `Jump Host '${profile.name}'` : `connection '${profile.name}'`}.`);
  return host;
}

function normalizeConnectionType(value: unknown): 'sftp' | 'ftp' | 'ftps' {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'sftp' || type === 'ftp' || type === 'ftps') return type;
  throw new Error(`Workspace Sync does not support connection type '${type || 'unknown'}'.`);
}

function normalizePort(value: unknown, fallback: number): number {
  const port = Number(value);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return fallback;
  return Math.trunc(port);
}
