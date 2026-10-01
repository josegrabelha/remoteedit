import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Writable } from 'stream';
import SftpClient from 'ssh2-sftp-client';
import type { WorkspaceSyncConnectionSnapshot } from './WorkspaceSyncConnectionSnapshot';
import type { WorkspaceSyncRemoteCapabilities, WorkspaceSyncRemoteEntry, WorkspaceSyncRemoteSession } from './WorkspaceSyncSession';
import { normalizeRemoteEntryKind } from '../scan/RemoteScanner';
import { SyncJumpHostChain } from './SyncJumpHostChain';
import { SessionLifetime, settlesWithin } from './SessionLifetime';
import { WorkspaceSyncPassphraseRequiredError, looksLikeMissingPassphrase } from './WorkspaceSyncConnectionErrors';
import { adaptSftpPath, inferSftpPathStyle, type WorkspaceSyncSftpPathStyle } from './SftpPathStyle';
import { redactWorkspaceSyncDiagnosticText, type WorkspaceSyncDiagnostics } from '../WorkspaceSyncDiagnostics';

export class SftpSyncSession implements WorkspaceSyncRemoteSession {
  private activeReadCommands = 0;
  private activeWriteCommands = 0;
  readonly connectionType = 'sftp' as const;
  get connectionIdentity(): string { return this.snapshot.connectionIdentity; }
  readonly capabilities: WorkspaceSyncRemoteCapabilities = {
    reliableMtime: true,
    // SFTP is a protocol, not a filesystem guarantee. Windows OpenSSH is a
    // common counterexample, so stay unknown until the private session has
    // evidence about the server path style.
    caseSensitive: undefined,
    filenameStyle: 'unknown',
    maxConcurrentMetadata: 6,
    maxConcurrentTransfers: 3
  };

  private readonly lifetime = new SessionLifetime();
  /** A failed transport can be replaced; an explicit Disconnect is terminal. */
  private transportLifetime = new SessionLifetime();
  private readonly transportContext = new AsyncLocalStorage<SessionLifetime>();
  private readonly requestIdleTimeoutMs = 30000;
  get isDisconnected(): boolean { return this.lifetime.closed; }
  private openingClient: SftpClient | undefined;
  private openingJumpChain: SyncJumpHostChain | undefined;
  private client: SftpClient | undefined;
  private jumpChain: SyncJumpHostChain | undefined;
  private reconnectPromise: Promise<void> | undefined;
  private pathStyle: WorkspaceSyncSftpPathStyle = 'posix';

  private constructor(
    readonly profileId: string,
    private readonly snapshot: WorkspaceSyncConnectionSnapshot,
    private readonly diagnostics?: WorkspaceSyncDiagnostics
  ) {}

