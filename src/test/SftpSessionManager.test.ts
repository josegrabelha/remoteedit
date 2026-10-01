import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
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



function jumpOptions(id = 'target') {
  return { ...options(id), jumpProfileId: 'shared-jump', jumpChain: [{
    profileId: 'shared-jump', connectionType: 'sftp' as const, name: 'Shared Jump', host: 'jump.invalid', port: 22,
    username: 'jump-user', authType: 'password' as const, password: 'synthetic-jump-password'
  }] };
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


class ControlledExecStream extends EventEmitter {
  readonly stderr = Object.assign(new EventEmitter(), { resume: () => undefined });
  readonly signals: string[] = [];
  closeCount = 0;
  destroyCount = 0;

  signal(signal: string): void { this.signals.push(signal); }
  resume(): void {}
  pause(): void {}
  end(): void {}
  write(_value: unknown): void {}
  close(): void {
    this.closeCount += 1;
    queueMicrotask(() => this.emit('close', 0, undefined));
  }
  destroy(): void { this.destroyCount += 1; }
}

function streamingMarker(command: string, prefix: string): string {
  const match = command.match(new RegExp(`${prefix}[A-Za-z0-9]+_`));
  assert.ok(match, `Expected ${prefix} marker in controlled streaming command`);
  return match[0];
}



test('streaming stop escalates to KILL and closes an unresponsive SSH channel', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new ControlledSftp();
  harness.clients.push(client);
  const manager = new SftpSessionManager();
  await manager.connect(options());

  const stream = new ControlledExecStream();
  (client.client as any).exec = (_command: string, callback: (error: Error | undefined, stream?: unknown) => void) => {
    callback(undefined, stream);
  };

  let control: { stop(): void; forceKill(): void } | undefined;
  const running = manager.runRemoteCommandStreaming('target', '/', 'sleep 60', {
    onControl: value => { control = value; }
  });
  await flush();

  assert.ok(control);
  control.stop();
  assert.deepEqual(stream.signals, ['TERM']);

  t.mock.timers.tick(1000);
  assert.deepEqual(stream.signals, ['TERM', 'KILL']);
  t.mock.timers.tick(1);
  await flush();
  assert.ok(stream.closeCount > 0 || stream.destroyCount > 0);

  await running;
  await manager.disconnectAll();
});
