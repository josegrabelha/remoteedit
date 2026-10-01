import * as vscode from 'vscode';
import type { ConnectionManager } from '../connection/ConnectionManager';
import { WorkspaceSyncController } from './WorkspaceSyncController';
import { WorkspaceSyncPanel } from './webview/WorkspaceSyncPanel';
import { getWorkspaceSyncPreferences, setWorkspaceSyncPreferences } from './mapping/WorkspaceMappingStore';

export const COMMAND_OPEN_WORKSPACE_SYNC = 'remoteedit.workspaceSync.open';

const CONFIG_SECTION = 'remoteedit.workspaceSync';
const STATUS_BAR_TOOLTIP = 'Open Workspace Sync';
const DEFAULT_STATUS_BAR_PRIORITY = 999;

type StatusBarButtonStyle = 'iconAndText' | 'iconOnly' | 'textOnly';
type StatusBarButtonPosition = 'left' | 'right' | 'hidden';

interface StatusBarButtonState {
  item: vscode.StatusBarItem;
  alignment: vscode.StatusBarAlignment;
  priority: number;
}

export class WorkspaceSyncFeature implements vscode.Disposable {
  private controller: WorkspaceSyncController | undefined;
  private statusBarButton: StatusBarButtonState | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connectionManager: ConnectionManager,
    private readonly output: vscode.OutputChannel
  ) {
    // Register the command before initializing Workspace Sync runtime state.
    // A malformed or legacy mapping must never prevent the extension itself
    // from activating and leave the sidebar command unresolved.
    this.disposables.push(
      vscode.commands.registerCommand(COMMAND_OPEN_WORKSPACE_SYNC, () => this.openPanel()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(CONFIG_SECTION)) {
          this.updateStatusBarButton();
        }
        if (event.affectsConfiguration(`${CONFIG_SECTION}.defaultCompare`)) {
          void this.mirrorDefaultCompareSetting();
        }
      })
    );

    this.updateStatusBarButton();
    void this.migrateDefaultCompareSetting();

    try {
      this.ensureController();
    } catch (error) {
      this.logInitializationFailure(error);
    }
  }

  dispose(): void {
    this.disposeStatusBarButton();
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.controller = undefined;
  }

  private async migrateDefaultCompareSetting(): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const inspection = config.inspect<'internal' | 'vscode'>('defaultCompare');
    const explicit = inspection?.workspaceFolderValue ?? inspection?.workspaceValue ?? inspection?.globalValue;
    if (explicit !== 'internal' && explicit !== 'vscode') {
      const legacy = getWorkspaceSyncPreferences(this.context).defaultCompare;
      if (legacy === 'vscode') {
        await config.update('defaultCompare', 'vscode', vscode.ConfigurationTarget.Global);
      }
    }
    await this.mirrorDefaultCompareSetting();
  }

  private async mirrorDefaultCompareSetting(): Promise<void> {
    const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<'internal' | 'vscode'>('defaultCompare', 'internal') === 'vscode'
      ? 'vscode'
      : 'internal';
    await setWorkspaceSyncPreferences(this.context, { defaultCompare: value });
    this.controller?.notifyConfigurationChanged();
  }

  private updateStatusBarButton(): void {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const position = config.get<StatusBarButtonPosition>('statusBarButtonPosition', 'left');

    if (position === 'hidden') {
      this.disposeStatusBarButton();
      return;
    }

    const normalizedPosition: Exclude<StatusBarButtonPosition, 'hidden'> = position === 'right' ? 'right' : 'left';
    const alignment = normalizedPosition === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
    const style = config.get<StatusBarButtonStyle>('statusBarButtonStyle', 'iconAndText');
    const configuredPriority = config.get<number>('statusBarButtonPriority', DEFAULT_STATUS_BAR_PRIORITY);
    const priority = Number.isFinite(configuredPriority) ? configuredPriority : DEFAULT_STATUS_BAR_PRIORITY;

    if (!this.statusBarButton || this.statusBarButton.alignment !== alignment || this.statusBarButton.priority !== priority) {
      this.disposeStatusBarButton();
      this.statusBarButton = {
        item: vscode.window.createStatusBarItem(alignment, priority),
        alignment,
        priority
      };
    }

    this.statusBarButton.item.text = this.getStatusBarButtonText(style);
    this.statusBarButton.item.tooltip = STATUS_BAR_TOOLTIP;
    this.statusBarButton.item.command = COMMAND_OPEN_WORKSPACE_SYNC;
    this.statusBarButton.item.show();
  }

  private disposeStatusBarButton(): void {
    this.statusBarButton?.item.dispose();
    this.statusBarButton = undefined;
  }

  private getStatusBarButtonText(style: StatusBarButtonStyle): string {
    switch (style) {
      case 'iconOnly':
        return '$(sync)';
      case 'textOnly':
        return 'Workspace Sync';
      case 'iconAndText':
      default:
        return '$(sync) Workspace Sync';
    }
  }

  private openPanel(): void {
    try {
      const controller = this.ensureController();
      WorkspaceSyncPanel.open(this.context, controller, this.output);
    } catch (error) {
      const message = this.errorMessage(error);
      this.output.appendLine(`[Workspace Sync] Failed to initialize. ${message}`);
      void vscode.window.showErrorMessage(`Workspace Sync could not be opened: ${message}`);
    }
  }

  private ensureController(): WorkspaceSyncController {
    if (this.controller) return this.controller;
    const controller = new WorkspaceSyncController(this.context, this.connectionManager, this.output);
    this.controller = controller;
    this.disposables.push(controller);
    return controller;
  }

  private logInitializationFailure(error: unknown): void {
    this.output.appendLine(`[Workspace Sync] Initialization deferred after an error. ${this.errorMessage(error)}`);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
