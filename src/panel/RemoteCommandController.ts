import * as vscode from 'vscode';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { isRemoteEditOperationCancelled } from '../utils/progressUtils';
import type { OutputLogDetails } from '../utils/outputLogger';
import { normalizeRemotePath } from '../ssh/SftpSessionManager';
import { RemoteEditOutboundMessageType } from './PanelMessages';
import type { ActiveRemoteCommandState } from './PanelTypes';
import type { InputDialogOptions } from './DialogManager';
import { isWindowsRemotePlatform } from '../remote/RemotePlatform';

interface RemoteCommandControllerOptions {
  sessions: RemoteSessionManager;
  activeRemoteCommands: Map<string, ActiveRemoteCommandState>;
  getActivePath(): string;
  requireActiveConnectionId(): string;
  postMessage(type: RemoteEditOutboundMessageType, payload: any): void;
  showWebviewInputBox(options: InputDialogOptions): Promise<string | undefined>;
  logInfo(message: string, details?: OutputLogDetails): void;
  logWarn(message: string, details?: OutputLogDetails): void;
  logError(message: string, details?: OutputLogDetails): void;
}

export class RemoteCommandController {
  constructor(private readonly options: RemoteCommandControllerOptions) {}

  async requestRunRemoteCommand(payload: any): Promise<void> {
    const requestedConnectionId = String(payload?.connectionId || '').trim();
    const connectionId = requestedConnectionId || this.options.requireActiveConnectionId();
    const commandId = String(payload?.commandId || '').trim() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const command = String(payload?.command || '').trim();
    const workingDirectory = normalizeRemotePath(String(payload?.workingDirectory || this.options.getActivePath() || '/'));

    if (!command) {
      this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
        commandId,
        connectionId,
        error: 'Enter a command to run.'
      });
      return;
    }

    if (this.options.activeRemoteCommands.has(connectionId)) {
      this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
        commandId,
        connectionId,
        error: 'Another remote command is already running for this connection.'
      });
      return;
    }

    const connection = this.options.sessions.getConnection(connectionId);
    const username = String(connection?.username || '').trim();
    const canUseSudo = Boolean(connection?.connectionType === 'sftp' && !isWindowsRemotePlatform(connection?.remotePlatform));
    const isRootConnection = canUseSudo && username.toLowerCase() === 'root';
    const requestedSudo = Boolean(payload?.useSudo) && canUseSudo && !isRootConnection;
    let sudoModeEnabled = canUseSudo && this.options.sessions.isSudoModeEnabled(connectionId);

    if (requestedSudo && !sudoModeEnabled) {
      if (connection?.connectionType !== 'sftp') {
        this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
          error: 'Sudo Mode is available only for SFTP connections.'
        });
        return;
      }

      const password = String(payload?.sudoPassword || '') || await this.options.showWebviewInputBox({
        title: 'Run Command with Sudo',
        prompt: 'Enter the sudo password for this connection. The password is kept only in memory for the current session.',
        password: true,
        placeHolder: 'Sudo password',
        label: 'Sudo password',
        confirmLabel: 'Run'
      });

      if (!password) {
        this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
          error: 'Sudo command canceled.'
        });
        return;
      }

      try {
        await this.options.sessions.enableSudoMode(connectionId, password);
        sudoModeEnabled = true;
        this.options.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: true });
        this.options.logInfo('Sudo Mode enabled for remote command.', { Connection: connectionId });
      } catch (error) {
        this.options.sessions.disableSudoMode(connectionId);
        const message = error instanceof Error ? error.message : String(error);
        this.options.postMessage(RemoteEditOutboundMessageType.SudoModeChanged, { connectionId, enabled: false });
        this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
          error: message || 'Could not enable Sudo Mode.'
        });
        this.options.logWarn('Could not enable Sudo Mode for remote command.', { Connection: connectionId, Details: message });
        return;
      }
    }

    const cancellationSource = new vscode.CancellationTokenSource();
    this.options.activeRemoteCommands.set(connectionId, { id: commandId, connectionId, cancellationSource });
    const useSudo = canUseSudo && (sudoModeEnabled || requestedSudo) && !isRootConnection;

    this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandStarted, {
      commandId,
      connectionId,
      workingDirectory,
      command,
      useSudo
    });
    this.options.logInfo('Running remote command.', {
      Connection: connectionId,
      WorkingDirectory: workingDirectory,
      RunAs: useSudo ? 'root via sudo' : (username || 'SSH user'),
      Command: command
    });

    void this.executeRemoteCommandForWebview(commandId, connectionId, workingDirectory, command, cancellationSource);
  }

  stopRemoteCommand(payload: any): void {
    const commandId = String(payload?.commandId || '').trim();
    const connectionId = String(payload?.connectionId || '').trim();
    const force = Boolean(payload?.force);
    const activeCommand = this.findActiveRemoteCommand(commandId, connectionId);

    if (!activeCommand) {
      if (commandId) {
        this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
          stopped: true,
          forceKilled: force
        });
      }
      return;
    }

    activeCommand.stopMode = force ? 'force' : 'stop';

    if (force) {
      activeCommand.control?.forceKill();
      activeCommand.cancellationSource.cancel();
      return;
    }

    activeCommand.control?.stop();
    activeCommand.cancellationSource.cancel();
  }

  private findActiveRemoteCommand(commandId?: string, connectionId?: string): ActiveRemoteCommandState | undefined {
    const normalizedConnectionId = String(connectionId || '').trim();
    if (normalizedConnectionId) {
      const activeCommand = this.options.activeRemoteCommands.get(normalizedConnectionId);
      if (!commandId || activeCommand?.id === commandId) {
        return activeCommand;
      }
      return undefined;
    }

    const normalizedCommandId = String(commandId || '').trim();
    if (normalizedCommandId) {
      return Array.from(this.options.activeRemoteCommands.values()).find(command => command.id === normalizedCommandId);
    }

    return Array.from(this.options.activeRemoteCommands.values())[0];
  }

  stopAllRemoteCommands(force = false): void {
    for (const activeCommand of this.options.activeRemoteCommands.values()) {
      this.stopRemoteCommand({ commandId: activeCommand.id, connectionId: activeCommand.connectionId, force });
    }
  }

  private async executeRemoteCommandForWebview(
    commandId: string,
    connectionId: string,
    workingDirectory: string,
    command: string,
    cancellationSource: vscode.CancellationTokenSource
  ): Promise<void> {
    let outputBuffer = '';
    let outputFlushTimer: NodeJS.Timeout | undefined;
    const commandExitCodes: number[] = [];

    const flushOutput = () => {
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = undefined;
      }

      if (!outputBuffer) {
        return;
      }

      const text = outputBuffer;
      outputBuffer = '';

      this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandOutput, {
        commandId,
        stream: 'stdout',
        text
      });
    };

    const scheduleOutputFlush = () => {
      if (outputFlushTimer) {
        return;
      }

      outputFlushTimer = setTimeout(flushOutput, 100);
    };

    const queueOutput = (chunk: string) => {
      if (!chunk) {
        return;
      }

      outputBuffer += chunk;
      scheduleOutputFlush();
    };

    try {
      const result = await this.options.sessions.runRemoteCommandStreaming(
        connectionId,
        workingDirectory,
        command,
        {
          onControl: control => {
            const activeCommand = this.options.activeRemoteCommands.get(connectionId);
            if (activeCommand?.id === commandId) {
              activeCommand.control = control;
            }
          },
          onCommand: logicalCommand => {
            flushOutput();
            this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandOutput, {
              commandId,
              connectionId,
              kind: 'command',
              text: logicalCommand
            });
          },
          onCommandStatus: (index, code) => {
            commandExitCodes[index] = code;
            flushOutput();
            this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandOutput, {
              commandId,
              connectionId,
              kind: 'commandStatus',
              code
            });
          },
          onStdout: chunk => queueOutput(chunk),
          onStderr: chunk => queueOutput(chunk)
        },
        cancellationSource.token
      );

      flushOutput();

      if (cancellationSource.token.isCancellationRequested) {
        this.options.logInfo('Remote command stopped.', {
          Connection: connectionId,
          WorkingDirectory: workingDirectory,
          Command: command
        });
        const stopMode = this.options.activeRemoteCommands.get(connectionId)?.id === commandId ? this.options.activeRemoteCommands.get(connectionId)?.stopMode : undefined;
        this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
          stopped: true,
          forceKilled: stopMode === 'force'
        });
        return;
      }

      this.options.logInfo('Remote command finished.', {
        Connection: connectionId,
        WorkingDirectory: workingDirectory,
        Command: command,
        ExitCode: String(result.code),
        Signal: result.signal || ''
      });

      this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
        commandId,
        connectionId,
        code: result.code,
        signal: result.signal || '',
        commandCount: commandExitCodes.filter(code => typeof code === 'number').length,
        failedCommandCount: commandExitCodes.filter(code => typeof code === 'number' && code !== 0).length
      });
    } catch (error) {
      flushOutput();
      const message = error instanceof Error ? error.message : String(error);
      const stopped = cancellationSource.token.isCancellationRequested || isRemoteEditOperationCancelled(error) || message === 'Operation canceled.' || message === 'Operation cancelled.';

      if (stopped) {
        this.options.logInfo('Remote command stopped.', {
          Connection: connectionId,
          WorkingDirectory: workingDirectory,
          Command: command
        });
        const stopMode = this.options.activeRemoteCommands.get(connectionId)?.id === commandId ? this.options.activeRemoteCommands.get(connectionId)?.stopMode : undefined;
        this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
          stopped: true,
          forceKilled: stopMode === 'force'
        });
      } else {
        this.options.logError('Remote command failed.', {
          Connection: connectionId,
          WorkingDirectory: workingDirectory,
          Command: command,
          Details: message
        });
        this.options.postMessage(RemoteEditOutboundMessageType.RemoteCommandFinished, {
          commandId,
          connectionId,
          error: message || 'Remote command failed.'
        });
      }
    } finally {
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = undefined;
      }
      const activeCommand = this.options.activeRemoteCommands.get(connectionId);
      if (activeCommand?.id === commandId) {
        this.options.activeRemoteCommands.delete(connectionId);
      }
      cancellationSource.dispose();
    }
  }
}
