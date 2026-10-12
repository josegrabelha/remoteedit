import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { HostKeySecurityError, hostToken, parsePublicKey, type HostKeyIdentity } from './HostKeyVerifier';

export type TrustSource = 'Remote Edit' | 'OpenSSH (User)' | 'OpenSSH (System)';
export interface KnownHostEntry extends HostKeyIdentity {
  id: string; host: string; port?: number; source: TrustSource; filePath?: string; line?: number;
  patterns?: string; marker?: string; fileDigest?: string; removable?: boolean;
}
export interface KnownHostsFile { filePath: string; source: TrustSource; }
export function knownHostsFiles(platform = process.platform, home = os.homedir(), programData = process.env.ProgramData || 'C:\\ProgramData'): KnownHostsFile[] {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  return [
    { filePath: paths.join(home, '.ssh', 'known_hosts'), source: 'OpenSSH (User)' },
    { filePath: platform === 'win32' ? paths.join(programData, 'ssh', 'ssh_known_hosts') : '/etc/ssh/ssh_known_hosts', source: 'OpenSSH (System)' }
  ];
}
export function parseKnownHosts(text: string, file: KnownHostsFile): KnownHostEntry[] {
  const result: KnownHostEntry[] = [];
  const fileDigest = createHash('sha256').update(text).digest('hex');
  text.split(/\r?\n/).forEach((textLine, index) => {
    const trimmed = textLine.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const fields = trimmed.split(/\s+/);
    const marker = fields[0].startsWith('@') ? fields.shift() : undefined;
    const [patterns, type, encoded] = fields;
    if (!patterns || !type || !encoded || (marker && !['@revoked', '@cert-authority'].includes(marker))) {
      throw new HostKeySecurityError(`Unsupported known_hosts entry in ${file.filePath}:${index + 1}.`);
    }
    let identity: HostKeyIdentity;
    try { identity = parsePublicKey(type, encoded); }
    catch { throw new HostKeySecurityError(`Invalid or unsupported public key in ${file.filePath}:${index + 1}.`); }
    for (const pattern of patterns.split(',')) {
      const candidate = pattern.startsWith('!') ? pattern.slice(1) : pattern;
      if (!candidate || (candidate.startsWith('|') && !/^\|1\|[A-Za-z0-9+/]+=*\|[A-Za-z0-9+/]+=*$/.test(candidate))) {
        throw new HostKeySecurityError(`Invalid host pattern in ${file.filePath}:${index + 1}.`);
      }
    }
    const single = /^\[(.+)\]:(\d+)$/.exec(patterns);
    result.push({ ...identity, id: `${file.filePath}:${index + 1}`, patterns, marker,
      host: patterns.startsWith('|') ? 'Hashed host' : single ? single[1] : patterns,
      port: single ? Number(single[2]) : patterns.includes(',') || /[*?!|]/.test(patterns) ? undefined : 22,
      source: file.source, filePath: file.filePath, line: index + 1, fileDigest,
      removable: file.source === 'OpenSSH (User)' && !marker && !/[,!*?]/.test(patterns) });
  });
  return result;
}
function matchesPattern(pattern: string, token: string): boolean {
  if (pattern.startsWith('|')) {
    const [, version, salt, hash] = pattern.split('|');
    if (version !== '1') return false;
    const saltBytes = Buffer.from(salt, 'base64'), expected = Buffer.from(hash, 'base64');
    if (saltBytes.length !== 20 || expected.length !== 20) throw new HostKeySecurityError('Invalid hashed known_hosts entry.');
    const actual = createHmac('sha1', saltBytes).update(token).digest();
    return timingSafeEqual(expected, actual);
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(token);
}
export function matchesKnownHost(entry: KnownHostEntry, host: string, port: number): boolean {
  const token = hostToken(host, port);
  let positive = false;
  for (const pattern of (entry.patterns || '').split(',')) {
    if (pattern.startsWith('!')) { if (matchesPattern(pattern.slice(1), token)) return false; }
    else if (matchesPattern(pattern, token)) positive = true;
  }
  return positive;
}
export class KnownHosts {
  constructor(private readonly files = knownHostsFiles()) {}
  /** Only individual user records can be modified; protected records stay read-only. */
  async assertReplaceable(entry: KnownHostEntry): Promise<void> {
    const file = this.files.find(file => file.source === 'OpenSSH (User)' && file.filePath === entry.filePath);
    if (!file || !entry.removable || entry.marker) throw new HostKeySecurityError('This OpenSSH record cannot be replaced safely. Update it manually after verifying the identity.');
    try {
      const stat = await fs.lstat(file.filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !(stat.mode & 0o200)) throw new Error();
      await fs.access(file.filePath, 2); await fs.access(path.dirname(file.filePath), 2);
    } catch { throw new HostKeySecurityError('The OpenSSH user file or its directory is not writable, or the file is linked. Verify the fingerprint and update the record manually.'); }
  }
  remove(entry: KnownHostEntry): Promise<string> { return this.update(entry); }
  replace(entry: KnownHostEntry, key: HostKeyIdentity, signal?: AbortSignal): Promise<string> {
    if (key.keyType !== entry.keyType) return Promise.reject(new HostKeySecurityError('Replacement key algorithm differs from the reviewed record.'));
    return this.update(entry, key, signal);
  }
  private async update(entry: KnownHostEntry, key?: HostKeyIdentity, signal?: AbortSignal): Promise<string> {
    const file = this.files.find(file => file.source === 'OpenSSH (User)' && file.filePath === entry.filePath);
    if (!file || entry.source !== 'OpenSSH (User)' || !entry.removable || entry.marker || !entry.patterns || /[,!*?]/.test(entry.patterns)) {
      throw new HostKeySecurityError('This OpenSSH record cannot be removed safely.');
    }
    const lockPath = file.filePath + '.remoteedit.lock';
    let lock: Awaited<ReturnType<typeof fs.open>>;
    try { lock = await fs.open(lockPath, 'wx', 0o600); }
    catch { throw new HostKeySecurityError('The OpenSSH user file is busy or its directory is not writable. No key was modified.'); }
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let backupPath: string | undefined;
    try {
      if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled. No key was replaced.');
      const before = await fs.lstat(file.filePath);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !(before.mode & 0o200)) {
        throw new HostKeySecurityError('The OpenSSH user file must be a writable regular file without links. No key was modified.');
      }
      handle = await fs.open(file.filePath, 'r+');
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1) throw new HostKeySecurityError('The OpenSSH user file changed. Refresh the list before modifying.');
      const original = await handle.readFile();
      const text = original.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(original) || createHash('sha256').update(original).digest('hex') !== entry.fileDigest) {
        throw new HostKeySecurityError('The OpenSSH user file changed or has an unsupported encoding. Refresh the list before modifying.');
      }
      const current = parseKnownHosts(text, file).find(item => item.id === entry.id);
      if (!current || !current.removable || current.publicKey !== entry.publicKey || current.patterns !== entry.patterns || current.line !== entry.line) {
        throw new HostKeySecurityError('The selected OpenSSH record changed. Refresh the list before modifying.');
      }
      let start = 0;
      for (let line = 1; line < entry.line!; line++) start = original.indexOf(10, start) + 1;
      const newline = original.indexOf(10, start);
      const end = newline < 0 ? original.length : newline + 1;
      let replacement = Buffer.alloc(0);
      if (key) {
        const line = original.subarray(start, end).toString('utf8');
        // Simple and hashed host tokens stay byte-for-byte intact, including
        // comments, spacing and CRLF. Only the key type/base64 are replaced.
        replacement = Buffer.from(line.replace(/^(\s*\S+\s+)(\S+)(\s+)(\S+)/, (_match, prefix: string, _type: string, space: string) => `${prefix}${key.keyType}${space}${key.publicKey.split(' ')[1]}`), 'utf8');
      }
      const output = Buffer.concat([original.subarray(0, start), replacement, original.subarray(end)]);
      if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled. No key was replaced.');
      const backupCandidate = file.filePath + '.remoteedit-backup-' + randomUUID();
      const backup = await fs.open(backupCandidate, 'wx', 0o600);
      try { await backup.writeFile(original); await backup.sync(); backupPath = backupCandidate; }
      finally {
        try { await backup.close(); }
        finally { if (!backupPath) await fs.rm(backupCandidate, { force: true }); }
      }
      // Keep the original inode: mode, ownership and Windows ACLs remain intact.
      // Sidecar lock coordinates RE windows; recheck external edits before writing.
      const latest = await fs.lstat(file.filePath);
      const bytes = await fs.readFile(file.filePath);
      if (latest.isSymbolicLink() || latest.dev !== opened.dev || latest.ino !== opened.ino || latest.nlink !== 1 || latest.mode !== opened.mode || latest.mtimeMs !== opened.mtimeMs || latest.ctimeMs !== opened.ctimeMs || !bytes.equals(original)) {
        throw new HostKeySecurityError('The OpenSSH user file changed during modification. No key was modified; refresh the list.');
      }
      let written = 0, truncated = false;
      try {
        if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled. No key was replaced.');
        while (written < output.length) {
          if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled.');
          const result = await handle.write(output, written, output.length - written, written);
          if (!result.bytesWritten) throw new Error('Could not write known_hosts.');
          written += result.bytesWritten;
        }
        await handle.truncate(output.length); truncated = true;
        await handle.sync();
        if (!(await fs.readFile(file.filePath)).equals(output)) throw new Error('The OpenSSH file changed during writing.');
      } catch (error) {
        // Restore only our own intermediate content; never overwrite an external edit.
        const intermediate = truncated ? output : Buffer.concat([output.subarray(0, written), original.subarray(written)]);
        const now = await fs.lstat(file.filePath);
        if (now.dev === opened.dev && now.ino === opened.ino && (await fs.readFile(file.filePath)).equals(intermediate)) {
          let restored = 0;
          while (restored < original.length) {
            const result = await handle.write(original, restored, original.length - restored, restored);
            if (!result.bytesWritten) throw new Error('Could not restore known_hosts.');
            restored += result.bytesWritten;
          }
          await handle.truncate(original.length); await handle.sync();
        }
        throw new HostKeySecurityError('Could not complete the update. The original file backup is at ' + backupPath + '.');
      }
      return backupPath;
    } catch (error) {
      if (error instanceof HostKeySecurityError) throw error;
      throw new HostKeySecurityError('Could not safely modify the OpenSSH user file. ' + (backupPath ? 'Original backup: ' + backupPath + '.' : 'No key was modified.'));
    } finally {
      try { await handle?.close(); }
      finally { await lock.close(); await fs.rm(lockPath, { force: true }); }
    }
  }
  async list(): Promise<KnownHostEntry[]> {
    const result: KnownHostEntry[] = [];
    for (const file of this.files) {
      let content: string;
      try { content = await fs.readFile(file.filePath, 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new HostKeySecurityError(`Cannot read ${file.source} file ${file.filePath} (${(error as NodeJS.ErrnoException).code || 'read error'}).`);
      }
      result.push(...parseKnownHosts(content, file));
    }
    return result;
  }
}
