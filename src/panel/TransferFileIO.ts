import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { RemoteEditOperationCancelledError, throwIfCancelled } from '../utils/progressUtils';

export async function readLocalFileWithCancellation(localPath: string, token: vscode.CancellationToken): Promise<Buffer> {
  return await readLocalFileBufferWithCancellation(localPath, token, 'Upload canceled.');
}

export async function readLocalFileBufferWithCancellation(localPath: string, token: vscode.CancellationToken, cancelMessage: string): Promise<Buffer> {
  throwIfCancelled(token, cancelMessage);

  const abortController = new AbortController();
  const cancellationSubscription = token.onCancellationRequested(() => abortController.abort());

  try {
    const content = await fs.readFile(localPath, { signal: abortController.signal });
    throwIfCancelled(token, cancelMessage);
    return content;
  } catch (error) {
    if (token.isCancellationRequested || (error instanceof Error && error.name === 'AbortError')) {
      throw new RemoteEditOperationCancelledError(cancelMessage);
    }

    throw error;
  } finally {
    cancellationSubscription.dispose();
  }
}


export async function writeLocalFileSafely(localPath: string, content: Buffer): Promise<void> {
  const parentDirectory = path.dirname(localPath);
  const tempName = `.${path.basename(localPath)}.remoteedit-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  const tempPath = path.join(parentDirectory, tempName);

  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, localPath);
  } catch (error) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch {
      // Ignore cleanup errors for local temporary files.
    }
    throw error;
  }
}
