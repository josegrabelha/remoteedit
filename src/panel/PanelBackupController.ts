import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ConnectionManager, RemoteEditBackupFile } from '../connection/ConnectionManager';
import { RemoteEditSharedState } from '../state/RemoteEditSharedState';
import type { OutputLogDetails } from '../utils/outputLogger';
import { RemoteEditOutboundMessageType } from './PanelMessages';
import { formatBackupFileDate } from './FileNameUtils';
import { buildExportResultMessage, buildImportResultMessage, countBackupFavorites, parseExportOptions, parseImportOptions } from './BackupUtils';

interface PanelBackupControllerOptions {
  context: vscode.ExtensionContext;
  connectionManager: ConnectionManager;
  postMessage: (type: RemoteEditOutboundMessageType, payload: any) => void;
  sendProfiles: () => Promise<void>;
  postPersistentStorageSnapshot: () => void;
  logInfo: (message: string, details?: OutputLogDetails) => void;
  logError: (message: string, details?: OutputLogDetails) => void;
}

export class PanelBackupController {
  private pendingImportBackupFile: RemoteEditBackupFile | undefined;

  constructor(private readonly options: PanelBackupControllerOptions) {}

  clearPendingImport(): void {
    this.pendingImportBackupFile = undefined;
  }

  async requestImportConnectionsSettings(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'JSON backup': ['json'], 'All files': ['*'] },
      openLabel: 'Import',
      title: 'Import Remote Edit backup'
    });

    const selectedPath = selected?.[0]?.fsPath;
    if (!selectedPath) {
      return;
    }

    let backup: RemoteEditBackupFile;
    try {
      const raw = await fs.readFile(selectedPath, 'utf8');
      backup = JSON.parse(raw) as RemoteEditBackupFile;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pendingImportBackupFile = undefined;
      this.options.logError('Could not read the selected backup file.', { Details: message });
      this.options.postMessage(RemoteEditOutboundMessageType.ShowImportConnectionsSettingsDialog, {
        summary: { importError: 'Import failed. Invalid backup file.' }
      });
      return;
    }

    const summary = this.options.connectionManager.summarizeBackupFile(backup);
    this.pendingImportBackupFile = backup;
    this.options.postMessage(RemoteEditOutboundMessageType.ShowImportConnectionsSettingsDialog, { summary });
  }

  async exportConnectionsSettings(payload: any): Promise<void> {
    const exportOptions = parseExportOptions(payload || {});

    if (!exportOptions.includeSettings && !exportOptions.includeConnections) {
      throw new Error('Select at least one export option.');
    }

    const target = await vscode.window.showSaveDialog({
      filters: { 'JSON backup': ['json'], 'All files': ['*'] },
      saveLabel: 'Export',
      title: 'Export Remote Edit backup',
      defaultUri: vscode.Uri.file(path.join(os.homedir(), `remoteedit-backup-${formatBackupFileDate(new Date())}.json`))
    });

    if (!target) {
      this.options.postMessage(RemoteEditOutboundMessageType.BackupOperationResult, { operation: 'export', message: 'Export canceled.', isError: false });
      return;
    }

    const backup = await this.options.connectionManager.buildBackupFile({
      ...exportOptions,
      extensionVersion: String((this.options.context.extension.packageJSON as { version?: string })?.version || '')
    });

    await fs.writeFile(target.fsPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
    const status = buildExportResultMessage(backup, exportOptions);
    this.options.postMessage(RemoteEditOutboundMessageType.BackupOperationResult, { operation: 'export', message: status, isError: false });
    this.options.logInfo('Exported Remote Edit backup.', {
      File: target.fsPath,
      Settings: backup.settings ? 'Yes' : 'No',
      Connections: String(backup.connections?.length || 0),
      Favorites: String(countBackupFavorites(backup)),
      Usernames: exportOptions.includeUsernames ? 'Yes' : 'No',
      EncryptedCredentials: backup.encryptedCredentials ? 'Yes' : 'No'
    });
  }

  async importConnectionsSettings(payload: any): Promise<void> {
    if (!this.pendingImportBackupFile) {
      throw new Error('Choose a backup file before importing.');
    }

    const importOptions = parseImportOptions(payload || {});

    if (!importOptions.includeSettings && !importOptions.includeConnections) {
      throw new Error('Select at least one import option.');
    }

    const result = await this.options.connectionManager.importBackupFile(this.pendingImportBackupFile, importOptions);

    await this.options.sendProfiles();
    RemoteEditSharedState.fireProfilesChanged(undefined, 'webview', 'importBackup');
    this.options.postPersistentStorageSnapshot();

    if (importOptions.importMode === 'replace') {
      this.options.postMessage(RemoteEditOutboundMessageType.ConnectionFormCleared, {});
    }

    const status = buildImportResultMessage(result, importOptions);

    this.options.postMessage(RemoteEditOutboundMessageType.BackupOperationResult, { operation: 'import', message: status, isError: false });
    this.options.logInfo('Imported Remote Edit backup.', {
      Mode: importOptions.importMode,
      Settings: result.settingsImported ? 'Yes' : 'No',
      Added: String(result.added),
      Updated: String(result.updated),
      Skipped: String(result.skippedUnsupported),
      FavoritesImported: String(result.favoritesImported),
      UsernamesImported: String(result.usernamesImported),
      CredentialsRestored: String(result.credentialsRestored)
    });
  }
}
