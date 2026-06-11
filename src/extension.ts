import * as vscode from 'vscode';
import { ConnectionManager } from './connection/ConnectionManager';
import { RemoteEditFileSystemProvider } from './filesystem/RemoteEditFileSystemProvider';
import { RemoteEditPanel } from './panel/RemoteEditPanel';
import type { RemoteSessionManager } from './remote/RemoteSessionManager';
import { RemoteSessionRouter } from './remote/RemoteSessionRouter';
import { appendOutputLog } from './utils/outputLogger';
import { RemoteEditSidebarController } from './sidebar/SidebarController';

type StatusBarButtonStyle = 'iconAndText' | 'iconOnly' | 'textOnly';
type StatusBarButtonPosition = 'left' | 'right' | 'hidden';

interface StatusBarButtonState {
  item: vscode.StatusBarItem;
  alignment: vscode.StatusBarAlignment;
  priority: number;
}

const CONFIG_SECTION = 'remoteedit';
const COMMAND_OPEN = 'remoteedit.open';
const STATUS_BAR_TOOLTIP = 'Open Remote Edit';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Remote Edit');
  const sessions: RemoteSessionManager = new RemoteSessionRouter(output);
  const connectionManager = new ConnectionManager(context);
  const fileSystemProvider = new RemoteEditFileSystemProvider(sessions, output);
  const readOnlyFileSystemProvider = new RemoteEditFileSystemProvider(sessions, output, true);
  let statusBarButton: StatusBarButtonState | undefined;
  const sidebarController = new RemoteEditSidebarController(context, sessions, connectionManager, output);

  const disposeStatusBarButton = (): void => {
    statusBarButton?.item.dispose();
    statusBarButton = undefined;
  };

  const updateStatusBarButton = (): void => {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const position = getStatusBarButtonPosition(config);

    if (position === 'hidden') {
      disposeStatusBarButton();
      return;
    }

    const style = config.get<StatusBarButtonStyle>('statusBarButtonStyle', 'iconAndText');
    const alignment = getStatusBarAlignment(position);
    const configuredPriority = config.get<number>('statusBarButtonPriority', 1000);
    const priority = Number.isFinite(configuredPriority) ? configuredPriority : 1000;

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

  appendOutputLog(output, 'INFO', 'Remote Edit activated.');
  updateStatusBarButton();

  context.subscriptions.push(
    output,
    sidebarController,
    vscode.workspace.registerFileSystemProvider('remoteedit', fileSystemProvider, {
      isCaseSensitive: true
    }),
    vscode.workspace.registerFileSystemProvider('remoteedit-readonly', readOnlyFileSystemProvider, {
      isCaseSensitive: true,
      isReadonly: true
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
      return 'Remote Edit';
    case 'iconAndText':
    default:
      return '$(remote-explorer) Remote Edit';
  }
}

function getStatusBarButtonPosition(config: vscode.WorkspaceConfiguration): StatusBarButtonPosition {
  const positionInspection = config.inspect<StatusBarButtonPosition>('statusBarButtonPosition');
  const hasConfiguredPosition = Boolean(
    positionInspection?.globalValue ||
    positionInspection?.workspaceValue ||
    positionInspection?.workspaceFolderValue ||
    positionInspection?.globalLanguageValue ||
    positionInspection?.workspaceLanguageValue ||
    positionInspection?.workspaceFolderLanguageValue
  );
  const configuredPosition = config.get<StatusBarButtonPosition>('statusBarButtonPosition');

  if (hasConfiguredPosition && (configuredPosition === 'left' || configuredPosition === 'right' || configuredPosition === 'hidden')) {
    return configuredPosition;
  }

  const legacyShowButton = config.get<boolean>('showStatusBarButton', true);
  if (!legacyShowButton) {
    return 'hidden';
  }

  const legacyAlignment = config.get<'left' | 'right'>('statusBarButtonAlignment', 'left');
  return legacyAlignment === 'right' ? 'right' : 'left';
}

function getStatusBarAlignment(position: Exclude<StatusBarButtonPosition, 'hidden'>): vscode.StatusBarAlignment {
  return position === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
}
