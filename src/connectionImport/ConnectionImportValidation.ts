import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ImportCandidate } from './ConnectionImportTypes';
export async function validateCandidates(
  candidates: ImportCandidate[]
): Promise<ImportCandidate[]> {
  if (candidates.length > 2000)
    throw new Error('Import is limited to 2,000 connections at a time.');
  for (const c of candidates) {
    const p = c.profile;
    if (!['sftp', 'ftp', 'ftps'].includes(String(p.connectionType)))
      c.unsupported = 'Protocol is not supported by Remote Edit.';
    if (
      typeof p.host !== 'string' ||
      !p.host.trim() ||
      /[\s\x00-\x1f/@*?%${}]/.test(p.host)
    )
      c.unsupported = 'Host is missing or requires unresolved configuration.';
    p.port = Number(p.port);
    if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535)
      c.unsupported = 'Port must be between 1 and 65535.';
    for (const field of [
      'name',
      'username',
      'startPath',
      'privateKeyPath'
    ] as const)
      if (
        p[field] !== undefined &&
        (typeof p[field] !== 'string' || /[\x00-\x1f]/.test(p[field]!))
      )
        c.unsupported = 'A connection field has an invalid value.';
    if (p.privateKeyPath) {
      let key = p.privateKeyPath.replace(/^~(?=[/\\]|$)/, os.homedir());
      if (/%[^/\\]*%|\$\{|%[a-z]/i.test(key))
        c.unsupported = 'Private key path contains unresolved variables.';
      if (!path.isAbsolute(key) && !/^[A-Za-z]:[\\/]/.test(key))
        key = path.resolve(path.dirname(c.sourcePath), key);
      p.privateKeyPath = key;
      if (/\.ppk$/i.test(key))
        c.unsupported =
          'Convert the PuTTY private key to OpenSSH format before importing.';
      try {
        await fs.access(key);
      } catch {
        c.warnings.push('Private key file was not found on this machine.');
      }
    }
    if (!p.username) c.warnings.push('Username is missing.');
    if (c.credentialNote) c.warnings.push(c.credentialNote);
    c.warnings = [...new Set(c.warnings)];
  }
  return candidates;
}
