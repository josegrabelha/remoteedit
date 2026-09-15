import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Client, ClientChannel, ConnectConfig } from 'ssh2';
import type {
  SshJumpChain as SshJumpChainType,
  SshAuthenticationTarget,
  SshForwardDestination,
  SshJumpChainDependencyOverrides,
  SshJumpRuntimeSettings
} from '../ssh/SshJumpChain';
import type { ConnectionCancellationToken, JumpConnectOptions } from '../remote/RemoteSessionTypes';

// Real ssh2 channel close waits for the readable side to drain, unlike an EventEmitter fake.
const { Channel } = require('ssh2/lib/Channel') as {
  Channel: new (client: unknown, info: unknown) => ClientChannel;
};
const { onCHANNEL_CLOSE } = require('ssh2/lib/utils') as {
  onCHANNEL_CLOSE(client: unknown, id: number, channel: ClientChannel, error: Error, dead: boolean): void;
};

interface NodeModuleLoader {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
}

const nodeModule = require('node:module') as NodeModuleLoader;
const originalModuleLoad = nodeModule._load;
nodeModule._load = (request, parent, isMain) => request === 'vscode'
  ? {}
  : Reflect.apply(originalModuleLoad, nodeModule, [request, parent, isMain]);
const { resolveSshAuthentication, SshJumpChain } = require('../ssh/SshJumpChain') as typeof import('../ssh/SshJumpChain');
nodeModule._load = originalModuleLoad;

type ConnectOutcome =
  | 'ready'
  | 'pending'
  | 'close'
  | { error: Error }
  | { throw: Error };

type ForwardOutcome =
  | 'success'
  | 'pending'
  | 'missing-stream'
  | { error: Error }
  | { throw: Error };

interface ClientPlan {
  readonly id: string;
  readonly connect?: ConnectOutcome;
  readonly forward?: ForwardOutcome;
}

type ForwardCallback = (error: Error | undefined, stream: ClientChannel | undefined) => void;

interface ForwardCall {
  readonly sourceAddress: string;
  readonly sourcePort: number;
  readonly destinationHost: string;
  readonly destinationPort: number;
  readonly callback: ForwardCallback;
  readonly stream?: ControlledStream;
}

class ControlledStream extends EventEmitter {
  destroyCount = 0;
  closed = false;
  destroyError?: Error;

  constructor(
    readonly id: string,
    private readonly events: string[]
  ) {
    super();
  }

  destroy(): this {
    this.destroyCount += 1;
    this.events.push(`stream:${this.id}:destroy`);
    queueMicrotask(() => {
      if (!this.closed) {
        try {
          if (this.destroyError) this.emit('error', this.destroyError);
        } finally {
          this.closed = true;
          this.emit('close');
        }
      }
    });
    return this;
  }

  asChannel(): ClientChannel {
    return this as unknown as ClientChannel;
  }

  resume(): this {
    return this;
  }
}

class ControlledClient extends EventEmitter {
  readonly connectConfigs: ConnectConfig[] = [];
  readonly forwardCalls: ForwardCall[] = [];
  endCount = 0;
  destroyCount = 0;
  closed = false;
  destroyError?: Error;

  constructor(
    readonly plan: ClientPlan,
    private readonly events: string[]
  ) {
    super();
  }

  connect(config: ConnectConfig): void {
    this.connectConfigs.push(config);
    this.events.push(`client:${this.plan.id}:connect`);
    const outcome = this.plan.connect || 'ready';

    if (outcome === 'pending') {
      return;
    }
    if (outcome === 'ready') {
      queueMicrotask(() => this.emit('ready'));
      return;
    }
    if (outcome === 'close') {
      queueMicrotask(() => this.closeTransport());
      return;
    }
    if ('throw' in outcome) {
      throw outcome.throw;
    }

    queueMicrotask(() => this.emit('error', outcome.error));
  }

