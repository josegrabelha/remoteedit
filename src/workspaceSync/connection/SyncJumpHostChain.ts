import * as fs from 'fs/promises';
import { Client as SshClient } from 'ssh2';
import type { WorkspaceSyncConnectionSnapshot, WorkspaceSyncJumpSnapshot } from './WorkspaceSyncConnectionSnapshot';
import { WorkspaceSyncPassphraseRequiredError, looksLikeMissingPassphrase } from './WorkspaceSyncConnectionErrors';

interface ActiveJump {
  client: SshClient;
  name: string;
}

export class SyncJumpHostChain {
  private readonly jumps: ActiveJump[] = [];

  async openTargetSocket(snapshot: WorkspaceSyncConnectionSnapshot): Promise<NodeJS.ReadWriteStream | undefined> {
    if (!snapshot.jumpChain.length) {
      return undefined;
    }

    let inboundSocket: NodeJS.ReadWriteStream | undefined;
    try {
      for (let index = 0; index < snapshot.jumpChain.length; index += 1) {
        const jump = snapshot.jumpChain[index];
        const client = await connectJump(jump, inboundSocket);
        this.jumps.push({ client, name: jump.name });
        const next = snapshot.jumpChain[index + 1];
        const targetHost = next?.host || snapshot.host;
        const targetPort = next?.port || snapshot.port;
        inboundSocket = await forwardTo(client, targetHost, targetPort);
      }
      return inboundSocket;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  dispose(): void {
    for (const jump of [...this.jumps].reverse()) {
      try { jump.client.end(); } catch { /* best effort */ }
      try { jump.client.destroy(); } catch { /* best effort */ }
    }
    this.jumps.length = 0;
  }
}

async function connectJump(jump: WorkspaceSyncJumpSnapshot, sock?: NodeJS.ReadWriteStream): Promise<SshClient> {
  const client = new SshClient();
  const privateKey = jump.authType === 'privateKey' && jump.privateKeyPath
    ? await fs.readFile(jump.privateKeyPath)
    : undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
        if (error) reject(error); else resolve();
      };
      const onReady = (): void => finish();
      const onError = (error: Error): void => finish(error);
      client.once('ready', onReady);
      client.once('error', onError);
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

function forwardTo(client: SshClient, host: string, port: number): Promise<NodeJS.ReadWriteStream> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stream as unknown as NodeJS.ReadWriteStream);
    });
  });
}
