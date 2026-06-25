import { RemoteEditIncomingMessageType, type RemoteEditWebviewMessage } from '../PanelMessages';
import type { RemoteEditPanelMessageHandlers } from '../PanelHandlerTypes';

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
    case RemoteEditIncomingMessageType.PickCaCertificatePath:
      await handlers.pickCaCertificatePath();
      return true;
    case RemoteEditIncomingMessageType.DeleteConnection:
      await handlers.deleteConnection(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RenameConnection:
      await handlers.renameConnection(message.payload);
      return true;
    case RemoteEditIncomingMessageType.ReorderConnections:
      await handlers.reorderConnections(message.payload);
      return true;
    case RemoteEditIncomingMessageType.CreateConnectionGroup:
      await handlers.createConnectionGroup(message.payload);
      return true;
    case RemoteEditIncomingMessageType.RenameConnectionGroup:
      await handlers.renameConnectionGroup(message.payload);
      return true;
    case RemoteEditIncomingMessageType.DeleteConnectionGroup:
      await handlers.deleteConnectionGroup(message.payload);
      return true;
    case RemoteEditIncomingMessageType.SyncPersistentStorage:
      await handlers.syncPersistentStorage(message.payload);
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
      await handlers.cancelConnection(message.payload);
      return true;
    case RemoteEditIncomingMessageType.Disconnect:
      await handlers.disconnect(String(message.payload?.connectionId || handlers.getActiveConnectionId() || ''));
      return true;
    case RemoteEditIncomingMessageType.SwitchSession:
      await handlers.switchSession(String(message.payload?.connectionId || ''));
      return true;
    case RemoteEditIncomingMessageType.ReorderSessions:
      handlers.reorderSessions(message.payload);
      return true;
    default:
      return false;
  }
}
