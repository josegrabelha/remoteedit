import { RemoteEditIncomingMessageType, type RemoteEditWebviewMessage } from '../RemoteEditPanelMessages';
import type { RemoteEditPanelMessageHandlers } from '../RemoteEditPanelHandlerTypes';

export async function tryHandlePermissionsMessage(
  message: RemoteEditWebviewMessage,
  handlers: RemoteEditPanelMessageHandlers
): Promise<boolean> {
  switch (message.type) {
    case RemoteEditIncomingMessageType.RequestSetPermissions:
      await handlers.requestSetPermissions(message.payload);
      return true;
    case RemoteEditIncomingMessageType.ApplyPermissions:
      handlers.applyPermissions(message.payload);
      return true;
    case RemoteEditIncomingMessageType.CancelPermissions:
      handlers.cancelPermissions();
      return true;
    default:
      return false;
  }
}
