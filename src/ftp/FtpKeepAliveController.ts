import { Client as FtpClient } from 'basic-ftp';
import { getNumberSetting } from '../utils/settingsUtils';

interface FtpKeepAliveControllerOptions {
  isClientCurrent: (connectionId: string, client: FtpClient) => boolean;
  hasQueuedOperation: (connectionId: string) => boolean;
  onFailure: (connectionId: string, client: FtpClient) => void;
}

export class FtpKeepAliveController {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly inFlight = new Set<string>();
  private readonly busyConnectionCounts = new Map<string, number>();
  private readonly lastActivityTimes = new Map<string, number>();

  constructor(private readonly options: FtpKeepAliveControllerOptions) {}

  start(connectionId: string, client: FtpClient, enabled: boolean): void {
    this.stop(connectionId);
    this.touch(connectionId);

    if (!enabled) {
      return;
    }

    const intervalMs = getNumberSetting('ftpKeepAliveInterval', 30000, 1000, 300000);
    const timer = setInterval(() => {
      void this.send(connectionId, client, intervalMs);
    }, intervalMs);

    (timer as any).unref?.();
    this.timers.set(connectionId, timer);
  }

  stop(connectionId: string): void {
    this.stopTimerOnly(connectionId);
    this.inFlight.delete(connectionId);
    this.busyConnectionCounts.delete(connectionId);
    this.lastActivityTimes.delete(connectionId);
  }

  stopTimerOnly(connectionId: string): void {
    const timer = this.timers.get(connectionId);

    if (timer) {
      clearInterval(timer);
    }

    this.timers.delete(connectionId);
  }

  touch(connectionId: string): void {
    this.lastActivityTimes.set(connectionId, Date.now());
  }

  beginOperation(connectionId: string): () => void {
    this.touch(connectionId);
    this.busyConnectionCounts.set(connectionId, (this.busyConnectionCounts.get(connectionId) || 0) + 1);

    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }

      disposed = true;
      const nextCount = Math.max(0, (this.busyConnectionCounts.get(connectionId) || 1) - 1);

      if (nextCount > 0) {
        this.busyConnectionCounts.set(connectionId, nextCount);
      } else {
        this.busyConnectionCounts.delete(connectionId);
      }

      this.touch(connectionId);
    };
  }

  private async send(connectionId: string, client: FtpClient, intervalMs: number): Promise<void> {
    if (!this.options.isClientCurrent(connectionId, client) || client.closed) {
      this.options.onFailure(connectionId, client);
      return;
    }

    if ((this.busyConnectionCounts.get(connectionId) || 0) > 0 || this.inFlight.has(connectionId) || this.options.hasQueuedOperation(connectionId)) {
      return;
    }

    const lastActivity = this.lastActivityTimes.get(connectionId) || 0;

    if (Date.now() - lastActivity < intervalMs) {
      return;
    }

    this.inFlight.add(connectionId);

    try {
      const rawClient = client as any;

      if (typeof rawClient.sendIgnoringError === 'function') {
        await rawClient.sendIgnoringError('NOOP');
      } else if (typeof rawClient.send === 'function') {
        await rawClient.send('NOOP');
      } else {
        await client.pwd();
      }

      this.touch(connectionId);
    } catch {
      this.options.onFailure(connectionId, client);
    } finally {
      this.inFlight.delete(connectionId);
    }
  }
}
