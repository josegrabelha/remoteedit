import * as net from 'net';
import { RemoteEditOperationCancelledError } from '../utils/progressUtils';
import type { ConnectionCancellationToken } from './RemoteSessionTypes';

interface TcpProbeOptions {
  host: string;
  port: number;
  timeoutMs: number;
  protocolLabel: string;
  cancellationToken?: ConnectionCancellationToken;
}

interface ConnectErrorContext {
  host: string;
  port: number;
  timeoutMs?: number;
  protocolLabel: string;
}

export class RemoteConnectError extends Error {
  readonly originalMessage?: string;
  readonly statusMessage?: string;
  readonly code?: string;

  constructor(message: string, originalError?: unknown, statusMessage?: string) {
    super(message);
    this.name = 'RemoteConnectError';

    const normalizedStatusMessage = String(statusMessage || '').trim();
    if (normalizedStatusMessage && normalizedStatusMessage !== message) {
      this.statusMessage = normalizedStatusMessage;
    }

    const originalMessage = getErrorMessage(originalError).trim();
    if (originalMessage && originalMessage !== message) {
      this.originalMessage = originalMessage;
    }

    const code = getErrorCode(originalError);
    if (code) {
      this.code = code;
    }
  }
}

function getErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

function getErrorMessage(error: unknown): string {
  if (!error) {
    return '';
  }

  return error instanceof Error ? error.message : String(error || '');
}

function protocolName(protocolLabel: string): string {
  const label = String(protocolLabel || '').trim().toLowerCase();

  if (label === 'ftps') {
    return 'FTPS';
  }

  if (label === 'ftp') {
    return 'FTP';
  }

  if (label === 'ssh' || label === 'sftp') {
    return 'SSH';
  }

  return 'remote';
}

function timeoutSuffix(context: ConnectErrorContext): string {
  return context.timeoutMs ? ` after ${context.timeoutMs} ms` : '';
}

function buildTcpConnectMessage(context: ConnectErrorContext, reason: string): string {
  return `Could not connect to ${context.host}:${context.port}. Reason: ${reason}`;
}

function buildHostnameResolutionMessage(context: ConnectErrorContext, reason: string): string {
  return `Could not resolve hostname ${context.host}. Reason: ${reason}`;
}

function cleanNodeResolutionMessage(message: string, host: string): string {
  const cleaned = message
    .replace(/^getaddrinfo\s+/i, '')
    .replace(/\bENOTFOUND\b/i, '')
    .replace(/\bEAI_AGAIN\b/i, '')
    .replace(new RegExp(`\\b${escapeRegExp(host)}\\b`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'Name or service not known.';
}

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripInternalPrefix(message: string): string {
  return String(message || '').replace(/^(getconnection|connect|access):\s*/i, '').trim();
}

export function getRemoteConnectOriginalMessage(error: unknown): string | undefined {
  const value = (error as { originalMessage?: unknown } | undefined)?.originalMessage;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getRemoteConnectStatusMessage(error: unknown): string | undefined {
  const value = (error as { statusMessage?: unknown } | undefined)?.statusMessage;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeRemoteConnectError(error: unknown, context: ConnectErrorContext): Error {
  if (error instanceof RemoteConnectError) {
    return error;
  }

  const message = getErrorMessage(error).trim() || 'Unknown error';
  const code = getErrorCode(error);
  const lowerMessage = message.toLowerCase();

  if (code === 'ENOTFOUND' || lowerMessage.includes('getaddrinfo enotfound')) {
    return new RemoteConnectError(buildHostnameResolutionMessage(context, cleanNodeResolutionMessage(message, context.host)), error, 'Could not resolve hostname.');
  }

  if (code === 'EAI_AGAIN' || lowerMessage.includes('getaddrinfo eai_again')) {
    return new RemoteConnectError(buildHostnameResolutionMessage(context, 'Temporary failure in name resolution.'), error, 'Temporary failure in name resolution.');
  }

  if (code === 'ECONNREFUSED' || lowerMessage.includes('econnrefused')) {
    return new RemoteConnectError(buildTcpConnectMessage(context, 'Connection refused.'), error, 'Connection refused by the server.');
  }

  if (code === 'EHOSTUNREACH' || lowerMessage.includes('ehostunreach')) {
    return new RemoteConnectError(buildTcpConnectMessage(context, 'No route to host.'), error, 'No route to host.');
  }

  if (code === 'ENETUNREACH' || lowerMessage.includes('enetunreach')) {
    return new RemoteConnectError(buildTcpConnectMessage(context, 'Network is unreachable.'), error, 'Network is unreachable.');
  }

  if (code === 'ETIMEDOUT' || lowerMessage.includes('etimedout')) {
    return new RemoteConnectError(buildTcpConnectMessage(context, 'Connection timed out while connecting to the server.'), error, 'Connection timed out while connecting to the server.');
  }

  if (lowerMessage.includes('timed out while waiting for handshake')) {
    return new RemoteConnectError(
      `Could not complete the ${protocolName(context.protocolLabel)} handshake with ${context.host}:${context.port}. Reason: The connection timed out before the server became ready${timeoutSuffix(context)}.`,
      error,
      `${protocolName(context.protocolLabel)} handshake timed out before the server became ready.`
    );
  }

  if (lowerMessage.includes('timeout') && (lowerMessage.includes('control socket') || context.protocolLabel === 'ftp' || context.protocolLabel === 'ftps')) {
    return new RemoteConnectError(
      `Could not complete the ${protocolName(context.protocolLabel)} connection to ${context.host}:${context.port}. Reason: The server did not respond before the connection timeout${timeoutSuffix(context)}.`,
      error,
      'The server did not respond before the connection timeout.'
    );
  }

  const withoutInternalPrefix = stripInternalPrefix(message);
  return new RemoteConnectError(withoutInternalPrefix || message, error);
}

export function assertTcpConnectionReachable(options: TcpProbeOptions): Promise<void> {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 0));
  const context: ConnectErrorContext = {
    host: options.host,
    port: options.port,
    timeoutMs,
    protocolLabel: options.protocolLabel
  };

  if (options.cancellationToken?.isCancellationRequested) {
    return Promise.reject(new RemoteEditOperationCancelledError('Connection cancelled.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection({ host: options.host, port: options.port });
    let cancellationSubscription: { dispose(): void } | undefined;

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      cancellationSubscription?.dispose();
      socket.removeAllListeners();
      socket.destroy();

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    cancellationSubscription = options.cancellationToken?.onCancellationRequested(() => {
      finish(new RemoteEditOperationCancelledError('Connection cancelled.'));
    });

    socket.setTimeout(timeoutMs, () => {
      finish(new RemoteConnectError(buildTcpConnectMessage(context, 'Connection timed out while connecting to the server.'), undefined, 'Connection timed out while connecting to the server.'));
    });

    socket.once('connect', () => finish());
    socket.once('error', error => finish(normalizeRemoteConnectError(error, context)));
  });
}
