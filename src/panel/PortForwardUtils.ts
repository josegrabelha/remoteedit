import type { SavedPortForwardConfig } from '../ssh/PortForwardManager';

export function parsePortForwardConfig(value: any): SavedPortForwardConfig {
  const id = String(value?.id || '').trim();
  const localPort = Number(value?.localPort || 0);
  const remotePort = Number(value?.remotePort || 0);
  const localHost = String(value?.localHost || '').trim() || 'localhost';
  const remoteHost = String(value?.remoteHost || '').trim() || '127.0.0.1';
  const name = String(value?.name || '').trim() || `${localPort || ''} → ${remotePort || ''}`.trim() || 'Port forward';

  if (!id) {
    throw new Error('Port forward id is required.');
  }

  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535 || !Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
    throw new Error('Ports must be between 1 and 65535.');
  }

  return { id, name, localHost, localPort, remoteHost, remotePort, autoStartOnConnect: Boolean(value?.autoStartOnConnect) };
}

export function formatPortForwardLabel(config: SavedPortForwardConfig): string {
  return `${config.localHost}:${config.localPort} → ${config.remoteHost}:${config.remotePort}`;
}
