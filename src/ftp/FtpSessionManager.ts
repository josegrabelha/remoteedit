import { Readable, Writable } from 'stream';
import * as vscode from 'vscode';
import { Client as FtpClient, FileInfo, FileType } from 'basic-ftp';
import { RemoteEditOperationCancelledError, type RemoteEditProgressReporter } from '../utils/progressUtils';
import { assertTcpConnectionReachable, normalizeRemoteConnectError } from '../remote/ConnectionProbe';
import { getBooleanSetting, getNumberSetting } from '../utils/settingsUtils';
import { appendDebugLog, appendPerformanceLog, createPerformanceTimer } from '../utils/outputLogger';
import { normalizeConnectionType } from '../remote/RemoteConnectionTypes';
import type { RemoteSessionManager, RemoteStat, RemoteListDirectoryOptions, RemoteChangeOwnerGroupOptions, RemoteChmodOptions, RemoteOwnerGroupSuggestions, RemoteEntryMetadataUpdate } from '../remote/RemoteSessionManager';
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
import { FtpKeepAliveController } from './FtpKeepAliveController';
import { appendFtpListCommandContext, basenameRemotePath, buildFtpPermissionString, buildFtpsSecureOptions, cloneRemoteEntries, createUnsupportedError, dirnameRemotePath, getFtpModifyTime, getSelfListingEntry, hasUsableFtpListItems, isListAllCommand, isMlsdListCommand, joinRemotePath, mergeFtpMetadata, mapFtpEntryType, mapFtpFileInfo, mapFtpStatType, normalizeRemotePath, sortRemoteEntries, throwIfOperationCancelled } from './SessionUtils';

interface CachedReadFile {
  content: Buffer;
  expiresAt: number;
}

interface CachedDirectoryListing {
  entries: RemoteEntry[];
  expiresAt: number;
}

interface CachedModifiedTime {
  modifyTime: number;
  expiresAt: number;
}

interface CachedModifiedTimeFailure {
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
  fallback?: string;
}

interface FtpMergedListResult {
  items: FileInfo[];
  primaryCommand: string;
  primaryListMs: number;
  listMergeMs: number;
  merged: boolean;
}

interface ModifiedTimeHydrationSummary {
  lookups: number;
  updated: number;
  failed: number;
  skippedCachedFailures: number;
  cancelled: boolean;
  elapsedMs: number;
}

interface ModifiedTimeHydrationOptions {
  maxLookups?: number;
  onUpdates?: (updates: RemoteEntryMetadataUpdate['updates']) => void;
}

interface FtpStatProbeResult {
  stat?: RemoteStat;
  error?: unknown;
}

export class FtpSessionManager implements RemoteSessionManager {
  private static readonly backgroundMdtmBatchSize = 100;
  private static readonly backgroundMdtmUpdateDebounceMs = 250;

  private readonly onRemoteEntryMetadataUpdatedEmitter = new vscode.EventEmitter<RemoteEntryMetadataUpdate>();
  readonly onRemoteEntryMetadataUpdated = this.onRemoteEntryMetadataUpdatedEmitter.event;

  private readonly keepAlive = new FtpKeepAliveController({
    isClientCurrent: (connectionId, client) => this.sessions.get(connectionId) === client,
    hasQueuedOperation: connectionId => this.operationQueues.has(connectionId),
    onFailure: (connectionId, client) => this.closeConnectionAfterKeepAliveFailure(connectionId, client)
  });

  constructor(private readonly output?: vscode.OutputChannel) {}

  private readonly sessions = new Map<string, FtpClient>();
  private readonly connections = new Map<string, ActiveConnection>();
  private readonly connectOptions = new Map<string, StoredFtpConnectOptions>();
  private readonly reconnectRequired = new Set<string>();
  private readonly readFileCache = new Map<string, CachedReadFile>();
  private readonly directoryListingCache = new Map<string, CachedDirectoryListing>();
  private readonly modifiedTimeCache = new Map<string, CachedModifiedTime>();
  private readonly modifiedTimeFailureCache = new Map<string, CachedModifiedTimeFailure>();
  private readonly modifiedTimeLookupTokens = new Map<string, number>();
  private readonly modifiedTimeClients = new Map<string, FtpClient>();
  private readonly modifiedTimeUpdateBuffers = new Map<string, RemoteEntryMetadataUpdate['updates']>();
  private readonly modifiedTimeUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlightDirectoryListings = new Map<string, InFlightDirectoryListing>();
  private readonly operationQueues = new Map<string, Promise<unknown>>();

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

    const connectTimeoutMs = 30000;
    const client = new FtpClient(connectTimeoutMs);
    const cancellationSubscription = cancellationToken?.onCancellationRequested(() => {
      this.closeClient(client);
    });

    try {
      const secureOptions = await buildFtpsSecureOptions(options);

      await assertTcpConnectionReachable({
        host: options.host,
        port: options.port,
        timeoutMs: connectTimeoutMs,
        protocolLabel: connectionType,
        cancellationToken
      });

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
        ftpsCaCertificatePath: connectionType === 'ftps' ? String(options.ftpsCaCertificatePath || '').trim() : undefined,
        isQuickConnect: Boolean(options.isQuickConnect)
      };

