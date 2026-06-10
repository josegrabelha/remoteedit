export type RemoteConnectionType = 'sftp' | 'ftps' | 'ftp';

export const SFTP_CONNECTION_TYPE: RemoteConnectionType = 'sftp';
export const DEFAULT_CONNECTION_TYPE: RemoteConnectionType = SFTP_CONNECTION_TYPE;

export function normalizeConnectionType(value: unknown): RemoteConnectionType {
  const normalized = String(value || DEFAULT_CONNECTION_TYPE).trim().toLowerCase();

  if (normalized === 'ftp') {
    return 'ftp';
  }

  if (normalized === 'ftps') {
    return 'ftps';
  }

  return SFTP_CONNECTION_TYPE;
}

export function isSftpConnectionType(value: unknown): boolean {
  const normalized = String(value || SFTP_CONNECTION_TYPE).trim().toLowerCase();
  return normalized === SFTP_CONNECTION_TYPE;
}

export function isKnownConnectionType(value: unknown): boolean {
  if (value === undefined || value === null || String(value).trim() === '') {
    return true;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === 'sftp' || normalized === 'ftps' || normalized === 'ftp';
}

export function getDefaultPortForConnectionType(value: unknown): number {
  return normalizeConnectionType(value) === SFTP_CONNECTION_TYPE ? 22 : 21;
}
