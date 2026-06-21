import * as vscode from 'vscode';
import { FtpSessionManager } from '../ftp/FtpSessionManager';
import { SftpSessionManager } from '../ssh/SftpSessionManager';
import { normalizeConnectionType, SFTP_CONNECTION_TYPE } from './RemoteConnectionTypes';
import type { RemoteSessionManager, RemoteStat, RemoteListDirectoryOptions, RemoteChangeOwnerGroupOptions, RemoteChmodOptions, RemoteOwnerGroupSuggestions } from './RemoteSessionManager';
import type { Client } from 'ssh2';
import type {
  ActiveConnection,
  ConnectOptions,
  ConnectionCancellationToken,
  RemoteArchiveFormat,
  RemoteChecksumSummary,
  RemoteCommandStreamingCallbacks,
  RemoteCommandStreamingResult,
  RemoteEntry
} from './RemoteSessionTypes';
import type { RemoteEditProgressReporter } from '../utils/progressUtils';

export class RemoteSessionRouter implements RemoteSessionManager {
  private readonly onDidChangeConnectionsEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeConnections = this.onDidChangeConnectionsEmitter.event;

  private readonly sftpSessions: RemoteSessionManager;
  private readonly ftpSessions: RemoteSessionManager;
  private readonly sessionRoutes = new Map<string, RemoteSessionManager>();

  constructor(
    output?: vscode.OutputChannel,
    sftpSessions?: RemoteSessionManager,
    ftpSessions?: RemoteSessionManager
  ) {
    sftpSessions = sftpSessions || new SftpSessionManager(output);
    ftpSessions = ftpSessions || new FtpSessionManager(output);
    this.sftpSessions = sftpSessions;
    this.ftpSessions = ftpSessions;
  }

  async connect(options: ConnectOptions, cancellationToken?: ConnectionCancellationToken): Promise<ActiveConnection> {
    await this.disconnect(options.connectionId);

    const manager = this.getManagerForConnectionType(options.connectionType);
    const connection = await manager.connect(options, cancellationToken);

    this.sessionRoutes.set(connection.id, manager);
    this.onDidChangeConnectionsEmitter.fire();
    return connection;
  }

  async disconnect(connectionId: string): Promise<void> {
    if (!connectionId || !this.hasConnection(connectionId)) {
      this.sessionRoutes.delete(connectionId);
      return;
    }

    const manager = this.sessionRoutes.get(connectionId);

    if (manager) {
      await manager.disconnect(connectionId);
      this.sessionRoutes.delete(connectionId);
      this.onDidChangeConnectionsEmitter.fire();
      return;
    }

    await Promise.all([
      this.sftpSessions.disconnect(connectionId),
      this.ftpSessions.disconnect(connectionId)
    ]);
    this.sessionRoutes.delete(connectionId);
    this.onDidChangeConnectionsEmitter.fire();
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([
      this.sftpSessions.disconnectAll(),
      this.ftpSessions.disconnectAll()
    ]);
    this.sessionRoutes.clear();
    this.onDidChangeConnectionsEmitter.fire();
  }

  getConnection(connectionId: string): ActiveConnection | undefined {
    const manager = this.sessionRoutes.get(connectionId);
    return manager?.getConnection(connectionId)
      || this.sftpSessions.getConnection(connectionId)
      || this.ftpSessions.getConnection(connectionId);
  }

  listConnections(): ActiveConnection[] {
    const orderedConnections = Array.from(this.sessionRoutes.keys())
      .map(connectionId => this.getConnection(connectionId))
      .filter((connection): connection is ActiveConnection => Boolean(connection));
    const orderedIds = new Set(orderedConnections.map(connection => connection.id));
    const remainingConnections = [
      ...this.sftpSessions.listConnections(),
      ...this.ftpSessions.listConnections()
    ].filter(connection => !orderedIds.has(connection.id));

    return [...orderedConnections, ...remainingConnections];
  }

  hasConnection(connectionId: string): boolean {
    const manager = this.sessionRoutes.get(connectionId);
    return manager?.hasConnection(connectionId)
      || this.sftpSessions.hasConnection(connectionId)
      || this.ftpSessions.hasConnection(connectionId);
  }

  getSshClientForTerminal(connectionId: string): Client {
    const manager = this.getManagerForActiveConnection(connectionId) as RemoteSessionManager & { getSshClientForTerminal?: (connectionId: string) => Client };

    if (typeof manager.getSshClientForTerminal !== 'function') {
      throw new Error('Open SSH Terminal is only available for SFTP/SSH connections.');
    }

    return manager.getSshClientForTerminal(connectionId);
  }

  listDirectory(connectionId: string, remotePath: string, options?: RemoteListDirectoryOptions): Promise<RemoteEntry[]> {
    return this.getManagerForActiveConnection(connectionId).listDirectory(connectionId, remotePath, options);
  }

  prepareFileForOpen(
    connectionId: string,
    remotePath: string,
    cancellationToken?: ConnectionCancellationToken,
    progress?: RemoteEditProgressReporter
  ): Promise<void> {
    return this.getManagerForActiveConnection(connectionId).prepareFileForOpen(connectionId, remotePath, cancellationToken, progress);
  }

  readFile(
    connectionId: string,
    remotePath: string,
    cancellationToken?: ConnectionCancellationToken,
    progress?: RemoteEditProgressReporter
  ): Promise<Buffer> {
    return this.getManagerForActiveConnection(connectionId).readFile(connectionId, remotePath, cancellationToken, progress);
  }

