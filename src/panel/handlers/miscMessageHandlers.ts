import { RemoteEditIncomingMessageType, type RemoteEditWebviewMessage } from '../RemoteEditPanelMessages';
import type { RemoteEditPanelMessageHandlers } from '../RemoteEditPanelHandlerTypes';

export async function tryHandleMiscMessage(
  message: RemoteEditWebviewMessage,
  handlers: RemoteEditPanelMessageHandlers
): Promise<boolean> {
  switch (message.type) {
    case RemoteEditIncomingMessageType.ShowSettings:
      handlers.showSettings();
      return true;
    case RemoteEditIncomingMessageType.ShowOutput:
      handlers.showOutput();
      return true;
    case RemoteEditIncomingMessageType.RequestOpenSshTerminal:
      await handlers.requestOpenSshTerminal(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestOpenLogViewer:
      await handlers.requestOpenLogViewer(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestServerDashboard:
      await handlers.requestServerDashboard(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestServerServiceDetails:
      await handlers.requestServerServiceDetails(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestServerServiceAction:
      await handlers.requestServerServiceAction(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestServerProcessDetails:
      await handlers.requestServerProcessDetails(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestServerProcessAction:
      await handlers.requestServerProcessAction(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestServerScheduledJobAction:
      await handlers.requestServerScheduledJobAction(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestPortForwardState:
      await handlers.requestPortForwardState(message.payload);
      return true;
    case RemoteEditIncomingMessageType.StartPortForward:
      await handlers.startPortForward(message.payload);
      return true;
    case RemoteEditIncomingMessageType.StopPortForward:
      await handlers.stopPortForward(message.payload);
      return true;
    case RemoteEditIncomingMessageType.ConfirmDialogResponse:
      handlers.confirmDialogResponse(message.payload);
      return true;
    case RemoteEditIncomingMessageType.InputDialogResponse:
      handlers.inputDialogResponse(message.payload);
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
