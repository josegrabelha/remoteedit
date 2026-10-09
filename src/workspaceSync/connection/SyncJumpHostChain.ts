import { openProxyTunnel } from '../../proxy/ProxyTransport';
import type { Socket } from 'net';
import * as fs from 'fs/promises';
import { Client as SshClient } from 'ssh2';
import type { WorkspaceSyncConnectionSnapshot, WorkspaceSyncJumpSnapshot } from './WorkspaceSyncConnectionSnapshot';
import { WorkspaceSyncPassphraseRequiredError, looksLikeMissingPassphrase } from './WorkspaceSyncConnectionErrors';
import { SessionDisconnectedError } from './SessionLifetime';

interface ActiveJump {
  client: SshClient;
}

export class SyncJumpHostChain {
  private disposed = false;
  private proxySocket?: Socket;
  private readonly abort = new AbortController();
  private readonly jumps: ActiveJump[] = [];

  async openTargetSocket(snapshot: WorkspaceSyncConnectionSnapshot): Promise<NodeJS.ReadWriteStream | undefined> {
    if (this.disposed) throw new SessionDisconnectedError();
    if (snapshot.proxy) {
      const first = snapshot.jumpChain[0] || snapshot;
      this.proxySocket = await openProxyTunnel(snapshot.proxy, first.host, first.port, 30000, this.abort.signal);
      if (this.disposed) { this.proxySocket.destroy(); throw new SessionDisconnectedError(); }
    }
    if (!snapshot.jumpChain.length) {
      return this.proxySocket;
    }

    let inboundSocket: NodeJS.ReadWriteStream | undefined = this.proxySocket;
    try {
      for (let index = 0; index < snapshot.jumpChain.length; index += 1) {
        const jump = snapshot.jumpChain[index];
        if (this.disposed) throw new SessionDisconnectedError();
        const client = await connectJump(jump, inboundSocket, client => {
          // Keep an error listener after the handshake listeners are removed.
          // ssh2 also emits runtime errors; pending requests and socket close
          // report their failure, while this prevents an uncaught EventEmitter error.
          client.on('error', () => {});
          this.jumps.push({ client });
        }, () => this.disposed);
        if (this.disposed) throw new SessionDisconnectedError();
        const next = snapshot.jumpChain[index + 1];
        const targetHost = next?.host || snapshot.host;
        const targetPort = next?.port || snapshot.port;
        inboundSocket = await forwardTo(client, targetHost, targetPort, () => this.disposed);
        if (this.disposed) {
          (inboundSocket as any)?.destroy?.();
          throw new SessionDisconnectedError();
        }
      }
      return inboundSocket;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.proxySocket?.destroy();
    for (const jump of [...this.jumps].reverse()) {
      try { jump.client.end(); } catch { /* best effort */ }
      try { jump.client.destroy(); } catch { /* best effort */ }
    }
    this.jumps.length = 0;
  }
}

async function connectJump(
  jump: WorkspaceSyncJumpSnapshot,
  sock: NodeJS.ReadWriteStream | undefined,
  track: (client: SshClient) => void,
  isDisposed: () => boolean
): Promise<SshClient> {
  const client = new SshClient();
  track(client);
  const privateKey = jump.authType === 'privateKey' && jump.privateKeyPath
    ? await fs.readFile(jump.privateKeyPath)
    : undefined;

  try {
    if (isDisposed()) throw new SessionDisconnectedError();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
        client.removeListener('close', onClose);
        if (error) reject(error); else resolve();
      };
      const onReady = (): void => finish();
      const onError = (error: Error): void => finish(error);
      const onClose = (): void => finish(new SessionDisconnectedError());
      client.once('ready', onReady);
      client.once('error', onError);
      client.once('close', onClose);
      try {
        client.connect({
          host: jump.host,
          port: jump.port,
          username: jump.username,
          password: jump.authType === 'password' ? jump.password : undefined,
          privateKey,
          passphrase: jump.authType === 'privateKey' ? jump.passphrase : undefined,
          keepaliveInterval: jump.keepAlive ? 30000 : 0,
          keepaliveCountMax: jump.keepAlive ? 3 : 0,
          readyTimeout: 30000,
          sock: sock as any
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  } catch (error) {
    try { client.destroy(); } catch { /* best effort */ }
    if (jump.authType === 'privateKey' && !jump.passphrase && looksLikeMissingPassphrase(error)) {
      throw new WorkspaceSyncPassphraseRequiredError(jump.profileId, jump.name, true, error);
    }
    throw error;
  }

  return client;
}

function forwardTo(
  client: SshClient,
  host: string,
  port: number,
  isDisposed: () => boolean
): Promise<NodeJS.ReadWriteStream> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, stream?: NodeJS.ReadWriteStream): void => {
      if (settled) {
        (stream as any)?.destroy?.();
        return;
      }
      settled = true;
      client.removeListener('error', onError);
      client.removeListener('close', onClose);
      client.removeListener('end', onClose);
      if (error) {
        (stream as any)?.destroy?.();
        reject(error);
      } else {
        resolve(stream!);
      }
    };
    const onError = (error: Error): void => finish(error);
    const onClose = (): void => finish(new SessionDisconnectedError());
    client.once('error', onError);
    client.once('close', onClose);
    client.once('end', onClose);
    try {
      if (isDisposed()) { onClose(); return; }
      client.forwardOut('127.0.0.1', 0, host, port, (error, stream) => {
        finish(error || (isDisposed() ? new SessionDisconnectedError() : undefined), stream);
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
