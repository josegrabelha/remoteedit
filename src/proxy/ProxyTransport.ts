import { proxyDiagnostic, proxyFailureReason } from './ProxyDiagnostics';
import * as net from 'net';

export type ProxyType = 'socks4' | 'socks5' | 'http';
export interface ProxyProfile {
  id: string;
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  authentication: 'none' | 'password';
  username?: string;
  hasSavedPassword?: boolean;
}
export interface ProxyConnection extends ProxyProfile { password?: string }

/** Returns a paused TCP tunnel. The caller owns it and must resume or consume it. */
export async function openProxyTunnel(proxy: ProxyConnection, host: string, port: number,
  timeoutMs = 30000, signal?: AbortSignal): Promise<net.Socket> {
  if (signal?.aborted) { proxyDiagnostic({type:proxy.type,status:'failed',durationMs:0,reason:'cancelled'}); throw new Error('Proxy connection cancelled.'); }
  if (!host || /[\s\0]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid proxy destination.');
  }
  const started = Date.now();
  proxyDiagnostic({type:proxy.type,status:'connecting',durationMs:0});
  const socket = new net.Socket();
  let buffer: Buffer = Buffer.alloc(0);
  let wake: (() => void) | undefined;
  let failure: Error | undefined;
  const fail = (error: Error): void => { failure = error; socket.destroy(); wake?.(); };
  const onError = (error: NodeJS.ErrnoException): void => fail(new Error(error.code === 'ECONNREFUSED' ? 'Proxy connection refused.' : error.code === 'ETIMEDOUT' ? 'Proxy connection timed out.' : 'Proxy connection failed.'));
  const onClose = (): void => { failure ||= new Error('Proxy closed the connection.'); wake?.(); };
  const onData = (data: Buffer): void => { if (buffer.length + data.length > 65536) { fail(new Error('Proxy handshake response too large.')); return; } buffer = Buffer.concat([buffer, data]); wake?.(); };
  const onAbort = (): void => fail(new Error('Proxy connection cancelled.'));
  const timer = setTimeout(() => fail(new Error('Proxy connection timed out.')), timeoutMs);
  socket.on('error', onError).on('close', onClose).on('data', onData);
  signal?.addEventListener('abort', onAbort, { once: true });
  const read = async (length: number): Promise<Buffer> => {
    while (buffer.length < length) {
      if (failure) throw failure;
      await new Promise<void>(resolve => { wake = resolve; });
      wake = undefined;
    }
    if (failure) throw failure;
    const value = buffer.subarray(0, length); buffer = buffer.subarray(length); return value;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const error = (): void => reject(failure || new Error('Cannot connect to proxy.'));
      socket.once('close', error);
      socket.connect(proxy.port, proxy.host, () => { socket.removeListener('close', error); resolve(); });
    });
    const targetPort = Buffer.alloc(2); targetPort.writeUInt16BE(port);
    if (proxy.type === 'socks4') {
      if (net.isIP(host) === 6) throw new Error('SOCKS4 does not support IPv6 destinations.');
      const user = Buffer.from(proxy.username || '');
      if (user.includes(0)) throw new Error('Invalid SOCKS4 User ID.');
      const ipv4 = net.isIP(host) === 4;
      const address = ipv4 ? Buffer.from(host.split('.').map(Number)) : Buffer.from([0, 0, 0, 1]);
      socket.write(Buffer.concat([Buffer.from([4, 1]), targetPort, address, user, Buffer.from([0]),
        ...(ipv4 ? [] : [Buffer.from(host), Buffer.from([0])])]));
      const response = await read(8);
      if (response[0] !== 0 || response[1] !== 90) throw new Error('SOCKS4 proxy rejected the connection.');
    } else if (proxy.type === 'socks5') {
      const auth = proxy.authentication === 'password';
      socket.write(Buffer.from([5, 1, auth ? 2 : 0]));
      const greeting = await read(2);
      if (greeting[0] !== 5 || greeting[1] !== (auth ? 2 : 0)) throw new Error('SOCKS5 authentication method rejected.');
      if (auth) {
        const user = Buffer.from(proxy.username || ''); const password = Buffer.from(proxy.password || '');
        if (!user.length || user.length > 255 || !password.length || password.length > 255) throw new Error('Invalid SOCKS5 credentials.');
        socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([password.length]), password]));
        const response = await read(2);
        if (response[0] !== 1 || response[1] !== 0) throw new Error('SOCKS5 authentication failed.');
      }
      // Delegate name resolution to the proxy, including textual IPv6 literals.
      const name = Buffer.from(host);
      if (name.length > 255) throw new Error('Proxy destination name is too long.');
      socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, targetPort]));
      const response = await read(4);
      if (response[0] !== 5 || response[1] !== 0 || response[2] !== 0) throw new Error('SOCKS5 proxy rejected the destination.');
      const length = response[3] === 1 ? 4 : response[3] === 4 ? 16 : response[3] === 3 ? (await read(1))[0] : 0;
      if (!length) throw new Error('Invalid SOCKS5 response.');
      await read(length + 2);
    } else if (proxy.type === 'http') {
      const authority = `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`;
      const auth = proxy.authentication === 'password'
        ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username || ''}:${proxy.password || ''}`).toString('base64')}\r\n` : '';
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth}\r\n`);
      let header = '';
      while (!header.endsWith('\r\n\r\n')) {
        if (header.length >= 16384) throw new Error('Proxy response headers too large.');
        header += (await read(1)).toString('latin1');
      }
      const status = /^HTTP\/1\.[01] (\d{3})(?: |\r)/.exec(header)?.[1];
      if (status !== '200') throw new Error(status === '407' ? 'HTTP proxy authentication failed (407).' : 'HTTP proxy rejected CONNECT.');
    } else { throw new Error('Unsupported proxy type.'); }
    socket.pause();
    socket.removeListener('data', onData);
    if (buffer.length) socket.unshift(buffer);
    proxyDiagnostic({type:proxy.type,status:'connected',durationMs:Date.now()-started});
    return socket;
  } catch (error) { proxyDiagnostic({type:proxy.type,status:'failed',durationMs:Date.now()-started,reason:proxyFailureReason(error)}); socket.destroy(); throw error; }
  finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    socket.removeListener('error', onError); socket.removeListener('close', onClose);
  }
}
