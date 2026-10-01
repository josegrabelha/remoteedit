import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { SyncOperation, SyncPlan, WorkspaceSyncMapping, WorkspaceSyncProgress, WorkspaceSyncTarget } from '../types';
import type { WorkspaceSyncRemoteSession } from '../connection/WorkspaceSyncSession';
import { resolveSyncPaths, remoteParentDirectory } from './SyncPathUtils';
import { assertLocalPathAncestorsSafe, assertLocalRegularFile, assertRemotePathAncestorsSafe } from './PathSafety';
import { localFilenameStyle, validateRelativePathForDestination } from '../planning/PathCompatibility';
import { errorMessage, formatSyncErrorOutput } from './OperationFailureDetails';
import { SessionDisconnectedError } from '../connection/SessionLifetime';
import { currentTargetOperationSignal } from './TargetOperationQueue';

export interface SyncExecutionOptions {
  atomicTransfer: boolean;
  /** Controller UI only: this plan was started automatically by a Watch. */
  watchActivity?: boolean;
  concurrency?: number;
  retries?: number;
  cancellationToken?: { readonly isCancellationRequested: boolean };
  onActivity?: (event: { kind: 'started' | 'completed' | 'failed' | 'retry' | 'skipped' | 'deferred'; operation: SyncOperation; message?: string; errorOutput?: string }) => void;
  onProgress?: (progress: WorkspaceSyncProgress) => void;
  /** Called when an atomic upload temp file could not be removed after a failed transfer. */
  onOrphanedRemoteTemp?: (tempRemotePath: string, operation: SyncOperation) => void;
  journal?: {
    beginLocalMutation?(filePath: string): () => void;
    markLocalMutation(filePath: string): void;
  };
}

export interface SyncExecutionResult {
  completed: SyncOperation[];
  failed: Array<{ operation: SyncOperation; error: string; errorOutput?: string }>;
  skipped: SyncOperation[];
  deferred: Array<{ operation: SyncOperation; reason: string }>;
  cancelled: boolean;
}

/**
 * Executes one immutable SyncPlan. Operations are grouped into safe phases so
 * directory creation always precedes transfers and destructive directory
 * removal cannot race with child file operations.
 */
export async function executeSyncPlan(
  mapping: WorkspaceSyncMapping,
  target: WorkspaceSyncTarget,
  plan: SyncPlan,
  session: WorkspaceSyncRemoteSession,
  options: SyncExecutionOptions
): Promise<SyncExecutionResult> {
  const signal = currentTargetOperationSignal();
  const originalCancellation = options.cancellationToken;
  options = { ...options, cancellationToken: {
    get isCancellationRequested() { return Boolean(originalCancellation?.isCancellationRequested || signal?.aborted); }
  } };
  const skipped = plan.operations.filter(operation => operation.type === 'skip');
  for (const operation of skipped) options.onActivity?.({ kind: 'skipped', operation, message: operation.reason });
  const actionable = plan.operations.filter(operation => operation.type !== 'skip');
  const completed: SyncOperation[] = [];
  const failed: Array<{ operation: SyncOperation; error: string; errorOutput?: string }> = [];
  const deferred: Array<{ operation: SyncOperation; reason: string }> = [];
  const concurrency = Math.max(1, Math.min(
    session.capabilities.maxConcurrentTransfers,
    Math.floor(options.concurrency || session.capabilities.maxConcurrentTransfers)
  ));
  const retries = Math.max(0, Math.min(5, Math.floor(options.retries ?? 2)));
  let processed = 0;

  const phases = buildExecutionPhases(actionable);
  for (const phase of phases) {
    if (options.cancellationToken?.isCancellationRequested || session.isDisconnected) break;
    const destructivePhase = phase.every(operation => operation.type === 'deleteLocal' || operation.type === 'deleteRemote');
    if (destructivePhase && (failed.length || deferred.length)) {
      // Never continue into later destructive phases after a partial failure or
      // a directory delete that became stale. An ancestor delete can depend on
      // the path that was deferred, so continuing would recreate the classic
      // parent-before-child ENOTEMPTY race or, worse, remove newly-created data.
      skipped.push(...phase);
      const message = deferred.length
        ? 'An earlier directory delete was deferred because its contents changed.'
        : 'An earlier transfer failed.';
      for (const operation of phase) options.onActivity?.({ kind: 'skipped', operation, message });
      break;
    }
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        if (options.cancellationToken?.isCancellationRequested || session.isDisconnected) return;
        const index = nextIndex++;
        if (index >= phase.length) return;
        const operation = phase[index];
        options.onProgress?.({ completed: processed, total: actionable.length, currentPath: operation.relativePath, phase: operation.type });
        options.onActivity?.({ kind: 'started', operation });
        try {
          await withRetries(
            () => executeOperation(mapping, target, operation, session, options.atomicTransfer, options.journal, options.onOrphanedRemoteTemp),
            retries,
            session,
            options.cancellationToken,
            attempt => options.onActivity?.({ kind: 'retry', operation, message: `Reconnecting before retry ${attempt}.` })
          );
          completed.push(operation);
          options.onActivity?.({ kind: 'completed', operation });
        } catch (error) {
          if (isDirectoryDeleteDeferred(error, operation)) {
            const reason = 'Directory still contains content outside the validated delete manifest. The delete was deferred and the affected subtree must be re-evaluated.';
            deferred.push({ operation, reason });
            options.onActivity?.({ kind: 'deferred', operation, message: reason });
          } else {
            const message = errorMessage(error);
            const errorOutput = formatSyncErrorOutput(error);
            failed.push({ operation, error: message, errorOutput });
            options.onActivity?.({ kind: 'failed', operation, message, errorOutput });
          }
        } finally {
          processed += 1;
          options.onProgress?.({ completed: processed, total: actionable.length, currentPath: operation.relativePath, phase: operation.type });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, phase.length)) }, () => worker()));
  }

  const cancelled = Boolean(options.cancellationToken?.isCancellationRequested || session.isDisconnected);
  options.onProgress?.({ completed: processed, total: actionable.length, phase: cancelled ? 'cancelled' : 'complete' });
  return { completed, failed, skipped, deferred, cancelled };
}

