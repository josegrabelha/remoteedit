import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { PortForwardManager, type PortForwardRuntimeState } from '../ssh/PortForwardManager';
import { formatPortForwardLabel, parsePortForwardConfig } from './PortForwardUtils';

type RemoteEditPortForwardLogDetails = Record<string, string | number | boolean | null | undefined>;

export interface PortForwardControllerOptions {
  sessions: RemoteSessionManager;
  portForwardManager: PortForwardManager;
  getActiveConnectionId: () => string | undefined;
  postPortForwardState: (state: PortForwardRuntimeState) => void;
  logInfo: (message: string, details?: RemoteEditPortForwardLogDetails) => void;
  logError: (message: string, details?: RemoteEditPortForwardLogDetails) => void;
}

export class PortForwardController {
  constructor(private readonly options: PortForwardControllerOptions) {}

  async requestState(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.options.getActiveConnectionId() || '').trim();
    const ids = Array.isArray(payload?.ids) ? payload.ids.map((id: unknown) => String(id || '').trim()).filter(Boolean) : [];

    if (!connectionId) {
      return;
    }

    if (ids.length > 0) {
      for (const id of ids) {
        this.options.postPortForwardState(this.options.portForwardManager.getState(connectionId, id));
      }
      return;
    }

    for (const state of this.options.portForwardManager.listStates(connectionId)) {
      this.options.postPortForwardState(state);
    }
  }

  async start(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.options.getActiveConnectionId() || '').trim();
    const config = parsePortForwardConfig(payload?.forward || payload || {});

    if (!connectionId) {
      throw new Error('No active connection.');
    }

    const connection = this.options.sessions.getConnection(connectionId);
    if (!connection || String(connection.connectionType || 'sftp').toLowerCase() !== 'sftp') {
      throw new Error('Port forwarding requires an active SSH/SFTP connection.');
    }

    const state = await this.options.portForwardManager.startForward(connectionId, config);
    this.options.postPortForwardState(state);

    if (state.status === 'error' && state.error) {
      this.options.logError('Port forwarding failed.', {
        Connection: connection.name || connectionId,
        Forward: formatPortForwardLabel(config),
        Details: state.error
      });
    } else if (state.status === 'running') {
      this.options.logInfo('Started port forward.', {
        Connection: connection.name || connectionId,
        Forward: formatPortForwardLabel(config)
      });
    }
  }

  async stop(payload: any): Promise<void> {
    const connectionId = String(payload?.connectionId || this.options.getActiveConnectionId() || '').trim();
    const forwardId = String(payload?.id || payload?.forwardId || payload?.forward?.id || '').trim();

    if (!connectionId || !forwardId) {
      return;
    }

    const state = await this.options.portForwardManager.stopForward(connectionId, forwardId);
    this.options.postPortForwardState(state);
  }

  postAllStates(): void {
    for (const connection of this.options.sessions.listConnections()) {
      for (const state of this.options.portForwardManager.listStates(connection.id)) {
        this.options.postPortForwardState(state);
      }
    }
  }
}
