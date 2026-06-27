import type { RemoteSessionManager, RemoteStat } from './RemoteSessionManager';
import type { RemoteClipboardItem } from './RemoteClipboardService';
import { dirnameRemotePath, joinRemotePath, normalizeRemotePath } from '../ssh/SftpSessionManager';

export interface RemoteMoveRequest {
  readonly connectionId: string;
  readonly targetDirectory: string;
  readonly items: readonly RemoteClipboardItem[];
}

export interface RemoteMoveResult {
  readonly moved: number;
  readonly targetDirectory: string;
  readonly sourceDirectories: readonly string[];
}

function isAncestorOrSelf(ancestorPath: string, targetPath: string): boolean {
  const ancestor = normalizeRemotePath(ancestorPath || '/');
  const target = normalizeRemotePath(targetPath || '/');
  return ancestor === target || target.startsWith(`${ancestor}/`);
}

function describeItem(item: RemoteClipboardItem): string {
  return item.type === 'directory' ? 'folder' : item.type === 'file' ? 'file' : 'item';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || String(error);
  }
  return String(error || 'Unknown error');
}

function sanitizeRemoteRenameReason(error: unknown): string {
  let text = getErrorMessage(error)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^at\s+/i.test(line))[0] || '';

  text = text
    .replace(/^(?:error|typeerror|rangeerror|referenceerror):\s*/i, '')
    .replace(/^_?rename:\s*/i, '')
    .replace(/^remote\s+rename:\s*/i, '')
    .replace(/\s+From:\s+[\s\S]*$/i, '')
    .replace(/\s+To:\s+[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text || 'Remote rename failed.';
}

function formatRemoteMoveFailure(error: unknown, sourcePath: string, targetPath: string): string {
  const reason = sanitizeRemoteRenameReason(error);
  return `Move failed: ${reason.endsWith('.') ? reason : `${reason}.`}\nFrom: ${sourcePath}\nTo: ${targetPath}`;
}

export class RemoteMoveService {
  constructor(private readonly sessions: RemoteSessionManager) {}

  async moveItems(request: RemoteMoveRequest): Promise<RemoteMoveResult> {
    const connectionId = String(request.connectionId || '');
    const targetDirectory = normalizeRemotePath(request.targetDirectory || '/');
    const items = Array.isArray(request.items) ? request.items : [];

    if (!connectionId || !this.sessions.hasConnection(connectionId)) {
      throw new Error('The selected Remote Edit connection is not connected.');
    }

    if (!items.length) {
      throw new Error('Nothing has been cut in Remote Edit.');
    }

    await this.ensureTargetDirectory(connectionId, targetDirectory);

    const sourceDirectories = new Set<string>();
    const plannedMoves: Array<{ item: RemoteClipboardItem; sourcePath: string; targetPath: string; sourceParent: string }> = [];

    for (const item of items) {
      const sourcePath = normalizeRemotePath(item.path || '');
      const name = String(item.name || sourcePath.split('/').filter(Boolean).pop() || '').trim();

      if (!sourcePath || sourcePath === '/' || !name || name === '..') {
        throw new Error('Remote root and parent directory entries cannot be moved.');
      }

      const sourceParent = dirnameRemotePath(sourcePath);
      const targetPath = joinRemotePath(targetDirectory, name);

      if (sourceParent === targetDirectory) {
        throw new Error(`'${name}' is already in the selected destination.`);
      }

      if (sourcePath === targetPath) {
        throw new Error(`'${name}' is already in the selected destination.`);
      }

      if (item.type === 'directory' && isAncestorOrSelf(sourcePath, targetDirectory)) {
        throw new Error(`Cannot move folder '${name}' into itself or one of its subfolders.`);
      }

      const existingTarget = await this.tryStat(connectionId, targetPath);
      if (existingTarget) {
        throw new Error(`A remote ${existingTarget.type} named '${name}' already exists in the destination.`);
      }

      plannedMoves.push({ item, sourcePath, targetPath, sourceParent });
      sourceDirectories.add(sourceParent);
    }

    for (const move of plannedMoves) {
      try {
        await this.sessions.rename(connectionId, move.sourcePath, move.targetPath);
      } catch (error) {
        throw new Error(formatRemoteMoveFailure(error, move.sourcePath, move.targetPath));
      }
    }

    return {
      moved: plannedMoves.length,
      targetDirectory,
      sourceDirectories: Array.from(sourceDirectories)
    };
  }

  private async ensureTargetDirectory(connectionId: string, targetDirectory: string): Promise<void> {
    const stats = await this.tryStat(connectionId, targetDirectory);
    if (!stats) {
      throw new Error(`Destination folder does not exist: ${targetDirectory}`);
    }
    if (stats.type !== 'directory') {
      throw new Error(`Paste destination must be a remote folder: ${targetDirectory}`);
    }
  }

  private async tryStat(connectionId: string, remotePath: string): Promise<RemoteStat | undefined> {
    try {
      return await this.sessions.stat(connectionId, remotePath);
    } catch {
      return undefined;
    }
  }
}
