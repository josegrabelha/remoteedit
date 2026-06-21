import * as vscode from 'vscode';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { isRemoteEditOperationCancelled, withRemoteEditProgress } from '../utils/progressUtils';
import { appendOutputLog } from '../utils/outputLogger';
import { RemoteEditSharedState } from '../state/RemoteEditSharedState';

export class RemoteEditFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly pendingFileReads = new Map<string, PendingFileRead>();
  private readonly tabChangeSubscription: vscode.Disposable;

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event;

  constructor(
    private readonly sessions: RemoteSessionManager,
    private readonly output?: vscode.OutputChannel,
    private readonly readOnly = false
  ) {
    this.tabChangeSubscription = vscode.window.tabGroups.onDidChangeTabs(event => this.cancelPendingReadsForClosedTabs(event.closed));
  }

  watch(_uri: vscode.Uri, _options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
    // Remote file watching is not implemented yet.
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { connectionId, remotePath } = parseRemoteEditUri(uri);
    const stats = await this.sessions.stat(connectionId, remotePath);

    return {
      type: toVsCodeFileType(stats.type),
      ctime: stats.modifyTime,
      mtime: stats.modifyTime,
      size: stats.size
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { connectionId, remotePath } = parseRemoteEditUri(uri);
    const entries = await this.sessions.listDirectory(connectionId, remotePath);

    return entries.map(entry => [entry.name, toVsCodeFileType(entry.type)]);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    this.assertWritable();
    const { connectionId, remotePath } = parseRemoteEditUri(uri);
    await this.sessions.createDirectory(connectionId, remotePath);
    this.logInfo('Remote directory created.', { Connection: connectionId, Path: remotePath });
    this.fireChanged(uri, vscode.FileChangeType.Created);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { connectionId, remotePath, openSource } = parseRemoteEditUri(uri);
    const uriKey = uri.toString();
    const cancellationSource = new vscode.CancellationTokenSource();
    const pendingRead: PendingFileRead = { cancellationSource };

    this.pendingFileReads.set(uriKey, pendingRead);

    try {
      return await withRemoteEditProgress(
        'Opening remote file...',
        async (token, progress) => await this.sessions.readFile(connectionId, remotePath, token, progress),
        {
          cancellable: true,
          returnOnCancel: true,
          cancelMessage: 'Opening remote file was cancelled.',
          cancellationSource
        }
      );
    } catch (error) {
      if (isRemoteEditOperationCancelled(error)) {
        await closeMatchingEditorTab(uri);
        throw vscode.FileSystemError.Unavailable('Opening remote file was cancelled.');
      }

      if (openSource === 'webview') {
        RemoteEditSharedState.fireRemoteFileOpenFailure({
          connectionId,
          remotePath,
          error,
          readOnly: uri.scheme === 'remoteedit-readonly',
          source: 'webview'
        });
        await closeMatchingEditorTab(uri);
      }

      throw error;
    } finally {
      if (this.pendingFileReads.get(uriKey) === pendingRead) {
        this.pendingFileReads.delete(uriKey);
      }

      cancellationSource.dispose();
    }
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, _options: { readonly create: boolean; readonly overwrite: boolean }): Promise<void> {
    this.assertWritable();
    const { connectionId, remotePath } = parseRemoteEditUri(uri);
    await withRemoteEditProgress(
      'Saving remote file...',
      async (_token, progress) => await this.sessions.writeFile(connectionId, remotePath, content, progress),
      { cancellable: false }
    );
    this.logInfo('Remote file saved.', { Connection: connectionId, Path: remotePath, Bytes: content.byteLength });
    this.fireChanged(uri, vscode.FileChangeType.Changed);
  }

  async delete(uri: vscode.Uri, _options: { readonly recursive: boolean }): Promise<void> {
    this.assertWritable();
    const { connectionId, remotePath } = parseRemoteEditUri(uri);
    await this.sessions.delete(connectionId, remotePath);
    this.logInfo('Remote item deleted from editor workspace.', { Connection: connectionId, Path: remotePath });
    this.fireChanged(uri, vscode.FileChangeType.Deleted);
  }

  async rename(oldUri: vscode.Uri, newUri: vscode.Uri, _options: { readonly overwrite: boolean }): Promise<void> {
    this.assertWritable();
    const oldInfo = parseRemoteEditUri(oldUri);
    const newInfo = parseRemoteEditUri(newUri);

    if (oldInfo.connectionId !== newInfo.connectionId) {
      throw new Error('Cannot rename files across different Remote Edit connections.');
    }

    await this.sessions.rename(oldInfo.connectionId, oldInfo.remotePath, newInfo.remotePath);
    this.logInfo('Remote item renamed from editor workspace.', { Connection: oldInfo.connectionId, From: oldInfo.remotePath, To: newInfo.remotePath });
    this.fireChanged(oldUri, vscode.FileChangeType.Deleted);
    this.fireChanged(newUri, vscode.FileChangeType.Created);
  }

  private assertWritable(): void {
    if (this.readOnly) {
      throw vscode.FileSystemError.NoPermissions('This Remote Edit document was opened read-only.');
    }
  }

  private logInfo(message: string, details?: Record<string, string | number | boolean | undefined | null>): void {
    if (!this.output) {
      return;
    }

    appendOutputLog(this.output, 'INFO', message, details);
  }

  private fireChanged(uri: vscode.Uri, type: vscode.FileChangeType): void {
    this.emitter.fire([{ type, uri }]);
  }

  private cancelPendingReadsForClosedTabs(closedTabs: readonly vscode.Tab[]): void {
    if (!this.pendingFileReads.size || !closedTabs.length) {
      return;
    }

    for (const tab of closedTabs) {
      for (const uriKey of getTabUriStrings(tab)) {
        const pendingRead = this.pendingFileReads.get(uriKey);

        if (!pendingRead || pendingRead.cancellationSource.token.isCancellationRequested) {
          continue;
        }

        pendingRead.cancellationSource.cancel();
      }
    }
  }

  dispose(): void {
    this.tabChangeSubscription.dispose();
    this.emitter.dispose();

    for (const pendingRead of this.pendingFileReads.values()) {
      pendingRead.cancellationSource.cancel();
      pendingRead.cancellationSource.dispose();
    }

    this.pendingFileReads.clear();
  }
}

