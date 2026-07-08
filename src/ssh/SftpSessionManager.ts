import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import SftpClient from 'ssh2-sftp-client';
import type { Client } from 'ssh2';
import { expandHomePath } from '../utils/localPathUtils';
import { getBooleanSetting, getNumberSetting } from '../utils/settingsUtils';
import { buildRemoteTempPath, buildSudoErrorMessage, shellQuote } from '../utils/shellUtils';
import { appendDebugLog, appendPerformanceLog, createPerformanceTimer } from '../utils/outputLogger';
import { RemoteEditOperationCancelledError, type RemoteEditProgressReporter } from '../utils/progressUtils';
import { assertTcpConnectionReachable, normalizeRemoteConnectError } from '../remote/ConnectionProbe';
import { isSftpConnectionType, SFTP_CONNECTION_TYPE } from '../remote/RemoteConnectionTypes';
import { getRemoteCapabilities } from '../remote/RemoteCapabilities';
import { isWindowsRemotePlatform, type RemotePlatform, type RemoteShell } from '../remote/RemotePlatform';
import { getWindowsSftpPathCandidates, inferWindowsSftpPathStyle, joinRemotePathForPlatform, normalizeRemotePathForPlatform, toRemoteCommandPath, toWindowsSftpPath, type WindowsSftpPathStyle } from '../remote/RemotePathUtils';
import { detectRemotePlatform } from './RemotePlatformProbe';
import { buildOwnerGroupSuggestionCommand, buildPermissionString, buildPrincipalLookupCommand, cloneRemoteEntries, collectNumericIds, dirnameRemotePath, extractLinkTargetFromLongname, formatBytes, formatErrorMessage, formatMode, getGroupFromFileInfo, getOwnerFromFileInfo, getSudoTempDirectory, hasSpecialPermissionBitsChanged, inferLinkTargetType, joinRemotePath, mapEntryType, mapModeToEntryType, modeFromPermissionString, normalizeFileMode, normalizeNumericId, normalizeRemotePath, parseDfSpaceInfo, parseLongListing, parseLongListingLine, parseOwnerGroupSuggestionOutput, parsePrincipalLookupOutput, readRemoteFileToBuffer, shouldRestoreSpecialPermissionBits, sortRemoteEntries, statFlag, throwIfOperationCancelled, type RemoteSpaceInfo } from './SessionUtils';
import { buildControlledRemoteCommandScript, buildRemoteCommandDisplayScript, createRemoteCommandDisplayCallbacks, getPotentialRemoteProcessPidMarkerSuffixLength, escapeRegExp } from './RemoteCommandDisplay';
import { buildSftpCopyFileCommand, buildSftpCreateArchiveCommand, buildSftpMd5ChecksumAttempts, buildSftpSha256ChecksumAttempts, extractSftpChecksum, type SftpChecksumCommandAttempt } from './ArchiveChecksumUtils';
import { buildWindowsChecksumCommand, buildWindowsPowerShellCommand, buildWindowsSetLocationScript, createPowerShellCliXmlStreamSanitizer, isWindowsPowerShellCommand, quotePowerShellLiteral, sanitizePowerShellCliXml } from './WindowsPowerShellUtils';
import type { RemoteSessionManager, RemoteListDirectoryOptions, RemoteOwnerGroupSuggestions, RemotePrincipalSuggestion } from '../remote/RemoteSessionManager';
import type {
  ActiveConnection,
  AuthType,
  ConnectOptions,
  ConnectionCancellationToken,
  RemoteArchiveFormat,
  RemoteChecksumSummary,
  RemoteChecksumValue,
  RemoteCommandStreamingCallbacks,
  RemoteCommandStreamingControl,
  RemoteCommandStreamingResult,
  RemoteEntry,
  RemoteEntryType
} from '../remote/RemoteSessionTypes';

export { dirnameRemotePath, joinRemotePath, normalizeRemotePath } from './SessionUtils';

export type {
  ActiveConnection,
  AuthType,
  ConnectOptions,
  ConnectionCancellationToken,
  RemoteArchiveFormat,
  RemoteChecksumSummary,
  RemoteChecksumValue,
  RemoteCommandStreamingCallbacks,
  RemoteCommandStreamingControl,
  RemoteCommandStreamingResult,
  RemoteEntry,
  RemoteEntryType
} from '../remote/RemoteSessionTypes';

const SUDO_READ_IDLE_TIMEOUT_MS = 60000;
const SUDO_SAVE_APPLY_TIMEOUT_MS = 300000;
const SSH_DISCONNECT_TIMEOUT_MS = 5000;

interface RemoteExecOptions {
  input?: string;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  cancellationToken?: ConnectionCancellationToken;
  sanitizePowerShellCliXml?: boolean;
  stdoutProgress?: {
    label: string;
    progress?: RemoteEditProgressReporter;
    totalBytes?: number;
  };
}

interface RemoteExecResult {
  stdout: Buffer;
  stderr: string;
  code: number;
  signal?: string;
}

interface RemoteCommandStreamingOptions {
  input?: string;
  sanitizePowerShellCliXml?: boolean;
  remoteProcess?: {
    pidMarkerPrefix: string;
  };
}

interface CachedReadFile {
  content: Buffer;
  expiresAt: number;
}

interface CachedDirectoryListing {
  entries: RemoteEntry[];
  expiresAt: number;
}

interface SudoTargetMetadata {
  size: number;
  mode?: number;
}

interface ChangeOwnerGroupOptions {
  owner?: string;
  group?: string;
  recursive?: boolean;
}

interface ChmodOptions {
  recursive?: boolean;
}

export class SftpSessionManager implements RemoteSessionManager {
  constructor(private readonly output?: vscode.OutputChannel) {}

  private readonly sessions = new Map<string, SftpClient>();
  private readonly connections = new Map<string, ActiveConnection>();
  private readonly ownerNameCaches = new Map<string, Map<string, string>>();
  private readonly groupNameCaches = new Map<string, Map<string, string>>();
  private readonly ownerGroupSuggestionCaches = new Map<string, { expiresAt: number; suggestions: RemoteOwnerGroupSuggestions }>();
  private readonly sudoPasswords = new Map<string, string>();
  private readonly readFileCache = new Map<string, CachedReadFile>();
  private readonly directoryListingCache = new Map<string, CachedDirectoryListing>();
  private readonly remotePlatforms = new Map<string, RemotePlatform>();
  private readonly remoteShells = new Map<string, RemoteShell>();
  private readonly windowsSftpPathStyles = new Map<string, WindowsSftpPathStyle>();

  async connect(options: ConnectOptions, cancellationToken?: ConnectionCancellationToken): Promise<ActiveConnection> {
    if (!isSftpConnectionType(options.connectionType)) {
      throw new Error('SftpSessionManager only supports SFTP connections.');
    }

    await this.disconnect(options.connectionId);

    if (cancellationToken?.isCancellationRequested) {
      throw new Error('Connection cancelled.');
    }

    const readyTimeout = getNumberSetting('sshReadyTimeout', 30000, 1000, 300000);
    const client = new SftpClient(`remoteedit-${options.connectionId}`);
    const config: Record<string, unknown> = {
      host: options.host,
      port: options.port,
      username: options.username,
      readyTimeout
    };

    if (options.keepAlive !== false) {
      config.keepaliveInterval = getNumberSetting('sshKeepAliveInterval', 30000, 1000, 300000);
      config.keepaliveCountMax = getNumberSetting('sshKeepAliveCountMax', 3, 1, 20);
    }

    if (options.authType === 'privateKey') {
      if (!options.privateKeyPath) {
        throw new Error('Private key path is required for private key authentication.');
      }

      config.privateKey = await fs.readFile(expandHomePath(options.privateKeyPath), 'utf8');

      if (options.passphrase) {
        config.passphrase = options.passphrase;
      }
    } else {
      if (!options.password) {
        throw new Error('Password is required for password authentication.');
      }

      config.password = options.password;
    }

    const cancellationSubscription = cancellationToken?.onCancellationRequested(() => {
      void this.closeClientForCancellation(client);
    });

    try {
      await assertTcpConnectionReachable({
        host: options.host,
        port: options.port,
        timeoutMs: readyTimeout,
        protocolLabel: 'ssh',
        cancellationToken
      });

      await client.connect(config as any);

      if (cancellationToken?.isCancellationRequested) {
        await this.closeClientForCancellation(client);
        throw new Error('Connection cancelled.');
      }
    } catch (error) {
      cancellationSubscription?.dispose();
      await this.closeClientForCancellation(client);

      if (cancellationToken?.isCancellationRequested) {
        throw new Error('Connection cancelled.');
      }

      throw normalizeRemoteConnectError(error, {
        host: options.host,
        port: options.port,
        timeoutMs: readyTimeout,
        protocolLabel: 'ssh'
      });
    }

    const platformProbe = await detectRemotePlatform(client, this.output);
    const remotePlatform = platformProbe.platform;
    const remoteShell = platformProbe.shell;
    this.remotePlatforms.set(options.connectionId, remotePlatform);
    this.remoteShells.set(options.connectionId, remoteShell);

    const homePath = await this.safeCwd(client, remotePlatform);

    if (cancellationToken?.isCancellationRequested) {
      cancellationSubscription?.dispose();
      await this.closeClientForCancellation(client);
      throw new Error('Connection cancelled.');
    }

    const requestedStartPath = normalizeRemotePathForPlatform(options.startPath || homePath || '/', remotePlatform);
    const startPath = await this.resolveStartPath(client, options.connectionId, requestedStartPath, homePath, remotePlatform);

    if (cancellationToken?.isCancellationRequested) {
      cancellationSubscription?.dispose();
      await this.closeClientForCancellation(client);
      throw new Error('Connection cancelled.');
    }

    cancellationSubscription?.dispose();
    this.sessions.set(options.connectionId, client);

    const connection: ActiveConnection = {
      id: options.connectionId,
      connectionType: SFTP_CONNECTION_TYPE,
      name: options.name || `${options.username}@${options.host}`,
      host: options.host,
      port: options.port,
      username: options.username,
      authType: options.authType,
      privateKeyPath: options.privateKeyPath,
      startPath,
      keepAlive: options.keepAlive !== false,
      isQuickConnect: Boolean(options.isQuickConnect),
      remotePlatform,
      remoteShell,
      capabilities: getRemoteCapabilities(SFTP_CONNECTION_TYPE, remotePlatform)
    };

    this.connections.set(options.connectionId, connection);
    return connection;
  }


