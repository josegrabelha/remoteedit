import type { SyncActivity } from './WorkspaceSyncUi';

export const WORKSPACE_SYNC_ACTIVITY_KEY = 'remoteedit.workspaceSync.activity.v1';
export const WORKSPACE_SYNC_ACTIVITY_LIMIT = 1000;

export interface WorkspaceSyncActivityState {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

/**
 * Local-only Activity persistence. This state intentionally does not participate
 * in Remote Edit Import/Export; it belongs to the current VS Code installation.
 */
export class WorkspaceSyncActivityStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly state: WorkspaceSyncActivityState) {}

  load(): SyncActivity[] {
    const stored = this.state.get<unknown>(WORKSPACE_SYNC_ACTIVITY_KEY, []);
    if (!Array.isArray(stored)) return [];

    const entries: SyncActivity[] = [];
    for (const candidate of stored) {
      const entry = normalizeActivity(candidate);
      if (entry) entries.push(entry);
    }
    return entries.slice(-WORKSPACE_SYNC_ACTIVITY_LIMIT);
  }

  save(entries: readonly SyncActivity[]): Promise<void> {
    const snapshot = entries.slice(-WORKSPACE_SYNC_ACTIVITY_LIMIT).map(entry => ({ ...entry }));
    const write = async (): Promise<void> => {
      await Promise.resolve(this.state.update(WORKSPACE_SYNC_ACTIVITY_KEY, snapshot));
    };
    this.writeChain = this.writeChain.then(write, write);
    return this.writeChain;
  }
}

function normalizeActivity(value: unknown): SyncActivity | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SyncActivity>;
  if (!Number.isFinite(candidate.id) || !Number.isFinite(candidate.time)) return undefined;
  if (!['info', 'success', 'warning', 'error'].includes(String(candidate.level))) return undefined;
  if (typeof candidate.message !== 'string') return undefined;
  if (candidate.target !== undefined && typeof candidate.target !== 'string') return undefined;

  return {
    id: Number(candidate.id),
    time: Number(candidate.time),
    level: candidate.level as SyncActivity['level'],
    target: candidate.target,
    message: candidate.message.slice(0, 4000)
  };
}
