import * as vscode from 'vscode';
import type { RemoteCommandStreamingControl } from '../ssh/SftpSessionManager';
import type { ActiveConnection } from '../remote/RemoteSessionManager';
import type { RemoteSearchResult, RemoteSearchResultMeta } from '../search/RemoteSearchService';

export type TransferConflictDecision = 'overwrite' | 'skip' | 'cancel' | 'merge';
export type TransferConflictChoice = TransferConflictDecision | 'overwriteAll' | 'skipAll' | 'mergeAll';
export type TransferConflictKind = 'file' | 'directory' | 'typeMismatch';
export type TransferCompletionStatus = 'Completed' | 'Completed with errors' | 'Completed with skipped items' | 'Canceled' | 'Failed';
export type ArchiveFormat = 'tar.gz' | 'tar.bz2' | 'tar.xz' | 'tar.Z';

export interface TransferConflictState {
  overwriteAllFiles: boolean;
  skipAllFiles: boolean;
  mergeAllFolders: boolean;
  skipAllFolders: boolean;
}

export interface TransferSkipState {
  paths: Set<string>;
  prefixes: Set<string>;
}

export interface PendingTransferConflict {
  requestId: string;
  transferId: string;
  operation: 'Upload' | 'Download';
  kind: TransferConflictKind;
  relativePath: string;
  sourcePath: string;
  destinationPath: string;
  sourceType: string;
  destinationType: string;
  sourceSize?: number;
  destinationSize?: number;
  sourceModified?: number;
  destinationModified?: number;
  hasMultipleItems: boolean;
  resolve: (decision: TransferConflictChoice) => void;
}

export interface UploadTransferItem {
  kind: 'file' | 'directory';
  localPath: string;
  remotePath: string;
  relativePath: string;
  size: number;
}

export interface LocalUploadEntry {
  kind: 'file' | 'directory';
  localPath?: string;
  relativePath: string;
  size?: number;
}

export interface DownloadTransferItem {
  kind: 'file' | 'directory';
  remotePath: string;
  localPath: string;
  relativePath: string;
  size: number;
}

export interface TransferSummary {
  transferredFiles: number;
  skippedItems: string[];
  failedItems: string[];
  canceledItems: string[];
}

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  details?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  hideCancel?: boolean;
  copyable?: boolean;
}

export interface AggregateTransferState {
  completedBytes: number;
  totalBytes: number;
}

export interface ActiveRemoteCommandState {
  id: string;
  connectionId: string;
  cancellationSource: vscode.CancellationTokenSource;
  control?: RemoteCommandStreamingControl;
  stopMode?: 'stop' | 'force';
}

export interface PendingRemoteSearchResultBatch {
  meta: RemoteSearchResultMeta;
  results: RemoteSearchResult[];
  timer?: NodeJS.Timeout;
}

export interface QueuedTransferJob {
  id: string;
  operation: 'Upload' | 'Download';
  source?: 'webview' | 'sidebar';
  connectionId: string;
  connectionLabel: string;
  title: string;
  from: string;
  to: string;
  progress: string;
  queuedAt?: string;
  startedAt?: string;
  run: (cancellationSource: vscode.CancellationTokenSource) => Promise<TransferCompletionStatus>;
  cleanup?: () => Promise<void>;
  resultSummary?: TransferSummary;
}



export interface ActiveTransferState {
  job: QueuedTransferJob;
  cancellationSource: vscode.CancellationTokenSource;
  connectionId: string;
  canceling: boolean;
  status: 'Preparing' | 'Running' | 'Waiting';
}

export interface PendingConnectionSnapshot extends ActiveConnection {
  connectionState: 'connecting' | 'failed';
  currentPath: string;
  sudoModeEnabled: boolean;
  error?: string;
}

export interface TransferQueueItemSnapshot {
  id: string;
  operation: 'Upload' | 'Download';
  title: string;
  connection: string;
  from: string;
  to: string;
  connectionId: string;
  status: 'Preparing' | 'Running' | 'Waiting' | 'Canceling' | TransferCompletionStatus;
  progress: string;
  canCancel: boolean;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  skippedItems?: string[];
  failedItems?: string[];
  canceledItems?: string[];
}

export interface TransferQueueStateSnapshot {
  current?: TransferQueueItemSnapshot;
  currentTransfers?: TransferQueueItemSnapshot[];
  pending: TransferQueueItemSnapshot[];
  completed: TransferQueueItemSnapshot[];
}

