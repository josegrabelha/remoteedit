/** Pending Watch work is independent of the bounded Activity history. Retries
 * always re-read/revalidate current state; they never replay an old SyncPlan. */
export class WatchRetryQueue<T> {
  private readonly entries = new Map<string, { value: T; attempts: number; due: number; running: boolean }>();
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private readonly retry: (value: T) => Promise<void>) {}

  schedule(key: string, value: T): void {
    if (this.disposed) return;
    const previous = this.entries.get(key);
    const attempts = Math.min(5, (previous?.attempts || 0) + 1);
    this.entries.set(key, { value, attempts, due: Date.now() + Math.min(60000, 5000 * 2 ** (attempts - 1)), running: previous?.running || false });
    if (!this.timer) this.timer = setInterval(() => { void this.runDue(); }, 1000);
  }

  retain(predicate: (value: T) => boolean): void {
    for (const [key, entry] of this.entries) if (!predicate(entry.value)) this.entries.delete(key);
    this.stopIfEmpty();
  }

  dispose(): void {
    this.disposed = true;
    this.entries.clear();
    this.stopIfEmpty();
  }

  private async runDue(now = Date.now()): Promise<void> {
    if (this.disposed) return;
    const tasks: Promise<void>[] = [];
    for (const [key, entry] of this.entries) {
      if (entry.running || entry.due > now) continue;
      entry.running = true;
      tasks.push((async () => {
        try {
          await this.retry(entry.value);
          // A failed retry can schedule itself again while running.
          if (this.entries.get(key) === entry) this.entries.delete(key);
        } catch {
          if (this.entries.get(key) === entry) this.schedule(key, entry.value);
        } finally {
          const current = this.entries.get(key);
          if (current) current.running = false;
          this.stopIfEmpty();
        }
      })());
    }
    await Promise.all(tasks);
  }

  private stopIfEmpty(): void {
    if (this.entries.size) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
