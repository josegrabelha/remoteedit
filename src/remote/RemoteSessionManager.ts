import type { RemoteEditProgressReporter } from '../utils/progressUtils';
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
} from './RemoteSessionTypes';

export interface RemoteListDirectoryOptions {
  forceRefresh?: boolean;
}

export interface RemoteStat {
  type: 'file' | 'directory' | 'unknown';
  size: number;
  modifyTime: number;
  accessTime: number;
}

export interface RemoteChangeOwnerGroupOptions {
  owner?: string;
  group?: string;
  recursive?: boolean;
}

export interface RemoteChmodOptions {
  recursive?: boolean;
}

export interface RemotePrincipalSuggestion {
  name: string;
  id?: string;
  detail?: string;
}

export interface RemoteOwnerGroupSuggestions {
  owners: RemotePrincipalSuggestion[];
  groups: RemotePrincipalSuggestion[];
}

export interface RemoteSessionManager {
  connect(options: ConnectOptions, cancellationToken?: ConnectionCancellationToken): Promise<ActiveConnection>;
  disconnect(connectionId: string): Promise<void>;
  disconnectAll(): Promise<void>;
  getConnection(connectionId: string): ActiveConnection | undefined;
  listConnections(): ActiveConnection[];
  hasConnection(connectionId: string): boolean;

  listDirectory(connectionId: string, remotePath: string, options?: RemoteListDirectoryOptions): Promise<RemoteEntry[]>;
  prepareFileForOpen(
    connectionId: string,
    remotePath: string,
    cancellationToken?: ConnectionCancellationToken,
    progress?: RemoteEditProgressReporter
  ): Promise<void>;
  readFile(
    connectionId: string,
    remotePath: string,
    cancellationToken?: ConnectionCancellationToken,
    progress?: RemoteEditProgressReporter
  ): Promise<Buffer>;
  writeFile(
    connectionId: string,
    remotePath: string,
    content: Uint8Array,
    progress?: RemoteEditProgressReporter,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<void>;
  stat(connectionId: string, remotePath: string): Promise<RemoteStat>;
  createFile(connectionId: string, remotePath: string): Promise<void>;
  createDirectory(connectionId: string, remotePath: string): Promise<void>;
  delete(connectionId: string, remotePath: string): Promise<void>;
  rename(connectionId: string, oldPath: string, newPath: string): Promise<void>;
  copyFile(
    connectionId: string,
    sourcePath: string,
    targetPath: string,
    overwrite?: boolean,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<void>;
  createArchive(
    connectionId: string,
    baseDirectory: string,
    entryNames: string[],
    archiveName: string,
    format: RemoteArchiveFormat,
    overwrite?: boolean,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<void>;

  calculateChecksums(
    connectionId: string,
    remotePath: string,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<RemoteChecksumSummary>;
  changeOwnerGroup(connectionId: string, remotePath: string, options: RemoteChangeOwnerGroupOptions): Promise<void>;
  listOwnerGroupSuggestions(connectionId: string): Promise<RemoteOwnerGroupSuggestions>;
  chmod(connectionId: string, remotePath: string, mode: string | number, options?: RemoteChmodOptions): Promise<void>;

  enableSudoMode(connectionId: string, password: string): Promise<void>;
  disableSudoMode(connectionId: string): void;
  isSudoModeEnabled(connectionId: string): boolean;

  runRemoteCommandStreaming(
    connectionId: string,
    workingDirectory: string,
    command: string,
    callbacks?: RemoteCommandStreamingCallbacks,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<RemoteCommandStreamingResult>;
}
