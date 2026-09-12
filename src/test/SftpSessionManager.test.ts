import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlledSftp, SftpSessionManager, TestCancellationSource, deferred, flush, harness, options, resetHarness } from './helpers/SftpSessionHarness';

beforeEach(resetHarness);

test('disconnectAll cancels a pending SFTP handshake without late registration', async () => {
  const client = new ControlledSftp();
  const handshake = deferred<void>();
  client.connectWork = () => handshake.promise;
  harness.clients.push(client);
  const manager = new SftpSessionManager();
  const connecting = manager.connect(options());
  await flush();
  await manager.disconnectAll();
  handshake.resolve();
  await assert.rejects(connecting, /cancel/i);
  assert.deepEqual(manager.listConnections(), []);
  assert.ok(client.destroyCount > 0);
});

test('remote close removes the active connection and emits one identity notification', async () => {
  const client = new ControlledSftp();
  harness.clients.push(client);
  const manager = new SftpSessionManager();
  const closed: string[] = [];
  (manager as unknown as { onDidCloseConnection?: (listener: (id: string) => void) => unknown })
    .onDidCloseConnection?.(id => closed.push(id));
  await manager.connect(options());
  for (const name of ['ownerNameCaches', 'groupNameCaches', 'ownerGroupSuggestionCaches', 'sudoPasswords']) {
    (manager as any)[name].set('target', 'synthetic-cache');
  }
  client.client.emit('close');
  await flush();
  assert.equal(manager.hasConnection('target'), false);
  assert.deepEqual(closed, ['target']);
  for (const name of ['sessions', 'connections', 'attempts', 'sessionClosers', 'closingAttempts',
    'ownerNameCaches', 'groupNameCaches', 'ownerGroupSuggestionCaches', 'sudoPasswords',
    'remotePlatforms', 'remoteShells', 'windowsSftpPathStyles']) {
    assert.equal((manager as any)[name].size, 0, name);
  }
});

for (const phase of ['probe', 'handshake', 'platform', 'cwd', 'startPath'] as const) {
  test(`cancellation settles during ${phase} before its delayed result arrives`, async () => {
    const client = new ControlledSftp();
    const gate = deferred<void>();
    if (phase === 'probe') harness.probe = () => gate.promise;
    if (phase === 'handshake') client.connectWork = () => gate.promise;
    if (phase === 'platform') harness.platform = async () => { await gate.promise; return { platform: 'windows', shell: 'cmd' }; };
    if (phase === 'cwd') client.cwdWork = async () => { await gate.promise; return '/old'; };
    if (phase === 'startPath') client.listWork = async () => { await gate.promise; return []; };
    harness.clients.push(client);
    const manager = new SftpSessionManager();
    const token = new TestCancellationSource();
    const rejected = assert.rejects(manager.connect(options(), token.token), /cancel/i);
    await flush();
    token.cancel();
    await rejected;
    assert.deepEqual(manager.listConnections(), []);
    assert.equal((manager as any).attempts.size, 0);
    const replacement = new ControlledSftp();
    harness.clients.push(replacement);
    harness.probe = async () => undefined;
    harness.platform = async () => ({ platform: 'posix', shell: 'sh' });
    const active = await manager.connect(options());
    gate.resolve();
    client.client.emit('close');
    await flush();
    assert.equal(manager.getConnection('target'), active);
    assert.equal((manager as any).remotePlatforms.get('target'), 'posix');
    await manager.disconnectAll();
  });
}

test('immediate disconnect and concurrent same-ID connect respect the latest attempt', async () => {
  const manager = new SftpSessionManager();
  harness.clients.push(new ControlledSftp());
  const cancelled = assert.rejects(manager.connect(options()), /cancel/i);
  await manager.disconnect('target');
  await cancelled;
  harness.clients.push(new ControlledSftp(), new ControlledSftp());
  const older = assert.rejects(manager.connect(options()), /cancel/i);
  const latest = manager.connect(options());
  await older;
  const active = await latest;
  assert.equal(manager.getConnection('target'), active);
  await manager.disconnectAll();
});

test('remote close during initialization rejects before the pending probe finishes', async () => {
  const gate = deferred<void>();
  harness.platform = async () => { await gate.promise; return { platform: 'posix', shell: 'sh' }; };
  const client = new ControlledSftp();
  harness.clients.push(client);
  const manager = new SftpSessionManager();
  const rejected = assert.rejects(manager.connect(options()), /cancel/i);
  await flush();
  client.client.emit('close');
  await rejected;
  gate.resolve();
  assert.deepEqual(manager.listConnections(), []);
});

