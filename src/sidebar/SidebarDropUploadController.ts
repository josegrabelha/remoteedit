import * as path from 'path';
import * as vscode from 'vscode';
import type { LocalUploadEntry } from '../panel/PanelTypes';
import type { RemoteEditSidebarItem } from './Items';
import { appendDebugLog, appendOutputLog } from '../utils/outputLogger';

export interface SidebarDropUploadTarget {
  connectionId: string;
  targetDirectory: string;
}

export interface SidebarDropUploadControllerOptions {
  resolveTarget(target: RemoteEditSidebarItem | undefined): SidebarDropUploadTarget | undefined;
  uploadDroppedItems(target: SidebarDropUploadTarget, localEntries: LocalUploadEntry[]): void;
  openWebviewForTarget?(target: SidebarDropUploadTarget): void;
  openUploadPickerForTarget?(target: SidebarDropUploadTarget): void;
  output?: vscode.OutputChannel;
}

export class SidebarDropUploadController implements vscode.TreeDragAndDropController<RemoteEditSidebarItem> {
  readonly dropMimeTypes = ['files', 'text/uri-list'];
  readonly dragMimeTypes: readonly string[] = [];

  constructor(private readonly options: SidebarDropUploadControllerOptions) {}

  async handleDrop(
    target: RemoteEditSidebarItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    const uploadTarget = this.options.resolveTarget(target);

    if (!uploadTarget) {
      void vscode.window.showInformationMessage('Drop local files or folders on an open Remote Edit folder to upload.');
      return;
    }

    const { localEntries, skippedWithoutLocalPath } = await this.collectDroppedItems(dataTransfer, token);

    if (token.isCancellationRequested) {
      return;
    }

    if (!localEntries.length && !skippedWithoutLocalPath) {
      return;
    }

    appendDebugLog(this.options.output, 'Sidebar', 'Sidebar drag-and-drop upload received.', {
      ConnectionId: uploadTarget.connectionId,
      TargetDirectory: uploadTarget.targetDirectory,
      LocalPathItems: localEntries.length,
      SkippedWithoutLocalPath: skippedWithoutLocalPath
    });

    if (localEntries.length) {
      this.options.uploadDroppedItems(uploadTarget, localEntries);
    }

    if (skippedWithoutLocalPath) {
      void this.showSkippedWithoutLocalPathWarning(uploadTarget, skippedWithoutLocalPath);
    }
  }

  private async collectDroppedItems(dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<{ localEntries: LocalUploadEntry[]; skippedWithoutLocalPath: number }> {
    const localEntries: LocalUploadEntry[] = [];
    const seenLocalPaths = new Set<string>();
    const seenUnsupportedFiles = new Set<string>();
    let pendingWithoutLocalPath = 0;

    for (const [, item] of dataTransfer) {
      if (token.isCancellationRequested) {
        break;
      }

      const file = item.asFile();

      if (!file) {
        continue;
      }

      const fsPath = this.getDataTransferFileFsPath(file);

      if (fsPath) {
        this.addLocalEntry(localEntries, seenLocalPaths, fsPath, file.name);
        continue;
      }

      const key = this.buildUnsupportedFileKey(file);
      if (seenUnsupportedFiles.has(key)) {
        continue;
      }

      seenUnsupportedFiles.add(key);
      pendingWithoutLocalPath += 1;
    }

    const uriListEntriesAdded = await this.collectUriListEntries(dataTransfer, localEntries, seenLocalPaths, token);
    const skippedWithoutLocalPath = Math.max(0, pendingWithoutLocalPath - uriListEntriesAdded);

    return { localEntries, skippedWithoutLocalPath };
  }

  private async collectUriListEntries(
    dataTransfer: vscode.DataTransfer,
    localEntries: LocalUploadEntry[],
    seenLocalPaths: Set<string>,
    token: vscode.CancellationToken
  ): Promise<number> {
    const uriListItem = dataTransfer.get('text/uri-list');

    if (!uriListItem || token.isCancellationRequested) {
      return 0;
    }

    let uriList = '';

    try {
      uriList = await uriListItem.asString();
    } catch {
      return 0;
    }

    let added = 0;

    for (const line of uriList.split(/\r?\n/g)) {
      if (token.isCancellationRequested) {
        return added;
      }

      const value = line.trim();

      if (!value || value.startsWith('#')) {
        continue;
      }

      try {
        const uri = vscode.Uri.parse(value);

        if (uri.scheme !== 'file') {
          continue;
        }

        if (this.addLocalEntry(localEntries, seenLocalPaths, uri.fsPath, path.basename(uri.fsPath))) {
          added += 1;
        }
      } catch {
        // Ignore malformed uri-list entries from other drag sources.
      }
    }

    return added;
  }

  private async showSkippedWithoutLocalPathWarning(target: SidebarDropUploadTarget, skippedCount: number): Promise<void> {
    if (this.options.output) {
      appendOutputLog(this.options.output, 'WARN', `Sidebar drag-and-drop upload skipped ${skippedCount} item(s): VS Code did not expose local file paths.`, {
        ConnectionId: target.connectionId,
        TargetDirectory: target.targetDirectory
      });
    }

    const message = skippedCount === 1
      ? 'VS Code did not expose the local path for the dropped item in the Sidebar. Use Upload... or drop it into the Remote Edit Webview instead.'
      : 'Some dropped items could not be uploaded because VS Code did not expose their local paths in the Sidebar. Use Upload... or drop those items into the Remote Edit Webview instead.';
    const openWebviewAction = 'Open Webview';
    const uploadAction = 'Upload...';
    const selection = await vscode.window.showWarningMessage(message, openWebviewAction, uploadAction);

    if (selection === openWebviewAction) {
      this.options.openWebviewForTarget?.(target);
      return;
    }

    if (selection === uploadAction) {
      this.options.openUploadPickerForTarget?.(target);
    }
  }

  private getDataTransferFileFsPath(file: vscode.DataTransferFile): string | undefined {
    const uri = file.uri;

    if (!uri || uri.scheme !== 'file' || !uri.fsPath) {
      return undefined;
    }

    return uri.fsPath;
  }

  private addLocalEntry(localEntries: LocalUploadEntry[], seenLocalPaths: Set<string>, localPath: string, name?: string): boolean {
    const normalizedLocalPath = String(localPath || '').trim();

    if (!normalizedLocalPath || seenLocalPaths.has(normalizedLocalPath)) {
      return false;
    }

    seenLocalPaths.add(normalizedLocalPath);
    localEntries.push({
      kind: 'file',
      localPath: normalizedLocalPath,
      relativePath: this.buildRelativePath(normalizedLocalPath, name)
    });
    return true;
  }

  private buildRelativePath(localPath: string, name?: string): string {
    const rawName = String(name || '').trim();
    const baseName = rawName || path.basename(localPath) || 'Dropped item';
    return baseName.replace(/\\/g, '/').replace(/^\/+/, '') || 'Dropped item';
  }

  private buildUnsupportedFileKey(file: vscode.DataTransferFile): string {
    return `${file.name || 'file'}:${file.uri?.toString() || 'no-uri'}`;
  }
}
