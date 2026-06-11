import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { Readable, Writable } from 'stream';
import SftpClient from 'ssh2-sftp-client';
import type { Client } from 'ssh2';
import { expandHomePath } from '../utils/localPathUtils';
import { getBooleanSetting, getNumberSetting, getStringSetting } from '../utils/settingsUtils';
import { buildRemoteTempPath, buildSudoErrorMessage, shellQuote } from '../utils/shellUtils';
import { appendPerformanceLog, createPerformanceTimer } from '../utils/outputLogger';
import { RemoteEditOperationCancelledError, type RemoteEditProgressReporter } from '../utils/progressUtils';
import { isSftpConnectionType, SFTP_CONNECTION_TYPE } from '../remote/RemoteConnectionTypes';
import type { RemoteSessionManager, RemoteListDirectoryOptions } from '../remote/RemoteSessionManager';
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

interface ChecksumCommandAttempt {
  label: string;
  command: (quotedPath: string) => string;
  length: number;
}

interface RemoteExecOptions {
  input?: string;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  cancellationToken?: ConnectionCancellationToken;
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
  private readonly sudoPasswords = new Map<string, string>();
  private readonly readFileCache = new Map<string, CachedReadFile>();
  private readonly directoryListingCache = new Map<string, CachedDirectoryListing>();

  async connect(options: ConnectOptions, cancellationToken?: ConnectionCancellationToken): Promise<ActiveConnection> {
    if (!isSftpConnectionType(options.connectionType)) {
      throw new Error('SftpSessionManager only supports SFTP connections.');
    }

    await this.disconnect(options.connectionId);

    if (cancellationToken?.isCancellationRequested) {
      throw new Error('Connection cancelled.');
    }

    const client = new SftpClient(`remoteedit-${options.connectionId}`);
    const config: Record<string, unknown> = {
      host: options.host,
      port: options.port,
      username: options.username,
      readyTimeout: getNumberSetting('sshReadyTimeout', 30000, 1000, 300000)
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

      throw error;
    }

    const homePath = await this.safeCwd(client);

    if (cancellationToken?.isCancellationRequested) {
      cancellationSubscription?.dispose();
      await this.closeClientForCancellation(client);
      throw new Error('Connection cancelled.');
    }

    const requestedStartPath = normalizeRemotePath(options.startPath || homePath || '/');
    const startPath = await this.resolveStartPath(client, requestedStartPath, homePath);

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
      keepAlive: options.keepAlive !== false
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
      try {
        await client.end();
      } catch {
        // Ignore disconnect errors during cleanup.
      }
    }

    this.sessions.delete(connectionId);
    this.connections.delete(connectionId);
    this.ownerNameCaches.delete(connectionId);
    this.groupNameCaches.delete(connectionId);
    this.sudoPasswords.delete(connectionId);
    this.clearReadFileCache(connectionId);
    this.clearDirectoryListingCache(connectionId);
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

