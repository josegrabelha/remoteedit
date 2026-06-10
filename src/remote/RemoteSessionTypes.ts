import type { RemoteConnectionType } from './RemoteConnectionTypes';

export type AuthType = 'password' | 'privateKey';

export interface ConnectOptions {
  connectionId: string;
  connectionType?: RemoteConnectionType;
  name?: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  startPath?: string;
  keepAlive?: boolean;
  ftpsAllowSelfSignedCertificate?: boolean;
  ftpsCaCertificatePath?: string;
}

export interface ConnectionCancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(callback: () => void): { dispose(): void };
}

export type RemoteEntryType = 'file' | 'directory' | 'link' | 'unknown';

export interface RemoteEntry {
  name: string;
  type: RemoteEntryType;
  effectiveType?: RemoteEntryType;
  linkTarget?: string;
  size: number;
  modifyTime: number;
  accessTime: number;
  owner: number | string;
  group: number | string;
  permissions: string;
  path: string;
}

export interface RemoteChecksumValue {
  algorithm: 'SHA-256' | 'MD5';
  value?: string;
  command?: string;
  error?: string;
}

export interface RemoteChecksumSummary {
  sha256: RemoteChecksumValue;
  md5: RemoteChecksumValue;
}

export type RemoteArchiveFormat = 'tar.gz' | 'tar.bz2' | 'tar.xz' | 'tar.Z';

export interface ActiveConnection {
  id: string;
  connectionType: RemoteConnectionType;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string;
  startPath: string;
  keepAlive: boolean;
  ftpsAllowSelfSignedCertificate?: boolean;
  ftpsCaCertificatePath?: string;
}

export interface RemoteCommandStreamingControl {
  stop: () => void;
  forceKill: () => void;
}

export interface RemoteCommandStreamingCallbacks {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onCommand?: (command: string) => void;
  onCommandStatus?: (index: number, code: number) => void;
  onControl?: (control: RemoteCommandStreamingControl) => void;
}

export interface RemoteCommandStreamingResult {
  code: number;
  signal?: string;
}
