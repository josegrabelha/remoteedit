import { RemoteEditIncomingMessageType, type RemoteEditWebviewMessage } from '../RemoteEditPanelMessages';
import type { RemoteEditPanelMessageHandlers } from '../RemoteEditPanelHandlerTypes';

export function tryHandleMiscMessage(
  message: RemoteEditWebviewMessage,
  handlers: RemoteEditPanelMessageHandlers
): boolean {
  switch (message.type) {
    case RemoteEditIncomingMessageType.ShowOutput:
      handlers.showOutput();
      return true;
    case RemoteEditIncomingMessageType.ConfirmDialogResponse:
      handlers.confirmDialogResponse(message.payload);
      return true;
    case RemoteEditIncomingMessageType.Log:
      handlers.log(String(message.payload?.message || ''));
      return true;
    default:
      return false;
  }
}
