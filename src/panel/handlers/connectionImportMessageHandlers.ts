import type { RemoteEditWebviewMessage } from '../PanelMessages';
import type { RemoteEditPanelMessageHandlers } from '../PanelHandlerTypes';
export async function tryHandleConnectionImportMessage(
  message: RemoteEditWebviewMessage,
  handlers: RemoteEditPanelMessageHandlers
): Promise<boolean> {
  if (message.type !== 'connectionImport') return false;
  await handlers.connectionImport(message.payload);
  return true;
}
