import { normalizeConnectionType, SFTP_CONNECTION_TYPE, type RemoteConnectionType } from './RemoteConnectionTypes';

export interface RemoteCapabilities {
  canUseSudo: boolean;
  canRunCommand: boolean;
  canChangeOwnerGroup: boolean;
  canChangePermissions: boolean;
  canChangePermissionsRecursively: boolean;
  canCalculateServerChecksums: boolean;
  canCreateArchive: boolean;
}

const SFTP_CAPABILITIES: RemoteCapabilities = {
  canUseSudo: true,
  canRunCommand: true,
  canChangeOwnerGroup: true,
  canChangePermissions: true,
  canChangePermissionsRecursively: true,
  canCalculateServerChecksums: true,
  canCreateArchive: true
};

const LIMITED_FILE_TRANSFER_CAPABILITIES: RemoteCapabilities = {
  canUseSudo: false,
  canRunCommand: false,
  canChangeOwnerGroup: false,
  canChangePermissions: false,
  canChangePermissionsRecursively: false,
  canCalculateServerChecksums: false,
  canCreateArchive: false
};

export function getRemoteCapabilities(connectionType: RemoteConnectionType | string | undefined): RemoteCapabilities {
  return normalizeConnectionType(connectionType) === SFTP_CONNECTION_TYPE
    ? { ...SFTP_CAPABILITIES }
    : { ...LIMITED_FILE_TRANSFER_CAPABILITIES };
}
