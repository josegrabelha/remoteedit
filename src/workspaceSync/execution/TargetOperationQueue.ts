/**
 * Serializes high-level Workspace Sync operations per mapping target while
 * allowing unrelated targets to proceed independently. This keeps Refresh,
 * Watcher and Sync operations from racing the same private session/baseline.
 */
export class TargetOperationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) || Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => turn);
    this.tails.set(key, tail);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

}
