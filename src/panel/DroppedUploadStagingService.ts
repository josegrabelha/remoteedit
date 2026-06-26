import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import type { LocalUploadEntry } from './PanelTypes';

export interface DroppedUploadStagingManifestItem {
  kind?: string;
  relativePath?: string;
  name?: string;
  size?: number;
}

export interface BeginDroppedUploadStagingOptions {
  sessionId: string;
  connectionId: string;
  targetDirectory: string;
  source?: 'webview' | 'sidebar';
  items: readonly DroppedUploadStagingManifestItem[];
}

export interface DroppedUploadStagingChunk {
  sessionId: string;
  relativePath: string;
  chunkIndex: number;
  data: string;
}

export interface DroppedUploadStagingTransfer {
  sessionId: string;
  connectionId: string;
  targetDirectory: string;
  source?: 'webview' | 'sidebar';
  rootDirectory: string;
  entries: LocalUploadEntry[];
}


interface StagedFileState {
  size: number;
  bytesWritten: number;
  localPath: string;
  nextChunkIndex: number;
}

interface PendingDroppedUploadStagingSession {
  sessionId: string;
  connectionId: string;
  targetDirectory: string;
  source?: 'webview' | 'sidebar';
  rootDirectory: string;
  entries: LocalUploadEntry[];
  files: Map<string, StagedFileState>;
}

export class DroppedUploadStagingService {
  private readonly sessions = new Map<string, PendingDroppedUploadStagingSession>();

  constructor(private readonly stagingRoot: string) {}

