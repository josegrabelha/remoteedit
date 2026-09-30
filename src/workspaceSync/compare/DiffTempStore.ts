import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_FILES = 100;

export class WorkspaceSyncDiffTempStore {
  constructor(private readonly root: string) {}

  async allocate(relativePath: string): Promise<string> {
    await fs.mkdir(this.root, { recursive: true });
    await this.prune();
    const base = safeBaseName(relativePath);
    const hash = crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 12);
    return path.join(this.root, `${Date.now()}-${hash}-${base}`);
  }

  async prune(maxAgeMs = DEFAULT_MAX_AGE_MS, maxFiles = DEFAULT_MAX_FILES): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      throw error;
    }

    const now = Date.now();
    const files: Array<{ filePath: string; mtimeMs: number }> = [];
    await Promise.all(names.map(async name => {
      const filePath = path.join(this.root, name);
      try {
        const stat = await fs.lstat(filePath);
        if (!stat.isFile()) return;
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.rm(filePath, { force: true });
          return;
        }
        files.push({ filePath, mtimeMs: stat.mtimeMs });
      } catch {
        // Temp cleanup must never block opening a new diff.
      }
    }));

    if (files.length <= maxFiles) return;
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    await Promise.all(files.slice(maxFiles).map(file => fs.rm(file.filePath, { force: true }).catch(() => undefined)));
  }
}

function safeBaseName(relativePath: string): string {
  const raw = path.posix.basename(String(relativePath || '').replace(/\\/g, '/')) || 'remote-file';
  const cleaned = raw.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+$/, 'file') || 'remote-file';
  // Preserve a short extension so VS Code can still infer the language mode for
  // the downloaded side of a native diff. Leave ample headroom below common
  // 255-byte filename limits for timestamp/hash prefixes and Unicode expansion.
  const extension = path.posix.extname(cleaned).slice(0, 24);
  const stem = extension ? cleaned.slice(0, -extension.length) : cleaned;
  const maxLength = 96;
  const truncatedStem = stem.slice(0, Math.max(1, maxLength - extension.length));
  return `${truncatedStem}${extension}`;
}