interface PendingFileRead {
  cancellationSource: vscode.CancellationTokenSource;
}

async function closeMatchingEditorTab(uri: vscode.Uri): Promise<void> {
  const targetUri = uri.toString();
  const matchingTabs: vscode.Tab[] = [];

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (isTabForUri(tab, targetUri)) {
        matchingTabs.push(tab);
      }
    }
  }

  if (matchingTabs.length === 0) {
    return;
  }

  try {
    await vscode.window.tabGroups.close(matchingTabs, true);
  } catch {
    // Best-effort cleanup. The read operation has already been cancelled.
  }
}

function isTabForUri(tab: vscode.Tab, targetUri: string): boolean {
  return getTabUriStrings(tab).includes(targetUri);
}

function getTabUriStrings(tab: vscode.Tab): string[] {
  const input = tab.input as { readonly uri?: vscode.Uri; readonly modified?: vscode.Uri; readonly original?: vscode.Uri } | undefined;
  const uris = [input?.uri, input?.modified, input?.original]
    .filter((uri): uri is vscode.Uri => Boolean(uri))
    .map(uri => uri.toString());

  return Array.from(new Set(uris));
}

export function buildRemoteEditUri(
  connectionId: string,
  remotePath: string,
  displayAuthority?: string,
  options: { readonly readOnly?: boolean; readonly openSource?: 'webview' | 'sidebar' } = {}
): vscode.Uri {
  const normalizedRemotePath = remotePath.startsWith('/') ? remotePath : `/${remotePath}`;
  const authority = normalizeUriAuthority(displayAuthority || connectionId);
  const scheme = options.readOnly ? 'remoteedit-readonly' : 'remoteedit';

  const query = buildRemoteEditUriQuery(connectionId, displayAuthority ? normalizeUriPathSegment(shortenHostname(displayAuthority)) : '', options.openSource);

  if (displayAuthority) {
    const virtualRoot = normalizeUriPathSegment(shortenHostname(displayAuthority));
    const remotePathWithoutRoot = normalizedRemotePath.replace(/^\/+/, '');

    return vscode.Uri.from({
      scheme,
      authority,
      path: `/${virtualRoot}${remotePathWithoutRoot ? `/${remotePathWithoutRoot}` : ''}`,
      query
    });
  }

  return vscode.Uri.from({
    scheme,
    authority,
    path: normalizedRemotePath,
    query
  });
}

export function parseRemoteEditUri(uri: vscode.Uri): { connectionId: string; remotePath: string; openSource?: 'webview' | 'sidebar' } {
  if (uri.scheme !== 'remoteedit' && uri.scheme !== 'remoteedit-readonly') {
    throw new Error(`Unsupported URI scheme '${uri.scheme}'.`);
  }

  const connectionId = getQueryValue(uri.query, 'connectionId') || uri.authority;
  const openSource = normalizeOpenSource(getQueryValue(uri.query, 'openSource'));

  if (!connectionId) {
    throw new Error('Missing Remote Edit connection id in URI.');
  }

  return {
    connectionId,
    remotePath: stripVirtualRoot(uri.path || '/', getQueryValue(uri.query, 'remoteRoot')),
    openSource
  };
}


function buildRemoteEditUriQuery(connectionId: string, remoteRoot: string, openSource?: 'webview' | 'sidebar'): string {
  const params = new URLSearchParams();

  if (remoteRoot) {
    params.set('connectionId', connectionId);
    params.set('remoteRoot', remoteRoot);
  }

  if (openSource) {
    params.set('openSource', openSource);
  }

  return params.toString();
}

function normalizeOpenSource(value: string): 'webview' | 'sidebar' | undefined {
  return value === 'webview' || value === 'sidebar' ? value : undefined;
}

function stripVirtualRoot(path: string, virtualRoot: string): string {
  if (!virtualRoot) {
    return path || '/';
  }

  const prefix = `/${virtualRoot}`;

  if (path === prefix) {
    return '/';
  }

  if (path.startsWith(`${prefix}/`)) {
    return path.slice(prefix.length) || '/';
  }

  return path || '/';
}

function getQueryValue(query: string, key: string): string {
  const params = new URLSearchParams(query);
  return params.get(key) || '';
}

function normalizeUriAuthority(authority: string): string {
  return authority.trim().replace(/[^A-Za-z0-9._~-]/g, '-').replace(/^-+|-+$/g, '') || 'remote';
}

function normalizeUriPathSegment(segment: string): string {
  return segment.trim().replace(/[^A-Za-z0-9._~-]/g, '-').replace(/^-+|-+$/g, '') || 'remote';
}

function shortenHostname(hostname: string): string {
  const host = hostname.trim();

  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return host;
  }

  return host.split('.')[0] || host || 'remote';
}

function toVsCodeFileType(type: 'file' | 'directory' | 'link' | 'unknown'): vscode.FileType {
  switch (type) {
    case 'directory':
      return vscode.FileType.Directory;
    case 'file':
      return vscode.FileType.File;
    case 'link':
      return vscode.FileType.SymbolicLink;
    default:
      return vscode.FileType.Unknown;
  }
}
