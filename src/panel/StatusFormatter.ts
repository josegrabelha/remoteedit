import { RemoteEditIncomingMessageType } from './PanelMessages';

export function formatStatusError(messageType: string, rawMessage: string): string {
  const base = getStatusErrorPrefix(messageType);

  if (!base) {
    const reason = formatRealErrorForStatus(rawMessage);
    return compactStatusMessage(reason || rawMessage || 'Operation failed.');
  }

  return formatFailureStatus(base, rawMessage);
}

export function formatFailureStatus(base: string, rawMessage: string): string {
  const reason = formatRealErrorForStatus(rawMessage);

  if (!reason) {
    return `${base}.`;
  }

  const normalizedReason = removeDuplicateStatusPrefix(reason, base);
  return `${base}: ${ensureStatusPunctuation(normalizedReason || reason)}`;
}

function getStatusErrorPrefix(messageType: string): string {
  switch (messageType) {
    case RemoteEditIncomingMessageType.Connect:
      return 'Connection failed';
    case RemoteEditIncomingMessageType.SaveConnection:
      return 'Connection could not be saved';
    case RemoteEditIncomingMessageType.DeleteConnection:
      return 'Connection could not be removed';
    case RemoteEditIncomingMessageType.RenameConnection:
      return 'Connection could not be renamed';
    case RemoteEditIncomingMessageType.Disconnect:
      return 'Disconnect failed';
    case RemoteEditIncomingMessageType.SwitchSession:
      return 'Could not switch connection';
    case RemoteEditIncomingMessageType.EnableSudoMode:
    case RemoteEditIncomingMessageType.DisableSudoMode:
      return 'Sudo Mode could not be changed';
    case RemoteEditIncomingMessageType.ListDirectory:
    case RemoteEditIncomingMessageType.OpenParent:
    case RemoteEditIncomingMessageType.OpenPath:
      return 'Remote path could not be loaded';
    case RemoteEditIncomingMessageType.OpenEntry:
    case RemoteEditIncomingMessageType.OpenEntries:
    case RemoteEditIncomingMessageType.OpenEntriesReadOnly:
      return 'Remote file could not be opened';
    case RemoteEditIncomingMessageType.CompareSelectedEntries:
      return 'Comparison failed';
    case RemoteEditIncomingMessageType.AddRemotePathFavorite:
    case RemoteEditIncomingMessageType.RemoveRemotePathFavorite:
      return 'Favorite could not be updated';
    case RemoteEditIncomingMessageType.RequestCreateFile:
      return 'File could not be created';
    case RemoteEditIncomingMessageType.RequestCreateDirectory:
      return 'Directory could not be created';
    case RemoteEditIncomingMessageType.RequestMakeCopy:
      return 'Copy failed';
    case RemoteEditIncomingMessageType.RequestCalculateChecksums:
      return 'Checksum calculation failed';
    case RemoteEditIncomingMessageType.RequestRenameEntry:
      return 'Rename failed';
    case RemoteEditIncomingMessageType.RequestDeleteEntry:
    case RemoteEditIncomingMessageType.RequestDeleteEntries:
      return 'Delete failed';
    case RemoteEditIncomingMessageType.RequestUploadEntries:
      return 'Upload failed';
    case RemoteEditIncomingMessageType.RequestDownloadEntries:
      return 'Download failed';
    case RemoteEditIncomingMessageType.RequestCompressArchive:
      return 'Archive creation failed';
    case RemoteEditIncomingMessageType.RequestSetPermissions:
    case RemoteEditIncomingMessageType.ApplyPermissions:
      return 'Permissions update failed';
    case RemoteEditIncomingMessageType.RequestChangeOwnerGroup:
      return 'Owner/group change failed';
    case RemoteEditIncomingMessageType.RequestRunRemoteCommand:
      return 'Remote command failed';
    case RemoteEditIncomingMessageType.StopRemoteCommand:
      return 'Remote command could not be stopped';
    case RemoteEditIncomingMessageType.CopyRemotePath:
    case RemoteEditIncomingMessageType.CopyStatus:
      return 'Copy failed';
    default:
      return '';
  }
}

function formatRealErrorForStatus(message: string): string {
  let text = String(message || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (!text) {
    return '';
  }

  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^at\s+/i.test(line));

  text = lines[0] || text;
  text = text
    .replace(/^(?:error|typeerror|rangeerror|referenceerror):\s*/i, '')
    .replace(/^details:\s*/i, '')
    .replace(/^getConnection:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  text = normalizeNoisyStatusError(text);

  return compactStatusReason(text);
}

function normalizeNoisyStatusError(message: string): string {
  const text = String(message || '').trim();

  if (/^all configured authentication methods failed\.?$/i.test(text)) {
    return 'authentication failed';
  }

  return text;
}

function removeDuplicateStatusPrefix(reason: string, base: string): string {
  const text = String(reason || '').trim();

  if (normalizeMessageForComparison(text) === normalizeMessageForComparison(base)) {
    return '';
  }

  const normalizedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^${normalizedBase}\\s*[:.-]\\s*`, 'i'), '').trim();
}

function ensureStatusPunctuation(message: string): string {
  const text = String(message || '').trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function compactStatusReason(message: string): string {
  const compact = String(message || '').trim();
  return compact.length <= 120 ? compact : `${compact.slice(0, 117).trimEnd()}...`;
}

export function extractErrorDetailText(message: string): string {
  const text = String(message || '').trim();
  const match = /\bDetails:\s*([\s\S]*)$/i.exec(text);
  return (match ? match[1] : text).trim();
}

function compactStatusMessage(message: string): string {
  const withoutDetails = String(message || 'Operation failed.').replace(/\s+Details:\s*[\s\S]*$/i, '').trim();
  const compact = withoutDetails || 'Operation failed.';
  return compact.length <= 120 ? compact : `${compact.slice(0, 117).trimEnd()}...`;
}

export function shouldShowStatusOutputLink(messageType: string, rawMessage: string, detailedMessage: string, statusMessage: string): boolean {
  const raw = String(rawMessage || '').trim();

  if (!raw) {
    return false;
  }

  if (/^(select|enter|choose|only|connect to |no active|no connection|the .* cannot|the .* must|a remote .* already exists)/i.test(raw)) {
    return false;
  }

  const normalizedDetails = normalizeMessageForComparison(detailedMessage);
  const normalizedRaw = normalizeMessageForComparison(rawMessage);
  const normalizedStatus = normalizeMessageForComparison(statusMessage);

  return Boolean(
    normalizedDetails &&
    normalizedStatus &&
    normalizedDetails !== normalizedRaw &&
    normalizedDetails !== normalizedStatus &&
    !normalizedStatus.includes(normalizedDetails)
  );
}

export function normalizeMessageForComparison(message: string): string {
  return String(message || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/g, '')
    .trim();
}
