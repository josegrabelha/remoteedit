import * as vscode from 'vscode';
import { SftpSessionManager } from '../ssh/SftpSessionManager';
import { withRemoteEditProgress } from '../utils/progressUtils';
import { appendOutputLog } from '../utils/outputLogger';

export class RemoteEditFileSystemProvider implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event;

  constructor(private readonly sessions: SftpSessionManager, private readonly output?: vscode.OutputChannel) {}

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
    const { connectionId, remotePath } = parseRemoteEditUri(uri);
    await this.sessions.createDirectory(connectionId, remotePath);
    this.logInfo('Remote directory created.', { Connection: connectionId, Path: remotePath });
    this.fireChanged(uri, vscode.FileChangeType.Created);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { connectionId, remotePath } = parseRemoteEditUri(uri);
    return await withRemoteEditProgress(
      'Opening remote file...',
      async (token, progress) => await this.sessions.readFile(connectionId, remotePath, token, progress),
      { cancellable: true, returnOnCancel: true, cancelMessage: 'Opening cancelled.' }
    );
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, _options: { readonly create: boolean; readonly overwrite: boolean }): Promise<void> {
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
    const { connectionId, remotePath } = parseRemoteEditUri(uri);
    await this.sessions.delete(connectionId, remotePath);
    this.logInfo('Remote item deleted from editor workspace.', { Connection: connectionId, Path: remotePath });
    this.fireChanged(uri, vscode.FileChangeType.Deleted);
  }

  async rename(oldUri: vscode.Uri, newUri: vscode.Uri, _options: { readonly overwrite: boolean }): Promise<void> {
    const oldInfo = parseRemoteEditUri(oldUri);
    const newInfo = parseRemoteEditUri(newUri);

    if (oldInfo.connectionId !== newInfo.connectionId) {
      throw new Error('Cannot rename files across different RemoteEdit connections.');
    }

    await this.sessions.rename(oldInfo.connectionId, oldInfo.remotePath, newInfo.remotePath);
    this.logInfo('Remote item renamed from editor workspace.', { Connection: oldInfo.connectionId, From: oldInfo.remotePath, To: newInfo.remotePath });
    this.fireChanged(oldUri, vscode.FileChangeType.Deleted);
    this.fireChanged(newUri, vscode.FileChangeType.Created);
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
}

export function buildRemoteEditUri(connectionId: string, remotePath: string, displayAuthority?: string): vscode.Uri {
  const normalizedRemotePath = remotePath.startsWith('/') ? remotePath : `/${remotePath}`;
  const authority = normalizeUriAuthority(displayAuthority || connectionId);

  if (displayAuthority) {
    const virtualRoot = normalizeUriPathSegment(shortenHostname(displayAuthority));
    const remotePathWithoutRoot = normalizedRemotePath.replace(/^\/+/, '');

    return vscode.Uri.from({
      scheme: 'remoteedit',
      authority,
      path: `/${virtualRoot}${remotePathWithoutRoot ? `/${remotePathWithoutRoot}` : ''}`,
      query: `connectionId=${encodeURIComponent(connectionId)}&remoteRoot=${encodeURIComponent(virtualRoot)}`
    });
  }

  return vscode.Uri.from({
    scheme: 'remoteedit',
    authority,
    path: normalizedRemotePath
  });
}

export function parseRemoteEditUri(uri: vscode.Uri): { connectionId: string; remotePath: string } {
  if (uri.scheme !== 'remoteedit') {
    throw new Error(`Unsupported URI scheme '${uri.scheme}'.`);
  }

  const connectionId = getQueryValue(uri.query, 'connectionId') || uri.authority;

  if (!connectionId) {
    throw new Error('Missing RemoteEdit connection id in URI.');
  }

  return {
    connectionId,
    remotePath: stripVirtualRoot(uri.path || '/', getQueryValue(uri.query, 'remoteRoot'))
  };
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
