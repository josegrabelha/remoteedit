import type * as vscode from 'vscode';
import { createWorkspaceMapping, validateUniqueMappingRoutes, validateUniqueTargetDestinations, type WorkspaceMappingInput } from './WorkspaceMapping';
import type { WorkspaceSyncMapping, WorkspaceSyncTarget } from '../types';

export const WORKSPACE_SYNC_MAPPINGS_KEY = 'remoteedit.workspaceSync.mappings.v1';
export const WORKSPACE_SYNC_ACTIVE_MAPPING_KEY = 'remoteedit.workspaceSync.activeMapping.v1';
export const WORKSPACE_SYNC_ACTIVE_TARGETS_KEY = 'remoteedit.workspaceSync.activeTargets.v1';

export interface WorkspaceSyncBackupState {
  mappings: WorkspaceSyncMapping[];
}

export class WorkspaceMappingStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  list(): WorkspaceSyncMapping[] {
    return readWorkspaceSyncMappings(this.context).map(mapping => createWorkspaceMapping({
      ...mapping,
      id: mapping.id,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
      targets: mapping.targets,
      options: mapping.options
    }));
  }

  get(id: string): WorkspaceSyncMapping | undefined {
    return this.list().find(mapping => mapping.id === id);
  }

  async save(input: WorkspaceMappingInput): Promise<WorkspaceSyncMapping> {
    // Save-time validation only: do not move this into list()/createWorkspaceMapping(),
    // otherwise an older invalid mapping could prevent the extension from activating.
    validateUniqueTargetDestinations(input.targets || []);
    const mappings = this.list();
    const existingIndex = input.id ? mappings.findIndex(mapping => mapping.id === input.id) : -1;
    const existing = existingIndex >= 0 ? mappings[existingIndex] : undefined;
    const mapping = createWorkspaceMapping({
      ...input,
      createdAt: existing?.createdAt || input.createdAt,
      updatedAt: nextTimestamp(existing?.updatedAt)
    });

    // Target identity is stable across edits. Keep its original creation time,
    // preserve updatedAt when nothing changed, and advance updatedAt only when
    // the target configuration itself changes. This gives Workspace Sync a
    // trustworthy per-target revision without coupling it to mapping-level UI
    // saves or Remote Edit runtime state.
    mapping.targets = mapping.targets.map(target => {
      const previous = existing?.targets.find(item => item.id === target.id);
      if (!previous) return target;
      const changed = previous.name !== target.name
        || previous.connectionId !== target.connectionId
        || previous.remoteRoot !== target.remoteRoot
        || previous.enabled !== target.enabled;
      return {
        ...target,
        createdAt: previous.createdAt,
        updatedAt: changed ? nextTimestamp(previous.updatedAt) : previous.updatedAt
      };
    });

    if (mappings.some(item => item.id !== mapping.id && item.name.toLowerCase() === mapping.name.toLowerCase())) {
      throw new Error(`A Workspace Sync mapping named '${mapping.name}' already exists.`);
    }

    validateUniqueMappingRoutes([
      ...mappings.filter(item => item.id !== mapping.id),
      mapping
    ]);

    if (existingIndex >= 0) mappings[existingIndex] = mapping;
    else mappings.push(mapping);

    await this.context.globalState.update(WORKSPACE_SYNC_MAPPINGS_KEY, mappings);
    await this.setActiveId(mapping.id);
    const activeTarget = this.getActiveTargetId(mapping.id);
    const activeTargetEntry = activeTarget ? mapping.targets.find(target => target.id === activeTarget) : undefined;
    if (!activeTargetEntry || (!activeTargetEntry.enabled && mapping.targets.some(target => target.enabled))) {
      await this.setActiveTargetId(mapping.id, mapping.targets.find(target => target.enabled)?.id || activeTargetEntry?.id || mapping.targets[0]?.id);
    }
    return mapping;
  }

  async delete(id: string): Promise<void> {
    const mappings = this.list().filter(mapping => mapping.id !== id);
    await this.context.globalState.update(WORKSPACE_SYNC_MAPPINGS_KEY, mappings);
    const activeTargets = { ...readWorkspaceSyncActiveTargets(this.context) };
    delete activeTargets[id];
    await this.context.globalState.update(WORKSPACE_SYNC_ACTIVE_TARGETS_KEY, activeTargets);
    if (this.getActiveId() === id) await this.setActiveId(mappings[0]?.id);
  }

  getActiveId(): string | undefined {
    return this.context.globalState.get<string>(WORKSPACE_SYNC_ACTIVE_MAPPING_KEY);
  }

  getActive(): WorkspaceSyncMapping | undefined {
    const id = this.getActiveId();
    return (id && this.get(id)) || this.list()[0];
  }

  async setActiveId(id?: string): Promise<void> {
    await this.context.globalState.update(WORKSPACE_SYNC_ACTIVE_MAPPING_KEY, id);
  }

  getActiveTargetId(mappingId: string): string | undefined {
    return readWorkspaceSyncActiveTargets(this.context)[mappingId];
  }

  getActiveTarget(mapping: WorkspaceSyncMapping): WorkspaceSyncTarget | undefined {
    const id = this.getActiveTargetId(mapping.id);
    return mapping.targets.find(target => target.id === id) || mapping.targets.find(target => target.enabled) || mapping.targets[0];
  }

  async setActiveTargetId(mappingId: string, targetId?: string): Promise<void> {
    const all = { ...readWorkspaceSyncActiveTargets(this.context) };
    if (targetId) all[mappingId] = targetId;
    else delete all[mappingId];
    await this.context.globalState.update(WORKSPACE_SYNC_ACTIVE_TARGETS_KEY, all);
  }
}

