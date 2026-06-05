import { RemoteEditIncomingMessageType, type RemoteEditWebviewMessage } from '../RemoteEditPanelMessages';
import type { RemoteEditPanelMessageHandlers } from '../RemoteEditPanelHandlerTypes';

export async function tryHandleConnectionMessage(
  message: RemoteEditWebviewMessage,
  handlers: RemoteEditPanelMessageHandlers
): Promise<boolean> {
  switch (message.type) {
    case RemoteEditIncomingMessageType.Ready:
      await handlers.onReady();
      return true;
    case RemoteEditIncomingMessageType.SaveConnection:
      await handlers.saveConnection(message.payload);
      return true;
    case RemoteEditIncomingMessageType.PickPrivateKeyPath:
      await handlers.pickPrivateKeyPath();
      return true;
    case RemoteEditIncomingMessageType.DeleteConnection:
      await handlers.deleteConnection(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RenameConnection:
      await handlers.renameConnection(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RequestImportConnectionsSettings:
      await handlers.requestImportConnectionsSettings();
      return true;
    case RemoteEditIncomingMessageType.ExportConnectionsSettings:
      await handlers.exportConnectionsSettings(message.payload);
      return true;
    case RemoteEditIncomingMessageType.ImportConnectionsSettings:
      await handlers.importConnectionsSettings(message.payload);
      return true;
    case RemoteEditIncomingMessageType.Connect:
      await handlers.connect(message.payload);
      return true;
    case RemoteEditIncomingMessageType.CancelConnection:
      await handlers.cancelConnection();
      return true;
    case RemoteEditIncomingMessageType.Disconnect:
      await handlers.disconnect(String(message.payload?.connectionId || handlers.getActiveConnectionId() || ''));
      return true;
    case RemoteEditIncomingMessageType.SwitchSession:
      await handlers.switchSession(String(message.payload?.connectionId || ''));
      return true;
    default:
      return false;
  }
}
