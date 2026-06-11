import { Readable, Writable } from 'stream';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { Client as FtpClient, FileInfo, FileType } from 'basic-ftp';
import { RemoteEditOperationCancelledError, type RemoteEditProgressReporter } from '../utils/progressUtils';
import { getNumberSetting } from '../utils/settingsUtils';
import { appendDebugLog, appendPerformanceLog, createPerformanceTimer } from '../utils/outputLogger';
import { normalizeConnectionType } from '../remote/RemoteConnectionTypes';
import type { RemoteSessionManager, RemoteStat, RemoteListDirectoryOptions, RemoteChangeOwnerGroupOptions, RemoteChmodOptions } from '../remote/RemoteSessionManager';
import type {
  ActiveConnection,
  ConnectOptions,
  ConnectionCancellationToken,
  RemoteArchiveFormat,
  RemoteChecksumSummary,
  RemoteCommandStreamingCallbacks,
  RemoteCommandStreamingResult,
  RemoteEntry,
  RemoteEntryType
} from '../remote/RemoteSessionTypes';

interface CachedReadFile {
  content: Buffer;
  expiresAt: number;
}

interface CachedDirectoryListing {
  entries: RemoteEntry[];
  expiresAt: number;
}

interface StoredFtpConnectOptions extends ConnectOptions {
  connectionType: 'ftp' | 'ftps';
  authType: 'password';
  password: string;
}

interface InFlightDirectoryListing {
  promise: Promise<RemoteEntry[]>;
  startedAt: number;
}

interface FtpListResult {
  items: FileInfo[];
  command: string;
}

interface FtpMergedListResult {
  items: FileInfo[];
  primaryCommand: string;
  primaryListMs: number;
  listMergeMs: number;
  merged: boolean;
}

export class FtpSessionManager implements RemoteSessionManager {
  constructor(private readonly output?: vscode.OutputChannel) {}

  private readonly sessions = new Map<string, FtpClient>();
  private readonly connections = new Map<string, ActiveConnection>();
  private readonly connectOptions = new Map<string, StoredFtpConnectOptions>();
  private readonly reconnectRequired = new Set<string>();
  private readonly readFileCache = new Map<string, CachedReadFile>();
  private readonly directoryListingCache = new Map<string, CachedDirectoryListing>();
  private readonly inFlightDirectoryListings = new Map<string, InFlightDirectoryListing>();
  private readonly operationQueues = new Map<string, Promise<unknown>>();
  private readonly keepAliveTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly keepAliveInFlight = new Set<string>();
  private readonly busyConnectionCounts = new Map<string, number>();
  private readonly lastActivityTimes = new Map<string, number>();

