import { RemoteEditIncomingMessageType, type RemoteEditWebviewMessage } from '../RemoteEditPanelMessages';
import type { RemoteEditPanelMessageHandlers } from '../RemoteEditPanelHandlerTypes';

export async function tryHandleMiscMessage(
  message: RemoteEditWebviewMessage,
  handlers: RemoteEditPanelMessageHandlers
): Promise<boolean> {
  switch (message.type) {
    case RemoteEditIncomingMessageType.ShowOutput:
      handlers.showOutput();
      return true;
    case RemoteEditIncomingMessageType.RequestOpenSshTerminal:
      await handlers.requestOpenSshTerminal(message.payload);
      return true;
    case RemoteEditIncomingMessageType.ConfirmDialogResponse:
      handlers.confirmDialogResponse(message.payload);
      return true;
    case RemoteEditIncomingMessageType.TransferConflictResponse:
      handlers.transferConflictResponse(message.payload);
      return true;
    case RemoteEditIncomingMessageType.Log:
      handlers.log(String(message.payload?.message || ''));
      return true;
    case RemoteEditIncomingMessageType.PerformanceLog:
      handlers.performanceLog(message.payload);
      return true;
    default:
      return false;
  }
}
