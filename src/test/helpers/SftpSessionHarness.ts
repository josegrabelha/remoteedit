import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ConnectOptions } from '../../remote/RemoteSessionTypes';

export class TestEventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();
  readonly event = (listener: (value: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value: T): void { for (const listener of [...this.listeners]) listener(value); }
  dispose(): void { this.listeners.clear(); }
}

export class TestCancellationSource {
  private readonly emitter = new TestEventEmitter<void>();
  readonly token = { isCancellationRequested: false, onCancellationRequested: this.emitter.event };
  cancel(): void {
    if (!this.token.isCancellationRequested) {
      this.token.isCancellationRequested = true;
      this.emitter.fire();
    }
  }
  dispose(): void { this.emitter.dispose(); }
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export class ControlledSftp {
  readonly client = Object.assign(new EventEmitter(), {
    destroy: () => { this.destroyCount++; queueMicrotask(() => this.client.emit('close')); }
  });
  destroyCount = 0;
  endCount = 0;
  configs: unknown[] = [];
  connectWork = async (): Promise<void> => undefined;
  cwdWork = async (): Promise<string> => '/home/test';
  listWork = async (): Promise<unknown[]> => [];
  endWork = async (): Promise<void> => { this.client.emit('close'); };
  async connect(config: unknown) { this.configs.push(config); await this.connectWork(); }
  cwd() { return this.cwdWork(); }
  list() { return this.listWork(); }
  end() { this.endCount++; return this.endWork(); }
}

export class ControlledJump extends EventEmitter {
  configs: unknown[] = [];
  streams: PassThrough[] = [];
  destroyCount = 0;
  connect(config: unknown): this {
    this.configs.push(config);
    harness.jumpConnect(this);
    return this;
  }
  forwardOut(_a: string, _b: number, _host: string, _port: number,
    callback: (error: Error | undefined, stream?: PassThrough) => void): void {
    harness.jumpForward(this, callback);
  }
  end(): void {}
  destroy(): void { this.destroyCount++; queueMicrotask(() => this.emit('close')); }
}

export const harness = {
  clients: [] as ControlledSftp[],
  probe: async (_options: unknown): Promise<void> => undefined,
  platform: async (_client: unknown) => ({ platform: 'posix', shell: 'sh' }),
  prompt: async (): Promise<string | undefined> => undefined,
  jumpClients: [] as ControlledJump[],
  jumpConnect: (client: ControlledJump): void => { queueMicrotask(() => client.emit('ready')); },
  jumpForward: (client: ControlledJump, callback: (error: Error | undefined, stream?: PassThrough) => void): void => {
    const stream = new PassThrough();
    client.streams.push(stream);
    queueMicrotask(() => callback(undefined, stream));
  }
};

// Load the real managers with only external UI/network boundaries controlled.
const loader = require('node:module') as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
loader._load = (request, parent, isMain) => {
  if (request === 'vscode') return {
    EventEmitter: TestEventEmitter, CancellationTokenSource: TestCancellationSource,
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    window: { showInputBox: () => harness.prompt() }
  };
  if (request === 'ssh2-sftp-client') return class { constructor() {
    const client = harness.clients.shift();
    if (!client) throw new Error('No controlled SFTP client queued');
    return client;
  } };
  if (request.endsWith('/RemotePlatformProbe')) return { detectRemotePlatform: (client: unknown) => harness.platform(client) };
  const loaded = Reflect.apply(originalLoad, loader, [request, parent, isMain]);
  if (request === 'ssh2') return { ...loaded as object, Client: class extends ControlledJump {
    constructor() { super(); harness.jumpClients.push(this); }
  } };
  if (request.endsWith('/ConnectionProbe')) return {
    ...loaded as object, assertTcpConnectionReachable: (options: { cancellationToken?: TestCancellationSource['token'] }) => {
      let subscription: { dispose(): void } | undefined;
      return new Promise<void>((resolve, reject) => {
        const cancel = () => reject(new Error('Connection cancelled.'));
        subscription = options.cancellationToken?.onCancellationRequested(cancel);
        harness.probe(options).then(resolve, reject);
        if (options.cancellationToken?.isCancellationRequested) cancel();
      }).finally(() => subscription?.dispose());
    }
  };
  return loaded;
};
export const { SftpSessionManager } = require('../../ssh/SftpSessionManager') as typeof import('../../ssh/SftpSessionManager');
export const { RemoteSessionRouter } = require('../../remote/RemoteSessionRouter') as typeof import('../../remote/RemoteSessionRouter');
loader._load = originalLoad;

export function options(id = 'target'): ConnectOptions {
  return { connectionId: id, connectionType: 'sftp', name: id, host: 'test.invalid', port: 22,
    username: 'tester', authType: 'password', password: 'synthetic-password' };
}

export function resetHarness(): void {
  harness.clients.length = 0;
  harness.probe = async () => undefined;
  harness.platform = async () => ({ platform: 'posix', shell: 'sh' });
  harness.prompt = async () => undefined;
  harness.jumpClients.length = 0;
  harness.jumpConnect = client => { queueMicrotask(() => client.emit('ready')); };
  harness.jumpForward = (client, callback) => {
    const stream = new PassThrough();
    client.streams.push(stream);
    queueMicrotask(() => callback(undefined, stream));
  };
}

export const flush = () => new Promise<void>(resolve => setImmediate(resolve));
