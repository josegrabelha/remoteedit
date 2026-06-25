import { normalizeRemotePath } from '../ssh/SftpSessionManager';

export interface NormalizedPermissionEntry {
  path: string;
  name: string;
  type: string;
  effectiveType: string;
  permissions: string;
}

export function normalizePermissionEntries(payload: any): NormalizedPermissionEntry[] {
  const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [payload];

  return rawEntries
    .map((entry: any) => ({
      path: normalizeRemotePath(String(entry?.path || '')),
      name: String(entry?.name || '').trim(),
      type: String(entry?.type || ''),
      effectiveType: String(entry?.effectiveType || ''),
      permissions: String(entry?.permissions || '')
    }))
    .filter((entry: { path: string; name: string }) => entry.path && entry.path !== '/' && entry.name !== '..');
}

export function validateOwnerGroupName(value: string, label: string): string {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return '';
  }

  if (!/^[A-Za-z0-9_][A-Za-z0-9._@+-]*$/.test(trimmed)) {
    throw new Error(`${label} can contain letters, numbers, underscore, dot, dash, plus, and at sign, and must not start with a dash.`);
  }

  return trimmed;
}

export function formatOwnerGroupTargetLabel(owner: string, group: string): string {
  if (owner && group) {
    return `${owner}:${group}`;
  }

  return owner || group;
}

export function formatOwnerGroupOperationError(error: unknown, isSudoModeEnabled: boolean): string {
  return formatPermissionLikeOperationError(error, isSudoModeEnabled);
}

export function formatPermissionOperationError(error: unknown, isSudoModeEnabled: boolean): string {
  return formatPermissionLikeOperationError(error, isSudoModeEnabled);
}

function formatPermissionLikeOperationError(error: unknown, isSudoModeEnabled: boolean): string {
  const message = error instanceof Error ? error.message : String(error);

  if (!isSudoModeEnabled && /permission denied|operation not permitted|not owner/i.test(message)) {
    return `${message} Try enabling Sudo Mode.`;
  }

  return message;
}
