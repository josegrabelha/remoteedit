import { Client, FTPError, type AccessOptions, type FTPResponse } from 'basic-ftp';
import { parseEpsvResponse, parsePasvResponse } from 'basic-ftp/dist/transfer';
import * as tls from 'tls';
import { openProxyTunnel, type ProxyConnection } from './ProxyTransport';

/** The library retains responsibility for login, TLS and transfer completion. */
export async function accessFtp(client: Client, options: AccessOptions, proxy?: ProxyConnection,
  signal?: AbortSignal): Promise<FTPResponse> {
  if (!proxy) return client.access(options);
  const host = options.host || 'localhost';
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const originalClose = client.close.bind(client);
  client.close = (): void => { abort(); originalClose(); };
  client.connect = async (_host?: string, port = 21): Promise<FTPResponse> => {
    client.ftp.reset();
    const socket = await openProxyTunnel(proxy, host, port, client.ftp.timeout, controller.signal);
    if (controller.signal.aborted) { socket.destroy(); throw new Error('Proxy connection cancelled.'); }
    client.ftp.socket = socket;
    const welcome = client.ftp.handle(undefined, (response, task) => {
      if (response instanceof Error) task.reject(response);
      else if (response.code >= 200 && response.code < 300) task.resolve(response);
      else task.reject(new FTPError(response));
    });
    socket.resume();
    return welcome;
  };
  client.prepareTransfer = async ftp => {
    let response: FTPResponse;
    let port: number;
    try { response = await ftp.request('EPSV'); port = parseEpsvResponse(response.message); }
    catch (error) {
      if (!(error instanceof FTPError) || ![500, 501, 502, 504, 522].includes(error.code)) throw error;
      response = await ftp.request('PASV'); port = parsePasvResponse(response.message).port;
    }
    // Always use the configured server identity, never the proxy peer address or
    // an arbitrary host supplied by PASV (FTP bounce protection).
    const raw = await openProxyTunnel(proxy, host, port, ftp.timeout, controller.signal);
    if (controller.signal.aborted || ftp.closed) { raw.destroy(); throw new Error('FTP connection closed.'); }
    if (ftp.socket instanceof tls.TLSSocket) {
      const data = tls.connect({ ...ftp.tlsOptions, socket: raw,
        session: ftp.tlsSessionStore ?? ftp.socket.getSession() });
      data.on('session', session => { ftp.tlsSessionStore = session; });
      ftp.dataSocket = data;
    } else { ftp.dataSocket = raw; }
    raw.resume();
    return response;
  };
  try {
    if (options.secure === 'implicit') throw new Error('Implicit FTPS through proxy is not supported.');
    return await client.access(options);
  } catch (error) { client.close(); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}
