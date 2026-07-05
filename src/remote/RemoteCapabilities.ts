import { normalizeConnectionType, SFTP_CONNECTION_TYPE, type RemoteConnectionType } from './RemoteConnectionTypes';
import { getCapabilityPlatform, type RemotePlatform } from './RemotePlatform';

export interface RemoteCapabilities {
  canUseSudo: boolean;
  canRunCommand: boolean;
  canOpenSshTerminal: boolean;
  canUseServerView: boolean;
  canFollowLogFiles: boolean;
  canChangeOwnerGroup: boolean;
  canChangePermissions: boolean;
  canChangePermissionsRecursively: boolean;
  canCalculateServerChecksums: boolean;
  canCreateArchive: boolean;
  canShowPosixOwnership: boolean;
  canShowPosixPermissions: boolean;
  canShowWindowsFileAttributes: boolean;
}

const SFTP_POSIX_CAPABILITIES: RemoteCapabilities = {
  canUseSudo: true,
  canRunCommand: true,
  canOpenSshTerminal: true,
  canUseServerView: true,
  canFollowLogFiles: true,
  canChangeOwnerGroup: true,
  canChangePermissions: true,
  canChangePermissionsRecursively: true,
  canCalculateServerChecksums: true,
  canCreateArchive: true,
  canShowPosixOwnership: true,
  canShowPosixPermissions: true,
  canShowWindowsFileAttributes: false
};

const SFTP_WINDOWS_CAPABILITIES: RemoteCapabilities = {
  canUseSudo: false,
  canRunCommand: true,
  canOpenSshTerminal: true,
  canUseServerView: true,
  canFollowLogFiles: true,
  canChangeOwnerGroup: false,
  canChangePermissions: false,
  canChangePermissionsRecursively: false,
  canCalculateServerChecksums: true,
  canCreateArchive: false,
  canShowPosixOwnership: false,
  canShowPosixPermissions: false,
  canShowWindowsFileAttributes: true
};

const LIMITED_FILE_TRANSFER_CAPABILITIES: RemoteCapabilities = {
  canUseSudo: false,
  canRunCommand: false,
  canOpenSshTerminal: false,
  canUseServerView: false,
  canFollowLogFiles: false,
  canChangeOwnerGroup: false,
  canChangePermissions: false,
  canChangePermissionsRecursively: false,
  canCalculateServerChecksums: false,
  canCreateArchive: false,
  canShowPosixOwnership: false,
  canShowPosixPermissions: false,
  canShowWindowsFileAttributes: false
};

export function getRemoteCapabilities(
  connectionType: RemoteConnectionType | string | undefined,
  remotePlatform?: RemotePlatform | string
): RemoteCapabilities {
  if (normalizeConnectionType(connectionType) !== SFTP_CONNECTION_TYPE) {
    return { ...LIMITED_FILE_TRANSFER_CAPABILITIES };
  }

  return getCapabilityPlatform(remotePlatform) === 'windows'
    ? { ...SFTP_WINDOWS_CAPABILITIES }
    : { ...SFTP_POSIX_CAPABILITIES };
}
