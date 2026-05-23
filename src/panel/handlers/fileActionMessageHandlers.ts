import { RemoteEditIncomingMessageType, type RemoteEditWebviewMessage } from '../RemoteEditPanelMessages';
import type { RemoteEditPanelMessageHandlers } from '../RemoteEditPanelHandlerTypes';

export async function tryHandleFileActionMessage(
  message: RemoteEditWebviewMessage,
  handlers: RemoteEditPanelMessageHandlers
): Promise<boolean> {
  switch (message.type) {
    case RemoteEditIncomingMessageType.RequestCreateFile:
      await handlers.requestCreateFile(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestCreateDirectory:
      await handlers.requestCreateDirectory(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestRenameEntry:
      await handlers.requestRenameEntry(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestDeleteEntry:
      await handlers.requestDeleteEntry(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestDeleteEntries:
      await handlers.requestDeleteEntries(message.payload);
      return true;
    default:
      return false;
  }
}
