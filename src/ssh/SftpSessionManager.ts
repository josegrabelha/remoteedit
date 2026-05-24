import * as fs from 'fs/promises';
import { Readable, Writable } from 'stream';
import SftpClient from 'ssh2-sftp-client';
import { expandHomePath } from '../utils/localPathUtils';
import { getBooleanSetting, getNumberSetting, getStringSetting } from '../utils/settingsUtils';
import { buildRemoteTempPath, buildSudoErrorMessage, shellQuote } from '../utils/shellUtils';
import type { RemoteEditProgressReporter } from '../utils/progressUtils';

const SUDO_READ_IDLE_TIMEOUT_MS = 60000;
const SUDO_SAVE_APPLY_TIMEOUT_MS = 300000;

export type AuthType = 'password' | 'privateKey';

export interface ConnectOptions {
  connectionId: string;
  name?: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  startPath?: string;
  keepAlive?: boolean;
}

export interface ConnectionCancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(callback: () => void): { dispose(): void };
}

export type RemoteEntryType = 'file' | 'directory' | 'link' | 'unknown';

export interface RemoteEntry {
  name: string;
  type: RemoteEntryType;
  effectiveType?: RemoteEntryType;
  linkTarget?: string;
  size: number;
  modifyTime: number;
  accessTime: number;
  owner: number | string;
  group: number | string;
  permissions: string;
  path: string;
}

export interface ActiveConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  startPath: string;
  keepAlive: boolean;
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

interface CachedReadFile {
  content: Buffer;
  expiresAt: number;
}

interface SudoTargetMetadata {
  size: number;
  mode?: number;
}

export class SftpSessionManager {
  private readonly sessions = new Map<string, SftpClient>();
  private readonly connections = new Map<string, ActiveConnection>();
  private readonly ownerNameCaches = new Map<string, Map<string, string>>();
  private readonly groupNameCaches = new Map<string, Map<string, string>>();
  private readonly sudoPasswords = new Map<string, string>();
  private readonly readFileCache = new Map<string, CachedReadFile>();

  async connect(options: ConnectOptions, cancellationToken?: ConnectionCancellationToken): Promise<ActiveConnection> {
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
      name: options.name || `${options.username}@${options.host}`,
      host: options.host,
      port: options.port,
      username: options.username,
      authType: options.authType,
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
  }

  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map(id => this.disconnect(id)));
  }

  getConnection(connectionId: string): ActiveConnection | undefined {
    return this.connections.get(connectionId);
  }

  listConnections(): ActiveConnection[] {
    return Array.from(this.connections.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  hasConnection(connectionId: string): boolean {
    return this.sessions.has(connectionId);
  }

  async listDirectory(connectionId: string, remotePath: string): Promise<RemoteEntry[]> {
    const client = this.getClient(connectionId);
    const normalizedPath = normalizeRemotePath(remotePath);

    try {
      const items = await client.list(normalizedPath);

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

      await this.resolveEntryOwnerGroups(client, connectionId, entries);
      return sortRemoteEntries(entries);
    } catch (error) {
      if (!this.isSudoModeEnabled(connectionId)) {
        throw error;
      }
    }

    const listing = await this.runSudoCommandText(
      connectionId,
      `LC_ALL=C ls -la ${shellQuote(normalizedPath)}`,
      30000
    );

    return sortRemoteEntries(parseLongListing(listing, normalizedPath));
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

  async writeFile(connectionId: string, remotePath: string, content: Uint8Array, progress?: RemoteEditProgressReporter): Promise<void> {
    const client = this.getClient(connectionId);
    const normalizedPath = normalizeRemotePath(remotePath);
    const buffer = Buffer.from(content);

    if (!this.isSudoModeEnabled(connectionId)) {
      try {
        const originalMode = await this.getRemoteFileMode(client, normalizedPath);

        // Existing files must be updated in-place so owner, group,
        // permissions, ACLs, and inode are not replaced during save.
        await this.writeExistingRemoteFileInPlace(client, normalizedPath, buffer, progress);
        await this.restoreOriginalSpecialPermissionBitsIfNeeded(client, normalizedPath, originalMode);
      } catch (error) {
        if (!this.isMissingFileError(error)) {
          throw error;
        }

        // New files must be created by the remote server without an explicit mode
        // so the connected user's default permissions and umask are respected.
        await this.createRemoteFileWithServerDefaults(client, normalizedPath);

        if (buffer.length > 0) {
          await this.writeExistingRemoteFileInPlace(client, normalizedPath, buffer, progress);
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
      await this.uploadBufferToNewRemoteFileInChunks(client, tempPath, buffer, progress);

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
      return;
    }

    await client.mkdir(normalizedPath, true);
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

  async chmod(connectionId: string, remotePath: string, mode: string | number): Promise<void> {
    const client = this.getClient(connectionId);
    const modeText = typeof mode === 'number' ? mode.toString(8) : String(mode).trim();

    if (!/^[0-7]{3,4}$/.test(modeText)) {
      throw new Error(`Invalid permission mode '${modeText}'.`);
    }

    const normalizedPath = normalizeRemotePath(remotePath);

    if (this.isSudoModeEnabled(connectionId)) {
      await this.runSudoCommandText(connectionId, `chmod ${shellQuote(modeText)} ${shellQuote(normalizedPath)}`, 30000);
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

  private buildReadFileCacheKey(connectionId: string, remotePath: string): string {
    return `${connectionId}:${normalizeRemotePath(remotePath)}`;
  }

  private clearReadFileCache(connectionId: string, remotePath?: string): void {
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

  private getClient(connectionId: string): SftpClient {
    const client = this.sessions.get(connectionId);

    if (!client) {
      throw new Error(`RemoteEdit connection '${connectionId}' is not connected.`);
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
      throw new Error('File content was saved, but RemoteEdit could not restore the original special permission bits because the active SFTP client does not support chmod.');
    }

    try {
      await chmod.call(client, remotePath, originalMode);
    } catch (error) {
      throw new Error(`File content was saved, but RemoteEdit could not restore the original special permission bits (${formatMode(originalMode)}): ${formatErrorMessage(error)}`);
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
      throw new Error(`File content was saved, but RemoteEdit could not restore the original special permission bits (${modeText}) with sudo: ${formatErrorMessage(error)}`);
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


  private async uploadBufferToNewRemoteFileInChunks(client: SftpClient, remotePath: string, content: Buffer, progress?: RemoteEditProgressReporter): Promise<void> {
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
      await this.writeBufferToOpenRemoteFile(sftp, handle, content, progress);
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

  private async writeBufferToOpenRemoteFile(sftp: any, handle: Buffer, content: Buffer, progress?: RemoteEditProgressReporter): Promise<void> {
    const chunkSize = 64 * 1024;
    let offset = 0;

    while (offset < content.length) {
      const length = Math.min(chunkSize, content.length - offset);
      await this.rawSftpWrite(sftp, handle, content, offset, length, offset);
      offset += length;
      progress?.reportBytes('Saving remote file...', offset, content.length);
    }
  }

  private async writeExistingRemoteFileInPlace(client: SftpClient, remotePath: string, content: Buffer, progress?: RemoteEditProgressReporter): Promise<void> {
    const sftp = (client as any).sftp;

    if (!sftp || typeof sftp.open !== 'function') {
      throw new Error('The active SFTP client does not support safe in-place writes. Save aborted to avoid changing file metadata.');
    }

    const handle = await this.rawSftpOpen(sftp, remotePath, 'r+');
    let operationError: unknown;

    try {
      await this.writeBufferToOpenRemoteFile(sftp, handle, content, progress);
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
    throw new Error('Operation cancelled.');
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
