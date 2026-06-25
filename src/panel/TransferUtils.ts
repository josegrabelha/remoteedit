import * as path from 'path';
import * as vscode from 'vscode';
import { joinRemotePath, normalizeRemotePath } from '../ssh/SftpSessionManager';
import { formatBytes, isRemoteEditOperationCancelled } from '../utils/progressUtils';
import type { TransferCompletionStatus, TransferSkipState, TransferSummary } from './PanelTypes';

export function createTransferSkipState(): TransferSkipState {
  return {
    paths: new Set<string>(),
    prefixes: new Set<string>()
  };
}

export function markTransferPathSkipped(relativePath: string, skipped: TransferSkipState, summary: TransferSummary, reason?: string): void {
  const normalizedPath = toPosixRelativePath(relativePath);
  skipped.paths.add(normalizedPath);
  summary.skippedItems.push(reason ? `${normalizedPath}: ${reason}` : normalizedPath);
}

export function markTransferTreeSkipped(relativePath: string, skipped: TransferSkipState, summary: TransferSummary, reason?: string): void {
  const normalizedPath = toPosixRelativePath(relativePath);
  skipped.paths.add(normalizedPath);
  skipped.prefixes.add(`${normalizedPath.replace(/\/+$/, '')}/`);
  summary.skippedItems.push(reason ? `${normalizedPath}: ${reason}` : normalizedPath);
}

