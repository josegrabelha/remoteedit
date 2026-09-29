import { randomUUID } from 'crypto';
import { WORKSPACE_SYNC_ACTIVITY_LIMIT, type WorkspaceSyncActivityStore } from './WorkspaceSyncActivityStore';

export interface SyncInputOptions {
  title?: string;
  prompt?: string;
  password?: boolean;
  value?: string;
  required?: boolean;
}
export type SyncInput = (options: SyncInputOptions) => Promise<string | undefined>;
export interface SyncUiRequest {
  id: string;
  kind: 'confirm' | 'input' | 'folder';
  title: string;
  detail?: string;
  choices?: string[];
  password?: boolean;
  value?: string;
  required?: boolean;
}
export interface SyncActivity {
  id: number;
  time: number;
  level: 'info' | 'success' | 'warning' | 'error';
  target?: string;
  message: string;
}

/** Interaction bridge: no host dialogs; pending inputs belong to one webview. */
export class WorkspaceSyncUi {
  private sender?: (message: unknown) => void;
  private pending = new Map<string, { request: SyncUiRequest; resolve: (value: unknown) => void }>();
  private history: SyncActivity[];
  private sequence: number;
  private secrets = new Set<string>();
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly activityStore?: WorkspaceSyncActivityStore,
    private readonly persistDelayMs = 750
  ) {
    this.history = activityStore?.load() || [];
    this.sequence = this.history.reduce((max, entry) => Math.max(max, entry.id), 0);
  }

  attach(sender: (message: unknown) => void): () => void {
    this.detach();
    this.sender = sender;
    return () => { if (this.sender === sender) this.detach(); };
  }

  private detach(): void {
    this.cancelPending();
    this.sender = undefined;
  }

  cancelPending(): void {
    for (const [id, pending] of this.pending) {
      pending.resolve(undefined);
      this.sender?.({ type: 'dismissRequest', id });
    }
    this.pending.clear();
  }

  dispose(): void {
    this.detach();
    this.flushActivityPersistence();
    this.history = [];
    this.secrets.clear();
  }
  snapshot(): SyncActivity[] { return this.history.map(entry => ({ ...entry })); }
  clear(): void {
    this.history = [];
    this.cancelPendingActivityPersistence();
    void this.persistActivityNow().catch(() => undefined);
    this.sender?.({ type: 'activitySnapshot', entries: [] });
  }
  protectSecret(secret?: string): void { if (secret) this.secrets.add(secret); }

  sanitize(value: string): string {
    let text = String(value);
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[redacted]');
    return text.replace(/\b(password|passphrase)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, 4000);
  }

  log(message: string, level: SyncActivity['level'] = 'info', target?: string): void {
    const entry: SyncActivity = { id: ++this.sequence, time: Date.now(), level, target: target ? this.sanitize(target) : undefined, message: this.sanitize(message) };
    this.history.push(entry);
    if (this.history.length > WORKSPACE_SYNC_ACTIVITY_LIMIT) this.history.splice(0, this.history.length - WORKSPACE_SYNC_ACTIVITY_LIMIT);
    this.scheduleActivityPersistence();
    this.sender?.({ type: 'activity', entry });
  }


  private scheduleActivityPersistence(): void {
    if (!this.activityStore) return;
    this.cancelPendingActivityPersistence();
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persistActivityNow().catch(() => undefined);
    }, this.persistDelayMs);
  }

  private cancelPendingActivityPersistence(): void {
    if (!this.persistTimer) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
  }

  private flushActivityPersistence(): void {
    if (!this.activityStore) return;
    this.cancelPendingActivityPersistence();
    void this.persistActivityNow().catch(() => undefined);
  }

  private async persistActivityNow(): Promise<void> {
    if (!this.activityStore) return;
    await this.activityStore.save(this.history);
  }

  notify(message: string, level: SyncActivity['level'] = 'info'): void {
    this.log(message, level);
  }

  request(input: Omit<SyncUiRequest, 'id'>): Promise<unknown> {
    if (!this.sender) return Promise.resolve(undefined);
    const request = { ...input, id: randomUUID() };
    return new Promise(resolve => {
      this.pending.set(request.id, { request, resolve });
      this.sender?.({ type: 'request', request });
    });
  }

  isFolderRequest(id: string): boolean { return this.pending.get(id)?.request.kind === 'folder'; }

  respond(id: string, value: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    const request = pending.request;
    if (value !== undefined && value !== null) {
      if (request.kind === 'confirm' && (!request.choices?.includes(String(value)))) return;
      if ((request.kind === 'input' || request.kind === 'folder') && typeof value !== 'string') return;
      if (request.kind === 'input' && request.required && !String(value).trim()) return;
      if (request.password) this.protectSecret(String(value));
    }
    this.pending.delete(id);
    pending.resolve(value ?? undefined);
  }

  readonly input: SyncInput = async options => {
    const result = await this.request({ kind: 'input', title: options.title || 'Workspace Sync', detail: options.prompt, password: options.password, value: options.password ? undefined : options.value, required: options.required });
    return typeof result === 'string' ? result : undefined;
  };

  async confirm(title: string, choices: string[], detail?: string): Promise<string | undefined> {
    const result = await this.request({ kind: 'confirm', title, choices, detail });
    return typeof result === 'string' ? result : undefined;
  }
}
