export type WorkspaceSyncFilenameStyle = 'posix' | 'windows' | 'unknown';

/**
 * Validates one neutral slash-separated Workspace Sync relative path against
 * destination filesystem filename rules. The neutral namespace itself has
 * already rejected slash/backslash ambiguity before this point.
 */
export function validateRelativePathForDestination(
  relativePath: string,
  style: WorkspaceSyncFilenameStyle
): string | undefined {
  if (style !== 'windows') return undefined;

  const segments = String(relativePath || '').split('/').filter(Boolean);
  for (const segment of segments) {
    const reason = validateWindowsSegment(segment);
    if (reason) return `${reason} ('${segment}')`;
  }
  return undefined;
}

export function localFilenameStyle(platform: NodeJS.Platform = process.platform): WorkspaceSyncFilenameStyle {
  return platform === 'win32' ? 'windows' : 'posix';
}

function validateWindowsSegment(segment: string): string | undefined {
  // Win32 names cannot contain ASCII control characters or these reserved
  // punctuation characters. ':' is allowed in the mapping root drive prefix,
  // but never inside a relative path segment.
  if (/[<>:"|?*]/.test(segment) || /[\x00-\x1F]/.test(segment)) {
    return 'The path contains a filename that is not valid on Windows';
  }
  if (/[. ]$/.test(segment)) {
    return 'Windows filenames cannot end with a space or period';
  }

  const base = segment.split('.')[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) {
    return 'The path uses a reserved Windows device name';
  }
  return undefined;
}
