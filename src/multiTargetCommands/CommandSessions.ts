import * as vscode from 'vscode';
import { resolveSshAuthentication } from '../ssh/SshJumpChain';
import { loadWorkspaceSyncConnectionSnapshot } from '../workspaceSync/connection/WorkspaceSyncConnectionSnapshot';
import type { ConnectOptions } from '../remote/RemoteSessionTypes';
import type { ConnectionManager } from '../connection/ConnectionManager';
import type { RemoteSessionManager, ActiveConnection } from '../remote/RemoteSessionManager';

export type TargetConnectionStatus = 'Disconnected' | 'Connecting' | 'Connected' | 'Failed';
type InputPrompt = (options: vscode.InputBoxOptions, token?: vscode.CancellationToken) => PromiseLike<string | undefined>;
export class CommandSessions implements vscode.Disposable {
  readonly states = new Map<string, TargetConnectionStatus>();
  private readonly pending = new Map<string, { source: vscode.CancellationTokenSource; promise: Promise<ActiveConnection> }>();
  private readonly closing = new Map<string, Promise<void>>();
  private promptQueue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly closeListener: vscode.Disposable | undefined;
  constructor(readonly remote: RemoteSessionManager, private readonly profiles: ConnectionManager,
    private readonly changed: () => void, private readonly promptInput: InputPrompt = (options, token) => vscode.window.showInputBox(options, token)) {
    this.closeListener = remote.onDidCloseConnection?.(id => this.setState(id, 'Disconnected'));
  }
  private setState(id: string, status: TargetConnectionStatus): void {
    if (this.disposed) return;
    this.states.set(id, status); this.changed();
  }
  async input(options: vscode.InputBoxOptions, cancelled: () => boolean = () => false, token?: vscode.CancellationToken): Promise<string | undefined> {
    return this.serialPrompt(async () => {
      if (this.disposed || cancelled()) return undefined;
      const value = await this.promptInput({ ...options, ignoreFocusOut: true }, token);
      return this.disposed || cancelled() ? undefined : value;
    });
  }
  private serialPrompt<T>(work: () => Promise<T>): Promise<T> {
    const promise = this.promptQueue.then(work, work);
    this.promptQueue = promise.catch(() => undefined);
    return promise;
  }
  connect(id: string): Promise<ActiveConnection> {
    if (this.disposed) return Promise.reject(new Error('Command sessions are closed.'));
    const pending = this.pending.get(id);
    if (pending) return pending.promise;
    const connected = this.remote.getConnection(id);
    if (connected && !this.closing.has(id)) return Promise.resolve(connected);
    const source = new vscode.CancellationTokenSource();
    const assertActive = () => { if (this.disposed || source.token.isCancellationRequested) throw new Error('Connection canceled.'); };
    this.setState(id, 'Connecting');
    const promise = (async () => {
      try {
        await this.closing.get(id); assertActive();
        this.setState(id, 'Connecting');
        // Credential dialogs are serialized so concurrent targets cannot replace one another's prompt.
        const options = await this.serialPrompt(async () => {
          assertActive();
          // Reuse canonical saved credentials and jump-chain resolution only, never Sync sessions.
          const savedProfiles = await this.profiles.listProfiles();
          if (!savedProfiles.some(profile => profile.id === id && profile.connectionType === 'sftp')) {
            throw new Error('Select an existing SSH/SFTP saved connection.');
          }
          const snapshot = await loadWorkspaceSyncConnectionSnapshot({
            listProfiles: async () => savedProfiles,
            getProfileCredentials: profileId => this.profiles.getProfileCredentials(profileId)
          }, id, async input => {
            assertActive();
            const value = await this.promptInput({
              title: (input.title || 'Multi-Target Commands & Search').replace(/Workspace Sync/g, 'Multi-Target Commands & Search'),
              prompt: input.prompt, password: input.password, ignoreFocusOut: true,
              validateInput: value => input.required && !value ? 'A value is required.' : undefined
            }, source.token);
            assertActive(); return value;
          });
          assertActive();
          if (snapshot.connectionType !== 'sftp') throw new Error('Select an existing SSH/SFTP saved connection.');
          const options: ConnectOptions = {
            connectionId: id, connectionType: 'sftp', name: snapshot.name,
            host: snapshot.host, port: snapshot.port, username: snapshot.username,
            authType: snapshot.authType, password: snapshot.password, privateKeyPath: snapshot.privateKeyPath,
            passphrase: snapshot.passphrase, keepAlive: snapshot.keepAlive, startPath: '',
            jumpChain: snapshot.jumpChain.map(hop => ({ ...hop, connectionType: 'sftp' }))
          };
          // Resolve encrypted-key prompts in the same dialog queue before parallel handshakes.
          for (const auth of [options, ...(options.jumpChain || [])]) {
            if (auth.authType !== 'privateKey') continue;
            assertActive();
            await resolveSshAuthentication({ ...auth, kind: auth === options ? 'target' : 'jump', name: auth.name || snapshot.name }, source.token, {
              promptPassphrase: async target => {
                assertActive();
                const passphrase = await this.promptInput({ title: `Private Key Passphrase · ${target.name}`, password: true, ignoreFocusOut: true }, source.token);
                assertActive(); auth.passphrase = passphrase; return passphrase;
              }
            });
          }
          return options;
        });
        assertActive();
        const connection = await this.remote.connect(options, source.token);
        assertActive(); this.setState(id, 'Connected'); return connection;
      } catch (error) {
        this.setState(id, source.token.isCancellationRequested ? 'Disconnected' : 'Failed');
        if (error instanceof Error && error.message.includes('Workspace Sync')) throw new Error(error.message.replace(/Workspace Sync/g, 'Multi-Target Commands & Search'));
        throw error;
      } finally {
        if (this.pending.get(id)?.source === source) this.pending.delete(id);
        source.dispose();
      }
    })();
    this.pending.set(id, { source, promise });
    return promise;
  }
  async disconnect(id: string): Promise<void> {
    this.pending.get(id)?.source.cancel();
    const existing = this.closing.get(id);
    if (existing) return existing;
    const closing = this.remote.disconnect(id);
    this.closing.set(id, closing);
    try { await closing; this.setState(id, 'Disconnected'); }
    finally { if (this.closing.get(id) === closing) this.closing.delete(id); }
  }
  dispose(): void {
    this.disposed = true; this.closeListener?.dispose();
    for (const pending of this.pending.values()) pending.source.cancel();
    void this.remote.disconnectAll();
  }
}
