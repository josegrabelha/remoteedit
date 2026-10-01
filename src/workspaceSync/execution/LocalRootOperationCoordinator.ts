import * as path from 'path';
import * as fs from 'fs';
import { currentTargetOperationSignal } from './TargetOperationQueue';

type LocalRootOperationMode = 'shared' | 'exclusive' | 'paths';

/** Paths are absolute Local filesystem paths (not logical Sync relative paths). */
export interface LocalPathAccess {
  path: string;
  mode: 'read' | 'write';
}

interface QueuedLocalRootOperation {
  root: string;
  mode: LocalRootOperationMode;
  accesses?: LocalPathAccess[];
  index?: LocalPathIndex;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  stopWaiting?: () => void;
}

interface LocalPathIndex {
  all: Set<string>;
  allAncestors: Set<string>;
  writes: Set<string>;
  writeAncestors: Set<string>;
}

/**
 * Coordinates Workspace Sync operations when their Local Roots overlap.
 *
 * Exclusive operations preserve legacy whole-root maintenance barriers.
 * Shared operations are whole-tree Refresh reads. Path operations reserve
 * explicit read/write subtrees; compatible operations can run concurrently,
 * including across mappings that share the same Local directory. Queued
 * conflicting writers have FIFO priority over later readers.
 */
export class LocalRootOperationCoordinator {
  private readonly maxConcurrentPathPlans = 4;
  private readonly active = new Set<QueuedLocalRootOperation>();
  private readonly pending: QueuedLocalRootOperation[] = [];

  run<T>(localRoot: string, task: () => Promise<T>): Promise<T> {
    return this.enqueue(localRoot, 'exclusive', task);
  }

  runShared<T>(localRoot: string, task: () => Promise<T>): Promise<T> {
    return this.enqueue(localRoot, 'shared', task);
  }

  /**
   * Admit independent sync plans concurrently. Each read/write lock covers its
   * concrete path AND descendants, so deleting a directory conflicts with a
   * transfer anywhere below it. Full-root readers and exclusive maintenance
   * operations remain barriers for overlapping roots. Unknown/empty footprints
   * deliberately fall back to the legacy whole-root exclusive lock.
   *
   * Callers must compute the COMPLETE footprint before this method, and keep
   * validation, execution, and committed baseline updates inside the task.
   */
  runPaths<T>(localRoot: string, accesses: readonly LocalPathAccess[], task: () => Promise<T>): Promise<T> {
    if (!accesses.length) return this.run(localRoot, task);
    const root = normalizeLocalRootForCoordination(localRoot);
    const lexicalRoot = path.resolve(localRoot);
    const normalized: LocalPathAccess[] = [];
    for (const access of accesses) {
      if (!access.path || (access.mode !== 'read' && access.mode !== 'write')) {
        return this.run(localRoot, task);
      }
      const lexicalPath = path.resolve(access.path);
      const relative = path.relative(lexicalRoot, lexicalPath);
      if (!path.isAbsolute(access.path) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return this.run(localRoot, task);
      }
      // Only the root needs realpath resolution. Symlink ancestors below that
      // root are rejected by PathSafety; calling realpath on every file here
      // would add synchronous disk I/O for every item in a large sync plan.
      const absolute = normalizeLocalPathCase(path.resolve(root, relative));
      normalized.push({ path: absolute, mode: access.mode });
    }
    return this.enqueue(localRoot, 'paths', task, normalized);
  }

