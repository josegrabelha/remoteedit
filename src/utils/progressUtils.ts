import * as vscode from 'vscode';

export const PROGRESS_NOTIFICATION_DELAY_MS = 1500;

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
  task: (token: vscode.CancellationToken) => Promise<T>,
  options: RemoteEditProgressOptions = {}
): Promise<T> {
  const delayMs = Math.max(0, options.delayMs ?? PROGRESS_NOTIFICATION_DELAY_MS);
  const cancellable = options.cancellable === true;
  const returnOnCancel = options.returnOnCancel === true;
  const cancelMessage = options.cancelMessage || 'Operation cancelled.';
  const source = new vscode.CancellationTokenSource();
  const operation = Promise.resolve().then(() => task(source.token));

  if (delayMs > 0) {
    const first = await Promise.race([
      operation.then(
        value => ({ kind: 'result' as const, value }),
        error => ({ kind: 'error' as const, error })
      ),
      delay(delayMs).then(() => ({ kind: 'delay' as const }))
    ]);

    if (first.kind === 'result') {
      source.dispose();
      return first.value;
    }

    if (first.kind === 'error') {
      source.dispose();
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
      async (_progress, progressToken) => {
        const progressCancellation = progressToken.onCancellationRequested(() => {
          source.cancel();
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
    source.dispose();
  }
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
