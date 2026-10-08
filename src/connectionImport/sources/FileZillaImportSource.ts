import type { ImportCandidate } from '../ConnectionImportTypes';
import { array, candidate, credential, scalar, xml } from './ImportParsing';
export function parseFileZilla(text: string, path: string): ImportCandidate[] {
  const root = xml(text)?.FileZilla3?.Servers;
  if (!root) throw new Error('Expected FileZilla Site Manager XML.');
  const result: ImportCandidate[] = [];
  function walk(node: any, group: string, depth: number): void {
    if (depth > 30) throw new Error('Folder nesting limit exceeded.');
    for (const s of array<any>(node.Server)) {
      const p = scalar(s.Protocol);
      const c = candidate(
        'filezilla',
        path,
        scalar(s.Name) || scalar(s.Host),
        scalar(s.Host),
        p === '1' ? 'sftp' : ['0', '4'].includes(p) ? 'ftps' : 'ftp'
      );
      c.group = group || undefined;
      if (p === '0')
        c.warnings.push(
          'Opportunistic FTP TLS becomes required explicit TLS in Remote Edit.'
        );
      if (!['0', '1', '4', '6'].includes(p))
        c.unsupported =
          p === '3'
            ? 'Implicit FTPS is not supported by Remote Edit.'
            : 'This FileZilla protocol is not supported.';
      c.profile.port = scalar(s.Port) || c.profile.port;
      c.profile.username = scalar(s.User);
      if (scalar(s.Keyfile)) {
        c.profile.authType = 'privateKey';
        c.profile.privateKeyPath = scalar(s.Keyfile);
      }
      const encoding = s.Pass?.['@_encoding'];
      // FileZilla may wrap base64 XML text. Normalize encoded data only;
      // never strip whitespace from an unencoded/plaintext password.
      const pass = encoding ? scalar(s.Pass).replace(/\s+/g, '') : scalar(s.Pass);
      if (pass) {
        if (encoding === 'base64') {
          if (
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
              pass
            )
          )
            c.warnings.push(
              'Invalid encoded password; enter it after importing.'
            );
          else credential(c, Buffer.from(pass, 'base64').toString('utf8'));
        } else if (!encoding) credential(c, pass);
        else {
          c.credentialNote =
            'Protected password requires the external master password, or continue without credentials.';
          if (encoding === 'crypt' && typeof s.Pass?.['@_pubkey'] === 'string')
            c.lockedCredential = {
              kind: 'filezilla',
              value: pass,
              publicKey: s.Pass['@_pubkey'].replace(/\s+/g, '')
            };
        }
      }
      // FileZilla stores CServerPath as length-prefixed segments, not a literal path.
      const remote = scalar(s.RemoteDir);
      if (remote) {
        const m = /^1 0 ((?:\d+ .*)?)$/.exec(remote);
        if (m) {
          let rest = m[1],
            parts: string[] = [],
            valid = true;
          while (rest) {
            const n = /^(\d+) /.exec(rest);
            if (!n) {
              valid = false;
              break;
            }
            const len = Number(n[1]);
            rest = rest.slice(n[0].length);
            if (len > rest.length) {
              valid = false;
              break;
            }
            parts.push(rest.slice(0, len));
            rest = rest.slice(len).replace(/^ /, '');
          }
          if (valid) c.profile.startPath = '/' + parts.join('/');
          else c.warnings.push('Remote directory encoding was not imported.');
        } else c.warnings.push('Remote directory type was not imported.');
      }
      c.ignored = Object.keys(s).filter(
        (k) =>
          ![
            'Name',
            'Host',
            'Port',
            'Protocol',
            'User',
            'Pass',
            'Keyfile',
            'RemoteDir'
          ].includes(k) && !k.startsWith('@_')
      );
      if (scalar(s.Logontype) === '0') c.profile.username = 'anonymous';
      if (['4', '5'].includes(scalar(s.Logontype)))
        c.warnings.push(
          'Interactive/account authentication needs manual configuration.'
        );
      result.push(c);
    }
    for (const f of array<any>(node.Folder))
      walk(f, [group, scalar(f).trim()].filter(Boolean).join('/'), depth + 1);
  }
  walk(root, '', 0);
  return result;
}