export function shouldSkipTransferItem(relativePath: string, skipped: TransferSkipState): boolean {
  const normalizedPath = toPosixRelativePath(relativePath);

  if (skipped.paths.has(normalizedPath)) {
    return true;
  }

  for (const prefix of skipped.prefixes) {
    if (normalizedPath.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

export function formatTransferProgressMessage(label: string, transferredBytes: number, totalBytes: number, detail?: string): string {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return label;
  }

  const safeTransferred = Math.max(0, Math.min(transferredBytes, totalBytes));
  const percent = Math.max(0, Math.min(100, Math.floor((safeTransferred / totalBytes) * 100)));
  const transferMessage = `${formatBytes(safeTransferred)} of ${formatBytes(totalBytes)} (${percent}%)`;
  return detail ? `${detail} - ${transferMessage}` : transferMessage;
}

export function buildTransferProgressDetail(relativePath: string, currentFile: number, totalFiles: number): string {
  const fileLabel = truncateTransferProgressLabel(relativePath || 'file');

  if (totalFiles > 1) {
    return `${currentFile}/${totalFiles}: ${fileLabel}`;
  }

  return fileLabel;
}

export function truncateTransferProgressLabel(label: string, maxLength = 42): string {
  const normalizedLabel = label.replace(/\\/g, '/');

  if (normalizedLabel.length <= maxLength) {
    return normalizedLabel;
  }

  const keepStart = Math.max(8, Math.floor((maxLength - 3) / 2));
  const keepEnd = Math.max(8, maxLength - keepStart - 3);
  return `${normalizedLabel.slice(0, keepStart)}...${normalizedLabel.slice(-keepEnd)}`;
}

export function buildSelectedLocalItemsLabel(selectedUris: readonly vscode.Uri[]): string {
  if (selectedUris.length === 1) {
    return path.basename(selectedUris[0].fsPath) || 'Selected item';
  }

  return `${selectedUris.length} selected items`;
}

export function buildSelectedRemoteItemsLabel(entries: Array<{ name: string; path: string }>): string {
  if (entries.length === 1) {
    return entries[0].name || path.posix.basename(entries[0].path) || 'Selected item';
  }

  return `${entries.length} selected items`;
}

export function buildUploadQueueSourceLabel(selectedUris: readonly vscode.Uri[]): string {
  if (selectedUris.length === 1) {
    return selectedUris[0].fsPath;
  }

  return `${selectedUris.length} selected items`;
}

export function buildUploadQueueTargetLabel(selectedUris: readonly vscode.Uri[], targetDirectory: string): string {
  if (selectedUris.length === 1) {
    return joinRemoteRelativePath(targetDirectory, path.basename(selectedUris[0].fsPath));
  }

  return targetDirectory;
}

export function buildDownloadQueueSourceLabel(entries: Array<{ name: string; path: string }>): string {
  if (entries.length === 1) {
    return entries[0].path;
  }

  return `${entries.length} selected items`;
}

export function buildDownloadQueueTargetLabel(entries: Array<{ name: string; path: string }>, targetFolder: string): string {
  if (entries.length === 1) {
    const fileName = entries[0].name || path.posix.basename(entries[0].path);
    return path.join(targetFolder, fileName);
  }

  return targetFolder;
}

export function formatCount(count: number, singular: string, plural?: string): string {
  const safeCount = Number.isFinite(count) ? count : 0;
  return `${safeCount} ${safeCount === 1 ? singular : (plural || `${singular}s`)}`;
}

export function formatQueuedTransferCount(count: number): string {
  return count === 1 ? '1 queued' : `${count} queued`;
}

export function formatLocalDateTime(date: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function joinRemoteRelativePath(baseRemotePath: string, relativePath: string): string {
  return toPosixRelativePath(relativePath).split('/').filter(Boolean).reduce(
    (current, part) => joinRemotePath(current, part),
    normalizeRemotePath(baseRemotePath)
  );
}

export function toPosixRelativePath(value: string): string {
  return String(value || '').split(path.sep).join('/').replace(/^\/+/, '');
}

export function formatTransferError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isTransferCancellationError(error: unknown, token?: vscode.CancellationToken): boolean {
  if (token?.isCancellationRequested || isRemoteEditOperationCancelled(error)) {
    return true;
  }

  const message = formatTransferError(error).trim().toLowerCase();
  return message === 'operation canceled.'
    || message === 'operation cancelled.'
    || message === 'upload canceled.'
    || message === 'upload cancelled.'
    || message === 'download canceled.'
    || message === 'download cancelled.';
}

export function addCanceledTransferItem(summary: TransferSummary, relativePath: string): void {
  const safePath = String(relativePath || '').trim();
  const item = safePath ? `${safePath}: Operation canceled.` : 'Operation canceled.';

  if (!summary.canceledItems.includes(item)) {
    summary.canceledItems.push(item);
  }
}

export function getTransferCompletionStatus(summary: TransferSummary): TransferCompletionStatus {
  if (summary.canceledItems.length > 0 && summary.failedItems.length === 0) {
    return 'Canceled';
  }

  if (summary.failedItems.length > 0 && summary.transferredFiles === 0) {
    return 'Failed';
  }

  if (summary.failedItems.length > 0) {
    return 'Completed with errors';
  }

  if (summary.skippedItems.length > 0) {
    return 'Completed with skipped items';
  }

  return 'Completed';
}

export function buildTransferCompletionStatusText(operation: 'Upload' | 'Download', summary: TransferSummary): string {
  const completionStatus = getTransferCompletionStatus(summary);

  if (completionStatus === 'Canceled') {
    return `${operation} canceled.`;
  }

  if (completionStatus === 'Failed') {
    return `${operation} failed.`;
  }

  if (completionStatus === 'Completed with errors') {
    return `${operation} completed with errors.`;
  }

  if (completionStatus === 'Completed with skipped items') {
    return `${operation} completed with skipped items.`;
  }

  return `${operation} completed.`;
}

export function buildTransferStatusMessage(operation: 'Upload' | 'Download', summary: TransferSummary): string {
  const transferredLabel = formatCount(summary.transferredFiles, 'file');
  const skippedLabel = formatCount(summary.skippedItems.length, 'skipped item');
  const failedLabel = formatCount(summary.failedItems.length, 'failed item');
  const canceledLabel = formatCount(summary.canceledItems.length, 'canceled item');
  const completionStatus = getTransferCompletionStatus(summary);

  if (completionStatus === 'Canceled') {
    return `${operation} canceled. ${transferredLabel} transferred, ${skippedLabel}, ${canceledLabel}.`;
  }

  if (completionStatus === 'Failed') {
    return `${operation} failed. ${failedLabel}.`;
  }

  if (completionStatus === 'Completed with errors') {
    return `${operation} completed with errors. ${transferredLabel} transferred, ${failedLabel}.`;
  }

  if (completionStatus === 'Completed with skipped items') {
    return `${operation} completed with skipped items. ${transferredLabel} transferred, ${skippedLabel}.`;
  }

  return operation === 'Upload' ? `Uploaded ${transferredLabel}.` : `Downloaded ${transferredLabel}.`;
}

export function buildTransferResultProgress(summary: TransferSummary): string {
  const transferredLabel = formatCount(summary.transferredFiles, 'file');
  const skippedLabel = formatCount(summary.skippedItems.length, 'skipped item');

  if (summary.canceledItems.length > 0 && summary.failedItems.length === 0) {
    return `${transferredLabel} transferred, ${skippedLabel}, ${formatCount(summary.canceledItems.length, 'canceled item')}.`;
  }

  return `${transferredLabel} transferred, ${skippedLabel}, ${formatCount(summary.failedItems.length, 'failed item')}.`;
}
