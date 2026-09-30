import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { Writable } from 'stream';
import { Client as FtpClient } from 'basic-ftp';
import type { WorkspaceSyncConnectionSnapshot } from './WorkspaceSyncConnectionSnapshot';
import type { WorkspaceSyncRemoteCapabilities, WorkspaceSyncRemoteEntry, WorkspaceSyncRemoteSession } from './WorkspaceSyncSession';
import { findFtpEntryByName, splitFtpLookupPath } from './FtpPathLookup';
import { redactWorkspaceSyncDiagnosticText, type WorkspaceSyncDiagnostics } from '../WorkspaceSyncDiagnostics';

export class FtpSyncSession implements WorkspaceSyncRemoteSession {
  get connectionIdentity(): string { return this.snapshot.connectionIdentity; }

  readonly capabilities: WorkspaceSyncRemoteCapabilities = {
    reliableMtime: false,
    caseSensitive: undefined,
    filenameStyle: 'unknown',
    maxConcurrentMetadata: 1,
    maxConcurrentTransfers: 1
  };

  private client: FtpClient | undefined;
  private keepAliveTimer: NodeJS.Timeout | undefined;
  private reconnectPromise: Promise<void> | undefined;
  /**
   * basic-ftp intentionally supports one command at a time per Client. Keep a
   * protocol-local queue even though Workspace Sync already serializes its
   * higher-level target work: Keep Alive runs outside that target queue and
   * must never overlap LIST, transfers, metadata probes or reconnect cleanup.
   */
  private operationTail: Promise<void> = Promise.resolve();
  private queuedOperationCount = 0;

  private constructor(
    readonly profileId: string,
    readonly connectionType: 'ftp' | 'ftps',
    private readonly snapshot: WorkspaceSyncConnectionSnapshot,
    private readonly diagnostics?: WorkspaceSyncDiagnostics
  ) {}

  static async connect(snapshot: WorkspaceSyncConnectionSnapshot, diagnostics?: WorkspaceSyncDiagnostics): Promise<FtpSyncSession> {
    if (snapshot.authType !== 'password' || !snapshot.password) {
      throw new Error('Workspace Sync FTP/FTPS connections require password authentication.');
    }
    const session = new FtpSyncSession(snapshot.profileId, snapshot.connectionType as 'ftp' | 'ftps', {
      ...snapshot,
      jumpChain: snapshot.jumpChain.map(item => ({ ...item }))
    }, diagnostics);
    await session.reconnect();
    return session;
  }

  async reconnect(): Promise<void> {
    if (this.reconnectPromise) {
      this.diagnostics?.debug(this.protocolDiagnosticSource(), 'Joining in-flight reconnect.');
      return this.reconnectPromise;
    }
    const startedAt = Date.now();
    this.diagnostics?.debug(this.protocolDiagnosticSource(), 'Reconnect started.');
    const promise = (async () => {
      // Prevent a scheduled Keep Alive from starting while the client is being
      // replaced, then wait for any already-running FTP command to finish.
      this.stopKeepAlive();
      await this.waitForOperations();
      await this.openFreshConnection();
    })();
    this.reconnectPromise = promise;
    try {
      await promise;
      this.diagnostics?.debug(this.protocolDiagnosticSource(), 'Reconnect completed.');
    } catch (error) {
      this.diagnostics?.debug(this.protocolDiagnosticSource(), 'Reconnect failed.', { Error: this.safeDiagnosticError(error) });
      throw error;
    } finally {
      if (this.reconnectPromise === promise) this.reconnectPromise = undefined;
      this.diagnostics?.performance(this.protocolDiagnosticSource(), `Reconnect completed in ${Date.now() - startedAt} ms.`);
    }
  }

  async list(remotePath: string): Promise<WorkspaceSyncRemoteEntry[]> {
    return this.runDiagnosed('List', remotePath, () => this.runQueued(async client => {
      const entries = await this.listUnqueued(client, remotePath);
      return entries.map(entry => ({
        name: String(entry.name || ''),
        kind: entry.isDirectory ? 'directory' : entry.isSymbolicLink ? 'link' : 'file',
        size: Number(entry.size || 0),
        mtimeMs: entry.modifiedAt instanceof Date ? entry.modifiedAt.getTime() : 0
      }));
    }));
  }

  async stat(remotePath: string): Promise<WorkspaceSyncRemoteEntry | undefined> {
    return this.runDiagnosed('Stat', remotePath, () => this.runQueued(async client => this.statUnqueued(client, remotePath)));
  }

  async ensureDirectory(remotePath: string): Promise<void> {
    if (!remotePath || remotePath === '/') return;
    await this.runDiagnosed('Ensure directory', remotePath, () => this.runQueued(async client => {
      let previous: string | undefined;
      try { previous = await client.pwd(); } catch { /* optional */ }
      await client.ensureDir(remotePath);
      if (previous) {
        try { await client.cd(previous); } catch { /* absolute paths remain safe */ }
      }
    }));
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    await this.runDiagnosed('Upload', remotePath, () => this.runQueued(client => client.uploadFrom(localPath, remotePath)));
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    await this.runDiagnosed('Download', remotePath, () => this.runQueued(client => client.downloadTo(localPath, remotePath)));
  }

