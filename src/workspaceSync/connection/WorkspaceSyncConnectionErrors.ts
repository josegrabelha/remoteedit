export class WorkspaceSyncPassphraseRequiredError extends Error {
  constructor(
    readonly profileId: string,
    readonly profileName: string,
    readonly isJumpHost: boolean,
    cause?: unknown
  ) {
    super(`A passphrase is required for the private key used by ${isJumpHost ? 'Jump Host' : 'connection'} '${profileName}'.`);
    this.name = 'WorkspaceSyncPassphraseRequiredError';
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

export function looksLikeMissingPassphrase(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /passphrase|encrypted\s+private|private\s+key.*encrypted|cannot\s+parse\s+private.?key/i.test(message);
}