  async connect(options: ConnectOptions, cancellationToken?: ConnectionCancellationToken): Promise<ActiveConnection> {
    const connectionType = normalizeConnectionType(options.connectionType);

    if (connectionType !== 'ftp' && connectionType !== 'ftps') {
      throw new Error('FtpSessionManager only supports FTP and FTPS connections.');
    }

    if (options.authType !== 'password') {
      throw new Error('FTP/FTPS connections support password authentication only.');
    }

    if (!options.password) {
      throw new Error('Password is required for FTP/FTPS connections.');
    }

    await this.disconnect(options.connectionId);
    throwIfOperationCancelled(cancellationToken);

    const client = new FtpClient(30000);
    const cancellationSubscription = cancellationToken?.onCancellationRequested(() => {
      this.closeClient(client);
    });

    try {
      const secureOptions = await buildFtpsSecureOptions(options);
      await client.access({
        host: options.host,
        port: options.port,
        user: options.username,
        password: options.password,
        secure: connectionType === 'ftps',
        secureOptions
      });

      throwIfOperationCancelled(cancellationToken);

      const homePath = await this.safePwd(client);
      const requestedStartPath = normalizeRemotePath(options.startPath || homePath || '/');
      const startPath = await this.resolveStartPath(client, requestedStartPath, homePath);

      throwIfOperationCancelled(cancellationToken);
      cancellationSubscription?.dispose();

      this.sessions.set(options.connectionId, client);

      const connection: ActiveConnection = {
        id: options.connectionId,
        connectionType,
        name: options.name || `${options.username}@${options.host}`,
        host: options.host,
        port: options.port,
        username: options.username,
        authType: 'password',
        startPath,
        keepAlive: options.keepAlive !== false,
        ftpsAllowSelfSignedCertificate: connectionType === 'ftps' ? Boolean(options.ftpsAllowSelfSignedCertificate) : false,
        ftpsCaCertificatePath: connectionType === 'ftps' ? String(options.ftpsCaCertificatePath || '').trim() : undefined
      };

      this.connections.set(options.connectionId, connection);
      this.connectOptions.set(options.connectionId, this.createStoredConnectOptions(options, connectionType));
      this.reconnectRequired.delete(options.connectionId);
      this.startKeepAlive(options.connectionId, client, options.keepAlive !== false);
      return connection;
    } catch (error) {
      cancellationSubscription?.dispose();
      this.closeClient(client);

      if (cancellationToken?.isCancellationRequested) {
        throw new RemoteEditOperationCancelledError('Connection cancelled.');
      }

      throw error;
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    const client = this.sessions.get(connectionId);

    this.stopKeepAlive(connectionId);

    if (client) {
      this.closeClient(client);
    }

    this.sessions.delete(connectionId);
    this.connections.delete(connectionId);
    this.connectOptions.delete(connectionId);
    this.reconnectRequired.delete(connectionId);
    this.clearReadFileCache(connectionId);
    this.clearDirectoryListingCache(connectionId);
    this.clearInFlightDirectoryListings(connectionId);
    this.operationQueues.delete(connectionId);
  }

  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map(id => this.disconnect(id)));
  }

  getConnection(connectionId: string): ActiveConnection | undefined {
    return this.connections.get(connectionId);
  }

  listConnections(): ActiveConnection[] {
    return Array.from(this.connections.values());
  }

  hasConnection(connectionId: string): boolean {
    return this.sessions.has(connectionId);
  }

  async listDirectory(connectionId: string, remotePath: string, options: RemoteListDirectoryOptions = {}): Promise<RemoteEntry[]> {
    const normalizedPath = normalizeRemotePath(remotePath);
    const totalTimer = createPerformanceTimer();
    const cacheTtlSeconds = getNumberSetting('directoryListingCacheTtl', 30, 0, 300);
    const cacheEnabled = cacheTtlSeconds > 0;
    const cacheKey = this.buildDirectoryListingCacheKey(connectionId, normalizedPath);

    if (cacheEnabled && !options.forceRefresh) {
      const cached = this.directoryListingCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        const cachedEntries = cloneRemoteEntries(cached.entries);
        appendPerformanceLog(this.output, 'FTP', `listDirectory ${normalizedPath}`, {
          cache: 'hit',
          items: cachedEntries.length,
          total: `${totalTimer()}ms`
        });
        return cachedEntries;
      }
    }

    const inFlight = this.inFlightDirectoryListings.get(cacheKey);
    if (inFlight) {
      const entries = await inFlight.promise;
      const clonedEntries = cloneRemoteEntries(entries);
      appendPerformanceLog(this.output, 'FTP', `listDirectory ${normalizedPath}`, {
        cache: 'inflight',
        items: clonedEntries.length,
        wait: `${Date.now() - inFlight.startedAt}ms`,
        total: `${totalTimer()}ms`
      });
      return clonedEntries;
    }

    const listingPromise = this.runQueued(connectionId, async () => {
      const client = this.getClient(connectionId);
      const cacheState = cacheEnabled ? (options.forceRefresh ? 'refresh' : 'miss') : 'disabled';
      const queuedTotalTimer = createPerformanceTimer();
      const listing = await this.listDirectoryWithMergedMetadata(client, normalizedPath);

      const mapTimer = createPerformanceTimer();
      const entries = listing.items
        .filter(item => item.name !== '.' && item.name !== '..')
        .map(item => mapFtpFileInfo(item, normalizedPath));
      const mapMs = mapTimer();

      const sortTimer = createPerformanceTimer();
      const sortedEntries = sortRemoteEntries(entries);
      const sortMs = sortTimer();

      if (cacheEnabled) {
        this.directoryListingCache.set(cacheKey, {
          entries: cloneRemoteEntries(sortedEntries),
          expiresAt: Date.now() + cacheTtlSeconds * 1000
        });
      }

      appendPerformanceLog(this.output, 'FTP', `listDirectory ${normalizedPath}`, {
        cache: cacheState,
        items: sortedEntries.length,
        command: listing.primaryCommand || 'unknown',
        list: `${listing.primaryListMs}ms`,
        merge: `${listing.listMergeMs}ms`,
        merged: listing.merged,
        map: `${mapMs}ms`,
        sort: `${sortMs}ms`,
        total: `${queuedTotalTimer()}ms`
      });

      return cloneRemoteEntries(sortedEntries);
    });

    this.inFlightDirectoryListings.set(cacheKey, {
      promise: listingPromise,
      startedAt: Date.now()
    });

    try {
      return cloneRemoteEntries(await listingPromise);
    } finally {
      const current = this.inFlightDirectoryListings.get(cacheKey);
      if (current?.promise === listingPromise) {
        this.inFlightDirectoryListings.delete(cacheKey);
      }
    }
  }


  private async listDirectoryWithMergedMetadata(client: FtpClient, remotePath: string): Promise<FtpMergedListResult> {
    const primaryTimer = createPerformanceTimer();
    const primaryListing = await this.listDirectoryWithCommandDetails(client, remotePath);
    const primaryListMs = primaryTimer();

    if (!isMlsdListCommand(primaryListing.command)) {
      return {
        items: primaryListing.items,
        primaryCommand: primaryListing.command,
        primaryListMs,
        listMergeMs: 0,
        merged: false
      };
    }

    const mergeTimer = createPerformanceTimer();
    const listListing = await this.tryListDirectoryWithCommands(client, remotePath, ['LIST -a', 'LIST']);
    const listMergeMs = mergeTimer();

    if (!listListing) {
      return {
        items: primaryListing.items,
        primaryCommand: primaryListing.command,
        primaryListMs,
        listMergeMs,
        merged: false
      };
    }

    return {
      items: mergeFtpMetadata(primaryListing.items, listListing.items),
      primaryCommand: primaryListing.command,
      primaryListMs,
      listMergeMs,
      merged: true
    };
  }

  private async listDirectoryWithCommandDetails(client: FtpClient, remotePath: string): Promise<FtpListResult> {
    const items = await client.list(remotePath);
    const command = Array.isArray(client.availableListCommands) && client.availableListCommands.length > 0
      ? String(client.availableListCommands[0] || '')
      : '';

    return { items, command };
  }

  private async tryListDirectoryWithCommands(client: FtpClient, remotePath: string, commands: string[]): Promise<FtpListResult | undefined> {
    const originalCommands = Array.isArray(client.availableListCommands)
      ? [...client.availableListCommands]
      : [];

    try {
      client.availableListCommands = [...commands];
      return await this.listDirectoryWithCommandDetails(client, remotePath);
    } catch {
      return undefined;
    } finally {
      client.availableListCommands = originalCommands;
    }
  }

  async prepareFileForOpen(connectionId: string, remotePath: string, cancellationToken?: ConnectionCancellationToken, progress?: RemoteEditProgressReporter): Promise<void> {
    const normalizedPath = normalizeRemotePath(remotePath);
    const content = await this.readRemoteFile(connectionId, normalizedPath, cancellationToken, progress);

    this.readFileCache.set(this.buildReadFileCacheKey(connectionId, normalizedPath), {
      content,
      expiresAt: Date.now() + 30000
    });
  }

  async readFile(connectionId: string, remotePath: string, cancellationToken?: ConnectionCancellationToken, progress?: RemoteEditProgressReporter): Promise<Buffer> {
    const normalizedPath = normalizeRemotePath(remotePath);
    const cacheKey = this.buildReadFileCacheKey(connectionId, normalizedPath);
    const cached = this.readFileCache.get(cacheKey);

    if (cached) {
      this.readFileCache.delete(cacheKey);
      if (cached.expiresAt > Date.now()) {
        return Buffer.from(cached.content);
      }
    }

    return await this.readRemoteFile(connectionId, normalizedPath, cancellationToken, progress);
  }

  async writeFile(connectionId: string, remotePath: string, content: Uint8Array, progress?: RemoteEditProgressReporter, cancellationToken?: ConnectionCancellationToken): Promise<void> {
    const normalizedPath = normalizeRemotePath(remotePath);
    const buffer = Buffer.from(content);

    await this.runQueued(connectionId, async () => {
      const client = this.getClient(connectionId);
      let reportedBytes = 0;

      throwIfOperationCancelled(cancellationToken);
      client.trackProgress(info => {
        if (info.type !== 'upload') {
          return;
        }

        reportedBytes = Math.max(reportedBytes, Number(info.bytes || 0));
        progress?.reportBytes('Saving remote file...', reportedBytes, buffer.length);
      });

      const cancellationSubscription = cancellationToken?.onCancellationRequested(() => {
        this.abortActiveTransfer(client);
      });

      try {
        await client.uploadFrom(Readable.from(buffer), normalizedPath);
        throwIfOperationCancelled(cancellationToken);
        progress?.reportBytes('Saving remote file...', buffer.length, buffer.length);
        this.clearReadFileCache(connectionId, normalizedPath);
      } catch (error) {
        if (cancellationToken?.isCancellationRequested) {
          if (client.closed) {
            this.markClientForReconnect(connectionId, client, 'cancelled-upload');
          }
          throw new RemoteEditOperationCancelledError('Operation cancelled.');
        }

        throw error;
      } finally {
        cancellationSubscription?.dispose();
        if (cancellationToken?.isCancellationRequested && client.closed) {
          this.markClientForReconnect(connectionId, client, 'cancelled-upload');
        }
        try {
          client.trackProgress();
        } catch {
          // Ignore cleanup errors.
        }
      }
    });
  }

  async stat(connectionId: string, remotePath: string): Promise<RemoteStat> {
    const normalizedPath = normalizeRemotePath(remotePath);

    return await this.runQueued(connectionId, async () => {
      const client = this.getClient(connectionId);
      return await this.statUnqueued(client, normalizedPath);
    });
  }

  private async statUnqueued(client: FtpClient, normalizedPath: string): Promise<RemoteStat> {
    if (normalizedPath === '/') {
      return {
        type: 'directory',
        size: 0,
        modifyTime: 0,
        accessTime: 0
      };
    }

    const entry = await this.findEntry(client, normalizedPath);

    if (entry) {
      return {
        type: mapFtpStatType(entry),
        size: Number(entry.size || 0),
        modifyTime: getFtpModifyTime(entry),
        accessTime: 0
      };
    }

    try {
      await client.list(normalizedPath);
      return {
        type: 'directory',
        size: 0,
        modifyTime: 0,
        accessTime: 0
      };
    } catch {
      // Try file metadata below.
    }

    let size: number | undefined;
    let modifyTime = 0;
    let metadataError: unknown;

    try {
      size = await client.size(normalizedPath);
    } catch (error) {
      metadataError = error;
    }

    try {
      modifyTime = await client.lastMod(normalizedPath).then(date => date.getTime());
    } catch {
      // Modification time is optional for FTP servers.
    }

    if (size === undefined && modifyTime <= 0) {
      throw metadataError || new Error(`Could not stat remote path ${normalizedPath}.`);
    }

    return {
      type: 'file',
      size: Number(size || 0),
      modifyTime: Number(modifyTime || 0),
      accessTime: 0
    };
  }

  async createFile(connectionId: string, remotePath: string): Promise<void> {
    const normalizedPath = normalizeRemotePath(remotePath);

    await this.runQueued(connectionId, async () => {
      const client = this.getClient(connectionId);

      if (await this.pathExists(client, normalizedPath)) {
        throw new Error(`Remote path already exists: ${normalizedPath}`);
      }

      await client.uploadFrom(Readable.from(Buffer.alloc(0)), normalizedPath);
      this.clearReadFileCache(connectionId, normalizedPath);
    });
  }

  async createDirectory(connectionId: string, remotePath: string): Promise<void> {
    const normalizedPath = normalizeRemotePath(remotePath);

    await this.runQueued(connectionId, async () => {
      const client = this.getClient(connectionId);
      const previousPath = await this.safePwd(client);

      try {
        await client.ensureDir(normalizedPath);
      } finally {
        await this.tryCd(client, previousPath);
      }

      this.clearReadFileCache(connectionId, normalizedPath);
    });
  }

  async delete(connectionId: string, remotePath: string): Promise<void> {
    const normalizedPath = normalizeRemotePath(remotePath);

    await this.runQueued(connectionId, async () => {
      const client = this.getClient(connectionId);
      const stat = await this.statUnqueued(client, normalizedPath);

      if (stat.type === 'directory') {
        await client.removeDir(normalizedPath);
      } else {
        await client.remove(normalizedPath);
      }

      this.clearReadFileCache(connectionId, normalizedPath);
    });
  }

  async rename(connectionId: string, oldPath: string, newPath: string): Promise<void> {
    const normalizedOldPath = normalizeRemotePath(oldPath);
    const normalizedNewPath = normalizeRemotePath(newPath);

    await this.runQueued(connectionId, async () => {
      const client = this.getClient(connectionId);
      await client.rename(normalizedOldPath, normalizedNewPath);
      this.clearReadFileCache(connectionId, normalizedOldPath);
      this.clearReadFileCache(connectionId, normalizedNewPath);
    });
  }

  async copyFile(connectionId: string, sourcePath: string, targetPath: string, overwrite = false, cancellationToken?: ConnectionCancellationToken): Promise<void> {
    const normalizedSourcePath = normalizeRemotePath(sourcePath);
    const normalizedTargetPath = normalizeRemotePath(targetPath);

    if (!overwrite) {
      const exists = await this.runQueued(connectionId, async () => {
        const client = this.getClient(connectionId);
        return await this.pathExists(client, normalizedTargetPath);
      });

      if (exists) {
        throw new Error('Target already exists.');
      }
    }

    const content = await this.readRemoteFile(connectionId, normalizedSourcePath, cancellationToken);
    await this.writeFile(connectionId, normalizedTargetPath, content, undefined, cancellationToken);
  }

  async createArchive(
    _connectionId: string,
    _baseDirectory: string,
    _entryNames: string[],
    _archiveName: string,
    _format: RemoteArchiveFormat,
    _overwrite = false,
    _cancellationToken?: ConnectionCancellationToken
  ): Promise<void> {
    throw createUnsupportedError('Create Archive');
  }

  async calculateChecksums(_connectionId: string, _remotePath: string, _cancellationToken?: ConnectionCancellationToken): Promise<RemoteChecksumSummary> {
    throw createUnsupportedError('Calculate Checksums');
  }

  async changeOwnerGroup(_connectionId: string, _remotePath: string, _options: RemoteChangeOwnerGroupOptions): Promise<void> {
    throw createUnsupportedError('Change owner/group');
  }

  async chmod(_connectionId: string, _remotePath: string, _mode: string | number, _options: RemoteChmodOptions = {}): Promise<void> {
    throw createUnsupportedError('Set permissions');
  }

  async enableSudoMode(_connectionId: string, _password: string): Promise<void> {
    throw createUnsupportedError('Sudo Mode');
  }

  disableSudoMode(_connectionId: string): void {
    // FTP/FTPS does not support sudo mode.
  }

  isSudoModeEnabled(_connectionId: string): boolean {
    return false;
  }

  async runRemoteCommandStreaming(
    _connectionId: string,
    _workingDirectory: string,
    _command: string,
    _callbacks?: RemoteCommandStreamingCallbacks,
    _cancellationToken?: ConnectionCancellationToken
  ): Promise<RemoteCommandStreamingResult> {
    throw createUnsupportedError('Run Command');
  }

  private async runQueued<T>(connectionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueues.get(connectionId) || Promise.resolve();

    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const endConnectionOperation = this.beginConnectionOperation(connectionId);
        try {
          await this.ensureClientReady(connectionId);
          return await operation();
        } finally {
          endConnectionOperation();
        }
      });

    const tracked = current.catch(() => undefined);
    this.operationQueues.set(connectionId, tracked);
    void tracked.finally(() => {
      if (this.operationQueues.get(connectionId) === tracked) {
        this.operationQueues.delete(connectionId);
      }
    });

    return await current;
  }

  private getClient(connectionId: string): FtpClient {
    const client = this.sessions.get(connectionId);

    if (!client || client.closed) {
      throw new Error(`Remote Edit connection '${connectionId}' is not connected.`);
    }

    this.touchConnectionActivity(connectionId);
    return client;
  }

  private async ensureClientReady(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);

    if (!connection) {
      throw new Error(`Remote Edit connection '${connectionId}' is not connected.`);
    }

    const client = this.sessions.get(connectionId);

    if (client && !client.closed && !this.reconnectRequired.has(connectionId)) {
      this.touchConnectionActivity(connectionId);
      return;
    }

    await this.reconnectClient(connectionId);
  }

  private async reconnectClient(connectionId: string): Promise<void> {
    const options = this.connectOptions.get(connectionId);
    const connection = this.connections.get(connectionId);

    if (!options || !connection) {
      throw new Error(`Remote Edit connection '${connectionId}' is not connected.`);
    }

    const oldClient = this.sessions.get(connectionId);

    if (oldClient) {
      this.closeClient(oldClient);
    }

    this.stopKeepAliveTimerOnly(connectionId);
    this.sessions.delete(connectionId);

    const client = new FtpClient(30000);

    appendDebugLog(this.output, 'FTP', `reconnecting client ${connectionId}`);

    try {
      const secureOptions = await buildFtpsSecureOptions(options);
      await client.access({
        host: options.host,
        port: options.port,
        user: options.username,
        password: options.password,
        secure: options.connectionType === 'ftps',
        secureOptions
      });

      this.sessions.set(connectionId, client);
      this.reconnectRequired.delete(connectionId);
      this.startKeepAlive(connectionId, client, connection.keepAlive !== false);
      this.touchConnectionActivity(connectionId);

      appendDebugLog(this.output, 'FTP', `reconnected client ${connectionId}`, {
        status: 'success'
      });
    } catch (error) {
      this.closeClient(client);
      this.reconnectRequired.add(connectionId);
      appendDebugLog(this.output, 'FTP', `reconnect failed ${connectionId}`, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private createStoredConnectOptions(options: ConnectOptions, connectionType: 'ftp' | 'ftps'): StoredFtpConnectOptions {
    return {
      ...options,
      connectionType,
      authType: 'password',
      password: options.password || ''
    };
  }

  private markClientForReconnect(connectionId: string, client: FtpClient, reason: string): void {
    if (this.sessions.get(connectionId) !== client) {
      return;
    }

    if (this.reconnectRequired.has(connectionId)) {
      return;
    }

    this.reconnectRequired.add(connectionId);
    this.clearReadFileCache(connectionId);
    this.clearInFlightDirectoryListings(connectionId);
    this.stopKeepAliveTimerOnly(connectionId);

    appendDebugLog(this.output, 'FTP', `client marked for reconnect ${connectionId}`, {
      reason
    });
  }

  private closeClient(client: FtpClient): void {
    try {
      client.close();
    } catch {
      // Ignore cleanup errors.
    }
  }

  private abortActiveTransfer(client: FtpClient): void {
    try {
      const ftpContext = (client as any).ftp;
      const dataSocket = ftpContext?.dataSocket;

      if (dataSocket && !dataSocket.destroyed) {
        dataSocket.destroy();
      }
    } catch {
      // Ignore best-effort transfer abort errors.
    }
  }

  private startKeepAlive(connectionId: string, client: FtpClient, enabled: boolean): void {
    this.stopKeepAlive(connectionId);
    this.touchConnectionActivity(connectionId);

    if (!enabled) {
      return;
    }

    const intervalMs = getNumberSetting('ftpKeepAliveInterval', 30000, 1000, 300000);
    const timer = setInterval(() => {
      void this.sendKeepAlive(connectionId, client, intervalMs);
    }, intervalMs);

    (timer as any).unref?.();
    this.keepAliveTimers.set(connectionId, timer);
  }

  private stopKeepAlive(connectionId: string): void {
    this.stopKeepAliveTimerOnly(connectionId);
    this.keepAliveInFlight.delete(connectionId);
    this.busyConnectionCounts.delete(connectionId);
    this.lastActivityTimes.delete(connectionId);
  }

  private stopKeepAliveTimerOnly(connectionId: string): void {
    const timer = this.keepAliveTimers.get(connectionId);

    if (timer) {
      clearInterval(timer);
    }

    this.keepAliveTimers.delete(connectionId);
  }

  private touchConnectionActivity(connectionId: string): void {
    this.lastActivityTimes.set(connectionId, Date.now());
  }

  private beginConnectionOperation(connectionId: string): () => void {
    this.touchConnectionActivity(connectionId);
    this.busyConnectionCounts.set(connectionId, (this.busyConnectionCounts.get(connectionId) || 0) + 1);

    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }

      disposed = true;
      const nextCount = Math.max(0, (this.busyConnectionCounts.get(connectionId) || 1) - 1);

      if (nextCount > 0) {
        this.busyConnectionCounts.set(connectionId, nextCount);
      } else {
        this.busyConnectionCounts.delete(connectionId);
      }

      this.touchConnectionActivity(connectionId);
    };
  }

  private async sendKeepAlive(connectionId: string, client: FtpClient, intervalMs: number): Promise<void> {
    if (this.sessions.get(connectionId) !== client || client.closed) {
      this.closeConnectionAfterKeepAliveFailure(connectionId, client);
      return;
    }

    if ((this.busyConnectionCounts.get(connectionId) || 0) > 0 || this.keepAliveInFlight.has(connectionId) || this.operationQueues.has(connectionId)) {
      return;
    }

    const lastActivity = this.lastActivityTimes.get(connectionId) || 0;

    if (Date.now() - lastActivity < intervalMs) {
      return;
    }

    this.keepAliveInFlight.add(connectionId);

    try {
      const rawClient = client as any;

      if (typeof rawClient.sendIgnoringError === 'function') {
        await rawClient.sendIgnoringError('NOOP');
      } else if (typeof rawClient.send === 'function') {
        await rawClient.send('NOOP');
      } else {
        await client.pwd();
      }

      this.touchConnectionActivity(connectionId);
    } catch {
      this.closeConnectionAfterKeepAliveFailure(connectionId, client);
    } finally {
      this.keepAliveInFlight.delete(connectionId);
    }
  }

  private closeConnectionAfterKeepAliveFailure(connectionId: string, client: FtpClient): void {
    this.closeClient(client);
    this.stopKeepAlive(connectionId);
    this.sessions.delete(connectionId);
    this.connections.delete(connectionId);
    this.connectOptions.delete(connectionId);
    this.reconnectRequired.delete(connectionId);
    this.clearReadFileCache(connectionId);
    this.clearInFlightDirectoryListings(connectionId);
    this.operationQueues.delete(connectionId);
  }

  private closeConnectionAfterCancellation(connectionId: string, client: FtpClient): void {
    this.closeClient(client);
    this.stopKeepAlive(connectionId);
    this.sessions.delete(connectionId);
    this.connections.delete(connectionId);
    this.connectOptions.delete(connectionId);
    this.reconnectRequired.delete(connectionId);
    this.clearReadFileCache(connectionId);
    this.clearInFlightDirectoryListings(connectionId);
    this.operationQueues.delete(connectionId);
  }

  private async safePwd(client: FtpClient): Promise<string> {
    try {
      const pwd = await client.pwd();
      return normalizeRemotePath(pwd || '/');
    } catch {
      return '/';
    }
  }

  private async tryCd(client: FtpClient, remotePath: string): Promise<void> {
    try {
      await client.cd(normalizeRemotePath(remotePath));
    } catch {
      // Ignore best-effort current directory restore errors.
    }
  }

  private async resolveStartPath(client: FtpClient, requestedStartPath: string, homePath: string): Promise<string> {
    const candidates = Array.from(new Set([
      requestedStartPath,
      homePath || '/',
      '/'
    ].map(normalizeRemotePath)));

    for (const candidate of candidates) {
      try {
        await client.list(candidate);
        return candidate;
      } catch {
        // Try the next fallback path.
      }
    }

    return '/';
  }

  private async readRemoteFile(connectionId: string, normalizedPath: string, cancellationToken?: ConnectionCancellationToken, progress?: RemoteEditProgressReporter): Promise<Buffer> {
    return await this.runQueued(connectionId, async () => {
      const client = this.getClient(connectionId);
      const totalBytes = await client.size(normalizedPath).catch(() => 0);
      const chunks: Buffer[] = [];
      let transferredBytes = 0;

      throwIfOperationCancelled(cancellationToken);

      const sink = new Writable({
        write(chunk, _encoding, callback) {
          if (cancellationToken?.isCancellationRequested) {
            callback();
            return;
          }

          const bufferChunk = Buffer.isBuffer(chunk)
            ? chunk
            : chunk instanceof Uint8Array
              ? Buffer.from(chunk)
              : Buffer.from(String(chunk));

          chunks.push(bufferChunk);
          transferredBytes += bufferChunk.length;
          progress?.reportBytes('Opening remote file...', transferredBytes, Number(totalBytes || 0));
          callback();
        }
      });

      const cancellationSubscription = cancellationToken?.onCancellationRequested(() => {
        this.abortActiveTransfer(client);
      });

      try {
        await client.downloadTo(sink, normalizedPath);
        throwIfOperationCancelled(cancellationToken);
        return Buffer.concat(chunks);
      } catch (error) {
        if (cancellationToken?.isCancellationRequested) {
          if (client.closed) {
            this.markClientForReconnect(connectionId, client, 'cancelled-download');
          }
          throw new RemoteEditOperationCancelledError('Operation cancelled.');
        }

        throw error;
      } finally {
        cancellationSubscription?.dispose();
        if (cancellationToken?.isCancellationRequested && client.closed) {
          this.markClientForReconnect(connectionId, client, 'cancelled-download');
        }
      }
    });
  }

  private async findEntry(client: FtpClient, normalizedPath: string): Promise<FileInfo | undefined> {
    const parentPath = dirnameRemotePath(normalizedPath);
    const name = basenameRemotePath(normalizedPath);

    if (!name) {
      return undefined;
    }

    try {
      const items = await client.list(parentPath);
      return items.find(item => item.name === name);
    } catch {
      return undefined;
    }
  }

  private async pathExists(client: FtpClient, normalizedPath: string): Promise<boolean> {
    if (await this.findEntry(client, normalizedPath)) {
      return true;
    }

    try {
      await client.size(normalizedPath);
      return true;
    } catch {
      // Try directory listing below.
    }

    try {
      await client.list(normalizedPath);
      return true;
    } catch {
      return false;
    }
  }

  private buildDirectoryListingCacheKey(connectionId: string, remotePath: string): string {
    return `${connectionId}:${normalizeRemotePath(remotePath)}`;
  }

  private clearDirectoryListingCache(connectionId: string, remotePath?: string): void {
    if (remotePath) {
      const key = this.buildDirectoryListingCacheKey(connectionId, remotePath);
      const deleted = this.directoryListingCache.delete(key);
      if (deleted) {
        appendDebugLog(this.output, 'Cache', 'invalidated directory listing', {
          connection: connectionId,
          path: normalizeRemotePath(remotePath)
        });
      }
      return;
    }

    let deletedCount = 0;
    const prefix = `${connectionId}:`;
    for (const key of Array.from(this.directoryListingCache.keys())) {
      if (key.startsWith(prefix)) {
        this.directoryListingCache.delete(key);
        deletedCount += 1;
      }
    }

    if (deletedCount > 0) {
      appendDebugLog(this.output, 'Cache', 'cleared directory listing cache', {
        connection: connectionId,
        entries: deletedCount
      });
    }
  }

  private invalidateDirectoryListingForPath(connectionId: string, remotePath: string): void {
    const normalizedPath = normalizeRemotePath(remotePath);
    this.clearDirectoryListingCache(connectionId, normalizedPath);
    this.clearDirectoryListingCache(connectionId, dirnameRemotePath(normalizedPath));
    this.clearInFlightDirectoryListings(connectionId, normalizedPath);
    this.clearInFlightDirectoryListings(connectionId, dirnameRemotePath(normalizedPath));
  }

  private clearInFlightDirectoryListings(connectionId: string, remotePath?: string): void {
    if (remotePath) {
      this.inFlightDirectoryListings.delete(this.buildDirectoryListingCacheKey(connectionId, remotePath));
      return;
    }

    const prefix = `${connectionId}:`;
    for (const key of Array.from(this.inFlightDirectoryListings.keys())) {
      if (key.startsWith(prefix)) {
        this.inFlightDirectoryListings.delete(key);
      }
    }
  }

  private buildReadFileCacheKey(connectionId: string, remotePath: string): string {
    return `${connectionId}:${normalizeRemotePath(remotePath)}`;
  }

  private clearReadFileCache(connectionId: string, remotePath?: string): void {
    if (remotePath) {
      this.readFileCache.delete(this.buildReadFileCacheKey(connectionId, remotePath));
      this.invalidateDirectoryListingForPath(connectionId, remotePath);
      return;
    }

    const prefix = `${connectionId}:`;
    for (const key of Array.from(this.readFileCache.keys())) {
      if (key.startsWith(prefix)) {
        this.readFileCache.delete(key);
      }
    }
    this.clearDirectoryListingCache(connectionId);
  }
}


