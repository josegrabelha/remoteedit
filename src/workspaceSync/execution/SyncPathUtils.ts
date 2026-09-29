import * as path from 'path';
import { safeLocalPath } from '../scan/LocalScanner';
import { joinRemotePath } from '../scan/RemoteScanner';
import type { WorkspaceSyncMapping, WorkspaceSyncTarget } from '../types';

export interface SyncSideRelativePaths {
  localRelativePath?: string;
  remoteRelativePath?: string;
}

export function resolveSyncPaths(
  mapping: WorkspaceSyncMapping,
  target: WorkspaceSyncTarget,
  relativePath: string,
  sidePaths: SyncSideRelativePaths = {}
): { localPath: string; remotePath: string; localRelativePath: string; remoteRelativePath: string } {
  const localRelativePath = sidePaths.localRelativePath || relativePath;
  const remoteRelativePath = sidePaths.remoteRelativePath || relativePath;
  return {
    localPath: safeLocalPath(mapping.localRoot, localRelativePath),
    remotePath: joinRemotePath(target.remoteRoot, remoteRelativePath),
    localRelativePath,
    remoteRelativePath
  };
}

export function localParentDirectory(filePath: string): string {
  return path.dirname(filePath);
}

export function remoteParentDirectory(remotePath: string): string {
  const normalized = String(remotePath || '/').replace(/\\/g, '/');
  if (/^[A-Za-z]:\/$/.test(normalized) || /^\/[A-Za-z]:\/$/.test(normalized)) return normalized;
  const index = normalized.lastIndexOf('/');
  if (index < 0) return '/';
  if (index === 0) return '/';
  const parent = normalized.slice(0, index);
  if (/^[A-Za-z]:$/.test(parent) || /^\/[A-Za-z]:$/.test(parent)) return `${parent}/`;
  return parent || '/';
}
