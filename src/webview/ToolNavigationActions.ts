export type ToolView = 'remoteEdit' | 'workspaceSync' | 'multiTarget';

export const toolViews = [
  { id: 'remoteEdit', label: 'Open Remote Edit', buttonId: 'openRemoteEditTool', command: 'remoteedit.open' },
  { id: 'workspaceSync', label: 'Open Workspace Sync', buttonId: 'openWorkspaceSyncTool', command: 'remoteedit.workspaceSync.open' },
  { id: 'multiTarget', label: 'Open Multi-Target', buttonId: 'openMultiTargetTool', command: 'remoteedit.multiTarget.open' }
] as const;

export function toolNavigationActions(origin: ToolView) {
  return toolViews.filter(view => view.id !== origin);
}
