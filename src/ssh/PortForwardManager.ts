import * as net from 'net';
import type { Client } from 'ssh2';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { SFTP_CONNECTION_TYPE } from '../remote/RemoteConnectionTypes';

export interface SavedPortForwardConfig {
  id: string;
  name: string;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  autoStartOnConnect?: boolean;
}

export type PortForwardStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface PortForwardRuntimeState {
  id: string;
  connectionId: string;
  status: PortForwardStatus;
  error?: string;
  localUrl?: string;
}

interface ActivePortForwardState extends PortForwardRuntimeState {
  config: SavedPortForwardConfig;
  server?: net.Server;
  sockets: Set<net.Socket>;
  streams: Set<NodeJS.ReadWriteStream>;
}

interface SshClientProvider {
  getConnection(connectionId: string): { connectionType?: string } | undefined;
  getSshClientForTerminal?(connectionId: string): Client;
}

export class PortForwardManager {
  private readonly forwards = new Map<string, ActivePortForwardState>();

  constructor(
    private readonly sessions: RemoteSessionManager,
    private readonly onDidChangeState?: (state: PortForwardRuntimeState) => void
  ) {}

  getState(connectionId: string, forwardId: string): PortForwardRuntimeState {
    const key = this.key(connectionId, forwardId);
    const existing = this.forwards.get(key);

    if (existing) {
      return this.snapshot(existing);
    }

    return {
      id: forwardId,
      connectionId,
      status: 'stopped'
    };
  }

  listStates(connectionId: string): PortForwardRuntimeState[] {
    return Array.from(this.forwards.values())
      .filter(item => item.connectionId === connectionId)
      .map(item => this.snapshot(item));
  }

  async startForward(connectionId: string, config: SavedPortForwardConfig): Promise<PortForwardRuntimeState> {
    const normalized = this.normalizeConfig(config);
    const key = this.key(connectionId, normalized.id);
    const existing = this.forwards.get(key);

    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      return this.snapshot(existing);
    }

    if (existing) {
      await this.stopForward(connectionId, normalized.id);
    }

    const sshClient = this.getSshClient(connectionId);
    const state: ActivePortForwardState = {
      id: normalized.id,
      connectionId,
      config: normalized,
      status: 'starting',
      localUrl: this.buildLocalUrl(normalized),
      sockets: new Set(),
      streams: new Set()
    };

    this.forwards.set(key, state);
    this.notify(state);

