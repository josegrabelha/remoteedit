import type { ProxyConnection } from '../../proxy/ProxyTransport';
import * as crypto from 'crypto';

export interface WorkspaceSyncConnectionIdentityHop {
  host: string;
  port: number;
  username: string;
}

export interface WorkspaceSyncConnectionIdentityInput {
  proxy?: ProxyConnection;
  connectionType: 'sftp' | 'ftp' | 'ftps';
  host: string;
  port: number;
  username: string;
  jumpChain?: readonly WorkspaceSyncConnectionIdentityHop[];
}

/**
 * Stable identity for the remote endpoint used by baseline and sync safety.
 * It intentionally excludes labels, credentials and profile timestamps: those
 * may change without changing the filesystem being synchronized. The network
 * route (Jump Hosts) is included because the same target hostname can resolve
 * to a different machine from a different private network.
 */
export function buildWorkspaceSyncConnectionIdentity(input: WorkspaceSyncConnectionIdentityInput): string {
  const canonical = {
    ...(input.proxy ? { proxy: { type: input.proxy.type, host: normalizeHost(input.proxy.host), port: input.proxy.port,
      authentication: input.proxy.authentication, username: input.proxy.username || '' } } : {}),
    connectionType: input.connectionType,
    host: normalizeHost(input.host),
    port: normalizePort(input.port),
    username: String(input.username || '').trim(),
    jumpChain: (input.jumpChain || []).map(hop => ({
      host: normalizeHost(hop.host),
      port: normalizePort(hop.port),
      username: String(hop.username || '').trim()
    }))
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function normalizeHost(value: string): string {
  return String(value || '').trim().replace(/\.$/, '').toLowerCase();
}

function normalizePort(value: number): number {
  const port = Number(value);
  return Number.isFinite(port) ? Math.trunc(port) : 0;
}
