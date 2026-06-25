import { RemoteEditIncomingMessageType, type RemoteEditWebviewMessage } from '../PanelMessages';
import type { RemoteEditPanelMessageHandlers } from '../PanelHandlerTypes';

export async function tryHandleBrowserMessage(
  message: RemoteEditWebviewMessage,
  handlers: RemoteEditPanelMessageHandlers
): Promise<boolean> {
  switch (message.type) {
    case RemoteEditIncomingMessageType.ListDirectory:
      await handlers.listDirectory(String(message.payload?.path || handlers.getActivePath()), { forceRefresh: Boolean(message.payload?.forceRefresh) });
      return true;
    case RemoteEditIncomingMessageType.RequestBreadcrumbDirectories:
      await handlers.requestBreadcrumbDirectories(message.payload);
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
    case RemoteEditIncomingMessageType.OpenEntriesReadOnly:
      await handlers.openEntriesReadOnly(message.payload);
      return true;
    case RemoteEditIncomingMessageType.CompareSelectedEntries:
      await handlers.compareSelectedEntries(message.payload);
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
    case RemoteEditIncomingMessageType.RequestRemoteSearchState:
      handlers.requestRemoteSearchState();
      return true;
    case RemoteEditIncomingMessageType.BrowseRemoteSearchScope:
      await handlers.browseRemoteSearchScope(message.payload);
      return true;
    case RemoteEditIncomingMessageType.StartRemoteSearch:
      await handlers.startRemoteSearch(message.payload);
      return true;
    case RemoteEditIncomingMessageType.CancelRemoteSearch:
      handlers.cancelRemoteSearch();
      return true;
    case RemoteEditIncomingMessageType.ClearRemoteSearch:
      handlers.clearRemoteSearch();
      return true;
    default:
      return false;
  }
}