  static async connect(snapshot: WorkspaceSyncConnectionSnapshot, diagnostics?: WorkspaceSyncDiagnostics, signal?: AbortSignal): Promise<SftpSyncSession> {
    const session = new SftpSyncSession(snapshot.profileId, { ...snapshot, jumpChain: snapshot.jumpChain.map(item => ({ ...item })) }, diagnostics);
    const abort = (): void => { void session.disconnect(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) abort();
      await session.reconnect();
      return session;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  async reconnect(): Promise<void> {
    this.lifetime.assertOpen();
    this.transportContext.getStore()?.assertOpen();
    if (this.reconnectPromise) {
      this.diagnostics?.debug('SFTP', 'Joining in-flight reconnect.');
      return this.reconnectPromise;
    }
    const startedAt = Date.now();
    this.diagnostics?.debug('SFTP', 'Reconnect started.');
    const attempt = new SessionLifetime();
    const setupTimeoutMs = this.requestIdleTimeoutMs * ((this.snapshot.jumpChain?.length || 0) + 2);
    const setupTimer = setTimeout(() => {
      destroySftpClient(this.openingClient);
      this.openingJumpChain?.dispose();
      attempt.close(new Error(`Workspace Sync SFTP connection setup timed out (${setupTimeoutMs} ms).`));
    }, setupTimeoutMs);
    const promise = this.lifetime.run(() => attempt.run(() => this.openFreshConnection(attempt)));
    this.reconnectPromise = promise;
    try {
      await promise;
      this.diagnostics?.debug('SFTP', 'Reconnect completed.', { PathStyle: this.pathStyle });
    } catch (error) {
      this.diagnostics?.debug('SFTP', 'Reconnect failed.', { Error: this.safeDiagnosticError(error) });
      throw error;
    } finally {
      clearTimeout(setupTimer);
      attempt.close();
      if (this.reconnectPromise === promise) this.reconnectPromise = undefined;
      this.diagnostics?.performance('SFTP', `Reconnect completed in ${Date.now() - startedAt} ms.`);
    }
  }

  async list(remotePath: string): Promise<WorkspaceSyncRemoteEntry[]> {
    return this.runDiagnosed('List', remotePath, async () => {
      const entries = await this.requireClient().list(this.toClientPath(remotePath));
      return entries.map((entry: any) => ({
        name: String(entry.name || ''),
        kind: normalizeRemoteEntryKind(entry.type),
        size: Number(entry.size || 0),
        mtimeMs: Number(entry.modifyTime || 0)
      }));
    });
  }

  async stat(remotePath: string): Promise<WorkspaceSyncRemoteEntry | undefined> {
    return this.runDiagnosed('Stat', remotePath, async () => {
    try {
      const clientPath = this.toClientPath(remotePath);
      // ssh2-sftp-client exposes boolean flags, unlike Node's Stats methods.
      // Always use lstat so symlinks remain visible to the containment checks.
      // The v9 type declarations omit lstat, which the installed v12 provides.
      const client = this.requireClient() as SftpClient & { lstat(path: string): Promise<SftpClient.FileStats> };
      const stat = await client.lstat(clientPath);
      const name = remotePath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || remotePath;
      const kind = stat.isSymbolicLink ? 'link' : stat.isDirectory ? 'directory' : stat.isFile ? 'file' : 'unknown';
      return {
        name,
        kind,
        size: Number(stat.size || 0),
        mtimeMs: Number(stat.modifyTime || 0)
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    });
  }

  async ensureDirectory(remotePath: string): Promise<void> {
    if (!remotePath || remotePath === '/') return;
    await this.runDiagnosed('Ensure directory', remotePath, () => this.requireClient().mkdir(this.toClientPath(remotePath), true));
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    await this.runDiagnosed('Upload', remotePath, progress => this.requireClient().fastPut(localPath, this.toClientPath(remotePath), { step: progress }));
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    await this.runDiagnosed('Download', remotePath, progress => this.requireClient().fastGet(this.toClientPath(remotePath), localPath, { step: progress }));
  }

  async hashFile(remotePath: string): Promise<string> {
    return this.runDiagnosed('Hash', remotePath, async progress => {
    const hash = crypto.createHash('sha256');
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        progress();
        hash.update(chunk);
        callback();
      }
    });
    await this.requireClient().get(this.toClientPath(remotePath), sink as any);
    return hash.digest('hex');
    });
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.runDiagnosed('Delete file', remotePath, async () => {
      try { await this.requireClient().delete(this.toClientPath(remotePath)); } catch (error) { if (!isNotFound(error)) throw error; }
    });
  }

  async deleteDirectory(remotePath: string): Promise<void> {
    // Workspace Sync deliberately removes directories only when they are
    // empty. Recursive directory deletion could erase remote-only content
    // that appeared after the sync plan was created.
    await this.runDiagnosed('Delete directory', remotePath, async () => {
      try { await this.requireClient().rmdir(this.toClientPath(remotePath), false); } catch (error) { if (!isNotFound(error)) throw error; }
    });
  }

  async replaceFile(oldPath: string, newPath: string): Promise<void> {
    await this.runDiagnosed('Replace file', newPath, async () => {
    const client = this.requireClient() as any;
    const clientOldPath = this.toClientPath(oldPath);
    const clientNewPath = this.toClientPath(newPath);
    if (typeof client.posixRename === 'function') {
      try {
        await client.posixRename(clientOldPath, clientNewPath);
        return;
      } catch {
        // Fall back to a guarded standard rename when the server does not
        // support the OpenSSH posix-rename extension.
      }
    }

    const existing = await this.stat(newPath);
    if (!existing) {
      await this.requireClient().rename(clientOldPath, clientNewPath);
      return;
    }
    if (existing.kind === 'directory') {
      throw new Error(`Workspace Sync cannot replace a directory with a file: ${newPath}`);
    }

    const backupPath = `${newPath}.remoteedit-backup-${crypto.randomUUID()}.tmp`;
    const clientBackupPath = this.toClientPath(backupPath);
    await this.requireClient().rename(clientNewPath, clientBackupPath);
    try {
      await this.requireClient().rename(clientOldPath, clientNewPath);
    } catch (error) {
      try { await this.requireClient().rename(clientBackupPath, clientNewPath); } catch { /* best effort restore */ }
      throw error;
    }
    try { await this.requireClient().delete(clientBackupPath); } catch { /* replacement succeeded; stale backup is non-fatal */ }
    });
  }

  async disconnect(): Promise<void> {
    const startedAt = Date.now();
    this.diagnostics?.debug('SFTP', 'Disconnect started.');
    // The controller has already allowed active writes to finish. Close a
    // stalled transport before releasing its operations and shared path locks.
    if (this.activeReadCommands || this.activeWriteCommands) destroySftpClient(this.client);
    this.lifetime.close();
    const opening = this.openingClient;
    const openingJumpChain = this.openingJumpChain;
    this.openingClient = undefined;
    this.openingJumpChain = undefined;
    destroySftpClient(opening);
    openingJumpChain?.dispose();
    await this.closeCurrentConnection();
    this.diagnostics?.performance('SFTP', `Disconnect completed in ${Date.now() - startedAt} ms.`);
  }

  interruptPendingReads(): boolean {
    if (!this.activeReadCommands || this.activeWriteCommands) return false;
    this.lifetime.close();
    const client = this.client;
    const jumpChain = this.jumpChain;
    this.client = undefined;
    this.jumpChain = undefined;
    // An SSH read that has stopped receiving data can block a graceful end().
    // Interrupt only metadata/hash reads; never a pending transfer/rename.
    try { (client as any)?.client?.end?.(); } catch { /* best effort */ }
    try { (client as any)?.client?.destroy?.(); } catch { /* best effort */ }
    if (client) void client.end().catch(() => undefined);
    jumpChain?.dispose();
    return Boolean(client);
  }

  private async openFreshConnection(attempt: SessionLifetime): Promise<void> {
    await this.closeCurrentConnection();
    this.lifetime.assertOpen();
    attempt.assertOpen();
    const client = new SftpClient();
    const jumpChain = new SyncJumpHostChain();
    this.openingClient = client;
    this.openingJumpChain = jumpChain;
    try {
      const sock = await attempt.run(() => jumpChain.openTargetSocket(this.snapshot));
      const privateKey = this.snapshot.authType === 'privateKey' && this.snapshot.privateKeyPath
        ? await fs.readFile(this.snapshot.privateKeyPath)
        : undefined;
      this.lifetime.assertOpen();
      attempt.assertOpen();
      await attempt.run(() => client.connect({
        host: this.snapshot.host,
        port: this.snapshot.port,
        username: this.snapshot.username,
        password: this.snapshot.authType === 'password' ? this.snapshot.password : undefined,
        privateKey,
        passphrase: this.snapshot.authType === 'privateKey' ? this.snapshot.passphrase : undefined,
        keepaliveInterval: this.snapshot.keepAlive ? 30000 : 0,
        keepaliveCountMax: this.snapshot.keepAlive ? 3 : 0,
        readyTimeout: 30000,
        sock: sock as any
      } as any));
      try {
        const cwd = String(await attempt.run(() => client.cwd()) || '').replace(/\\/g, '/');
        this.pathStyle = inferSftpPathStyle(cwd);
        if (this.pathStyle !== 'posix') {
          this.capabilities.caseSensitive = false;
          this.capabilities.filenameStyle = 'windows';
        } else {
          this.capabilities.filenameStyle = 'posix';
        }
        this.diagnostics?.debug('SFTP', 'Remote path style detected.', { PathStyle: this.pathStyle, FilenameStyle: this.capabilities.filenameStyle, CaseSensitive: this.capabilities.caseSensitive });
      } catch {
        // Capability remains unknown; collision protection will fail closed
        // only when case-only path aliases actually matter.
      }
      this.lifetime.assertOpen();
      attempt.assertOpen();
      this.client = client;
      this.jumpChain = jumpChain;
      this.transportLifetime = new SessionLifetime();
    } catch (error) {
      destroySftpClient(client);
      jumpChain.dispose();
      if (this.snapshot.authType === 'privateKey' && !this.snapshot.passphrase && looksLikeMissingPassphrase(error)) {
        throw new WorkspaceSyncPassphraseRequiredError(this.snapshot.profileId, this.snapshot.name, false, error);
      }
      throw error;
    } finally {
      if (this.openingClient === client) this.openingClient = undefined;
      if (this.openingJumpChain === jumpChain) this.openingJumpChain = undefined;
    }
  }

  private async closeCurrentConnection(): Promise<void> {
    const client = this.client;
    const jumpChain = this.jumpChain;
    this.client = undefined;
    this.jumpChain = undefined;
    // Reject callbacks belonging to the old transport only after it can no
    // longer send writes. Late continuations cannot enter a replacement client.
    if (this.activeReadCommands || this.activeWriteCommands) destroySftpClient(client);
    this.transportLifetime.close(new Error('Workspace Sync SFTP connection closed.'));
    try {
      if (client) {
        const closed = await settlesWithin(Promise.resolve().then(() => client.end()), 1500);
        if (!closed) this.diagnostics?.debug('SFTP', 'Graceful close timed out; destroying private transport.');
      }
    } finally {
      destroySftpClient(client);
      jumpChain?.dispose();
    }
  }

  private safeDiagnosticError(error: unknown): string {
    return redactWorkspaceSyncDiagnosticText(error, [
      this.snapshot.password,
      this.snapshot.passphrase,
      ...this.snapshot.jumpChain.flatMap(item => [item.password, item.passphrase])
    ]);
  }

  private async runDiagnosed<T>(operation: string, remotePath: string, run: (progress: () => void) => Promise<T>): Promise<T> {
    this.lifetime.assertOpen();
    const inherited = this.transportContext.getStore();
    inherited?.assertOpen();
    if (!inherited && (this.transportLifetime.closed || this.reconnectPromise)) await this.reconnect();
    this.lifetime.assertOpen();
    const transport = inherited || this.transportLifetime;
    const startedAt = Date.now();
    const read = operation === 'List' || operation === 'Stat' || operation === 'Hash';
    if (read) this.activeReadCommands += 1;
    else this.activeWriteCommands += 1;
    let finished = false;
    let idleTimer: NodeJS.Timeout | undefined;
    const progress = (): void => {
      if (finished || transport.closed) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        // Do not just race the Promise: close the actual channel before
        // releasing operations/locks, and invalidate every request on it.
        if (this.transportLifetime === transport) {
          destroySftpClient(this.client);
          this.jumpChain?.dispose();
          this.client = undefined;
          this.jumpChain = undefined;
        }
        transport.close(new Error(`Workspace Sync SFTP ${operation} timed out without progress (${this.requestIdleTimeoutMs} ms).`));
      }, this.requestIdleTimeoutMs);
    };
    progress();
    this.diagnostics?.debug('SFTP', `${operation} started.`, { Path: remotePath });
    try {
      const result = await this.lifetime.run(() => transport.run(() =>
        this.transportContext.run(transport, () => run(progress))));
      this.diagnostics?.performance('SFTP', `${operation} completed in ${Date.now() - startedAt} ms.`, { Path: remotePath });
      return result;
    } catch (error) {
      this.diagnostics?.debug('SFTP', `${operation} failed.`, { Path: remotePath, Error: this.safeDiagnosticError(error) });
      this.diagnostics?.performance('SFTP', `${operation} failed in ${Date.now() - startedAt} ms.`, { Path: remotePath });
      throw error;
    } finally {
      finished = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (read) this.activeReadCommands -= 1;
      else this.activeWriteCommands -= 1;
    }
  }

  private toClientPath(remotePath: string): string {
    return adaptSftpPath(remotePath, this.pathStyle);
  }

  private requireClient(): SftpClient {
    this.lifetime.assertOpen();
    this.transportContext.getStore()?.assertOpen();
    if (!this.client) throw new Error('Workspace Sync SFTP session is not connected.');
    return this.client;
  }
}

function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such file|not found|does not exist|code\s*2\b/i.test(message);
}

function destroySftpClient(client?: SftpClient): void {
  try { (client as any)?.client?.destroy?.(); } catch { /* best effort */ }
}