  forwardOut(
    sourceAddress: string,
    sourcePort: number,
    destinationHost: string,
    destinationPort: number,
    callback: ForwardCallback
  ): void {
    this.events.push(`client:${this.plan.id}:forward:${destinationHost}:${destinationPort}`);
    const outcome = this.plan.forward || 'success';

    if (typeof outcome === 'object' && 'throw' in outcome) {
      throw outcome.throw;
    }

    const stream = outcome === 'success'
      ? new ControlledStream(`${this.plan.id}->${destinationHost}:${destinationPort}`, this.events)
      : undefined;
    this.forwardCalls.push({
      sourceAddress,
      sourcePort,
      destinationHost,
      destinationPort,
      callback,
      stream
    });

    if (outcome === 'pending') {
      return;
    }
    if (outcome === 'missing-stream') {
      queueMicrotask(() => callback(undefined, undefined));
      return;
    }
    if (typeof outcome === 'object' && 'error' in outcome) {
      queueMicrotask(() => callback(outcome.error, undefined));
      return;
    }

    queueMicrotask(() => callback(undefined, stream?.asChannel()));
  }

  end(): void {
    this.endCount += 1;
    this.events.push(`client:${this.plan.id}:end`);
  }

  destroy(): void {
    this.destroyCount += 1;
    this.events.push(`client:${this.plan.id}:destroy`);
    queueMicrotask(() => {
      if (!this.closed) {
        try {
          if (this.destroyError) this.emit('error', this.destroyError);
        } finally {
          this.closeTransport();
        }
      }
    });
  }

  closeTransport(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
    if (this.plan.forward === 'pending') {
      for (const call of this.forwardCalls) call.callback(new Error('No response from server'), undefined);
    }
  }

  asClient(): Client {
    return this as unknown as Client;
  }
}

class ControlledCancellationToken implements ConnectionCancellationToken {
  isCancellationRequested = false;
  disposedSubscriptionCount = 0;
  private readonly listeners = new Set<() => void>();

  onCancellationRequested(callback: () => void): { dispose(): void } {
    this.listeners.add(callback);
    let active = true;

    return {
      dispose: () => {
        if (!active) {
          return;
        }
        active = false;
        this.disposedSubscriptionCount += 1;
        this.listeners.delete(callback);
      }
    };
  }

