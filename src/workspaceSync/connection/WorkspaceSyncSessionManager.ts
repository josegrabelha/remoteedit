import { WorkspaceSyncUi } from '../ui/WorkspaceSyncUi';
import * as vscode from 'vscode';
import type { WorkspaceSyncConnectionConfigSource } from './WorkspaceSyncConnectionConfigSource';
import { appendOutputLog } from '../../utils/outputLogger';
import type { WorkspaceSyncDiagnostics } from '../WorkspaceSyncDiagnostics';
import { createWorkspaceSyncDiagnostics } from '../WorkspaceSyncDiagnosticsFactory';
import { loadWorkspaceSyncConnectionSnapshot } from './WorkspaceSyncConnectionSnapshot';
import type { WorkspaceSyncRemoteSession } from './WorkspaceSyncSession';
import type { WorkspaceSyncConnectionSnapshot } from './WorkspaceSyncConnectionSnapshot';
import { WorkspaceSyncPassphraseRequiredError } from './WorkspaceSyncConnectionErrors';


export interface WorkspaceSyncSessionFactory {
  connect(snapshot: WorkspaceSyncConnectionSnapshot, diagnostics?: WorkspaceSyncDiagnostics): Promise<WorkspaceSyncRemoteSession>;
}

const defaultWorkspaceSyncSessionFactory: WorkspaceSyncSessionFactory = {
  async connect(snapshot, diagnostics): Promise<WorkspaceSyncRemoteSession> {
    // Load protocol implementations only when Workspace Sync actually opens a
    // private session. This keeps the session lifecycle independent from the
    // protocol adapters and makes the manager testable without creating any
    // Remote Edit runtime state.
    if (snapshot.connectionType === 'sftp') {
      const { SftpSyncSession } = await import('./SftpSyncSession');
      return SftpSyncSession.connect(snapshot, diagnostics);
    }
    const { FtpSyncSession } = await import('./FtpSyncSession');
    return FtpSyncSession.connect(snapshot, diagnostics);
  }
};

export type WorkspaceSyncSessionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WorkspaceSyncSessionState {
  sessionKey: string;
  profileId: string;
  status: WorkspaceSyncSessionStatus;
  profileUpdatedAt?: number;
  message?: string;
}

interface PendingConnection {
  profileId: string;
  generation: number;
  promise: Promise<WorkspaceSyncRemoteSession>;
}

export class WorkspaceSyncSessionManager implements vscode.Disposable {
  private readonly sessions = new Map<string, WorkspaceSyncRemoteSession>();
  private readonly states = new Map<string, WorkspaceSyncSessionState>();
  private readonly pending = new Map<string, PendingConnection>();
  private readonly generations = new Map<string, number>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<WorkspaceSyncSessionState>();
  private disposed = false;
  private readonly diagnostics: WorkspaceSyncDiagnostics;
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(
    private readonly connectionManager: WorkspaceSyncConnectionConfigSource,
    private readonly output: vscode.OutputChannel,
    private readonly sessionFactory: WorkspaceSyncSessionFactory = defaultWorkspaceSyncSessionFactory,
    private readonly ui = new WorkspaceSyncUi()
  ) {
    this.diagnostics = createWorkspaceSyncDiagnostics(output);
  }

  getState(sessionKey: string): WorkspaceSyncSessionState {
    return this.states.get(sessionKey) || { sessionKey, profileId: '', status: 'disconnected' };
  }

  getSession(sessionKey: string): WorkspaceSyncRemoteSession | undefined {
    return this.sessions.get(sessionKey);
  }

  async connect(sessionKey: string, profileId: string): Promise<WorkspaceSyncRemoteSession> {
    this.assertNotDisposed();
    const existing = this.sessions.get(sessionKey);
    if (existing?.profileId === profileId) {
      this.diagnostics.debug('Session', 'Reusing connected private session.', { SessionKey: sessionKey, ProfileId: profileId });
      return existing;
    }

    const pending = this.pending.get(sessionKey);
    if (pending?.profileId === profileId) {
      this.diagnostics.debug('Session', 'Joining pending private-session connection.', { SessionKey: sessionKey, ProfileId: profileId });
      return pending.promise;
    }

    const generation = this.bumpGeneration(sessionKey);
    const connectTimer = this.diagnostics.timer();
    this.diagnostics.debug('Session', 'Opening private session.', { SessionKey: sessionKey, ProfileId: profileId, Generation: generation });
    await this.closeActiveSession(sessionKey);
    // closeActiveSession() can await network shutdown. A newer Connect or
    // Disconnect may have superseded this request while it was waiting, so a
    // stale continuation must never overwrite state or replace the pending
    // promise for the newer request.
    this.assertCurrent(sessionKey, generation);
    this.updateState({ sessionKey, profileId, status: 'connecting' });

    const promise = this.openSession(sessionKey, profileId, generation);
    this.pending.set(sessionKey, { profileId, generation, promise });
    try {
      return await promise;
    } finally {
      const current = this.pending.get(sessionKey);
      if (current?.generation === generation) this.pending.delete(sessionKey);
      this.diagnostics.performance('Session', `Private-session connect completed in ${connectTimer()} ms.`, { SessionKey: sessionKey, ProfileId: profileId, Generation: generation });
    }
  }