function jumpOptions(id = 'target') {
  return { ...options(id), jumpProfileId: 'shared-jump', jumpChain: [{
    profileId: 'shared-jump', connectionType: 'sftp' as const, name: 'Shared Jump', host: 'jump.invalid', port: 22,
    username: 'jump-user', authType: 'password' as const, password: 'synthetic-jump-password'
  }] };
}

for (const event of ['end', 'close', 'error'] as const) {
  test(`hidden Jump ${event} removes only its owning target without waiting for keepalive`, async () => {
    const clients = [new ControlledSftp(), new ControlledSftp()];
    harness.clients.push(...clients);
    const manager = new SftpSessionManager();
    const closed: string[] = [];
    manager.onDidCloseConnection(id => closed.push(id));
    await manager.connect(jumpOptions('first'));
    await manager.connect(jumpOptions('second'));
    try {
      harness.jumpClients[0].emit(event, ...(event === 'error' ? [new Error('transport failed')] : []));
      await flush();
      assert.equal(manager.hasConnection('first'), false);
      assert.equal(manager.hasConnection('second'), true);
      assert.deepEqual(closed, ['first']);
      assert.equal(harness.jumpClients[0].destroyCount, 1);
      assert.equal(harness.jumpClients[1].destroyCount, 0);
    } finally {
      await manager.disconnectAll();
    }
  });
}

test('two targets sharing a Jump profile own separate chains and whitelist active snapshots', async () => {
  const clients = [new ControlledSftp(), new ControlledSftp()];
  harness.clients.push(...clients);
  const probes: unknown[] = [];
  harness.probe = async config => { probes.push(config); };
  const manager = new SftpSessionManager();
  const first = await manager.connect(jumpOptions('first'));
  await manager.connect(jumpOptions('second'));
  assert.equal(harness.jumpClients.length, 2);
  assert.equal(probes.length, 2);
  assert.ok(probes.every(probe => (probe as { host: string }).host === 'jump.invalid'));
  assert.equal((clients[0].configs[0] as any).sock, harness.jumpClients[0].streams[0]);
  assert.deepEqual(first.jumpProfileIds, ['shared-jump']);
  assert.ok(!JSON.stringify(first).includes('synthetic'));
  assert.equal('jumpChain' in first, false);
  await manager.disconnect('first');
  assert.equal(harness.jumpClients[0].destroyCount, 1);
  assert.equal(harness.jumpClients[1].destroyCount, 0);
  assert.equal(manager.hasConnection('second'), true);
  await manager.disconnectAll();
});

for (const phase of ['probe', 'ssh', 'forward', 'sftp', 'platform'] as const) {
  test(`Jump ${phase} failure settles and releases owned resources`, async () => {
    const client = new ControlledSftp();
    harness.clients.push(client);
    const failure = new Error(`synthetic ${phase} failure`);
    if (phase === 'probe') harness.probe = async () => { throw failure; };
    if (phase === 'ssh') harness.jumpConnect = client => queueMicrotask(() => client.emit('error', failure));
    if (phase === 'forward') harness.jumpForward = (_client, callback) => queueMicrotask(() => callback(failure));
    if (phase === 'sftp') client.connectWork = async () => { throw failure; };
    if (phase === 'platform') harness.platform = async () => { throw failure; };
    const manager = new SftpSessionManager();
    await assert.rejects(manager.connect(jumpOptions()), /synthetic/);
    assert.deepEqual(manager.listConnections(), []);
    assert.equal((manager as any).attempts.size, 0);
    assert.ok(harness.jumpClients.every(client => client.destroyCount === 1));
  });
}

test('cwd and inaccessible startPath retain the existing fallback behavior', async () => {
  const client = new ControlledSftp();
  client.cwdWork = async () => { throw new Error('cwd failed'); };
  client.listWork = async () => { throw new Error('list denied'); };
  harness.clients.push(client);
  const manager = new SftpSessionManager();
  assert.equal((await manager.connect(options())).startPath, '/');
  await manager.disconnectAll();
});