function isMlsdListCommand(command: string): boolean {
  return String(command || '').trim().toUpperCase().startsWith('MLSD');
}

function mergeFtpMetadata(primaryItems: FileInfo[], listItems: FileInfo[]): FileInfo[] {
  const listItemsByName = new Map<string, FileInfo>();

  for (const item of listItems) {
    if (item.name && !listItemsByName.has(item.name)) {
      listItemsByName.set(item.name, item);
    }
  }

  return primaryItems.map(primaryItem => {
    const listItem = listItemsByName.get(primaryItem.name);

    if (!listItem) {
      return primaryItem;
    }

    return mergeFtpFileInfo(primaryItem, listItem);
  });
}

function mergeFtpFileInfo(primaryItem: FileInfo, listItem: FileInfo): FileInfo {
  if (hasListMetadata(listItem)) {
    if (hasPositiveSize(listItem) && !hasPositiveSize(primaryItem)) {
      primaryItem.size = listItem.size;
    }

    if (listItem.modifiedAt && !primaryItem.modifiedAt) {
      primaryItem.modifiedAt = listItem.modifiedAt;
    }

    if (listItem.user) {
      primaryItem.user = listItem.user;
    }

    if (listItem.group) {
      primaryItem.group = listItem.group;
    }

    if (listItem.permissions) {
      primaryItem.permissions = listItem.permissions;
    }

    if (listItem.link && !primaryItem.link) {
      primaryItem.link = listItem.link;
    }
  }

  return primaryItem;
}

