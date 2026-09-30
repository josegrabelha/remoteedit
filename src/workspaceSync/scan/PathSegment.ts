/**
 * Workspace Sync stores paths in a protocol-neutral slash-separated namespace.
 * A single filesystem directory entry must therefore remain a single segment
 * after normalization. Backslashes are deliberately rejected even on POSIX
 * (where they may be legal filename characters) because converting them to a
 * Windows/path separator would make the mapped path ambiguous or target the
 * wrong file on another platform.
 */
export function assertSafeSyncPathSegment(name: string, side: 'Local' | 'Remote'): void {
  const value = String(name || '');
  if (!value || value === '.' || value === '..') {
    throw new Error(`Workspace Sync encountered an invalid ${side} path segment.`);
  }
  if (value.includes('\0')) {
    throw new Error(`Workspace Sync cannot represent a ${side} filename containing a NUL character.`);
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`Workspace Sync cannot safely represent ${side} filename '${printable(value)}' because it contains a path separator.`);
  }
}

function printable(value: string): string {
  return value.replace(/[\r\n\t]/g, char => ({ '\r': '\\r', '\n': '\\n', '\t': '\\t' })[char] || char);
}
