import { RemoteEditIncomingMessageType, type RemoteEditWebviewMessage } from '../PanelMessages';
import type { RemoteEditPanelMessageHandlers } from '../PanelHandlerTypes';

export async function tryHandleSudoMessage(
  message: RemoteEditWebviewMessage,
  handlers: RemoteEditPanelMessageHandlers
): Promise<boolean> {
  switch (message.type) {
    case RemoteEditIncomingMessageType.EnableSudoMode:
      await handlers.enableSudoMode();
      return true;
    case RemoteEditIncomingMessageType.DisableSudoMode:
      handlers.disableSudoMode(String(message.payload?.connectionId || handlers.getActiveConnectionId() || ''));
      return true;
    default:
      return false;
  }
}