for (const active of [false, true]) {
  test(`bounded end releases Jump resources for ${active ? 'active disconnect' : 'cancelled handshake'}`, async t => {
    const client = new ControlledSftp();
    client.endWork = () => new Promise(() => {});
    const handshake = deferred<void>();
    if (!active) client.connectWork = () => handshake.promise;
    harness.clients.push(client);
    const manager = new SftpSessionManager();
    const connecting = manager.connect(jumpOptions());
    const result = active ? connecting : assert.rejects(connecting, /cancel/i);
    await flush();
    if (active) await connecting;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const closing = manager.disconnectAll();
    await flush();
    assert.equal(harness.jumpClients[0].destroyCount, 0);
    t.mock.timers.tick(5000);
    await closing;
    await result;
    assert.equal(harness.jumpClients[0].destroyCount, 1);
    assert.equal(client.destroyCount > 0, true);
    handshake.resolve();
    assert.deepEqual(manager.listConnections(), []);
  });
}

test('direct password and private-key authentication use the real auth resolver', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'remoteedit-auth-'));
  const manager = new SftpSessionManager();
  try {
    for (const encrypted of [false, true]) {
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 1024,
        privateKeyEncoding: { format: 'pem', type: 'pkcs1', ...(encrypted ? { cipher: 'aes-256-cbc', passphrase: 'synthetic-passphrase' } : {}) },
        publicKeyEncoding: { format: 'pem', type: 'spki' }
      });
      const keyPath = join(folder, encrypted ? 'encrypted.pem' : 'plain.pem');
      await writeFile(keyPath, privateKey, 'utf8');
      harness.prompt = async () => 'synthetic-passphrase';
      const client = new ControlledSftp();
      harness.clients.push(client);
      await manager.connect({ ...options(), authType: 'privateKey', privateKeyPath: keyPath, password: undefined });
      const config = client.configs[0] as any;
      assert.equal(config.privateKey, privateKey);
      assert.equal(config.passphrase, encrypted ? 'synthetic-passphrase' : undefined);
      assert.equal(config.password, undefined);
      assert.equal(config.sock, undefined);
      await manager.disconnectAll();
    }
    const client = new ControlledSftp();
    harness.clients.push(client);
    await manager.connect(options());
    assert.equal((client.configs[0] as any).password, 'synthetic-password');
    assert.equal(harness.jumpClients.length, 0);
  } finally {
    await manager.disconnectAll();
    await rm(folder, { recursive: true });
  }
});

test('repeated disconnectAll waits for an already closing session', async () => {
  const client = new ControlledSftp();
  const ended = deferred<void>();
  client.endWork = () => ended.promise;
  harness.clients.push(client);
  const manager = new SftpSessionManager();
  await manager.connect(options());
  const first = manager.disconnectAll();
  let secondFinished = false;
  const second = manager.disconnectAll().then(() => { secondFinished = true; });
  await flush();
  assert.equal(secondFinished, false);
  ended.resolve();
  await Promise.all([first, second]);
  assert.equal(client.endCount, 1);
});

test('end throwing synchronously still destroys the final transport', async () => {
  const client = new ControlledSftp();
  client.endWork = () => { throw new Error('synthetic end failure'); };
  harness.clients.push(client);
  const manager = new SftpSessionManager();
  await manager.connect(options());
  await manager.disconnectAll();
  assert.ok(client.destroyCount > 0);
});

for (const phase of ['ssh', 'forward'] as const) {
  test(`manager disconnectAll cancels a pending Jump ${phase}`, async () => {
    const client = new ControlledSftp();
    harness.clients.push(client);
    if (phase === 'ssh') harness.jumpConnect = () => undefined;
    else harness.jumpForward = () => undefined;
    const manager = new SftpSessionManager();
    const cancelled = assert.rejects(manager.connect(jumpOptions()), /cancel/i);
    await flush();
    await manager.disconnectAll();
    await cancelled;
    assert.ok(harness.jumpClients[0].destroyCount >= 1);
    assert.equal(harness.jumpClients[0].listenerCount('error'), 0);
    assert.deepEqual(manager.listConnections(), []);
  });
}

test('a delayed final close releases the Jump chain only after final SFTP end', async () => {
  const client = new ControlledSftp();
  const ended = deferred<void>();
  client.endWork = () => ended.promise;
  harness.clients.push(client);
  const manager = new SftpSessionManager();
  await manager.connect(jumpOptions());
  const closing = manager.disconnectAll();
  await flush();
  assert.equal(client.endCount, 1);
  assert.equal(harness.jumpClients[0].destroyCount, 0);
  client.client.emit('close');
  ended.resolve();
  await closing;
  assert.equal(harness.jumpClients[0].destroyCount, 1);
});
