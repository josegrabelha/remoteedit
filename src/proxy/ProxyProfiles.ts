import type * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import type { ProxyProfile, ProxyConnection } from './ProxyTransport';
export const PROXY_PROFILES_KEY = 'remoteedit.proxyProfiles';
export const proxySecretKey = (id: string): string => `remoteedit.proxy.${id}.password`;
export function normalizeProxyProfile(input: ProxyProfile): ProxyProfile {
  const profile: ProxyProfile = { id: String(input.id || randomUUID()), name: String(input.name || '').trim(),
    type: input.type, host: String(input.host || '').trim(), port: Number(input.port),
    authentication: input.type === 'socks4' ? 'none' : input.authentication,
    username: String(input.username || '') };
  if (!profile.name || !profile.host || /[\s/\0]/.test(profile.host)) throw new Error('Proxy name and valid host are required.');
  if (!['socks4','socks5','http'].includes(profile.type)) throw new Error('Unsupported proxy type.');
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) throw new Error('Proxy port must be between 1 and 65535.');
  if (!['none','password'].includes(profile.authentication)) throw new Error('Invalid proxy authentication.');
  if (profile.type === 'http' && profile.username?.includes(':')) throw new Error('HTTP proxy username cannot contain a colon.');
  return profile;
}
export class ProxyProfiles {
  constructor(private readonly context: vscode.ExtensionContext) {}
  async list(): Promise<ProxyProfile[]> {
    const profiles = await this.listStored();
    return profiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }
  private async listStored(): Promise<ProxyProfile[]> {
    return Promise.all(this.context.globalState.get<ProxyProfile[]>(PROXY_PROFILES_KEY, []).map(async p => ({
      ...normalizeProxyProfile(p), hasSavedPassword: Boolean(await this.context.secrets.get(proxySecretKey(p.id)))
    })));
  }
  async resolve(id?: string): Promise<ProxyConnection | undefined> {
    if (!id) return undefined;
    const profile = (await this.list()).find(p => p.id === id);
    if (!profile) throw new Error('Selected proxy profile is unavailable. Select another proxy or No Proxy.');
    if (profile.authentication === 'password' && !profile.username) throw new Error('Configure the proxy username.');
    const password = profile.authentication === 'password' ? await this.context.secrets.get(proxySecretKey(id)) : undefined;
    if (profile.authentication === 'password' && !password) throw new Error(`Configure the password for proxy '${profile.name}'.`);
    return {...profile, password};
  }
  async save(input: ProxyProfile & { password?: string }): Promise<ProxyProfile> {
    const profiles = await this.listStored();
    const profile = normalizeProxyProfile(input);
    if (profile.authentication === 'password' && !profile.username) throw new Error('Proxy username is required.');
    if (profiles.some(p => p.id !== profile.id && p.name.toLowerCase() === profile.name.toLowerCase())) throw new Error('A proxy with this name already exists.');
    if (profile.authentication === 'password' && !input.password && !await this.context.secrets.get(proxySecretKey(profile.id))) throw new Error('Proxy password is required.');
    if (profile.authentication === 'none') await this.context.secrets.delete(proxySecretKey(profile.id));
    else if (input.password) await this.context.secrets.store(proxySecretKey(profile.id), input.password);
    await this.context.globalState.update(PROXY_PROFILES_KEY, [...profiles.filter(p=>p.id!==profile.id),profile].map(p=>normalizeProxyProfile(p)));
    return profile;
  }
  async importProfile(input: ProxyConnection): Promise<ProxyProfile> {
    const profile=normalizeProxyProfile(input);
    const profiles=await this.listStored();
    if(input.password) await this.context.secrets.store(proxySecretKey(profile.id),input.password);
    await this.context.globalState.update(PROXY_PROFILES_KEY,[...profiles.map(normalizeProxyProfile),profile]);
    return profile;
  }
  async delete(id: string, references: readonly { proxyProfileId?: string; name: string }[]): Promise<void> {
    const users = references.filter(p=>p.proxyProfileId===id);
    if (users.length) throw new Error(`Proxy is used by ${users.length} saved connection(s). Remove those associations first.`);
    await this.context.globalState.update(PROXY_PROFILES_KEY, (await this.listStored()).filter(p=>p.id!==id).map(p=>normalizeProxyProfile(p)));
    await this.context.secrets.delete(proxySecretKey(id));
  }
}