      this.connections.set(options.connectionId, connection);
      this.connectOptions.set(options.connectionId, this.createStoredConnectOptions(options, connectionType));
      this.reconnectRequired.delete(options.connectionId);
      this.keepAlive.start(options.connectionId, client, options.keepAlive !== false);
      return connection;
    } catch (error) {
      cancellationSubscription?.dispose();
      this.closeClient(client);

      if (cancellationToken?.isCancellationRequested) {
        throw new RemoteEditOperationCancelledError('Connection cancelled.');
      }

      throw normalizeRemoteConnectError(error, {
        host: options.host,
        port: options.port,
        timeoutMs: connectTimeoutMs,
        protocolLabel: connectionType
      });
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    const client = this.sessions.get(connectionId);

    this.keepAlive.stop(connectionId);

    if (client) {
      this.closeClient(client);
    }

    this.sessions.delete(connectionId);
    this.connections.delete(connectionId);
    this.connectOptions.delete(connectionId);
    this.reconnectRequired.delete(connectionId);
    this.clearReadFileCache(connectionId);
    this.clearDirectoryListingCache(connectionId);
    this.clearModifiedTimeCache(connectionId);
    this.clearModifiedTimeUpdateBuffer(connectionId);
    this.cancelModifiedTimeLookup(connectionId);
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
    const cacheTtlSeconds = this.getDirectoryListingCacheTtlSeconds();
    const cacheEnabled = cacheTtlSeconds > 0;
    const modifiedDateFallbackEnabled = this.isModifiedDateFallbackEnabled();
    const cacheKey = this.buildDirectoryListingCacheKey(connectionId, normalizedPath);

    if (!modifiedDateFallbackEnabled) {
      this.cancelModifiedTimeLookup(connectionId);
    }

    if (cacheEnabled && !options.forceRefresh) {
      const cached = this.directoryListingCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        const cachedEntries = cloneRemoteEntries(cached.entries);
        const lookupToken = modifiedDateFallbackEnabled ? this.beginModifiedTimeLookup(connectionId) : 0;
        const cachedModifiedTimes = modifiedDateFallbackEnabled
          ? this.applyCachedModifiedTimes(connectionId, cachedEntries, cacheTtlSeconds)
          : 0;
        const mdtm = modifiedDateFallbackEnabled
          ? this.scheduleBackgroundModifiedTimeHydration(connectionId, normalizedPath, cachedEntries, cacheTtlSeconds, lookupToken, cacheKey)
          : this.createDisabledModifiedTimeHydrationSummary();

        this.directoryListingCache.set(cacheKey, {
          entries: cloneRemoteEntries(cachedEntries),
          expiresAt: Date.now() + cacheTtlSeconds * 1000
        });

        appendPerformanceLog(this.output, 'FTP', `listDirectory ${normalizedPath}`, {
          cache: 'hit',
          items: cachedEntries.length,
          mdtmEnabled: modifiedDateFallbackEnabled,
          mdtmCache: cachedModifiedTimes,
          mdtmLookups: mdtm.lookups,
          mdtmUpdated: mdtm.updated,
          mdtmFailed: mdtm.failed,
          mdtmSkipped: mdtm.skippedCachedFailures,
          mdtmCancelled: mdtm.cancelled,
          mdtm: `${mdtm.elapsedMs}ms`,
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

    const lookupToken = modifiedDateFallbackEnabled ? this.beginModifiedTimeLookup(connectionId) : 0;
    const cacheState = cacheEnabled ? (options.forceRefresh ? 'refresh' : 'miss') : 'disabled';

    const listingPromise = (async () => {
      const queuedTotalTimer = createPerformanceTimer();
      const listed = await this.runQueued(connectionId, async () => {
        const client = this.getClient(connectionId);
        const listing = await this.listDirectoryWithMergedMetadata(connectionId, client, normalizedPath);

        const mapTimer = createPerformanceTimer();
        const entries = listing.items
          .filter(item => item.name !== '.' && item.name !== '..')
          .map(item => mapFtpFileInfo(item, normalizedPath));
        const mapMs = mapTimer();

        const sortTimer = createPerformanceTimer();
        const sortedEntries = sortRemoteEntries(entries);
        const sortMs = sortTimer();

        return {
          sortedEntries,
          listing,
          mapMs,
          sortMs
        };
      });

      const cachedModifiedTimes = modifiedDateFallbackEnabled
        ? this.applyCachedModifiedTimes(connectionId, listed.sortedEntries, cacheTtlSeconds)
        : 0;
      const mdtm = modifiedDateFallbackEnabled
        ? this.scheduleBackgroundModifiedTimeHydration(connectionId, normalizedPath, listed.sortedEntries, cacheTtlSeconds, lookupToken, cacheKey)
        : this.createDisabledModifiedTimeHydrationSummary();

      if (cacheEnabled) {
        this.directoryListingCache.set(cacheKey, {
          entries: cloneRemoteEntries(listed.sortedEntries),
          expiresAt: Date.now() + cacheTtlSeconds * 1000
        });
      }

      appendPerformanceLog(this.output, 'FTP', `listDirectory ${normalizedPath}`, {
        cache: cacheState,
        items: listed.sortedEntries.length,
        command: listed.listing.primaryCommand || 'unknown',
        list: `${listed.listing.primaryListMs}ms`,
        merge: `${listed.listing.listMergeMs}ms`,
        merged: listed.listing.merged,
        map: `${listed.mapMs}ms`,
        sort: `${listed.sortMs}ms`,
        mdtmEnabled: modifiedDateFallbackEnabled,
        mdtmCache: cachedModifiedTimes,
        mdtmLookups: mdtm.lookups,
        mdtmUpdated: mdtm.updated,
        mdtmFailed: mdtm.failed,
        mdtmSkipped: mdtm.skippedCachedFailures,
        mdtmCancelled: mdtm.cancelled,
        mdtm: `${mdtm.elapsedMs}ms`,
        total: `${queuedTotalTimer()}ms`
      });

      return cloneRemoteEntries(listed.sortedEntries);
    })();

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


  private async listDirectoryWithMergedMetadata(connectionId: string, client: FtpClient, remotePath: string): Promise<FtpMergedListResult> {
    const primaryTimer = createPerformanceTimer();
    const primaryListing = await this.listDirectoryWithCommandDetails(connectionId, client, remotePath);
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
    const listListing = await this.tryListDirectoryWithCommands(connectionId, client, remotePath, ['LIST -a', 'LIST']);
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

  private async listDirectoryWithCommandDetails(connectionId: string, client: FtpClient, remotePath: string): Promise<FtpListResult> {
    const directListing = await this.listDirectoryDirectWithCommandDetails(client, remotePath);

    if (hasUsableFtpListItems(directListing.items) || normalizeRemotePath(remotePath) === '/') {
      return directListing;
    }

    const cwdListing = await this.tryListDirectoryFromCurrentDirectory(connectionId, client, remotePath);
    if (cwdListing && hasUsableFtpListItems(cwdListing.items)) {
      appendDebugLog(this.output, 'FTP', 'empty direct listing recovered with CWD fallback', {
        connection: connectionId,
        path: normalizeRemotePath(remotePath),
        directCommand: directListing.command || 'unknown',
        fallbackCommand: cwdListing.command || 'unknown',
        items: cwdListing.items.length
      });
      return cwdListing;
    }

    if (isListAllCommand(directListing.command)) {
      const listListing = await this.tryListDirectoryWithCommands(connectionId, client, remotePath, ['LIST']);
      if (listListing && hasUsableFtpListItems(listListing.items)) {
        appendDebugLog(this.output, 'FTP', 'empty LIST -a listing recovered with LIST fallback', {
          connection: connectionId,
          path: normalizeRemotePath(remotePath),
          directCommand: directListing.command || 'unknown',
          fallbackCommand: listListing.command || 'unknown',
          fallback: listListing.fallback || 'direct',
          items: listListing.items.length
        });
        return listListing;
      }
    }

    return directListing;
  }

  private async listDirectoryDirectWithCommandDetails(client: FtpClient, remotePath: string): Promise<FtpListResult> {
    const items = await client.list(remotePath);
    const command = this.getCurrentListCommand(client);

    return { items, command };
  }

  private async tryListDirectoryFromCurrentDirectory(
    connectionId: string,
    client: FtpClient,
    remotePath: string
  ): Promise<FtpListResult | undefined> {
    const normalizedPath = normalizeRemotePath(remotePath);
    const previousPath = await this.safePwd(client);
    let changedDirectory = false;

    try {
      await client.cd(normalizedPath);
      changedDirectory = true;

      const listing = await this.listDirectoryDirectWithCommandDetails(client, '');
      return {
        ...listing,
        command: appendFtpListCommandContext(listing.command, 'cwd'),
        fallback: 'cwd'
      };
    } catch (error) {
      appendDebugLog(this.output, 'FTP', 'empty direct listing CWD fallback failed', {
        connection: connectionId,
        path: normalizedPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    } finally {
      if (changedDirectory) {
        await this.tryCd(client, previousPath);
      }
    }
  }

  private getCurrentListCommand(client: FtpClient): string {
    return Array.isArray(client.availableListCommands) && client.availableListCommands.length > 0
      ? String(client.availableListCommands[0] || '')
      : '';
  }

  private async tryListDirectoryWithCommands(
    connectionId: string,
    client: FtpClient,
    remotePath: string,
    commands: string[]
  ): Promise<FtpListResult | undefined> {
    const originalCommands = Array.isArray(client.availableListCommands)
      ? [...client.availableListCommands]
      : [];

    try {
      client.availableListCommands = [...commands];
      return await this.listDirectoryWithCommandDetails(connectionId, client, remotePath);
    } catch {
      return undefined;
    } finally {
      client.availableListCommands = originalCommands;
    }
  }


  private getDirectoryListingCacheTtlSeconds(): number {
    return getNumberSetting('directoryListingCacheTtl', 30, 0, 300);
  }

  private isModifiedDateFallbackEnabled(): boolean {
    return getBooleanSetting('ftp.enableModifiedDateFallback', false);
  }

  private createDisabledModifiedTimeHydrationSummary(): ModifiedTimeHydrationSummary {
    return {
      lookups: 0,
      updated: 0,
      failed: 0,
      skippedCachedFailures: 0,
      cancelled: false,
      elapsedMs: 0
    };
  }

  private beginModifiedTimeLookup(connectionId: string): number {
    const nextToken = (this.modifiedTimeLookupTokens.get(connectionId) || 0) + 1;
    this.modifiedTimeLookupTokens.set(connectionId, nextToken);
    this.closeModifiedTimeClient(connectionId);
    return nextToken;
  }

  private cancelModifiedTimeLookup(connectionId: string): void {
    this.modifiedTimeLookupTokens.set(connectionId, (this.modifiedTimeLookupTokens.get(connectionId) || 0) + 1);
    this.closeModifiedTimeClient(connectionId);
  }

  private isModifiedTimeLookupCurrent(connectionId: string, token: number): boolean {
    return this.modifiedTimeLookupTokens.get(connectionId) === token
      && this.hasConnection(connectionId);
  }

  private closeModifiedTimeClient(connectionId: string): void {
    const client = this.modifiedTimeClients.get(connectionId);

    if (client) {
      this.closeClient(client);
    }

    this.modifiedTimeClients.delete(connectionId);
  }

  private async createModifiedTimeClient(connectionId: string, token: number): Promise<FtpClient | undefined> {
    if (!this.isModifiedTimeLookupCurrent(connectionId, token)) {
      return undefined;
    }

    const options = this.connectOptions.get(connectionId);
    if (!options) {
      return undefined;
    }

    const client = new FtpClient(30000);

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

      if (!this.isModifiedTimeLookupCurrent(connectionId, token)) {
        this.closeClient(client);
        return undefined;
      }

      this.modifiedTimeClients.set(connectionId, client);
      this.keepAlive.touch(connectionId);
      return client;
    } catch (error) {
      this.closeClient(client);
      appendDebugLog(this.output, 'FTP', 'modified time fallback client failed', {
        connection: connectionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  private applyCachedModifiedTimes(connectionId: string, entries: RemoteEntry[], cacheTtlSeconds: number): number {
    const now = Date.now();
    let applied = 0;

    for (const entry of entries) {
      if (entry.modifyTime > 0 || !entry.path) {
        continue;
      }

      const cacheKey = this.buildModifiedTimeCacheKey(connectionId, entry.path);
      const cached = this.modifiedTimeCache.get(cacheKey);

      if (!cached) {
        continue;
      }

      if (cacheTtlSeconds > 0 && cached.expiresAt > now) {
        entry.modifyTime = cached.modifyTime;
        applied += 1;
        continue;
      }

      this.modifiedTimeCache.delete(cacheKey);
    }

    return applied;
  }


  private scheduleBackgroundModifiedTimeHydration(
    connectionId: string,
    remotePath: string,
    entries: RemoteEntry[],
    cacheTtlSeconds: number,
    token: number,
    directoryCacheKey: string
  ): ModifiedTimeHydrationSummary {
    const candidates = this.getModifiedTimeLookupEntries(connectionId, entries, cacheTtlSeconds);

    if (candidates.length === 0) {
      return this.createScheduledModifiedTimeHydrationSummary(0);
    }

    void this.runBackgroundModifiedTimeHydrationBatches(
      connectionId,
      remotePath,
      candidates,
      cacheTtlSeconds,
      token,
      directoryCacheKey
    ).catch(error => {
      appendDebugLog(this.output, 'FTP', 'background MDTM modified time fallback failed', {
        connection: connectionId,
        path: normalizeRemotePath(remotePath),
        error: error instanceof Error ? error.message : String(error)
      });
    });

    appendDebugLog(this.output, 'FTP', 'background MDTM modified time fallback scheduled', {
      connection: connectionId,
      path: normalizeRemotePath(remotePath),
      candidates: candidates.length,
      batchSize: FtpSessionManager.backgroundMdtmBatchSize
    });

    return this.createScheduledModifiedTimeHydrationSummary(candidates.length);
  }

  private async runBackgroundModifiedTimeHydrationBatches(
    connectionId: string,
    remotePath: string,
    candidates: RemoteEntry[],
    cacheTtlSeconds: number,
    token: number,
    directoryCacheKey: string
  ): Promise<void> {
    const normalizedPath = normalizeRemotePath(remotePath);
    const batchSize = FtpSessionManager.backgroundMdtmBatchSize;
    let processed = 0;
    let batchNumber = 0;

    while (processed < candidates.length) {
      if (!this.isModifiedTimeLookupCurrent(connectionId, token) || !this.hasConnection(connectionId)) {
        appendDebugLog(this.output, 'FTP', 'background MDTM modified time fallback stopped', {
          connection: connectionId,
          path: normalizedPath,
          processed,
          total: candidates.length,
          reason: 'listing changed or connection closed'
        });
        break;
      }

      const batch = candidates.slice(processed, processed + batchSize);
      batchNumber += 1;

      const summary = await this.hydrateMissingModifiedTimes(connectionId, normalizedPath, batch, cacheTtlSeconds, token, {
        onUpdates: updates => {
          this.updateDirectoryListingCacheModifiedTimes(directoryCacheKey, updates, cacheTtlSeconds);
          this.queueModifiedTimeMetadataUpdate(connectionId, normalizedPath, updates);
        }
      });

      processed += batch.length;

      appendDebugLog(this.output, 'FTP', 'background MDTM modified time fallback batch completed', {
        connection: connectionId,
        path: normalizedPath,
        batch: batchNumber,
        processed,
        total: candidates.length,
        lookups: summary.lookups,
        updated: summary.updated,
        failed: summary.failed,
        cancelled: summary.cancelled
      });

      if (summary.cancelled || !this.isModifiedTimeLookupCurrent(connectionId, token)) {
        break;
      }
    }
  }

  private createScheduledModifiedTimeHydrationSummary(scheduled: number): ModifiedTimeHydrationSummary {
    return {
      lookups: scheduled,
      updated: 0,
      failed: 0,
      skippedCachedFailures: 0,
      cancelled: false,
      elapsedMs: 0
    };
  }

  private getModifiedTimeLookupEntries(connectionId: string, entries: RemoteEntry[], cacheTtlSeconds: number): RemoteEntry[] {
    return entries.filter(entry => {
      const entryType = entry.effectiveType || entry.type;
      if (entryType !== 'file' || entry.modifyTime > 0 || !entry.path) {
        return false;
      }

      return !this.isModifiedTimeFailureCached(connectionId, entry.path, cacheTtlSeconds);
    });
  }

  private updateDirectoryListingCacheModifiedTimes(
    directoryCacheKey: string,
    updates: RemoteEntryMetadataUpdate['updates'],
    cacheTtlSeconds: number
  ): void {
    if (!updates.length || cacheTtlSeconds <= 0) {
      return;
    }

    const cached = this.directoryListingCache.get(directoryCacheKey);
    if (!cached) {
      return;
    }

    const updatesByPath = new Map(updates.map(update => [normalizeRemotePath(update.path), update.modifyTime]));
    let changed = false;

    for (const entry of cached.entries) {
      const entryPath = normalizeRemotePath(entry.path || '');
      const modifyTime = updatesByPath.get(entryPath);
      if (modifyTime && entry.modifyTime !== modifyTime) {
        entry.modifyTime = modifyTime;
        changed = true;
      }
    }

    if (changed) {
      cached.expiresAt = Date.now() + cacheTtlSeconds * 1000;
    }
  }

  private queueModifiedTimeMetadataUpdate(
    connectionId: string,
    remotePath: string,
    updates: RemoteEntryMetadataUpdate['updates']
  ): void {
    if (!updates.length || !this.hasConnection(connectionId)) {
      return;
    }

    const normalizedPath = normalizeRemotePath(remotePath);
    const bufferKey = `${connectionId}|${normalizedPath}`;
    const existing = this.modifiedTimeUpdateBuffers.get(bufferKey) || [];
    existing.push(...updates);
    this.modifiedTimeUpdateBuffers.set(bufferKey, existing);

    if (this.modifiedTimeUpdateTimers.has(bufferKey)) {
      return;
    }

    const timer = setTimeout(() => {
      this.modifiedTimeUpdateTimers.delete(bufferKey);
      const bufferedUpdates = this.modifiedTimeUpdateBuffers.get(bufferKey) || [];
      this.modifiedTimeUpdateBuffers.delete(bufferKey);

      if (!bufferedUpdates.length || !this.hasConnection(connectionId)) {
        return;
      }

      const deduped = new Map<string, RemoteEntryMetadataUpdate['updates'][number]>();
      for (const update of bufferedUpdates) {
        deduped.set(normalizeRemotePath(update.path), update);
      }

      this.onRemoteEntryMetadataUpdatedEmitter.fire({
        connectionId,
        path: normalizedPath,
        updates: Array.from(deduped.values())
      });
    }, FtpSessionManager.backgroundMdtmUpdateDebounceMs);

    this.modifiedTimeUpdateTimers.set(bufferKey, timer);
  }

  private clearModifiedTimeUpdateBuffer(connectionId: string): void {
    const prefix = `${connectionId}|`;
    for (const [key, timer] of Array.from(this.modifiedTimeUpdateTimers.entries())) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer);
        this.modifiedTimeUpdateTimers.delete(key);
      }
    }

    for (const key of Array.from(this.modifiedTimeUpdateBuffers.keys())) {
      if (key.startsWith(prefix)) {
        this.modifiedTimeUpdateBuffers.delete(key);
      }
    }
  }

  private buildModifiedTimeLookupCandidates(remotePath: string, entry: RemoteEntry, includeRelativeName: boolean): string[] {
    const candidates: string[] = [];
    const entryPath = normalizeRemotePath(entry.path || '');
    const entryName = String(entry.name || '').trim();

    if (includeRelativeName && entryName && !entryName.includes('/')) {
      candidates.push(entryName);
    }

    if (entryPath && entryPath !== '/') {
      candidates.push(entryPath);

      const withoutLeadingSlash = entryPath.replace(/^\/+/, '');
      if (withoutLeadingSlash) {
        candidates.push(withoutLeadingSlash);
      }
    }

    const normalizedRemotePath = normalizeRemotePath(remotePath);
    if (entryName && normalizedRemotePath !== '/') {
      candidates.push(joinRemotePath(normalizedRemotePath, entryName));
    }

    return Array.from(new Set(candidates.filter(Boolean)));
  }

  private async hydrateMissingModifiedTimes(
    connectionId: string,
    remotePath: string,
    entries: RemoteEntry[],
    cacheTtlSeconds: number,
    token: number,
    options: ModifiedTimeHydrationOptions = {}
  ): Promise<ModifiedTimeHydrationSummary> {
    const timer = createPerformanceTimer();
    const allMissingEntries = entries.filter(entry => (entry.effectiveType || entry.type) === 'file' && entry.modifyTime <= 0 && Boolean(entry.path));
    const lookupLimit = Number.isFinite(Number(options.maxLookups)) && Number(options.maxLookups) > 0
      ? Number(options.maxLookups)
      : allMissingEntries.length;
    const missingEntries = allMissingEntries
      .filter(entry => !this.isModifiedTimeFailureCached(connectionId, entry.path || '', cacheTtlSeconds))
      .slice(0, lookupLimit);
    const skippedCachedFailures = allMissingEntries.length - missingEntries.length;

    if (missingEntries.length === 0) {
      return {
        lookups: 0,
        updated: 0,
        failed: 0,
        skippedCachedFailures,
        cancelled: false,
        elapsedMs: timer()
      };
    }

    const client = await this.createModifiedTimeClient(connectionId, token);

    if (!client) {
      return {
        lookups: 0,
        updated: 0,
        failed: 0,
        skippedCachedFailures,
        cancelled: !this.isModifiedTimeLookupCurrent(connectionId, token),
        elapsedMs: timer()
      };
    }

    let lookups = 0;
    let updated = 0;
    let failed = 0;
    let cancelled = false;
    let loggedFailures = 0;
    let changedToListDirectory = false;
    let pendingUpdates: RemoteEntryMetadataUpdate['updates'] = [];

    try {
      try {
        await client.cd(normalizeRemotePath(remotePath));
        changedToListDirectory = true;
      } catch (error) {
        appendDebugLog(this.output, 'FTP', 'MDTM fallback could not change directory before relative lookups', {
          connection: connectionId,
          path: normalizeRemotePath(remotePath),
          error: error instanceof Error ? error.message : String(error)
        });
      }

      for (const entry of missingEntries) {
        if (!this.isModifiedTimeLookupCurrent(connectionId, token) || client.closed) {
          cancelled = true;
          break;
        }

        const entryPath = normalizeRemotePath(entry.path || '');
        if (!entryPath || entryPath === '/') {
          continue;
        }

        const candidates = this.buildModifiedTimeLookupCandidates(normalizeRemotePath(remotePath), entry, changedToListDirectory);
        if (candidates.length === 0) {
          continue;
        }

        lookups += 1;
        let entryUpdated = false;
        let lastError: unknown;
        let lastCandidate = '';
        const attemptedCandidates: string[] = [];

        for (const candidate of candidates) {
          if (!this.isModifiedTimeLookupCurrent(connectionId, token) || client.closed) {
            cancelled = true;
            break;
          }

          lastCandidate = candidate;
          attemptedCandidates.push(candidate);

          try {
            const modifiedAt = await client.lastMod(candidate);
            const modifyTime = modifiedAt instanceof Date ? modifiedAt.getTime() : 0;

            if (Number.isFinite(modifyTime) && modifyTime > 0) {
              entry.modifyTime = Number(modifyTime);
              updated += 1;
              entryUpdated = true;

              if (cacheTtlSeconds > 0) {
                this.modifiedTimeCache.set(this.buildModifiedTimeCacheKey(connectionId, entryPath), {
                  modifyTime: Number(modifyTime),
                  expiresAt: Date.now() + cacheTtlSeconds * 1000
                });
                this.modifiedTimeFailureCache.delete(this.buildModifiedTimeCacheKey(connectionId, entryPath));
              }

              pendingUpdates.push({
                name: entry.name,
                path: entryPath,
                modifyTime: Number(modifyTime)
              });
              if (pendingUpdates.length >= 10) {
                options.onUpdates?.(pendingUpdates);
                pendingUpdates = [];
              }

              break;
            }
          } catch (error) {
            lastError = error;
          }
        }

        if (cancelled) {
          break;
        }

        if (!entryUpdated) {
          failed += 1;

          if (cacheTtlSeconds > 0) {
            this.modifiedTimeFailureCache.set(this.buildModifiedTimeCacheKey(connectionId, entryPath), {
              expiresAt: Date.now() + cacheTtlSeconds * 1000
            });
          }

          if (loggedFailures < 5) {
            loggedFailures += 1;
            appendDebugLog(this.output, 'FTP', 'MDTM modified time lookup failed', {
              connection: connectionId,
              path: entryPath,
              candidates: attemptedCandidates.join(', '),
              lastCandidate,
              type: entry.type,
              error: lastError instanceof Error ? lastError.message : String(lastError || 'No valid modified time returned')
            });
          }
        }
      }
    } finally {
      if (this.modifiedTimeClients.get(connectionId) === client) {
        this.modifiedTimeClients.delete(connectionId);
      }
      this.closeClient(client);
    }

    if (pendingUpdates.length > 0) {
      options.onUpdates?.(pendingUpdates);
    }

    if (lookups > 0 || updated > 0 || failed > 0 || cancelled) {
      appendDebugLog(this.output, 'FTP', 'modified time fallback completed', {
        connection: connectionId,
        path: normalizeRemotePath(remotePath),
        items: missingEntries.length,
        lookups,
        updated,
        failed,
        skipped: skippedCachedFailures,
        cancelled
      });
    }

    return {
      lookups,
      updated,
      failed,
      skippedCachedFailures,
      cancelled,
      elapsedMs: timer()
    };
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
      return await this.statUnqueued(connectionId, client, normalizedPath);
    });
  }

  private async statUnqueued(connectionId: string, client: FtpClient, normalizedPath: string): Promise<RemoteStat> {
    const result = await this.tryStatUnqueued(connectionId, client, normalizedPath);

    if (result.stat) {
      return result.stat;
    }

    throw result.error || new Error(`Could not stat remote path ${normalizedPath}.`);
  }

  private async tryStatUnqueued(connectionId: string, client: FtpClient, normalizedPath: string): Promise<FtpStatProbeResult> {
    if (normalizedPath === '/') {
      return {
        stat: {
          type: 'directory',
          size: 0,
          modifyTime: 0,
          accessTime: 0
        }
      };
    }

    let lastError: unknown;
    const entry = await this.findEntry(connectionId, client, normalizedPath);

    if (entry) {
      const entryType = mapFtpEntryType(entry);

      if (entryType === 'file' || entryType === 'directory' || entryType === 'link') {
        return {
          stat: {
            type: entryType === 'link' ? 'unknown' : entryType,
            size: Number(entry.size || 0),
            modifyTime: getFtpModifyTime(entry),
            accessTime: 0
          }
        };
      }
    }

    const fileStat = await this.tryStatFileBySize(client, normalizedPath);
    if (fileStat.stat) {
      return fileStat;
    }
    lastError = fileStat.error || lastError;

    const directoryStat = await this.tryStatDirectoryByCd(client, normalizedPath);
    if (directoryStat.stat) {
      return directoryStat;
    }
    lastError = directoryStat.error || lastError;

    const modifiedFileStat = await this.tryStatFileByModifiedTime(client, normalizedPath);
    if (modifiedFileStat.stat) {
      return modifiedFileStat;
    }
    lastError = modifiedFileStat.error || lastError;

    if (entry) {
      return {
        stat: {
          type: 'unknown',
          size: Number(entry.size || 0),
          modifyTime: getFtpModifyTime(entry),
          accessTime: 0
        }
      };
    }

    const listedStat = await this.tryStatFromPathListing(connectionId, client, normalizedPath);
    if (listedStat.stat) {
      return listedStat;
    }

    return { error: listedStat.error || lastError };
  }

  private async tryStatFileBySize(client: FtpClient, normalizedPath: string): Promise<FtpStatProbeResult> {
    let size: number;

    try {
      size = await client.size(normalizedPath);
    } catch (error) {
      return { error };
    }

    return {
      stat: {
        type: 'file',
        size: Number(size || 0),
        modifyTime: await this.tryGetModifiedTime(client, normalizedPath),
        accessTime: 0
      }
    };
  }

  private async tryStatDirectoryByCd(client: FtpClient, normalizedPath: string): Promise<FtpStatProbeResult> {
    const previousPath = await this.safePwd(client);
    let changedDirectory = false;

    try {
      await client.cd(normalizedPath);
      changedDirectory = true;
      return {
        stat: {
          type: 'directory',
          size: 0,
          modifyTime: 0,
          accessTime: 0
        }
      };
    } catch (error) {
      return { error };
    } finally {
      if (changedDirectory) {
        await this.tryCd(client, previousPath);
      }
    }
  }

  private async tryStatFileByModifiedTime(client: FtpClient, normalizedPath: string): Promise<FtpStatProbeResult> {
    try {
      const modifiedAt = await client.lastMod(normalizedPath);
      const modifyTime = modifiedAt instanceof Date ? modifiedAt.getTime() : 0;

      if (Number.isFinite(modifyTime) && modifyTime > 0) {
        return {
          stat: {
            type: 'file',
            size: 0,
            modifyTime: Number(modifyTime),
            accessTime: 0
          }
        };
      }

      return { error: new Error(`No valid modified time returned for ${normalizedPath}.`) };
    } catch (error) {
      return { error };
    }
  }

  private async tryStatFromPathListing(connectionId: string, client: FtpClient, normalizedPath: string): Promise<FtpStatProbeResult> {
    let listing: FtpListResult;

    try {
      listing = await this.listDirectoryWithCommandDetails(connectionId, client, normalizedPath);
    } catch (error) {
      return { error };
    }

    const selfListingEntry = getSelfListingEntry(listing.items, normalizedPath);

    if (selfListingEntry) {
      return {
        stat: {
          type: mapFtpStatType(selfListingEntry),
          size: Number(selfListingEntry.size || 0),
          modifyTime: getFtpModifyTime(selfListingEntry),
          accessTime: 0
        }
      };
    }

    if (hasUsableFtpListItems(listing.items)) {
      return {
        stat: {
          type: 'directory',
          size: 0,
          modifyTime: 0,
          accessTime: 0
        }
      };
    }

    return {
      error: new Error(`Could not confirm remote path exists from empty FTP listing: ${normalizedPath}.`)
    };
  }

  private async tryGetModifiedTime(client: FtpClient, normalizedPath: string): Promise<number> {
    try {
      const modifiedAt = await client.lastMod(normalizedPath);
      const modifyTime = modifiedAt instanceof Date ? modifiedAt.getTime() : 0;
      return Number.isFinite(modifyTime) ? Number(modifyTime) : 0;
    } catch {
      return 0;
    }
  }

  async createFile(connectionId: string, remotePath: string): Promise<void> {
    const normalizedPath = normalizeRemotePath(remotePath);

    await this.runQueued(connectionId, async () => {
      const client = this.getClient(connectionId);

      if (await this.pathExists(connectionId, client, normalizedPath)) {
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
      const stat = await this.statUnqueued(connectionId, client, normalizedPath);

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
        return await this.pathExists(connectionId, client, normalizedTargetPath);
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

  async listOwnerGroupSuggestions(_connectionId: string): Promise<RemoteOwnerGroupSuggestions> {
    return { owners: [], groups: [] };
  }

  async chmod(_connectionId: string, _remotePath: string, _mode: string | number, _options: RemoteChmodOptions = {}): Promise<void> {
    throw createUnsupportedError('Set permissions');
  }

  async enableSudoMode(_connectionId: string, _password: string): Promise<void> {
    throw createUnsupportedError('Sudo Mode');
  }

  disableSudoMode(_connectionId: string): void {
    // FTP/FTPS does not support Sudo Mode.
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
        const endConnectionOperation = this.keepAlive.beginOperation(connectionId);
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

    this.keepAlive.touch(connectionId);
    return client;
  }

  private async ensureClientReady(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);

    if (!connection) {
      throw new Error(`Remote Edit connection '${connectionId}' is not connected.`);
    }

    const client = this.sessions.get(connectionId);

    if (client && !client.closed && !this.reconnectRequired.has(connectionId)) {
      this.keepAlive.touch(connectionId);
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

    this.keepAlive.stopTimerOnly(connectionId);
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
      this.keepAlive.start(connectionId, client, connection.keepAlive !== false);
      this.keepAlive.touch(connectionId);

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
    this.keepAlive.stopTimerOnly(connectionId);

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

  private closeConnectionAfterKeepAliveFailure(connectionId: string, client: FtpClient): void {
    this.closeClient(client);
    this.keepAlive.stop(connectionId);
    this.sessions.delete(connectionId);
    this.connections.delete(connectionId);
    this.connectOptions.delete(connectionId);
    this.reconnectRequired.delete(connectionId);
    this.clearReadFileCache(connectionId);
    this.clearModifiedTimeCache(connectionId);
    this.clearModifiedTimeUpdateBuffer(connectionId);
    this.cancelModifiedTimeLookup(connectionId);
    this.clearInFlightDirectoryListings(connectionId);
    this.operationQueues.delete(connectionId);
  }

  private closeConnectionAfterCancellation(connectionId: string, client: FtpClient): void {
    this.closeClient(client);
    this.keepAlive.stop(connectionId);
    this.sessions.delete(connectionId);
    this.connections.delete(connectionId);
    this.connectOptions.delete(connectionId);
    this.reconnectRequired.delete(connectionId);
    this.clearReadFileCache(connectionId);
    this.clearModifiedTimeCache(connectionId);
    this.clearModifiedTimeUpdateBuffer(connectionId);
    this.cancelModifiedTimeLookup(connectionId);
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

  private async findEntry(connectionId: string, client: FtpClient, normalizedPath: string): Promise<FileInfo | undefined> {
    const parentPath = dirnameRemotePath(normalizedPath);
    const name = basenameRemotePath(normalizedPath);

    if (!name) {
      return undefined;
    }

    try {
      const listing = await this.listDirectoryWithCommandDetails(connectionId, client, parentPath);
      return listing.items.find(item => item.name === name);
    } catch {
      return undefined;
    }
  }

  private async pathExists(connectionId: string, client: FtpClient, normalizedPath: string): Promise<boolean> {
    const result = await this.tryStatUnqueued(connectionId, client, normalizedPath);
    return Boolean(result.stat);
  }

  private buildDirectoryListingCacheKey(connectionId: string, remotePath: string): string {
    return `${connectionId}:${normalizeRemotePath(remotePath)}`;
  }

  private buildModifiedTimeCacheKey(connectionId: string, remotePath: string): string {
    return `${connectionId}:${normalizeRemotePath(remotePath)}`;
  }

  private clearModifiedTimeCache(connectionId: string, remotePath?: string): void {
    if (remotePath) {
      const key = this.buildModifiedTimeCacheKey(connectionId, remotePath);
      this.modifiedTimeCache.delete(key);
      this.modifiedTimeFailureCache.delete(key);
      return;
    }

    const prefix = `${connectionId}:`;
    for (const key of Array.from(this.modifiedTimeCache.keys())) {
      if (key.startsWith(prefix)) {
        this.modifiedTimeCache.delete(key);
      }
    }
    for (const key of Array.from(this.modifiedTimeFailureCache.keys())) {
      if (key.startsWith(prefix)) {
        this.modifiedTimeFailureCache.delete(key);
      }
    }
  }

  private isModifiedTimeFailureCached(connectionId: string, remotePath: string, cacheTtlSeconds: number): boolean {
    if (cacheTtlSeconds <= 0) {
      return false;
    }

    const key = this.buildModifiedTimeCacheKey(connectionId, remotePath);
    const cached = this.modifiedTimeFailureCache.get(key);

    if (!cached) {
      return false;
    }

    if (cached.expiresAt > Date.now()) {
      return true;
    }

    this.modifiedTimeFailureCache.delete(key);
    return false;
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
    this.clearModifiedTimeCache(connectionId, normalizedPath);
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
      this.clearModifiedTimeCache(connectionId, remotePath);
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
    this.clearModifiedTimeCache(connectionId);
  }
}


