import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
  ConnectionBackupExportOptions,
  ConnectionBackupImportOptions,
  ConnectionManager,
  RemoteEditBackupFile,
  RemoteEditBackupImportResult,
  RemoteEditBackupSummary
} from '../connection/ConnectionManager';
import { formatBackupFileDate } from '../panel/FileNameUtils';
import { RemoteEditSharedState } from '../state/RemoteEditSharedState';

interface SidebarBackupControllerOptions {
  context: vscode.ExtensionContext;
  connectionManager: ConnectionManager;
  output: vscode.OutputChannel;
  onImported: () => void;
}

export class SidebarBackupController {
  constructor(private readonly options: SidebarBackupControllerOptions) {}

  async exportBackup(): Promise<void> {
    try {
      const exportOptions = await this.pickBackupExportOptions();

      if (!exportOptions) {
        return;
      }

      if (!exportOptions.includeSettings && !exportOptions.includeConnections && !exportOptions.includeWorkspaceSync
        && !exportOptions.includeMultiTarget) {
        void vscode.window.showWarningMessage('Remote Edit: Select at least one export option.');
        return;
      }

      const target = await vscode.window.showSaveDialog({
        filters: { 'JSON backup': ['json'], 'All files': ['*'] },
        saveLabel: 'Export',
        title: 'Export Remote Edit backup',
        defaultUri: vscode.Uri.file(path.join(os.homedir(), `remoteedit-backup-${formatBackupFileDate(new Date())}.json`))
      });

      if (!target) {
        return;
      }

      const backup = await this.options.connectionManager.buildBackupFile({
        ...exportOptions,
        extensionVersion: String((this.options.context.extension.packageJSON as { version?: string })?.version || '')
      });

      await fs.writeFile(target.fsPath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
      this.options.output.appendLine(`[Sidebar] Exported Remote Edit backup: ${target.fsPath}`);
      void vscode.window.showInformationMessage('Remote Edit: Export completed successfully.');
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  async importBackup(): Promise<void> {
    try {
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
        this.options.output.appendLine(`[Sidebar] Could not read Remote Edit backup: ${message}`);
        void vscode.window.showErrorMessage('Remote Edit: Import failed. Invalid backup file.');
        return;
      }

      const summary = this.options.connectionManager.summarizeBackupFile(backup);
      const shouldContinue = await vscode.window.showInformationMessage(
        'Remote Edit backup summary',
        { modal: true, detail: this.buildImportSummaryDetails(summary) },
        'Continue'
      );

      if (shouldContinue !== 'Continue') {
        return;
      }

      const importOptions = await this.pickBackupImportOptions(summary);

      if (!importOptions) {
        return;
      }

      if (!importOptions.includeSettings && !importOptions.includeConnections && !importOptions.includeWorkspaceSync
        && !importOptions.includeMultiTarget) {
        void vscode.window.showWarningMessage('Remote Edit: Select at least one import option.');
        return;
      }

      if (importOptions.restoreCredentials && importOptions.importMode === 'merge') {
        const masterPasswordConflict = await this.options.connectionManager.getBackupMasterPasswordConflict(
          backup,
          String(importOptions.credentialPassword || '')
        );

        if (masterPasswordConflict === 'conflict') {
          const choice = await vscode.window.showWarningMessage(
            'Remote Edit: This backup contains a different Master Password.',
            {
              modal: true,
              detail: 'Keep the current Master Password to leave existing Master Password connections unchanged, or replace it with the Master Password from this backup.'
            },
            'Keep Current',
            'Replace'
          );

          if (choice === undefined) {
            return;
          }

          importOptions.masterPasswordConflict = choice === 'Replace' ? 'replace' : 'keep';
        }
      }

      const result = await this.options.connectionManager.importBackupFile(backup, importOptions);
      this.options.onImported();
      if (importOptions.includeWorkspaceSync) {
        RemoteEditSharedState.fireWorkspaceSyncChanged('sidebar', 'importBackup');
      }
      if (importOptions.includeMultiTarget) {
        RemoteEditSharedState.fireMultiTargetChanged('sidebar', 'importBackup');
      }
      this.options.output.appendLine(`[Sidebar] Imported Remote Edit backup: ${selectedPath}`);
      void vscode.window.showInformationMessage(this.buildImportResultMessage(result));
    } catch (error) {
      this.showSidebarCommandError(error);
    }
  }

  private async pickBackupExportOptions(): Promise<ConnectionBackupExportOptions | undefined> {
    const items: Array<vscode.QuickPickItem & { option: 'settings' | 'connections' | 'workspaceSync' | 'multiTarget' | 'favorites' | 'usernames' | 'credentials' }> = [
      { label: 'Remote Edit settings', description: 'Export Remote Edit settings', option: 'settings', picked: true },
      { label: 'Saved connections', description: 'Export saved connection profiles', option: 'connections', picked: true },
      { label: 'Workspace Sync mappings', description: 'Export Workspace Sync mappings, targets, and sync options', option: 'workspaceSync', picked: true },
      { label: 'Multi-Target Commands & Search', description: 'Export saved commands and target sets', option: 'multiTarget', picked: true },
      { label: 'Remote path favorites', description: 'Export favorites stored with saved connections', option: 'favorites', picked: true },
      { label: 'Include usernames', description: 'Include saved usernames in exported connections', option: 'usernames', picked: true },
      { label: 'Include encrypted saved passwords/passphrases', description: 'Includes Master Password; requires an export password', option: 'credentials' }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Export Remote Edit backup',
      placeHolder: 'Select what to export',
      canPickMany: true,
      ignoreFocusOut: true
    });

    if (!selected) {
      return undefined;
    }

    const selectedOptions = new Set(selected.map(item => item.option));
    const includeConnections = selectedOptions.has('connections');
    const includeUsernames = includeConnections && selectedOptions.has('usernames');
    const includeCredentials = includeConnections && includeUsernames && selectedOptions.has('credentials');
    let credentialPassword = '';

    if (includeCredentials) {
      credentialPassword = await this.promptBackupPassword('Export Remote Edit backup', 'Enter a password to encrypt saved passwords, the Master Password, and key passphrases in the backup.', true) || '';

      if (!credentialPassword) {
        return undefined;
      }
    }

    return {
      includeSettings: selectedOptions.has('settings'),
      includeConnections,
      includeWorkspaceSync: selectedOptions.has('workspaceSync'),
      includeMultiTarget: selectedOptions.has('multiTarget'),
      includeFavorites: includeConnections && selectedOptions.has('favorites'),
      includeUsernames,
      includeCredentials,
      credentialPassword
    };
  }

  private async pickBackupImportOptions(summary: RemoteEditBackupSummary): Promise<ConnectionBackupImportOptions | undefined> {
    const items: Array<vscode.QuickPickItem & { option: 'settings' | 'connections' | 'workspaceSync' | 'multiTarget' | 'favorites' | 'usernames' | 'credentials' }> = [
      { label: 'Remote Edit settings', description: summary.hasSettings ? 'Import Remote Edit settings' : 'Not available in this backup', option: 'settings', picked: summary.hasSettings },
      { label: 'Saved connections', description: `${summary.supportedConnectionCount} supported connection(s)`, option: 'connections', picked: summary.supportedConnectionCount > 0 },
      { label: 'Workspace Sync mappings', description: summary.hasWorkspaceSync ? `${summary.workspaceSyncMappingCount} mapping(s), ${summary.workspaceSyncTargetCount} target(s)` : 'Not available in this backup', option: 'workspaceSync', picked: summary.hasWorkspaceSync },
      { label: 'Multi-Target Commands & Search', description: `${summary.multiTargetSavedCommandCount} command(s), ${summary.multiTargetTargetSetCount} target set(s)`, option: 'multiTarget', picked: summary.multiTargetSavedCommandCount > 0 || summary.multiTargetTargetSetCount > 0 },
      { label: 'Remote path favorites', description: `${summary.remotePathFavoriteCount} favorite path(s)`, option: 'favorites', picked: summary.remotePathFavoriteCount > 0 },
      { label: 'Include usernames', description: summary.usernamesIncluded ? 'Restore usernames from backup' : 'No usernames found in this backup', option: 'usernames', picked: summary.usernamesIncluded },
      { label: 'Restore encrypted saved passwords/passphrases', description: summary.hasEncryptedCredentials ? 'Includes Master Password; requires the export password' : 'No encrypted credentials found', option: 'credentials' }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Import Remote Edit backup',
      placeHolder: 'Select what to import',
      canPickMany: true,
      ignoreFocusOut: true
    });

    if (!selected) {
      return undefined;
    }

    const selectedOptions = new Set(selected.map(item => item.option));
    const includeConnections = selectedOptions.has('connections') && summary.supportedConnectionCount > 0;
    const includeWorkspaceSync = selectedOptions.has('workspaceSync') && summary.hasWorkspaceSync;
    const includeMultiTarget = selectedOptions.has('multiTarget')
      && (summary.multiTargetSavedCommandCount > 0 || summary.multiTargetTargetSetCount > 0);
    const includeUsernames = includeConnections && selectedOptions.has('usernames');
    const restoreCredentials = includeConnections && includeUsernames && summary.hasEncryptedCredentials && selectedOptions.has('credentials');
    let credentialPassword = '';

    const mode = includeConnections || includeWorkspaceSync || includeMultiTarget
      ? await vscode.window.showQuickPick([
        { label: 'Merge', description: 'Add new items and update matching saved configuration', value: 'merge' as const },
        { label: 'Replace', description: 'Replace the selected saved configuration with the backup content', value: 'replace' as const }
      ], {
        title: 'Import Mode',
        placeHolder: 'Choose how saved configuration should be imported',
        ignoreFocusOut: true
      })
      : { value: 'merge' as const };

    if (!mode) {
      return undefined;
    }

    if (restoreCredentials) {
      credentialPassword = await this.promptBackupPassword('Import Remote Edit backup', 'Enter the export password to restore encrypted saved passwords, the Master Password, and key passphrases.', false) || '';

      if (!credentialPassword) {
        return undefined;
      }
    }

    return {
      includeSettings: selectedOptions.has('settings') && summary.hasSettings,
      includeConnections,
      includeWorkspaceSync,
      includeMultiTarget,
      includeFavorites: includeConnections && selectedOptions.has('favorites'),
      includeUsernames,
      restoreCredentials,
      credentialPassword,
      importMode: mode.value
    };
  }

