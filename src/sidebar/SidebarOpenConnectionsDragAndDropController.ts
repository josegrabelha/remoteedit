import * as vscode from 'vscode';
import type { RemoteEditSidebarItem } from './Items';
import { SidebarDropUploadController } from './SidebarDropUploadController';
import { SIDEBAR_REMOTE_MOVE_MIME, SidebarRemoteDragDropMoveController } from './SidebarRemoteDragDropMoveController';

export interface SidebarOpenConnectionsDragAndDropControllerOptions {
  uploadController: SidebarDropUploadController;
  remoteMoveController: SidebarRemoteDragDropMoveController;
}

export class SidebarOpenConnectionsDragAndDropController implements vscode.TreeDragAndDropController<RemoteEditSidebarItem> {
  readonly dragMimeTypes: readonly string[];
  readonly dropMimeTypes: readonly string[];

  constructor(private readonly options: SidebarOpenConnectionsDragAndDropControllerOptions) {
    this.dragMimeTypes = [...options.remoteMoveController.dragMimeTypes];
    this.dropMimeTypes = [
      ...options.remoteMoveController.dropMimeTypes,
      ...options.uploadController.dropMimeTypes
    ];
  }

  handleDrag(source: readonly RemoteEditSidebarItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
    this.options.remoteMoveController.handleDrag(source, dataTransfer, token);
  }

  async handleDrop(
    target: RemoteEditSidebarItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    if (dataTransfer.get(SIDEBAR_REMOTE_MOVE_MIME)) {
      await this.options.remoteMoveController.handleDrop(target, dataTransfer, token);
      return;
    }

    await this.options.uploadController.handleDrop(target, dataTransfer, token);
  }
}
