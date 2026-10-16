import * as vscode from 'vscode';

/** Shared Status Bar lifecycle for Workspace Sync and Multi-Target. */
export class ToolStatusBarButton implements vscode.Disposable {
  private state?: { item: vscode.StatusBarItem; alignment: vscode.StatusBarAlignment; priority: number };

  constructor(private readonly section: string, private readonly command: string,
    private readonly label: string, private readonly icon: string, private readonly defaultPriority: number) {}

  update(): void {
    const config = vscode.workspace.getConfiguration(this.section);
    const position = config.get<string>('statusBarButtonPosition', 'left');
    if (position === 'hidden') { this.dispose(); return; }
    const alignment = position === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
    const configuredPriority = config.get<number>('statusBarButtonPriority', this.defaultPriority);
    const priority = Number.isFinite(configuredPriority) ? configuredPriority : this.defaultPriority;
    if (!this.state || this.state.alignment !== alignment || this.state.priority !== priority) {
      this.dispose();
      this.state = { item: vscode.window.createStatusBarItem(alignment, priority), alignment, priority };
    }
    const style = config.get<string>('statusBarButtonStyle', 'iconAndText');
    this.state.item.text = style === 'iconOnly' ? `$(${this.icon})` : style === 'textOnly' ? this.label : `$(${this.icon}) ${this.label}`;
    this.state.item.tooltip = `Open ${this.label}`;
    this.state.item.command = this.command;
    this.state.item.show();
  }

  dispose(): void {
    this.state?.item.dispose();
    this.state = undefined;
  }
}
