import { importProxy } from './ProxyImport';
import type { ImportCandidate } from '../ConnectionImportTypes';
import { candidate, credential, decoded, ini } from './ImportParsing';
// WinSCP's documented storage binds its reversible encoding to UTF-8 user + host.
export function decodeWinScpPassword(
  value: string,
  key: string
): string | undefined {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) return undefined;
  const bytes = Buffer.from(value, 'hex');
  let i = 0;
  const next = () => {
    if (i >= bytes.length) throw new Error();
    return ~(bytes[i++] ^ 0xa3) & 255;
  };
  try {
    const flag = next();
    let length = flag;
    if (flag === 255) {
      const version = next();
      if (version === 0) length = next();
      else if (version === 2) length = next() * 256 + next();
      else return undefined;
    }
    const padding = next();
    i += padding;
    if (length > bytes.length - i) return undefined;
    const decodedBytes = Buffer.from(Array.from({ length }, next));
    const prefix = Buffer.from(key);
    if (flag === 255) {
      if (!decodedBytes.subarray(0, prefix.length).equals(prefix))
        return undefined;
      return decodedBytes.subarray(prefix.length).toString('utf8');
    }
    return decodedBytes.toString('utf8');
  } catch {
    return undefined;
  }
}
export function parseWinScp(text: string, path: string): ImportCandidate[] {
  const sections = ini(text).filter(
    (s) =>
      /^Sessions[\\/]/i.test(s.name) && !/Default%20Settings$/i.test(s.name)
  );
  if (!sections.length) throw new Error('No WinSCP sessions found.');
  return sections.map(({ name, values: v }) => {
    const full = decoded(name.replace(/^Sessions[\\/]/i, '')),
      names = full.split('/');
    const protocol =
      v.fsprotocol === '5'
        ? Number(v.ftps || 0) > 0
          ? 'ftps'
          : 'ftp'
        : 'sftp';
    const c = candidate(
      'winscp',
      path,
      names.pop() || full,
      decoded(v.hostname || ''),
      protocol
    );
    c.group = names.join('/') || undefined;
    if (v.fsprotocol && !['0', '2', '5'].includes(v.fsprotocol))
      c.unsupported = 'Only SFTP and FTP/explicit FTPS sessions are supported.';
    if (v.ftps === '1')
      c.unsupported = 'Implicit FTPS is not supported by Remote Edit.';
    c.profile.username = decoded(v.username || '');
    c.profile.port = v.portnumber || c.profile.port;
    c.profile.startPath = decoded(v.remotedirectory || '');
    if (v.publickeyfile) {
      c.profile.privateKeyPath = decoded(v.publickeyfile);
      c.profile.authType = 'privateKey';
    }
    if (v.password) {
      const pass = decodeWinScpPassword(
        v.password,
        String(c.profile.username) + c.profile.host
      );
      if (pass !== undefined) credential(c, pass);
      else {
        c.credentialNote =
          'Protected or unrecognized password; continue without credentials.';
        if (/^A35D/i.test(v.password))
          c.lockedCredential = { kind: 'winscp', value: v.password };
      }
    }
    if (v.passwordplain) credential(c, decoded(v.passwordplain));
    if (v.proxymethod && v.proxymethod !== '0') {
      const password = v.proxypassword ? decodeWinScpPassword(v.proxypassword, decoded(v.proxyusername || '') + decoded(v.proxyhost || '')) : undefined;
      importProxy(c,{type:({'1':'socks4','2':'socks5','3':'http'} as Record<string,string>)[v.proxymethod],host:decoded(v.proxyhost || ''),port:v.proxyport,username:decoded(v.proxyusername || ''),password:v.proxypasswordplain ? decoded(v.proxypasswordplain) : password});
      if (c.proxy && /^A35D/i.test(v.proxypassword || '')) c.lockedProxyPassword=v.proxypassword;
    }
    if (v.tunnel === '1')
      c.unsupported = 'Tunnel/proxy configuration needs manual migration.';
    c.ignored = Object.keys(v).filter(
      (k) =>
        ![
          'hostname',
          'username',
          'portnumber',
          'remotedirectory',
          'publickeyfile',
          'fsprotocol',
          'ftps',
          'password',
          'passwordplain'
        ].includes(k)
    );
    return c;
  });
}