    try {
      await this.listen(state, sshClient);
      state.status = 'running';
      state.error = '';
      this.notify(state);
      return this.snapshot(state);
    } catch (error) {
      state.status = 'error';
      state.error = this.formatError(error);
      this.notify(state);
      await this.closeState(state);
      this.forwards.set(key, state);
      return this.snapshot(state);
    }
  }

  async stopForward(connectionId: string, forwardId: string): Promise<PortForwardRuntimeState> {
    const key = this.key(connectionId, forwardId);
    const state = this.forwards.get(key);

    if (!state) {
      return { id: forwardId, connectionId, status: 'stopped' };
    }

    state.status = 'stopping';
    this.notify(state);
    await this.closeState(state);
    this.forwards.delete(key);

    const stopped: PortForwardRuntimeState = {
      id: forwardId,
      connectionId,
      status: 'stopped',
      localUrl: this.buildLocalUrl(state.config)
    };
    this.onDidChangeState?.(stopped);
    return stopped;
  }

  async stopAllForConnection(connectionId: string): Promise<void> {
    const states = Array.from(this.forwards.values()).filter(item => item.connectionId === connectionId);
    await Promise.all(states.map(item => this.stopForward(item.connectionId, item.id)));
  }

  async stopAllExceptConnections(activeConnectionIds: Set<string>): Promise<void> {
    const states = Array.from(this.forwards.values()).filter(item => !activeConnectionIds.has(item.connectionId));
    await Promise.all(states.map(item => this.stopForward(item.connectionId, item.id)));
  }

  async dispose(): Promise<void> {
    const states = Array.from(this.forwards.values());
    await Promise.all(states.map(item => this.stopForward(item.connectionId, item.id)));
  }

  private listen(state: ActivePortForwardState, sshClient: Client): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const server = net.createServer(localSocket => {
        this.handleLocalConnection(state, sshClient, localSocket);
      });

      state.server = server;

      server.on('error', error => {
        const message = this.formatError(error);
        state.error = message;

        if (!settled) {
          settled = true;
          reject(error);
          return;
        }

        state.status = 'error';
        this.notify(state);
      });

      server.on('close', () => {
        if (state.status !== 'stopping' && state.status !== 'error') {
          state.status = 'stopped';
          this.notify(state);
        }
      });

      server.listen(state.config.localPort, state.config.localHost, () => {
        if (settled) return;
        settled = true;
        resolve();
      });
    });
  }

  private handleLocalConnection(state: ActivePortForwardState, sshClient: Client, localSocket: net.Socket): void {
    state.sockets.add(localSocket);
    localSocket.on('close', () => state.sockets.delete(localSocket));
    localSocket.on('error', () => undefined);

    const srcAddress = localSocket.remoteAddress || '127.0.0.1';
    const srcPort = localSocket.remotePort || 0;

    try {
      sshClient.forwardOut(srcAddress, srcPort, state.config.remoteHost, state.config.remotePort, (error, stream) => {
        if (error || !stream) {
          localSocket.destroy(error || undefined);
          return;
        }

        const remoteStream = stream as unknown as NodeJS.ReadWriteStream;
        state.streams.add(remoteStream);
        remoteStream.on('close', () => state.streams.delete(remoteStream));
        remoteStream.on('error', () => undefined);
        localSocket.pipe(remoteStream).pipe(localSocket);
      });
    } catch (error) {
      localSocket.destroy(error instanceof Error ? error : undefined);
    }
  }

  private async closeState(state: ActivePortForwardState): Promise<void> {
    for (const socket of Array.from(state.sockets)) {
      socket.destroy();
    }
    state.sockets.clear();

    for (const stream of Array.from(state.streams)) {
      try {
        (stream as any).destroy?.();
      } catch {
        // Ignore stream cleanup errors.
      }
    }
    state.streams.clear();

    if (!state.server) {
      return;
    }

    const server = state.server;
    state.server = undefined;

    await new Promise<void>(resolve => {
      try {
        server.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  private getSshClient(connectionId: string): Client {
    const provider = this.sessions as RemoteSessionManager & SshClientProvider;
    const connection = provider.getConnection(connectionId);

    if (!connection || String(connection.connectionType || '').toLowerCase() !== SFTP_CONNECTION_TYPE) {
      throw new Error('Port forwarding requires an active SSH/SFTP connection.');
    }

    if (typeof provider.getSshClientForTerminal !== 'function') {
      throw new Error('Port forwarding is only available for SSH/SFTP connections.');
    }

    return provider.getSshClientForTerminal(connectionId);
  }

  private normalizeConfig(config: SavedPortForwardConfig): SavedPortForwardConfig {
    const id = String(config.id || '').trim();
    const name = String(config.name || '').trim() || this.buildDefaultName(config);
    const localHost = String(config.localHost || '').trim() || 'localhost';
    const remoteHost = String(config.remoteHost || '').trim() || '127.0.0.1';
    const localPort = Number(config.localPort || 0);
    const remotePort = Number(config.remotePort || 0);

    if (!id) {
      throw new Error('Port forward id is required.');
    }

    if (!this.isValidPort(localPort) || !this.isValidPort(remotePort)) {
      throw new Error('Ports must be between 1 and 65535.');
    }

    return { id, name, localHost, localPort, remoteHost, remotePort, autoStartOnConnect: Boolean(config.autoStartOnConnect) };
  }

  private isValidPort(port: number): boolean {
    return Number.isInteger(port) && port >= 1 && port <= 65535;
  }

  private buildDefaultName(config: SavedPortForwardConfig): string {
    const localPort = Number(config.localPort || 0);
    const remotePort = Number(config.remotePort || 0);
    return localPort && remotePort ? `${localPort} → ${remotePort}` : 'Port forward';
  }

  private buildLocalUrl(config: SavedPortForwardConfig): string {
    const host = String(config.localHost || '').trim() || 'localhost';
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    return `http://${displayHost}:${config.localPort}`;
  }

  private key(connectionId: string, forwardId: string): string {
    return `${connectionId}::${forwardId}`;
  }

  private snapshot(state: ActivePortForwardState): PortForwardRuntimeState {
    return {
      id: state.id,
      connectionId: state.connectionId,
      status: state.status,
      error: state.error || '',
      localUrl: state.localUrl || this.buildLocalUrl(state.config)
    };
  }

  private notify(state: ActivePortForwardState): void {
    this.onDidChangeState?.(this.snapshot(state));
  }

  private formatError(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = String((error as { code?: unknown }).code || '');
      if (code === 'EADDRINUSE') return 'Local port is already in use.';
      if (code === 'EACCES') return 'Permission denied for the local port.';
    }

    return error instanceof Error ? error.message : String(error || 'Port forwarding failed.');
  }
}
