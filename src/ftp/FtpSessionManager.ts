import { Readable, Writable } from 'stream';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { Client as FtpClient, FileInfo, FileType } from 'basic-ftp';
import { RemoteEditOperationCancelledError, type RemoteEditProgressReporter } from '../utils/progressUtils';
import { getBooleanSetting, getNumberSetting } from '../utils/settingsUtils';
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

interface FtpStatProbeResult {
  stat?: RemoteStat;
  error?: unknown;
}

export class FtpSessionManager implements RemoteSessionManager {
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
    this.clearModifiedTimeCache(connectionId);
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
          ? await this.hydrateMissingModifiedTimes(connectionId, normalizedPath, cachedEntries, cacheTtlSeconds, lookupToken)
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
        ? await this.hydrateMissingModifiedTimes(connectionId, normalizedPath, listed.sortedEntries, cacheTtlSeconds, lookupToken)
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
      this.touchConnectionActivity(connectionId);
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
    token: number
  ): Promise<ModifiedTimeHydrationSummary> {
    const timer = createPerformanceTimer();
    const allMissingEntries = entries.filter(entry => entry.modifyTime <= 0 && Boolean(entry.path));
    const missingEntries = allMissingEntries.filter(entry => !this.isModifiedTimeFailureCached(connectionId, entry.path || '', cacheTtlSeconds));
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
    this.clearModifiedTimeCache(connectionId);
    this.cancelModifiedTimeLookup(connectionId);
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
    this.clearModifiedTimeCache(connectionId);
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


function isMlsdListCommand(command: string): boolean {
  return String(command || '').trim().toUpperCase().startsWith('MLSD');
}

function isListAllCommand(command: string): boolean {
  return /^LIST\s+-A(?:\s|$)/i.test(String(command || '').trim());
}

function appendFtpListCommandContext(command: string, context: string): string {
  const normalizedCommand = String(command || '').trim() || 'unknown';
  return `${normalizedCommand} (${context})`;
}

function hasUsableFtpListItems(items: FileInfo[]): boolean {
  return items.some(item => item.name !== '.' && item.name !== '..');
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

function getSelfListingEntry(items: FileInfo[], normalizedPath: string): FileInfo | undefined {
  if (items.length !== 1) {
    return undefined;
  }

  const item = items[0];
  const itemName = String(item.name || '').trim();

  if (!itemName || itemName === '.' || itemName === '..') {
    return undefined;
  }

  const targetName = basenameRemotePath(normalizedPath);

  if (itemName === targetName) {
    return item;
  }

  if (itemName.includes('/')) {
    const normalizedItemPath = normalizeRemotePath(itemName);
    if (normalizedItemPath === normalizedPath || basenameRemotePath(normalizedItemPath) === targetName) {
      return item;
    }
  }

  return undefined;
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