  async begin(options: BeginDroppedUploadStagingOptions): Promise<void> {
    const sessionId = this.normalizeSessionId(options.sessionId);

    if (this.sessions.has(sessionId)) {
      await this.cancel(sessionId);
    }

    const rootDirectory = path.join(this.stagingRoot, `${Date.now()}-${sessionId}`);
    const rootDirectoryResolved = path.resolve(rootDirectory);
    const entries: LocalUploadEntry[] = [];
    const files = new Map<string, StagedFileState>();
    const seen = new Set<string>();

    await fs.mkdir(rootDirectoryResolved, { recursive: true });

    try {
      for (const item of Array.isArray(options.items) ? options.items : []) {
        const kind: LocalUploadEntry['kind'] = String(item?.kind || '').toLowerCase() === 'directory' ? 'directory' : 'file';
        const relativePath = normalizeDroppedUploadRelativePath(item?.relativePath || item?.name || '');

        if (!relativePath) {
          continue;
        }

        const key = `${kind}:${relativePath}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        const localPath = this.resolveStagedPath(rootDirectoryResolved, relativePath);
        const size = normalizeSize(item?.size);

        if (kind === 'directory') {
          await fs.mkdir(localPath, { recursive: true });
          entries.push({ kind, localPath, relativePath, size: 0 });
          continue;
        }

        await fs.mkdir(path.dirname(localPath), { recursive: true });
        await fs.writeFile(localPath, '');
        files.set(relativePath, { size, bytesWritten: 0, localPath, nextChunkIndex: 0 });
        entries.push({ kind: 'file', localPath, relativePath, size });
      }

      if (!entries.length) {
        throw new Error('Drop files or folders from the local file system to upload.');
      }

      this.sessions.set(sessionId, {
        sessionId,
        connectionId: options.connectionId,
        targetDirectory: options.targetDirectory,
        source: options.source,
        rootDirectory: rootDirectoryResolved,
        entries,
        files
      });
    } catch (error) {
      await removeDirectory(rootDirectoryResolved);
      throw error;
    }
  }

  async writeChunk(chunk: DroppedUploadStagingChunk): Promise<void> {
    const sessionId = this.normalizeSessionId(chunk.sessionId);
    const session = this.requireSession(sessionId);
    const relativePath = normalizeDroppedUploadRelativePath(chunk.relativePath);
    const file = session.files.get(relativePath);

    if (!file) {
      throw new Error('Dropped upload file is no longer pending.');
    }

    const chunkIndex = Number(chunk.chunkIndex || 0);

    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw new Error('Dropped upload chunk index is invalid.');
    }

    if (chunkIndex !== file.nextChunkIndex) {
      throw new Error('Dropped upload chunk order is invalid.');
    }

    const buffer = Buffer.from(String(chunk.data || ''), 'base64');
    await fs.appendFile(file.localPath, buffer);
    file.bytesWritten += buffer.byteLength;
    file.nextChunkIndex += 1;

    if (file.size > 0 && file.bytesWritten > file.size) {
      throw new Error('Dropped upload file received more data than expected.');
    }
  }


  async finish(sessionIdValue: string): Promise<DroppedUploadStagingTransfer> {
    const sessionId = this.normalizeSessionId(sessionIdValue);
    const session = this.requireSession(sessionId);

    for (const [relativePath, file] of session.files) {
      if (file.bytesWritten !== file.size) {
        throw new Error(`Dropped upload file is incomplete: ${relativePath}`);
      }
    }

    this.sessions.delete(sessionId);
    return {
      sessionId: session.sessionId,
      connectionId: session.connectionId,
      targetDirectory: session.targetDirectory,
      source: session.source,
      rootDirectory: session.rootDirectory,
      entries: session.entries
    };
  }

  async cancel(sessionIdValue: string): Promise<void> {
    const sessionId = this.normalizeSessionId(sessionIdValue);
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    this.sessions.delete(sessionId);
    await removeDirectory(session.rootDirectory);
  }

  async cleanupRoot(rootDirectory: string): Promise<void> {
    const resolved = path.resolve(String(rootDirectory || ''));

    if (!resolved || !isPathInside(path.resolve(this.stagingRoot), resolved)) {
      return;
    }

    await removeDirectory(resolved);
  }

  cancelAll(): void {
    const sessions = Array.from(this.sessions.values());
    this.sessions.clear();

    for (const session of sessions) {
      void removeDirectory(session.rootDirectory);
    }
  }

  private requireSession(sessionId: string): PendingDroppedUploadStagingSession {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error('Dropped upload session is no longer available.');
    }

    return session;
  }

  private normalizeSessionId(value: string): string {
    const sessionId = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');

    if (!sessionId) {
      throw new Error('Dropped upload session id is missing.');
    }

    return sessionId.slice(0, 80);
  }

  private resolveStagedPath(rootDirectory: string, relativePath: string): string {
    const resolvedRoot = path.resolve(rootDirectory);
    const resolvedPath = path.resolve(resolvedRoot, ...relativePath.split('/'));

    if (!isPathInside(resolvedRoot, resolvedPath)) {
      throw new Error('Dropped item path is outside the staging directory.');
    }

    return resolvedPath;
  }
}


export async function cleanupDroppedUploadStagingRoot(stagingRoot: string): Promise<number> {
  const resolvedRoot = path.resolve(String(stagingRoot || ''));

  if (!resolvedRoot || path.basename(resolvedRoot) !== 'dropped-uploads') {
    return 0;
  }

  let children: Dirent[];

  try {
    children = await fs.readdir(resolvedRoot, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return 0;
    }

    throw error;
  }

  let removed = 0;

  for (const child of children) {
    const childPath = path.resolve(resolvedRoot, child.name);

    if (!isPathInside(resolvedRoot, childPath) || childPath === resolvedRoot) {
      continue;
    }

    await removeDirectory(childPath);
    removed += 1;
  }

  return removed;
}

export function normalizeDroppedUploadRelativePath(value: any): string {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').map(part => part.trim()).filter(part => part && part !== '.');

  if (parts.some(part => part === '..')) {
    throw new Error('Dropped item paths must not contain parent directory segments.');
  }

  return parts.join('/');
}

function normalizeSize(value: any): number {
  const size = Number(value || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function removeDirectory(directory: string): Promise<void> {
  if (!directory) {
    return;
  }

  await fs.rm(directory, { recursive: true, force: true });
}