    const client = this.getClient(connectionId);
    const normalizedWorkingDirectory = normalizeRemotePath(workingDirectory || '/');
    const displayScript = this.buildRemoteCommandDisplayScript(trimmedCommand);
    const streamingCallbacks = this.createRemoteCommandDisplayCallbacks(displayScript, callbacks);
    const sudoPassword = this.sudoPasswords.get(connectionId);
    const remoteProcessMarkerToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const remoteProcessPidMarkerPrefix = `__REMOTE_EDIT_PROCESS_PID_${remoteProcessMarkerToken}_`;
    const controlledScript = this.buildControlledRemoteCommandScript(
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

  private buildControlledRemoteCommandScript(
    workingDirectory: string,
    commandScript: string,
    pidMarkerPrefix: string,
    redirectInputFromNull: boolean
  ): string {
    const inputRedirectLine = redirectInputFromNull ? 'exec </dev/null' : '';
    const scriptLines = [
      `cd ${shellQuote(workingDirectory)} || exit $?`,
      inputRedirectLine,
      'if command -v setsid >/dev/null 2>&1; then',
      `  setsid sh -c ${shellQuote(commandScript)} &`,
      'else',
      `  sh -c ${shellQuote(commandScript)} &`,
      'fi',
      '__remote_edit_command_pid=$!',
      `printf '%s%s%s\\n' ${shellQuote(pidMarkerPrefix)} "$__remote_edit_command_pid" ${shellQuote('__')}`,
      'wait "$__remote_edit_command_pid" 2>/dev/null',
      '__remote_edit_wait_status=$?',
      'exit "$__remote_edit_wait_status"'
    ];

    return scriptLines.filter(line => line !== '').join('\n');
  }



  private buildRemoteCommandDisplayScript(command: string): {
    readonly script: string;
    flush: () => void;
  } {
    const logicalCommands = this.splitRemoteCommandForDisplay(command);
    const markerToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const commandMarkerPrefix = `__REMOTE_EDIT_COMMAND_${markerToken}_`;
    const statusMarkerPrefix = `__REMOTE_EDIT_COMMAND_STATUS_${markerToken}_`;
    const markerMap = new Map<string, string>();

    const scriptParts: string[] = ['__remote_edit_last_status=0'];

    logicalCommands.forEach((logicalCommand, index) => {
      const commandMarker = `${commandMarkerPrefix}${index}__`;
      const statusMarkerPrefixForCommand = `${statusMarkerPrefix}${index}_`;
      markerMap.set(commandMarker, logicalCommand);
      const commandMarkerPrinter = index === 0
        ? `printf '%s\\n' ${shellQuote(commandMarker)}`
        : `printf '\\n%s\\n' ${shellQuote(commandMarker)}`;

      scriptParts.push(commandMarkerPrinter);
      scriptParts.push(logicalCommand);
      scriptParts.push('__remote_edit_command_status=$?');
      scriptParts.push('__remote_edit_last_status=$__remote_edit_command_status');
      scriptParts.push(`printf '%s%s%s\\n' ${shellQuote(statusMarkerPrefixForCommand)} "$__remote_edit_command_status" ${shellQuote('__')}`);
    });

    scriptParts.push('exit $__remote_edit_last_status');
    const script = scriptParts.join('\n');

    const maxCommandMarkerLength = Array.from(markerMap.keys()).reduce((max, marker) => Math.max(max, marker.length), 0);
    const maxStatusMarkerLength = statusMarkerPrefix.length + String(Math.max(0, logicalCommands.length - 1)).length + 1 + 16 + 2;
    const displayScript = {
      script,
      flush: () => undefined as void
    };

    (displayScript as any).commandMarkerPrefix = commandMarkerPrefix;
    (displayScript as any).statusMarkerPrefix = statusMarkerPrefix;
    (displayScript as any).markerMap = markerMap;
    (displayScript as any).maxMarkerLength = Math.max(maxCommandMarkerLength, maxStatusMarkerLength);

    return displayScript;
  }

  private createRemoteCommandDisplayCallbacks(
    displayScript: { readonly script: string; flush: () => void },
    callbacks: RemoteCommandStreamingCallbacks
  ): RemoteCommandStreamingCallbacks {
    const commandMarkerPrefix = String((displayScript as any).commandMarkerPrefix || '');
    const statusMarkerPrefix = String((displayScript as any).statusMarkerPrefix || '');
    const markerMap = (displayScript as any).markerMap as Map<string, string> | undefined;
    const maxMarkerLength = Number((displayScript as any).maxMarkerLength || 0);
    const commandMarkerPattern = commandMarkerPrefix ? new RegExp(`${this.escapeRegExp(commandMarkerPrefix)}\\d+__`) : undefined;
    const statusMarkerPattern = statusMarkerPrefix ? new RegExp(`${this.escapeRegExp(statusMarkerPrefix)}(\\d+)_(\\d+)__`) : undefined;
    const markerPattern = commandMarkerPrefix || statusMarkerPrefix
      ? new RegExp([
        commandMarkerPrefix ? `${this.escapeRegExp(commandMarkerPrefix)}\\d+__` : '',
        statusMarkerPrefix ? `${this.escapeRegExp(statusMarkerPrefix)}\\d+_\\d+__` : ''
      ].filter(Boolean).join('|'))
      : undefined;
    let pendingStdout = '';

    const emitStdout = (text: string) => {
      if (text) {
        callbacks.onStdout?.(text);
      }
    };

    const processStdout = (chunk: string) => {
      if (!chunk || !markerPattern || !markerMap || !maxMarkerLength) {
        emitStdout(chunk);
        return;
      }

      pendingStdout += chunk;

      while (pendingStdout) {
        markerPattern.lastIndex = 0;
        const match = markerPattern.exec(pendingStdout);

        if (!match) {
          const keepLength = this.getPotentialRemoteCommandDisplayMarkerSuffixLength(
            pendingStdout,
            commandMarkerPrefix,
            statusMarkerPrefix,
            maxMarkerLength
          );
          if (pendingStdout.length > keepLength) {
            const emitLength = pendingStdout.length - keepLength;
            emitStdout(pendingStdout.slice(0, emitLength));
            pendingStdout = pendingStdout.slice(emitLength);
          }
          return;
        }

        if (match.index > 0) {
          emitStdout(pendingStdout.slice(0, match.index));
        }

        const marker = match[0];
        if (commandMarkerPattern?.test(marker)) {
          commandMarkerPattern.lastIndex = 0;
          const command = markerMap.get(marker);
          if (command) {
            callbacks.onCommand?.(command);
          }
        } else if (statusMarkerPattern) {
          statusMarkerPattern.lastIndex = 0;
          const statusMatch = statusMarkerPattern.exec(marker);
          if (statusMatch) {
            callbacks.onCommandStatus?.(Number(statusMatch[1]), Number(statusMatch[2]));
          }
        }

        pendingStdout = pendingStdout.slice(match.index + marker.length);
        if (pendingStdout.startsWith('\r\n')) {
          pendingStdout = pendingStdout.slice(2);
        } else if (pendingStdout.startsWith('\n')) {
          pendingStdout = pendingStdout.slice(1);
        } else if (pendingStdout.startsWith('\r')) {
          pendingStdout = pendingStdout.slice(1);
        }
      }
    };

    displayScript.flush = () => {
      if (pendingStdout) {
        emitStdout(pendingStdout);
        pendingStdout = '';
      }
    };

    return {
      ...callbacks,
      onStdout: processStdout,
      onStderr: callbacks.onStderr
    };
  }

  private splitRemoteCommandForDisplay(command: string): string[] {
    const normalized = String(command || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

    if (!normalized) {
      return [];
    }

    if (this.shouldKeepRemoteCommandAsSingleBlock(normalized)) {
      return [normalized];
    }

    const logicalCommands: string[] = [];
    const currentLines: string[] = [];

    for (const line of normalized.split('\n')) {
      if (!currentLines.length && !line.trim()) {
        continue;
      }

      currentLines.push(line);

      if (this.isShellLineContinued(line)) {
        continue;
      }

      const logicalCommand = currentLines.join('\n').trim();
      if (logicalCommand) {
        logicalCommands.push(logicalCommand);
      }
      currentLines.length = 0;
    }

    const trailingCommand = currentLines.join('\n').trim();
    if (trailingCommand) {
      logicalCommands.push(trailingCommand);
    }

    return logicalCommands.length ? logicalCommands : [normalized];
  }

  private shouldKeepRemoteCommandAsSingleBlock(command: string): boolean {
    const lines = command.split('\n').map(line => line.trim()).filter(Boolean);

    if (lines.length <= 1) {
      return false;
    }

    return lines.some(line =>
      /<<[-]?\s*['"]?\w+['"]?/.test(line) ||
      /^(if|for|while|until|case|select)\b/.test(line) ||
      /\b(then|do)\s*$/.test(line) ||
      /^(elif|else|fi|done|esac)\b/.test(line) ||
      /^\{\s*$/.test(line) ||
      /^\}\s*$/.test(line)
    );
  }

  private isShellLineContinued(line: string): boolean {
    const trimmedRight = String(line || '').replace(/[ \t]+$/g, '');
    let trailingBackslashes = 0;

    for (let index = trimmedRight.length - 1; index >= 0 && trimmedRight[index] === '\\'; index -= 1) {
      trailingBackslashes += 1;
    }

    return trailingBackslashes > 0 && trailingBackslashes % 2 === 1;
  }

  private escapeRegExp(value: string): string {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }


  private getPotentialRemoteCommandDisplayMarkerSuffixLength(
    text: string,
    commandMarkerPrefix: string,
    statusMarkerPrefix: string,
    maxMarkerLength: number
  ): number {
    return this.getPotentialMarkerSuffixLength(text, maxMarkerLength, suffix => {
      if (commandMarkerPrefix && this.isPotentialNumberMarkerSuffix(suffix, commandMarkerPrefix)) {
        return true;
      }

      if (!statusMarkerPrefix) {
        return false;
      }

      if (statusMarkerPrefix.startsWith(suffix)) {
        return true;
      }

      if (!suffix.startsWith(statusMarkerPrefix)) {
        return false;
      }

      const rest = suffix.slice(statusMarkerPrefix.length);
      return /^\d*(?:_\d*)?(?:_{0,2})?$/.test(rest);
    });
  }

  private getPotentialRemoteProcessPidMarkerSuffixLength(text: string, pidMarkerPrefix: string, maxMarkerLength: number): number {
    if (!pidMarkerPrefix) {
      return 0;
    }

    return this.getPotentialMarkerSuffixLength(text, maxMarkerLength, suffix => this.isPotentialNumberMarkerSuffix(suffix, pidMarkerPrefix));
  }

  private getPotentialMarkerSuffixLength(text: string, maxMarkerLength: number, isPotentialMarkerSuffix: (suffix: string) => boolean): number {
    const maxLength = Math.min(Math.max(0, maxMarkerLength - 1), text.length);

    for (let length = maxLength; length > 0; length -= 1) {
      const suffix = text.slice(text.length - length);
      if (isPotentialMarkerSuffix(suffix)) {
        return length;
      }
    }

    return 0;
  }

  private isPotentialNumberMarkerSuffix(suffix: string, markerPrefix: string): boolean {
    if (!suffix) {
      return false;
    }

    if (markerPrefix.startsWith(suffix)) {
      return true;
    }

    if (!suffix.startsWith(markerPrefix)) {
      return false;
    }

    const rest = suffix.slice(markerPrefix.length);
    return /^\d*(?:_{0,2})?$/.test(rest);
  }
  async listDirectory(connectionId: string, remotePath: string, options: RemoteListDirectoryOptions = {}): Promise<RemoteEntry[]> {
    const client = this.getClient(connectionId);
    const normalizedPath = normalizeRemotePath(remotePath);
    const totalTimer = createPerformanceTimer();
    const cacheTtlSeconds = getNumberSetting('directoryListingCacheTtl', 30, 0, 300);
    const cacheEnabled = cacheTtlSeconds > 0 && !this.isSudoModeEnabled(connectionId);
    const cacheKey = this.buildDirectoryListingCacheKey(connectionId, normalizedPath);
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
          items: cachedEntries.length,
          total: `${totalTimer()}ms`
        });
        return cachedEntries;
      }
    }

