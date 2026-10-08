import { candidate, credential, json } from './ImportParsing';
import type { ImportCandidate, SourceId } from '../ConnectionImportTypes';
export function parseVsCodeSftp(
  text: string,
  path: string,
  source: SourceId = 'sftp'
): ImportCandidate[] {
  const root = json(text);
  const entries =
    source === 'sshfs'
      ? (root['sshfs.configs'] ??
        root.settings?.['sshfs.configs'] ??
        (Array.isArray(root) ? root : undefined))
      : Array.isArray(root)
        ? root
        : [root];
  if (!Array.isArray(entries))
    throw new Error(
      'Expected sshfs.configs settings or a configuration array.'
    );
  const expanded: any[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (
      source === 'sftp' &&
      entry.profiles &&
      typeof entry.profiles === 'object'
    ) {
      for (const [name, overrides] of Object.entries(entry.profiles))
        if (overrides && typeof overrides === 'object')
          expanded.push({
            ...entry,
            ...overrides,
            name: (overrides as any).name || name
          });
    } else expanded.push(entry);
  }
  return expanded.map((v) => {
    const protocol = v.protocol || 'sftp';
    const c = candidate(
      source,
      path,
      typeof v.name === 'string' ? v.name : v.host || 'Unnamed',
      typeof v.host === 'string' ? v.host : '',
      protocol === 'ftp' && v.secure === true ? 'ftps' : protocol
    );
    c.profile.port = v.port ?? c.profile.port;
    c.profile.username = typeof v.username === 'string' ? v.username : '';
    c.profile.startPath = v.remotePath ?? v.root ?? '';
    const key =
      v.privateKeyPath ||
      (source === 'sshfs' &&
      typeof v.privateKey === 'string' &&
      !v.privateKey.includes('-----BEGIN')
        ? v.privateKey
        : undefined);
    if (key) {
      c.profile.authType = 'privateKey';
      c.profile.privateKeyPath = key;
    }
    credential(c, v.password, v.passphrase);
    if (v.secure === 'implicit')
      c.unsupported = 'Implicit FTPS is not supported by Remote Edit.';
    if (v.hop || v.proxy || v.sshConfigPath || v.extend)
      c.unsupported =
        'Inherited, SSH-config or proxy settings require manual resolution.';
    if (typeof v.privateKey === 'string' && v.privateKey.includes('-----BEGIN'))
      c.unsupported =
        'Embedded private keys must be saved to a private key file first.';
    c.ignored = Object.keys(v).filter(
      (k) =>
        ![
          'name',
          'host',
          'protocol',
          'port',
          'username',
          'password',
          'passphrase',
          'remotePath',
          'root',
          'privateKeyPath',
          'privateKey',
          'secure',
          'profiles',
          'defaultProfile'
        ].includes(k)
    );
    if (typeof v.password === 'boolean' || v.agent)
      c.warnings.push('Interactive/agent authentication is not migrated.');
    return c;
  });
}
