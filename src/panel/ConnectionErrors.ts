import { RemoteEditIncomingMessageType } from './PanelMessages';

export function formatBackupImportError(message: string): string {
  const lower = String(message || '').toLowerCase();

  if (lower.includes('check the export password') || lower.includes('invalid export password') || lower.includes('unable to authenticate data')) {
    return 'Import failed. Invalid export password.';
  }

  return `Import failed. ${message}`;
}

export function isMissingRemoteConnectionError(message: string): boolean {
  const lower = String(message || '').toLowerCase();

  return /no\s+(sftp|ftp|ftps)\s+connection\s+available/.test(lower)
    || /remoteedit connection ['"].+['"] is not connected/.test(lower)
    || lower.includes('connect to a host before browsing or opening remote files')
    || lower.includes('the selected remoteedit connection is not connected')
    || lower.includes('no active connection')
    || lower.includes('no response from server')
    || lower.includes('connection is no longer available')
    || lower.includes('connection closed')
    || lower.includes('connection lost');
}

export function formatMissingRemoteConnectionMessage(details?: string): string {
  const suffix = details ? ` Error: ${details}` : '';
  return `The remote connection is no longer available. Reconnect to continue browsing.${suffix}`;
}

export function isConnectionStateOperation(messageType: string): boolean {
  return messageType === RemoteEditIncomingMessageType.Connect
    || messageType === RemoteEditIncomingMessageType.CancelConnection
    || messageType === RemoteEditIncomingMessageType.Disconnect
    || messageType === RemoteEditIncomingMessageType.SaveConnection
    || messageType === RemoteEditIncomingMessageType.DeleteConnection
    || messageType === RemoteEditIncomingMessageType.RenameConnection
    || messageType === RemoteEditIncomingMessageType.ExportConnectionsSettings
    || messageType === RemoteEditIncomingMessageType.ImportConnectionsSettings
    || messageType === RemoteEditIncomingMessageType.RequestImportConnectionsSettings
    || messageType === RemoteEditIncomingMessageType.PickPrivateKeyPath
    || messageType === RemoteEditIncomingMessageType.PickCaCertificatePath
    || messageType === RemoteEditIncomingMessageType.Ready;
}

export function extractConnectionIdFromError(message: string): string | undefined {
  const match = String(message || '').match(/Remote Edit connection ['"]([^'"]+)['"] is not connected/i);
  return match?.[1];
}