  private async promptBackupPassword(title: string, prompt: string, confirm: boolean): Promise<string | undefined> {
    const password = await vscode.window.showInputBox({
      title,
      prompt,
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Backup password'
    });

    if (!password) {
      return undefined;
    }

    if (!confirm) {
      return password;
    }

    const confirmation = await vscode.window.showInputBox({
      title,
      prompt: 'Confirm the backup password.',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Confirm backup password'
    });

    if (confirmation === undefined) {
      return undefined;
    }

    if (password !== confirmation) {
      void vscode.window.showErrorMessage('Remote Edit: Backup passwords do not match.');
      return undefined;
    }

    return password;
  }

  private buildImportSummaryDetails(summary: RemoteEditBackupSummary): string {
    const lines = [
      `Settings: ${summary.hasSettings ? 'Yes' : 'No'}`,
      `Workspace Sync: ${summary.hasWorkspaceSync ? 'Yes' : 'No'}`,
      `Connections: ${summary.supportedConnectionCount}${summary.unsupportedConnectionCount ? ` supported, ${summary.unsupportedConnectionCount} unsupported` : ''}`,
      `Remote path favorites: ${summary.remotePathFavoriteCount}`,
      `Usernames: ${summary.usernamesIncluded ? 'Yes' : 'No'}`,
      `Encrypted credentials: ${summary.hasEncryptedCredentials ? 'Yes' : 'No'}`,
      `Saved commands: ${summary.savedCommandCount}`,
      `Multi-Target Commands & Search: ${summary.multiTargetSavedCommandCount} command(s), ${summary.multiTargetTargetSetCount} target set(s)`,
      `Port forwards: ${summary.portForwardCount}`,
      `Server log shortcuts: ${summary.serverLogShortcutCount}`,
      `Log Viewer favorites: ${summary.logViewerFavoriteCount}`
    ];

    lines.push(`Workspace Sync mappings: ${summary.workspaceSyncMappingCount}`);
    lines.push(`Workspace Sync targets: ${summary.workspaceSyncTargetCount}`);

    return lines.join('\n');
  }

