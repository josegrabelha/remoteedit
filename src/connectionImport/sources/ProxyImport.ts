import type { ImportCandidate } from '../ConnectionImportTypes';
import { normalizeProxyProfile } from '../../proxy/ProxyProfiles';

export function importProxy(c: ImportCandidate, value: any): void {
  if (!value) return;
  const type = ({'4':'socks4','5':'socks5',socks4:'socks4',socks5:'socks5',http:'http',connect:'http'} as Record<string,string>)[String(value.type).toLowerCase()];
  if (!type) { c.unsupported = 'Unsupported proxy configuration; manual migration is required.'; return; }
  try {
    const username = String(value.username ?? value.user ?? '');
    const password = typeof value.password === 'string' ? value.password : undefined;
    c.proxy = {...normalizeProxyProfile({id:'import',name:`${c.profile.name} Proxy`,type:type as any,
      host:value.host,port:Number(value.port),username,authentication:type!=='socks4'&&(username||password)?'password':'none'}),password};
    if (c.proxy.authentication === 'password' && !username) c.warnings.push('Proxy username is unavailable; configure it after importing.');
    if (c.proxy.authentication === 'password' && !password) c.warnings.push('Proxy password is unavailable; configure it after importing.');
  } catch { c.unsupported='Invalid proxy settings; manual migration is required.'; }
}
export function importProxyCommand(c: ImportCandidate, command: string): void {
  // Recognize only a complete, non-shell netcat invocation. Never execute input.
  const match = /^(?:\/usr\/bin\/)?nc\s+-X\s+(4|5|connect)\s+-x\s+([a-zA-Z0-9_.-]+):(\d+)\s+%h\s+%p$/.exec(command.trim());
  if (!match) { c.unsupported='Unsupported ProxyCommand; manual migration is required.'; return; }
  importProxy(c,{type:match[1],host:match[2],port:match[3]});
}
