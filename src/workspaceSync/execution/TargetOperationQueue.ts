import { AsyncLocalStorage } from 'node:async_hooks';

const targetOperationContext = new AsyncLocalStorage<AbortSignal>();
export function currentTargetOperationSignal(): AbortSignal | undefined {
  return targetOperationContext.getStore();
}

/**
 * Serializes high-level Workspace Sync operations per mapping target while
 * allowing unrelated targets to proceed independently. This keeps Refresh,
 * Watcher and Sync operations from racing the same private session/baseline.
 */
export class TargetOperationQueue {
  private disposed = false;
  private readonly active = new Map<string, Set<AbortController>>();
  private readonly waiting = new Map<string, Set<() => void>>();
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('Workspace Sync queued operation cancelled: queue disposed.');
    const controller = new AbortController();
    const previous = this.tails.get(key) || Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => turn);
    this.tails.set(key, tail);

    const waiters = this.waiting.get(key) || new Set<() => void>();
    this.waiting.set(key, waiters);
    let cancel!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => {
        controller.abort();
        reject(new Error('Workspace Sync queued operation cancelled by Disconnect.'));
      };
    });
    waiters.add(cancel);
    try {
      await Promise.race([previous.catch(() => undefined), cancelled]);
      if (controller.signal.aborted) throw new Error('Workspace Sync queued operation cancelled by Disconnect.');
      waiters.delete(cancel);
      const active = this.active.get(key) || new Set<AbortController>();
      this.active.set(key, active);
      active.add(controller);
      return await targetOperationContext.run(controller.signal, task);
    } finally {
      const active = this.active.get(key);
      active?.delete(controller);
      if (!active?.size) this.active.delete(key);
      waiters.delete(cancel);
      if (!waiters.size && this.waiting.get(key) === waiters) this.waiting.delete(key);
      release();
      void tail.then(() => {
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const key of this.tails.keys()) this.cancelPending(key);
  }

  /** Stop waiting work and signal active plans without releasing active mutation locks. */
  cancelPending(key: string): void {
    for (const cancel of this.waiting.get(key) || []) cancel();
    for (const controller of this.active.get(key) || []) controller.abort();
  }

  waitForIdle(key: string): Promise<void> {
    return this.tails.get(key) || Promise.resolve();
  }
}