  cancel(): void {
    if (this.isCancellationRequested) {
      return;
    }
    this.isCancellationRequested = true;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

interface RuntimeHarness {
  readonly chain: SshJumpChainType;
  readonly clients: ControlledClient[];
  readonly probes: Array<{ host: string; port: number; protocolLabel: string }>;
  readonly privateKeyPaths: string[];
  readonly events: string[];
}

const settings: SshJumpRuntimeSettings = {
  readyTimeout: 8000,
  keepAliveInterval: 12000,
  keepAliveCountMax: 4
};

function jump(name: string, overrides: Partial<JumpConnectOptions> = {}): JumpConnectOptions {
  return {
    profileId: name,
    name,
    connectionType: 'sftp',
    host: `${name.toLowerCase()}.jump.test`,
    port: 22,
    username: `${name.toLowerCase()}-user`,
    authType: 'password',
    password: `synthetic-${name}-password`,
    keepAlive: true,
    ...overrides
  };
}

function target(name = 'Target'): SshForwardDestination {
  return {
    kind: 'target',
    name,
    host: `${name.toLowerCase()}.internal.test`,
    port: 22
  };
}

function createHarness(plans: readonly ClientPlan[], probeError?: Error, onUnexpectedClose?: () => void): RuntimeHarness {
  const clients: ControlledClient[] = [];
  const probes: RuntimeHarness['probes'] = [];
  const privateKeyPaths: string[] = [];
  const events: string[] = [];
  let planIndex = 0;

  const dependencies: SshJumpChainDependencyOverrides = {
    onUnexpectedClose,
    createClient: () => {
      const plan = plans[planIndex];
      planIndex += 1;
      if (!plan) {
        throw new Error('No controlled client plan remains.');
      }
      const client = new ControlledClient(plan, events);
      clients.push(client);
      return client.asClient();
    },
    probe: async options => {
      probes.push({ host: options.host, port: options.port, protocolLabel: options.protocolLabel });
      if (probeError) {
        throw probeError;
      }
    },
    readPrivateKey: async keyPath => {
      privateKeyPaths.push(keyPath);
      return 'synthetic-private-key-data';
    },
    parsePrivateKey: () => ({}) as never,
    promptPassphrase: async () => undefined
  };

  return {
    chain: new SshJumpChain(settings, dependencies),
    clients,
    probes,
    privateKeyPaths,
    events
  };
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.fail(message);
}

for (const resourceKind of ['client', 'stream'] as const) {
  test(`notifies the owner once when an open Jump ${resourceKind} ends and removes its listeners on disposal`, async () => {
    let notifications = 0;
    const harness = createHarness([{ id: 'D' }, { id: 'C' }], undefined, () => notifications++);
    await harness.chain.open([jump('D'), jump('C')], target('A'));
    const resource = resourceKind === 'client' ? harness.clients[1] : harness.clients[0].forwardCalls[0].stream!;
    resource.emit('end');
    resource.emit('error', new Error('late transport error'));
    assert.equal(notifications, 1);
    await harness.chain.dispose();
    assert.equal(notifications, 1);
    for (const client of harness.clients) {
      for (const owned of [client, ...client.forwardCalls.map(call => call.stream!)]) {
        assert.equal(owned.listenerCount('end'), 0);
        assert.equal(owned.listenerCount('error'), 0);
        assert.equal(owned.listenerCount('close'), 0);
      }
    }
  });
}

test('intentional disposal does not notify an unexpected Jump close', async () => {
  let notifications = 0;
  const harness = createHarness([{ id: 'D' }], undefined, () => notifications++);
  await harness.chain.open([jump('D')], target('A'));
  await harness.chain.dispose();
  assert.equal(notifications, 0);
});

test('opens three hidden SSH hops in order and disposes streams/clients in reverse once', async () => {
  const harness = createHarness([
    { id: 'D' },
    { id: 'C' },
    { id: 'B' }
  ]);
  const hops = [
    jump('D'),
    jump('C', { keepAlive: false }),
    jump('B', {
      authType: 'privateKey',
      password: undefined,
      privateKeyPath: '/fixtures/b-key',
      passphrase: 'synthetic-b-passphrase'
    })
  ];
  const finalTarget = target('A');

  const finalStream = await harness.chain.open(hops, finalTarget);

  assert.deepEqual(harness.probes, [{ host: 'd.jump.test', port: 22, protocolLabel: 'ssh' }]);
  assert.deepEqual(harness.clients.map(client => client.plan.id), ['D', 'C', 'B']);
  assert.deepEqual(harness.clients.map(client => client.connectConfigs[0].host), [
    'd.jump.test',
    'c.jump.test',
    'b.jump.test'
  ]);

  const firstStream = harness.clients[0].forwardCalls[0].stream;
  const secondStream = harness.clients[1].forwardCalls[0].stream;
  const thirdStream = harness.clients[2].forwardCalls[0].stream;
  assert.ok(firstStream && secondStream && thirdStream);
  assert.equal(harness.clients[0].connectConfigs[0].sock, undefined);
  assert.equal(harness.clients[1].connectConfigs[0].sock, firstStream.asChannel());
  assert.equal(harness.clients[2].connectConfigs[0].sock, secondStream.asChannel());
  assert.equal(finalStream, thirdStream.asChannel());

  assert.deepEqual(harness.clients.flatMap(client => client.forwardCalls.map(call => ({
    sourceAddress: call.sourceAddress,
    sourcePort: call.sourcePort,
    destinationHost: call.destinationHost,
    destinationPort: call.destinationPort
  }))), [
    { sourceAddress: '127.0.0.1', sourcePort: 0, destinationHost: 'c.jump.test', destinationPort: 22 },
    { sourceAddress: '127.0.0.1', sourcePort: 0, destinationHost: 'b.jump.test', destinationPort: 22 },
    { sourceAddress: '127.0.0.1', sourcePort: 0, destinationHost: 'a.internal.test', destinationPort: 22 }
  ]);

  assert.equal(harness.clients[0].connectConfigs[0].keepaliveInterval, settings.keepAliveInterval);
  assert.equal(harness.clients[0].connectConfigs[0].keepaliveCountMax, settings.keepAliveCountMax);
  assert.equal(harness.clients[1].connectConfigs[0].keepaliveInterval, undefined);
  assert.equal(harness.clients[1].connectConfigs[0].keepaliveCountMax, undefined);
  assert.equal(harness.clients[2].connectConfigs[0].privateKey, 'synthetic-private-key-data');
  assert.equal(harness.clients[2].connectConfigs[0].passphrase, 'synthetic-b-passphrase');
  assert.deepEqual(harness.privateKeyPaths, ['/fixtures/b-key']);

  const firstDispose = harness.chain.dispose();
  const secondDispose = harness.chain.dispose();
  assert.equal(firstDispose, secondDispose);
  await firstDispose;

  assert.deepEqual(harness.events.filter(event => event.includes(':destroy') || event.includes(':end')), [
    'stream:B->a.internal.test:22:destroy',
    'client:B:end',
    'client:B:destroy',
    'stream:C->b.jump.test:22:destroy',
    'client:C:end',
    'client:C:destroy',
    'stream:D->c.jump.test:22:destroy',
    'client:D:end',
    'client:D:destroy'
  ]);
  for (const client of harness.clients) {
    assert.equal(client.endCount, 1);
    assert.equal(client.destroyCount, 1);
    assert.equal(client.listenerCount('error'), 0);
  }
  for (const stream of [firstStream, secondStream, thirdStream]) {
    assert.equal(stream.destroyCount, 1);
    assert.equal(stream.listenerCount('error'), 0);
  }
});

test('reports an outermost probe failure before creating any SSH client', async () => {
  const harness = createHarness([], new Error('unreachable'));

  await assert.rejects(harness.chain.open([jump('D')], target()), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Jump profile "D" \(d\.jump\.test:22\)/);
    assert.match(error.message, /checking TCP reachability/);
    assert.match(error.message, /unreachable/);
    return true;
  });

  assert.equal(harness.clients.length, 0);
  assert.equal(harness.probes.length, 1);
});

