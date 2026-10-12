import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { HostKeySecurityError, normalizeHost, parsePublicKey, type HostKeyIdentity } from './HostKeyVerifier';
import type { KnownHostEntry } from './KnownHosts';

export interface TrustedHost extends KnownHostEntry { port: number; firstTrusted: string; lastVerified: string; }
/** Local installation state; intentionally independent of profiles and backup payloads. */
export class TrustedHostStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly filePath: string) {}
  async list(): Promise<TrustedHost[]> {
    let text: string;
    try { text = await fs.readFile(this.filePath, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new HostKeySecurityError('Cannot read the Remote Edit trusted host store.');
    }
    try {
      const data = JSON.parse(text);
      if (data.version !== 1 || !Array.isArray(data.hosts)) throw new Error();
      const ids = new Set<string>();
      return data.hosts.map((item: TrustedHost) => {
        const parts = item.publicKey.split(' ');
        const identity = parsePublicKey(parts[0], parts[1]);
        if (!item.id || ids.has(item.id) || normalizeHost(item.host) !== item.host || !Number.isInteger(item.port) || item.port < 1 || item.port > 65535 || item.keyType !== identity.keyType || item.fingerprint !== identity.fingerprint || !Number.isFinite(Date.parse(item.firstTrusted)) || !Number.isFinite(Date.parse(item.lastVerified))) throw new Error();
        ids.add(item.id);
        return { ...item, ...identity, source: 'Remote Edit' as const };
      });
    } catch { throw new HostKeySecurityError('The Remote Edit trusted host store is invalid. Resolve it before connecting.'); }
  }
  trust(host: string, port: number, key: HostKeyIdentity, signal?: AbortSignal): Promise<void> {
    return this.mutate(hosts => {
      const matching = hosts.filter(item => item.host === host && item.port === port && item.keyType === key.keyType);
      if (matching.some(item => item.publicKey !== key.publicKey)) throw new HostKeySecurityError('A conflicting Remote Edit key was stored while approval was pending.');
      const now = new Date().toISOString();
      if (matching.length) matching.forEach(item => { item.lastVerified = now; });
      else hosts.push({ ...key, host, port, id: randomUUID(), source: 'Remote Edit', firstTrusted: now, lastVerified: now });
    }, signal);
  }
  replace(previous: KnownHostEntry, key: HostKeyIdentity, signal?: AbortSignal): Promise<void> {
    return this.mutate(hosts => {
      const matching = hosts.filter(item => item.host === previous.host && item.port === previous.port && item.keyType === previous.keyType);
      if (matching.length !== 1 || matching[0].id !== previous.id || matching[0].publicKey !== previous.publicKey || matching[0].firstTrusted !== (previous as TrustedHost).firstTrusted || matching[0].lastVerified !== (previous as TrustedHost).lastVerified) {
        throw new HostKeySecurityError('The trusted host record changed during review. No key was replaced.');
      }
      if (key.keyType !== previous.keyType) throw new HostKeySecurityError('Replacement key algorithm differs from the reviewed record.');
      Object.assign(matching[0], { keyType: key.keyType, publicKey: key.publicKey, fingerprint: key.fingerprint,
        firstTrusted: new Date().toISOString(), lastVerified: new Date().toISOString() });
    }, signal);
  }
  verified(host: string, port: number, key: HostKeyIdentity): Promise<void> {
    return this.mutate(hosts => {
      const entries = hosts.filter(item => item.host === host && item.port === port && item.keyType === key.keyType);
      const matching = entries.filter(item => item.publicKey === key.publicKey);
      if (!matching.length) throw new HostKeySecurityError('The trusted host record was removed or changed during verification. Reconnect to verify it again.');
      matching.forEach(item => { item.lastVerified = new Date().toISOString(); });
    });
  }
  remove(id: string): Promise<void> { return this.mutate(hosts => { const index = hosts.findIndex(item => item.id === id); if (index >= 0) hosts.splice(index, 1); }); }
  private mutate(update: (hosts: TrustedHost[]) => void, signal?: AbortSignal): Promise<void> {
    const work = this.queue.then(async () => {
      if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled. No key was replaced.');
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const lockPath = this.filePath + '.lock';
      let lock: Awaited<ReturnType<typeof fs.open>> | undefined;
      // Coordinate extension windows without overwriting another window's approvals.
      for (let count = 0; count < 50; count++) {
        if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled. No key was replaced.');
        try { lock = await fs.open(lockPath, 'wx', 0o600); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
      }
      if (!lock) throw new HostKeySecurityError('The trusted host store is busy. Retry after the other operation finishes.');
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled. No key was replaced.');
        const hosts = await this.list(); update(hosts);
        const output = await fs.open(temporary, 'wx', 0o600);
        try { await output.writeFile(JSON.stringify({ version: 1, hosts }, null, 2)); await output.sync(); }
        finally { await output.close(); }
        if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled. No key was replaced.');
        await fs.rename(temporary, this.filePath);
      } finally {
        try { await fs.rm(temporary, { force: true }); }
        finally { await lock.close(); await fs.rm(lockPath, { force: true }); }
      }
    });
    this.queue = work.catch(() => undefined);
    return work.catch(error => { if (error instanceof HostKeySecurityError) throw error; throw new HostKeySecurityError('Could not persist Remote Edit trusted hosts. The connection was not approved.'); });
  }
}
