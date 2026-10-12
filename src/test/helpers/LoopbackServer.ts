import * as net from 'node:net';
import type { TestContext } from 'node:test';

/** Own every accepted socket, including peers that never finish a handshake. */
export async function listenLoopback(server: net.Server, t?: TestContext) {
  const sockets = new Set<net.Socket>();
  let isClosing = false;
  const track = (socket: net.Socket): void => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    if (isClosing) socket.destroy();
  };
  server.on('connection', track);
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error): void => { server.removeListener('listening', listening); reject(error); };
    const listening = (): void => { server.removeListener('error', failed); resolve(); };
    server.once('error', failed);
    server.once('listening', listening);
    server.listen(0, '127.0.0.1');
  });
  const port = (server.address() as net.AddressInfo).port;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ||= new Promise<void>((resolve, reject) => {
    // Stop accepting peers before destroying existing ones. Graceful SSH end()
    // alone can leave server.close() waiting for a half-open client indefinitely.
    isClosing = true;
    server.close(error => {
      server.removeListener('connection', track);
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
    for (const socket of sockets) socket.destroy();
  });
  t?.after(close);
  return { port, close };
}