  private buildImportResultMessage(result: RemoteEditBackupImportResult): string {
    const parts = ['Remote Edit: Import completed successfully.'];

    if (result.settingsImported) {
      parts.push('Settings imported.');
    }

    if (result.added || result.updated || result.replaced) {
      parts.push(`Connections added: ${result.added}.`);
      parts.push(`Connections updated: ${result.updated}.`);
    }

    if (result.favoritesImported) {
      parts.push(`Favorites imported: ${result.favoritesImported}.`);
    }

    if (result.credentialsRestored) {
      parts.push(`Credentials restored: ${result.credentialsRestored}.`);
    }

    if (result.masterPasswordRestored) {
      parts.push('Master Password restored.');
    }

    if (result.savedCommandsImported) {
      parts.push(`Saved commands imported: ${result.savedCommandsImported}.`);
    }

    if (result.portForwardsImported) {
      parts.push(`Port forwards imported: ${result.portForwardsImported}.`);
    }

    if (result.serverLogShortcutsImported) {
      parts.push(`Server log shortcuts imported: ${result.serverLogShortcutsImported}.`);
    }

    if (result.logViewerFavoritesImported) {
      parts.push(`Log Viewer favorites imported: ${result.logViewerFavoritesImported}.`);
    }

    if (result.multiTargetSavedCommandsImported || result.multiTargetTargetSetsImported) {
      parts.push(`Multi-Target Commands & Search imported: ${result.multiTargetSavedCommandsImported} command(s), ${result.multiTargetTargetSetsImported} target set(s).`);
    }

    if (result.workspaceSyncMappingsImported) {
      parts.push(`Workspace Sync mappings imported: ${result.workspaceSyncMappingsImported}.`);
      parts.push(`Workspace Sync targets imported: ${result.workspaceSyncTargetsImported}.`);
    }

    if (result.skippedUnsupported) {
      parts.push(`Unsupported connections skipped: ${result.skippedUnsupported}.`);
    }

    return parts.join(' ');
  }

  private showSidebarCommandError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.options.output.appendLine(`[Sidebar] Operation failed: ${message}`);
    void vscode.window.showErrorMessage(message);
  }
}
