import { importProxy } from './ProxyImport';
import * as path from 'path';
import type { ImportCandidate } from '../ConnectionImportTypes';
import { candidate, decoded, ini } from './ImportParsing';

/** Both PuTTY's Windows Registry and Unix session files use the same keys. */
function puttyCandidate(
  name: string,
  values: Record<string, string>,
  sourcePath: string
): ImportCandidate | undefined {
  if (name === 'Default Settings') return undefined;
  const c = candidate('putty', sourcePath, name, values.hostname || '');
  c.profile.username = values.username || '';
  c.profile.port = values.portnumber || 22;
  if (values.protocol && values.protocol.toLowerCase() !== 'ssh')
    c.unsupported = 'Only SSH sessions can be imported as SFTP.';
  if (values.publickeyfile) {
    c.profile.authType = 'privateKey';
    c.profile.privateKeyPath = values.publickeyfile;
  }
  if (values.proxymethod && values.proxymethod !== '0')
    importProxy(c,{type:({'1':'socks4','2':'socks5','3':'http'} as Record<string,string>)[values.proxymethod],host:values.proxyhost,port:values.proxyport,username:values.proxyusername,password:values.proxypassword});
  c.credentialNote = 'PuTTY does not export saved passwords.';
  c.ignored = Object.keys(values).filter(
    (key) => !['hostname', 'username', 'portnumber', 'protocol', 'publickeyfile'].includes(key)
  );
  return c;
}

/** PuTTY on Unix saves one key=value file per session, without an INI header. */
function unixSession(text: string, sourcePath: string): ImportCandidate[] {
  const values: Record<string, string> = Object.create(null);
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const entry = /^([^=\r\n]+)=(.*)$/.exec(line);
    if (entry) values[entry[1].toLowerCase()] = entry[2];
  }
  // A saved session must have a host and recognizable PuTTY session settings.
  // This prevents an unrelated selected file from being treated as a session.
  if (
    !values.hostname ||
    !['present', 'protocol', 'portnumber', 'username', 'publickeyfile'].some(
      (key) => Object.hasOwn(values, key)
    )
  ) throw new Error('No PuTTY session found in this file.');
  const name = decoded(path.basename(sourcePath));
  const item = puttyCandidate(name, values, sourcePath);
  if (!item) throw new Error('No importable PuTTY sessions found.');
  return [item];
}

/** Accept .reg exports on all platforms and Unix saved sessions on all platforms. */
export function parsePutty(text: string, sourcePath: string): ImportCandidate[] {
  if (!/^\s*(?:\uFEFF)?\[HKEY_CURRENT_USER\\/im.test(text))
    return unixSession(text, sourcePath);

  const sections = ini(text);
  const result: ImportCandidate[] = [];
  for (const section of sections) {
    if (!/\\PuTTY\\Sessions\\/i.test(section.name)) continue;
    const values: Record<string, string> = Object.create(null);
    for (const [key, value] of Object.entries(section.values)) {
      const normalized = key.replace(/^"|"$/g, '');
      values[normalized] = value.startsWith('dword:')
        ? String(parseInt(value.slice(6), 16))
        : value.replace(/^"|"$/g, '').replace(/\\([\\"])/g, '$1');
    }
    const name = decoded(section.name.split('\\').pop() || '');
    const item = puttyCandidate(name, values, sourcePath);
    if (item) result.push(item);
  }
  if (!result.length)
    throw new Error('No PuTTY sessions found in this registry export.');
  return result;
}
