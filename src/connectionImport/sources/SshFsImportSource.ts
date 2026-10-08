import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ImportCandidate } from '../ConnectionImportTypes';
import { candidate, credential, json } from './ImportParsing';

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function extractConfigs(root: any): any[] {
  if (Array.isArray(root)) return root;
  return asArray(root?.['sshfs.configs'] ?? root?.settings?.['sshfs.configs']);
}

function extractConfigPaths(root: any): string[] {
  const value = root?.['sshfs.configpaths'] ?? root?.settings?.['sshfs.configpaths'];
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function resolveConfig(entries: Map<string, any>, name: string, stack: string[] = []): any {
  const own = entries.get(name);
  if (!own) throw new Error(`Missing SSH FS extend target: ${name}`);
  if (stack.includes(name)) throw new Error(`Cyclic SSH FS extend chain: ${[...stack, name].join(' -> ')}`);
  const parents = typeof own.extend === 'string'
    ? [own.extend]
    : Array.isArray(own.extend)
      ? own.extend.filter((v: unknown): v is string => typeof v === 'string')
      : [];
  let merged: any = {};
  for (const parent of parents) merged = { ...merged, ...resolveConfig(entries, parent, [...stack, name]) };
  const { extend: _extend, ...rest } = own;
  return { ...merged, ...rest };
}

export async function parseSshFs(text: string, sourcePath: string): Promise<ImportCandidate[]> {
  const roots: { root: any; path: string }[] = [];
  const warnings: string[] = [];
  const visited = new Set<string>();

  async function loadRoot(content: string, file: string, depth: number): Promise<void> {
    if (depth > 12) throw new Error('SSH FS configpaths nesting limit exceeded.');
    const root = json(content);
    roots.push({ root, path: file });
    for (const configured of extractConfigPaths(root)) {
      const expanded = configured.replace(/^~(?=[/\\]|$)/, os.homedir());
      const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(path.dirname(file), expanded);
      const key = path.normalize(resolved);
      if (visited.has(key)) continue;
      visited.add(key);
      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error();
        await loadRoot(await fs.readFile(resolved, 'utf8'), resolved, depth + 1);
      } catch {
        warnings.push(`SSH FS config path could not be read: ${configured}`);
      }
    }
  }

  visited.add(path.normalize(sourcePath));
  await loadRoot(text, sourcePath, 0);

  const rawEntries: { value: any; path: string }[] = [];
  for (const item of roots) {
    for (const value of extractConfigs(item.root)) {
      if (value && typeof value === 'object') rawEntries.push({ value, path: item.path });
    }
  }
  if (!rawEntries.length) throw new Error('Expected sshfs.configs settings or SSH FS config file.');

  const byName = new Map<string, any>();
  for (const entry of rawEntries) {
    const name = typeof entry.value.name === 'string' ? entry.value.name : '';
    if (name) byName.set(name, entry.value);
  }

  const result: ImportCandidate[] = [];
  for (const entry of rawEntries) {
    const original = entry.value;
    let v = original;
    let resolutionError = '';
    if (original.extend) {
      try {
        const key = typeof original.name === 'string' ? original.name : '';
        if (!key) throw new Error('Extended SSH FS config has no name.');
        v = resolveConfig(byName, key);
      } catch (error) {
        resolutionError = error instanceof Error ? error.message : 'SSH FS inheritance could not be resolved.';
      }
    }

    const internalName = typeof original.name === 'string' ? original.name : typeof v.name === 'string' ? v.name : '';
    const displayName = typeof v.label === 'string' && v.label.trim() ? v.label.trim() : internalName || v.host || 'Unnamed';
    const c = candidate('sshfs', entry.path, displayName, typeof v.host === 'string' ? v.host : '');
    c.alias = internalName || undefined;
    c.group = typeof v.group === 'string' && v.group.trim() ? v.group.trim() : undefined;
    c.profile.port = v.port ?? c.profile.port;
    c.profile.username = typeof v.username === 'string' ? v.username : '';
    c.profile.startPath = typeof v.root === 'string' ? v.root : '';

    const keyPath = typeof v.privateKeyPath === 'string'
      ? v.privateKeyPath
      : typeof v.privateKey === 'string' && !v.privateKey.includes('-----BEGIN')
        ? v.privateKey
        : undefined;
    if (keyPath) {
      c.profile.authType = 'privateKey';
      c.profile.privateKeyPath = keyPath;
    }
    credential(c, v.password, v.passphrase);

    if (typeof v.hop === 'string' && v.hop.trim()) c.jumpAlias = v.hop.trim();
    if (resolutionError) c.unsupported = resolutionError;
    if (!c.profile.host && v.putty) c.unsupported = 'SSH FS PuTTY session references require manual migration of the referenced PuTTY session.';
    if (v.proxy && !c.unsupported) c.unsupported = 'SSH FS HTTP/SOCKS proxy settings are not supported by Remote Edit connections.';
    if (v.sshConfigPath && !c.unsupported) c.unsupported = 'SSH FS sshConfigPath settings require manual resolution.';
    if (typeof v.privateKey === 'string' && v.privateKey.includes('-----BEGIN'))
      c.unsupported = 'Embedded private keys must be saved to a private key file first.';
    if (typeof v.password === 'boolean' || typeof v.passphrase === 'boolean' || v.agent || v.putty)
      c.warnings.push('Interactive/agent authentication is not migrated.');
    c.warnings.push(...warnings);

    c.ignored = Object.keys(v).filter((k) => ![
      'name', 'label', 'group', 'host', 'port', 'username', 'password', 'passphrase',
      'privateKeyPath', 'privateKey', 'root', 'hop', 'extend', 'agent', 'putty',
      'proxy', 'sshConfigPath'
    ].includes(k));
    result.push(c);
  }

  const aliases = new Set(result.map((c) => c.alias).filter((v): v is string => !!v));
  for (const c of result) {
    if (c.jumpAlias && !aliases.has(c.jumpAlias)) c.unsupported = `SSH FS hop target "${c.jumpAlias}" was not found.`;
  }
  return result;
}
