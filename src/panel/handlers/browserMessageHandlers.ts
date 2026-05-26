import { RemoteEditIncomingMessageType, type RemoteEditWebviewMessage } from '../RemoteEditPanelMessages';
import type { RemoteEditPanelMessageHandlers } from '../RemoteEditPanelHandlerTypes';

export async function tryHandleBrowserMessage(
  message: RemoteEditWebviewMessage,
  handlers: RemoteEditPanelMessageHandlers
): Promise<boolean> {
  switch (message.type) {
    case RemoteEditIncomingMessageType.ListDirectory:
      await handlers.listDirectory(String(message.payload?.path || handlers.getActivePath()));
      return true;
    case RemoteEditIncomingMessageType.OpenParent:
      await handlers.openParent();
      return true;
    case RemoteEditIncomingMessageType.OpenEntry:
      await handlers.openEntry(message.payload);
      return true;
    case RemoteEditIncomingMessageType.OpenEntries:
      await handlers.openEntries(message.payload);
      return true;
    case RemoteEditIncomingMessageType.OpenPath:
      await handlers.openPath(message.payload);
      return true;
    case RemoteEditIncomingMessageType.CopyRemotePath:
      await handlers.copyRemotePath(message.payload);
      return true;
    case RemoteEditIncomingMessageType.AddRemotePathFavorite:
      await handlers.addRemotePathFavorite(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RemoveRemotePathFavorite:
      await handlers.removeRemotePathFavorite(message.payload);
      return true;
    case RemoteEditIncomingMessageType.CopyStatus:
      await handlers.copyStatus(message.payload);
      return true;
    default:
      return false;
  }
}