    const cacheState = cacheEnabled ? (options.forceRefresh ? 'refresh' : 'miss') : 'disabled';

    try {
      const listTimer = createPerformanceTimer();
      const items = await client.list(normalizedPath);
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
          path: joinRemotePath(normalizedPath, item.name),
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

    appendPerformanceLog(this.output, 'SFTP', `sudoListDirectory ${normalizedPath}`, {
      cache: 'disabled',
      items: sortedSudoEntries.length,
      list: `${sudoListMs}ms`,
      map: `${mapMs}ms`,
      sort: `${sortMs}ms`,
      total: `${totalTimer()}ms`
    });

    return sortedSudoEntries;
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

  private async readRemoteFile(connectionId: string, normalizedPath: string, cancellationToken?: ConnectionCancellationToken, progress?: RemoteEditProgressReporter): Promise<Buffer> {
    const client = this.getClient(connectionId);

    if (this.isSudoModeEnabled(connectionId)) {
      const metadata = await this.getSudoTargetMetadata(connectionId, normalizedPath);
      return await this.runSudoCommandBuffer(connectionId, `cat ${shellQuote(normalizedPath)}`, SUDO_READ_IDLE_TIMEOUT_MS, cancellationToken, progress, metadata?.size, true);
    }

    try {
      const stats = await client.stat(normalizedPath);
      if (Number((stats as any).size || 0) === 0) {
        return Buffer.alloc(0);
      }
    } catch {
      // Ignore stat errors here. The actual read will report permission or missing-file errors.
    }

    const stats = await client.stat(normalizedPath).catch(() => undefined as any);
    const totalBytes = Number((stats as any)?.size || 0);
    return await readRemoteFileToBuffer(client, normalizedPath, cancellationToken, progress, totalBytes);
  }

  async writeFile(connectionId: string, remotePath: string, content: Uint8Array, progress?: RemoteEditProgressReporter, cancellationToken?: ConnectionCancellationToken): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedPath = normalizeRemotePath(remotePath);
    const buffer = Buffer.from(content);

    if (!this.isSudoModeEnabled(connectionId)) {
      try {
        const originalMode = await this.getRemoteFileMode(client, normalizedPath);

        // Existing files must be updated in-place so owner, group,
        // permissions, ACLs, and inode are not replaced during save.
        await this.writeExistingRemoteFileInPlace(client, normalizedPath, buffer, progress, cancellationToken);
        await this.restoreOriginalSpecialPermissionBitsIfNeeded(client, normalizedPath, originalMode);
      } catch (error) {
        if (!this.isMissingFileError(error)) {
          throw error;
        }

        // New files must be created by the remote server without an explicit mode
        // so the connected user's default permissions and umask are respected.
        await this.createRemoteFileWithServerDefaults(client, normalizedPath);

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
    const normalizedPath = normalizeRemotePath(remotePath);

    try {
      const stats = await client.stat(normalizedPath);
      const resolvedType = await this.resolvePathType(client, normalizedPath, stats);

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
    const normalizedPath = normalizeRemotePath(remotePath);

    if (this.isSudoModeEnabled(connectionId)) {
      // Create the file through the remote sudo shell without chmod/mode.
      // set -C makes the redirection fail if the path already exists.
      await this.runSudoCommandText(connectionId, `set -C; : > ${shellQuote(normalizedPath)}`, 30000);
      this.clearReadFileCache(connectionId, normalizedPath);
      return;
    }

    await this.createRemoteFileWithServerDefaults(client, normalizedPath);
    this.clearReadFileCache(connectionId, normalizedPath);
  }

  async createDirectory(connectionId: string, remotePath: string): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedPath = normalizeRemotePath(remotePath);

    if (this.isSudoModeEnabled(connectionId)) {
      await this.runSudoCommandText(connectionId, `mkdir -p ${shellQuote(normalizedPath)}`, 30000);
      this.clearReadFileCache(connectionId, normalizedPath);
      return;
    }

    await client.mkdir(normalizedPath, true);
    this.clearReadFileCache(connectionId, normalizedPath);
  }

  async delete(connectionId: string, remotePath: string): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedPath = normalizeRemotePath(remotePath);

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

    const entryType = await this.resolveEntryTypeWithoutFollowingLinks(client, normalizedPath);

    if (entryType === 'directory') {
      await client.rmdir(normalizedPath, true);
    } else {
      await client.delete(normalizedPath);
    }

    this.clearReadFileCache(connectionId, normalizedPath);
  }

  async rename(connectionId: string, oldPath: string, newPath: string): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedOldPath = normalizeRemotePath(oldPath);
    const normalizedNewPath = normalizeRemotePath(newPath);

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

    await client.rename(normalizedOldPath, normalizedNewPath);
    this.clearReadFileCache(connectionId, normalizedOldPath);
    this.clearReadFileCache(connectionId, normalizedNewPath);
  }

