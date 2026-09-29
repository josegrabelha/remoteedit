import * as path from 'path';

type LocalRootOperationMode = 'shared' | 'exclusive';

interface QueuedLocalRootOperation {
  root: string;
  mode: LocalRootOperationMode;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Coordinates Workspace Sync operations when their Local Roots overlap.
 *
 * Exclusive operations preserve the original serialization semantics used by
 * Sync/Watch paths that may mutate the Local filesystem. Shared operations are
 * read-only Refresh work: overlapping Refreshes may run together, but never
 * alongside an overlapping exclusive operation. FIFO writer fairness prevents
 * a stream of Refreshes from starving an already queued mutation.
 */
export class LocalRootOperationCoordinator {
  private readonly active = new Set<QueuedLocalRootOperation>();
  private readonly pending: QueuedLocalRootOperation[] = [];

  run<T>(localRoot: string, task: () => Promise<T>): Promise<T> {
    return this.enqueue(localRoot, 'exclusive', task);
  }

  runShared<T>(localRoot: string, task: () => Promise<T>): Promise<T> {
    return this.enqueue(localRoot, 'shared', task);
  }

  private enqueue<T>(localRoot: string, mode: LocalRootOperationMode, task: () => Promise<T>): Promise<T> {
    const root = normalizeLocalRootForCoordination(localRoot);
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        root,
        mode,
        task,
        resolve: value => resolve(value as T),
        reject
      });
      this.schedule();
    });
  }

  private schedule(): void {
    for (let index = 0; index < this.pending.length;) {
      const candidate = this.pending[index];
      if (this.conflictsWithActive(candidate) || this.hasEarlierBlockingWaiter(index, candidate)) {
        index += 1;
        continue;
      }

      this.pending.splice(index, 1);
      this.active.add(candidate);
      void this.execute(candidate);
    }
  }

  private conflictsWithActive(candidate: QueuedLocalRootOperation): boolean {
    for (const operation of this.active) {
      if (!localRootsOverlap(candidate.root, operation.root)) continue;
      if (candidate.mode === 'exclusive' || operation.mode === 'exclusive') return true;
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
      if (candidate.mode === 'exclusive' || waiter.mode === 'exclusive') return true;
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
  const parsed = path.parse(normalized);
  if (normalized !== parsed.root) normalized = normalized.replace(/[\\/]+$/, '');

  // Most Windows and macOS installations use case-insensitive local
  // filesystems. Treating case-only variants as overlapping is conservative:
  // on a case-sensitive macOS volume it may serialize extra work, but it can
  // never permit two writers to race the same physical tree.
  if (process.platform === 'win32' || process.platform === 'darwin') {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}