function buildExecutionPhases(operations: SyncOperation[]): SyncOperation[][] {
  const createDirectories = operations
    .filter(operation => operation.type === 'createLocalDirectory' || operation.type === 'createRemoteDirectory')
    .sort((a, b) => pathDepth(a.relativePath) - pathDepth(b.relativePath) || a.relativePath.localeCompare(b.relativePath));

  const transfers = operations
    .filter(operation => operation.type === 'upload' || operation.type === 'download')
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const deletes = operations
    .filter(operation => operation.type === 'deleteLocal' || operation.type === 'deleteRemote');

  // Delete ordering has a real dependency: every descendant must be fully
  // removed before its parent directory is removed. Sorting a single
  // concurrent phase deepest-first is not enough because multiple workers can
  // still start a parent rmdir while a child delete is in flight. Execute one
  // depth level at a time (deepest first), while still allowing independent
  // siblings at the same depth to run concurrently.
  const deletesByDepth = new Map<number, SyncOperation[]>();
  for (const operation of deletes) {
    const depth = pathDepth(operation.relativePath);
    const level = deletesByDepth.get(depth) || [];
    level.push(operation);
    deletesByDepth.set(depth, level);
  }
  const deletePhases = [...deletesByDepth.entries()]
    .sort(([leftDepth], [rightDepth]) => rightDepth - leftDepth)
    .map(([, level]) => level.sort((a, b) => {
      const aDirectory = deleteTargetsDirectory(a);
      const bDirectory = deleteTargetsDirectory(b);
      if (aDirectory !== bDirectory) return aDirectory ? 1 : -1;
      return b.relativePath.localeCompare(a.relativePath);
    }));

  return [createDirectories, transfers, ...deletePhases].filter(phase => phase.length);
}

function deleteTargetsDirectory(operation: SyncOperation): boolean {
  return operation.type === 'deleteLocal'
    ? operation.expectedLocal?.kind === 'directory'
    : operation.expectedRemote?.kind === 'directory';
}

function pathDepth(relativePath: string): number {
  return relativePath.split('/').filter(Boolean).length;
}

