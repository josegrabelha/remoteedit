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
  reason?: string;
}

export interface RemoteEditRemoteDirectoryChangeState {
  connectionId: string;
  remotePath: string;
  source?: 'webview' | 'sidebar';
}

export interface RemoteEditRemoteFileOpenFailureState {
  connectionId: string;
  remotePath: string;
  error: unknown;
  readOnly: boolean;
  source?: 'webview' | 'sidebar';
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
  private readonly remoteDirectoryChangedEmitter = new vscode.EventEmitter<RemoteEditRemoteDirectoryChangeState>();
  private readonly remoteFileOpenFailureEmitter = new vscode.EventEmitter<RemoteEditRemoteFileOpenFailureState>();

  readonly onActiveConnectionChanged = this.activeConnectionChangedEmitter.event;
  readonly onNavigationChanged = this.navigationChangedEmitter.event;
  readonly onFavoritesChanged = this.favoritesChangedEmitter.event;
  readonly onProfilesChanged = this.profilesChangedEmitter.event;
  readonly onRemoteDirectoryChanged = this.remoteDirectoryChangedEmitter.event;
  readonly onRemoteFileOpenFailure = this.remoteFileOpenFailureEmitter.event;

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

  fireProfilesChanged(selectedId?: string, source?: RemoteEditProfilesState['source'], reason?: string): void {
    this.profilesChangedEmitter.fire({ selectedId, source, reason });
  }

  fireRemoteDirectoryChanged(connectionId: string, remotePath: string, source?: RemoteEditRemoteDirectoryChangeState['source']): void {
    if (!connectionId) {
      return;
    }

    this.remoteDirectoryChangedEmitter.fire({
      connectionId,
      remotePath: normalizeRemotePath(remotePath),
      source
    });
  }

  fireRemoteFileOpenFailure(event: RemoteEditRemoteFileOpenFailureState): void {
    if (!event.connectionId) {
      return;
    }

    this.remoteFileOpenFailureEmitter.fire({
      ...event,
      remotePath: normalizeRemotePath(event.remotePath)
    });
  }

  dispose(): void {
    this.activeConnectionChangedEmitter.dispose();
    this.navigationChangedEmitter.dispose();
    this.favoritesChangedEmitter.dispose();
    this.profilesChangedEmitter.dispose();
    this.remoteDirectoryChangedEmitter.dispose();
    this.remoteFileOpenFailureEmitter.dispose();
  }
}

export const RemoteEditSharedState = new RemoteEditSharedStateStore();