  async hashFile(remotePath: string): Promise<string> {
    return this.runDiagnosed('Hash', remotePath, () => this.runQueued(async client => {
      const hash = crypto.createHash('sha256');
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          hash.update(chunk);
          callback();
        }
      });
      await client.downloadTo(sink as any, remotePath);
      return hash.digest('hex');
    }));
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.runDiagnosed('Delete file', remotePath, () => this.runQueued(async client => {
      try { await client.remove(remotePath); } catch (error) { if (!isNotFound(error)) throw error; }
    }));
  }

  async deleteDirectory(remotePath: string): Promise<void> {
    // Never recursively delete from Workspace Sync. If unexpected remote
    // content exists, the empty-directory removal fails closed instead of
    // erasing data that was not part of the approved plan.
    await this.runDiagnosed('Delete directory', remotePath, () => this.runQueued(async client => {
      try { await client.removeEmptyDir(remotePath); } catch (error) { if (!isNotFound(error)) throw error; }
    }));
  }

  async replaceFile(tempPath: string, targetPath: string): Promise<void> {
    await this.runDiagnosed('Replace file', targetPath, () => this.runQueued(async client => {
      const existing = await this.statUnqueued(client, targetPath);
      if (!existing) {
        await client.rename(tempPath, targetPath);
        return;
      }
      if (existing.kind === 'directory') {
        throw new Error(`Workspace Sync cannot replace a directory with a file: ${targetPath}`);
      }

      // FTP has no portable atomic replace primitive. Stage the upload first,
      // preserve the previous file under a unique sibling name, then promote the
      // staged file. If promotion fails, restore the previous file best-effort.
      // This is not truly atomic, but it prevents partial-content overwrites.
      const backupPath = `${targetPath}.remoteedit-backup-${crypto.randomUUID()}.tmp`;
      await client.rename(targetPath, backupPath);
      try {
        await client.rename(tempPath, targetPath);
      } catch (error) {
        try { await client.rename(backupPath, targetPath); } catch { /* best effort restore */ }
        throw error;
      }
      try { await client.remove(backupPath); } catch { /* successful replacement; stale backup is non-fatal */ }
    }));
  }

  async disconnect(): Promise<void> {
    const startedAt = Date.now();
    this.diagnostics?.debug(this.protocolDiagnosticSource(), 'Disconnect started.');
    this.stopKeepAlive();
    await this.waitForOperations();
    const client = this.client;
    this.client = undefined;
    client?.close();
    this.diagnostics?.performance(this.protocolDiagnosticSource(), `Disconnect completed in ${Date.now() - startedAt} ms.`);
  }

  private async openFreshConnection(): Promise<void> {
    const previousClient = this.client;
    this.client = undefined;
    previousClient?.close();

    const client = new FtpClient(30000);
    try {
      const secureOptions = this.snapshot.connectionType === 'ftps'
        ? await buildSecureOptions(this.snapshot)
        : undefined;
      await client.access({
        host: this.snapshot.host,
        port: this.snapshot.port,
        user: this.snapshot.username,
        password: this.snapshot.password,
        secure: this.snapshot.connectionType === 'ftps',
        secureOptions
      });
      await client.send('TYPE I');
      try {
        const system = await client.send('SYST');
        const description = String((system as any)?.message || system || '');
        if (/windows|win32|windows_nt|microsoft/i.test(description)) {
          this.capabilities.caseSensitive = false;
          this.capabilities.filenameStyle = 'windows';
        } else if (/unix|linux|aix|bsd/i.test(description)) {
          this.capabilities.caseSensitive = true;
          this.capabilities.filenameStyle = 'posix';
        }
      } catch {
        // SYST is optional. Unknown case-sensitivity is handled conservatively
        // by Workspace Sync only when case-only path collisions are present.
      }
      this.client = client;
      this.startKeepAlive();
    } catch (error) {
      client.close();
      throw error;
    }
  }

  /**
   * Some FTP servers accept CWD + LIST but reject LIST/MLSD with an absolute
   * path (for example with "501 No such directory"). A successful CWD proves
   * the directory exists, so use a current-directory listing as a compatibility
   * fallback without treating every FTP 501 response as "not found".
   */
  private async listUnqueued(client: FtpClient, remotePath: string): Promise<any[]> {
    let directEntries: any[] | undefined;
    let directError: unknown;
    try {
      directEntries = await client.list(remotePath);
      if (directEntries.length > 0 || normalizeFtpPath(remotePath) === '/') return directEntries;
    } catch (error) {
      directError = error;
      this.diagnostics?.debug(this.protocolDiagnosticSource(), 'Direct directory listing failed; trying CWD + LIST compatibility fallback.', { Path: remotePath, Error: this.safeDiagnosticError(error) });
    }

    const previous = await safePwd(client);
    let changedDirectory = false;
    try {
      await client.cd(remotePath);
      changedDirectory = true;
      const cwdEntries = await client.list('');
      if (directError || cwdEntries.length > 0) {
        if (directError) this.diagnostics?.debug(this.protocolDiagnosticSource(), 'CWD + LIST compatibility fallback succeeded.', { Path: remotePath, Entries: cwdEntries.length });
        return cwdEntries;
      }
    } catch {
      if (directError) throw directError;
    } finally {
      if (changedDirectory && previous) {
        try { await client.cd(previous); } catch { /* best-effort restore */ }
      }
    }

    if (directError) throw directError;
    return directEntries || [];
  }

  private async statUnqueued(client: FtpClient, remotePath: string): Promise<WorkspaceSyncRemoteEntry | undefined> {
    const { parent, name } = splitFtpLookupPath(remotePath);
    if (!name) return undefined;
    try {
      const entries = await this.listUnqueued(client, parent);
      const mapped = entries.map(entry => ({
        name: String(entry.name || ''),
        kind: entry.isDirectory ? 'directory' as const : entry.isSymbolicLink ? 'link' as const : 'file' as const,
        size: Number(entry.size || 0),
        mtimeMs: entry.modifiedAt instanceof Date ? entry.modifiedAt.getTime() : 0
      }));
      return findFtpEntryByName(mapped, name, this.capabilities.caseSensitive);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private async runQueued<T>(operation: (client: FtpClient) => Promise<T>): Promise<T> {
    const previous = this.operationTail;
    if (this.queuedOperationCount > 0) this.diagnostics?.debug(this.protocolDiagnosticSource(), 'FTP operation queued behind active work.', { QueuedOperations: this.queuedOperationCount });
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    this.operationTail = previous.catch(() => undefined).then(() => turn);
    this.queuedOperationCount += 1;

    await previous.catch(() => undefined);
    try {
      await this.waitForReconnect();
      return await operation(this.requireClient());
    } finally {
      this.queuedOperationCount = Math.max(0, this.queuedOperationCount - 1);
      release();
    }
  }

  private async waitForOperations(): Promise<void> {
    await this.operationTail.catch(() => undefined);
  }

  private async waitForReconnect(): Promise<void> {
    const reconnect = this.reconnectPromise;
    if (reconnect) await reconnect;
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    if (!this.snapshot.keepAlive) return;
    this.keepAliveTimer = setInterval(() => {
      void this.sendKeepAliveIfIdle();
    }, 30000);
    (this.keepAliveTimer as any).unref?.();
  }

  /** Keep Alive never queues behind user work; it simply waits for the next interval. */
  private async sendKeepAliveIfIdle(): Promise<void> {
    if (this.queuedOperationCount > 0 || this.reconnectPromise) {
      this.diagnostics?.debug(this.protocolDiagnosticSource(), 'Keep Alive skipped because the FTP client is busy.', { QueuedOperations: this.queuedOperationCount, Reconnecting: Boolean(this.reconnectPromise) });
      return;
    }
    try {
      const startedAt = Date.now();
      await this.runQueued(async client => {
        const rawClient = client as any;
        if (typeof rawClient.sendIgnoringError === 'function') {
          await rawClient.sendIgnoringError('NOOP');
        } else {
          await client.send('NOOP');
        }
      });
      this.diagnostics?.performance(this.protocolDiagnosticSource(), `Keep Alive NOOP completed in ${Date.now() - startedAt} ms.`);
    } catch {
      // A failed NOOP is advisory. The next real operation uses the normal
      // Workspace Sync retry/reconnect path and will surface a useful error.
    }
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = undefined;
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
    const source = this.protocolDiagnosticSource();
    this.diagnostics?.debug(source, `${operation} started.`, { Path: remotePath });
    try {
      const result = await run();
      this.diagnostics?.performance(source, `${operation} completed in ${Date.now() - startedAt} ms.`, { Path: remotePath });
      return result;
    } catch (error) {
      this.diagnostics?.debug(source, `${operation} failed.`, { Path: remotePath, Error: this.safeDiagnosticError(error) });
      this.diagnostics?.performance(source, `${operation} failed in ${Date.now() - startedAt} ms.`, { Path: remotePath });
      throw error;
    }
  }

  private protocolDiagnosticSource(): string {
    return this.connectionType === 'ftps' ? 'FTPS' : 'FTP';
  }

  private requireClient(): FtpClient {
    if (!this.client || this.client.closed) throw new Error('Workspace Sync FTP session is not connected.');
    return this.client;
  }
}

async function buildSecureOptions(snapshot: WorkspaceSyncConnectionSnapshot): Promise<Record<string, unknown>> {
  const options: Record<string, unknown> = {
    rejectUnauthorized: !snapshot.ftpsAllowSelfSignedCertificate
  };
  if (snapshot.ftpsCaCertificatePath) {
    options.ca = await fs.readFile(snapshot.ftpsCaCertificatePath);
  }
  return options;
}

async function safePwd(client: FtpClient): Promise<string | undefined> {
  try { return await client.pwd(); } catch { return undefined; }
}

function normalizeFtpPath(value: string): string {
  const normalized = String(value || '/').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return normalized || '/';
}

function isFtpNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b550\b|not found|does not exist|no such (?:file|directory)/i.test(message);
}

function isNotFound(error: unknown): boolean {
  return isFtpNotFoundError(error);
}
