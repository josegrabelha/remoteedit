export type WorkspaceSyncDirection = 'localToRemote' | 'remoteToLocal' | 'bidirectional';

export type WorkspaceSyncEntryKind = 'file' | 'directory' | 'link' | 'unknown';

export interface WorkspaceSyncOptions {
  direction: WorkspaceSyncDirection;
  uploadOnSave: boolean;
  watchLocalChanges: boolean;
  watchRemoteChanges: boolean;
  conflictProtection: boolean;
  atomicTransfer: boolean;
  propagateDeletes: boolean;
  ignorePatterns: string[];
}

export interface WorkspaceSyncTarget {
  id: string;
  name: string;
  connectionId: string;
  remoteRoot: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceSyncMapping {
  id: string;
  name: string;
  localRoot: string;
  targets: WorkspaceSyncTarget[];
  options: WorkspaceSyncOptions;
  createdAt: number;
  updatedAt: number;
}

export interface FileFingerprint {
  kind: WorkspaceSyncEntryKind;
  size: number;
  mtimeMs: number;
  hash?: string;
}

export interface SnapshotEntry {
  /** Canonical NFC path used as the logical identity inside Workspace Sync. */
  relativePath: string;
  /** Exact path spelling returned by the filesystem/protocol, used for I/O. */
  physicalRelativePath?: string;
  fingerprint: FileFingerprint;
}

export interface SyncSnapshot {
  capturedAt: number;
  entries: Record<string, SnapshotEntry>;
  incompletePaths: string[];
}

export interface BaselineEntry {
  local?: FileFingerprint;
  remote?: FileFingerprint;
  localRelativePath?: string;
  remoteRelativePath?: string;
}

export interface SyncBaseline {
  mappingId: string;
  targetId: string;
  capturedAt: number;
  entries: Record<string, BaselineEntry>;
}

export type DiffStatus =
  | 'same'
  | 'localOnly'
  | 'remoteOnly'
  | 'localChanged'
  | 'remoteChanged'
  | 'different'
  | 'conflict'
  | 'localDeleted'
  | 'remoteDeleted'
  | 'unknown';

export type WorkspaceSyncConflictResolution = 'useLocal' | 'useRemote' | 'skip';

export interface DiffEntry {
  /** Canonical NFC path displayed to the user and used as the logical key. */
  relativePath: string;
  /** Exact side-specific spelling used for filesystem/protocol operations. */
  localRelativePath?: string;
  remoteRelativePath?: string;
  status: DiffStatus;
  local?: FileFingerprint;
  remote?: FileFingerprint;
  baseline?: BaselineEntry;
  reason?: string;
  resolution?: WorkspaceSyncConflictResolution;
}

export type SyncOperationType =
  | 'createLocalDirectory'
  | 'createRemoteDirectory'
  | 'upload'
  | 'download'
  | 'deleteLocal'
  | 'deleteRemote'
  | 'skip';

export interface SyncOperation {
  id: string;
  type: SyncOperationType;
  /** Canonical NFC path used as the logical operation identity. */
  relativePath: string;
  /** Exact side-specific spelling captured during Preview/Watch. */
  localRelativePath?: string;
  remoteRelativePath?: string;
  reason: string;
  expectedLocal?: FileFingerprint;
  expectedRemote?: FileFingerprint;
}

export interface SyncPlan {
  mappingId: string;
  targetId: string;
  createdAt: number;
  direction: WorkspaceSyncDirection;
  operations: SyncOperation[];
  conflicts: DiffEntry[];
  errors: DiffEntry[];
}

export interface WorkspaceSyncConnectionSummary {
  id: string;
  name: string;
  connectionType: 'sftp' | 'ftp' | 'ftps';
  host: string;
  port: number;
  username: string;
}

export interface WorkspaceSyncProgress {
  completed: number;
  total: number;
  currentPath?: string;
  phase?: string;
}

export interface WorkspaceSyncTargetSummary {
  targetId: string;
  targetName: string;
  connectionName: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  message?: string;
  connectionConfigChanged?: boolean;
}