  private async closeClientForCancellation(client: SftpClient): Promise<void> {
    try {
      await client.end();
    } catch {
      try {
        (client as any).client?.destroy?.();
      } catch {
        // Ignore cancellation cleanup errors.
      }
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    const client = this.sessions.get(connectionId);

    if (client) {
      await this.closeClientForDisconnect(client, connectionId);
    }

    this.sessions.delete(connectionId);
    this.connections.delete(connectionId);
    this.ownerNameCaches.delete(connectionId);
    this.groupNameCaches.delete(connectionId);
    this.ownerGroupSuggestionCaches.delete(connectionId);
    this.sudoPasswords.delete(connectionId);
    this.remotePlatforms.delete(connectionId);
    this.remoteShells.delete(connectionId);
    this.windowsSftpPathStyles.delete(connectionId);
    this.clearReadFileCache(connectionId);
    this.clearDirectoryListingCache(connectionId);
  }

  private async closeClientForDisconnect(client: SftpClient, connectionId: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    const endPromise = Promise.resolve(client.end()).catch(() => undefined);
    const timeoutPromise = new Promise<void>(resolve => {
      timeout = setTimeout(() => {
        timedOut = true;
        try {
          (client as any).client?.destroy?.();
        } catch {
          // Ignore forced cleanup errors.
        }
        resolve();
      }, SSH_DISCONNECT_TIMEOUT_MS);
    });

    try {
      await Promise.race([endPromise, timeoutPromise]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }

    if (timedOut) {
      appendDebugLog(this.output, 'SSH/SFTP', 'Disconnect timed out; destroyed SSH client.', {
        Connection: connectionId,
        TimeoutMs: SSH_DISCONNECT_TIMEOUT_MS
      });
    }
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

  getSshClientForTerminal(connectionId: string): Client {
    const client = this.getClient(connectionId);
    const sshClient = (client as unknown as { client?: Client }).client;

    if (!sshClient) {
      throw new Error(`No SSH client is available for Remote Edit connection '${connectionId}'.`);
    }

    return sshClient;
  }

  async runRemoteCommandStreaming(
    connectionId: string,
    workingDirectory: string,
    command: string,
    callbacks: RemoteCommandStreamingCallbacks = {},
    cancellationToken?: ConnectionCancellationToken
  ): Promise<RemoteCommandStreamingResult> {
    const trimmedCommand = String(command || '').trim();

    if (!trimmedCommand) {
      throw new Error('Enter a command to run.');
    }

    if (this.isWindowsConnection(connectionId)) {
      return await this.runWindowsRemoteCommandStreaming(connectionId, workingDirectory, trimmedCommand, callbacks, cancellationToken);
    }

    const client = this.getClient(connectionId);
    const normalizedWorkingDirectory = this.normalizeRemotePathForConnection(connectionId, workingDirectory || '/');
    const displayScript = buildRemoteCommandDisplayScript(trimmedCommand);
    const streamingCallbacks = createRemoteCommandDisplayCallbacks(displayScript, callbacks);
    const sudoPassword = this.sudoPasswords.get(connectionId);
    const remoteProcessMarkerToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const remoteProcessPidMarkerPrefix = `__REMOTE_EDIT_PROCESS_PID_${remoteProcessMarkerToken}_`;
    const controlledScript = buildControlledRemoteCommandScript(
      normalizedWorkingDirectory,
      displayScript.script,
      remoteProcessPidMarkerPrefix,
      Boolean(sudoPassword)
    );

    try {
      if (!sudoPassword) {
        return await this.executeRemoteCommandStreaming(client, controlledScript, streamingCallbacks, cancellationToken, {
          remoteProcess: { pidMarkerPrefix: remoteProcessPidMarkerPrefix }
        });
      }

      const sudoCommand = `sudo -S -p '' sh -c ${shellQuote(controlledScript)}`;
      return await this.executeRemoteCommandStreaming(client, sudoCommand, streamingCallbacks, cancellationToken, {
        input: `${sudoPassword}\n`,
        remoteProcess: { pidMarkerPrefix: remoteProcessPidMarkerPrefix }
      });
    } finally {
      displayScript.flush();
    }
  }

  private async runWindowsRemoteCommandStreaming(
    connectionId: string,
    workingDirectory: string,
    command: string,
    callbacks: RemoteCommandStreamingCallbacks = {},
    cancellationToken?: ConnectionCancellationToken
  ): Promise<RemoteCommandStreamingResult> {
    const client = this.getClient(connectionId);
    const normalizedWorkingDirectory = this.normalizeRemotePathForConnection(connectionId, workingDirectory || '/');
    const commandWorkingDirectory = toRemoteCommandPath(normalizedWorkingDirectory, 'windows');
    const setLocationScript = buildWindowsSetLocationScript(commandWorkingDirectory);
    const script = [setLocationScript, command].filter(Boolean).join('\r\n');
    const commandToExecute = isWindowsPowerShellCommand(command)
      ? command
      : buildWindowsPowerShellCommand(script);

    callbacks.onCommand?.(command);
    const result = await this.executeRemoteCommandStreaming(
      client,
      commandToExecute,
      {
        ...callbacks,
        onCommand: undefined,
        onCommandStatus: undefined
      },
      cancellationToken,
      { sanitizePowerShellCliXml: true }
    );
    callbacks.onCommandStatus?.(0, result.code);
    return result;
  }

  async listDirectory(connectionId: string, remotePath: string, options: RemoteListDirectoryOptions = {}): Promise<RemoteEntry[]> {
    const client = this.getClient(connectionId);
    const normalizedPath = this.normalizeRemotePathForConnection(connectionId, remotePath);
    const totalTimer = createPerformanceTimer();
    const cacheTtlSeconds = getNumberSetting('directoryListingCacheTtl', 30, 0, 300);
    const cacheEnabled = cacheTtlSeconds > 0;
    const cacheScope = this.getDirectoryListingCacheScope(connectionId);
    const cacheKey = this.buildDirectoryListingCacheKey(connectionId, normalizedPath, cacheScope);
    let listMs = 0;
    let ownerGroupMs = 0;
    let mapMs = 0;
    let sortMs = 0;

    if (cacheEnabled && !options.forceRefresh) {
      const cached = this.directoryListingCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        const cachedEntries = cloneRemoteEntries(cached.entries);
        appendPerformanceLog(this.output, 'SFTP', `listDirectory ${normalizedPath}`, {
          cache: 'hit',
          privilege: cacheScope,
          items: cachedEntries.length,
          total: `${totalTimer()}ms`
        });
        return cachedEntries;
      }
    }

    const cacheState = cacheEnabled ? (options.forceRefresh ? 'refresh' : 'miss') : 'disabled';

    try {
      const listTimer = createPerformanceTimer();
      const items = await this.runSftpPathOperation(connectionId, normalizedPath, actualPath => client.list(actualPath));
      listMs = listTimer();

      const mapTimer = createPerformanceTimer();
      const entries = items
        .filter(item => item.name !== '.' && item.name !== '..')
        .map(item => ({
          name: item.name,
          type: mapEntryType(item.type),
          size: Number(item.size || 0),
          modifyTime: Number(item.modifyTime || 0),
          accessTime: Number((item as any).accessTime || 0),
          owner: getOwnerFromFileInfo(item),
          group: getGroupFromFileInfo(item),
          permissions: buildPermissionString(item),
          path: this.joinRemotePathForConnection(connectionId, normalizedPath, item.name),
          // Keep symlink listing lightweight. Do not resolve or infer target type here.
          // The target is resolved lazily only when the user opens the link.
          linkTarget: extractLinkTargetFromLongname(String((item as any).longname || '')),
          effectiveType: undefined
        }));
      mapMs = mapTimer();

      if (getBooleanSetting('sftpResolveOwnerGroupNames', false)) {
        const ownerGroupTimer = createPerformanceTimer();
        await this.resolveEntryOwnerGroups(client, connectionId, entries);
        ownerGroupMs = ownerGroupTimer();
      }

      const sortTimer = createPerformanceTimer();
      const sortedEntries = sortRemoteEntries(entries);
      sortMs = sortTimer();

      if (cacheEnabled) {
        this.directoryListingCache.set(cacheKey, {
          entries: cloneRemoteEntries(sortedEntries),
          expiresAt: Date.now() + cacheTtlSeconds * 1000
        });
      }

      appendPerformanceLog(this.output, 'SFTP', `listDirectory ${normalizedPath}`, {
        cache: cacheState,
        privilege: cacheScope,
        items: sortedEntries.length,
        list: `${listMs}ms`,
        ownerGroup: `${ownerGroupMs}ms`,
        map: `${mapMs}ms`,
        sort: `${sortMs}ms`,
        total: `${totalTimer()}ms`
      });

      return cloneRemoteEntries(sortedEntries);
    } catch (error) {
      if (!this.isSudoModeEnabled(connectionId)) {
        appendPerformanceLog(this.output, 'SFTP', `listDirectory failed ${normalizedPath}`, {
          cache: cacheState,
          privilege: cacheScope,
          list: `${listMs}ms`,
          ownerGroup: `${ownerGroupMs}ms`,
          map: `${mapMs}ms`,
          sort: `${sortMs}ms`,
          total: `${totalTimer()}ms`
        });
        throw error;
      }
    }

    const sudoTimer = createPerformanceTimer();
    const listing = await this.runSudoCommandText(
      connectionId,
      `LC_ALL=C ls -la ${shellQuote(normalizedPath)}`,
      30000
    );
    const sudoListMs = sudoTimer();

    const sudoMapTimer = createPerformanceTimer();
    const sudoEntries = parseLongListing(listing, normalizedPath);
    mapMs = sudoMapTimer();

    const sudoSortTimer = createPerformanceTimer();
    const sortedSudoEntries = sortRemoteEntries(sudoEntries);
    sortMs = sudoSortTimer();

    if (cacheEnabled) {
      this.directoryListingCache.set(cacheKey, {
        entries: cloneRemoteEntries(sortedSudoEntries),
        expiresAt: Date.now() + cacheTtlSeconds * 1000
      });
    }

    appendPerformanceLog(this.output, 'SFTP', `sudoListDirectory ${normalizedPath}`, {
      cache: cacheEnabled ? (options.forceRefresh ? 'refresh' : 'miss') : 'disabled',
      privilege: cacheScope,
      items: sortedSudoEntries.length,
      list: `${sudoListMs}ms`,
      map: `${mapMs}ms`,
      sort: `${sortMs}ms`,
      total: `${totalTimer()}ms`
    });

    return cloneRemoteEntries(sortedSudoEntries);
  }

  async prepareFileForOpen(connectionId: string, remotePath: string, cancellationToken?: ConnectionCancellationToken, progress?: RemoteEditProgressReporter): Promise<void> {
    const normalizedPath = this.normalizeRemotePathForConnection(connectionId, remotePath);
    const content = await this.readRemoteFile(connectionId, normalizedPath, cancellationToken, progress);
    this.readFileCache.set(this.buildReadFileCacheKey(connectionId, normalizedPath), {
      content,
      expiresAt: Date.now() + 30000
    });
  }

  async readFile(connectionId: string, remotePath: string, cancellationToken?: ConnectionCancellationToken, progress?: RemoteEditProgressReporter): Promise<Buffer> {
    const normalizedPath = this.normalizeRemotePathForConnection(connectionId, remotePath);
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

  private async readRemoteFile(connectionId: string, normalizedPath: string, cancellationToken?: ConnectionCancellationToken, progress?: RemoteEditProgressReporter): Promise<Buffer> {
    const client = this.getClient(connectionId);

    if (this.isSudoModeEnabled(connectionId)) {
      const metadata = await this.getSudoTargetMetadata(connectionId, normalizedPath);
      return await this.runSudoCommandBuffer(connectionId, `cat ${shellQuote(normalizedPath)}`, SUDO_READ_IDLE_TIMEOUT_MS, cancellationToken, progress, metadata?.size, true);
    }

    let actualPath = this.toSftpPathForConnection(connectionId, normalizedPath);
    try {
      const stats = await this.runSftpPathOperation(connectionId, normalizedPath, async candidatePath => {
        const candidateStats = await client.stat(candidatePath);
        actualPath = candidatePath;
        return candidateStats;
      });
      if (Number((stats as any).size || 0) === 0) {
        return Buffer.alloc(0);
      }
    } catch {
      // Ignore stat errors here. The actual read will report permission or missing-file errors.
    }

    const stats = await this.runSftpPathOperation(connectionId, normalizedPath, async candidatePath => {
      const candidateStats = await client.stat(candidatePath);
      actualPath = candidatePath;
      return candidateStats;
    }).catch(() => undefined as any);
    const totalBytes = Number((stats as any)?.size || 0);

    try {
      return await readRemoteFileToBuffer(client, actualPath, cancellationToken, progress, totalBytes);
    } catch (error) {
      throw await this.enrichWindowsReadFileError(connectionId, normalizedPath, error, cancellationToken);
    }
  }

  private async enrichWindowsReadFileError(connectionId: string, normalizedPath: string, error: unknown, cancellationToken?: ConnectionCancellationToken): Promise<Error> {
    const originalError = error instanceof Error ? error : new Error(String(error || 'Unknown error'));

    if (!this.isWindowsConnection(connectionId) || !this.isGenericSftpFailure(originalError)) {
      return originalError;
    }

    const windowsReason = await this.tryGetWindowsReadFileFailureReason(connectionId, normalizedPath, cancellationToken);
    if (!windowsReason) {
      return originalError;
    }

    return new Error(windowsReason);
  }

  private async tryGetWindowsReadFileFailureReason(connectionId: string, normalizedPath: string, cancellationToken?: ConnectionCancellationToken): Promise<string | undefined> {
    if (cancellationToken?.isCancellationRequested) {
      return undefined;
    }

    try {
      const commandPath = toRemoteCommandPath(normalizedPath, 'windows');
      const command = buildWindowsPowerShellCommand([
        `$path = ${quotePowerShellLiteral(commandPath)}`,
        'try {',
        '  $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop',
        '  $stream = [System.IO.File]::Open($item.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)',
        '  try { } finally { $stream.Dispose() }',
        '  Write-Output "OK"',
        '  exit 0',
        '} catch {',
        '  $message = $_.Exception.Message',
        '  if (-not $message -and $_.Exception.InnerException) { $message = $_.Exception.InnerException.Message }',
        '  [Console]::Error.WriteLine($message)',
        '  exit 1',
        '}'
      ].join('\r\n'));
      const result = await this.executeRemoteCommand(this.getClient(connectionId), command, {
        timeoutMs: 10000,
        cancellationToken,
        sanitizePowerShellCliXml: true
      });

      if (result.code === 0) {
        return undefined;
      }

      const output = `${result.stderr}\n${result.stdout.toString('utf8')}`
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !/^OK$/i.test(line))[0];

      return output || undefined;
    } catch {
      return undefined;
    }
  }

  private isGenericSftpFailure(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const code = Number((error as any)?.code);

    const trimmed = message.trim().replace(/^Error:\s*/i, '');

    return /^Failure$/i.test(trimmed) || (code === 4 && trimmed.length === 0);
  }

  async writeFile(connectionId: string, remotePath: string, content: Uint8Array, progress?: RemoteEditProgressReporter, cancellationToken?: ConnectionCancellationToken): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedPath = this.normalizeRemotePathForConnection(connectionId, remotePath);
    const buffer = Buffer.from(content);

    if (!this.isSudoModeEnabled(connectionId)) {
      if (this.isWindowsConnection(connectionId)) {
        const actualPath = this.toSftpPathForConnection(connectionId, normalizedPath);
        try {
          await this.writeExistingRemoteFileInPlace(client, actualPath, buffer, progress, cancellationToken);
        } catch (error) {
          if (!this.isMissingFileError(error)) {
            throw error;
          }

          await this.createRemoteFileWithServerDefaults(client, actualPath);

          if (buffer.length > 0) {
            await this.writeExistingRemoteFileInPlace(client, actualPath, buffer, progress, cancellationToken);
          }
        }

        this.clearReadFileCache(connectionId, normalizedPath);
        return;
      }

      try {
        const originalMode = await this.getRemoteFileMode(client, connectionId, normalizedPath);

        // Existing files must be updated in-place so owner, group,
        // permissions, ACLs, and inode are not replaced during save.
        await this.writeExistingRemoteFileInPlace(client, normalizedPath, buffer, progress, cancellationToken);
        await this.restoreOriginalSpecialPermissionBitsIfNeeded(client, connectionId, normalizedPath, originalMode);
      } catch (error) {
        if (!this.isMissingFileError(error)) {
          throw error;
        }

        // New files must be created by the remote server without an explicit mode
        // so the connected user's default permissions and umask are respected.
        await this.createRemoteFileWithServerDefaults(client, this.toSftpPathForConnection(connectionId, normalizedPath));

        if (buffer.length > 0) {
          await this.writeExistingRemoteFileInPlace(client, normalizedPath, buffer, progress, cancellationToken);
        }
      }

      this.clearReadFileCache(connectionId, normalizedPath);
      return;
    }

    const sudoTempDirectory = getSudoTempDirectory();
    const tempPath = buildRemoteTempPath(connectionId, normalizedPath, sudoTempDirectory);
    const targetDirectory = dirnameRemotePath(normalizedPath);
    const existingTargetMetadata = await this.getSudoTargetMetadata(connectionId, normalizedPath);
    const requiredTargetFreeBytes = Math.max(0, buffer.length - (existingTargetMetadata?.size ?? 0));
    const originalMode = existingTargetMetadata?.mode;

    await this.prepareSudoTempDirectory(client, sudoTempDirectory);
    await this.ensureSudoSaveFreeSpace(
      client,
      connectionId,
      sudoTempDirectory,
      targetDirectory,
      buffer.length,
      requiredTargetFreeBytes
    );

    try {
      await this.uploadBufferToNewRemoteFileInChunks(client, tempPath, buffer, progress, cancellationToken);

      if (existingTargetMetadata) {
        // Write through sudo into the existing target file instead of replacing it.
        // The shell redirection opens and truncates the target in-place, preserving
        // owner, group, permissions, ACLs, and inode.
        await this.runSudoCommandText(connectionId, `cat ${shellQuote(tempPath)} > ${shellQuote(normalizedPath)}`, SUDO_SAVE_APPLY_TIMEOUT_MS);
        progress?.reportMessage('Saving remote file...');
        await this.restoreOriginalSpecialPermissionBitsWithSudoIfNeeded(connectionId, normalizedPath, originalMode);
      } else {
        // New sudo-created files must use the remote sudo context defaults.
        // set -C keeps the create operation exclusive so an existing file is not truncated.
        progress?.reportMessage('Saving remote file...');
        await this.runSudoCommandText(connectionId, `set -C; cat ${shellQuote(tempPath)} > ${shellQuote(normalizedPath)}`, SUDO_SAVE_APPLY_TIMEOUT_MS);
      }

      this.clearReadFileCache(connectionId, normalizedPath);
    } finally {
      await this.cleanupRemoteTempFile(connectionId, tempPath);
    }
  }

  async stat(connectionId: string, remotePath: string): Promise<{
    type: 'file' | 'directory' | 'unknown';
    size: number;
    modifyTime: number;
    accessTime: number;
  }> {
    const client = this.getClient(connectionId);
    const normalizedPath = this.normalizeRemotePathForConnection(connectionId, remotePath);

    try {
      const stats = await this.runSftpPathOperation(connectionId, normalizedPath, actualPath => client.stat(actualPath));
      const resolvedType = await this.resolvePathType(client, connectionId, normalizedPath, stats);

      return {
        type: resolvedType === 'link' ? 'unknown' : resolvedType,
        size: Number((stats as any).size || 0),
        modifyTime: Number((stats as any).modifyTime || 0),
        accessTime: Number((stats as any).accessTime || 0)
      };
    } catch (error) {
      if (!this.isSudoModeEnabled(connectionId)) {
        throw error;
      }
    }

    const output = await this.runSudoCommandText(
      connectionId,
      `LC_ALL=C ls -ld ${shellQuote(normalizedPath)}`,
      30000
    );
    const entry = parseLongListingLine(output.trim(), dirnameRemotePath(normalizedPath));

    if (!entry) {
      throw new Error(`Could not stat remote path ${normalizedPath}.`);
    }

    return {
      type: entry.type === 'link' ? 'unknown' : entry.type,
      size: entry.size,
      modifyTime: entry.modifyTime,
      accessTime: entry.accessTime
    };
  }

  async createFile(connectionId: string, remotePath: string): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedPath = this.normalizeRemotePathForConnection(connectionId, remotePath);

    if (this.isSudoModeEnabled(connectionId)) {
      // Create the file through the remote sudo shell without chmod/mode.
      // set -C makes the redirection fail if the path already exists.
      await this.runSudoCommandText(connectionId, `set -C; : > ${shellQuote(normalizedPath)}`, 30000);
      this.clearReadFileCache(connectionId, normalizedPath);
      return;
    }

    await this.createRemoteFileWithServerDefaults(client, this.toSftpPathForConnection(connectionId, normalizedPath));
    this.clearReadFileCache(connectionId, normalizedPath);
  }