test('keeps error guards until asynchronous client and stream close', async () => {
  const harness = createHarness([{ id: 'D' }]);
  const stream = await harness.chain.open([jump('D')], target()) as unknown as ControlledStream;
  stream.destroyError = new Error('synthetic late channel error');
  harness.clients[0].destroyError = new Error('synthetic late socket error');
  await harness.chain.dispose();
  assert.equal(stream.closed, true);
  assert.equal(harness.clients[0].closed, true);
  for (const resource of [stream, harness.clients[0]]) {
    assert.equal(resource.listenerCount('error'), 0);
    assert.equal(resource.listenerCount('close'), 0);
  }
});

test('transport close settles a pending forward using ssh2 channel cleanup semantics', async () => {
  const harness = createHarness([{ id: 'D', forward: 'pending' }]);
  const open = harness.chain.open([jump('D')], target());
  await waitFor(() => harness.clients[0]?.forwardCalls.length === 1, 'Forward not pending.');
  harness.clients[0].closeTransport();
  await assert.rejects(open, /opening a forward.*No response from server/);
  assert.equal(harness.clients[0].listenerCount('error'), 0);
});

test('dispose waits for stream close instead of resolving after destroy was called', async () => {
  const harness = createHarness([{ id: 'D' }]);
  const stream = await harness.chain.open([jump('D')], target()) as unknown as ControlledStream;
  stream.destroy = () => { stream.destroyCount += 1; return stream; };
  let disposed = false;
  const disposal = harness.chain.dispose().then(() => { disposed = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(disposed, false);
  assert.doesNotThrow(() => stream.emit('error', new Error('synthetic delayed error')));
  stream.closed = true;
  stream.emit('close');
  await disposal;
  assert.equal(stream.listenerCount('error'), 0);
  assert.equal(stream.listenerCount('close'), 0);
});

test('disposes clients that close before ready or throw before starting', async () => {
  for (const connect of ['close', { throw: new Error('synthetic invalid config') }] as const) {
    const harness = createHarness([{ id: 'D', connect }]);
    await assert.rejects(harness.chain.open([jump('D')], target()), /establishing the SSH connection/);
    await harness.chain.dispose();
    assert.equal(harness.clients[0].listenerCount('error'), 0);
    assert.equal(harness.clients[0].listenerCount('close'), 0);
  }
});

test('explicit disposal settles a pending SSH attempt and releases its subscription', async () => {
  const harness = createHarness([{ id: 'D', connect: 'pending' }]);
  const token = new ControlledCancellationToken();
  const open = harness.chain.open([jump('D')], target(), token);
  await waitFor(() => harness.clients[0]?.connectConfigs.length === 1, 'Connect not pending.');
  const rejected = assert.rejects(open);
  await harness.chain.dispose();
  await rejected;
  assert.equal(token.listenerCount, 0);
});

test('disposes a real ssh2 forwarding channel with unread buffered data', { timeout: 1000 }, async () => {
  const client = new EventEmitter();
  const channel = new Channel(client, {
    type: 'direct-tcpip',
    incoming: { id: 0, state: 'open', window: 65536, packetSize: 32768 },
    outgoing: { id: 0, state: 'open', window: 65536, packetSize: 32768 }
  });
  const initialCloseListeners = channel.listeners('close');
  Object.assign(client, {
    _protocol: { channelClose() {}, channelEOF() {} },
    _chanMgr: { remove() {} },
    connect: () => queueMicrotask(() => client.emit('ready')),
    forwardOut: (_a: string, _b: number, _c: string, _d: number, callback: ForwardCallback) => {
      callback(undefined, channel);
    },
    end() {},
    destroy: () => queueMicrotask(() => {
      client.emit('close');
      onCHANNEL_CLOSE(client, 0, channel, new Error('transport closed'), true);
    })
  });
  const chain = new SshJumpChain(settings, {
    createClient: () => client as unknown as Client,
    probe: async () => undefined,
    promptPassphrase: async () => undefined
  });
  await chain.open([jump('D')], target());
  channel.push(Buffer.from('unread SSH banner'));
  await chain.dispose();
  assert.equal(channel.readableEnded, true);
  assert.equal(channel.listenerCount('error'), 0);
  assert.deepEqual(channel.listeners('close'), initialCloseListeners);
});

test('reports an intermediate SSH connect failure and releases prior resources', async () => {
  const harness = createHarness([
    { id: 'D' },
    { id: 'C', connect: { error: new Error('authentication rejected') } }
  ]);

  await assert.rejects(harness.chain.open([jump('D'), jump('C')], target()), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Jump profile "C" \(c\.jump\.test:22\)/);
    assert.match(error.message, /establishing the SSH connection/);
    assert.match(error.message, /authentication rejected/);
    assert.doesNotMatch(error.message, /synthetic-.*-password/);
    return true;
  });

  const firstStream = harness.clients[0].forwardCalls[0].stream;
  assert.ok(firstStream);
  assert.equal(firstStream.destroyCount, 1);
  assert.deepEqual(harness.clients.map(client => client.endCount), [1, 1]);
  assert.deepEqual(harness.clients.map(client => client.destroyCount), [1, 1]);
  assert.deepEqual(harness.clients.map(client => client.listenerCount('error')), [0, 0]);
});

