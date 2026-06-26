export type PermissionDisplayMode = 'symbolic' | 'numeric' | 'both';

const VALID_PERMISSION_DISPLAY_MODES = new Set<PermissionDisplayMode>(['symbolic', 'numeric', 'both']);

export function normalizePermissionDisplayMode(value: unknown, fallback: PermissionDisplayMode = 'symbolic'): PermissionDisplayMode {
  const mode = String(value || '').trim() as PermissionDisplayMode;
  return VALID_PERMISSION_DISPLAY_MODES.has(mode) ? mode : fallback;
}

export function permissionModeFromString(permissions: unknown): string | undefined {
  const text = String(permissions || '').trim();

  if (!text) {
    return undefined;
  }

  if (/^[0-7]{3,4}$/.test(text)) {
    return text.padStart(4, '0');
  }

  return permissionModeFromSymbolic(text);
}

export function formatPermissionsForDisplay(permissions: unknown, mode: PermissionDisplayMode = 'symbolic'): string {
  const text = String(permissions || '').trim();

  if (!text) {
    return '';
  }

  const octal = permissionModeFromString(text);

  if (!octal) {
    return text;
  }

  const isNumericText = /^[0-7]{3,4}$/.test(text);

  switch (normalizePermissionDisplayMode(mode)) {
    case 'numeric':
      return octal;
    case 'both':
      return isNumericText ? octal : `${text} (${octal})`;
    case 'symbolic':
    default:
      return text;
  }
}

export function formatPermissionsPropertyValue(permissions: unknown): string {
  const text = String(permissions || '').trim();

  if (!text) {
    return '—';
  }

  const octal = permissionModeFromString(text);
  if (!octal) {
    return text;
  }

  return /^[0-7]{3,4}$/.test(text) ? octal : `${text} (${octal})`;
}

function permissionModeFromSymbolic(permissions: string): string | undefined {
  const text = String(permissions || '').trim();

  if (!/^[bcdlps-][rwxStTs-]{9}/.test(text)) {
    return undefined;
  }

  const chars = text.slice(1, 10);
  let mode = 0;

  if (chars[0] === 'r') mode |= 0o400;
  if (chars[1] === 'w') mode |= 0o200;
  if (chars[2] === 'x' || chars[2] === 's') mode |= 0o100;
  if (chars[2] === 's' || chars[2] === 'S') mode |= 0o4000;

  if (chars[3] === 'r') mode |= 0o040;
  if (chars[4] === 'w') mode |= 0o020;
  if (chars[5] === 'x' || chars[5] === 's') mode |= 0o010;
  if (chars[5] === 's' || chars[5] === 'S') mode |= 0o2000;

  if (chars[6] === 'r') mode |= 0o004;
  if (chars[7] === 'w') mode |= 0o002;
  if (chars[8] === 'x' || chars[8] === 't') mode |= 0o001;
  if (chars[8] === 't' || chars[8] === 'T') mode |= 0o1000;

  return (mode & 0o7777).toString(8).padStart(4, '0');
}
