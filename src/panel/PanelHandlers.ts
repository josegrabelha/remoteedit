import { type RemoteEditWebviewMessage } from './PanelMessages';
import type { RemoteEditPanelMessageHandlers } from './PanelHandlerTypes';
import { tryHandleBrowserMessage } from './handlers/browserMessageHandlers';
import { tryHandleConnectionMessage } from './handlers/connectionMessageHandlers';
import { tryHandleFileActionMessage } from './handlers/fileActionMessageHandlers';
import { tryHandleMiscMessage } from './handlers/miscMessageHandlers';
import { tryHandlePermissionsMessage } from './handlers/permissionsMessageHandlers';
import { tryHandleSudoMessage } from './handlers/sudoMessageHandlers';

export type { RemoteEditPanelMessageHandlers } from './PanelHandlerTypes';

export async function handleRemoteEditPanelMessage(
  message: RemoteEditWebviewMessage,
  handlers: RemoteEditPanelMessageHandlers
): Promise<void> {
  if (await tryHandleConnectionMessage(message, handlers)) {
    return;
  }

  if (await tryHandleSudoMessage(message, handlers)) {
    return;
  }

  if (await tryHandleBrowserMessage(message, handlers)) {
    return;
  }

  if (await tryHandleFileActionMessage(message, handlers)) {
    return;
  }

  if (await tryHandlePermissionsMessage(message, handlers)) {
    return;
  }

  if (await tryHandleMiscMessage(message, handlers)) {
    return;
  }

  handlers.unknown(String(message.type));
}
