import * as path from 'path';
import * as crypto from 'crypto';
import type { WorkspaceSyncMapping, WorkspaceSyncOptions, WorkspaceSyncTarget } from '../types';

export const DEFAULT_WORKSPACE_SYNC_OPTIONS: WorkspaceSyncOptions = {
  direction: 'bidirectional',
  uploadOnSave: false,
  watchLocalChanges: false,
  watchRemoteChanges: false,
  conflictProtection: true,
  atomicTransfer: true,
  propagateDeletes: false,
  ignorePatterns: ['.git/', 'node_modules/']
};

export interface WorkspaceSyncTargetInput {
  id?: string;
  name?: string;
  connectionId: string;
  remoteRoot: string;
  enabled?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface WorkspaceMappingInput {
  id?: string;
  name: string;
  localRoot: string;
  targets: WorkspaceSyncTargetInput[];
  options?: Partial<WorkspaceSyncOptions>;
  createdAt?: number;
  updatedAt?: number;
}

export function createWorkspaceMapping(input: WorkspaceMappingInput): WorkspaceSyncMapping {
  const name = String(input.name || '').trim();
  const localRoot = normalizeLocalRoot(input.localRoot);
  const targets = normalizeTargets(input.targets || []);

  if (!name) throw new Error('Mapping name is required.');
  if (!localRoot) throw new Error('Local root is required.');
  if (!targets.length) throw new Error('At least one Workspace Sync target is required.');

  const now = Date.now();
  return {
    id: input.id || `ws-${crypto.randomUUID()}`,
    name,
    localRoot,
    targets,
    options: normalizeWorkspaceSyncOptions(input.options),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

export function createWorkspaceSyncTarget(input: WorkspaceSyncTargetInput): WorkspaceSyncTarget {
  const connectionId = String(input.connectionId || '').trim();
  const remoteRoot = normalizeRemoteRoot(input.remoteRoot);
  const name = String(input.name || '').trim() || 'Target';
  if (!connectionId) throw new Error(`Connection is required for target '${name}'.`);
  if (!remoteRoot) throw new Error(`Remote root is required for target '${name}'.`);
  if (!isAbsoluteRemoteRoot(remoteRoot)) {
    throw new Error(`Remote root for target '${name}' must be absolute (for example /var/www/app or C:/app).`);
  }
  const now = Date.now();
  return {
    id: input.id || `target-${crypto.randomUUID()}`,
    name,
    connectionId,
    remoteRoot,
    enabled: input.enabled !== false,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

export function normalizeWorkspaceSyncOptions(options?: Partial<WorkspaceSyncOptions>): WorkspaceSyncOptions {
  const direction = options?.direction === 'localToRemote' || options?.direction === 'remoteToLocal'
    ? options.direction
    : 'bidirectional';
  return {
    ...DEFAULT_WORKSPACE_SYNC_OPTIONS,
    ...options,
    direction,
    uploadOnSave: direction === 'remoteToLocal' ? false : Boolean(options?.uploadOnSave),
    watchLocalChanges: direction === 'remoteToLocal' ? false : Boolean(options?.watchLocalChanges),
    watchRemoteChanges: direction === 'localToRemote' ? false : Boolean(options?.watchRemoteChanges),
    ignorePatterns: normalizeIgnorePatterns(options?.ignorePatterns ?? DEFAULT_WORKSPACE_SYNC_OPTIONS.ignorePatterns)
  };
}

export function normalizeLocalRoot(value: string): string {
  const raw = String(value || '').trim();
  return raw ? path.resolve(raw) : '';
}

export function normalizeRemoteRoot(value: string): string {
  let normalized = String(value || '').trim().replace(/\\/g, '/');
  if (!normalized) return '';
  normalized = normalized.replace(/\/{2,}/g, '/');
  if (/^\/?[A-Za-z]:\/$/.test(normalized)) return normalized;
  if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.replace(/\/+$/, '');
  return normalized || '/';
}

export function isAbsoluteRemoteRoot(value: string): boolean {
  const normalized = normalizeRemoteRoot(value);
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
}

/**
 * Rejects two targets in the same mapping that resolve to the same remote
 * destination. This is intentionally NOT called while loading persisted
 * mappings so a legacy/problematic mapping can still open and be repaired.
 * Mutation paths (Save/import) must call this validator explicitly.
 */
export function validateUniqueTargetDestinations(inputs: WorkspaceSyncTargetInput[]): void {
  const destinations = new Map<string, string>();
  for (const input of inputs || []) {
    const connectionId = String(input.connectionId || '').trim();
    const remoteRoot = normalizeRemoteRoot(input.remoteRoot);
    if (!connectionId || !remoteRoot) continue;

    const name = String(input.name || '').trim() || 'Target';
    const key = `${connectionId}\u0000${remoteRoot}`;
    const existingName = destinations.get(key);
    if (existingName) {
      throw new Error(`Target '${name}' uses the same Connection and Remote Directory as '${existingName}'. Each target in a Workspace Sync mapping must use a unique remote destination.`);
    }
    destinations.set(key, name);
  }
}

/**
 * Rejects the same complete synchronization route being owned by different
 * mappings. A route is Local Root + Connection + Remote Directory. Loading
 * persisted mappings remains permissive; mutation/import paths call this
 * validator so legacy duplicates can still be opened and repaired.
 */
export function validateUniqueMappingRoutes(inputs: Array<{
  id?: string;
  name?: string;
  localRoot: string;
  targets: WorkspaceSyncTargetInput[];
}>): void {
  const routes = new Map<string, { mappingKey: string; mappingName: string; targetName: string }>();

  for (const [mappingIndex, input] of (inputs || []).entries()) {
    const localRoot = normalizeLocalRoot(input.localRoot);
    if (!localRoot) continue;
    const mappingKey = String(input.id || `new-${mappingIndex}`);
    const mappingName = String(input.name || '').trim() || 'Mapping';

    for (const target of input.targets || []) {
      const connectionId = String(target.connectionId || '').trim();
      const remoteRoot = normalizeRemoteRoot(target.remoteRoot);
      if (!connectionId || !remoteRoot) continue;

      const targetName = String(target.name || '').trim() || 'Target';
      const key = `${localRoot}\u0000${connectionId}\u0000${remoteRoot}`;
      const existing = routes.get(key);
      if (existing && existing.mappingKey !== mappingKey) {
        throw new Error(
          `Workspace Sync route '${mappingName} / ${targetName}' duplicates '${existing.mappingName} / ${existing.targetName}' `
          + '(same Local Root, Connection, and Remote Directory). Each Workspace Sync route must be unique across mappings.'
        );
      }
      if (!existing) routes.set(key, { mappingKey, mappingName, targetName });
    }
  }
}

function normalizeTargets(inputs: WorkspaceSyncTargetInput[]): WorkspaceSyncTarget[] {
  const result = inputs.map(createWorkspaceSyncTarget);
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const target of result) {
    const nameKey = target.name.toLowerCase();
    if (names.has(nameKey)) throw new Error(`Duplicate Workspace Sync target name: '${target.name}'.`);
    names.add(nameKey);

    if (ids.has(target.id)) throw new Error(`Duplicate Workspace Sync target id '${target.id}'.`);
    ids.add(target.id);

  }
  return result;
}

function normalizeIgnorePatterns(patterns: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of patterns || []) {
    const pattern = String(value || '').trim().replace(/\\/g, '/');
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);
    result.push(pattern);
  }
  return result;
}
