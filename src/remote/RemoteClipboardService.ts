import * as vscode from 'vscode';
import type { ActiveConnection } from './RemoteSessionManager';
import type { RemoteConnectionType } from './RemoteConnectionTypes';
import { dirnameRemotePath, normalizeRemotePath } from '../ssh/SftpSessionManager';

export type RemoteClipboardOperation = 'cut';
export type RemoteClipboardItemType = 'file' | 'directory' | 'link' | 'unknown';

export interface RemoteClipboardItem {
  readonly name: string;
  readonly path: string;
  readonly type: RemoteClipboardItemType;
}

export interface RemoteClipboardState {
  readonly operation: RemoteClipboardOperation;
  readonly connectionId: string;
  readonly protocol: RemoteConnectionType;
  readonly connectionLabel: string;
  readonly items: readonly RemoteClipboardItem[];
  readonly createdAt: number;
}

export interface RemoteClipboardSnapshot {
  readonly hasItems: boolean;
  readonly operation?: RemoteClipboardOperation;
  readonly connectionId?: string;
  readonly protocol?: RemoteConnectionType;
  readonly connectionLabel?: string;
  readonly itemCount: number;
  readonly itemNames: readonly string[];
  readonly sourceItems: readonly RemoteClipboardItem[];
  readonly sourceParentDirectories: readonly string[];
  readonly canPaste: boolean;
}

function normalizeItemType(value: unknown): RemoteClipboardItemType {
  const text = String(value || '').toLowerCase();
  if (text === 'file' || text === 'directory' || text === 'link') {
    return text;
  }
  return 'unknown';
}

function getRemoteBasename(remotePath: string): string {
  const normalized = normalizeRemotePath(remotePath || '/');
  if (normalized === '/') {
    return '/';
  }
  return normalized.split('/').filter(Boolean).pop() || normalized;
}

export class RemoteClipboardService implements vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<RemoteClipboardState | undefined>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private state: RemoteClipboardState | undefined;

  setCut(connection: ActiveConnection, items: readonly RemoteClipboardItem[]): RemoteClipboardState {
    const normalizedItems = items
      .map(item => {
        const normalizedPath = normalizeRemotePath(String(item.path || ''));
        const name = String(item.name || getRemoteBasename(normalizedPath)).trim();
        return {
          name,
          path: normalizedPath,
          type: normalizeItemType(item.type)
        } satisfies RemoteClipboardItem;
      })
      .filter(item => item.path && item.path !== '/' && item.name && item.name !== '..');

    if (!normalizedItems.length) {
      throw new Error('Select one or more remote files or folders to cut.');
    }

    this.state = {
      operation: 'cut',
      connectionId: connection.id,
      protocol: connection.connectionType,
      connectionLabel: connection.name || connection.host || connection.id,
      items: normalizedItems,
      createdAt: Date.now()
    };
    this.onDidChangeEmitter.fire(this.state);
    return this.state;
  }

  getState(): RemoteClipboardState | undefined {
    return this.state;
  }

  getSnapshot(connection?: ActiveConnection): RemoteClipboardSnapshot {
    if (!this.state) {
      return {
        hasItems: false,
        itemCount: 0,
        itemNames: [],
        sourceItems: [],
        sourceParentDirectories: [],
        canPaste: false
      };
    }

    return {
      hasItems: true,
      operation: this.state.operation,
      connectionId: this.state.connectionId,
      protocol: this.state.protocol,
      connectionLabel: this.state.connectionLabel,
      itemCount: this.state.items.length,
      itemNames: this.state.items.map(item => item.name),
      sourceItems: this.state.items,
      sourceParentDirectories: Array.from(new Set(this.state.items.map(item => dirnameRemotePath(item.path)))),
      canPaste: connection ? this.canPaste(connection) : false
    };
  }

  canPaste(connection: ActiveConnection | undefined): boolean {
    return Boolean(connection && this.state
      && this.state.connectionId === connection.id
      && this.state.protocol === connection.connectionType);
  }

  requirePasteState(connection: ActiveConnection): RemoteClipboardState {
    if (!this.state) {
      throw new Error('Nothing has been cut in Remote Edit.');
    }

    if (this.state.connectionId !== connection.id || this.state.protocol !== connection.connectionType) {
      throw new Error('Paste is only available in the original Remote Edit connection.');
    }

    return this.state;
  }

  clear(): void {
    if (!this.state) {
      return;
    }
    this.state = undefined;
    this.onDidChangeEmitter.fire(undefined);
  }

  clearForConnection(connectionId: string): void {
    if (this.state?.connectionId !== connectionId) {
      return;
    }
    this.clear();
  }

  isSourceParent(targetDirectory: string): boolean {
    const state = this.state;
    if (!state) {
      return false;
    }
    const normalizedTarget = normalizeRemotePath(targetDirectory || '/');
    return state.items.some(item => dirnameRemotePath(item.path) === normalizedTarget);
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}

export const remoteClipboardService = new RemoteClipboardService();