  async disconnect(sessionKey: string): Promise<void> {
    const disconnectTimer = this.diagnostics.timer();
    const generation = this.bumpGeneration(sessionKey);
    this.diagnostics.debug('Session', 'Disconnecting private session.', { SessionKey: sessionKey, Generation: generation });
    this.pending.delete(sessionKey);
    await this.closeActiveSession(sessionKey);
    // Do not let a slow disconnect overwrite a newer Connect state.
    if (!this.isCurrent(sessionKey, generation)) return;
    const current = this.states.get(sessionKey);
    this.updateState({ sessionKey, profileId: current?.profileId || '', status: 'disconnected' });
    this.diagnostics.performance('Session', `Private-session disconnect completed in ${disconnectTimer()} ms.`, { SessionKey: sessionKey });
  }

  /** Close the exact session only if it is still owned by this key. */
  async disconnectSessionIfCurrent(sessionKey: string, session: WorkspaceSyncRemoteSession): Promise<void> {
    if (this.sessions.get(sessionKey) !== session) return;

    const generation = this.bumpGeneration(sessionKey);
    this.pending.delete(sessionKey);
    this.sessions.delete(sessionKey);
    await safeDisconnect(session);
    if (!this.isCurrent(sessionKey, generation)) return;

    const current = this.states.get(sessionKey);
    this.updateState({
      sessionKey,
      profileId: current?.profileId || session.profileId,
      profileUpdatedAt: current?.profileUpdatedAt,
      status: 'disconnected'
    });
  }

  /**
   * A protocol connection can succeed before Workspace Sync has finished its
   * initial Compare/reconciliation. If that preparation fails, close only the
   * exact session that was prepared and keep the target in an error state.
   * This prevents Watch/Upload on Save from attaching to a half-initialized
   * connection without racing a newer Connect.
   */
  async failConnectedSession(
    sessionKey: string,
    session: WorkspaceSyncRemoteSession,
    error: unknown
  ): Promise<void> {
    if (this.sessions.get(sessionKey) !== session) return;

    const generation = this.bumpGeneration(sessionKey);
    this.pending.delete(sessionKey);
    this.sessions.delete(sessionKey);
    await safeDisconnect(session);
    if (!this.isCurrent(sessionKey, generation)) return;

    const current = this.states.get(sessionKey);
    const message = this.ui.sanitize(error instanceof Error ? error.message : String(error));
    this.updateState({
      sessionKey,
      profileId: current?.profileId || session.profileId,
      profileUpdatedAt: current?.profileUpdatedAt,
      status: 'error',
      message
    });
    appendOutputLog(this.output, 'ERROR', `Workspace Sync target preparation failed: ${message}`);
    this.diagnostics.debug('Session', 'Connected private session closed after target preparation failure.', { SessionKey: sessionKey, ProfileId: session.profileId, Error: message });
  }

