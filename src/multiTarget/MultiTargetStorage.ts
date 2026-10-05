export const MULTI_TARGET_SAVED_COMMANDS_STORAGE_KEY = 'remoteedit.multiTargetCommands.savedCommands';
export const MULTI_TARGET_TARGET_SETS_STORAGE_KEY = 'remoteedit.multiTarget.targetSets';

export interface SavedMultiTargetCommand {
  id: string;
  title: string;
  command: string;
}

export interface SavedMultiTargetTarget {
  connectionId: string;
  workingDirectory: string;
}

export interface SavedMultiTargetSet {
  id: string;
  title: string;
  targets: SavedMultiTargetTarget[];
}

export interface MultiTargetBackupState {
  savedCommands?: SavedMultiTargetCommand[];
  targetSets?: SavedMultiTargetSet[];
}

export function normalizeSavedMultiTargetCommands(value: unknown): SavedMultiTargetCommand[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: SavedMultiTargetCommand[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof (item as any).id === 'string' ? (item as any).id.trim() : '';
    const title = typeof (item as any).title === 'string' ? (item as any).title.trim() : '';
    const command = typeof (item as any).command === 'string' ? (item as any).command : '';
    if (!id || !title || !command.trim() || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, title, command });
  }
  return result;
}

export function normalizeSavedMultiTargetSets(value: unknown): SavedMultiTargetSet[] {
  if (!Array.isArray(value)) return [];
  const seenSets = new Set<string>();
  const result: SavedMultiTargetSet[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof (item as any).id === 'string' ? (item as any).id.trim() : '';
    const title = typeof (item as any).title === 'string' ? (item as any).title.trim() : '';
    if (!id || !title || seenSets.has(id) || !Array.isArray((item as any).targets)) continue;
    const seenTargets = new Set<string>();
    const targets: SavedMultiTargetTarget[] = [];
    for (const target of (item as any).targets) {
      if (!target || typeof target !== 'object') continue;
      const connectionId = typeof target.connectionId === 'string' ? target.connectionId.trim() : '';
      if (!connectionId || seenTargets.has(connectionId)) continue;
      seenTargets.add(connectionId);
      const workingDirectory = typeof target.workingDirectory === 'string' ? target.workingDirectory : '';
      targets.push({ connectionId, workingDirectory });
    }
    if (!targets.length) continue;
    seenSets.add(id);
    result.push({ id, title, targets });
  }
  return result;
}

export function mergeSavedMultiTargetItems<T extends { id: string; title: string }>(existing: T[], incoming: T[]): T[] {
  const result = existing.map(item => ({ ...item } as T));
  for (const incomingItem of incoming) {
    const idIndex = result.findIndex(item => item.id === incomingItem.id);
    if (idIndex >= 0) {
      result[idIndex] = incomingItem;
      continue;
    }
    const titleIndex = result.findIndex(item => item.title.localeCompare(incomingItem.title, undefined, { sensitivity: 'accent' }) === 0);
    if (titleIndex >= 0) result[titleIndex] = incomingItem;
    else result.push(incomingItem);
  }
  return result;
}

interface TargetSetState {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}
const targetSetWrites = new WeakMap<object, Promise<void>>();
/** Commands, Search, and Restore serialize read/modify/write against the same collection. */
export function updateSharedTargetSets(state: TargetSetState,
  update: (current: SavedMultiTargetSet[]) => SavedMultiTargetSet[]): Promise<void> {
  const pending = (targetSetWrites.get(state) || Promise.resolve()).then(async () => {
    const current = normalizeSavedMultiTargetSets(state.get<unknown>(MULTI_TARGET_TARGET_SETS_STORAGE_KEY, []));
    await state.update(MULTI_TARGET_TARGET_SETS_STORAGE_KEY, normalizeSavedMultiTargetSets(update(current)));
  });
  targetSetWrites.set(state, pending.catch(() => undefined));
  return pending;
}
