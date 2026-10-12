import { HostKeySecurityError, identifyHostKey, normalizeHost, type HostKeyIdentity } from './HostKeyVerifier';
import { KnownHosts, matchesKnownHost, type KnownHostEntry } from './KnownHosts';
import { TrustedHostStore } from './TrustedHostStore';

export interface HostKeyRequest extends HostKeyIdentity {
  host: string; port: number; role?: string;
  /** Called by the presentation adapter only when the dialog becomes visible. */
  onPresented?: () => void;
  phase?: 'changed' | 'replace-confirm' | 'blocked';
  previous?: KnownHostEntry[]; title?: string; reason?: string;
}
export function hostKeyPromptTitle(request: HostKeyRequest): string {
  return request.title || (request.phase === 'changed' ? 'SSH Host Key Changed' : request.phase === 'replace-confirm' ? 'Replace Trusted SSH Host Key?' : 'Trust SSH Server Identity?');
}
export function hostKeyPromptAction(request: HostKeyRequest): string {
  return request.phase === 'blocked' ? 'Close' : request.phase === 'changed' ? 'Review & Replace' : request.phase === 'replace-confirm' ? 'I Verified — Replace & Connect' : 'Trust & Connect';
}
class HostKeyReviewError extends HostKeySecurityError {
  constructor(message: string, readonly previous: KnownHostEntry[], readonly title: string, readonly replaceable = false) { super(message); }
}
export type HostKeyPrompt = ((request: HostKeyRequest, signal: AbortSignal) => Promise<boolean>) & { managesPresentation?: boolean };
export const HOST_KEY_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
export const HOST_KEY_EXPIRED_MESSAGE = 'The SSH host verification request has expired after 10 minutes. Please reconnect to verify the server identity again.';
export type HostKeyCommit = (signal?: AbortSignal) => Promise<void>;
/** Carries a decision request out of a rejected handshake. Never authorize authentication with it. */
export class HostKeyApprovalRequired extends Error {
  constructor(readonly request: HostKeyRequest, readonly approve: (signal: AbortSignal) => Promise<HostKeyCommit>,
    readonly reportFailure: (error: unknown, signal: AbortSignal) => Promise<void>) {
    super('SSH server identity requires interactive verification.');
    this.name = 'HostKeyApprovalRequired';
  }
}
export function hostKeyPromptText(request: HostKeyRequest): string {
  const host = `${request.role || 'Server'}: ${request.host}:${request.port}\nKey Type: ${request.keyType}`;
  if (!request.phase) return `${host}\nFingerprint: ${request.fingerprint}\n\nThis server identity is unknown. Verify this fingerprint through a trusted channel before trusting it. Trust is saved only in this Remote Edit installation.`;
  const previous = (request.previous || []).map(item => `${item.fingerprint} — ${item.source}${item.filePath ? ` (${item.filePath}:${item.line})` : ''}`).join('\n');
  const details = `${host}\n${previous ? `Previous Fingerprint / Source:\n${previous}\n` : ''}New Fingerprint: ${request.fingerprint}`;
  if (request.phase === 'blocked') return `${details}\n\n${request.reason}`;
  const userWarning = request.previous?.some(item => item.source === 'OpenSSH (User)') ? '\nThis updates your OpenSSH known_hosts file and may affect other SSH clients. A backup will be created.' : '';
  return request.phase === 'changed'
    ? `${details}\n\nThe SSH host key for this server has changed. This could indicate a server reinstallation or a security risk. Verify the new fingerprint through a trusted channel before replacing the saved key.${userWarning}`
    : `${details}\n\nConfirm only if you have verified this new fingerprint through an independent trusted channel. Choosing “I Verified — Replace & Connect” confirms that verification and replaces the previous trusted key.${userWarning}`;
}
interface PendingApproval { key: string; controller: AbortController; waiters: Set<symbol>; promise: Promise<HostKeyCommit>; }
export class HostKeyTrustService {
  private readonly pending = new Map<string, PendingApproval>();
  constructor(readonly store: TrustedHostStore, readonly knownHosts: KnownHosts,
    private readonly log: (message: string) => void = () => {}) {}
  dispose(): void { for (const entry of this.pending.values()) entry.controller.abort(); this.pending.clear(); }
  async list(): Promise<KnownHostEntry[]> {
    return [...await this.store.list(), ...await this.knownHosts.list()];
  }
  private async check(request: HostKeyRequest): Promise<string | undefined> {
    const internal = (await this.store.list()).filter(item => item.host === request.host && item.port === request.port);
    const external = (await this.knownHosts.list()).filter(item => matchesKnownHost(item, request.host, request.port));
    const location = (item: KnownHostEntry): string => `${item.source}${item.filePath ? ` (${item.filePath}:${item.line})` : ''}`;
    for (const item of external) {
      if (item.marker === '@revoked' && item.publicKey === request.publicKey) throw new HostKeyReviewError(`Revoked key for ${request.host}:${request.port} in ${location(item)}. The presented key has been explicitly revoked. Contact your server administrator to verify the server identity and resolve the revoked key.`, [item], 'SSH Host Key Revoked');
      if (item.marker === '@cert-authority') throw new HostKeyReviewError(`Host certificate authority validation is unsupported for ${request.host}:${request.port} in ${location(item)}. Contact your administrator to configure a supported server identity.`, [item], 'SSH Host Key Conflict');
    }
    // A source may hold several legitimate keys of one algorithm. A match within
    // that source is valid; a mismatch in another source remains a security block.
    const sources = [internal, external.filter(item => !item.marker && item.source === 'OpenSSH (User)'), external.filter(item => !item.marker && item.source === 'OpenSSH (System)')];
    const relevant = sources.flat().filter(item => item.keyType === request.keyType);
    const mismatch = sources.some(entries => {
      const sameType = entries.filter(item => item.keyType === request.keyType);
      return sameType.length && !sameType.some(item => item.publicKey === request.publicKey);
    });
    if (mismatch) {
      const system = relevant.some(item => item.source === 'OpenSSH (System)');
      const replaceable = relevant.length === 1 && !system && (relevant[0].source === 'Remote Edit' || Boolean(relevant[0].removable));
      const guidance = system ? 'The trusted key is managed by the system and cannot be replaced by Remote Edit. Verify the fingerprint with your administrator and update the system known_hosts file before reconnecting.'
        : relevant.length > 1 ? 'Multiple trusted records conflict. Resolve the records in Trusted SSH Hosts before reconnecting; no source will be updated automatically.'
        : !replaceable ? 'This shared or protected OpenSSH record cannot be replaced safely. Verify the identity and update the responsible known_hosts record manually.'
        : 'Connect interactively to review and replace this trusted key after independent fingerprint verification.';
      throw new HostKeyReviewError(`Changed or conflicting ${request.keyType} key for ${request.host}:${request.port}. Expected ${relevant.map(item => `${item.fingerprint} from ${location(item)}`).join('; ')}; received ${request.fingerprint}. ${guidance}`,
        relevant, system ? 'SSH Host Key Changed' : relevant.length > 1 ? 'SSH Host Key Conflict' : replaceable ? 'SSH Host Key Changed' : 'SSH Host Key Cannot Be Replaced', replaceable);
    }
    return [...internal, ...external.filter(item => !item.marker)].find(item => item.publicKey === request.publicKey)?.source;
  }
  private async reportBlock(request: HostKeyRequest, error: unknown, prompt?: HostKeyPrompt, signal?: AbortSignal, title?: string, previous?: KnownHostEntry[]): Promise<void> {
    if (!prompt || signal?.aborted) return;
    const review = error instanceof HostKeyReviewError ? error : undefined;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const confirmation = this.confirmation(prompt, controller);
    try { await confirmation.prompt({ ...request, phase: 'blocked', title: title || review?.title || 'SSH Host Key Conflict', previous: previous || review?.previous,
      reason: error instanceof Error ? error.message : String(error) }, controller.signal); } finally { confirmation.dispose(); signal?.removeEventListener('abort', abort); }
  }
  private challenge(request: HostKeyRequest, raw: Buffer, prompt: HostKeyPrompt, role?: string): HostKeyApprovalRequired {
    const bytes = Buffer.from(raw);
    return new HostKeyApprovalRequired(request, async signal => {
      const commit = await this.evaluate(request.host, request.port, bytes, prompt, signal, role, 'defer');
      return commit || (async resumedSignal => {
        await this.verify(request.host, request.port, bytes, undefined, resumedSignal, role);
      });
    }, (error, signal) => this.reportBlock(request, error, prompt, signal, request.previous ? 'Failed to Replace SSH Host Key' : 'SSH Host Key Conflict', request.previous));
  }
  private confirmation(prompt: HostKeyPrompt, controller: AbortController): { prompt: HostKeyPrompt; dispose: () => void } {
    let timer: NodeJS.Timeout | undefined;
    let expired = false;
    const start = (): void => {
      if (timer || controller.signal.aborted) return;
      timer = setTimeout(() => { expired = true; this.log('SSH host verification expired.'); controller.abort(); }, HOST_KEY_APPROVAL_TIMEOUT_MS);
    };
    const timed: HostKeyPrompt = (request, signal) => new Promise<boolean>((resolve, reject) => {
      const abort = (): void => reject(new HostKeySecurityError(expired ? HOST_KEY_EXPIRED_MESSAGE : 'Connection cancelled.'));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      if (!prompt.managesPresentation) start();
      Promise.resolve().then(() => prompt({ ...request, onPresented: start }, signal)).then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });
    return { prompt: timed, dispose: () => { if (timer) clearTimeout(timer); } };
  }
  async verify(host: string, port: number, raw: Buffer, prompt?: HostKeyPrompt, signal?: AbortSignal, role?: string): Promise<void> {
    const commit = await this.evaluate(host, port, raw, prompt, signal, role);
    if (commit) await commit(signal);
  }
  /** Probe never opens a dialog or writes trust. Deferred approval never writes trust either. */
  async evaluate(host: string, port: number, raw: Buffer, prompt?: HostKeyPrompt, signal?: AbortSignal, role?: string,
    mode?: 'probe' | 'defer'): Promise<HostKeyCommit | undefined> {
    const request: HostKeyRequest = { ...identifyHostKey(raw), host: normalizeHost(host), port, role };
    if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled.');
    let trusted: string | undefined, review: HostKeyReviewError | undefined;
    try { trusted = await this.check(request); }
    catch (error) {
      if (error instanceof HostKeyReviewError && error.replaceable) review = error;
      else {
        if (mode === 'probe' && prompt) throw this.challenge(request, raw, prompt, role);
        await this.reportBlock(request, error, prompt, signal); throw error;
      }
    }
    if (review?.previous[0].source === 'OpenSSH (User)') {
      try { await this.knownHosts.assertReplaceable(review.previous[0]); }
      catch (error) {
        if (mode === 'probe' && prompt) throw this.challenge(request, raw, prompt, role);
        await this.reportBlock(request, error, prompt, signal, 'SSH Host Key Cannot Be Replaced', review.previous); throw error;
      }
    }
    if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled.');
    if (trusted) { if (mode === 'probe') return; if (trusted === 'Remote Edit') await this.store.verified(request.host, port, request); this.log(`Verified ${request.host}:${port} (${request.fingerprint}) using ${trusted}.`); return; }
    if (!prompt && review) throw review;
    if (!prompt) throw new HostKeySecurityError(`Approval required for ${request.host}:${port} (${request.fingerprint}). Connect explicitly from an available interface to approve this server.`);
    if (mode === 'probe') throw this.challenge({ ...request, previous: review?.previous }, raw, prompt, role);
    const id = `${request.host}:${port}:${request.keyType}`;
    let pending = this.pending.get(id);
    if (pending && pending.key !== request.publicKey) throw new HostKeySecurityError('Different server keys were received by simultaneous connection attempts.');
    if (!pending) {
      const controller = new AbortController();
      pending = { key: request.publicKey, controller, waiters: new Set(), promise: Promise.resolve(async () => {}) };
      const entry = pending;
      this.pending.set(id, entry);
      entry.promise = Promise.resolve().then(async () => {
        const previous = review?.previous;
        const first = previous ? { ...request, phase: 'changed' as const, previous } : request;
        this.log(`${previous ? 'Review & Replace' : 'Approval'} requested for ${request.host}:${port} (${request.fingerprint}).`);
        const confirmation = this.confirmation(prompt, controller);
        try {
          const accepted = await confirmation.prompt(first, controller.signal);
          if (!accepted || controller.signal.aborted) {
            this.log(`Host approval cancelled for ${request.host}:${port}.`);
            throw new HostKeySecurityError('Host approval cancelled or rejected.');
          }
          if (previous) {
            const confirmed = await confirmation.prompt({ ...request, phase: 'replace-confirm', previous }, controller.signal);
            if (!confirmed || controller.signal.aborted) {
              this.log(`Host key replacement cancelled for ${request.host}:${port}.`);
              throw new HostKeySecurityError('Host key replacement cancelled or rejected.');
            }
          }
          let applied: Promise<void> | undefined;
          const apply: HostKeyCommit = async (commitSignal?: AbortSignal) => {
            const cancelled = (): void => { if (commitSignal?.aborted) throw new HostKeySecurityError('Connection cancelled.'); };
            cancelled();
            if (previous) {
              try {
                // Re-read every source. The exact reviewed record must still be the
                // sole replaceable conflict; never update multiple stores partially.
                let current: HostKeyReviewError | undefined;
                try { await this.check(request); }
                catch (error) { if (error instanceof HostKeyReviewError && error.replaceable) current = error; else throw error; }
                if (!current || JSON.stringify(current.previous) !== JSON.stringify(previous)) throw new HostKeySecurityError('Trusted records changed during review. Review the current identity again before reconnecting.');
                cancelled();
                const old = previous[0];
                if (old.source === 'Remote Edit') await this.store.replace(old, request, commitSignal);
                else {
                  const backup = await this.knownHosts.replace(old, request, commitSignal);
                  this.log(`OpenSSH user key replacement backup: ${backup}.`);
                }
                if (!await this.check(request)) throw new HostKeySecurityError('The new trusted key was removed during replacement. Reconnect to review the server identity again.');
                this.log(`Replaced ${old.source} key for ${request.host}:${port} (${request.fingerprint}).`);
              } catch (error) {
                this.log(`Host key replacement failed for ${request.host}:${port}.`);
                // Legacy service callers may report here; transports defer reporting until cleanup.
                if (mode !== 'defer') await this.reportBlock(request, error, prompt, commitSignal, 'Failed to Replace SSH Host Key', previous);
                throw error;
              }
            } else {
              // Re-read both stores after UI interaction before creating local trust.
              const existing = await this.check(request);
              cancelled();
              if (!existing) await this.store.trust(request.host, port, request, commitSignal);
              this.log(`Trusted ${request.host}:${port} (${request.fingerprint}) in ${existing || 'Remote Edit'}.`);
            }
          };
          return async (commitSignal?: AbortSignal) => {
            if (commitSignal?.aborted) throw new HostKeySecurityError('Connection cancelled.');
            if (!applied) applied = apply(commitSignal);
            await applied;
            if (!await this.check(request)) throw new HostKeySecurityError('The trusted key was removed after approval. Reconnect to verify the server identity again.');
            if (commitSignal?.aborted) throw new HostKeySecurityError('Connection cancelled.');
          };
        } finally { confirmation.dispose(); }
      }).finally(() => { if (this.pending.get(id) === entry) this.pending.delete(id); });
    }
    const entry = pending, waiter = Symbol(); entry.waiters.add(waiter);
    try {
      const commit = await new Promise<HostKeyCommit>((resolve, reject) => {
        const cancel = (): void => { reject(new HostKeySecurityError('Connection cancelled.')); };
        signal?.addEventListener('abort', cancel, { once: true });
        entry.promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', cancel));
        if (signal?.aborted) cancel();
      });
      if (signal?.aborted) throw new HostKeySecurityError('Connection cancelled.');
      return commit;
    } finally {
      entry.waiters.delete(waiter);
      if (!entry.waiters.size) entry.controller.abort();
    }
  }
}
