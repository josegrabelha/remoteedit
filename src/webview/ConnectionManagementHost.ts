import * as vscode from 'vscode';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import type { ConnectionManager } from '../connection/ConnectionManager';
import { ConnectionManagementController } from '../panel/ConnectionManagementController';
import { RemoteEditDialogManager } from '../panel/DialogManager';
import { RemoteEditSharedState } from '../state/RemoteEditSharedState';
import { SshHostKeyDialogController } from './SshHostKeyDialogController';
import { withHostKeyUi, disableHostKeyWarning } from '../ssh/hostKeys/HostKeyRuntime';
import { appendOutputLog } from '../utils/outputLogger';
import { formatBackupImportError } from '../panel/ConnectionErrors';

/** A management instance belongs to one webview, never to the Sidebar command. */
export class ConnectionManagementHost implements vscode.Disposable {
  private disposed = false;
  private readonly output: vscode.OutputChannel;
  private readonly management: ConnectionManagementController;
  private readonly dialogs: RemoteEditDialogManager;
  private readonly hostKeys: SshHostKeyDialogController;
  private readonly changed: vscode.Disposable;
  constructor(context: vscode.ExtensionContext, profiles: ConnectionManager, output: vscode.OutputChannel,
    private readonly post: (message: any) => void, private readonly origin: string, sessions?: RemoteSessionManager) {
    this.output = output;
    const send = (type: any, payload: any) => { if (!this.disposed) post({ type: 'connectionManagementMessage', message: { type, payload } }); };
    this.dialogs = new RemoteEditDialogManager(() => !this.disposed, send);
    this.hostKeys = new SshHostKeyDialogController(() => !this.disposed, message => {
      if (!this.disposed) post({ type: 'connectionManagementMessage', message });
    });
    this.management = new ConnectionManagementController({
      context, connectionManager: profiles, output, origin,
      postMessage: send,
      hasConnection: id => sessions?.hasConnection(id) || false,
      disconnect: async id => { await sessions?.disconnect(id); },
      showConfirmDialog: options => this.dialogs.showConfirmDialog(options),
      showConfirmDialogDecision: options => this.dialogs.showConfirmDialogDecision(options),
      postBusy: (isBusy, message) => send('busy', { isBusy, message }),
      logInfo: (message, details) => appendOutputLog(output, 'INFO', message, details),
      logError: (message, details) => appendOutputLog(output, 'ERROR', message, details),
      postPersistentStorageSnapshot: () => send('persistentStorageSnapshot', profiles.getPersistentWebviewStorageSnapshot())
    });
    this.changed = RemoteEditSharedState.onProfilesChanged(event => {
      if (event.origin === this.origin || this.disposed) return;
      void this.management.sendProfiles().catch(() => undefined);
    });
  }
  async handle(envelope: any): Promise<boolean> {
    if (envelope?.type !== 'connectionManagementMessage') return false;
    if (this.disposed) return true;
    const message = envelope.message;
    if (!message || typeof message.type !== 'string') return true;
    await withHostKeyUi({
      prompt: Object.assign((request: any, signal: AbortSignal) => this.hostKeys.prompt(request, signal), { managesPresentation: true }),
      confirmDisable: () => this.dialogs.showConfirmDialog({ title: 'Disable SSH Host Key Verification?', message: disableHostKeyWarning, confirmLabel: 'Disable Verification', cancelLabel: 'Cancel', danger: true })
    }, async () => {
      if (await this.hostKeys.handle(message)) return;
      const payload = message.payload;
      try {
        // Deliberately accept management messages only: no connection, transfer,
        // command or search messages can affect the operational webview state.
        switch (message.type) {
          case 'ready': await this.management.sendProfiles(); break;
          case 'sshKeyTools': await this.management.manageSshKeyTools(payload); break;
          case 'trustedSshHosts': await this.management.manageTrustedSshHosts(payload); break;
          case 'proxyProfiles': await this.management.manageProxyProfiles(payload); break;
          case 'masterPassword': await this.management.manageMasterPassword(payload); break;
          case 'connectionImport':
            await this.management.connectionImportController.handle(payload);
            break;
          case 'testConnection': await this.management.testConnection(payload); break;
          case 'cancelConnectionTest': this.management.cancelConnectionTest(payload); break;
          case 'saveConnection': await this.management.saveConnection(payload); break;
          case 'saveConnectionAs': await this.management.saveConnectionAs(payload); break;
          case 'cloneConnection': await this.management.cloneConnection(payload); break;
          case 'renameConnection': await this.management.renameConnection(payload); break;
          case 'deleteConnection': await this.management.deleteConnection(payload); break;
          case 'reorderConnections': await this.management.reorderConnections(payload); break;
          case 'createConnectionGroup': await this.management.createConnectionGroup(payload); break;
          case 'renameConnectionGroup': await this.management.renameConnectionGroup(payload); break;
          case 'deleteConnectionGroup': await this.management.deleteConnectionGroup(payload); break;
          case 'pickPrivateKeyPath': await this.management.pickPrivateKeyPath(payload); break;
          case 'pickCaCertificatePath': await this.management.pickCaCertificatePath(payload); break;
          case 'requestImportConnectionsSettings': await this.management.backupController.requestImportConnectionsSettings(); break;
          case 'exportConnectionsSettings': await this.management.backupController.exportConnectionsSettings(payload); break;
          case 'importConnectionsSettings':
            await this.management.backupController.importConnectionsSettings(payload);
            RemoteEditSharedState.fireProfilesChanged(undefined, 'webview', 'importBackup', this.origin);
            break;
          case 'confirmDialogResponse': this.dialogs.handleConfirmDialogResponse(payload); break;
          case 'inputDialogResponse': this.dialogs.handleInputDialogResponse(payload); break;
          case 'connectionManagementBlocked': await vscode.window.showInformationMessage('Close the current Remote Edit dialog before opening another management action.'); break;
          case 'showSettings': await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:josegrabelha.remoteedit'); break;
          case 'showOutput': this.output.show(true); break;
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        const type = message.type === 'exportConnectionsSettings' ? 'exportConnectionsSettingsValidationError'
          : message.type === 'importConnectionsSettings' ? 'importConnectionsSettingsValidationError' : 'error';
        this.post({ type: 'connectionManagementMessage', message: { type, payload: { message: message.type === 'importConnectionsSettings' ? formatBackupImportError(text) : text } } });
      }
    });
    return true;
  }
  dispose(): void {
    this.disposed = true;
    this.changed.dispose();
    this.hostKeys.cancelPending();
    this.dialogs.resolvePendingDialogs();
    this.management.dispose();
  }
}
