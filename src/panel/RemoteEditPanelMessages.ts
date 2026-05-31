export const RemoteEditIncomingMessageType = {
  Ready: 'ready',
  SaveConnection: 'saveConnection',
  PickPrivateKeyPath: 'pickPrivateKeyPath',
  DeleteConnection: 'deleteConnection',
  Connect: 'connect',
  CancelConnection: 'cancelConnection',
  Disconnect: 'disconnect',
  SwitchSession: 'switchSession',
  EnableSudoMode: 'enableSudoMode',
  DisableSudoMode: 'disableSudoMode',
  ListDirectory: 'listDirectory',
  RequestBreadcrumbDirectories: 'requestBreadcrumbDirectories',
  OpenParent: 'openParent',
  OpenEntry: 'openEntry',
  OpenEntries: 'openEntries',
  OpenPath: 'openPath',
  AddRemotePathFavorite: 'addRemotePathFavorite',
  RemoveRemotePathFavorite: 'removeRemotePathFavorite',
  RequestCreateFile: 'requestCreateFile',
  RequestCreateDirectory: 'requestCreateDirectory',
  RequestMakeCopy: 'requestMakeCopy',
  RequestCalculateChecksums: 'requestCalculateChecksums',
  RequestRenameEntry: 'requestRenameEntry',
  RequestDeleteEntry: 'requestDeleteEntry',
  RequestDeleteEntries: 'requestDeleteEntries',
  RequestUploadEntries: 'requestUploadEntries',
  RequestDownloadEntries: 'requestDownloadEntries',
  CancelTransfer: 'cancelTransfer',
  RemoveQueuedTransfer: 'removeQueuedTransfer',
  RequestSetPermissions: 'requestSetPermissions',
  ApplyPermissions: 'applyPermissions',
  CancelPermissions: 'cancelPermissions',
  ShowOutput: 'showOutput',
  CopyRemotePath: 'copyRemotePath',
  CopyStatus: 'copyStatus',
  Log: 'log'
} as const;

export const RemoteEditOutboundMessageType = {
  ProfilesLoaded: 'profilesLoaded',
  PrivateKeyPathSelected: 'privateKeyPathSelected',
  SessionsChanged: 'sessionsChanged',
  SudoModeChanged: 'sudoModeChanged',
  Disconnected: 'disconnected',
  DirectoryListed: 'directoryListed',
  BreadcrumbDirectoriesListed: 'breadcrumbDirectoriesListed',
  ConnectionFormCleared: 'connectionFormCleared',
  ShowPermissionsDialog: 'showPermissionsDialog',
  HidePermissionsDialog: 'hidePermissionsDialog',
  PermissionsValidationError: 'permissionsValidationError',
  ShowChecksumsDialog: 'showChecksumsDialog',
  Status: 'status',
  Busy: 'busy',
  StatusCopyFeedback: 'statusCopyFeedback',
  TransferQueueChanged: 'transferQueueChanged',
  Error: 'error'
} as const;

export type RemoteEditIncomingMessageType = typeof RemoteEditIncomingMessageType[keyof typeof RemoteEditIncomingMessageType];
export type RemoteEditOutboundMessageType = typeof RemoteEditOutboundMessageType[keyof typeof RemoteEditOutboundMessageType];

export interface RemoteEditWebviewMessage {
  readonly type: RemoteEditIncomingMessageType | string;
  readonly payload?: any;
}
