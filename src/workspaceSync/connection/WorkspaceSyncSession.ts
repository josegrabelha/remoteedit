import type { WorkspaceSyncEntryKind } from '../types';
import type { WorkspaceSyncFilenameStyle } from '../planning/PathCompatibility';

export interface WorkspaceSyncRemoteEntry {
  name: string;
  kind: WorkspaceSyncEntryKind;
  size: number;
  mtimeMs: number;
}

export interface WorkspaceSyncRemoteCapabilities {
  reliableMtime: boolean;
  caseSensitive?: boolean;
  filenameStyle: WorkspaceSyncFilenameStyle;
  maxConcurrentMetadata: number;
  maxConcurrentTransfers: number;
}

export interface WorkspaceSyncRemoteSession {
  readonly profileId: string;
  readonly connectionIdentity: string;
  readonly connectionType: 'sftp' | 'ftp' | 'ftps';
  readonly capabilities: WorkspaceSyncRemoteCapabilities;
  /** Terminal close: old operations must not retry or mutate Local after Disconnect. */
  readonly isDisconnected?: boolean;
  list(remotePath: string): Promise<WorkspaceSyncRemoteEntry[]>;
  stat(remotePath: string): Promise<WorkspaceSyncRemoteEntry | undefined>;
  ensureDirectory(remotePath: string): Promise<void>;
  upload(localPath: string, remotePath: string): Promise<void>;
  download(remotePath: string, localPath: string): Promise<void>;
  hashFile(remotePath: string): Promise<string>;
  deleteFile(remotePath: string): Promise<void>;
  deleteDirectory(remotePath: string): Promise<void>;
  /** Replace target with an already-uploaded sibling temp file using the safest protocol-specific strategy. */
  replaceFile(tempPath: string, targetPath: string): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Interrupt read-only network commands to unblock Disconnect. Never interrupts active writes. */
  /** True when closing a blocked read invalidated this private connection. */
  interruptPendingReads?(): boolean;
}
