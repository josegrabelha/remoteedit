import type { ConnectionBackupExportOptions, ConnectionBackupImportOptions, RemoteEditBackupFile, RemoteEditBackupImportResult } from '../connection/ConnectionManager';

export function buildExportResultMessage(_backup: RemoteEditBackupFile, _options: ConnectionBackupExportOptions): string {
  return 'Export completed successfully.';
}

export function buildImportResultMessage(_result: RemoteEditBackupImportResult, _options: ConnectionBackupImportOptions): string {
  return 'Import completed successfully.';
}

export function countBackupFavorites(backup: RemoteEditBackupFile): number {
  return (backup.connections || []).reduce((count, connection) => {
    const favorites = Array.isArray(connection.remotePathFavorites) ? connection.remotePathFavorites : [];
    return count + favorites.length;
  }, 0);
}

export function parseExportOptions(payload: any): ConnectionBackupExportOptions {
  const includeSettings = Boolean(payload.includeSettings);
  const includeConnections = Boolean(payload.includeConnections);
  const includeUsernames = includeConnections && Boolean(payload.includeUsernames);
  const includeCredentials = includeConnections && includeUsernames && Boolean(payload.includeCredentials);

  return {
    includeSettings,
    includeConnections,
    includeFavorites: includeConnections && Boolean(payload.includeFavorites),
    includeUsernames,
    includeCredentials,
    credentialPassword: includeCredentials ? String(payload.credentialPassword || '') : ''
  };
}

export function parseImportOptions(payload: any): ConnectionBackupImportOptions {
  const includeSettings = Boolean(payload.includeSettings);
  const includeConnections = Boolean(payload.includeConnections);
  const includeUsernames = includeConnections && Boolean(payload.includeUsernames);
  const restoreCredentials = includeConnections && includeUsernames && Boolean(payload.restoreCredentials);
  const importMode = payload.importMode === 'replace' ? 'replace' : 'merge';

  return {
    includeSettings,
    includeConnections,
    includeFavorites: includeConnections && Boolean(payload.includeFavorites),
    includeUsernames,
    restoreCredentials,
    credentialPassword: restoreCredentials ? String(payload.credentialPassword || '') : '',
    importMode
  };
}