  async copyFile(connectionId: string, sourcePath: string, targetPath: string, overwrite = false, cancellationToken?: ConnectionCancellationToken): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedSourcePath = normalizeRemotePath(sourcePath);
    const normalizedTargetPath = normalizeRemotePath(targetPath);
    const command = this.buildCopyFileCommand(normalizedSourcePath, normalizedTargetPath, overwrite);

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
    const client = this.getClient(connectionId);
    const normalizedBaseDirectory = normalizeRemotePath(baseDirectory);
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

    const command = this.buildCreateArchiveCommand(normalizedBaseDirectory, safeEntryNames, safeArchiveName, format, overwrite);

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

  private buildCopyFileCommand(sourcePath: string, targetPath: string, overwrite: boolean): string {
    const source = shellQuote(sourcePath);
    const target = shellQuote(targetPath);
    const targetGuard = overwrite
      ? `if [ -d ${target} ] && [ ! -L ${target} ]; then echo 'Target is a directory.' >&2; exit 21; fi; if [ -L ${target} ]; then echo 'Target is a symbolic link.' >&2; exit 21; fi;`
      : `if [ -e ${target} ] || [ -L ${target} ]; then echo 'Target already exists.' >&2; exit 17; fi;`;

    return `if [ ! -f ${source} ]; then echo 'Source is not a regular file.' >&2; exit 22; fi; ${targetGuard} cp -p ${source} ${target}`;
  }

  private buildCreateArchiveCommand(
    baseDirectory: string,
    entryNames: string[],
    archiveName: string,
    format: RemoteArchiveFormat,
    overwrite: boolean
  ): string {
    const directory = shellQuote(baseDirectory);
    const target = shellQuote(archiveName);
    const tempTar = shellQuote(`.remoteedit-archive-${Date.now()}-${Math.random().toString(16).slice(2)}.tar`);
    const entries = entryNames.map(name => shellQuote(`./${name}`)).join(' ');
    const compression = this.buildArchiveCompressionCommand(format, tempTar, target, overwrite);
    const compressor = this.getArchiveCompressorCommand(format);
    const targetGuard = overwrite
      ? `if [ -d ${target} ] && [ ! -L ${target} ]; then echo 'Target archive is a directory.' >&2; exit 21; fi; rm -f ${target}`
      : `if [ -e ${target} ] || [ -L ${target} ]; then echo 'Target archive already exists.' >&2; exit 17; fi`;

    return [
      `cd ${directory}`,
      `if ! command -v tar >/dev/null 2>&1; then echo 'tar command not found on the remote host.' >&2; exit 127; fi`,
      `if ! command -v ${compressor} >/dev/null 2>&1; then echo '${compressor} command not found on the remote host.' >&2; exit 127; fi`,
      targetGuard,
      `rm -f ${tempTar}`,
      `tar -cf ${tempTar} ${entries}`,
      `__remote_edit_status=$?`,
      `if [ $__remote_edit_status -eq 0 ]; then ${compression}; __remote_edit_status=$?; fi`,
      `rm -f ${tempTar}`,
      `exit $__remote_edit_status`
    ].join('; ');
  }