async function executeOperation(
  mapping: WorkspaceSyncMapping,
  target: WorkspaceSyncTarget,
  operation: SyncOperation,
  session: WorkspaceSyncRemoteSession,
  atomicTransfer: boolean,
  journal?: SyncExecutionOptions['journal'],
  onOrphanedRemoteTemp?: SyncExecutionOptions['onOrphanedRemoteTemp']
): Promise<void> {
  const { localPath, remotePath, localRelativePath, remoteRelativePath } = resolveSyncPaths(mapping, target, operation.relativePath, operation);
  const destinationStyle = operation.type === 'upload' || operation.type === 'createRemoteDirectory'
    ? session.capabilities.filenameStyle
    : operation.type === 'download' || operation.type === 'createLocalDirectory'
      ? localFilenameStyle()
      : undefined;
  if (destinationStyle) {
    const destinationRelativePath = operation.type === 'upload' || operation.type === 'createRemoteDirectory'
      ? remoteRelativePath
      : localRelativePath;
    const incompatible = validateRelativePathForDestination(destinationRelativePath, destinationStyle);
    if (incompatible) throw new Error(`${incompatible}: ${operation.relativePath}`);
  }
  await Promise.all([
    assertLocalPathAncestorsSafe(mapping.localRoot, localRelativePath),
    assertRemotePathAncestorsSafe(session, target.remoteRoot, remoteRelativePath)
  ]);
  switch (operation.type) {
    case 'createRemoteDirectory':
      await session.ensureDirectory(remotePath);
      return;

    case 'createLocalDirectory': {
      const endMutation = beginLocalMutation(journal, localPath);
      try {
        await fs.mkdir(localPath, { recursive: true });
      } finally {
        endMutation();
      }
      return;
    }

    case 'upload':
      await assertLocalRegularFile(localPath, operation.relativePath);
      await session.ensureDirectory(remoteParentDirectory(remotePath));
      if (atomicTransfer) {
        const tempRemote = `${remotePath}.remoteedit-${crypto.randomUUID()}.tmp`;
        try {
          await session.upload(localPath, tempRemote);
          await session.replaceFile(tempRemote, remotePath);
        } catch (error) {
          try {
            await session.deleteFile(tempRemote);
          } catch {
            // The connection may already be gone. Record the exact internal temp
            // so the controller can remove it safely after the next reconnect.
            onOrphanedRemoteTemp?.(tempRemote, operation);
          }
          throw error;
        }
      } else {
        await session.upload(localPath, remotePath);
      }
      return;

    case 'download': {
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      const endMutation = beginLocalMutation(journal, localPath);
      try {
        // Always download to a sibling temp file before replacement. Besides
        // avoiding partial local files, this prevents following a destination
        // symlink when Atomic Transfer is disabled for the mapping.
        const tempLocal = `${localPath}.remoteedit-${crypto.randomUUID()}.tmp`;
        try {
          await session.download(remotePath, tempLocal);
          await replaceLocalFile(tempLocal, localPath);
        } catch (error) {
          try { await fs.rm(tempLocal, { force: true }); } catch { /* best effort */ }
          throw error;
        }
      } finally {
        endMutation();
      }
      return;
    }

    case 'deleteLocal': {
      const endMutation = beginLocalMutation(journal, localPath);
      try {
        const current = await localEntryKind(localPath);
        if (!current) return;
        if (current === 'directory') {
          // Deliberately non-recursive. Directory-delete plans are expanded
          // into explicit descendant operations before revalidation. If new
          // content appears after that validated manifest, rmdir fails closed
          // instead of recursively erasing the new entry.
          await fs.rmdir(localPath);
        } else {
          await fs.rm(localPath, { force: true });
        }
      } finally {
        endMutation();
      }
      return;
    }

    case 'deleteRemote': {
      const stat = await session.stat(remotePath);
      if (!stat) return;
      if (stat.kind === 'directory') await session.deleteDirectory(remotePath);
      else await session.deleteFile(remotePath);
      return;
    }

    case 'skip':
      return;
  }
}

async function localEntryKind(filePath: string): Promise<'file' | 'directory' | 'other' | undefined> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isDirectory()) return 'directory';
    if (stat.isFile() || stat.isSymbolicLink()) return 'file';
    return 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function beginLocalMutation(journal: SyncExecutionOptions['journal'], localPath: string): () => void {
  if (journal?.beginLocalMutation) return journal.beginLocalMutation(localPath);
  journal?.markLocalMutation(localPath);
  return () => journal?.markLocalMutation(localPath);
}

async function withRetries(
  operation: () => Promise<void>,
  retries: number,
  session: WorkspaceSyncRemoteSession,
  cancellationToken?: { readonly isCancellationRequested: boolean },
  onRetry?: (attempt: number) => void
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (session.isDisconnected) throw new SessionDisconnectedError();
    if (cancellationToken?.isCancellationRequested) throw new Error('Workspace Sync operation cancelled.');
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (session.isDisconnected || attempt >= retries || !isRetryable(error)) break;
      onRetry?.(attempt + 1);
      await delay(Math.min(2000, 250 * (2 ** attempt)));
      if (session.isDisconnected) throw new SessionDisconnectedError();
      if (cancellationToken?.isCancellationRequested) throw new Error('Workspace Sync operation cancelled.');
      try {
        await session.reconnect();
      } catch (reconnectError) {
        lastError = reconnectError;
      }
    }
  }
  throw lastError;
}


function isDirectoryDeleteDeferred(error: unknown, operation: SyncOperation): boolean {
  if (operation.type !== 'deleteLocal' || operation.expectedLocal?.kind !== 'directory') return false;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOTEMPTY' || code === 'EEXIST';
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|ECONNRESET|ECONNABORTED|ETIMEDOUT|EPIPE|socket|connection|channel|temporary|try again|421|425|426|450|451|452|not connected|connection closed/i.test(message);
}

async function replaceLocalFile(tempPath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(tempPath, targetPath);
    return;
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }

  const backupPath = `${targetPath}.remoteedit-backup-${crypto.randomUUID()}.tmp`;
  let hadTarget = false;
  try {
    try {
      await fs.rename(targetPath, backupPath);
      hadTarget = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
    await fs.rename(tempPath, targetPath);
    if (hadTarget) {
      try { await fs.rm(backupPath, { force: true }); } catch { /* successful replacement; stale backup is non-fatal */ }
    }
  } catch (error) {
    if (hadTarget) {
      try {
        await fs.rm(targetPath, { force: true });
        await fs.rename(backupPath, targetPath);
      } catch { /* best effort restore */ }
    }
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