export function getWorkspaceSyncBackupState(context: vscode.ExtensionContext): WorkspaceSyncBackupState {
  return { mappings: normalizeWorkspaceSyncMappings(readWorkspaceSyncMappings(context)) };
}

export function prepareWorkspaceSyncBackupImport(
  context: vscode.ExtensionContext,
  incoming: WorkspaceSyncBackupState,
  mode: 'merge' | 'replace'
): { mappings: WorkspaceSyncMapping[]; result: { mappingsImported: number; targetsImported: number } } {
  const importedMappings = normalizeWorkspaceSyncMappings(incoming?.mappings);
  for (const mapping of importedMappings) validateUniqueTargetDestinations(mapping.targets);
  let mappings: WorkspaceSyncMapping[];

  if (mode === 'replace') {
    mappings = importedMappings;
  } else {
    mappings = normalizeWorkspaceSyncMappings(readWorkspaceSyncMappings(context));
    const indexById = new Map(mappings.map((mapping, index) => [mapping.id, index]));

    for (const mapping of importedMappings) {
      const sameName = mappings.find(item => item.id !== mapping.id && item.name.toLowerCase() === mapping.name.toLowerCase());
      if (sameName) {
        throw new Error(`Workspace Sync mapping '${mapping.name}' already exists with a different identity.`);
      }
      const existingIndex = indexById.get(mapping.id);
      if (existingIndex === undefined) {
        indexById.set(mapping.id, mappings.length);
        mappings.push(mapping);
      } else {
        mappings[existingIndex] = mapping;
      }
    }

    mappings = normalizeWorkspaceSyncMappings(mappings);
  }

  validateUniqueMappingRoutes(mappings);

  return {
    mappings,
    result: {
      mappingsImported: importedMappings.length,
      targetsImported: importedMappings.reduce((count, mapping) => count + mapping.targets.length, 0)
    }
  };
}

export async function writeWorkspaceSyncMappings(
  context: vscode.ExtensionContext,
  mappings: WorkspaceSyncMapping[]
): Promise<void> {
  const normalized = normalizeWorkspaceSyncMappings(mappings);
  await context.globalState.update(WORKSPACE_SYNC_MAPPINGS_KEY, normalized);

  // Active mapping/target selections are local UI state. Preserve them when
  // still valid, but never import them from a backup.
  const mappingById = new Map(normalized.map(mapping => [mapping.id, mapping]));
  const currentActiveMappingId = context.globalState.get<string>(WORKSPACE_SYNC_ACTIVE_MAPPING_KEY);
  const activeMappingId = currentActiveMappingId && mappingById.has(currentActiveMappingId)
    ? currentActiveMappingId
    : normalized[0]?.id;
  await context.globalState.update(WORKSPACE_SYNC_ACTIVE_MAPPING_KEY, activeMappingId);

  const activeTargetIds: Record<string, string> = {};
  for (const [mappingId, targetId] of Object.entries(readWorkspaceSyncActiveTargets(context))) {
    const mapping = mappingById.get(mappingId);
    if (mapping?.targets.some(target => target.id === targetId)) activeTargetIds[mappingId] = targetId;
  }
  await context.globalState.update(WORKSPACE_SYNC_ACTIVE_TARGETS_KEY, activeTargetIds);
}

function normalizeWorkspaceSyncMappings(value: WorkspaceSyncMapping[] | undefined): WorkspaceSyncMapping[] {
  const mappings = (Array.isArray(value) ? value : []).map(mapping => createWorkspaceMapping({
    ...mapping,
    id: mapping.id,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
    targets: mapping.targets,
    options: mapping.options
  }));

  const ids = new Set<string>();
  const names = new Set<string>();
  for (const mapping of mappings) {
    if (ids.has(mapping.id)) throw new Error(`Duplicate Workspace Sync mapping id '${mapping.id}' in backup.`);
    ids.add(mapping.id);
    const name = mapping.name.toLowerCase();
    if (names.has(name)) throw new Error(`Duplicate Workspace Sync mapping name '${mapping.name}' in backup.`);
    names.add(name);
  }

  return mappings;
}

function readWorkspaceSyncMappings(context: vscode.ExtensionContext): WorkspaceSyncMapping[] {
  const stored = context.globalState.get<WorkspaceSyncMapping[]>(WORKSPACE_SYNC_MAPPINGS_KEY, []);
  return Array.isArray(stored) ? stored : [];
}

function readWorkspaceSyncActiveTargets(context: vscode.ExtensionContext): Record<string, string> {
  return context.globalState.get<Record<string, string>>(WORKSPACE_SYNC_ACTIVE_TARGETS_KEY, {}) || {};
}

function nextTimestamp(previous?: number): number {
  const now = Date.now();
  return previous === undefined ? now : Math.max(now, previous + 1);
}
