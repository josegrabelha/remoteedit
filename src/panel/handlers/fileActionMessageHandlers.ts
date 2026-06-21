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
    case RemoteEditIncomingMessageType.RequestMakeCopy:
      await handlers.requestMakeCopy(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestCalculateChecksums:
      await handlers.requestCalculateChecksums(message.payload);
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
    case RemoteEditIncomingMessageType.RequestUploadEntries:
      await handlers.requestUploadEntries(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestDownloadEntries:
      await handlers.requestDownloadEntries(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestCompressArchive:
      await handlers.requestCompressArchive(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestChangeOwnerGroup:
      await handlers.requestChangeOwnerGroup(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestOwnerGroupSuggestions:
      await handlers.requestOwnerGroupSuggestions(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestRunRemoteCommand:
      await handlers.requestRunRemoteCommand(message.payload);
      return true;
    case RemoteEditIncomingMessageType.StopRemoteCommand:
      handlers.stopRemoteCommand(message.payload);
      return true;
    case RemoteEditIncomingMessageType.CancelTransfer:
      await handlers.cancelTransfer(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RemoveQueuedTransfer:
      handlers.removeQueuedTransfer(message.payload);
      return true;
    default:
      return false;
  }
}
