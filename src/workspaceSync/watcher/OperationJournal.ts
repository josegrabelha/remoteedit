import * as path from 'path';

export interface LocalMutationOrigin {
  mappingId: string;
  targetId: string;
}

interface ActiveLocalMutation {
  filePath: string;
  originKey: string;
  count: number;
}

interface GraceLocalMutation {
  filePath: string;
  originKey: string;
  expiresAt: number;
}

/**
 * Tracks Local filesystem mutations caused by Workspace Sync itself so the
 * watcher can suppress only the echo back to the mapping/target that caused
 * the mutation. Other mappings/targets sharing the same Local Root must still
 * observe the filesystem event and may propagate it according to their own
 * direction, baseline, and conflict rules.
 *
 * Mutations remain active for the full operation and for a short grace period
 * afterwards because filesystem watcher events can arrive slightly late.
 */
export class OperationJournal {
  private readonly activeLocalMutations = new Map<string, ActiveLocalMutation>();
  private readonly localMutationGrace = new Map<string, GraceLocalMutation>();

  constructor(private readonly defaultGraceMs = 4000) {}

  beginLocalMutation(filePath: string, origin?: LocalMutationOrigin): () => void {
    const normalizedPath = normalize(filePath);
    const originKey = normalizeOrigin(origin);
    const key = mutationKey(originKey, normalizedPath);
    const existing = this.activeLocalMutations.get(key);
    this.activeLocalMutations.set(key, {
      filePath: normalizedPath,
      originKey,
      count: (existing?.count || 0) + 1
    });

    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      const current = this.activeLocalMutations.get(key);
      const count = Math.max(0, (current?.count || 1) - 1);
      if (count) {
        this.activeLocalMutations.set(key, { filePath: normalizedPath, originKey, count });
      } else {
        this.activeLocalMutations.delete(key);
      }
      this.localMutationGrace.set(key, {
        filePath: normalizedPath,
        originKey,
        expiresAt: Date.now() + Math.max(0, this.defaultGraceMs)
      });
    };
  }

  markLocalMutation(filePath: string, origin?: LocalMutationOrigin, ttlMs = this.defaultGraceMs): void {
    const normalizedPath = normalize(filePath);
    const originKey = normalizeOrigin(origin);
    const key = mutationKey(originKey, normalizedPath);
    this.localMutationGrace.set(key, {
      filePath: normalizedPath,
      originKey,
      expiresAt: Date.now() + Math.max(0, ttlMs)
    });
  }

  /**
   * Returns whether the path is an internal Local mutation for the requested
   * origin. Without an origin this intentionally preserves the broad legacy
   * query semantics for diagnostics/tests, but watcher routing should always
   * pass mappingId + targetId.
   */
  isLocalMutation(filePath: string, origin?: LocalMutationOrigin): boolean {
    this.prune();
    const candidate = normalize(filePath);
    const originKey = origin ? normalizeOrigin(origin) : undefined;

    for (const mutation of this.activeLocalMutations.values()) {
      if (originKey && mutation.originKey !== '*' && mutation.originKey !== originKey) continue;
      if (isSameOrDescendant(mutation.filePath, candidate)) return true;
    }
    for (const mutation of this.localMutationGrace.values()) {
      if (originKey && mutation.originKey !== '*' && mutation.originKey !== originKey) continue;
      if (mutation.expiresAt >= Date.now() && isSameOrDescendant(mutation.filePath, candidate)) return true;
    }
    return false;
  }

  /** @deprecated Use isLocalMutation with mapping/target scope for watcher routing. */
  consumeLocalMutation(filePath: string, origin?: LocalMutationOrigin): boolean {
    return this.isLocalMutation(filePath, origin);
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, mutation] of this.localMutationGrace) {
      if (mutation.expiresAt < now) this.localMutationGrace.delete(key);
    }
  }
}

function normalizeOrigin(origin?: LocalMutationOrigin): string {
  return origin ? `${origin.mappingId}::${origin.targetId}` : '*';
}

function mutationKey(originKey: string, filePath: string): string {
  return `${originKey}\u0000${filePath}`;
}

function normalize(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSameOrDescendant(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}
