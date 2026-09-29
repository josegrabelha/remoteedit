import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

interface CaseProbeFs {
  writeFile(filePath: string, data: string, options: { flag: string }): Promise<unknown>;
  lstat(filePath: string): Promise<unknown>;
  rm(filePath: string, options: { force: boolean }): Promise<unknown>;
}

/**
 * Detects the case behavior of the actual mapping volume rather than assuming
 * it from the operating system. If the root is read-only or cannot be probed,
 * the result is unknown so collision protection can fail closed only when it
 * matters. The probe filename is ignored by Workspace Sync watcher rules.
 */
export async function detectLocalCaseSensitivity(
  localRoot: string,
  fileSystem: CaseProbeFs = fs
): Promise<boolean | undefined> {
  const token = crypto.randomUUID().replace(/-/g, '');
  const lowerName = `.remoteedit-case-${token}a.tmp`;
  const upperName = lowerName.toUpperCase();
  const lowerPath = path.join(localRoot, lowerName);
  const upperPath = path.join(localRoot, upperName);

  try {
    await fileSystem.writeFile(lowerPath, '', { flag: 'wx' });
  } catch {
    return undefined;
  }

  try {
    try {
      await fileSystem.lstat(upperPath);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return true;
      return undefined;
    }
  } finally {
    await fileSystem.rm(lowerPath, { force: true }).catch(() => undefined);
    // On a case-sensitive volume an unexpected independently-created uppercase
    // file must never be deleted by the probe, so only remove the path we made.
  }
}
