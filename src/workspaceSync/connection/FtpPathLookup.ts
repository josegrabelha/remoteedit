export interface NamedRemoteEntry {
  name: string;
}

/**
 * Splits an FTP-style absolute path without losing Windows drive roots. FTP
 * servers vary widely in their path syntax, so Workspace Sync keeps the
 * caller's slash-based representation instead of passing it through Node's
 * host-platform path utilities.
 */
export function splitFtpLookupPath(remotePath: string): { parent: string; name: string } {
  let normalized = String(remotePath || '/').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (!normalized) normalized = '/';
  if (normalized === '/' || /^\/?[A-Za-z]:\/$/.test(normalized)) {
    return { parent: normalized, name: '' };
  }
  normalized = normalized.replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  if (index < 0) return { parent: '/', name: normalized };
  const name = normalized.slice(index + 1);
  if (index === 0) return { parent: '/', name };
  let parent = normalized.slice(0, index);
  if (/^\/?[A-Za-z]:$/.test(parent)) parent += '/';
  return { parent: parent || '/', name };
}

/**
 * Prefer an exact spelling even on a case-insensitive server. Only fall back
 * to case-insensitive matching when the server has positively identified
 * itself that way, and fail closed if the listing is ambiguous.
 */
export function findFtpEntryByName<T extends NamedRemoteEntry>(
  entries: readonly T[],
  name: string,
  caseSensitive?: boolean
): T | undefined {
  const exact = entries.find(entry => entry.name === name);
  if (exact || caseSensitive !== false) return exact;
  const expected = name.toLocaleLowerCase('en-US');
  const matches = entries.filter(entry => entry.name.toLocaleLowerCase('en-US') === expected);
  return matches.length === 1 ? matches[0] : undefined;
}