  async createDirectory(connectionId: string, remotePath: string): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedPath = this.normalizeRemotePathForConnection(connectionId, remotePath);

    if (this.isSudoModeEnabled(connectionId)) {
      await this.runSudoCommandText(connectionId, `mkdir -p ${shellQuote(normalizedPath)}`, 30000);
      this.clearReadFileCache(connectionId, normalizedPath);
      return;
    }

    await client.mkdir(this.toSftpPathForConnection(connectionId, normalizedPath), true);
    this.clearReadFileCache(connectionId, normalizedPath);
  }

  async delete(connectionId: string, remotePath: string): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedPath = this.normalizeRemotePathForConnection(connectionId, remotePath);

    if (this.isSudoModeEnabled(connectionId)) {
      const quotedPath = shellQuote(normalizedPath);
      await this.runSudoCommandText(
        connectionId,
        `if [ -d ${quotedPath} ] && [ ! -L ${quotedPath} ]; then rm -rf ${quotedPath}; else rm -f ${quotedPath}; fi`,
        60000
      );
      this.clearReadFileCache(connectionId, normalizedPath);
      return;
    }

    const entryType = await this.resolveEntryTypeWithoutFollowingLinks(client, connectionId, normalizedPath);

    if (entryType === 'directory') {
      await client.rmdir(this.toSftpPathForConnection(connectionId, normalizedPath), true);
    } else {
      await client.delete(this.toSftpPathForConnection(connectionId, normalizedPath));
    }

    this.clearReadFileCache(connectionId, normalizedPath);
  }

  async rename(connectionId: string, oldPath: string, newPath: string): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedOldPath = this.normalizeRemotePathForConnection(connectionId, oldPath);
    const normalizedNewPath = this.normalizeRemotePathForConnection(connectionId, newPath);

    if (this.isSudoModeEnabled(connectionId)) {
      await this.runSudoCommandText(
        connectionId,
        `mv ${shellQuote(normalizedOldPath)} ${shellQuote(normalizedNewPath)}`,
        30000
      );
      this.clearReadFileCache(connectionId, normalizedOldPath);
      this.clearReadFileCache(connectionId, normalizedNewPath);
      return;
    }

    await client.rename(this.toSftpPathForConnection(connectionId, normalizedOldPath), this.toSftpPathForConnection(connectionId, normalizedNewPath));
    this.clearReadFileCache(connectionId, normalizedOldPath);
    this.clearReadFileCache(connectionId, normalizedNewPath);
  }

  async copyFile(connectionId: string, sourcePath: string, targetPath: string, overwrite = false, cancellationToken?: ConnectionCancellationToken): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedSourcePath = this.normalizeRemotePathForConnection(connectionId, sourcePath);
    const normalizedTargetPath = this.normalizeRemotePathForConnection(connectionId, targetPath);
    if (this.isWindowsConnection(connectionId)) {
      if (!overwrite) {
        try {
          await this.runSftpPathOperation(connectionId, normalizedTargetPath, actualPath => client.stat(actualPath));
          throw new Error(`Remote path already exists: ${normalizedTargetPath}`);
        } catch (error) {
          if (!this.isMissingFileError(error)) {
            throw error;
          }
        }
      }

      const content = await this.readRemoteFile(connectionId, normalizedSourcePath, cancellationToken);
      await this.writeFile(connectionId, normalizedTargetPath, content, undefined, cancellationToken);
      this.clearReadFileCache(connectionId, normalizedTargetPath);
      return;
    }

    const command = buildSftpCopyFileCommand(normalizedSourcePath, normalizedTargetPath, overwrite);

    if (this.isSudoModeEnabled(connectionId)) {
      await this.runSudoCommandText(connectionId, command, 300000, cancellationToken);
      this.clearReadFileCache(connectionId, normalizedTargetPath);
      return;
    }

    const result = await this.executeRemoteCommand(client, command, { timeoutMs: 300000, cancellationToken });

    if (result.code !== 0) {
      const message = (result.stderr || result.stdout.toString('utf8') || `Remote copy failed with exit code ${result.code}.`).trim();
      throw new Error(message);
    }

    this.clearReadFileCache(connectionId, normalizedTargetPath);
  }

  async createArchive(
    connectionId: string,
    baseDirectory: string,
    entryNames: string[],
    archiveName: string,
    format: RemoteArchiveFormat,
    overwrite = false,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<void> {
    this.assertPosixOnlyAction(connectionId, 'Archive creation');
    const client = this.getClient(connectionId);
    const normalizedBaseDirectory = this.normalizeRemotePathForConnection(connectionId, baseDirectory);
    const safeEntryNames = entryNames.map(name => String(name || '').trim()).filter(Boolean);
    const safeArchiveName = String(archiveName || '').trim();

    if (!safeEntryNames.length) {
      throw new Error('Select one or more remote items to archive.');
    }

    for (const name of safeEntryNames) {
      if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        throw new Error(`Cannot archive invalid entry name: ${name}`);
      }
    }

    if (!safeArchiveName || safeArchiveName === '.' || safeArchiveName === '..' || safeArchiveName.includes('/') || safeArchiveName.includes('\\')) {
      throw new Error('The archive name must be a filename in the current remote directory.');
    }

    if (safeEntryNames.includes(safeArchiveName)) {
      throw new Error('The archive name cannot be the same as one of the selected items.');
    }

    const command = buildSftpCreateArchiveCommand(normalizedBaseDirectory, safeEntryNames, safeArchiveName, format, overwrite);

    if (this.isSudoModeEnabled(connectionId)) {
      await this.runSudoCommandText(connectionId, command, 1800000, cancellationToken);
      this.clearReadFileCache(connectionId, joinRemotePath(normalizedBaseDirectory, safeArchiveName));
      return;
    }

    const result = await this.executeRemoteCommand(client, command, { timeoutMs: 1800000, cancellationToken });

    if (result.code !== 0) {
      const message = (result.stderr || result.stdout.toString('utf8') || `Remote archive command failed with exit code ${result.code}.`).trim();
      throw new Error(message);
    }

    this.clearReadFileCache(connectionId, joinRemotePath(normalizedBaseDirectory, safeArchiveName));
  }

  async calculateChecksums(connectionId: string, remotePath: string, cancellationToken?: ConnectionCancellationToken): Promise<RemoteChecksumSummary> {
    const normalizedPath = this.normalizeRemotePathForConnection(connectionId, remotePath);

    if (this.isWindowsConnection(connectionId)) {
      return {
        sha256: await this.calculateWindowsChecksum(connectionId, normalizedPath, 'SHA-256', 'SHA256', cancellationToken),
        md5: await this.calculateWindowsChecksum(connectionId, normalizedPath, 'MD5', 'MD5', cancellationToken)
      };
    }

    return {
      sha256: await this.calculateChecksum(connectionId, normalizedPath, 'SHA-256', buildSftpSha256ChecksumAttempts(), cancellationToken),
      md5: await this.calculateChecksum(connectionId, normalizedPath, 'MD5', buildSftpMd5ChecksumAttempts(), cancellationToken)
    };
  }

  private async calculateWindowsChecksum(
    connectionId: string,
    normalizedPath: string,
    algorithm: 'SHA-256' | 'MD5',
    windowsAlgorithm: 'SHA256' | 'MD5',
    cancellationToken?: ConnectionCancellationToken
  ): Promise<RemoteChecksumValue> {
    if (cancellationToken?.isCancellationRequested) {
      throw new RemoteEditOperationCancelledError('Checksum calculation cancelled.');
    }

    try {
      const commandPath = toRemoteCommandPath(normalizedPath, 'windows');
      const command = buildWindowsChecksumCommand(commandPath, windowsAlgorithm);
      const result = await this.executeRemoteCommand(this.getClient(connectionId), command, { timeoutMs: 300000, cancellationToken, sanitizePowerShellCliXml: true });
      const output = `${result.stdout.toString('utf8')}\n${result.stderr}`.trim();

      if (result.code !== 0) {
        throw new Error(output || `Remote checksum command failed with exit code ${result.code}.`);
      }

      const checksum = extractSftpChecksum(output, windowsAlgorithm === 'SHA256' ? 64 : 32);
      if (checksum) {
        return { algorithm, value: checksum, command: `Get-FileHash -Algorithm ${windowsAlgorithm}` };
      }

      return { algorithm, error: 'Not available. Get-FileHash did not return a checksum.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('cancelled')) {
        throw new RemoteEditOperationCancelledError('Checksum calculation cancelled.');
      }
      return {
        algorithm,
        error: /access denied|permission denied/i.test(message) ? 'Permission denied.' : (message.trim() || 'Checksum calculation failed.')
      };
    }
  }

  private buildSha256ChecksumAttempts(): SftpChecksumCommandAttempt[] {
    return [
      { label: 'sha256sum', command: quotedPath => `sha256sum ${quotedPath}`, length: 64 },
      { label: 'shasum -a 256', command: quotedPath => `shasum -a 256 ${quotedPath}`, length: 64 },
      { label: 'csum -h SHA256', command: quotedPath => `csum -h SHA256 ${quotedPath}`, length: 64 },
      { label: 'digest -a sha256', command: quotedPath => `digest -a sha256 ${quotedPath}`, length: 64 },
      { label: 'openssl dgst -sha256', command: quotedPath => `openssl dgst -sha256 ${quotedPath}`, length: 64 }
    ];
  }

  private buildMd5ChecksumAttempts(): SftpChecksumCommandAttempt[] {
    return [
      { label: 'md5sum', command: quotedPath => `md5sum ${quotedPath}`, length: 32 },
      { label: 'md5', command: quotedPath => `md5 ${quotedPath}`, length: 32 },
      { label: 'csum -h MD5', command: quotedPath => `csum -h MD5 ${quotedPath}`, length: 32 },
      { label: 'digest -a md5', command: quotedPath => `digest -a md5 ${quotedPath}`, length: 32 },
      { label: 'openssl dgst -md5', command: quotedPath => `openssl dgst -md5 ${quotedPath}`, length: 32 }
    ];
  }

  private async calculateChecksum(
    connectionId: string,
    normalizedPath: string,
    algorithm: 'SHA-256' | 'MD5',
    attempts: SftpChecksumCommandAttempt[],
    cancellationToken?: ConnectionCancellationToken
  ): Promise<RemoteChecksumValue> {
    const quotedPath = shellQuote(normalizedPath);
    const errors: string[] = [];

    for (const attempt of attempts) {
      if (cancellationToken?.isCancellationRequested) {
        throw new RemoteEditOperationCancelledError('Checksum calculation cancelled.');
      }

      try {
        const output = await this.runChecksumCommand(connectionId, attempt.command(quotedPath), cancellationToken);
        const checksum = extractSftpChecksum(output, attempt.length);

        if (checksum) {
          return { algorithm, value: checksum, command: attempt.label };
        }

        if (output.trim()) {
          errors.push(`${attempt.label}: ${output.trim().split(/\r?\n/)[0]}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.toLowerCase().includes('cancelled')) {
          throw new RemoteEditOperationCancelledError('Checksum calculation cancelled.');
        }

        if (message.trim()) {
          errors.push(`${attempt.label}: ${message.trim().split(/\r?\n/)[0]}`);
        }
      }
    }

    const permissionError = errors.find(item => /permission denied|not permitted|access denied/i.test(item));
    return {
      algorithm,
      error: permissionError ? 'Permission denied.' : 'Not available. No supported server-side command returned a checksum.'
    };
  }

  private async runChecksumCommand(connectionId: string, command: string, cancellationToken?: ConnectionCancellationToken): Promise<string> {
    const timeoutMs = 300000;

    if (this.isSudoModeEnabled(connectionId)) {
      return await this.runSudoCommandText(connectionId, command, timeoutMs, cancellationToken);
    }

    const client = this.getClient(connectionId);
    const result = await this.executeRemoteCommand(client, command, { timeoutMs, cancellationToken });
    const output = `${result.stdout.toString('utf8')}\n${result.stderr}`.trim();

    if (result.code !== 0) {
      throw new Error(output || `Remote checksum command failed with exit code ${result.code}.`);
    }

    return output;
  }

  async changeOwnerGroup(connectionId: string, remotePath: string, options: ChangeOwnerGroupOptions): Promise<void> {
    this.assertPosixOnlyAction(connectionId, 'Owner/group changes');
    const normalizedPath = this.normalizeRemotePathForConnection(connectionId, remotePath);
    const owner = String(options?.owner || '').trim();
    const group = String(options?.group || '').trim();

    if (!owner && !group) {
      throw new Error('Owner or group is required.');
    }

    const commandName = owner ? 'chown' : 'chgrp';
    const target = owner && group ? `${owner}:${group}` : (owner || group);
    const recursiveFlag = options?.recursive ? ' -R' : '';
    const command = `${commandName}${recursiveFlag} ${shellQuote(target)} ${shellQuote(normalizedPath)}`;

    if (this.isSudoModeEnabled(connectionId)) {
      await this.runSudoCommandText(connectionId, command, 300000);
      this.clearReadFileCache(connectionId, normalizedPath);
      return;
    }

    const client = this.getClient(connectionId);
    const result = await this.executeRemoteCommand(client, command, { timeoutMs: 300000 });

    if (result.code !== 0) {
      const output = `${result.stderr}\n${result.stdout.toString('utf8')}`.trim();
      throw new Error(output || `Remote ${commandName} command failed with exit code ${result.code}.`);
    }

    this.clearReadFileCache(connectionId, normalizedPath);
  }


  async listOwnerGroupSuggestions(connectionId: string): Promise<RemoteOwnerGroupSuggestions> {
    this.assertPosixOnlyAction(connectionId, 'Owner/group suggestions');
    const now = Date.now();
    const cached = this.ownerGroupSuggestionCaches.get(connectionId);
    if (cached && cached.expiresAt > now) {
      return cached.suggestions;
    }

    const client = this.getClient(connectionId);
    const output = await this.runRemoteCommand(client, buildOwnerGroupSuggestionCommand());
    const suggestions = parseOwnerGroupSuggestionOutput(output);
    this.ownerGroupSuggestionCaches.set(connectionId, {
      expiresAt: now + 5 * 60 * 1000,
      suggestions
    });
    return suggestions;
  }

  async chmod(connectionId: string, remotePath: string, mode: string | number, options: ChmodOptions = {}): Promise<void> {
    this.assertPosixOnlyAction(connectionId, 'Permission changes');
    const client = this.getClient(connectionId);
    const modeText = typeof mode === 'number' ? mode.toString(8) : String(mode).trim();

    if (!/^[0-7]{3,4}$/.test(modeText)) {
      throw new Error(`Invalid permission mode '${modeText}'.`);
    }

    const normalizedPath = this.normalizeRemotePathForConnection(connectionId, remotePath);

    if (this.isSudoModeEnabled(connectionId) || options.recursive) {
      const recursiveFlag = options.recursive ? ' -R' : '';
      const command = `chmod${recursiveFlag} ${shellQuote(modeText)} ${shellQuote(normalizedPath)}`;

      if (this.isSudoModeEnabled(connectionId)) {
        await this.runSudoCommandText(connectionId, command, 300000);
        this.clearReadFileCache(connectionId, normalizedPath);
        return;
      }

      const result = await this.executeRemoteCommand(client, command, { timeoutMs: 300000 });

      if (result.code !== 0) {
        const output = `${result.stderr}
${result.stdout.toString('utf8')}`.trim();
        throw new Error(output || `Remote chmod command failed with exit code ${result.code}.`);
      }

      this.clearReadFileCache(connectionId, normalizedPath);
      return;
    }

    const chmod = (client as any).chmod;

    if (typeof chmod !== 'function') {
      throw new Error('The active SFTP client does not support chmod.');
    }

    await chmod.call(client, normalizedPath, parseInt(modeText, 8));
    this.clearReadFileCache(connectionId, normalizedPath);
  }

  async enableSudoMode(connectionId: string, password: string): Promise<void> {
    this.assertPosixOnlyAction(connectionId, 'Sudo Mode');
    this.getClient(connectionId);

    const sudoPassword = String(password || '');
    if (!sudoPassword) {
      throw new Error('Sudo password is required.');
    }

    const result = await this.runSudoValidationCommand(connectionId, sudoPassword);

    if (result.code !== 0) {
      throw new Error(buildSudoErrorMessage(result.stderr || result.stdout.toString('utf8')));
    }

    this.sudoPasswords.set(connectionId, sudoPassword);
  }

  disableSudoMode(connectionId: string): void {
    this.sudoPasswords.delete(connectionId);
    this.clearReadFileContentCache(connectionId);
  }

  isSudoModeEnabled(connectionId: string): boolean {
    return this.sudoPasswords.has(connectionId);
  }

  private getDirectoryListingCacheScope(connectionId: string): 'normal' | 'sudo' {
    return this.isSudoModeEnabled(connectionId) ? 'sudo' : 'normal';
  }

  private buildDirectoryListingCacheKey(connectionId: string, remotePath: string, scope: 'normal' | 'sudo' = 'normal'): string {
    return `${connectionId}:${scope}:${normalizeRemotePath(remotePath)}`;
  }

  private clearDirectoryListingCache(connectionId: string, remotePath?: string): void {
    if (remotePath) {
      const normalizedPath = normalizeRemotePath(remotePath);
      let deletedCount = 0;
      for (const scope of ['normal', 'sudo'] as const) {
        const key = this.buildDirectoryListingCacheKey(connectionId, normalizedPath, scope);
        if (this.directoryListingCache.delete(key)) deletedCount += 1;
      }
      if (deletedCount > 0) {
        appendDebugLog(this.output, 'Cache', 'invalidated directory listing', {
          connection: connectionId,
          path: normalizedPath,
          entries: deletedCount
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
  }

  private buildReadFileCacheKey(connectionId: string, remotePath: string): string {
    return `${connectionId}:${normalizeRemotePath(remotePath)}`;
  }

  private clearReadFileContentCache(connectionId: string, remotePath?: string): void {
    if (remotePath) {
      this.readFileCache.delete(this.buildReadFileCacheKey(connectionId, remotePath));
      return;
    }

    const prefix = `${connectionId}:`;
    for (const key of Array.from(this.readFileCache.keys())) {
      if (key.startsWith(prefix)) {
        this.readFileCache.delete(key);
      }
    }
  }

  private clearReadFileCache(connectionId: string, remotePath?: string): void {
    this.clearReadFileContentCache(connectionId, remotePath);
    if (remotePath) {
      this.invalidateDirectoryListingForPath(connectionId, remotePath);
      return;
    }
    this.clearDirectoryListingCache(connectionId);
  }

  private getClient(connectionId: string): SftpClient {
    const client = this.sessions.get(connectionId);

    if (!client) {
      throw new Error(`Remote Edit connection '${connectionId}' is not connected.`);
    }

    return client;
  }

  private getRemotePlatform(connectionId: string): RemotePlatform {
    return this.remotePlatforms.get(connectionId)
      || this.connections.get(connectionId)?.remotePlatform
      || 'posix';
  }

  private isWindowsConnection(connectionId: string): boolean {
    return isWindowsRemotePlatform(this.getRemotePlatform(connectionId));
  }

  private normalizeRemotePathForConnection(connectionId: string, remotePath: string | undefined): string {
    return normalizeRemotePathForPlatform(remotePath, this.getRemotePlatform(connectionId));
  }

  private joinRemotePathForConnection(connectionId: string, parent: string, child: string): string {
    return joinRemotePathForPlatform(parent, child, this.getRemotePlatform(connectionId));
  }

  private toSftpPathForConnection(connectionId: string, normalizedPath: string): string {
    if (!this.isWindowsConnection(connectionId)) {
      return normalizedPath;
    }

    return toWindowsSftpPath(normalizedPath, this.windowsSftpPathStyles.get(connectionId) || 'slashDrive');
  }

  private getSftpPathCandidatesForConnection(connectionId: string, normalizedPath: string): string[] {
    if (!this.isWindowsConnection(connectionId)) {
      return [normalizedPath];
    }

    return getWindowsSftpPathCandidates(normalizedPath, this.windowsSftpPathStyles.get(connectionId));
  }

  private rememberSuccessfulSftpPath(connectionId: string, actualPath: string): void {
    if (this.isWindowsConnection(connectionId)) {
      this.windowsSftpPathStyles.set(connectionId, inferWindowsSftpPathStyle(actualPath));
    }
  }

  private async runSftpPathOperation<T>(
    connectionId: string,
    normalizedPath: string,
    operation: (actualPath: string) => Promise<T>
  ): Promise<T> {
    let lastError: unknown;

    for (const actualPath of this.getSftpPathCandidatesForConnection(connectionId, normalizedPath)) {
      try {
        const result = await operation(actualPath);
        this.rememberSuccessfulSftpPath(connectionId, actualPath);
        return result;
      } catch (error) {
        lastError = error;
        if (!this.isWindowsConnection(connectionId)) {
          break;
        }
      }
    }

    throw lastError;
  }

  private assertPosixOnlyAction(connectionId: string, actionLabel: string): void {
    if (this.isWindowsConnection(connectionId)) {
      throw new Error(`${actionLabel} is not available for Windows SSH/SFTP sessions.`);
    }
  }

  private async safeCwd(client: SftpClient, remotePlatform: RemotePlatform): Promise<string> {
    try {
      const cwd = await client.cwd();
      return normalizeRemotePathForPlatform(cwd || '/', remotePlatform);
    } catch {
      return '/';
    }
  }

  private async resolveStartPath(
    client: SftpClient,
    connectionId: string,
    requestedStartPath: string,
    homePath: string,
    remotePlatform: RemotePlatform
  ): Promise<string> {
    const candidates = Array.from(new Set([
      requestedStartPath,
      homePath || '/',
      '/'
    ].map(path => normalizeRemotePathForPlatform(path, remotePlatform))));

    for (const candidate of candidates) {
      for (const actualPath of this.getSftpPathCandidatesForConnection(connectionId, candidate)) {
        try {
          await client.list(actualPath);
          this.rememberSuccessfulSftpPath(connectionId, actualPath);
          return candidate;
        } catch {
          // Try the next path candidate.
        }
      }
    }

    return candidates[0] || '/';
  }


  private async resolvePathType(client: SftpClient, connectionId: string, remotePath: string, stats: unknown): Promise<RemoteEntryType> {
    if (statFlag(stats, 'isDirectory')) {
      return 'directory';
    }

    if (statFlag(stats, 'isFile')) {
      return 'file';
    }

    const modeType = mapModeToEntryType(Number((stats as any)?.mode || 0));

    if (modeType === 'directory' || modeType === 'file') {
      return modeType;
    }

    // Some servers report symlinks as links even when stat() follows them.
    // For opening/navigating, check if the path can be listed as a directory.
    if (modeType === 'link' || statFlag(stats, 'isSymbolicLink')) {
      try {
        await this.runSftpPathOperation(connectionId, remotePath, actualPath => client.list(actualPath));
        return 'directory';
      } catch {
        // A symlink that is not listable is treated as file-like so VS Code can try to open it.
        return 'file';
      }
    }

    try {
      await this.runSftpPathOperation(connectionId, remotePath, actualPath => client.list(actualPath));
      return 'directory';
    } catch {
      // Not a listable directory. If stat() succeeded, treat it as file-like.
    }

    return 'file';
  }

  private async resolveEntryTypeWithoutFollowingLinks(client: SftpClient, connectionId: string, remotePath: string): Promise<RemoteEntryType> {
    const dynamicClient = client as any;

    if (typeof dynamicClient.lstat === 'function') {
      try {
        const stats = await dynamicClient.lstat(this.toSftpPathForConnection(connectionId, remotePath));
        const modeType = mapModeToEntryType(Number((stats as any)?.mode || 0));

        if (modeType !== 'unknown') {
          return modeType;
        }

        if (statFlag(stats, 'isDirectory')) {
          return 'directory';
        }

        if (statFlag(stats, 'isFile')) {
          return 'file';
        }

        if (statFlag(stats, 'isSymbolicLink')) {
          return 'link';
        }
      } catch {
        // Fall back to listing the parent directory.
      }
    }

    try {
      const parentPath = dirnameRemotePath(remotePath);
      const name = remotePath.split('/').filter(Boolean).pop() || '';
      const entries = await this.runSftpPathOperation(connectionId, parentPath, actualPath => client.list(actualPath));
      const entry = entries.find(item => item.name === name);
      if (entry) {
        return mapEntryType(entry.type);
      }
    } catch {
      // Fall through to following stat as a last resort.
    }

    try {
      const stats = await this.runSftpPathOperation(connectionId, remotePath, actualPath => client.stat(actualPath));
      return await this.resolvePathType(client, connectionId, remotePath, stats);
    } catch {
      return 'unknown';
    }
  }

  private async resolveEntryOwnerGroups(client: SftpClient, connectionId: string, entries: RemoteEntry[]): Promise<void> {
    const ownerIds = collectNumericIds(entries.map(entry => entry.owner));
    const groupIds = collectNumericIds(entries.map(entry => entry.group));

    const ownerNames = await this.resolveRemotePrincipalNames(client, connectionId, 'user', ownerIds);
    const groupNames = await this.resolveRemotePrincipalNames(client, connectionId, 'group', groupIds);

    for (const entry of entries) {
      const ownerKey = normalizeNumericId(entry.owner);
      if (ownerKey && ownerNames.has(ownerKey)) {
        entry.owner = ownerNames.get(ownerKey) || entry.owner;
      }

      const groupKey = normalizeNumericId(entry.group);
      if (groupKey && groupNames.has(groupKey)) {
        entry.group = groupNames.get(groupKey) || entry.group;
      }
    }
  }

  private async resolveRemotePrincipalNames(
    client: SftpClient,
    connectionId: string,
    kind: 'user' | 'group',
    ids: string[]
  ): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();

    if (ids.length === 0) {
      return resolved;
    }

    const cache = this.getPrincipalNameCache(connectionId, kind);
    const missingIds: string[] = [];

    for (const id of ids) {
      const cachedName = cache.get(id);
      if (cachedName !== undefined) {
        resolved.set(id, cachedName);
      } else {
        missingIds.push(id);
      }
    }

    if (missingIds.length > 0) {
      const output = await this.runRemoteCommand(client, buildPrincipalLookupCommand(kind, missingIds));
      const parsedNames = parsePrincipalLookupOutput(output);

      for (const id of missingIds) {
        const name = parsedNames.get(id) || id;
        cache.set(id, name);
        resolved.set(id, name);
      }
    }

    return resolved;
  }

  private getPrincipalNameCache(connectionId: string, kind: 'user' | 'group'): Map<string, string> {
    const caches = kind === 'user' ? this.ownerNameCaches : this.groupNameCaches;
    let cache = caches.get(connectionId);

    if (!cache) {
      cache = new Map<string, string>();
      caches.set(connectionId, cache);
    }

    return cache;
  }

  private async getRemoteFileMode(client: SftpClient, connectionId: string, remotePath: string): Promise<number | undefined> {
    const stats = await this.runSftpPathOperation(connectionId, remotePath, actualPath => client.stat(actualPath));
    const mode = normalizeFileMode((stats as any)?.mode);

    if (mode !== undefined) {
      return mode;
    }

    return await this.getRemoteFileModeFromDirectoryListing(client, connectionId, remotePath);
  }

  private async getRemoteFileModeFromDirectoryListing(client: SftpClient, connectionId: string, remotePath: string): Promise<number | undefined> {
    try {
      const parentPath = dirnameRemotePath(remotePath);
      const name = remotePath.split('/').filter(Boolean).pop() || '';
      const entries = await this.runSftpPathOperation(connectionId, parentPath, actualPath => client.list(actualPath));
      const entry = entries.find(item => item.name === name);
      const permissions = buildPermissionString(entry as SftpClient.FileInfo);

      return modeFromPermissionString(permissions);
    } catch {
      return undefined;
    }
  }

  private async restoreOriginalSpecialPermissionBitsIfNeeded(
    client: SftpClient,
    connectionId: string,
    remotePath: string,
    originalMode: number | undefined
  ): Promise<void> {
    if (!shouldRestoreSpecialPermissionBits(originalMode)) {
      return;
    }

    const currentMode = await this.getRemoteFileMode(client, connectionId, remotePath);

    if (currentMode === originalMode) {
      return;
    }

    if (!hasSpecialPermissionBitsChanged(originalMode, currentMode)) {
      return;
    }

    const chmod = (client as any).chmod;

    if (typeof chmod !== 'function') {
      throw new Error('File content was saved, but Remote Edit could not restore the original special permission bits because the active SFTP client does not support chmod.');
    }

    try {
      await chmod.call(client, remotePath, originalMode);
    } catch (error) {
      throw new Error(`File content was saved, but Remote Edit could not restore the original special permission bits (${formatMode(originalMode)}): ${formatErrorMessage(error)}`);
    }
  }

  private async restoreOriginalSpecialPermissionBitsWithSudoIfNeeded(
    connectionId: string,
    remotePath: string,
    originalMode: number | undefined
  ): Promise<void> {
    if (!shouldRestoreSpecialPermissionBits(originalMode)) {
      return;
    }

    const currentMode = await this.getSudoFileMode(connectionId, remotePath);

    if (currentMode === originalMode) {
      return;
    }

    if (!hasSpecialPermissionBitsChanged(originalMode, currentMode)) {
      return;
    }

    const modeText = formatMode(originalMode);

    try {
      await this.runSudoCommandText(connectionId, `chmod ${shellQuote(modeText)} ${shellQuote(remotePath)}`, 30000);
    } catch (error) {
      throw new Error(`File content was saved, but Remote Edit could not restore the original special permission bits (${modeText}) with sudo: ${formatErrorMessage(error)}`);
    }
  }

  private async getSudoFileMode(connectionId: string, remotePath: string): Promise<number | undefined> {
    const output = await this.runSudoCommandText(connectionId, `LC_ALL=C ls -ldn ${shellQuote(remotePath)}`, 15000);
    const entry = parseLongListingLine(output.trim(), dirnameRemotePath(remotePath));

    return entry ? modeFromPermissionString(entry.permissions) : undefined;
  }

  private async createRemoteFileWithServerDefaults(client: SftpClient, remotePath: string): Promise<void> {
    const sftp = (client as any).sftp;

    if (!sftp || typeof sftp.open !== 'function') {
      throw new Error('The active SFTP client does not support creating files without explicit permissions. Create file aborted.');
    }

    const handle = await this.rawSftpOpen(sftp, remotePath, 'wx');

    try {
      await this.rawSftpClose(sftp, handle);
    } catch (error) {
      throw error;
    }
  }


  private async uploadBufferToNewRemoteFileInChunks(client: SftpClient, remotePath: string, content: Buffer, progress?: RemoteEditProgressReporter, cancellationToken?: ConnectionCancellationToken): Promise<void> {
    const sftp = (client as any).sftp;

    if (!sftp || typeof sftp.open !== 'function') {
      throw new Error('The active SFTP client does not support chunked uploads without explicit permissions. Save aborted.');
    }

    // Create the temporary file without passing a mode/permission attribute so
    // the remote server applies its own defaults and umask. Then write the
    // content in chunks instead of using a single buffer upload call.
    const handle = await this.rawSftpOpen(sftp, remotePath, 'wx');
    let operationError: unknown;

    try {
      await this.writeBufferToOpenRemoteFile(sftp, handle, content, progress, cancellationToken);
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try {
        await this.rawSftpClose(sftp, handle);
      } catch (closeError) {
        if (!operationError) {
          throw closeError;
        }
      }
    }
  }

  private async writeBufferToOpenRemoteFile(sftp: any, handle: Buffer, content: Buffer, progress?: RemoteEditProgressReporter, cancellationToken?: ConnectionCancellationToken): Promise<void> {
    const chunkSize = 64 * 1024;
    let offset = 0;

    while (offset < content.length) {
      throwIfOperationCancelled(cancellationToken);
      const length = Math.min(chunkSize, content.length - offset);
      await this.rawSftpWrite(sftp, handle, content, offset, length, offset);
      throwIfOperationCancelled(cancellationToken);
      offset += length;
      progress?.reportBytes('Saving remote file...', offset, content.length);
    }
  }

  private async writeExistingRemoteFileInPlace(client: SftpClient, remotePath: string, content: Buffer, progress?: RemoteEditProgressReporter, cancellationToken?: ConnectionCancellationToken): Promise<void> {
    const sftp = (client as any).sftp;

    if (!sftp || typeof sftp.open !== 'function') {
      throw new Error('The active SFTP client does not support safe in-place writes. Save aborted to avoid changing file metadata.');
    }

    const handle = await this.rawSftpOpen(sftp, remotePath, 'r+');
    let operationError: unknown;

    try {
      await this.writeBufferToOpenRemoteFile(sftp, handle, content, progress, cancellationToken);
      await this.rawSftpSetSize(sftp, remotePath, handle, content.length);
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try {
        await this.rawSftpClose(sftp, handle);
      } catch (closeError) {
        if (!operationError) {
          throw closeError;
        }
      }
    }
  }

  private async rawSftpOpen(sftp: any, remotePath: string, flags: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      sftp.open(remotePath, flags, (error: Error | undefined, handle: Buffer) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(handle);
      });
    });
  }

  private async rawSftpWrite(
    sftp: any,
    handle: Buffer,
    content: Buffer,
    offset: number,
    length: number,
    position: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      sftp.write(handle, content, offset, length, position, (error: Error | undefined) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async rawSftpSetSize(sftp: any, remotePath: string, handle: Buffer, size: number): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        sftp.fsetstat(handle, { size }, (error: Error | undefined) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      return;
    } catch (error) {
      if (typeof sftp.setstat !== 'function') {
        throw error;
      }
    }

    await new Promise<void>((resolve, reject) => {
      sftp.setstat(remotePath, { size }, (error: Error | undefined) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async rawSftpClose(sftp: any, handle: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      sftp.close(handle, (error: Error | undefined) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private isMissingFileError(error: unknown): boolean {
    const code = (error as any)?.code;
    const message = String((error as any)?.message || error || '').toLowerCase();

    return code === 2 || code === 'ENOENT' || message.includes('no such file') || message.includes('not found');
  }

  private async prepareSudoTempDirectory(client: SftpClient, tempDirectory: string): Promise<void> {
    const quotedTempDirectory = shellQuote(tempDirectory);
    await this.runRemoteCommandStrict(
      client,
      `mkdir -p ${quotedTempDirectory} && test -d ${quotedTempDirectory} && test -w ${quotedTempDirectory}`,
      15000,
      `Sudo temporary directory is not writable: ${tempDirectory}`
    );
  }

  private async ensureSudoSaveFreeSpace(
    client: SftpClient,
    connectionId: string,
    tempDirectory: string,
    targetDirectory: string,
    tempFileBytes: number,
    requiredTargetFreeBytes: number
  ): Promise<void> {
    const tempSpace = await this.getRemoteSpaceInfo(client, tempDirectory);

    if (requiredTargetFreeBytes <= 0) {
      this.assertEnoughRemoteSpace(tempSpace.availableBytes, tempFileBytes, 'sudo temporary directory');
      return;
    }

    const targetSpace = await this.getSudoRemoteSpaceInfo(connectionId, targetDirectory);
    const sameFilesystem = tempSpace.filesystem === targetSpace.filesystem || tempSpace.mountPoint === targetSpace.mountPoint;

    if (sameFilesystem) {
      this.assertEnoughRemoteSpace(
        tempSpace.availableBytes,
        tempFileBytes + requiredTargetFreeBytes,
        'sudo temporary directory and target filesystem'
      );
      return;
    }

    this.assertEnoughRemoteSpace(tempSpace.availableBytes, tempFileBytes, 'sudo temporary directory');
    this.assertEnoughRemoteSpace(targetSpace.availableBytes, requiredTargetFreeBytes, 'target filesystem');
  }

  private assertEnoughRemoteSpace(availableBytes: number, requiredBytes: number, label: string): void {
    if (requiredBytes <= 0) {
      return;
    }

    if (availableBytes < requiredBytes) {
      throw new Error(
        `Not enough free space on the remote ${label}. Required ${formatBytes(requiredBytes)}, available ${formatBytes(availableBytes)}.`
      );
    }
  }

  private async getRemoteSpaceInfo(client: SftpClient, remotePath: string): Promise<RemoteSpaceInfo> {
    const output = await this.runRemoteCommandStrict(
      client,
      `df -Pk ${shellQuote(remotePath)}`,
      15000,
      `Could not check free space for ${remotePath}`
    );

    return parseDfSpaceInfo(output, remotePath);
  }

  private async getSudoRemoteSpaceInfo(connectionId: string, remotePath: string): Promise<RemoteSpaceInfo> {
    const output = await this.runSudoCommandText(connectionId, `df -Pk ${shellQuote(remotePath)}`, 15000);
    return parseDfSpaceInfo(output, remotePath);
  }

  private async getSudoTargetMetadata(connectionId: string, remotePath: string): Promise<SudoTargetMetadata | undefined> {
    try {
      const output = await this.runSudoCommandText(connectionId, `LC_ALL=C ls -ldn ${shellQuote(remotePath)}`, 15000);
      const entry = parseLongListingLine(output.trim(), dirnameRemotePath(remotePath));
      if (!entry || entry.type === 'directory') {
        throw new Error(`Target path is not a regular file: ${remotePath}`);
      }

      return {
        size: entry.size,
        mode: modeFromPermissionString(entry.permissions)
      };
    } catch (error) {
      if (this.isMissingFileError(error)) {
        return undefined;
      }

      throw error;
    }
  }

  private async runRemoteCommandStrict(
    client: SftpClient,
    command: string,
    timeoutMs: number,
    errorMessage: string
  ): Promise<string> {
    const result = await this.executeRemoteCommand(client, command, { timeoutMs });

    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout.toString('utf8')).trim();
      throw new Error(detail ? `${errorMessage}: ${detail}` : errorMessage);
    }

    return result.stdout.toString('utf8');
  }

  private async cleanupRemoteTempFile(connectionId: string, tempPath: string): Promise<void> {
    const client = this.getClient(connectionId);

    try {
      await client.delete(tempPath);
      return;
    } catch {
      // Fall back to sudo cleanup below.
    }

    if (this.isSudoModeEnabled(connectionId)) {
      try {
        await this.runSudoCommandText(connectionId, `rm -f ${shellQuote(tempPath)}`, 15000);
      } catch {
        // Ignore cleanup errors. The original file operation result should be preserved.
      }
    }
  }

  private async runSudoValidationCommand(connectionId: string, password: string): Promise<RemoteExecResult> {
    const client = this.getClient(connectionId);
    return await this.executeRemoteCommand(client, `sudo -k -S -p '' -v`, {
      input: `${password}\n`,
      timeoutMs: 30000
    });
  }

  private async runSudoCommandText(connectionId: string, command: string, timeoutMs = 30000, cancellationToken?: ConnectionCancellationToken): Promise<string> {
    const result = await this.runSudoCommand(connectionId, command, timeoutMs, cancellationToken);
    return result.stdout.toString('utf8');
  }

  private async runSudoCommandBuffer(
    connectionId: string,
    command: string,
    timeoutMs = 30000,
    cancellationToken?: ConnectionCancellationToken,
    progress?: RemoteEditProgressReporter,
    totalBytes?: number,
    useIdleTimeout = false
  ): Promise<Buffer> {
    const result = await this.runSudoCommand(connectionId, command, timeoutMs, cancellationToken, progress, totalBytes, useIdleTimeout);
    return result.stdout;
  }

  private async runSudoCommand(
    connectionId: string,
    command: string,
    timeoutMs: number,
    cancellationToken?: ConnectionCancellationToken,
    progress?: RemoteEditProgressReporter,
    totalBytes?: number,
    useIdleTimeout = false
  ): Promise<RemoteExecResult> {
    const password = this.sudoPasswords.get(connectionId);

    if (!password) {
      throw new Error('Sudo Mode is not enabled for this connection.');
    }

    const client = this.getClient(connectionId);
    const result = await this.executeRemoteCommand(client, `sudo -S -p '' sh -c ${shellQuote(command)}`, {
      input: `${password}\n`,
      timeoutMs: useIdleTimeout ? undefined : timeoutMs,
      idleTimeoutMs: useIdleTimeout ? timeoutMs : undefined,
      cancellationToken,
      stdoutProgress: progress ? { label: 'Opening remote file...', progress, totalBytes } : undefined
    });

    if (result.code !== 0) {
      throw new Error(buildSudoErrorMessage(result.stderr || result.stdout.toString('utf8')));
    }

    return result;
  }

  private async executeRemoteCommandStreaming(
    client: SftpClient,
    command: string,
    callbacks: RemoteCommandStreamingCallbacks = {},
    cancellationToken?: ConnectionCancellationToken,
    options: RemoteCommandStreamingOptions = {}
  ): Promise<RemoteCommandStreamingResult> {
    const sshClient = (client as any).client;

    if (!sshClient || typeof sshClient.exec !== 'function') {
      throw new Error('The active SSH client does not support remote command execution.');
    }

    return new Promise<RemoteCommandStreamingResult>((resolve, reject) => {
      let settled = false;
      let remoteStream: any;
      let stopRequested = false;
      let forceKillRequested = false;
      let throttledOutputBytes = 0;
      let outputThrottleTimer: ReturnType<typeof setTimeout> | undefined;
      let forceCloseTimer: ReturnType<typeof setTimeout> | undefined;
      const maxOutputBytesBeforePause = 65536;
      const remoteProcessPidMarkerPrefix = String(options.remoteProcess?.pidMarkerPrefix || '');
      const remoteProcessPidPattern = remoteProcessPidMarkerPrefix
        ? new RegExp(`${escapeRegExp(remoteProcessPidMarkerPrefix)}(\\d+)__`)
        : undefined;
      const maxRemoteProcessPidMarkerLength = remoteProcessPidMarkerPrefix.length + 32;
      let remoteProcessPid = '';
      let pendingStdoutForRemoteProcess = '';
      let lastRemoteKillSignal: 'TERM' | 'KILL' | undefined;

      const emitStdoutAfterRemoteProcessFilter = (text: string) => {
        if (text) {
          callbacks.onStdout?.(text);
        }
      };

      const processStdoutForRemoteProcess = (chunk: string) => {
        if (!chunk || !remoteProcessPidPattern || !maxRemoteProcessPidMarkerLength || remoteProcessPid) {
          emitStdoutAfterRemoteProcessFilter(chunk);
          return;
        }

        pendingStdoutForRemoteProcess += chunk;

        while (pendingStdoutForRemoteProcess) {
          remoteProcessPidPattern.lastIndex = 0;
          const match = remoteProcessPidPattern.exec(pendingStdoutForRemoteProcess);

          if (!match) {
            const keepLength = getPotentialRemoteProcessPidMarkerSuffixLength(
              pendingStdoutForRemoteProcess,
              remoteProcessPidMarkerPrefix,
              maxRemoteProcessPidMarkerLength
            );
            if (pendingStdoutForRemoteProcess.length > keepLength) {
              const emitLength = pendingStdoutForRemoteProcess.length - keepLength;
              emitStdoutAfterRemoteProcessFilter(pendingStdoutForRemoteProcess.slice(0, emitLength));
              pendingStdoutForRemoteProcess = pendingStdoutForRemoteProcess.slice(emitLength);
            }
            return;
          }

          if (match.index > 0) {
            emitStdoutAfterRemoteProcessFilter(pendingStdoutForRemoteProcess.slice(0, match.index));
          }

          remoteProcessPid = String(match[1] || '').trim();
          pendingStdoutForRemoteProcess = pendingStdoutForRemoteProcess.slice(match.index + match[0].length);

          if (pendingStdoutForRemoteProcess.startsWith('\r\n')) {
            pendingStdoutForRemoteProcess = pendingStdoutForRemoteProcess.slice(2);
          } else if (pendingStdoutForRemoteProcess.startsWith('\n')) {
            pendingStdoutForRemoteProcess = pendingStdoutForRemoteProcess.slice(1);
          } else if (pendingStdoutForRemoteProcess.startsWith('\r')) {
            pendingStdoutForRemoteProcess = pendingStdoutForRemoteProcess.slice(1);
          }

          if (pendingStdoutForRemoteProcess) {
            emitStdoutAfterRemoteProcessFilter(pendingStdoutForRemoteProcess);
            pendingStdoutForRemoteProcess = '';
          }
          return;
        }
      };

      const flushStdoutForRemoteProcess = () => {
        if (pendingStdoutForRemoteProcess) {
          emitStdoutAfterRemoteProcessFilter(pendingStdoutForRemoteProcess);
          pendingStdoutForRemoteProcess = '';
        }
      };

      let pendingStderrForWrapperFilter = '';
      let skippingWrapperTerminationStderrBlock = false;

      const closeRemoteStreamForForceKill = () => {
        try {
          remoteStream?.close?.();
        } catch {
          // Ignore force-close errors.
        }
        try {
          remoteStream?.destroy?.();
        } catch {
          // Ignore force-destroy errors.
        }
      };

      const emitStderrAfterWrapperFilter = (text: string) => {
        if (text) {
          callbacks.onStderr?.(text);
        }
      };

      const isWrapperTerminationBlockStart = (line: string) => {
        return /\bTerminated\b/.test(line)
          && /(?:^|\s)(?:setsid\s+)?sh\s+-c\s+/.test(line)
          && /__remote_edit_|__REMOTE_EDIT_COMMAND/.test(line);
      };

      const isWrapperTerminationBlockEnd = (line: string) => {
        return /exit\s+"?\$__remote_edit_last_status"?'?\s*$/.test(line)
          || /exit\s+"?\$__remote_edit_wait_status"?'?\s*$/.test(line);
      };

      const isPlainWrapperTerminatedLine = (line: string) => {
        return /^\s*(?:[A-Za-z0-9_.-]+(?:\[\d+\])?:\s*)?(?:line\s+\d+:\s*)?\d+\s+Terminated\s*$/.test(line);
      };

      const filterWrapperTerminationStderrLine = (lineWithNewline: string) => {
        if (!stopRequested && !forceKillRequested) {
          return lineWithNewline;
        }

        const line = lineWithNewline.replace(/[\r\n]+$/g, '');

        if (skippingWrapperTerminationStderrBlock) {
          if (isWrapperTerminationBlockEnd(line)) {
            skippingWrapperTerminationStderrBlock = false;
          }
          return '';
        }

        if (isWrapperTerminationBlockStart(line)) {
          skippingWrapperTerminationStderrBlock = !isWrapperTerminationBlockEnd(line);
          return '';
        }

        if (isPlainWrapperTerminatedLine(line)) {
          return '';
        }

        return lineWithNewline;
      };

      const processStderrForWrapperFilter = (chunk: string) => {
        if (!chunk) {
          return;
        }

        if (!stopRequested && !forceKillRequested && !pendingStderrForWrapperFilter && !skippingWrapperTerminationStderrBlock) {
          emitStderrAfterWrapperFilter(chunk);
          return;
        }

        pendingStderrForWrapperFilter += chunk;
        let startIndex = 0;

        for (let index = 0; index < pendingStderrForWrapperFilter.length; index += 1) {
          const char = pendingStderrForWrapperFilter[index];
          if (char !== '\n' && char !== '\r') {
            continue;
          }

          let endIndex = index + 1;
          if (char === '\r' && pendingStderrForWrapperFilter[index + 1] === '\n') {
            endIndex += 1;
            index += 1;
          }

          emitStderrAfterWrapperFilter(filterWrapperTerminationStderrLine(pendingStderrForWrapperFilter.slice(startIndex, endIndex)));
          startIndex = endIndex;
        }

        pendingStderrForWrapperFilter = pendingStderrForWrapperFilter.slice(startIndex);

        if (pendingStderrForWrapperFilter.length > 8192) {
          emitStderrAfterWrapperFilter(filterWrapperTerminationStderrLine(pendingStderrForWrapperFilter));
          pendingStderrForWrapperFilter = '';
        }
      };

      const flushStderrForWrapperFilter = () => {
        if (pendingStderrForWrapperFilter) {
          emitStderrAfterWrapperFilter(filterWrapperTerminationStderrLine(pendingStderrForWrapperFilter));
          pendingStderrForWrapperFilter = '';
        }
        skippingWrapperTerminationStderrBlock = false;
      };

      const stdoutCliXmlSanitizer = options.sanitizePowerShellCliXml
        ? createPowerShellCliXmlStreamSanitizer(processStdoutForRemoteProcess)
        : undefined;
      const stderrCliXmlSanitizer = options.sanitizePowerShellCliXml
        ? createPowerShellCliXmlStreamSanitizer(processStderrForWrapperFilter)
        : undefined;
      const processStdoutChunk = (text: string) => {
        if (stdoutCliXmlSanitizer) {
          stdoutCliXmlSanitizer.write(text);
        } else {
          processStdoutForRemoteProcess(text);
        }
      };
      const processStderrChunk = (text: string) => {
        if (stderrCliXmlSanitizer) {
          stderrCliXmlSanitizer.write(text);
        } else {
          processStderrForWrapperFilter(text);
        }
      };
      const flushOutputSanitizers = () => {
        stdoutCliXmlSanitizer?.flush();
        stderrCliXmlSanitizer?.flush();
      };

      const runRemoteProcessKill = (force: boolean): boolean => {
        if (!remoteProcessPid || !/^\d+$/.test(remoteProcessPid)) {
          return false;
        }

        const signal: 'TERM' | 'KILL' = force ? 'KILL' : 'TERM';
        if (lastRemoteKillSignal === 'KILL' || (!force && lastRemoteKillSignal === 'TERM')) {
          return true;
        }
        lastRemoteKillSignal = signal;

        const killScript = [
          `__remote_edit_command_pid=${shellQuote(remoteProcessPid)}`,
          `kill -${signal} -"$__remote_edit_command_pid" 2>/dev/null || kill -${signal} "$__remote_edit_command_pid" 2>/dev/null || true`
        ].join('\n');

        try {
          sshClient.exec(killScript, (error: Error | undefined, killStream: any) => {
            if (error || !killStream) {
              return;
            }

            try {
              killStream.stderr?.resume?.();
            } catch {
              // Ignore kill stderr handling errors.
            }
            try {
              killStream.resume?.();
            } catch {
              // Ignore kill stdout handling errors.
            }
            try {
              killStream.end?.();
            } catch {
              // Ignore kill stdin close errors.
            }
          });
          return true;
        } catch {
          return false;
        }
      };

      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        cancellationDisposable?.dispose();
        if (outputThrottleTimer) {
          clearTimeout(outputThrottleTimer);
          outputThrottleTimer = undefined;
        }
        if (forceCloseTimer) {
          clearTimeout(forceCloseTimer);
          forceCloseTimer = undefined;
        }
        flushOutputSanitizers();
        flushStdoutForRemoteProcess();
        flushStderrForWrapperFilter();
        callback();
      };

      const requestStop = (force = false) => {
        if (settled) {
          return;
        }

        stopRequested = true;
        forceKillRequested = forceKillRequested || force;

        if (!remoteStream) {
          settle(() => reject(new Error('Operation cancelled.')));
          return;
        }

        if (outputThrottleTimer) {
          clearTimeout(outputThrottleTimer);
          outputThrottleTimer = undefined;
        }

        const remoteKillSent = runRemoteProcessKill(force);

        try {
          remoteStream.resume?.();
        } catch {
          // Ignore resume errors while stopping.
        }

        try {
          if (typeof remoteStream.signal === 'function') {
            remoteStream.signal(force ? 'KILL' : 'TERM');
          }
        } catch {
          // Some servers do not support SSH channel signals. The remote PID kill above is the primary stop path.
        }

        if (force) {
          if (forceCloseTimer) {
            clearTimeout(forceCloseTimer);
          }
          forceCloseTimer = setTimeout(closeRemoteStreamForForceKill, remoteKillSent ? 500 : 0);
        } else if (!remoteKillSent && typeof remoteStream.signal !== 'function') {
          try {
            remoteStream.close?.();
          } catch {
            // Ignore stream close errors when a command is stopped.
          }
        }
      };

      const throttleOutputIfNeeded = (byteCount: number) => {
        if (!remoteStream || settled || stopRequested || forceKillRequested || byteCount <= 0) {
          return;
        }

        throttledOutputBytes += byteCount;
        if (throttledOutputBytes < maxOutputBytesBeforePause || outputThrottleTimer) {
          return;
        }

        try {
          remoteStream.pause?.();
        } catch {
          // Ignore pause errors. Output throttling is best-effort only.
        }

        outputThrottleTimer = setTimeout(() => {
          outputThrottleTimer = undefined;
          throttledOutputBytes = 0;
          if (settled || stopRequested || forceKillRequested) {
            return;
          }
          try {
            remoteStream?.resume?.();
          } catch {
            // Ignore resume errors.
          }
        }, 50);
      };

      const cancellationDisposable = cancellationToken?.onCancellationRequested(() => requestStop(false));

      if (cancellationToken?.isCancellationRequested) {
        cancellationDisposable?.dispose();
        settle(() => reject(new Error('Operation cancelled.')));
        return;
      }

      try {
        sshClient.exec(command, (error: Error | undefined, stream: any) => {
          if (error) {
            settle(() => reject(error));
            return;
          }

          if (!stream) {
            settle(() => reject(new Error('Remote command did not return a stream.')));
            return;
          }

          remoteStream = stream;
          callbacks.onControl?.({
            stop: () => requestStop(false),
            forceKill: () => requestStop(true)
          });

          if (stopRequested) {
            requestStop(forceKillRequested);
          }

          stream.on('data', (data: Buffer | string) => {
            const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
            if (text) {
              processStdoutChunk(text);
              throttleOutputIfNeeded(Buffer.isBuffer(data) ? data.length : Buffer.byteLength(text, 'utf8'));
            }
          });

          stream.stderr?.on?.('data', (data: Buffer | string) => {
            const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
            if (text) {
              processStderrChunk(text);
              throttleOutputIfNeeded(Buffer.isBuffer(data) ? data.length : Buffer.byteLength(text, 'utf8'));
            }
          });

          stream.on('close', (code: number | undefined, signal: string | undefined) => {
            settle(() => resolve({
              code: typeof code === 'number' ? code : 0,
              signal
            }));
          });

          stream.on('error', (streamError: Error) => {
            if (stopRequested) {
              settle(() => reject(new Error('Operation cancelled.')));
              return;
            }

            settle(() => reject(streamError));
          });

          // Keep the runner non-interactive. Commands that require input receive EOF.
          // When sudo is used, send only the sudo password and then close stdin;
          // the sudo shell redirects stdin from /dev/null before running the user command.
          if (options.input) {
            try {
              stream.write(options.input);
            } catch {
              // Ignore write errors; the stream close/error handlers will report the command result.
            }
          }
          stream.end();
        });
      } catch (error) {
        settle(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  private async executeRemoteCommand(client: SftpClient, command: string, options: RemoteExecOptions = {}): Promise<RemoteExecResult> {
    const sshClient = (client as any).client;

    if (!sshClient || typeof sshClient.exec !== 'function') {
      throw new Error('The active SSH client does not support remote command execution.');
    }

    return new Promise<RemoteExecResult>((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;
      let remoteStream: any;

      const commandTimeoutMs = options.idleTimeoutMs || options.timeoutMs || 30000;
      const usesIdleTimeout = Number(options.idleTimeoutMs || 0) > 0;
      let timer: NodeJS.Timeout;

      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        cancellationDisposable?.dispose();
        callback();
      };

      const startTimer = () => setTimeout(() => {
        try {
          remoteStream?.close?.();
        } catch {
          // Ignore stream close errors when a command times out.
        }

        const message = usesIdleTimeout
          ? `Remote command timed out after ${commandTimeoutMs} ms without output.`
          : `Remote command timed out after ${commandTimeoutMs} ms.`;

        settle(() => reject(new Error(message)));
      }, commandTimeoutMs);

      const resetIdleTimer = () => {
        if (!usesIdleTimeout || settled) {
          return;
        }

        clearTimeout(timer);
        timer = startTimer();
      };

      timer = startTimer();

      const cancellationDisposable = options.cancellationToken?.onCancellationRequested(() => {
        try {
          remoteStream?.close?.();
        } catch {
          // Ignore stream close errors when a command is cancelled.
        }
        settle(() => reject(new Error('Operation cancelled.')));
      });

      if (options.cancellationToken?.isCancellationRequested) {
        cancellationDisposable?.dispose();
        settle(() => reject(new Error('Operation cancelled.')));
        return;
      }

      try {
        sshClient.exec(command, (error: Error | undefined, stream: any) => {
          if (error) {
            settle(() => reject(error));
            return;
          }

          if (!stream) {
            settle(() => reject(new Error('Remote command did not return a stream.')));
            return;
          }

          remoteStream = stream;

          let stdoutTransferredBytes = 0;

          stream.on('data', (data: Buffer | string) => {
            resetIdleTimer();
            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
            stdoutChunks.push(chunk);

            if (options.stdoutProgress?.progress && Number(options.stdoutProgress.totalBytes || 0) > 0) {
              stdoutTransferredBytes += chunk.length;
              options.stdoutProgress.progress.reportBytes(
                options.stdoutProgress.label,
                stdoutTransferredBytes,
                Number(options.stdoutProgress.totalBytes || 0)
              );
            }
          });

          stream.stderr?.on?.('data', (data: Buffer | string) => {
            resetIdleTimer();
            stderrChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
          });

          stream.on('close', (code: number | undefined, signal: string | undefined) => {
            const stdoutText = Buffer.concat(stdoutChunks).toString('utf8');
            const stderrText = Buffer.concat(stderrChunks).toString('utf8');
            const cleanStdoutText = options.sanitizePowerShellCliXml ? sanitizePowerShellCliXml(stdoutText) : stdoutText;
            const cleanStderrText = options.sanitizePowerShellCliXml ? sanitizePowerShellCliXml(stderrText) : stderrText;
            settle(() => resolve({
              stdout: Buffer.from(cleanStdoutText, 'utf8'),
              stderr: cleanStderrText,
              code: typeof code === 'number' ? code : 0,
              signal
            }));
          });

          stream.on('error', (streamError: Error) => {
            settle(() => reject(streamError));
          });

          if (options.input !== undefined) {
            stream.write(options.input);
          }

          stream.end();
        });
      } catch (error) {
        settle(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  private async runRemoteCommand(client: SftpClient, command: string): Promise<string> {
    const sshClient = (client as any).client;

    if (!sshClient || typeof sshClient.exec !== 'function') {
      return '';
    }

    return new Promise<string>(resolve => {
      let stdout = '';
      let settled = false;
      let remoteStream: any;

      const settle = (value: string) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      const timer = setTimeout(() => {
        try {
          remoteStream?.close?.();
        } catch {
          // Ignore stream close errors when command lookup times out.
        }
        settle('');
      }, 5000);

      try {
        sshClient.exec(command, (error: Error | undefined, stream: any) => {
          if (error || !stream || settled) {
            settle('');
            return;
          }

          remoteStream = stream;
          stream.on('data', (data: Buffer | string) => {
            stdout += data.toString();
          });
          stream.stderr?.on?.('data', () => {
            // Lookup errors are intentionally ignored; numeric IDs are kept as fallback.
          });
          stream.on('close', () => {
            settle(stdout);
          });
          stream.on('error', () => {
            settle('');
          });
        });
      } catch {
        settle('');
      }
    });
  }
}



