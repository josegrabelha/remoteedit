import type { ProxyConnection } from '../proxy/ProxyTransport';
import type { ConnectionProfileInput } from '../connection/ConnectionManager';
export const sourceNames = {
  openssh: 'OpenSSH',
  filezilla: 'FileZilla',
  winscp: 'WinSCP',
  putty: 'PuTTY',
  sshfs: 'SSH FS',
  sftp: 'VS Code SFTP'
} as const;
export type SourceId = keyof typeof sourceNames;
export interface ImportCandidate {
  id: string;
  source: SourceId;
  sourcePath: string;
  proxy?: ProxyConnection;
  lockedProxyPassword?: string;
  profile: ConnectionProfileInput;
  group?: string;
  warnings: string[];
  unsupported?: string;
  ignored: string[];
  jumpAlias?: string;
  alias?: string;
  credentialNote?: string;
  lockedCredential?: {
    kind: 'winscp' | 'filezilla';
    value: string;
    publicKey?: string;
  };
}
export interface ImportSource {
  id: SourceId;
  name: string;
  paths: string[];
  status: string;
  count: number;
  error?: string;
}
export type ImportAction = 'skip' | 'replace' | 'new';
export interface ImportDecision {
  id: string;
  action: ImportAction;
  existingId?: string;
}
export interface ImportConnectionResult {
  id: string;
  source: string;
  name: string;
  savedName?: string;
  action: 'Import as New' | 'Replace' | 'Skip';
  status: 'Imported' | 'Skipped' | 'Failed';
  reason: string;
  credentials: string;
  warnings: string[];
  jump?: string;
}