  writeFile(
    connectionId: string,
    remotePath: string,
    content: Uint8Array,
    progress?: RemoteEditProgressReporter,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<void> {
    return this.getManagerForActiveConnection(connectionId).writeFile(connectionId, remotePath, content, progress, cancellationToken);
  }

  stat(connectionId: string, remotePath: string): Promise<RemoteStat> {
    return this.getManagerForActiveConnection(connectionId).stat(connectionId, remotePath);
  }

  createFile(connectionId: string, remotePath: string): Promise<void> {
    return this.getManagerForActiveConnection(connectionId).createFile(connectionId, remotePath);
  }

  createDirectory(connectionId: string, remotePath: string): Promise<void> {
    return this.getManagerForActiveConnection(connectionId).createDirectory(connectionId, remotePath);
  }

  delete(connectionId: string, remotePath: string): Promise<void> {
    return this.getManagerForActiveConnection(connectionId).delete(connectionId, remotePath);
  }

  rename(connectionId: string, oldPath: string, newPath: string): Promise<void> {
    return this.getManagerForActiveConnection(connectionId).rename(connectionId, oldPath, newPath);
  }

  copyFile(
    connectionId: string,
    sourcePath: string,
    targetPath: string,
    overwrite?: boolean,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<void> {
    return this.getManagerForActiveConnection(connectionId).copyFile(connectionId, sourcePath, targetPath, overwrite, cancellationToken);
  }

  createArchive(
    connectionId: string,
    baseDirectory: string,
    entryNames: string[],
    archiveName: string,
    format: RemoteArchiveFormat,
    overwrite?: boolean,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<void> {
    return this.getManagerForActiveConnection(connectionId).createArchive(connectionId, baseDirectory, entryNames, archiveName, format, overwrite, cancellationToken);
  }

  calculateChecksums(connectionId: string, remotePath: string, cancellationToken?: ConnectionCancellationToken): Promise<RemoteChecksumSummary> {
    return this.getManagerForActiveConnection(connectionId).calculateChecksums(connectionId, remotePath, cancellationToken);
  }

  changeOwnerGroup(connectionId: string, remotePath: string, options: RemoteChangeOwnerGroupOptions): Promise<void> {
    return this.getManagerForActiveConnection(connectionId).changeOwnerGroup(connectionId, remotePath, options);
  }

  listOwnerGroupSuggestions(connectionId: string): Promise<RemoteOwnerGroupSuggestions> {
    return this.getManagerForActiveConnection(connectionId).listOwnerGroupSuggestions(connectionId);
  }

  chmod(connectionId: string, remotePath: string, mode: string | number, options?: RemoteChmodOptions): Promise<void> {
    return this.getManagerForActiveConnection(connectionId).chmod(connectionId, remotePath, mode, options);
  }

  async enableSudoMode(connectionId: string, password: string): Promise<void> {
    const manager = this.getManagerForActiveConnection(connectionId);
    const wasEnabled = manager.isSudoModeEnabled(connectionId);

    await manager.enableSudoMode(connectionId, password);

    if (wasEnabled !== manager.isSudoModeEnabled(connectionId)) {
      this.onDidChangeConnectionsEmitter.fire();
    }
  }

  disableSudoMode(connectionId: string): void {
    const manager = this.getOptionalManagerForActiveConnection(connectionId);

    if (!manager) {
      return;
    }

    const wasEnabled = manager.isSudoModeEnabled(connectionId);
    manager.disableSudoMode(connectionId);

    if (wasEnabled !== manager.isSudoModeEnabled(connectionId)) {
      this.onDidChangeConnectionsEmitter.fire();
    }
  }

  isSudoModeEnabled(connectionId: string): boolean {
    return this.getOptionalManagerForActiveConnection(connectionId)?.isSudoModeEnabled(connectionId) ?? false;
  }

  runRemoteCommandStreaming(
    connectionId: string,
    workingDirectory: string,
    command: string,
    callbacks?: RemoteCommandStreamingCallbacks,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<RemoteCommandStreamingResult> {
    return this.getManagerForActiveConnection(connectionId).runRemoteCommandStreaming(connectionId, workingDirectory, command, callbacks, cancellationToken);
  }

  private getManagerForConnectionType(connectionType: unknown): RemoteSessionManager {
    return normalizeConnectionType(connectionType) === SFTP_CONNECTION_TYPE
      ? this.sftpSessions
      : this.ftpSessions;
  }

  private getManagerForActiveConnection(connectionId: string): RemoteSessionManager {
    const manager = this.getOptionalManagerForActiveConnection(connectionId);

    if (manager) {
      return manager;
    }

    throw new Error(`Remote Edit connection '${connectionId}' is not connected.`);
  }

  private getOptionalManagerForActiveConnection(connectionId: string): RemoteSessionManager | undefined {
    const manager = this.sessionRoutes.get(connectionId);

    if (manager) {
      return manager;
    }

    if (this.sftpSessions.hasConnection(connectionId)) {
      this.sessionRoutes.set(connectionId, this.sftpSessions);
      return this.sftpSessions;
    }

    if (this.ftpSessions.hasConnection(connectionId)) {
      this.sessionRoutes.set(connectionId, this.ftpSessions);
      return this.ftpSessions;
    }

    return undefined;
  }
}
