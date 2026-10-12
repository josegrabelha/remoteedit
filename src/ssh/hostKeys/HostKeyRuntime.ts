import type * as vscode from 'vscode';
import * as path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import type { Client, ConnectConfig } from 'ssh2';
import type { ConnectionCancellationToken } from '../../remote/RemoteSessionTypes';

import { HostKeySecurityError, identifyHostKey, normalizeHost } from './HostKeyVerifier';
import { KnownHosts } from './KnownHosts';
import { TrustedHostStore } from './TrustedHostStore';
import { HostKeyApprovalRequired, type HostKeyCommit, HostKeyTrustService, hostKeyPromptText, hostKeyPromptTitle, hostKeyPromptAction, type HostKeyPrompt } from './HostKeyTrustService';

interface HostKeyUi { prompt: HostKeyPrompt; confirmDisable: () => Promise<boolean>; }
const uiContext = new AsyncLocalStorage<HostKeyUi>();
let service: HostKeyTrustService | undefined;
let output: vscode.OutputChannel | undefined;
let getEnabled = (): boolean => true;
let getReadyTimeout = (): number => 30000;
export function sshConnectionTimeout(): number { return getReadyTimeout(); }
let debugLog: (message: string) => void = () => {};
let warningLog: (message: string) => void = () => {};
let promptQueue: Promise<unknown> = Promise.resolve();
export function withHostKeyUi<T>(ui: HostKeyUi, work: () => T): T { return uiContext.run(ui, work); }
export function currentHostKeyPrompt(): HostKeyPrompt | undefined { return uiContext.getStore()?.prompt; }
export function initializeHostKeyTrust(context: vscode.ExtensionContext, channel: vscode.OutputChannel): void {
  const vscode: typeof import('vscode') = require('vscode');
  const { appendDebugLog, appendOutputLog }: typeof import('../../utils/outputLogger') = require('../../utils/outputLogger');
  getReadyTimeout = () => {
    const value = vscode.workspace.getConfiguration('remoteedit').get?.<number>('sshReadyTimeout', 30000);
    return typeof value === 'number' && Number.isFinite(value) && value >= 1000 ? value : 30000;
  };
  getEnabled = () => { const values = vscode.workspace.getConfiguration('remoteedit').inspect<boolean>('ssh.hostKeyVerification'); return values?.globalValue ?? values?.defaultValue ?? true; };
  debugLog = message => appendDebugLog(channel, 'SSH Host Keys', message);
  warningLog = message => appendOutputLog(channel, 'WARN', message);
  output = channel;
  service = new HostKeyTrustService(new TrustedHostStore(path.join(context.globalStorageUri.fsPath, 'trusted-ssh-hosts.json')), new KnownHosts(),
    message => debugLog(message));
  debugLog(`Verification ${hostKeyVerificationEnabled() ? 'enabled' : 'disabled'}; trust sources belong to the extension host (${process.platform}, ${vscode.env.remoteName || 'local'}).`);
  context.subscriptions.push({ dispose: () => { service?.dispose(); for (const controller of approvalOperations) controller.abort(); service = undefined; output = undefined; getEnabled = () => true; getReadyTimeout = () => 30000; debugLog = () => {}; warningLog = () => {}; } });
}
export function hostKeyTrust(): HostKeyTrustService {
  if (!service) throw new HostKeySecurityError('Trust service is unavailable.');
  return service;
}
export function hostKeyVerificationEnabled(): boolean {
  // Only machine/global values participate. A workspace cannot disable this protection.
  return getEnabled();
}
export const disableHostKeyWarning = 'Restoring these Settings will disable SSH host key verification for new connections and reconnections. Server identities will no longer be checked. Continue?';
export async function confirmDisableHostKeyVerification(): Promise<boolean> {
  const ui = uiContext.getStore();
  if (ui) return ui.confirmDisable();
  const vscode: typeof import('vscode') = require('vscode');
  return await vscode.window.showWarningMessage(disableHostKeyWarning, { modal: true }, 'Disable Verification') === 'Disable Verification';
}
function raceAbort<T>(work: PromiseLike<T>, signal: AbortSignal, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const abort = (): void => { signal.removeEventListener('abort', abort); resolve(fallback); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(work).then(resolve, () => resolve(fallback)).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
// VS Code has no API to dismiss a showWarningMessage modal. Keep its visual queue
// until the actual dialog closes, while aborting the connection immediately.
let nativePromptQueue: Promise<unknown> = Promise.resolve();
const nativePrompt: HostKeyPrompt = (request, signal) => {
  const visible = nativePromptQueue.then(async () => {
    if (signal.aborted) return false;
    const vscode: typeof import('vscode') = require('vscode');
    request.onPresented?.();
    const action = hostKeyPromptAction(request);
    const value = await vscode.window.showWarningMessage(hostKeyPromptTitle(request), { modal: true, detail: hostKeyPromptText(request) }, action);
    return !signal.aborted && request.phase !== 'blocked' && value === action;
  });
  nativePromptQueue = visible.catch(() => false);
  return raceAbort(visible, signal, false);
};
nativePrompt.managesPresentation = true;
function serializePrompt(prompt: HostKeyPrompt): HostKeyPrompt {
  const serialized: HostKeyPrompt = (request, signal) => {
    const work = promptQueue.then(() => {
      if (signal.aborted) return false;
      // Presentation adapters may have their own UI queue; the deadline starts there.
      if (!prompt.managesPresentation) request.onPresented?.();
      return prompt(request, signal);
    });
    promptQueue = work.catch(() => false);
    return raceAbort(work, signal, false);
  };
  serialized.managesPresentation = true;
  return serialized;
}
interface ApprovedIdentity { publicKey: string; commit: HostKeyCommit; challenge: HostKeyApprovalRequired; }
const approvalOperations = new Set<AbortController>();
const connectionContext = new AsyncLocalStorage<Map<string, ApprovedIdentity>>();
export function hostKeyApprovalError(error: unknown): HostKeyApprovalRequired | undefined {
  return error instanceof HostKeyApprovalRequired ? error : (error as any)?.hostKeyApproval;
}
/** Retry the entire route with new clients/sockets. work must finish cleanup before rejecting. */
export async function withHostKeyApproval<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (connectionContext.getStore()) return work();
  return connectionContext.run(new Map(), async () => {
    const approved = connectionContext.getStore()!;
    try {
      for (;;) {
        if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled.');
        try { return await work(); }
        catch (error) {
          const challenge = hostKeyApprovalError(error);
          if (!challenge) {
            if (error instanceof HostKeySecurityError || (error as any)?.code === 'SSH_HOST_KEY_REJECTED') {
              const last = approved.get((error as any)?.hostKeyEndpoint);
              if (last && !signal?.aborted) {
                const controller = new AbortController();
                const abort = (): void => controller.abort();
                approvalOperations.add(controller);
                signal?.addEventListener('abort', abort, { once: true });
                try { await last.challenge.reportFailure(error, controller.signal); }
                finally { approvalOperations.delete(controller); signal?.removeEventListener('abort', abort); }
              }
            }
            throw error;
          }
          const controller = new AbortController();
          approvalOperations.add(controller);
          const abort = (): void => controller.abort();
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
          try {
            const commit = await challenge.approve(controller.signal);
            if (controller.signal.aborted) throw new HostKeySecurityError('Connection cancelled.');
            const request = challenge.request;
            approved.set(`${request.host}:${request.port}`, { publicKey: request.publicKey, commit, challenge });
            debugLog(`Resuming SSH connection after identity approval for ${request.host}:${request.port}.`);
          } finally { approvalOperations.delete(controller); signal?.removeEventListener('abort', abort); }
        }
      }
    } finally { approved.clear(); }
  });
}
/** Applied at all raw SSH transports, including the private Sync transport. */
export function installHostKeyVerification(config: ConnectConfig, client: Client, host: string, port: number,
  token?: ConnectionCancellationToken, options?: { background?: boolean; prompt?: HostKeyPrompt; role?: string; onRejected?: (error: Error) => void }): () => Error | undefined {
  if (!hostKeyVerificationEnabled()) { debugLog(`Verification disabled for ${host}:${port}.`); return () => undefined; }
  const selectedPrompt = options?.background ? undefined : options?.prompt || currentHostKeyPrompt() || nativePrompt;
  const prompt = selectedPrompt ? serializePrompt(selectedPrompt) : undefined;
  const controller = new AbortController();
  const cancellation = token?.onCancellationRequested(() => controller.abort());
  if (token?.isCancellationRequested) controller.abort();
  let failure: Error | undefined;
  const annotate = (error: Error): void => { if (failure) { error.message = failure.message; error.name = 'HostKeySecurityError'; (error as any).code = 'SSH_HOST_KEY_REJECTED'; (error as any).hostKeyApproval = hostKeyApprovalError(failure); (error as any).hostKeyEndpoint = (failure as any).hostKeyEndpoint; } };
  client.prependListener('error', annotate);
  client.once('close', () => { controller.abort(); cancellation?.dispose(); client.removeListener('error', annotate); });
  // No hostHash: ssh2 supplies the entire wire-format public key, before authentication.
  delete config.hostHash;
  config.hostVerifier = (raw: Buffer, callback: (accepted: boolean) => void): void => {
    void (async () => {
      try {
        const approved = connectionContext.getStore()?.get(`${normalizeHost(host)}:${port}`);
        if (approved) {
          if (identifyHostKey(raw).publicKey !== approved.publicKey) throw new HostKeySecurityError('The SSH server identity changed after approval. No trusted key was modified. Reconnect to review the current identity.');
          await approved.commit(controller.signal);
        } else {
          // Reject now; all UI runs at the route boundary after the failed attempt is closed.
          await hostKeyTrust().evaluate(host, port, raw, prompt, controller.signal, options?.role, 'probe');
          await hostKeyTrust().verify(host, port, raw, undefined, controller.signal, options?.role);
        }
        callback(!controller.signal.aborted);
      } catch (error) {
        failure = error instanceof Error ? error : new HostKeySecurityError(String(error));
        (failure as any).hostKeyEndpoint = `${normalizeHost(host)}:${port}`;
        if (!(failure instanceof HostKeyApprovalRequired)) { warningLog(failure.message); options?.onRejected?.(failure); }
        callback(false);
      }
    })();
  };
  return () => failure;
}
