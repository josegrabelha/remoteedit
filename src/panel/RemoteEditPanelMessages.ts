export const RemoteEditIncomingMessageType = {
  Ready: 'ready',
  SaveConnection: 'saveConnection',
  PickPrivateKeyPath: 'pickPrivateKeyPath',
  DeleteConnection: 'deleteConnection',
  Connect: 'connect',
  Disconnect: 'disconnect',
  SwitchSession: 'switchSession',
  EnableSudoMode: 'enableSudoMode',
  DisableSudoMode: 'disableSudoMode',
  ListDirectory: 'listDirectory',
  OpenParent: 'openParent',
  OpenEntry: 'openEntry',
  OpenEntries: 'openEntries',
  OpenPath: 'openPath',
  RequestCreateFile: 'requestCreateFile',
  RequestCreateDirectory: 'requestCreateDirectory',
  RequestRenameEntry: 'requestRenameEntry',
  RequestDeleteEntry: 'requestDeleteEntry',
  RequestDeleteEntries: 'requestDeleteEntries',
  RequestSetPermissions: 'requestSetPermissions',
  ApplyPermissions: 'applyPermissions',
  CancelPermissions: 'cancelPermissions',
  ShowOutput: 'showOutput',
  CopyRemotePath: 'copyRemotePath',
  Log: 'log'
} as const;

export const RemoteEditOutboundMessageType = {
  ProfilesLoaded: 'profilesLoaded',
  PrivateKeyPathSelected: 'privateKeyPathSelected',
  SessionsChanged: 'sessionsChanged',
  SudoModeChanged: 'sudoModeChanged',
  Disconnected: 'disconnected',
  DirectoryListed: 'directoryListed',
  ConnectionFormCleared: 'connectionFormCleared',
  ShowPermissionsDialog: 'showPermissionsDialog',
  HidePermissionsDialog: 'hidePermissionsDialog',
  PermissionsValidationError: 'permissionsValidationError',
  Status: 'status',
  Busy: 'busy',
  Error: 'error'
} as const;

export type RemoteEditIncomingMessageType = typeof RemoteEditIncomingMessageType[keyof typeof RemoteEditIncomingMessageType];
export type RemoteEditOutboundMessageType = typeof RemoteEditOutboundMessageType[keyof typeof RemoteEditOutboundMessageType];

export interface RemoteEditWebviewMessage {
  readonly type: RemoteEditIncomingMessageType | string;
  readonly payload?: any;
}