test('reports a forward failure with the current hop and destination, then cleans up', async () => {
  const harness = createHarness([
    { id: 'D', forward: { error: new Error('administratively prohibited') } }
  ]);

  await assert.rejects(harness.chain.open([jump('D')], target('A')), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Jump profile "D" \(d\.jump\.test:22\)/);
    assert.match(error.message, /opening a forward to Target "A" \(a\.internal\.test:22\)/);
    assert.match(error.message, /administratively prohibited/);
    return true;
  });

  assert.equal(harness.clients[0].endCount, 1);
  assert.equal(harness.clients[0].destroyCount, 1);
  assert.equal(harness.clients[0].listenerCount('error'), 0);
});

test('cancels a pending SSH connect and removes cancellation/listener state', async () => {
  const harness = createHarness([{ id: 'D', connect: 'pending' }]);
  const cancellation = new ControlledCancellationToken();
  const openPromise = harness.chain.open([jump('D')], target(), cancellation);
  await waitFor(
    () => harness.clients.length === 1 && harness.clients[0].connectConfigs.length === 1,
    'The controlled client did not enter its pending connect state.'
  );

  cancellation.cancel();
  await assert.rejects(openPromise, /Connection cancelled/);

  assert.equal(cancellation.listenerCount, 0);
  assert.ok(cancellation.disposedSubscriptionCount >= 1);
  assert.equal(harness.clients[0].endCount, 1);
  assert.ok(harness.clients[0].destroyCount >= 1);
  assert.equal(harness.clients[0].listenerCount('ready'), 0);
  assert.equal(harness.clients[0].listenerCount('close'), 0);
  assert.equal(harness.clients[0].listenerCount('error'), 0);
});

