import type { ProxyConnection } from '../../proxy/ProxyTransport';
import type { ConnectionProfile, ConnectionProfileCredentials } from '../../connection/ConnectionManager';

/**
 * The only contract Workspace Sync shares with the existing Remote Edit
 * connection subsystem. It exposes persisted connection definitions and their
 * secure credentials, but no live session/runtime APIs.
 */
export interface WorkspaceSyncConnectionConfigSource {
  resolveProxyProfile?(id?: string): Promise<ProxyConnection | undefined>;
  listProfiles(): Promise<ConnectionProfile[]>;
  getProfileCredentials(profileId: string): Promise<ConnectionProfileCredentials>;
}
