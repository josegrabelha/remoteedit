import * as fs from 'fs/promises';
import { Client, utils, type ClientChannel, type ConnectConfig } from 'ssh2';
import { assertTcpConnectionReachable } from '../remote/ConnectionProbe';
import type { ConnectionCancellationToken, JumpConnectOptions } from '../remote/RemoteSessionTypes';
import { expandHomePath } from '../utils/localPathUtils';
import { RemoteEditOperationCancelledError } from '../utils/progressUtils';

export interface SshJumpRuntimeSettings {
  readyTimeout: number;
  keepAliveInterval: number;
  keepAliveCountMax: number;
}

export interface SshAuthenticationTarget {
  kind: 'target' | 'jump';
  profileId?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  keepAlive?: boolean;
}

export interface SshForwardDestination {
  kind: 'target' | 'jump';
  name: string;
  host: string;
  port: number;
}

export type SshPassphrasePrompt = (
  target: SshAuthenticationTarget,
  cancellationToken?: ConnectionCancellationToken
) => Promise<string | undefined>;

interface TcpProbeOptions {
  host: string;
  port: number;
  timeoutMs: number;
  protocolLabel: string;
  cancellationToken?: ConnectionCancellationToken;
}

interface SshAuthenticationDependencies {
  readPrivateKey(path: string): Promise<string>;
  parsePrivateKey(data: string, passphrase?: string): ReturnType<typeof utils.parseKey>;
  promptPassphrase: SshPassphrasePrompt;
}

export interface SshAuthenticationDependencyOverrides {
  readPrivateKey?: SshAuthenticationDependencies['readPrivateKey'];
  parsePrivateKey?: SshAuthenticationDependencies['parsePrivateKey'];
  promptPassphrase: SshPassphrasePrompt;
}

export interface SshJumpChainDependencyOverrides extends SshAuthenticationDependencyOverrides {
  createClient?: () => Client;
  probe?: (options: TcpProbeOptions) => Promise<void>;
  onUnexpectedClose?: () => void;
}

interface ResourceClosure {
  closed: Promise<void>;
  finishClose(): void;
}

type TrackedClient = ResourceClosure & { kind: 'client'; client: Client; started: boolean };
type TrackedResource = TrackedClient
  | (ResourceClosure & { kind: 'stream'; stream: ClientChannel });

const MISSING_PASSPHRASE_MESSAGES = new Set([
  'Encrypted private OpenSSH key detected, but no passphrase given',
  'Encrypted OpenSSH private key detected, but no passphrase given',
  'Encrypted PPK private key detected, but no passphrase given'
]);

function createAuthenticationDependencies(overrides: SshAuthenticationDependencyOverrides): SshAuthenticationDependencies {
  return {
    readPrivateKey: overrides.readPrivateKey || (path => fs.readFile(expandHomePath(path), 'utf8')),
    parsePrivateKey: overrides.parsePrivateKey || ((data, passphrase) => utils.parseKey(data, passphrase)),
    promptPassphrase: overrides.promptPassphrase
  };
}

