import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { Writable } from 'stream';
import SftpClient from 'ssh2-sftp-client';
import type { WorkspaceSyncConnectionSnapshot } from './WorkspaceSyncConnectionSnapshot';
import type { WorkspaceSyncRemoteCapabilities, WorkspaceSyncRemoteEntry, WorkspaceSyncRemoteSession } from './WorkspaceSyncSession';
import { normalizeRemoteEntryKind } from '../scan/RemoteScanner';
import { SyncJumpHostChain } from './SyncJumpHostChain';
import { WorkspaceSyncPassphraseRequiredError, looksLikeMissingPassphrase } from './WorkspaceSyncConnectionErrors';
import { adaptSftpPath, inferSftpPathStyle, type WorkspaceSyncSftpPathStyle } from './SftpPathStyle';
import { redactWorkspaceSyncDiagnosticText, type WorkspaceSyncDiagnostics } from '../WorkspaceSyncDiagnostics';

export class SftpSyncSession implements WorkspaceSyncRemoteSession {
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

  private client: SftpClient | undefined;
  private jumpChain: SyncJumpHostChain | undefined;
  private reconnectPromise: Promise<void> | undefined;
  private pathStyle: WorkspaceSyncSftpPathStyle = 'posix';

  private constructor(
    readonly profileId: string,
    private readonly snapshot: WorkspaceSyncConnectionSnapshot,
    private readonly diagnostics?: WorkspaceSyncDiagnostics
  ) {}

  static async connect(snapshot: WorkspaceSyncConnectionSnapshot, diagnostics?: WorkspaceSyncDiagnostics): Promise<SftpSyncSession> {
    const session = new SftpSyncSession(snapshot.profileId, { ...snapshot, jumpChain: snapshot.jumpChain.map(item => ({ ...item })) }, diagnostics);
    await session.reconnect();
    return session;
  }

  async reconnect(): Promise<void> {
    if (this.reconnectPromise) {
      this.diagnostics?.debug('SFTP', 'Joining in-flight reconnect.');
      return this.reconnectPromise;
    }
    const startedAt = Date.now();
    this.diagnostics?.debug('SFTP', 'Reconnect started.');
    const promise = this.openFreshConnection();
    this.reconnectPromise = promise;
    try {
      await promise;
      this.diagnostics?.debug('SFTP', 'Reconnect completed.', { PathStyle: this.pathStyle });
    } catch (error) {
      this.diagnostics?.debug('SFTP', 'Reconnect failed.', { Error: this.safeDiagnosticError(error) });
      throw error;
    } finally {
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
    await this.runDiagnosed('Upload', remotePath, () => this.requireClient().fastPut(localPath, this.toClientPath(remotePath)));
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    await this.runDiagnosed('Download', remotePath, () => this.requireClient().fastGet(this.toClientPath(remotePath), localPath));
  }

  async hashFile(remotePath: string): Promise<string> {
    return this.runDiagnosed('Hash', remotePath, async () => {
    const hash = crypto.createHash('sha256');
    const sink = new Writable({
      write(chunk, _encoding, callback) {
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
    await this.closeCurrentConnection();
    this.diagnostics?.performance('SFTP', `Disconnect completed in ${Date.now() - startedAt} ms.`);
  }

  private async openFreshConnection(): Promise<void> {
    await this.closeCurrentConnection();
    const client = new SftpClient();
    const jumpChain = new SyncJumpHostChain();
    try {
      const sock = await jumpChain.openTargetSocket(this.snapshot);
      const privateKey = this.snapshot.authType === 'privateKey' && this.snapshot.privateKeyPath
        ? await fs.readFile(this.snapshot.privateKeyPath)
        : undefined;
      await client.connect({
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
      } as any);
      try {
        const cwd = String(await client.cwd() || '').replace(/\\/g, '/');
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
      this.client = client;
      this.jumpChain = jumpChain;
    } catch (error) {
      try { await client.end(); } catch { /* best effort */ }
      jumpChain.dispose();
      if (this.snapshot.authType === 'privateKey' && !this.snapshot.passphrase && looksLikeMissingPassphrase(error)) {
        throw new WorkspaceSyncPassphraseRequiredError(this.snapshot.profileId, this.snapshot.name, false, error);
      }
      throw error;
    }
  }

  private async closeCurrentConnection(): Promise<void> {
    const client = this.client;
    const jumpChain = this.jumpChain;
    this.client = undefined;
    this.jumpChain = undefined;
    if (client) {
      try { await client.end(); } catch { /* best effort */ }
    }
    jumpChain?.dispose();
  }

  private safeDiagnosticError(error: unknown): string {
    return redactWorkspaceSyncDiagnosticText(error, [
      this.snapshot.password,
      this.snapshot.passphrase,
      ...this.snapshot.jumpChain.flatMap(item => [item.password, item.passphrase])
    ]);
  }

  private async runDiagnosed<T>(operation: string, remotePath: string, run: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    this.diagnostics?.debug('SFTP', `${operation} started.`, { Path: remotePath });
    try {
      const result = await run();
      this.diagnostics?.performance('SFTP', `${operation} completed in ${Date.now() - startedAt} ms.`, { Path: remotePath });
      return result;
    } catch (error) {
      this.diagnostics?.debug('SFTP', `${operation} failed.`, { Path: remotePath, Error: this.safeDiagnosticError(error) });
      this.diagnostics?.performance('SFTP', `${operation} failed in ${Date.now() - startedAt} ms.`, { Path: remotePath });
      throw error;
    }
  }

  private toClientPath(remotePath: string): string {
    return adaptSftpPath(remotePath, this.pathStyle);
  }

  private requireClient(): SftpClient {
    if (!this.client) throw new Error('Workspace Sync SFTP session is not connected.');
    return this.client;
  }
}

function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such file|not found|does not exist|code\s*2\b/i.test(message);
}
