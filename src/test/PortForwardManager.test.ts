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
  nextForwardInError?: Error;
  nextUnforwardInError?: Error;
  deferForwardIn = false;
  pendingForwardIn: Array<{ host: string; port: number; callback?: (error: Error | undefined, port: number) => void }> = [];

  forwardIn(host: string, port: number, callback?: (error: Error | undefined, port: number) => void): this {
    this.forwardInCalls.push({ host, port });
    if (this.deferForwardIn) {
      this.pendingForwardIn.push({ host, port, callback });
      return this;
    }
    const error = this.nextForwardInError;
    this.nextForwardInError = undefined;
    queueMicrotask(() => callback?.(error, port));
    return this;
  }

  resolveNextForwardIn(error?: Error): void {
    const pending = this.pendingForwardIn.shift();
    if (!pending) throw new Error('No pending forwardIn call.');
    queueMicrotask(() => pending.callback?.(error, pending.port));
  }

  unforwardIn(host: string, port: number, callback?: (error?: Error) => void): this {
    this.unforwardInCalls.push({ host, port });
    const error = this.nextUnforwardInError;
    this.nextUnforwardInError = undefined;
    queueMicrotask(() => callback?.(error));
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
  destroyed = false;
  private onWrite?: (chunk: Buffer) => void;

  write(chunk: Buffer, callback?: () => void): boolean {
    this.written.push(Buffer.from(chunk));
    this.onWrite?.(Buffer.from(chunk));
    callback?.();
    return true;
  }

  end(): void {
    this.destroy();
  }

  destroy(error?: Error): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (error) this.emit('error', error);
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




test('stopping while forwardIn is pending cancels a late remote bind without registering a listener', async () => {
  const client = new FakeSshClient();
  client.deferForwardIn = true;
  const manager = new PortForwardManager(makeSessions(client as unknown as Client));
  const config = baseConfig({ remotePort: 9111 });

  const startPromise = manager.startForward('conn-1', config);
  assert.equal(manager.getState('conn-1', config.id).status, 'starting');

  const stopped = await manager.stopForward('conn-1', config.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(client.listenerCount('tcp connection'), 0);

  client.resolveNextForwardIn();
  const startResult = await startPromise;

  assert.equal(startResult.status, 'stopped');
  assert.deepEqual(client.unforwardInCalls, [{ host: '127.0.0.1', port: 9111 }]);
  assert.equal(client.listenerCount('tcp connection'), 0);
  assert.equal(manager.getState('conn-1', config.id).status, 'stopped');
});







test('unforwardIn failure leaves the forward in error state so cleanup can be retried', async () => {
  const client = new FakeSshClient();
  const manager = new PortForwardManager(makeSessions(client as unknown as Client));
  const config = baseConfig({ remotePort: 9114 });

  await manager.startForward('conn-1', config);
  client.nextUnforwardInError = new Error('cancel failed');

  const failedStop = await manager.stopForward('conn-1', config.id);
  assert.equal(failedStop.status, 'error');
  assert.equal(failedStop.error, 'cancel failed');
  assert.equal(manager.getState('conn-1', config.id).status, 'error');

  const stopped = await manager.stopForward('conn-1', config.id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(manager.getState('conn-1', config.id).status, 'stopped');
  assert.equal(client.unforwardInCalls.length, 2);
});
