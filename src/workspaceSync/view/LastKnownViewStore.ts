import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { DiffEntry, WorkspaceSyncMapping, WorkspaceSyncTarget } from '../types';

const STORE_VERSION = 1;

export interface LastKnownWorkspaceSyncView {
  localRoot: string;
  connectionId: string;
  remoteRoot: string;
  diffs: DiffEntry[];
  lastRefreshedAt: number;
}

interface StoredLastKnownView {
  version: number;
  view: LastKnownWorkspaceSyncView;
}

/**
 * Persists the last rendered comparison snapshot for disconnected/restarted UI.
 * This is operational cache, not user configuration: it lives in extension
 * global storage and is intentionally excluded from Remote Edit backup/restore.
 */
export class WorkspaceSyncLastKnownViewStore {
  private readonly root: string;
  private readonly cache = new Map<string, LastKnownWorkspaceSyncView | undefined>();
  private readonly loaded = new Set<string>();

  constructor(context: vscode.ExtensionContext) {
    this.root = path.join(context.globalStorageUri.fsPath, 'workspace-sync', 'last-views');
  }

  async get(mapping: WorkspaceSyncMapping, target: WorkspaceSyncTarget): Promise<LastKnownWorkspaceSyncView | undefined> {
    const storageKey = key(mapping.id, target.id);
    let view = this.cache.get(storageKey);
    if (!this.loaded.has(storageKey)) {
      this.loaded.add(storageKey);
      try {
        const raw = await fs.readFile(this.filePath(mapping.id, target.id), 'utf8');
        const parsed = JSON.parse(raw) as StoredLastKnownView;
        view = parsed?.version === STORE_VERSION && parsed.view && Array.isArray(parsed.view.diffs)
          ? parsed.view
          : undefined;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          await fs.rm(this.filePath(mapping.id, target.id), { force: true }).catch(() => undefined);
        }
        view = undefined;
      }
      this.cache.set(storageKey, view);
    }

    if (!view) return undefined;
    if (view.localRoot !== mapping.localRoot || view.connectionId !== target.connectionId || view.remoteRoot !== target.remoteRoot) return undefined;
    return view;
  }

  async set(mapping: WorkspaceSyncMapping, target: WorkspaceSyncTarget, diffs: DiffEntry[], lastRefreshedAt: number): Promise<void> {
    const view: LastKnownWorkspaceSyncView = {
      localRoot: mapping.localRoot,
      connectionId: target.connectionId,
      remoteRoot: target.remoteRoot,
      diffs,
      lastRefreshedAt
    };
    const storageKey = key(mapping.id, target.id);
    this.loaded.add(storageKey);
    this.cache.set(storageKey, view);

    const filePath = this.filePath(mapping.id, target.id);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${crypto.randomUUID()}`;
    try {
      await fs.writeFile(tempPath, JSON.stringify({ version: STORE_VERSION, view } satisfies StoredLastKnownView), 'utf8');
      try {
        await fs.rename(tempPath, filePath);
      } catch (error) {
        if (process.platform !== 'win32') throw error;
        await fs.rm(filePath, { force: true });
        await fs.rename(tempPath, filePath);
      }
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  async clear(mappingId: string, targetId?: string): Promise<void> {
    if (targetId) {
      const storageKey = key(mappingId, targetId);
      this.cache.delete(storageKey);
      this.loaded.delete(storageKey);
      await fs.rm(this.filePath(mappingId, targetId), { force: true }).catch(() => undefined);
      return;
    }

    const prefix = `${mappingId}::`;
    for (const storageKey of [...this.cache.keys()]) if (storageKey.startsWith(prefix)) this.cache.delete(storageKey);
    for (const storageKey of [...this.loaded]) if (storageKey.startsWith(prefix)) this.loaded.delete(storageKey);
    await fs.rm(this.mappingDirectory(mappingId), { recursive: true, force: true }).catch(() => undefined);
  }

  private filePath(mappingId: string, targetId: string): string {
    return path.join(this.mappingDirectory(mappingId), `${hashId(targetId)}.json`);
  }

  private mappingDirectory(mappingId: string): string {
    return path.join(this.root, hashId(mappingId));
  }
}

function key(mappingId: string, targetId: string): string {
  return `${mappingId}::${targetId}`;
}

function hashId(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}
