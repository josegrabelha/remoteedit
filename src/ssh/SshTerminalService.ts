import * as vscode from 'vscode';
import type { Client, ClientChannel, PseudoTtyOptions } from 'ssh2';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { isSftpConnectionType } from '../remote/RemoteConnectionTypes';

interface SshTerminalClientProvider {
  getSshClientForTerminal(connectionId: string): Client;
}

function hasSshTerminalClientProvider(value: RemoteSessionManager): value is RemoteSessionManager & SshTerminalClientProvider {
  return typeof (value as Partial<SshTerminalClientProvider>).getSshClientForTerminal === 'function';
}

export class SshTerminalService {
  constructor(private readonly sessions: RemoteSessionManager) {}

  async openTerminal(connectionId: string, workingDirectory?: string): Promise<void> {
    const connection = this.sessions.getConnection(connectionId);

    if (!connection) {
      throw new Error(`Remote Edit connection '${connectionId}' is not connected.`);
    }

    if (!isSftpConnectionType(connection.connectionType)) {
      throw new Error('Open SSH Terminal is only available for SFTP/SSH connections.');
    }

    if (!hasSshTerminalClientProvider(this.sessions)) {
      throw new Error('Open SSH Terminal is not available for this connection manager.');
    }

    const client = this.sessions.getSshClientForTerminal(connectionId);
    const pty = new RemoteEditSshPseudoterminal(client, workingDirectory);
    const terminal = vscode.window.createTerminal({
      name: `SSH: ${connection.name || connection.host}`,
      pty
    });

    terminal.show();
  }
}

class RemoteEditSshPseudoterminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.writeEmitter.event;

  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  readonly onDidClose = this.closeEmitter.event;

  private channel: ClientChannel | undefined;
  private pendingInput: string[] = [];
  private dimensions: vscode.TerminalDimensions | undefined;
  private isClosed = false;

  constructor(
    private readonly client: Client,
    private readonly workingDirectory?: string
  ) {}

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    this.dimensions = initialDimensions;
    this.openShell();
  }

  close(): void {
    this.isClosed = true;
    this.pendingInput = [];
    this.channel?.end();
    this.channel = undefined;
  }

  handleInput(data: string): void {
    if (this.channel) {
      this.channel.write(data);
      return;
    }

    this.pendingInput.push(data);
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.dimensions = dimensions;
    this.resizeShell(dimensions);
  }

  private openShell(): void {
    const ptyOptions = this.buildPtyOptions(this.dimensions);

    this.client.shell(ptyOptions, (error, channel) => {
      if (error) {
        this.writeLine(`Open SSH Terminal failed: ${error.message}`);
        this.closeEmitter.fire(1);
        return;
      }

      if (this.isClosed) {
        channel.end();
        return;
      }

      this.channel = channel;
      this.bindChannel(channel);
      this.flushPendingInput();
      this.applyWorkingDirectory();
    });
  }

  private bindChannel(channel: ClientChannel): void {
    channel.on('data', (chunk: unknown) => this.writeEmitter.fire(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)));
    channel.stderr.on('data', (chunk: unknown) => this.writeEmitter.fire(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)));
    channel.on('close', () => {
      this.channel = undefined;
      if (!this.isClosed) {
        this.isClosed = true;
        this.closeEmitter.fire();
      }
    });
    channel.on('error', (error: Error) => {
      this.writeLine(`Open SSH Terminal error: ${error.message}`);
    });
  }

  private flushPendingInput(): void {
    if (!this.channel || !this.pendingInput.length) {
      return;
    }

    for (const input of this.pendingInput) {
      this.channel.write(input);
    }
    this.pendingInput = [];
  }

  private applyWorkingDirectory(): void {
    const directory = String(this.workingDirectory || '').trim();

    if (!directory || directory === '/') {
      return;
    }

    this.channel?.write(`cd ${shellQuote(directory)}\n`);
  }

  private resizeShell(dimensions: vscode.TerminalDimensions | undefined): void {
    if (!this.channel || !dimensions) {
      return;
    }

    const columns = Math.max(1, Math.floor(dimensions.columns || 80));
    const rows = Math.max(1, Math.floor(dimensions.rows || 24));
    this.channel.setWindow(rows, columns, 0, 0);
  }

  private buildPtyOptions(dimensions: vscode.TerminalDimensions | undefined): PseudoTtyOptions {
    return {
      term: 'xterm-256color',
      cols: Math.max(1, Math.floor(dimensions?.columns || 80)),
      rows: Math.max(1, Math.floor(dimensions?.rows || 24)),
      width: 0,
      height: 0
    };
  }

  private writeLine(message: string): void {
    this.writeEmitter.fire(`${message}\r\n`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
