import { normalizeRemotePath } from '../ssh/SftpSessionManager';
import { RemoteEditIncomingMessageType } from './PanelMessages';

export interface RemoteEditErrorFormatterContext {
  getActivePath: () => string;
  isMissingRemoteConnectionError: (details: string) => boolean;
  formatMissingRemoteConnectionMessage: (details?: string) => string;
}

export function formatRemoteEditError(messageType: string, payload: any, details: string, context: RemoteEditErrorFormatterContext): string {
  if (messageType === RemoteEditIncomingMessageType.Connect) {
    const host = String(payload?.host || '').trim() || 'remote host';
    const port = String(payload?.port || '22').trim() || '22';
    const username = String(payload?.username || '').trim();
    const authType = String(payload?.authType || 'password') === 'privateKey' ? 'private key' : 'password';
    const target = username ? `${username}@${host}:${port}` : `${host}:${port}`;
    const rawProtocol = String(payload?.connectionType || 'sftp').trim().toLowerCase();
    const protocol = rawProtocol.toUpperCase() || 'SFTP';
    const authLabel = rawProtocol === 'ftp' || rawProtocol === 'ftps' ? '' : ` using ${authType} authentication`;
    return `${protocol} connection failed for ${target}${authLabel}. Error: ${details}`;
  }

  if (messageType === RemoteEditIncomingMessageType.SaveConnection) {
    return `Could not save the connection profile. Error: ${details}`;
  }

  if (messageType === RemoteEditIncomingMessageType.DeleteConnection) {
    return `Could not delete the connection profile. Error: ${details}`;
  }

  if (context.isMissingRemoteConnectionError(details)) {
    return context.formatMissingRemoteConnectionMessage(details);
  }

  if (messageType === RemoteEditIncomingMessageType.ListDirectory || messageType === RemoteEditIncomingMessageType.OpenPath) {
    const rawPath = String(payload?.path || context.getActivePath() || '/').trim() || '/';
    const remotePath = normalizeRemotePath(rawPath);
    return `Could not load remote path ${remotePath}. Error: ${details}`;
  }

  if (messageType === RemoteEditIncomingMessageType.OpenEntry) {
    const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : String(payload?.name || 'selected entry');
    return `Could not open remote entry ${entryPath}. Error: ${details}`;
  }

  if (messageType === RemoteEditIncomingMessageType.RequestRenameEntry) {
    const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
    return `Could not rename remote entry ${entryPath}. Error: ${details}`;
  }

  if (messageType === RemoteEditIncomingMessageType.RequestMakeCopy) {
    const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
    return `Could not make a copy of remote file ${entryPath}. Error: ${details}`;
  }

  if (messageType === RemoteEditIncomingMessageType.RequestCalculateChecksums) {
    const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
    return `Could not calculate checksums for remote file ${entryPath}. Error: ${details}`;
  }

  if (messageType === RemoteEditIncomingMessageType.RequestDeleteEntry) {
    const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
    return `Could not delete remote entry ${entryPath}. Error: ${details}`;
  }

  if (messageType === RemoteEditIncomingMessageType.RequestUploadEntries) {
    return `Could not upload selected items. Error: ${details}`;
  }

  if (messageType === RemoteEditIncomingMessageType.RequestDownloadEntries) {
    return `Could not download selected items. Error: ${details}`;
  }

  if (messageType === RemoteEditIncomingMessageType.RequestSetPermissions) {
    const entryPath = payload?.path ? normalizeRemotePath(String(payload.path)) : 'selected entry';
    return `Could not set permissions on remote entry ${entryPath}. Error: ${details}`;
  }

  if (messageType === RemoteEditIncomingMessageType.RequestChangeOwnerGroup) {
    return `Could not change owner/group for selected remote items. Error: ${details}`;
  }

  return details;
}
