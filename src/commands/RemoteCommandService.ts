import type { RemoteSessionManager, RemoteCommandStreamingCallbacks, ConnectionCancellationToken } from '../remote/RemoteSessionManager';
import { isWindowsRemotePlatform } from '../remote/RemotePlatform';

/** Multi-target adapter over the existing Files SSH executor. */
export class RemoteCommandService {
  constructor(private readonly sessions: RemoteSessionManager) {}

  async prepareSudo(connectionId: string, requested: boolean, prompt: () => Promise<string | undefined>): Promise<boolean> {
    const connection = this.sessions.getConnection(connectionId);
    const supported = connection?.connectionType === 'sftp' && !isWindowsRemotePlatform(connection.remotePlatform);
    if (!supported || connection?.username.toLowerCase() === 'root') return false;
    if (requested && !this.sessions.isSudoModeEnabled(connectionId)) {
      const password = await prompt();
      if (!password) throw new Error('Sudo command canceled.');
      try { await this.sessions.enableSudoMode(connectionId, password); }
      catch (error) { this.sessions.disableSudoMode(connectionId); throw error; }
    }
    return this.sessions.isSudoModeEnabled(connectionId);
  }

  run(connectionId: string, workingDirectory: string, command: string,
    callbacks: RemoteCommandStreamingCallbacks = {}, token?: ConnectionCancellationToken) {
    return this.sessions.runRemoteCommandStreaming(connectionId, workingDirectory, command, { ...callbacks, useSessionWorkingDirectory: !workingDirectory }, token);
  }
}
