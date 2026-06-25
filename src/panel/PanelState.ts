export interface RemoteEditSessionPathState {
  id: string;
  startPath?: string;
}

export class RemoteEditPanelState {
  private static lastActiveConnectionId: string | undefined;
  private static retainedCurrentPaths = new Map<string, string>();

  private readonly currentPaths = new Map<string, string>();
  private activeConnectionId: string | undefined;

  initializeFromSessions(connections: RemoteEditSessionPathState[]): void {
    for (const connection of connections) {
      const retainedPath = RemoteEditPanelState.retainedCurrentPaths.get(connection.id) || connection.startPath;

      if (retainedPath) {
        this.currentPaths.set(connection.id, retainedPath);
      }
    }
  }

  getActiveConnectionId(): string | undefined {
    return this.activeConnectionId;
  }

  setActiveConnectionId(connectionId: string | undefined): void {
    this.activeConnectionId = connectionId;

    if (connectionId) {
      RemoteEditPanelState.lastActiveConnectionId = connectionId;
    }
  }

  getLastActiveConnectionId(): string | undefined {
    return RemoteEditPanelState.lastActiveConnectionId;
  }

  clearRetainedCurrentPaths(): void {
    RemoteEditPanelState.retainedCurrentPaths.clear();
  }

  getCurrentPath(connectionId: string, fallback = '/'): string {
    return this.currentPaths.get(connectionId) || fallback;
  }

  setCurrentPath(connectionId: string, currentPath: string): void {
    this.currentPaths.set(connectionId, currentPath);
    RemoteEditPanelState.retainedCurrentPaths.set(connectionId, currentPath);
  }

  deleteConnectionPath(connectionId: string): void {
    this.currentPaths.delete(connectionId);
    RemoteEditPanelState.retainedCurrentPaths.delete(connectionId);
  }
}
