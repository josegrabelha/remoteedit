import * as vscode from 'vscode';
import { ConnectionManager } from './connection/ConnectionManager';
import { RemoteEditFileSystemProvider } from './filesystem/RemoteEditFileSystemProvider';
import { RemoteEditPanel } from './panel/RemoteEditPanel';
import { SftpSessionManager } from './ssh/SftpSessionManager';
import { appendOutputLog } from './utils/outputLogger';

type StatusBarButtonStyle = 'iconAndText' | 'iconOnly' | 'textOnly';
type StatusBarButtonAlignment = 'left' | 'right';

interface StatusBarButtonState {
  item: vscode.StatusBarItem;
  alignment: vscode.StatusBarAlignment;
  priority: number;
}

const CONFIG_SECTION = 'remoteedit';
const COMMAND_OPEN = 'remoteedit.open';
const STATUS_BAR_TOOLTIP = 'Open RemoteEdit';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('RemoteEdit');
  const sessions = new SftpSessionManager();
  const connectionManager = new ConnectionManager(context);
  const fileSystemProvider = new RemoteEditFileSystemProvider(sessions, output);
  let statusBarButton: StatusBarButtonState | undefined;

  const disposeStatusBarButton = (): void => {
    statusBarButton?.item.dispose();
    statusBarButton = undefined;
  };

  const updateStatusBarButton = (): void => {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const showButton = config.get<boolean>('showStatusBarButton', true);

    if (!showButton) {
      disposeStatusBarButton();
      return;
    }

    const style = config.get<StatusBarButtonStyle>('statusBarButtonStyle', 'iconAndText');
    const alignment = getStatusBarAlignment(
      config.get<StatusBarButtonAlignment>('statusBarButtonAlignment', 'left')
    );
    const configuredPriority = config.get<number>('statusBarButtonPriority', 100);
    const priority = Number.isFinite(configuredPriority) ? configuredPriority : 100;

    if (!statusBarButton || statusBarButton.alignment !== alignment || statusBarButton.priority !== priority) {
      disposeStatusBarButton();
      statusBarButton = {
        item: vscode.window.createStatusBarItem(alignment, priority),
        alignment,
        priority
      };
    }

    statusBarButton.item.text = getStatusBarButtonText(style);
    statusBarButton.item.tooltip = STATUS_BAR_TOOLTIP;
    statusBarButton.item.command = COMMAND_OPEN;
    statusBarButton.item.show();
  };

  appendOutputLog(output, 'INFO', 'RemoteEdit activated.');
  updateStatusBarButton();

  context.subscriptions.push(
    output,
    vscode.workspace.registerFileSystemProvider('remoteedit', fileSystemProvider, {
      isCaseSensitive: true
    }),
    vscode.commands.registerCommand(COMMAND_OPEN, () => {
      RemoteEditPanel.open(context, sessions, connectionManager, output);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        updateStatusBarButton();
      }
    }),
    new vscode.Disposable(() => {
      disposeStatusBarButton();
      void sessions.disconnectAll();
    })
  );
}

export function deactivate(): void {
  // Cleanup is handled by the disposable registered during activation.
}

function getStatusBarButtonText(style: StatusBarButtonStyle): string {
  switch (style) {
    case 'iconOnly':
      return '$(remote-explorer)';
    case 'textOnly':
      return 'RemoteEdit';
    case 'iconAndText':
    default:
      return '$(remote-explorer) RemoteEdit';
  }
}

function getStatusBarAlignment(alignment: StatusBarButtonAlignment): vscode.StatusBarAlignment {
  return alignment === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
}