function hasListMetadata(item: FileInfo): boolean {
  return Boolean(
    hasPositiveSize(item) ||
    item.modifiedAt ||
    item.user ||
    item.group ||
    item.permissions ||
    item.link
  );
}

function hasPositiveSize(item: FileInfo): boolean {
  return Number.isFinite(Number(item.size)) && Number(item.size) > 0;
}

function mapFtpFileInfo(item: FileInfo, parentPath: string): RemoteEntry {
  const linkTarget = String(item.link || '').trim() || undefined;
  const type = mapFtpEntryType(item);

  return {
    name: item.name,
    type,
    effectiveType: undefined,
    linkTarget,
    size: Number(item.size || 0),
    modifyTime: getFtpModifyTime(item),
    accessTime: 0,
    owner: item.user || '',
    group: item.group || '',
    permissions: buildFtpPermissionString(item),
    path: joinRemotePath(parentPath, item.name)
  };
}

function mapFtpEntryType(item: FileInfo): RemoteEntryType {
  if (item.type === FileType.Directory || item.isDirectory) {
    return 'directory';
  }

  if (item.type === FileType.SymbolicLink || item.isSymbolicLink) {
    return 'link';
  }

  if (item.type === FileType.File || item.isFile) {
    return 'file';
  }

  return 'unknown';
}


