import * as vscode from 'vscode';

export interface RemoteEditNavigationState {
  connectionId: string;
  currentPath: string;
  rootPath: string;
  source?: 'webview' | 'sidebar' | 'session';
}

export interface RemoteEditFavoritesState {
  connectionId: string;
  source?: 'webview' | 'sidebar' | 'import';
}

export interface RemoteEditProfilesState {
  selectedId?: string;
  source?: 'webview' | 'sidebar' | 'import';
}

function normalizeRemotePath(remotePath: string | undefined): string {
  const raw = String(remotePath || '/').trim() || '/';
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+/g, '/').replace(/(.+)\/$/, '$1') || '/';
}

class RemoteEditSharedStateStore {
  private activeConnectionId: string | undefined;
  private readonly navigationByConnection = new Map<string, { currentPath: string; rootPath: string }>();
  private readonly activeConnectionChangedEmitter = new vscode.EventEmitter<string | undefined>();
  private readonly navigationChangedEmitter = new vscode.EventEmitter<RemoteEditNavigationState>();
  private readonly favoritesChangedEmitter = new vscode.EventEmitter<RemoteEditFavoritesState>();
  private readonly profilesChangedEmitter = new vscode.EventEmitter<RemoteEditProfilesState>();

  readonly onActiveConnectionChanged = this.activeConnectionChangedEmitter.event;
  readonly onNavigationChanged = this.navigationChangedEmitter.event;
  readonly onFavoritesChanged = this.favoritesChangedEmitter.event;
  readonly onProfilesChanged = this.profilesChangedEmitter.event;

  getActiveConnectionId(): string | undefined {
    return this.activeConnectionId;
  }

  setActiveConnection(connectionId: string | undefined): void {
    if (this.activeConnectionId === connectionId) {
      return;
    }

    this.activeConnectionId = connectionId;
    this.activeConnectionChangedEmitter.fire(connectionId);
  }

  getNavigation(connectionId: string): { currentPath: string; rootPath: string } | undefined {
    return this.navigationByConnection.get(connectionId);
  }

  setNavigation(connectionId: string, currentPath: string, rootPath?: string, source?: RemoteEditNavigationState['source']): void {
    if (!connectionId) {
      return;
    }

    const normalizedCurrentPath = normalizeRemotePath(currentPath);
    const normalizedRootPath = normalizeRemotePath(rootPath || currentPath);
    const previous = this.navigationByConnection.get(connectionId);

    if (previous?.currentPath === normalizedCurrentPath && previous.rootPath === normalizedRootPath) {
      return;
    }

    this.navigationByConnection.set(connectionId, {
      currentPath: normalizedCurrentPath,
      rootPath: normalizedRootPath
    });
    this.navigationChangedEmitter.fire({
      connectionId,
      currentPath: normalizedCurrentPath,
      rootPath: normalizedRootPath,
      source
    });
  }

  deleteNavigation(connectionId: string): void {
    this.navigationByConnection.delete(connectionId);
  }

  fireFavoritesChanged(connectionId: string, source?: RemoteEditFavoritesState['source']): void {
    if (!connectionId) {
      return;
    }

    this.favoritesChangedEmitter.fire({ connectionId, source });
  }

  fireProfilesChanged(selectedId?: string, source?: RemoteEditProfilesState['source']): void {
    this.profilesChangedEmitter.fire({ selectedId, source });
  }

  dispose(): void {
    this.activeConnectionChangedEmitter.dispose();
    this.navigationChangedEmitter.dispose();
    this.favoritesChangedEmitter.dispose();
    this.profilesChangedEmitter.dispose();
  }
}

export const RemoteEditSharedState = new RemoteEditSharedStateStore();
