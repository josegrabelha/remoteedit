/** Reject adapter requests even if a broken transport never invokes its callback. */
export class SessionLifetime {
  private ended = false;
  private closeReason: Error | undefined;
  private readonly pending = new Set<(error: Error) => void>();

  get closed(): boolean { return this.ended; }

  assertOpen(): void {
    if (this.ended) throw this.closeReason!;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.ended) return Promise.reject(this.closeReason!);
    return new Promise<T>((resolve, reject) => {
      this.pending.add(reject);
      Promise.resolve().then(() => {
        this.assertOpen();
        return task();
      }).then(resolve, reject).finally(() => this.pending.delete(reject));
    });
  }

  close(reason: Error = new SessionDisconnectedError()): void {
    if (this.ended) return;
    this.ended = true;
    this.closeReason = reason;
    for (const reject of this.pending) reject(reason);
    this.pending.clear();
  }
}

export class SessionDisconnectedError extends Error {
  readonly code = 'WORKSPACE_SYNC_DISCONNECTED';
  constructor() {
    super('Workspace Sync session was disconnected. Operation cancelled.');
    this.name = 'SessionDisconnectedError';
  }
}

/** A deadline is cleanup, not success; callers must close the actual transport. */
export async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
