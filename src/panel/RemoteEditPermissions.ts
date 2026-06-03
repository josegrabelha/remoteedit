export type PermissionKey =
  | 'ownerRead'
  | 'ownerWrite'
  | 'ownerExecute'
  | 'groupRead'
  | 'groupWrite'
  | 'groupExecute'
  | 'othersRead'
  | 'othersWrite'
  | 'othersExecute'
  | 'setuid'
  | 'setgid'
  | 'sticky';

export type PermissionState = Record<PermissionKey, boolean>;

export interface SetPermissionsPanelOptions {
  entryName: string;
  entryType: string;
  remotePath: string;
  currentPermissions: string;
  isDirectory: boolean;
  initialMode: string;
  permissionState: PermissionState;
  selectedCount?: number;
  hasFile?: boolean;
  hasDirectory?: boolean;
  isMixed?: boolean;
}

export interface SetPermissionsDialogResult {
  mode: string;
  recursive: boolean;
}

export function parsePermissionString(permissionString: string, isDirectory: boolean): PermissionState {
  const defaults = defaultPermissionChars(isDirectory);
  const normalized = String(permissionString || '').trim();
  const chars = normalized.length >= 10 ? normalized.slice(1, 10).split('') : defaults;

  return {
    ownerRead: chars[0] === 'r',
    ownerWrite: chars[1] === 'w',
    ownerExecute: chars[2] === 'x' || chars[2] === 's' || chars[2] === 'S',
    groupRead: chars[3] === 'r',
    groupWrite: chars[4] === 'w',
    groupExecute: chars[5] === 'x' || chars[5] === 's' || chars[5] === 'S',
    othersRead: chars[6] === 'r',
    othersWrite: chars[7] === 'w',
    othersExecute: chars[8] === 'x' || chars[8] === 't' || chars[8] === 'T',
    setuid: chars[2] === 's' || chars[2] === 'S',
    setgid: chars[5] === 's' || chars[5] === 'S',
    sticky: chars[8] === 't' || chars[8] === 'T'
  };
}

export function calculateModeFromPermissionState(state: PermissionState): string {
  const keys = (Object.keys(state) as PermissionKey[]).filter(key => state[key]);
  return calculateModeFromPermissionKeys(keys);
}

function defaultPermissionChars(isDirectory: boolean): string[] {
  return isDirectory
    ? ['r', 'w', 'x', 'r', '-', 'x', 'r', '-', 'x']
    : ['r', 'w', '-', 'r', '-', '-', 'r', '-', '-'];
}

function calculateModeFromPermissionKeys(keys: PermissionKey[]): string {
  const selected = new Set(keys);
  const special = (selected.has('setuid') ? 4 : 0) + (selected.has('setgid') ? 2 : 0) + (selected.has('sticky') ? 1 : 0);
  const owner = permissionDigitFromKeys(selected, 'ownerRead', 'ownerWrite', 'ownerExecute');
  const group = permissionDigitFromKeys(selected, 'groupRead', 'groupWrite', 'groupExecute');
  const others = permissionDigitFromKeys(selected, 'othersRead', 'othersWrite', 'othersExecute');

  return `${special}${owner}${group}${others}`;
}

function permissionDigitFromKeys(selected: Set<PermissionKey>, read: PermissionKey, write: PermissionKey, execute: PermissionKey): number {
  return (selected.has(read) ? 4 : 0) + (selected.has(write) ? 2 : 0) + (selected.has(execute) ? 1 : 0);
}
