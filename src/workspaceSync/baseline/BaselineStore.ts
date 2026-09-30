import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { BaselineEntry, FileFingerprint, SyncBaseline, SyncSnapshot } from '../types';
import { canonicalRelativePath, normalizeRelativePath } from '../snapshot/SyncSnapshot';

const STORE_VERSION = 2;
const WRITE_DEBOUNCE_MS = 250;

export interface BaselineContext {
  localRoot: string;
  remoteRoot: string;
  connectionId: string;
  connectionIdentity: string;
}

interface StoredBaselineRecord {
  version: number;
  context?: BaselineContext;
  baseline?: SyncBaseline;
}

/**
 * Workspace Sync owns its baseline persistence completely. Baselines live in
 * extension global storage rather than VS Code Memento because large projects
 * can contain tens of thousands of paths. Updates are cached in memory and
 * persisted in short batches; losing the last debounce window only makes the
 * next run more conservative (no baseline), never destructive.
 */
export class BaselineStore implements vscode.Disposable {
  private readonly root: string;
  private readonly records = new Map<string, StoredBaselineRecord>();
  private readonly loaded = new Set<string>();
  private readonly writeTimers = new Map<string, NodeJS.Timeout>();
  private readonly writeChains = new Map<string, Promise<void>>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.root = path.join(context.globalStorageUri.fsPath, 'workspace-sync', 'baselines');
  }

  dispose(): void {
    for (const timer of this.writeTimers.values()) clearTimeout(timer);
    this.writeTimers.clear();
    for (const storageKey of this.records.keys()) {
      void this.persist(storageKey).catch(() => undefined);
    }
  }

  async ensureContext(mappingId: string, targetId: string, context: BaselineContext): Promise<boolean> {
    const storageKey = key(mappingId, targetId);
    const record = await this.load(mappingId, targetId);
    const previous = record.context;
    // A persisted baseline without a context cannot be proven to belong to the
    // current roots/server (for example after a schema migration). Fail closed.
    const changed = previous ? !sameContext(previous, context) : Boolean(record.baseline);
    if (changed) record.baseline = undefined;
    record.context = { ...context };
    this.records.set(storageKey, record);
    this.schedulePersist(storageKey);
    return changed;
  }

  async get(mappingId: string, targetId: string): Promise<SyncBaseline | undefined> {
    return (await this.load(mappingId, targetId)).baseline;
  }

  async set(baseline: SyncBaseline): Promise<void> {
    const storageKey = key(baseline.mappingId, baseline.targetId);
    const record = await this.load(baseline.mappingId, baseline.targetId);
    record.baseline = cloneBaseline(baseline);
    this.records.set(storageKey, record);
    this.schedulePersist(storageKey);
  }

  async updatePath(
    mappingId: string,
    targetId: string,
    relativePath: string,
    local?: FileFingerprint,
    remote?: FileFingerprint,
    sidePaths: { localRelativePath?: string; remoteRelativePath?: string } = {}
  ): Promise<void> {
    const storageKey = key(mappingId, targetId);
    const record = await this.load(mappingId, targetId);
    const current = record.baseline || { mappingId, targetId, capturedAt: Date.now(), entries: {} };
    const entries = { ...current.entries };
    const canonicalPath = canonicalRelativePath(relativePath);
    if (!local && !remote) delete entries[canonicalPath];
    else entries[canonicalPath] = {
      ...entries[canonicalPath],
      local: cloneFingerprint(local),
      remote: cloneFingerprint(remote),
      localRelativePath: local ? normalizeRelativePath(sidePaths.localRelativePath || entries[canonicalPath]?.localRelativePath || canonicalPath) : undefined,
      remoteRelativePath: remote ? normalizeRelativePath(sidePaths.remoteRelativePath || entries[canonicalPath]?.remoteRelativePath || canonicalPath) : undefined
    };
    record.baseline = { ...current, capturedAt: Date.now(), entries };
    this.records.set(storageKey, record);
    this.schedulePersist(storageKey);
  }

  async mergeEntries(
    mappingId: string,
    targetId: string,
    updates: Record<string, BaselineEntry | undefined>
  ): Promise<void> {
    const storageKey = key(mappingId, targetId);
    const record = await this.load(mappingId, targetId);
    const current = record.baseline || { mappingId, targetId, capturedAt: Date.now(), entries: {} };
    const entries = { ...current.entries };
    for (const [relativePath, update] of Object.entries(updates)) {
      const canonicalPath = canonicalRelativePath(relativePath);
      if (!update || (!update.local && !update.remote)) delete entries[canonicalPath];
      else entries[canonicalPath] = cloneBaselineEntry(update);
    }
    record.baseline = { ...current, capturedAt: Date.now(), entries };
    this.records.set(storageKey, record);
    this.schedulePersist(storageKey);
  }

  async clear(mappingId: string, targetId?: string): Promise<void> {
    if (targetId) {
      const storageKey = key(mappingId, targetId);
      this.cancelScheduledWrite(storageKey);
      this.records.delete(storageKey);
      this.loaded.delete(storageKey);
      await this.waitForWrite(storageKey);
      await fs.rm(this.filePath(mappingId, targetId), { force: true }).catch(() => undefined);
      return;
    }

    const prefix = `${mappingId}::`;
    const matchingKeys = new Set<string>([
      ...[...this.records.keys()].filter(storageKey => storageKey.startsWith(prefix)),
      ...[...this.loaded].filter(storageKey => storageKey.startsWith(prefix)),
      ...[...this.writeChains.keys()].filter(storageKey => storageKey.startsWith(prefix)),
      ...[...this.writeTimers.keys()].filter(storageKey => storageKey.startsWith(prefix))
    ]);
    for (const storageKey of matchingKeys) {
      this.cancelScheduledWrite(storageKey);
      this.records.delete(storageKey);
      this.loaded.delete(storageKey);
    }
    await Promise.all([...matchingKeys].map(storageKey => this.waitForWrite(storageKey)));
    await fs.rm(this.mappingDirectory(mappingId), { recursive: true, force: true }).catch(() => undefined);
  }

  private async load(mappingId: string, targetId: string): Promise<StoredBaselineRecord> {
    const storageKey = key(mappingId, targetId);
    if (this.loaded.has(storageKey)) {
      return this.records.get(storageKey) || { version: STORE_VERSION };
    }

    let record: StoredBaselineRecord = { version: STORE_VERSION };
    try {
      const raw = await fs.readFile(this.filePath(mappingId, targetId), 'utf8');
      const parsed = JSON.parse(raw) as StoredBaselineRecord;
      if (parsed?.version === STORE_VERSION) record = normalizeStoredRecord(parsed);
      else await fs.rm(this.filePath(mappingId, targetId), { force: true }).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        // Corrupt/unreadable baseline state is deliberately discarded. The next
        // compare will run without trust and surface conservative conflicts.
        await fs.rm(this.filePath(mappingId, targetId), { force: true }).catch(() => undefined);
      }
    }

    this.loaded.add(storageKey);
    this.records.set(storageKey, record);
    return record;
  }

  private schedulePersist(storageKey: string): void {
    this.cancelScheduledWrite(storageKey);
    this.writeTimers.set(storageKey, setTimeout(() => {
      this.writeTimers.delete(storageKey);
      void this.persist(storageKey).catch(() => undefined);
    }, WRITE_DEBOUNCE_MS));
  }

  private cancelScheduledWrite(storageKey: string): void {
    const timer = this.writeTimers.get(storageKey);
    if (timer) clearTimeout(timer);
    this.writeTimers.delete(storageKey);
  }

  private async persist(storageKey: string): Promise<void> {
    const record = this.records.get(storageKey);
    if (!record) return;
    const [mappingId, targetId] = splitKey(storageKey);
    await this.enqueueWrite(storageKey, async () => {
      const current = this.records.get(storageKey);
      if (!current) return;
      const filePath = this.filePath(mappingId, targetId);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.tmp-${crypto.randomUUID()}`;
      try {
        await fs.writeFile(tempPath, JSON.stringify(current), 'utf8');
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
    });
  }

  private async enqueueWrite(storageKey: string, task: () => Promise<void>): Promise<void> {
    const previous = this.writeChains.get(storageKey) || Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.writeChains.set(storageKey, next);
    try {
      await next;
    } finally {
      if (this.writeChains.get(storageKey) === next) this.writeChains.delete(storageKey);
    }
  }

  private async waitForWrite(storageKey: string): Promise<void> {
    await this.writeChains.get(storageKey)?.catch(() => undefined);
  }

  private filePath(mappingId: string, targetId: string): string {
    return path.join(this.mappingDirectory(mappingId), `${hashId(targetId)}.json`);
  }

  private mappingDirectory(mappingId: string): string {
    return path.join(this.root, hashId(mappingId));
  }
}

export function buildBaseline(mappingId: string, targetId: string, local: SyncSnapshot, remote: SyncSnapshot): SyncBaseline {
  const entries: SyncBaseline['entries'] = {};
  const paths = new Set([...Object.keys(local.entries), ...Object.keys(remote.entries)]);
  for (const relativePath of paths) {
    const entry: BaselineEntry = {
      local: cloneFingerprint(local.entries[relativePath]?.fingerprint),
      remote: cloneFingerprint(remote.entries[relativePath]?.fingerprint)
    };
    const localRelativePath = local.entries[relativePath]?.physicalRelativePath;
    const remoteRelativePath = remote.entries[relativePath]?.physicalRelativePath;
    if (localRelativePath) entry.localRelativePath = normalizeRelativePath(localRelativePath);
    if (remoteRelativePath) entry.remoteRelativePath = normalizeRelativePath(remoteRelativePath);
    entries[relativePath] = entry;
  }
  return { mappingId, targetId, capturedAt: Date.now(), entries };
}

function key(mappingId: string, targetId: string): string {
  return `${mappingId}::${targetId}`;
}

function splitKey(storageKey: string): [string, string] {
  const separator = storageKey.indexOf('::');
  if (separator < 0) throw new Error('Invalid Workspace Sync baseline storage key.');
  return [storageKey.slice(0, separator), storageKey.slice(separator + 2)];
}

function hashId(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function sameContext(left: BaselineContext, right: BaselineContext): boolean {
  return left.localRoot === right.localRoot
    && left.remoteRoot === right.remoteRoot
    && left.connectionId === right.connectionId
    && left.connectionIdentity === right.connectionIdentity;
}

function cloneFingerprint(value?: FileFingerprint): FileFingerprint | undefined {
  return value ? { ...value } : undefined;
}

function cloneBaseline(value: SyncBaseline): SyncBaseline {
  const entries: SyncBaseline['entries'] = {};
  const rawByCanonical = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [rawRelativePath, entry] of Object.entries(value.entries)) {
    const normalizedRaw = normalizeRelativePath(rawRelativePath);
    const relativePath = canonicalRelativePath(normalizedRaw);
    const previousRaw = rawByCanonical.get(relativePath);
    if (previousRaw !== undefined && previousRaw !== normalizedRaw) {
      // Two legacy keys that differ only by Unicode normalization cannot be
      // trusted as one baseline entry. Drop trust for that logical path.
      delete entries[relativePath];
      ambiguous.add(relativePath);
      continue;
    }
    rawByCanonical.set(relativePath, normalizedRaw);
    if (ambiguous.has(relativePath)) continue;
    entries[relativePath] = cloneBaselineEntry(entry);
  }
  return { ...value, entries };
}

function cloneBaselineEntry(entry: BaselineEntry): BaselineEntry {
  const cloned: BaselineEntry = {
    local: cloneFingerprint(entry.local),
    remote: cloneFingerprint(entry.remote)
  };
  if (entry.localRelativePath) cloned.localRelativePath = normalizeRelativePath(entry.localRelativePath);
  if (entry.remoteRelativePath) cloned.remoteRelativePath = normalizeRelativePath(entry.remoteRelativePath);
  return cloned;
}

function normalizeStoredRecord(record: StoredBaselineRecord): StoredBaselineRecord {
  return {
    ...record,
    baseline: record.baseline ? cloneBaseline(record.baseline) : undefined
  };
}
