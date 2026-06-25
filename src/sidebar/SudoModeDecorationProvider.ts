import * as vscode from 'vscode';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';

export class SudoModeDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.onDidChangeFileDecorationsEmitter.event;

  constructor(private readonly sessions: RemoteSessionManager) {}

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    const connectionId = getSidebarDecorationConnectionId(uri);

    if (!connectionId || !this.sessions.isSudoModeEnabled(connectionId)) {
      return undefined;
    }

    return {
      color: new vscode.ThemeColor('remoteedit.sudoForeground'),
      tooltip: 'Sudo Mode is enabled for this connection.'
    };
  }

  refresh(): void {
    this.onDidChangeFileDecorationsEmitter.fire(undefined);
  }

  dispose(): void {
    this.onDidChangeFileDecorationsEmitter.dispose();
  }
}

function getSidebarDecorationConnectionId(uri: vscode.Uri): string | undefined {
  if (!uri.query) {
    return undefined;
  }

  try {
    return new URLSearchParams(uri.query).get('connectionId') || undefined;
  } catch {
    return undefined;
  }
}