  async disconnectAll(): Promise<void> {
    const keys = new Set([
      ...this.sessions.keys(),
      ...this.pending.keys(),
      ...this.states.keys()
    ]);
    await Promise.all([...keys].map(key => this.disconnect(key)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Invalidate every in-flight connection attempt immediately. VS Code's
    // Disposable contract is synchronous, so close the currently-owned
    // sessions best-effort without allowing late continuations to publish
    // state after the event emitter has been disposed.
    const keys = new Set([
      ...this.sessions.keys(),
      ...this.pending.keys(),
      ...this.states.keys()
    ]);
    for (const key of keys) this.bumpGeneration(key);
    this.pending.clear();
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    this.onDidChangeEmitter.dispose();
    void Promise.all(sessions.map(session => safeDisconnect(session)));
  }

  private async openSession(
    sessionKey: string,
    profileId: string,
    generation: number
  ): Promise<WorkspaceSyncRemoteSession> {
    let session: WorkspaceSyncRemoteSession | undefined;
    try {
      let snapshot = await loadWorkspaceSyncConnectionSnapshot(this.connectionManager, profileId, this.ui.input);
      this.diagnostics.debug('Session', 'Connection snapshot loaded.', {
        SessionKey: sessionKey,
        ProfileId: profileId,
        Connection: snapshot.name,
        Protocol: snapshot.connectionType.toUpperCase(),
        JumpHosts: snapshot.jumpChain.length,
        KeepAlive: snapshot.keepAlive
      });
      for (const credentials of [snapshot, ...snapshot.jumpChain]) {
        this.ui.protectSecret(credentials.password);
        this.ui.protectSecret(credentials.passphrase);
      }
      this.assertCurrent(sessionKey, generation);
      while (true) {
        try {
          session = await this.sessionFactory.connect(snapshot, this.diagnostics);
          break;
        } catch (error) {
          if (!(error instanceof WorkspaceSyncPassphraseRequiredError)) throw error;
          this.assertCurrent(sessionKey, generation);
          const passphrase = await this.ui.input({
            title: `Workspace Sync private key passphrase`,
            prompt: `Enter the passphrase for ${error.isJumpHost ? 'Jump Host' : 'connection'} '${error.profileName}'.`,
            password: true,
            required: true
          });
          if (passphrase === undefined) throw new WorkspaceSyncConnectionCancelledError();
          this.ui.protectSecret(passphrase);
          this.assertCurrent(sessionKey, generation);
          snapshot = withRuntimePassphrase(snapshot, error.profileId, passphrase);
        }
      }

      if (!this.isCurrent(sessionKey, generation)) {
        await safeDisconnect(session);
        // The stale private session is already closed. Clear the local
        // reference so the catch/finally cleanup path cannot disconnect the
        // same protocol client a second time.
        session = undefined;
        throw new WorkspaceSyncConnectionCancelledError();
      }

      this.sessions.set(sessionKey, session);
      this.updateState({ sessionKey, profileId, profileUpdatedAt: snapshot.profileUpdatedAt, status: 'connected' });
      appendOutputLog(this.output, 'INFO', `Workspace Sync connected: ${snapshot.name} (${snapshot.connectionType.toUpperCase()}).`);
      this.diagnostics.debug('Session', 'Private session connected.', { SessionKey: sessionKey, Connection: snapshot.name, Protocol: snapshot.connectionType.toUpperCase() });
      return session;
    } catch (error) {
      if (session && this.sessions.get(sessionKey) !== session) await safeDisconnect(session);
      if (this.isCurrent(sessionKey, generation)) {
        const message = this.ui.sanitize(error instanceof Error ? error.message : String(error));
        this.updateState({ sessionKey, profileId, status: 'error', message });
        appendOutputLog(this.output, 'ERROR', `Workspace Sync connection failed: ${message}`);
        this.diagnostics.debug('Session', 'Private session connection failed.', { SessionKey: sessionKey, ProfileId: profileId, Error: message });
      }
      throw error;
    }
  }

  private async closeActiveSession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    this.sessions.delete(sessionKey);
    if (session) await safeDisconnect(session);
  }

  private bumpGeneration(sessionKey: string): number {
    const next = (this.generations.get(sessionKey) || 0) + 1;
    this.generations.set(sessionKey, next);
    return next;
  }

  private isCurrent(sessionKey: string, generation: number): boolean {
    return this.generations.get(sessionKey) === generation;
  }

  private assertCurrent(sessionKey: string, generation: number): void {
    if (!this.isCurrent(sessionKey, generation)) throw new WorkspaceSyncConnectionCancelledError();
  }

  private updateState(state: WorkspaceSyncSessionState): void {
    if (this.disposed) return;
    this.states.set(state.sessionKey, state);
    this.onDidChangeEmitter.fire(state);
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('Workspace Sync session manager has been disposed.');
  }
}

function withRuntimePassphrase(
  snapshot: WorkspaceSyncConnectionSnapshot,
  profileId: string,
  passphrase: string
): WorkspaceSyncConnectionSnapshot {
  if (snapshot.profileId === profileId) {
    return { ...snapshot, passphrase, jumpChain: snapshot.jumpChain.map(item => ({ ...item })) };
  }
  let matched = false;
  const jumpChain = snapshot.jumpChain.map(item => {
    if (item.profileId !== profileId) return { ...item };
    matched = true;
    return { ...item, passphrase };
  });
  if (!matched) throw new Error('The private-key connection that requested a passphrase is no longer part of this Workspace Sync connection.');
  return { ...snapshot, jumpChain };
}

class WorkspaceSyncConnectionCancelledError extends Error {
  constructor() {
    super('Workspace Sync connection was cancelled.');
    this.name = 'WorkspaceSyncConnectionCancelledError';
  }
}

async function safeDisconnect(session: WorkspaceSyncRemoteSession): Promise<void> {
  try { await session.disconnect(); } catch { /* best effort */ }
}