test('cancels a pending forward and destroys a stream returned after cancellation', async () => {
  const harness = createHarness([{ id: 'D', forward: 'pending' }]);
  const cancellation = new ControlledCancellationToken();
  const openPromise = harness.chain.open([jump('D')], target(), cancellation);
  await waitFor(
    () => harness.clients.length === 1 && harness.clients[0].forwardCalls.length === 1,
    'The controlled client did not enter its pending forward state.'
  );

  const pendingForward = harness.clients[0].forwardCalls[0];
  cancellation.cancel();
  await assert.rejects(openPromise, /Connection cancelled/);

  const lateStream = new ControlledStream('late-forward', harness.events);
  lateStream.destroyError = new Error('synthetic late forwarding error');
  pendingForward.callback(undefined, lateStream.asChannel());
  await new Promise<void>(resolve => setImmediate(resolve));

  assert.equal(lateStream.destroyCount, 1);
  assert.equal(lateStream.closed, true);
  assert.equal(lateStream.listenerCount('error'), 0);
  assert.equal(lateStream.listenerCount('close'), 0);
  assert.equal(cancellation.listenerCount, 0);
  assert.ok(cancellation.disposedSubscriptionCount >= 1);
  assert.equal(harness.clients[0].endCount, 1);
  assert.ok(harness.clients[0].destroyCount >= 1);
  assert.equal(harness.clients[0].listenerCount('error'), 0);
});

test('resolves synthetic password/private-key auth and treats a canceled passphrase prompt as cancellation', async () => {
  const passwordTarget: SshAuthenticationTarget = {
    kind: 'jump',
    profileId: 'password-hop',
    name: 'Password Hop',
    host: 'password.jump.test',
    port: 22,
    username: 'fixture-user',
    authType: 'password',
    password: 'synthetic-password'
  };
  assert.deepEqual(await resolveSshAuthentication(passwordTarget, undefined, {
    promptPassphrase: async () => undefined
  }), { password: 'synthetic-password' });

  const keyTarget: SshAuthenticationTarget = {
    ...passwordTarget,
    profileId: 'key-hop',
    name: 'Key Hop',
    authType: 'privateKey',
    password: undefined,
    privateKeyPath: '/fixtures/encrypted-key'
  };
  const parsePassphrases: Array<string | undefined> = [];
  const keyAuth = await resolveSshAuthentication(keyTarget, undefined, {
    readPrivateKey: async () => 'synthetic-encrypted-key-data',
    parsePrivateKey: (_data, passphrase) => {
      parsePassphrases.push(passphrase);
      return passphrase
        ? ({}) as never
        : new Error('Encrypted private OpenSSH key detected, but no passphrase given');
    },
    promptPassphrase: async () => 'synthetic-passphrase'
  });
  assert.deepEqual(parsePassphrases, [undefined, 'synthetic-passphrase']);
  assert.deepEqual(keyAuth, {
    privateKey: 'synthetic-encrypted-key-data',
    passphrase: 'synthetic-passphrase'
  });

  await assert.rejects(resolveSshAuthentication(keyTarget, undefined, {
    readPrivateKey: async () => 'synthetic-encrypted-key-data',
    parsePrivateKey: () => new Error('Encrypted private OpenSSH key detected, but no passphrase given'),
    promptPassphrase: async () => undefined
  }), /Connection cancelled/);
});

test('source contract keeps Jump internal while Direct SFTP and FTP/FTPS remain separate', () => {
  const projectRoot = path.resolve(__dirname, '../..');
  const jumpSource = readFileSync(path.join(projectRoot, 'src/ssh/SshJumpChain.ts'), 'utf8');
  const sftpSource = readFileSync(path.join(projectRoot, 'src/ssh/SftpSessionManager.ts'), 'utf8');
  const routerSource = readFileSync(path.join(projectRoot, 'src/remote/RemoteSessionRouter.ts'), 'utf8');
  const ftpSource = readFileSync(path.join(projectRoot, 'src/ftp/FtpSessionManager.ts'), 'utf8');

  assert.match(jumpSource, /client\.forwardOut\('127\.0\.0\.1', 0, destination\.host, destination\.port/);
  assert.doesNotMatch(jumpSource, /createServer|\.listen\(/);
  assert.match(sftpSource, /options\.jumpProfileId && jumpOptions\.length === 0/);
  assert.match(
    sftpSource,
    /if \(jumpOptions\.length > 0\) \{[\s\S]*?config\.sock = await jumpChain\.open[\s\S]*?\} else \{[\s\S]*?await assertTcpConnectionReachable/
  );
  assert.match(
    routerSource,
    /normalizeConnectionType\(connectionType\) === SFTP_CONNECTION_TYPE[\s\S]*?\? this\.sftpSessions[\s\S]*?: this\.ftpSessions/
  );
  assert.doesNotMatch(ftpSource, /SshJumpChain|jumpOptions|jumpProfileNames|jumpProfileIds/);
});
