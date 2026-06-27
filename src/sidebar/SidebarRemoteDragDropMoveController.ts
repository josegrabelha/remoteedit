import * as vscode from 'vscode';
import type { RemoteClipboardItem } from '../remote/RemoteClipboardService';
import { appendDebugLog } from '../utils/outputLogger';
import { normalizeRemotePath } from './Items';
import type { RemoteEditSidebarItem } from './Items';

export const SIDEBAR_REMOTE_MOVE_MIME = 'application/x-remoteedit-sidebar-remote-move';

export interface SidebarRemoteDragMovePayload {
  connectionId: string;
  items: RemoteClipboardItem[];
}

export interface SidebarRemoteDragMoveTarget {
  connectionId: string;
  targetDirectory: string;
}

export interface SidebarRemoteDragDropMoveControllerOptions {
  resolveTarget(target: RemoteEditSidebarItem | undefined): SidebarRemoteDragMoveTarget | undefined;
  moveDroppedItems(target: SidebarRemoteDragMoveTarget, items: readonly RemoteClipboardItem[]): Promise<void>;
  output?: vscode.OutputChannel;
}

export class SidebarRemoteDragDropMoveController {
  readonly dragMimeTypes = [SIDEBAR_REMOTE_MOVE_MIME];
  readonly dropMimeTypes = [SIDEBAR_REMOTE_MOVE_MIME];

  constructor(private readonly options: SidebarRemoteDragDropMoveControllerOptions) {}

  handleDrag(source: readonly RemoteEditSidebarItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
    if (token.isCancellationRequested) {
      return;
    }

    const payload = this.buildPayload(source);
    if (!payload) {
      return;
    }

    dataTransfer.set(SIDEBAR_REMOTE_MOVE_MIME, new vscode.DataTransferItem(JSON.stringify(payload)));
    dataTransfer.set('text/plain', new vscode.DataTransferItem(payload.items.map(item => item.name || item.path).join('\n')));

    appendDebugLog(this.options.output, 'Sidebar', 'Sidebar remote drag started.', {
      ConnectionId: payload.connectionId,
      Items: payload.items.length
    });
  }

  async handleDrop(target: RemoteEditSidebarItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<boolean> {
    const item = dataTransfer.get(SIDEBAR_REMOTE_MOVE_MIME);
    if (!item) {
      return false;
    }

    if (token.isCancellationRequested) {
      return true;
    }

    const payload = await this.readPayload(item);
    if (token.isCancellationRequested) {
      return true;
    }

    if (!payload || !payload.items.length) {
      return true;
    }

    const moveTarget = this.options.resolveTarget(target);
    if (!moveTarget) {
      void vscode.window.showInformationMessage('Drop remote items on a folder in the same Remote Edit connection to move them.');
      return true;
    }

    if (moveTarget.connectionId !== payload.connectionId) {
      void vscode.window.showWarningMessage('Remote drag-and-drop move is only available in the original connection.');
      return true;
    }

    appendDebugLog(this.options.output, 'Sidebar', 'Sidebar remote drag-and-drop move received.', {
      ConnectionId: moveTarget.connectionId,
      TargetDirectory: moveTarget.targetDirectory,
      Items: payload.items.length
    });

    await this.options.moveDroppedItems(moveTarget, payload.items);
    return true;
  }

  private buildPayload(source: readonly RemoteEditSidebarItem[]): SidebarRemoteDragMovePayload | undefined {
    const movableItems = source
      .map(item => this.toRemoteClipboardItem(item))
      .filter((item): item is RemoteClipboardItem & { connectionId: string } => Boolean(item));

    if (!movableItems.length) {
      return undefined;
    }

    const connectionId = movableItems[0].connectionId;
    const sameConnectionItems = movableItems.filter(item => item.connectionId === connectionId);

    if (!connectionId || sameConnectionItems.length !== movableItems.length) {
      return undefined;
    }

    return {
      connectionId,
      items: sameConnectionItems.map(({ connectionId: _connectionId, ...item }) => item)
    };
  }

  private toRemoteClipboardItem(item: RemoteEditSidebarItem): (RemoteClipboardItem & { connectionId: string }) | undefined {
    if (!item.connectionId || !item.remotePath) {
      return undefined;
    }

    if (item.kind !== 'remoteDirectory' && item.kind !== 'remoteFile' && item.kind !== 'remoteEntry') {
      return undefined;
    }

    const path = normalizeRemotePath(item.remotePath);
    const name = this.getItemName(item, path);

    if (!path || path === '/' || !name || name === '..') {
      return undefined;
    }

    return {
      connectionId: item.connectionId,
      name,
      path,
      type: this.getItemType(item)
    };
  }

  private getItemName(item: RemoteEditSidebarItem, remotePath: string): string {
    const label = typeof item.label === 'string' ? item.label : String(item.label?.label || '');
    return String(item.remoteEntry?.name || label || remotePath.split('/').filter(Boolean).pop() || remotePath || '').trim();
  }

  private getItemType(item: RemoteEditSidebarItem): RemoteClipboardItem['type'] {
    if (item.kind === 'remoteDirectory') {
      return 'directory';
    }

    if (item.kind === 'remoteFile') {
      return 'file';
    }

    const type = String(item.remoteEntry?.effectiveType || item.remoteEntry?.type || '').toLowerCase();
    if (type === 'file' || type === 'directory' || type === 'link') {
      return type;
    }

    return 'unknown';
  }

  private async readPayload(item: vscode.DataTransferItem): Promise<SidebarRemoteDragMovePayload | undefined> {
    try {
      const raw = await item.asString();
      const parsed = JSON.parse(raw || '{}');
      return this.normalizePayload(parsed);
    } catch {
      return undefined;
    }
  }

  private normalizePayload(value: unknown): SidebarRemoteDragMovePayload | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const input = value as { connectionId?: unknown; items?: unknown };
    const connectionId = String(input.connectionId || '').trim();
    const rawItems = Array.isArray(input.items) ? input.items : [];
    const items = rawItems
      .map(rawItem => this.normalizePayloadItem(rawItem))
      .filter((item): item is RemoteClipboardItem => Boolean(item));

    if (!connectionId || !items.length) {
      return undefined;
    }

    return { connectionId, items };
  }

  private normalizePayloadItem(value: unknown): RemoteClipboardItem | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const input = value as { name?: unknown; path?: unknown; type?: unknown };
    const path = normalizeRemotePath(String(input.path || ''));
    const name = String(input.name || path.split('/').filter(Boolean).pop() || '').trim();
    const typeText = String(input.type || '').toLowerCase();
    const type: RemoteClipboardItem['type'] = typeText === 'file' || typeText === 'directory' || typeText === 'link'
      ? typeText
      : 'unknown';

    if (!path || path === '/' || !name || name === '..') {
      return undefined;
    }

    return { name, path, type };
  }
}
