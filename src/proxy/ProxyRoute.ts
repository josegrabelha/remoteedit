import type { ConnectionCancellationToken } from '../remote/RemoteSessionTypes';
import { openProxyTunnel, type ProxyConnection } from './ProxyTransport';
/** A single proxy precedes the outermost SSH hop. Conflicting routes fail closed. */
export function resolveRouteProxy(target?: ProxyConnection, jumps: readonly { proxy?: ProxyConnection }[] = []): ProxyConnection | undefined {
  const proxies = [target, ...jumps.map(j => j.proxy)].filter((p): p is ProxyConnection => Boolean(p));
  if (proxies.some(p => p.id !== proxies[0].id)) throw new Error('Conflicting proxy profiles in SSH route. Use the same proxy or No Proxy on the other connections.');
  return proxies[0];
}
export async function openProxyWithCancellation(proxy: ProxyConnection, host: string, port: number,
  timeout: number, token?: ConnectionCancellationToken) {
  const controller = new AbortController();
  const subscription = token?.onCancellationRequested(() => controller.abort());
  if (token?.isCancellationRequested) controller.abort();
  try { return await openProxyTunnel(proxy, host, port, timeout, controller.signal); }
  finally { subscription?.dispose(); }
}