  private enqueue<T>(localRoot: string, mode: LocalRootOperationMode, task: () => Promise<T>, accesses?: LocalPathAccess[]): Promise<T> {
    const root = normalizeLocalRootForCoordination(localRoot);
    const signal = currentTargetOperationSignal();
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Workspace Sync queued operation cancelled by Disconnect.'));
        return;
      }
      const operation: QueuedLocalRootOperation = {
        root,
        mode,
        accesses,
        index: mode === 'paths' ? indexPaths(accesses || []) : undefined,
        task,
        resolve: value => resolve(value as T),
        reject
      };
      const cancel = (): void => {
        const index = this.pending.indexOf(operation);
        if (index < 0) return; // Active mutations retain their locks until completion.
        this.pending.splice(index, 1);
        operation.stopWaiting?.();
        reject(new Error('Workspace Sync queued operation cancelled by Disconnect.'));
        this.schedule();
      };
      operation.stopWaiting = () => signal?.removeEventListener('abort', cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      this.pending.push(operation);
      this.schedule();
    });
  }

  private schedule(): void {
    for (let index = 0; index < this.pending.length;) {
      const candidate = this.pending[index];
      if (candidate.mode === 'paths'
        && [...this.active].filter(operation => operation.mode === 'paths').length >= this.maxConcurrentPathPlans) {
        index += 1;
        continue;
      }
      if (this.conflictsWithActive(candidate) || this.hasEarlierBlockingWaiter(index, candidate)) {
        index += 1;
        continue;
      }

      this.pending.splice(index, 1);
      candidate.stopWaiting?.();
      this.active.add(candidate);
      void this.execute(candidate);
    }
  }

  private conflictsWithActive(candidate: QueuedLocalRootOperation): boolean {
    for (const operation of this.active) {
      if (!localRootsOverlap(candidate.root, operation.root)) continue;
      if (operationsConflict(candidate, operation)) return true;
    }
    return false;
  }

  private hasEarlierBlockingWaiter(index: number, candidate: QueuedLocalRootOperation): boolean {
    for (let previous = 0; previous < index; previous += 1) {
      const waiter = this.pending[previous];
      if (!localRootsOverlap(candidate.root, waiter.root)) continue;
      // An exclusive candidate keeps normal FIFO ordering behind any earlier
      // overlapping request. A shared candidate only waits for an earlier
      // exclusive writer; earlier shared Refreshes can be admitted together.
      if (operationsConflict(candidate, waiter)) return true;
    }
    return false;
  }

  private async execute(operation: QueuedLocalRootOperation): Promise<void> {
    try {
      operation.resolve(await operation.task());
    } catch (error) {
      operation.reject(error);
    } finally {
      this.active.delete(operation);
      this.schedule();
    }
  }
}

function operationsConflict(first: QueuedLocalRootOperation, second: QueuedLocalRootOperation): boolean {
  if (first.mode === 'exclusive' || second.mode === 'exclusive') return true;
  if (first.mode === 'shared' && second.mode === 'shared') return false;
  if (first.mode === 'shared' || second.mode === 'shared') {
    // A tree scan cannot observe a partially committed download/delete.
    const paths = first.mode === 'paths' ? first.accesses! : second.accesses!;
    return paths.some(access => access.mode === 'write');
  }
  return first.accesses!.some(access => {
    const other = second.index!;
    return access.mode === 'write'
      ? overlapsIndexedPaths(access.path, other.all, other.allAncestors)
      : overlapsIndexedPaths(access.path, other.writes, other.writeAncestors);
  });
}

/** Indexed overlap checks avoid O(n²) comparisons for thousands of files in
 * independent plans, including parent/child directory operations. */
function indexPaths(accesses: readonly LocalPathAccess[]): LocalPathIndex {
  const index: LocalPathIndex = {
    all: new Set(), allAncestors: new Set(), writes: new Set(), writeAncestors: new Set()
  };
  for (const access of accesses) {
    index.all.add(access.path);
    if (access.mode === 'write') index.writes.add(access.path);
    let parent = path.dirname(access.path);
    while (parent !== access.path) {
      index.allAncestors.add(parent);
      if (access.mode === 'write') index.writeAncestors.add(parent);
      const next = path.dirname(parent);
      if (parent === next) break;
      parent = next;
    }
  }
  return index;
}

function overlapsIndexedPaths(candidate: string, exact: Set<string>, ancestors: Set<string>): boolean {
  if (ancestors.has(candidate)) return true; // a recorded descendant exists
  let current = candidate;
  while (true) {
    if (exact.has(current)) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function localRootsOverlap(firstRoot: string, secondRoot: string): boolean {
  const first = normalizeLocalRootForCoordination(firstRoot);
  const second = normalizeLocalRootForCoordination(secondRoot);
  if (first === second) return true;
  return isDescendant(first, second) || isDescendant(second, first);
}

function isDescendant(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function normalizeLocalRootForCoordination(localRoot: string): string {
  let normalized = path.resolve(String(localRoot || '').trim());
  // Canonicalize roots so two mappings using symlink aliases of the SAME Local
  // directory cannot acquire unrelated locks. Missing roots retain the legacy
  // lexical behavior; their filesystem operations will fail safely later.
  try { normalized = fs.realpathSync.native(normalized); } catch { /* not on disk */ }
  const parsed = path.parse(normalized);
  if (normalized !== parsed.root) normalized = normalized.replace(/[\\/]+$/, '');

  // Most Windows and macOS installations use case-insensitive local
  // filesystems. Treating case-only variants as overlapping is conservative:
  // on a case-sensitive macOS volume it may serialize extra work, but it can
  // never permit two writers to race the same physical tree.
  return normalizeLocalPathCase(normalized);
}

function normalizeLocalPathCase(value: string): string {
  return process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value;
}