function mapFtpStatType(item: FileInfo): RemoteStat['type'] {
  const entryType = mapFtpEntryType(item);
  return entryType === 'link' ? 'unknown' : entryType;
}

function buildFtpPermissionString(item: FileInfo): string {
  const typePrefix = mapFtpEntryType(item) === 'directory'
    ? 'd'
    : mapFtpEntryType(item) === 'link'
      ? 'l'
      : mapFtpEntryType(item) === 'file'
        ? '-'
        : '?';

  if (!item.permissions) {
    return `${typePrefix}?????????`;
  }

  return typePrefix +
    formatPermissionBits(item.permissions.user) +
    formatPermissionBits(item.permissions.group) +
    formatPermissionBits(item.permissions.world);
}

function formatPermissionBits(value: number): string {
  const safeValue = Number(value || 0);
  return `${safeValue & FileInfo.UnixPermission.Read ? 'r' : '-'}${safeValue & FileInfo.UnixPermission.Write ? 'w' : '-'}${safeValue & FileInfo.UnixPermission.Execute ? 'x' : '-'}`;
}

function getFtpModifyTime(item: FileInfo): number {
  const modifiedAt = item.modifiedAt?.getTime();
  return Number.isFinite(modifiedAt) ? Number(modifiedAt) : 0;
}

function cloneRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.map(entry => ({ ...entry }));
}

function sortRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.sort((a, b) => {
    const aDirectory = a.type === 'directory' || a.effectiveType === 'directory';
    const bDirectory = b.type === 'directory' || b.effectiveType === 'directory';

    if (aDirectory !== bDirectory) {
      return aDirectory ? -1 : 1;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function normalizeRemotePath(remotePath: string): string {
  const trimmed = (remotePath || '/').trim();

  if (!trimmed || trimmed === '.') {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+/g, '/').replace(/\/\/$/, '') || '/';
}

function joinRemotePath(parent: string, child: string): string {
  const normalizedParent = normalizeRemotePath(parent);

  if (normalizedParent === '/') {
    return `/${child}`;
  }

  return `${normalizedParent}/${child}`.replace(/\/+/g, '/');
}

function dirnameRemotePath(remotePath: string): string {
  const normalizedPath = normalizeRemotePath(remotePath);

  if (normalizedPath === '/') {
    return '/';
  }

  const index = normalizedPath.lastIndexOf('/');
  return index <= 0 ? '/' : normalizedPath.slice(0, index);
}

function basenameRemotePath(remotePath: string): string {
  const normalizedPath = normalizeRemotePath(remotePath);

  if (normalizedPath === '/') {
    return '';
  }

  const index = normalizedPath.lastIndexOf('/');
  return index === -1 ? normalizedPath : normalizedPath.slice(index + 1);
}


async function buildFtpsSecureOptions(options: ConnectOptions): Promise<Record<string, unknown> | undefined> {
  if (normalizeConnectionType(options.connectionType) !== 'ftps') {
    return undefined;
  }

  if (options.ftpsAllowSelfSignedCertificate) {
    return { rejectUnauthorized: false };
  }

  const caCertificatePath = String(options.ftpsCaCertificatePath || '').trim();

  if (!caCertificatePath) {
    throw new Error('CA certificate path is required for FTPS unless self-signed/untrusted certificates are allowed.');
  }

  try {
    return {
      rejectUnauthorized: true,
      ca: await fs.readFile(caCertificatePath)
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read FTPS CA certificate file: ${caCertificatePath}. Check the path and file permissions. Details: ${details}`);
  }
}

function throwIfOperationCancelled(cancellationToken?: ConnectionCancellationToken): void {
  if (cancellationToken?.isCancellationRequested) {
    throw new RemoteEditOperationCancelledError('Operation cancelled.');
  }
}

function createUnsupportedError(actionName: string): Error {
  return new Error(`${actionName} is available only for SFTP connections.`);
}
