import * as vscode from 'vscode';
import type { ConnectionManager } from '../connection/ConnectionManager';
import type { ActiveConnection } from '../remote/RemoteSessionTypes';

export async function resolveEditorRootSegments(
  connectionId: string,
  connection: ActiveConnection | undefined,
  connectionManager: ConnectionManager
): Promise<readonly string[] | undefined> {
  if (vscode.workspace.getConfiguration('remoteedit').get<string>('editorRootLabel', 'host') !== 'connectionName') {
    return undefined;
  }

  const profile = connection?.isQuickConnect ? undefined : await connectionManager.getProfile(connectionId);
  const name = profile?.name || connection?.name || connectionId;
  const group = profile?.groupId
    ? (await connectionManager.listGroups()).find(item => item.id === profile.groupId)
    : undefined;

  return group ? [group.name, name] : [name];
}