  private buildArchiveCompressionCommand(format: RemoteArchiveFormat, tempTar: string, target: string, overwrite: boolean): string {
    const redirect = overwrite ? `> ${target}` : `> ${target}`;
    const command = (() => {
      switch (format) {
        case 'tar.gz':
          return `gzip -c ${tempTar} ${redirect}`;
        case 'tar.bz2':
          return `bzip2 -c ${tempTar} ${redirect}`;
        case 'tar.xz':
          return `xz -c ${tempTar} ${redirect}`;
        case 'tar.Z':
          return `compress -c ${tempTar} ${redirect}`;
        default:
          return '';
      }
    })();

    return overwrite ? command : `(set -C; ${command})`;
  }

  private getArchiveCompressorCommand(format: RemoteArchiveFormat): string {
    switch (format) {
      case 'tar.gz':
        return 'gzip';
      case 'tar.bz2':
        return 'bzip2';
      case 'tar.xz':
        return 'xz';
      case 'tar.Z':
        return 'compress';
      default:
        return 'gzip';
    }
  }


  async calculateChecksums(connectionId: string, remotePath: string, cancellationToken?: ConnectionCancellationToken): Promise<RemoteChecksumSummary> {
    const normalizedPath = normalizeRemotePath(remotePath);

    return {
      sha256: await this.calculateChecksum(connectionId, normalizedPath, 'SHA-256', this.buildSha256ChecksumAttempts(), cancellationToken),
      md5: await this.calculateChecksum(connectionId, normalizedPath, 'MD5', this.buildMd5ChecksumAttempts(), cancellationToken)
    };
  }

  private buildSha256ChecksumAttempts(): ChecksumCommandAttempt[] {
    return [
      { label: 'sha256sum', command: quotedPath => `sha256sum ${quotedPath}`, length: 64 },
      { label: 'shasum -a 256', command: quotedPath => `shasum -a 256 ${quotedPath}`, length: 64 },
      { label: 'csum -h SHA256', command: quotedPath => `csum -h SHA256 ${quotedPath}`, length: 64 },
      { label: 'digest -a sha256', command: quotedPath => `digest -a sha256 ${quotedPath}`, length: 64 },
      { label: 'openssl dgst -sha256', command: quotedPath => `openssl dgst -sha256 ${quotedPath}`, length: 64 }
    ];
  }