function throwIfCancelled(cancellationToken?: ConnectionCancellationToken): void {
  if (cancellationToken?.isCancellationRequested) {
    throw new RemoteEditOperationCancelledError('Connection cancelled.');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function targetLabel(target: SshAuthenticationTarget | SshForwardDestination): string {
  const role = target.kind === 'jump' ? 'Jump profile' : 'Target';
  return `${role} "${target.name}" (${target.host}:${target.port})`;
}

function stageError(
  target: SshAuthenticationTarget | SshForwardDestination,
  stage: string,
  error: unknown
): Error {
  return new Error(`${targetLabel(target)} failed while ${stage}: ${errorMessage(error)}`);
}

function isMissingPassphraseError(error: Error): boolean {
  return MISSING_PASSPHRASE_MESSAGES.has(error.message);
}

function privateKeyReadReason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code
    ? `Could not read the configured private key (${code}).`
    : 'Could not read the configured private key.';
}

export async function resolveSshAuthentication(
  target: SshAuthenticationTarget,
  cancellationToken: ConnectionCancellationToken | undefined,
  overrides: SshAuthenticationDependencyOverrides
): Promise<Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>> {
  throwIfCancelled(cancellationToken);

  if (target.authType === 'password') {
    if (!target.password) {
      throw stageError(target, 'preparing password authentication', new Error('Password is required.'));
    }

    return { password: target.password };
  }

  if (!target.privateKeyPath) {
    throw stageError(target, 'preparing private key authentication', new Error('Private key path is required.'));
  }

  const dependencies = createAuthenticationDependencies(overrides);
  let privateKey: string;

  try {
    privateKey = await dependencies.readPrivateKey(target.privateKeyPath);
  } catch (error) {
    throwIfCancelled(cancellationToken);
    throw stageError(target, 'loading the private key', new Error(privateKeyReadReason(error)));
  }

  throwIfCancelled(cancellationToken);
  let passphrase = target.passphrase;
  let parsedKey: ReturnType<typeof utils.parseKey>;

  try {
    parsedKey = dependencies.parsePrivateKey(privateKey, passphrase);
  } catch (error) {
    throw stageError(target, 'validating the private key', error);
  }

  if (parsedKey instanceof Error && !passphrase && isMissingPassphraseError(parsedKey)) {
    passphrase = await dependencies.promptPassphrase(target, cancellationToken);

    if (passphrase === undefined) {
      throw new RemoteEditOperationCancelledError('Connection cancelled.');
    }

    throwIfCancelled(cancellationToken);

    try {
      parsedKey = dependencies.parsePrivateKey(privateKey, passphrase);
    } catch (error) {
      throw stageError(target, 'validating the private key passphrase', error);
    }
  }

  if (parsedKey instanceof Error) {
    throw stageError(target, 'validating the private key', parsedKey);
  }

  return {
    privateKey,
    ...(passphrase ? { passphrase } : {})
  };
}

/** Owns the hidden raw SSH clients and forward streams for one final SFTP connection. */
export class SshJumpChain {
  private readonly resources: TrackedResource[] = [];
  private readonly createClient: () => Client;
  private readonly probe: (options: TcpProbeOptions) => Promise<void>;
  private readonly authenticationDependencies: SshAuthenticationDependencyOverrides;
  private readonly onUnexpectedClose?: () => void;
  private started = false;
  private opened = false;
  private terminationNotified = false;
  private disposed = false;
  private disposePromise?: Promise<void>;

  constructor(
    private readonly settings: SshJumpRuntimeSettings,
    dependencies: SshJumpChainDependencyOverrides
  ) {
    this.createClient = dependencies.createClient || (() => new Client());
    this.probe = dependencies.probe || (options => assertTcpConnectionReachable(options));
    this.authenticationDependencies = dependencies;
    this.onUnexpectedClose = dependencies.onUnexpectedClose;
  }

  async open(
    jumpChain: readonly JumpConnectOptions[],
    target: SshForwardDestination,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<ClientChannel> {
    if (this.started) {
      throw new Error('This SSH jump chain has already been opened.');
    }

    if (jumpChain.length === 0) {
      throw new Error('An SSH jump chain requires at least one jump profile.');
    }

    this.started = true;

    try {
      throwIfCancelled(cancellationToken);
      const outermost = this.toAuthenticationTarget(jumpChain[0]);

      try {
        await this.probe({
          host: outermost.host,
          port: outermost.port,
          timeoutMs: this.settings.readyTimeout,
          protocolLabel: 'ssh',
          cancellationToken
        });
      } catch (error) {
        throwIfCancelled(cancellationToken);
        throw stageError(outermost, 'checking TCP reachability', error);
      }

      let incomingSocket: ClientChannel | undefined;

      for (let index = 0; index < jumpChain.length; index += 1) {
        this.assertOpening(cancellationToken);
        const hop = this.toAuthenticationTarget(jumpChain[index]);
        const authentication = await resolveSshAuthentication(hop, cancellationToken, this.authenticationDependencies);
        this.assertOpening(cancellationToken);

        let client: Client;
        try {
          client = this.createClient();
        } catch (error) {
          throw stageError(hop, 'creating the SSH client', error);
        }

        const resource = this.trackClient(client);
        const config: ConnectConfig = {
          host: hop.host,
          port: hop.port,
          username: hop.username,
          readyTimeout: this.settings.readyTimeout,
          ...authentication,
          ...(incomingSocket ? { sock: incomingSocket } : {})
        };

        if (hop.keepAlive !== false) {
          config.keepaliveInterval = this.settings.keepAliveInterval;
          config.keepaliveCountMax = this.settings.keepAliveCountMax;
        }

        try {
          await this.connectClient(resource, config, cancellationToken);
        } catch (error) {
          throwIfCancelled(cancellationToken);
          throw stageError(hop, 'establishing the SSH connection', error);
        }

        const destination = index + 1 < jumpChain.length
          ? this.toForwardDestination(jumpChain[index + 1])
          : target;

        try {
          incomingSocket = await this.forwardTo(client, destination, cancellationToken);
        } catch (error) {
          throwIfCancelled(cancellationToken);
          throw stageError(hop, `opening a forward to ${targetLabel(destination)}`, error);
        }
      }

      if (!incomingSocket) {
        throw new Error('The SSH jump chain did not create a final forwarding stream.');
      }

      this.assertOpening(cancellationToken);
      this.opened = true;
      return incomingSocket;
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }

    this.disposed = true;
    this.disposePromise = Promise.resolve().then(async () => {
      const resources = this.resources.splice(0).reverse();

      for (const resource of resources) {
        if (resource.kind === 'stream') {
          try {
            resource.stream.destroy();
            // ssh2 emits channel close after buffered reads reach end.
            resource.stream.resume();
          } catch {
            // Continue releasing the rest of the chain.
          }
          continue;
        }

        try {
          resource.client.end();
        } catch {
          // Fall through to the forced close.
        }

        try {
          resource.client.destroy();
        } catch {
          // Continue releasing the rest of the chain.
        }
        if (!resource.started) {
          resource.finishClose();
        }
      }
      await Promise.all(resources.map(resource => resource.closed));
    });

    return this.disposePromise;
  }

  private assertOpening(cancellationToken?: ConnectionCancellationToken): void {
    throwIfCancelled(cancellationToken);

    if (this.disposed) {
      throw new RemoteEditOperationCancelledError('Connection cancelled.');
    }
  }

  private trackClosure(emitter: NodeJS.EventEmitter): ResourceClosure {
    const onTermination = (): void => {
      // A nested ssh2 client can emit end without close. Notify the owner so
      // its final SFTP client cannot remain active until a keepalive timeout.
      if (!this.opened || this.disposed || this.terminationNotified) return;
      this.terminationNotified = true;
      if (this.onUnexpectedClose) this.onUnexpectedClose();
      else void this.dispose();
    };
    const errorListener = (_error: Error): void => onTermination();
    let resolveClosed!: () => void;
    const closed = new Promise<void>(resolve => {
      resolveClosed = resolve;
    });
    const finishClose = (): void => {
      emitter.removeListener('error', errorListener);
      emitter.removeListener('end', onTermination);
      emitter.removeListener('close', finishClose);
      resolveClosed();
      onTermination();
    };
    emitter.on('error', errorListener);
    emitter.once('end', onTermination);
    emitter.once('close', finishClose);
    return { closed, finishClose };
  }

  private trackClient(client: Client): TrackedClient {
    const resource: TrackedClient = { kind: 'client', client, started: false, ...this.trackClosure(client) };
    this.resources.push(resource);
    return resource;
  }

  private closeLateStream(stream: ClientChannel): void {
    if (stream.closed) {
      return;
    }
    this.trackClosure(stream);
    stream.destroy();
    stream.resume();
  }

  private connectClient(
    resource: TrackedClient,
    config: ConnectConfig,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<void> {
    const { client } = resource;
    return new Promise((resolve, reject) => {
      let settled = false;
      let cancellationSubscription: { dispose(): void } | undefined;

      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        cancellationSubscription?.dispose();
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
        client.removeListener('close', onClose);

        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const onReady = (): void => finish();
      const onError = (error: Error): void => finish(error);
      const onClose = (): void => finish(new Error('The SSH transport closed before becoming ready.'));

      client.once('ready', onReady);
      client.once('error', onError);
      client.once('close', onClose);
      cancellationSubscription = cancellationToken?.onCancellationRequested(() => {
        finish(new RemoteEditOperationCancelledError('Connection cancelled.'));
        try {
          client.destroy();
        } catch {
          // The outer resource owner will make another idempotent cleanup pass.
        }
      });

      if (cancellationToken?.isCancellationRequested || this.disposed) {
        finish(new RemoteEditOperationCancelledError('Connection cancelled.'));
        return;
      }

      try {
        client.connect(config);
        resource.started = true;
      } catch (error) {
        finish(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    });
  }

  private forwardTo(
    client: Client,
    destination: SshForwardDestination,
    cancellationToken?: ConnectionCancellationToken
  ): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let cancellationSubscription: { dispose(): void } | undefined;

      const finish = (error?: Error, stream?: ClientChannel): void => {
        if (settled) {
          if (stream) {
            this.closeLateStream(stream);
          }
          return;
        }

        settled = true;
        cancellationSubscription?.dispose();

        if (error) {
          reject(error);
        } else if (stream) {
          resolve(stream);
        } else {
          reject(new Error('The SSH server did not return a forwarding stream.'));
        }
      };

      cancellationSubscription = cancellationToken?.onCancellationRequested(() => {
        finish(new RemoteEditOperationCancelledError('Connection cancelled.'));
        void this.dispose();
      });

      if (cancellationToken?.isCancellationRequested || this.disposed) {
        finish(new RemoteEditOperationCancelledError('Connection cancelled.'));
        return;
      }

      try {
        // This opens one SSH direct-tcpip channel. It does not bind or expose a local port.
        client.forwardOut('127.0.0.1', 0, destination.host, destination.port, (error, stream) => {
          if (error) {
            finish(error);
            return;
          }

          if (!stream) {
            finish(new Error('The SSH server did not return a forwarding stream.'));
            return;
          }

          if (settled || this.disposed || cancellationToken?.isCancellationRequested) {
            this.closeLateStream(stream);
            finish(new RemoteEditOperationCancelledError('Connection cancelled.'));
            return;
          }

          const closure = this.trackClosure(stream);
          if (stream.closed) {
            closure.finishClose();
          }
          this.resources.push({ kind: 'stream', stream, ...closure });
          finish(undefined, stream);
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    });
  }

  private toAuthenticationTarget(hop: JumpConnectOptions): SshAuthenticationTarget {
    return {
      kind: 'jump',
      profileId: hop.profileId,
      name: hop.name,
      host: hop.host,
      port: hop.port,
      username: hop.username,
      authType: hop.authType,
      password: hop.password,
      privateKeyPath: hop.privateKeyPath,
      passphrase: hop.passphrase,
      keepAlive: hop.keepAlive
    };
  }

  private toForwardDestination(hop: JumpConnectOptions): SshForwardDestination {
    return {
      kind: 'jump',
      name: hop.name,
      host: hop.host,
      port: hop.port
    };
  }
}
