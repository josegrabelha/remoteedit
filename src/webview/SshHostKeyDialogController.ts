import * as vscode from 'vscode';
import { RemoteEditDialogManager } from '../panel/DialogManager';
import { hostKeyPromptAction, hostKeyPromptText, hostKeyPromptTitle, type HostKeyRequest } from '../ssh/hostKeys/HostKeyTrustService';

/** Per-Webview presentation adapter. Trust decisions remain in HostKeyTrustService. */
export class SshHostKeyDialogController {
  private readonly manager: RemoteEditDialogManager;
  private tail: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private readonly details = new Map<string, string>();

  constructor(private readonly available: () => boolean, private readonly post: (message: any) => void) {
    this.manager = new RemoteEditDialogManager(available, (type, payload) => {
      if (type === 'showConfirmDialog') {
        this.details.set(payload.requestId, payload.details);
        post({ type: 'showSshHostKeyDialog', payload });
      } else if (type === 'closeConfirmDialog') {
        this.details.delete(payload.requestId);
        post({ type: 'closeSshHostKeyDialog', payload });
      }
    });
  }

  prompt(request: HostKeyRequest, signal: AbortSignal): Promise<boolean> {
    const generation = this.generation;
    const result = this.tail.then(() => {
      if (generation !== this.generation || signal.aborted || !this.available()) return false;
      request.onPresented?.();
      return this.manager.showConfirmDialog({
        title: hostKeyPromptTitle(request),
        message: request.phase === 'blocked' ? 'The connection has been blocked.' : 'Verify the fingerprint before trusting this server.',
        details: hostKeyPromptText(request), confirmLabel: hostKeyPromptAction(request), cancelLabel: 'Cancel',
        hideCancel: request.phase === 'blocked', danger: Boolean(request.phase), copyable: true
      }, signal);
    });
    this.tail = result.catch(() => false);
    // A queued connection must also be cancellable while another dialog is open.
    return new Promise<boolean>((resolve, reject) => {
      const abort = (): void => { signal.removeEventListener('abort', abort); resolve(false); };
      if (signal.aborted) { resolve(false); return; }
      signal.addEventListener('abort', abort, { once: true });
      result.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
        signal.removeEventListener('abort', abort); reject(error);
      });
    });
  }

  async handle(message: any): Promise<boolean> {
    if (message?.type === 'sshHostKeyDialogResponse') {
      const requestId = String(message.payload?.requestId || '');
      this.details.delete(requestId);
      this.manager.handleConfirmDialogResponse(message.payload);
      return true;
    }
    if (message?.type === 'sshHostKeyDialogCopy') {
      const requestId = String(message.payload?.requestId || '');
      const text = this.details.get(requestId);
      if (text) {
        try {
          await vscode.env.clipboard.writeText(text);
          if (this.details.has(requestId)) this.post({ type: 'sshHostKeyDialogCopied', payload: { requestId } });
        } catch { /* Do not report successful copying if the clipboard fails. */ }
      }
      return true;
    }
    return false;
  }

  cancelPending(): void {
    this.generation++;
    for (const requestId of this.details.keys()) this.post({ type: 'closeSshHostKeyDialog', payload: { requestId } });
    this.manager.resolvePendingDialogs();
    this.details.clear();
  }
}
