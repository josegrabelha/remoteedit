import { EventEmitter } from 'node:events';
import * as net from 'node:net';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Client } from 'ssh2';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { PortForwardManager, type SavedPortForwardConfig } from '../ssh/PortForwardManager';

class FakeSshClient extends EventEmitter {
  forwardInCalls: Array<{ host: string; port: number }> = [];
  unforwardInCalls: Array<{ host: string; port: number }> = [];

  forwardIn(host: string, port: number, callback?: (error: Error | undefined, port: number) => void): this {
    this.forwardInCalls.push({ host, port });
    queueMicrotask(() => callback?.(undefined, port));
    return this;
  }

  unforwardIn(host: string, port: number, callback?: (error?: Error) => void): this {
    this.unforwardInCalls.push({ host, port });
    queueMicrotask(() => callback?.(undefined));
    return this;
  }
}

function makeSessions(client: Client): RemoteSessionManager {
  return {
    getConnection: () => ({ connectionType: 'sftp' }),
    getSshClientForTerminal: () => client
  } as unknown as RemoteSessionManager;
}

function baseConfig(overrides: Partial<SavedPortForwardConfig>): SavedPortForwardConfig {
  return {
    id: 'pf-1',
    name: 'test',
    direction: 'remote',
    localHost: '127.0.0.1',
    localPort: 9999,
    remoteHost: '127.0.0.1',
    remotePort: 9000,
    ...overrides
  };
}

async function withEchoServer(run: (port: number) => Promise<void>): Promise<void> {
  const server = net.createServer(socket => socket.pipe(socket));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await run(port);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

class FakeChannel extends EventEmitter {
  written: Buffer[] = [];
  private onWrite?: (chunk: Buffer) => void;

  write(chunk: Buffer, callback?: () => void): boolean {
    this.written.push(Buffer.from(chunk));
    this.onWrite?.(Buffer.from(chunk));
    callback?.();
    return true;
  }

  end(): void {
    this.emit('close');
  }

  pipe<T extends NodeJS.WritableStream>(destination: T): T {
    this.on('data', chunk => destination.write(chunk));
    return destination;
  }

  push(chunk: Buffer): void {
    this.emit('data', chunk);
  }

  waitForWrite(): Promise<Buffer> {
    return new Promise(resolve => { this.onWrite = resolve; });
  }
}

test('remote forward calls forwardIn with the configured bind address/port', async () => {
  const client = new FakeSshClient();
  const manager = new PortForwardManager(makeSessions(client as unknown as Client));
  const config = baseConfig({ remoteHost: '127.0.0.1', remotePort: 9100 });

  const state = await manager.startForward('conn-1', config);

  assert.equal(state.status, 'running');
  assert.deepEqual(client.forwardInCalls, [{ host: '127.0.0.1', port: 9100 }]);

  await manager.stopForward('conn-1', config.id);
});

test('stopping a remote forward calls unforwardIn and detaches the tcp connection listener', async () => {
  const client = new FakeSshClient();
  const manager = new PortForwardManager(makeSessions(client as unknown as Client));
  const config = baseConfig({ remotePort: 9101 });

  await manager.startForward('conn-1', config);
  assert.equal(client.listenerCount('tcp connection'), 1);

  const stopped = await manager.stopForward('conn-1', config.id);

  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(client.unforwardInCalls, [{ host: '127.0.0.1', port: 9101 }]);
  assert.equal(client.listenerCount('tcp connection'), 0);
});

test('an incoming tcp connection for the bound port is piped to the configured local target', async () => {
  await withEchoServer(async localPort => {
    const client = new FakeSshClient();
    const manager = new PortForwardManager(makeSessions(client as unknown as Client));
    const config = baseConfig({ localHost: '127.0.0.1', localPort, remotePort: 9102 });

    await manager.startForward('conn-1', config);

    const channel = new FakeChannel();
    const accept = () => channel as unknown as NodeJS.ReadWriteStream;
    const reject = () => { throw new Error('should not reject a matching forward'); };

    client.emit('tcp connection', { destIP: '127.0.0.1', destPort: 9102, srcIP: '10.0.0.5', srcPort: 5555 }, accept, reject);

    const echoed = channel.waitForWrite();
    channel.push(Buffer.from('ping'));

    const response = await echoed;
    assert.equal(response.toString(), 'ping');

    await manager.stopForward('conn-1', config.id);
  });
});

test('an incoming tcp connection for an unbound port is rejected', async () => {
  const client = new FakeSshClient();
  const manager = new PortForwardManager(makeSessions(client as unknown as Client));
  const config = baseConfig({ remotePort: 9103 });

  await manager.startForward('conn-1', config);

  let rejected = false;
  const accept = () => { throw new Error('should not accept a non-matching forward'); };
  const reject = () => { rejected = true; };

  client.emit('tcp connection', { destIP: '127.0.0.1', destPort: 65432, srcIP: '10.0.0.5', srcPort: 5555 }, accept, reject);

  assert.equal(rejected, true);
  await manager.stopForward('conn-1', config.id);
});

test('two remote forwards on the same connection dispatch independently and only one listener remains after stopping one', async () => {
  const client = new FakeSshClient();
  const manager = new PortForwardManager(makeSessions(client as unknown as Client));
  const configA = baseConfig({ id: 'pf-a', remotePort: 9104 });
  const configB = baseConfig({ id: 'pf-b', remotePort: 9105 });

  await manager.startForward('conn-1', configA);
  await manager.startForward('conn-1', configB);
  assert.equal(client.listenerCount('tcp connection'), 1);

  await manager.stopForward('conn-1', configA.id);
  assert.equal(client.listenerCount('tcp connection'), 1, 'listener should remain while pf-b is still active');

  await manager.stopForward('conn-1', configB.id);
  assert.equal(client.listenerCount('tcp connection'), 0);
});
