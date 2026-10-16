import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { RemoteSessionRouter } from '../remote/RemoteSessionRouter';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import type { ConnectionManager, ConnectionProfileInput } from './ConnectionManager';

/** Owns only temporary sessions; profile and operational session state is never written. */
export class ConnectionTester {
  private pending?: { source: vscode.CancellationTokenSource; sessions: RemoteSessionManager };
  constructor(private readonly profiles: ConnectionManager,
    private readonly createSessions: () => RemoteSessionManager = () => new RemoteSessionRouter()) {}

  cancel(): void { this.pending?.source.cancel(); }

  async test(input: ConnectionProfileInput): Promise<{ success?: boolean; error?: string; cancelled?: boolean }> {
    if (this.pending) return { error: 'A connection test is already running.' };
    const pending = { source: new vscode.CancellationTokenSource(), sessions: this.createSessions() };
    this.pending = pending;
    let result: { success?: boolean; error?: string; cancelled?: boolean };
    let secrets: string[] = [input.password || '', input.passphrase || ''];
    try {
      const options = await this.profiles.buildConnectOptions(input, pending.source.token);
      secrets = [...secrets, options.password || '', options.passphrase || '', options.proxy?.password || '',
        ...(options.jumpChain || []).flatMap(jump => [jump.password || '', jump.passphrase || '', jump.proxy?.password || ''])];
      if (pending.source.token.isCancellationRequested) throw new Error("Connection test cancelled.");
      await pending.sessions.connect({ ...options, connectionId: 'connection-test:' + randomUUID() }, pending.source.token);
      result = { success: true };
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) message = message.split(secret).join('[redacted]');
      result = { error: message };
    } finally {
      try { await pending.sessions.disconnectAll(); }
      catch { result = { error: 'Could not finish closing the temporary connection.' }; }
      if (this.pending === pending) this.pending = undefined;
      const cancelled = pending.source.token.isCancellationRequested;
      pending.source.dispose();
      if (cancelled) result = { cancelled: true };
    }
    return result!;
  }
}
