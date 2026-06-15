import * as vscode from 'vscode';

export const PROGRESS_NOTIFICATION_DELAY_MS = 1000;

export class RemoteEditOperationCancelledError extends Error {
  constructor(message = 'Operation cancelled.') {
    super(message);
    this.name = 'RemoteEditOperationCancelledError';
  }
}

export interface RemoteEditProgressOptions {
  delayMs?: number;
  cancellable?: boolean;
  returnOnCancel?: boolean;
  cancelMessage?: string;
  confirmCancellation?: () => Promise<boolean>;
  cancellationSource?: vscode.CancellationTokenSource;
  suppressNotification?: boolean;
}


export interface RemoteEditProgressReporter {
  reportMessage(message: string): void;
  reportBytes(label: string, transferredBytes: number, totalBytes: number, detail?: string): void;
}

class DelayedRemoteEditProgressReporter implements RemoteEditProgressReporter {
  private progress?: vscode.Progress<{ increment?: number; message?: string }>;
  private latestMessage = '';
  private latestPercent = 0;
  private deliveredPercent = 0;

  bind(progress: vscode.Progress<{ increment?: number; message?: string }>): void {
    this.progress = progress;

    if (this.latestMessage || this.latestPercent > 0) {
      this.progress.report({
        increment: Math.max(0, this.latestPercent - this.deliveredPercent),
        message: this.latestMessage || undefined
      });
      this.deliveredPercent = this.latestPercent;
    }
  }

  reportMessage(message: string): void {
    this.latestMessage = message;
    this.progress?.report({ message });
  }

  reportBytes(label: string, transferredBytes: number, totalBytes: number, detail?: string): void {
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      this.reportMessage(label);
      return;
    }

    const safeTransferred = Math.max(0, Math.min(transferredBytes, totalBytes));
    const percent = Math.max(0, Math.min(100, Math.floor((safeTransferred / totalBytes) * 100)));
    const transferMessage = `${formatBytes(safeTransferred)} of ${formatBytes(totalBytes)} (${percent}%)`;
    const message = detail ? `${detail} - ${transferMessage}` : transferMessage;

    this.latestMessage = message;
    this.latestPercent = percent;

    if (!this.progress) {
      return;
    }

    const increment = percent - this.deliveredPercent;

    if (increment > 0) {
      this.progress.report({ increment, message });
      this.deliveredPercent = percent;
      return;
    }

    this.progress.report({ message });
  }
}

export function isRemoteEditOperationCancelled(error: unknown): boolean {
  return error instanceof RemoteEditOperationCancelledError
    || (error instanceof Error && error.name === 'RemoteEditOperationCancelledError');
}

export function throwIfCancelled(token: vscode.CancellationToken, message = 'Operation cancelled.'): void {
  if (token.isCancellationRequested) {
    throw new RemoteEditOperationCancelledError(message);
  }
}

export async function withRemoteEditProgress<T>(
  title: string,
  task: (token: vscode.CancellationToken, progress: RemoteEditProgressReporter) => Promise<T>,
  options: RemoteEditProgressOptions = {}
): Promise<T> {
  const delayMs = Math.max(0, options.delayMs ?? PROGRESS_NOTIFICATION_DELAY_MS);
  const cancellable = options.cancellable === true;
  const returnOnCancel = options.returnOnCancel === true;
  const cancelMessage = options.cancelMessage || 'Operation cancelled.';
  const confirmCancellation = options.confirmCancellation;
  const ownsCancellationSource = !options.cancellationSource;
  const source = options.cancellationSource ?? new vscode.CancellationTokenSource();
  const reporter = new DelayedRemoteEditProgressReporter();
  const operation = Promise.resolve().then(() => task(source.token, reporter));

  if (options.suppressNotification) {
    try {
      if (!cancellable || !returnOnCancel) {
        return await operation;
      }

      return await Promise.race([
        operation,
        waitForCancellation(source.token, cancelMessage).catch(error => {
          operation.catch(() => undefined);
          throw error;
        })
      ]);
    } finally {
      if (ownsCancellationSource) {
        source.dispose();
      }
    }
  }

  if (delayMs > 0) {
    const first = await Promise.race([
      operation.then(
        value => ({ kind: 'result' as const, value }),
        error => ({ kind: 'error' as const, error })
      ),
      delay(delayMs).then(() => ({ kind: 'delay' as const }))
    ]);

    if (first.kind === 'result') {
      if (ownsCancellationSource) {
        source.dispose();
      }
      return first.value;
    }

    if (first.kind === 'error') {
      if (ownsCancellationSource) {
        source.dispose();
      }
      throw first.error;
    }
  }

  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable
      },
      async (progress, progressToken) => {
        reporter.bind(progress);

        let cancellationConfirmationInProgress = false;
        const progressCancellation = progressToken.onCancellationRequested(() => {
          if (!confirmCancellation) {
            source.cancel();
            return;
          }

          if (cancellationConfirmationInProgress || source.token.isCancellationRequested) {
            return;
          }

          cancellationConfirmationInProgress = true;
          confirmCancellation()
            .then(confirmed => {
              if (confirmed) {
                source.cancel();
              }
            })
            .catch(() => undefined)
            .finally(() => {
              cancellationConfirmationInProgress = false;
            });
        });

        try {
          if (!cancellable || !returnOnCancel) {
            return await operation;
          }

          return await Promise.race([
            operation,
            waitForCancellation(source.token, cancelMessage).catch(error => {
              operation.catch(() => undefined);
              throw error;
            })
          ]);
        } finally {
          progressCancellation.dispose();
        }
      }
    );
  } finally {
    if (ownsCancellationSource) {
      source.dispose();
    }
  }
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return 'unknown';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForCancellation(token: vscode.CancellationToken, message: string): Promise<never> {
  if (token.isCancellationRequested) {
    return Promise.reject(new RemoteEditOperationCancelledError(message));
  }

  return new Promise((_resolve, reject) => {
    const disposable = token.onCancellationRequested(() => {
      disposable.dispose();
      reject(new RemoteEditOperationCancelledError(message));
    });
  });
}