  private buildMd5ChecksumAttempts(): ChecksumCommandAttempt[] {
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
    attempts: ChecksumCommandAttempt[],
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
        const checksum = this.extractChecksum(output, attempt.length);

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

  private extractChecksum(output: string, length: number): string | undefined {
    const pattern = new RegExp(`\\b[0-9a-fA-F]{${length}}\\b`);
    const match = String(output || '').match(pattern);
    return match ? match[0].toLowerCase() : undefined;
  }


  async changeOwnerGroup(connectionId: string, remotePath: string, options: ChangeOwnerGroupOptions): Promise<void> {
    const normalizedPath = normalizeRemotePath(remotePath);
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

  async chmod(connectionId: string, remotePath: string, mode: string | number, options: ChmodOptions = {}): Promise<void> {
    const client = this.getClient(connectionId);
    const modeText = typeof mode === 'number' ? mode.toString(8) : String(mode).trim();

    if (!/^[0-7]{3,4}$/.test(modeText)) {
      throw new Error(`Invalid permission mode '${modeText}'.`);
    }

    const normalizedPath = normalizeRemotePath(remotePath);

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
    this.clearReadFileCache(connectionId);
  }

  isSudoModeEnabled(connectionId: string): boolean {
    return this.sudoPasswords.has(connectionId);
  }

  private buildDirectoryListingCacheKey(connectionId: string, remotePath: string): string {
    return `${connectionId}:${normalizeRemotePath(remotePath)}`;
  }

  private clearDirectoryListingCache(connectionId: string, remotePath?: string): void {
    if (remotePath) {
      this.directoryListingCache.delete(this.buildDirectoryListingCacheKey(connectionId, remotePath));
      return;
    }

    const prefix = `${connectionId}:`;
    for (const key of Array.from(this.directoryListingCache.keys())) {
      if (key.startsWith(prefix)) {
        this.directoryListingCache.delete(key);
      }
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

  private getClient(connectionId: string): SftpClient {
    const client = this.sessions.get(connectionId);

    if (!client) {
      throw new Error(`Remote Edit connection '${connectionId}' is not connected.`);
    }

    return client;
  }

  private async safeCwd(client: SftpClient): Promise<string> {
    try {
      const cwd = await client.cwd();
      return normalizeRemotePath(cwd || '/');
    } catch {
      return '/';
    }
  }

  private async resolveStartPath(client: SftpClient, requestedStartPath: string, homePath: string): Promise<string> {
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


  private async resolvePathType(client: SftpClient, remotePath: string, stats: unknown): Promise<RemoteEntryType> {
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
        await client.list(normalizeRemotePath(remotePath));
        return 'directory';
      } catch {
        // A symlink that is not listable is treated as file-like so VS Code can try to open it.
        return 'file';
      }
    }

    try {
      await client.list(normalizeRemotePath(remotePath));
      return 'directory';
    } catch {
      // Not a listable directory. If stat() succeeded, treat it as file-like.
    }

    return 'file';
  }

  private async resolveEntryTypeWithoutFollowingLinks(client: SftpClient, remotePath: string): Promise<RemoteEntryType> {
    const dynamicClient = client as any;

    if (typeof dynamicClient.lstat === 'function') {
      try {
        const stats = await dynamicClient.lstat(normalizeRemotePath(remotePath));
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
      const entries = await client.list(parentPath);
      const entry = entries.find(item => item.name === name);
      if (entry) {
        return mapEntryType(entry.type);
      }
    } catch {
      // Fall through to following stat as a last resort.
    }

    try {
      const stats = await client.stat(normalizeRemotePath(remotePath));
      return await this.resolvePathType(client, remotePath, stats);
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

  private async getRemoteFileMode(client: SftpClient, remotePath: string): Promise<number | undefined> {
    const stats = await client.stat(remotePath);
    const mode = normalizeFileMode((stats as any)?.mode);

    if (mode !== undefined) {
      return mode;
    }

    return await this.getRemoteFileModeFromDirectoryListing(client, remotePath);
  }

  private async getRemoteFileModeFromDirectoryListing(client: SftpClient, remotePath: string): Promise<number | undefined> {
    try {
      const parentPath = dirnameRemotePath(remotePath);
      const name = remotePath.split('/').filter(Boolean).pop() || '';
      const entries = await client.list(parentPath);
      const entry = entries.find(item => item.name === name);
      const permissions = buildPermissionString(entry as SftpClient.FileInfo);

      return modeFromPermissionString(permissions);
    } catch {
      return undefined;
    }
  }

  private async restoreOriginalSpecialPermissionBitsIfNeeded(
    client: SftpClient,
    remotePath: string,
    originalMode: number | undefined
  ): Promise<void> {
    if (!shouldRestoreSpecialPermissionBits(originalMode)) {
      return;
    }

    const currentMode = await this.getRemoteFileMode(client, remotePath);

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
      throw new Error('Sudo mode is not enabled for this connection.');
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
        ? new RegExp(`${this.escapeRegExp(remoteProcessPidMarkerPrefix)}(\\d+)__`)
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
            const keepLength = this.getPotentialRemoteProcessPidMarkerSuffixLength(
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
              processStdoutForRemoteProcess(text);
              throttleOutputIfNeeded(Buffer.isBuffer(data) ? data.length : Buffer.byteLength(text, 'utf8'));
            }
          });

          stream.stderr?.on?.('data', (data: Buffer | string) => {
            const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
            if (text) {
              processStderrForWrapperFilter(text);
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
            settle(() => resolve({
              stdout: Buffer.concat(stdoutChunks),
              stderr: Buffer.concat(stderrChunks).toString('utf8'),
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



function shouldRestoreSpecialPermissionBits(originalMode: number | undefined): originalMode is number {
  return Boolean(
    getBooleanSetting('restoreSpecialPermissionBits', true) &&
    originalMode !== undefined &&
    hasSpecialPermissionBits(originalMode)
  );
}

function hasSpecialPermissionBits(mode: number): boolean {
  return (mode & 0o7000) !== 0;
}

function hasSpecialPermissionBitsChanged(originalMode: number, currentMode: number | undefined): boolean {
  return currentMode === undefined || (originalMode & 0o7000) !== (currentMode & 0o7000);
}

function normalizeFileMode(value: unknown): number | undefined {
  const mode = Number(value);

  if (!Number.isFinite(mode) || mode < 0) {
    return undefined;
  }

  return mode & 0o7777;
}

function modeFromPermissionString(permissions: string): number | undefined {
  if (!/^[bcdlps-][rwxStTs-]{9}/.test(permissions)) {
    return undefined;
  }

  let mode = 0;
  const chars = permissions.slice(1, 10);

  if (chars[0] === 'r') { mode |= 0o400; }
  if (chars[1] === 'w') { mode |= 0o200; }
  if (chars[2] === 'x' || chars[2] === 's') { mode |= 0o100; }
  if (chars[2] === 's' || chars[2] === 'S') { mode |= 0o4000; }

  if (chars[3] === 'r') { mode |= 0o040; }
  if (chars[4] === 'w') { mode |= 0o020; }
  if (chars[5] === 'x' || chars[5] === 's') { mode |= 0o010; }
  if (chars[5] === 's' || chars[5] === 'S') { mode |= 0o2000; }

  if (chars[6] === 'r') { mode |= 0o004; }
  if (chars[7] === 'w') { mode |= 0o002; }
  if (chars[8] === 'x' || chars[8] === 't') { mode |= 0o001; }
  if (chars[8] === 't' || chars[8] === 'T') { mode |= 0o1000; }

  return mode;
}

function formatMode(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function getSudoTempDirectory(): string {
  return normalizeRemotePath(getStringSetting('sudoTempDirectory', '/tmp'));
}

interface RemoteSpaceInfo {
  filesystem: string;
  availableBytes: number;
  mountPoint: string;
}

function parseDfSpaceInfo(output: string, remotePath: string): RemoteSpaceInfo {
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error(`Could not parse free space information for ${remotePath}.`);
  }

  const dataLine = lines[lines.length - 1];
  const columns = dataLine.split(/\s+/);
  const percentIndex = columns.findIndex(column => /^\d+%$/.test(column));

  if (percentIndex < 2) {
    throw new Error(`Could not parse available space for ${remotePath}.`);
  }

  const availableKilobytes = Number(columns[percentIndex - 1]);

  if (!Number.isFinite(availableKilobytes) || availableKilobytes < 0) {
    throw new Error(`Could not parse available space for ${remotePath}.`);
  }

  return {
    filesystem: columns[0] || '',
    availableBytes: availableKilobytes * 1024,
    mountPoint: columns.slice(percentIndex + 1).join(' ') || ''
  };
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return 'unknown';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function cloneRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.map(entry => ({ ...entry }));
}

function sortRemoteEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') {
      return -1;
    }
    if (a.type !== 'directory' && b.type === 'directory') {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function parseLongListing(output: string, parentPath: string): RemoteEntry[] {
  return output
    .split(/\r?\n/)
    .map(line => parseLongListingLine(line, parentPath))
    .filter((entry): entry is RemoteEntry => Boolean(entry && entry.name !== '.' && entry.name !== '..'));
}

function parseLongListingLine(line: string, parentPath: string): RemoteEntry | undefined {
  const trimmedLine = line.trim();

  if (!trimmedLine || trimmedLine.startsWith('total ')) {
    return undefined;
  }

  const match = trimmedLine.match(/^([bcdlps-][rwxStTs-]{9}[+.]?)\s+\S+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);

  if (!match) {
    return undefined;
  }

  const permissions = match[1];
  const owner = match[2];
  const group = match[3];
  const size = Number(match[4] || 0);
  const month = match[5];
  const day = match[6];
  const timeOrYear = match[7];
  const rawName = match[8];
  const linkSplitIndex = permissions.startsWith('l') ? rawName.indexOf(' -> ') : -1;
  const name = linkSplitIndex >= 0 ? rawName.slice(0, linkSplitIndex) : rawName;
  const linkTarget = linkSplitIndex >= 0 ? rawName.slice(linkSplitIndex + 4) : undefined;
  const type = mapPermissionTypeToEntryType(permissions.charAt(0));

  return {
    name,
    type,
    effectiveType: undefined,
    linkTarget,
    size,
    modifyTime: parseLongListingTimestamp(month, day, timeOrYear),
    accessTime: 0,
    owner,
    group,
    permissions,
    path: joinRemotePath(parentPath, name)
  };
}

function parseLongListingTimestamp(month: string, day: string, timeOrYear: string): number {
  const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    .findIndex(value => value.toLowerCase() === month.slice(0, 3).toLowerCase());

  if (monthIndex < 0) {
    return 0;
  }

  const now = new Date();
  const parsedDay = Number(day);
  let parsedDate: Date;

  if (/^\d{1,2}:\d{2}$/.test(timeOrYear)) {
    const [hour, minute] = timeOrYear.split(':').map(Number);
    parsedDate = new Date(now.getFullYear(), monthIndex, parsedDay, hour, minute, 0, 0);

    if (parsedDate.getTime() - now.getTime() > 24 * 60 * 60 * 1000) {
      parsedDate.setFullYear(parsedDate.getFullYear() - 1);
    }
  } else {
    parsedDate = new Date(Number(timeOrYear), monthIndex, parsedDay, 0, 0, 0, 0);
  }

  const timestamp = parsedDate.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mapPermissionTypeToEntryType(typeChar: string): RemoteEntryType {
  switch (typeChar) {
    case 'd':
      return 'directory';
    case 'l':
      return 'link';
    case '-':
      return 'file';
    default:
      return 'unknown';
  }
}

export function normalizeRemotePath(remotePath: string): string {
  const trimmed = (remotePath || '/').trim();

  if (!trimmed || trimmed === '.') {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+/g, '/').replace(/\/\/$/, '') || '/';
}

export function joinRemotePath(parent: string, child: string): string {
  const normalizedParent = normalizeRemotePath(parent);

  if (normalizedParent === '/') {
    return `/${child}`;
  }

  return `${normalizedParent}/${child}`.replace(/\/+/g, '/');
}

export function dirnameRemotePath(remotePath: string): string {
  const normalizedPath = normalizeRemotePath(remotePath);

  if (normalizedPath === '/') {
    return '/';
  }

  const index = normalizedPath.lastIndexOf('/');
  return index <= 0 ? '/' : normalizedPath.slice(0, index);
}



async function toBuffer(data: unknown, remotePath: string): Promise<Buffer> {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  if (typeof data === 'string') {
    return Buffer.from(data);
  }

  if (data instanceof Readable || isReadableStream(data)) {
    return await readableToBuffer(data as Readable);
  }

  if (data === undefined || data === null) {
    return Buffer.alloc(0);
  }

  throw new Error(`Unsupported data returned while reading ${remotePath}.`);
}

function isReadableStream(value: unknown): value is Readable {
  return Boolean(value && typeof (value as any).pipe === 'function' && typeof (value as any).on === 'function');
}

async function readableToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(String(chunk)));
    }
  }

  return Buffer.concat(chunks);
}

async function readRemoteFileToBuffer(
  client: SftpClient,
  remotePath: string,
  cancellationToken?: ConnectionCancellationToken,
  progress?: RemoteEditProgressReporter,
  totalBytes?: number
): Promise<Buffer> {
  throwIfOperationCancelled(cancellationToken);

  const sftp = (client as any).sftp;

  if (sftp && typeof sftp.createReadStream === 'function') {
    return await readRemoteFileStreamToBuffer(sftp.createReadStream(remotePath), cancellationToken, progress, totalBytes);
  }

  const chunks: Buffer[] = [];
  let transferredBytes = 0;
  let sink: Writable | undefined;

  const operation = new Promise<Buffer>((resolve, reject) => {
    sink = new Writable({
      write(chunk, _encoding, callback) {
        if (cancellationToken?.isCancellationRequested) {
          callback(new Error('Operation cancelled.'));
          return;
        }

        const bufferChunk = Buffer.isBuffer(chunk)
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk)
            : Buffer.from(String(chunk));

        chunks.push(bufferChunk);

        if (progress && Number(totalBytes || 0) > 0) {
          transferredBytes += bufferChunk.length;
          progress.reportBytes('Opening remote file...', transferredBytes, Number(totalBytes || 0));
        }

        callback();
      }
    });

    client.get(remotePath, sink as any)
      .then(() => {
        throwIfOperationCancelled(cancellationToken);
        resolve(Buffer.concat(chunks));
      })
      .catch(reject);
  });

  const cancellationDisposable = cancellationToken?.onCancellationRequested(() => {
    try {
      sink?.destroy(new Error('Operation cancelled.'));
    } catch {
      // Ignore sink destroy errors while cancelling read.
    }
  });

  try {
    return await operation;
  } finally {
    cancellationDisposable?.dispose();
  }
}

async function readRemoteFileStreamToBuffer(
  stream: Readable,
  cancellationToken?: ConnectionCancellationToken,
  progress?: RemoteEditProgressReporter,
  totalBytes?: number
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let transferredBytes = 0;

  const cancellationDisposable = cancellationToken?.onCancellationRequested(() => {
    try {
      stream.destroy(new Error('Operation cancelled.'));
    } catch {
      // Ignore stream destroy errors while cancelling read.
    }
  });

  try {
    for await (const chunk of stream) {
      throwIfOperationCancelled(cancellationToken);

      const bufferChunk = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : Buffer.from(String(chunk));

      chunks.push(bufferChunk);

      if (progress && Number(totalBytes || 0) > 0) {
        transferredBytes += bufferChunk.length;
        progress.reportBytes('Opening remote file...', transferredBytes, Number(totalBytes || 0));
      }
    }

    throwIfOperationCancelled(cancellationToken);
    return Buffer.concat(chunks);
  } finally {
    cancellationDisposable?.dispose();
  }
}

function throwIfOperationCancelled(cancellationToken?: ConnectionCancellationToken): void {
  if (cancellationToken?.isCancellationRequested) {
    throw new RemoteEditOperationCancelledError('Operation cancelled.');
  }
}

function getOwnerFromFileInfo(item: SftpClient.FileInfo): number | string {
  return parseLongnameOwnerGroup(item).owner || (item as any).owner || '';
}

function getGroupFromFileInfo(item: SftpClient.FileInfo): number | string {
  return parseLongnameOwnerGroup(item).group || (item as any).group || '';
}

function parseLongnameOwnerGroup(item: SftpClient.FileInfo): { owner: string; group: string } {
  const longname = String((item as any).longname || '').trim();

  if (!longname) {
    return { owner: '', group: '' };
  }

  const parts = longname.split(/\s+/);

  if (parts.length >= 4 && /^[dlpscb-]/.test(parts[0])) {
    return { owner: parts[2] || '', group: parts[3] || '' };
  }

  return { owner: '', group: '' };
}

function collectNumericIds(values: Array<number | string>): string[] {
  const ids = new Set<string>();

  for (const value of values) {
    const id = normalizeNumericId(value);
    if (id) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

function normalizeNumericId(value: number | string): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return String(value);
  }

  const trimmed = String(value || '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : undefined;
}

function buildPrincipalLookupCommand(kind: 'user' | 'group', ids: string[]): string {
  const database = kind === 'user' ? 'passwd' : 'group';
  const filePath = kind === 'user' ? '/etc/passwd' : '/etc/group';
  const idList = ids.filter(id => /^\d+$/.test(id)).join(' ');

  return [
    `for remoteedit_id in ${idList}; do`,
    '  remoteedit_name=""',
    '  if command -v getent >/dev/null 2>&1; then',
    `    remoteedit_name="$(getent ${database} "$remoteedit_id" 2>/dev/null | awk -F: 'NR == 1 { print $1 }')"`,
    '  fi',
    '  if [ -z "$remoteedit_name" ]; then',
    `    remoteedit_name="$(awk -F: -v id="$remoteedit_id" '$3 == id { print $1; exit }' ${filePath} 2>/dev/null)"`,
    '  fi',
    '  if [ -n "$remoteedit_name" ]; then',
    `    printf '%s:%s\\n' "$remoteedit_id" "$remoteedit_name"`,
    '  fi',
    'done'
  ].join('\n');
}

function parsePrincipalLookupOutput(output: string): Map<string, string> {
  const names = new Map<string, string>();

  for (const line of output.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');

    if (separatorIndex <= 0) {
      continue;
    }

    const id = line.slice(0, separatorIndex).trim();
    const name = line.slice(separatorIndex + 1).trim();

    if (/^\d+$/.test(id) && name) {
      names.set(id, name);
    }
  }

  return names;
}

function buildPermissionString(item: SftpClient.FileInfo): string {
  const longname = String((item as any).longname || '');

  if (longname.length >= 10) {
    return longname.slice(0, 10);
  }

  const typePrefix = item.type === 'd' ? 'd' : item.type === 'l' ? 'l' : item.type === '-' ? '-' : '?';
  const rights = (item as any).rights || {};

  return typePrefix +
    formatRights(String(rights.user || '')) +
    formatRights(String(rights.group || '')) +
    formatRights(String(rights.other || ''));
}

function formatRights(value: string): string {
  return `${value.includes('r') ? 'r' : '-'}${value.includes('w') ? 'w' : '-'}${value.includes('x') ? 'x' : '-'}`;
}

function inferLinkTargetType(target: string | undefined): RemoteEntryType | undefined {
  const targetText = String(target || '').trim();

  if (!targetText) {
    return undefined;
  }

  if (targetText.endsWith('/')) {
    return 'directory';
  }

  return undefined;
}

function extractLinkTargetFromLongname(longname: string): string | undefined {
  const marker = ' -> ';
  const markerIndex = longname.indexOf(marker);

  if (markerIndex === -1) {
    return undefined;
  }

  const target = longname.slice(markerIndex + marker.length).trim();
  return target || undefined;
}

function mapModeToEntryType(mode: number): RemoteEntryType {
  const typeBits = mode & 0o170000;

  switch (typeBits) {
    case 0o040000:
      return 'directory';
    case 0o100000:
      return 'file';
    case 0o120000:
      return 'link';
    default:
      return 'unknown';
  }
}

function statFlag(stats: unknown, propertyName: string): boolean {
  const value = (stats as any)?.[propertyName];

  if (typeof value === 'function') {
    return Boolean(value.call(stats));
  }

  return Boolean(value);
}

function mapEntryType(type: string): RemoteEntryType {
  switch (type) {
    case 'd':
      return 'directory';
    case '-':
      return 'file';
    case 'l':
      return 'link';
    default:
      return 'unknown';
  }
}
