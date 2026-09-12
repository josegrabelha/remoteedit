import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import type { ActiveConnection, ConnectOptions } from '../remote/RemoteSessionTypes';
import { ControlledSftp, RemoteSessionRouter, SftpSessionManager, deferred, flush, harness, options, resetHarness } from './helpers/SftpSessionHarness';

beforeEach(resetHarness);

test('Router reports remote SFTP close through its existing UI connection event', async () => {
  const client = new ControlledSftp();
  harness.clients.push(client);
  const router = new RemoteSessionRouter(undefined, new SftpSessionManager());
  const snapshots: number[] = [];
  router.onDidChangeConnections(() => snapshots.push(router.listConnections().length));
  await router.connect(options());
  client.client.emit('close');
  await flush();
  assert.deepEqual(snapshots, [1, 0]);
});

for (const all of [false, true]) {
  test(`Router ${all ? 'disconnectAll' : 'disconnect'} cancels pending SFTP and never adds a late route`, async () => {
    const client = new ControlledSftp();
    const handshake = deferred<void>();
    client.connectWork = () => handshake.promise;
    harness.clients.push(client);
    const router = new RemoteSessionRouter(undefined, new SftpSessionManager());
    const changes: number[] = [];
    router.onDidChangeConnections(() => changes.push(router.listConnections().length));
    const cancelled = assert.rejects(router.connect(options()), /cancel/i);
    await flush();
    if (all) await router.disconnectAll();
    else await router.disconnect('target');
    await cancelled;
    handshake.resolve();
    await flush();
    assert.deepEqual(router.listConnections(), []);
    assert.equal((router as any).sessionRoutes.size, 0);
    assert.deepEqual(changes, []);
  });
}

test('Router notifies once on explicit disconnect and ignores old close after reconnect', async () => {
  const first = new ControlledSftp();
  const second = new ControlledSftp();
  harness.clients.push(first, second);
  const router = new RemoteSessionRouter(undefined, new SftpSessionManager());
  const changes: number[] = [];
  router.onDidChangeConnections(() => changes.push(router.listConnections().length));
  await router.connect(options());
  await router.disconnect('target');
  assert.deepEqual(changes, [1, 0]);
  const active = await router.connect(options());
  first.client.emit('close');
  await flush();
  assert.equal(router.getConnection('target'), active);
  assert.deepEqual(changes, [1, 0, 1]);
  await router.disconnectAll();
  assert.deepEqual(changes, [1, 0, 1, 0]);
});

test('Router handles an immediate disconnect before its manager has started', async () => {
  const router = new RemoteSessionRouter(undefined, new SftpSessionManager());
  const cancelled = assert.rejects(router.connect(options()), /cancel/i);
  await router.disconnectAll();
  await cancelled;
  assert.deepEqual(router.listConnections(), []);
});

test('FTP and FTPS are routed exclusively to the injected FTP manager', async () => {
  const calls: ConnectOptions[] = [];
  const active = new Map<string, ActiveConnection>();
  const ftp = {
    async connect(config: ConnectOptions) {
      calls.push(config);
      const connection = { id: config.connectionId, connectionType: config.connectionType } as ActiveConnection;
      active.set(connection.id, connection);
      return connection;
    },
    async disconnect(id: string) { active.delete(id); },
    async disconnectAll() { active.clear(); },
    getConnection: (id: string) => active.get(id),
    hasConnection: (id: string) => active.has(id),
    listConnections: () => [...active.values()]
  } as RemoteSessionManager;
  const router = new RemoteSessionRouter(undefined, new SftpSessionManager(), ftp);
  for (const connectionType of ['ftp', 'ftps'] as const) {
    await router.connect({ ...options(connectionType), connectionType });
  }
  assert.deepEqual(calls.map(call => call.connectionType), ['ftp', 'ftps']);
  assert.equal(harness.jumpClients.length, 0);
  assert.equal(router.listConnections().length, 2);
  await router.disconnectAll();
});
