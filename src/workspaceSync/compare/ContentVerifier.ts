import type { SyncBaseline, SyncSnapshot } from '../types';
import type { WorkspaceSyncRemoteSession } from '../connection/WorkspaceSyncSession';
import { fingerprintsEqual, hashLocalFile } from '../snapshot/FileFingerprint';
import { joinRemotePath } from '../scan/RemoteScanner';
import { safeLocalPath } from '../scan/LocalScanner';

export interface ContentVerificationOptions {
  mtimeToleranceMs?: number;
  concurrency?: number;
  cancellationToken?: { readonly isCancellationRequested: boolean };
  onProgress?: (completed: number, total: number, relativePath: string) => void;
  /** Paths that must be content-hashed on both sides before they can be trusted as Same. */
  forceHashPaths?: Iterable<string>;
}

/**
 * Adds SHA-256 fingerprints only where metadata cannot prove that two file states
 * are equal. This keeps the normal scan inexpensive while making unreliable FTP
 * timestamps and same-size/mismatched-time comparisons safe.
 */
export async function verifyComparisonContent(
  localRoot: string,
  remoteRoot: string,
  session: WorkspaceSyncRemoteSession,
  local: SyncSnapshot,
  remote: SyncSnapshot,
  baseline?: SyncBaseline,
  options: ContentVerificationOptions = {}
): Promise<{ local: SyncSnapshot; remote: SyncSnapshot }> {
  const nextLocal = cloneSnapshot(local);
  const nextRemote = cloneSnapshot(remote);
  const pathsToHashRemote = new Set<string>();
  const pathsToHashLocal = new Set<string>();
  const tolerance = Math.max(0, options.mtimeToleranceMs ?? 2000);
  const forcedPaths = new Set(options.forceHashPaths || []);

  for (const [relativePath, remoteEntry] of Object.entries(nextRemote.entries)) {
    if (isUnderIncompletePath(relativePath, nextLocal.incompletePaths)
      || isUnderIncompletePath(relativePath, nextRemote.incompletePaths)) continue;
    if (remoteEntry.fingerprint.kind !== 'file') continue;
    const localFingerprint = nextLocal.entries[relativePath]?.fingerprint;
    const baselineEntry = baseline?.entries[relativePath];
    const baselineLocal = baselineEntry?.local;
    const baselineRemote = baselineEntry?.remote;

    // A failed/interrupted transfer marks its path for a strong comparison.
    // Hash both current files regardless of metadata so a stale destination can
    // never become Same merely because size/mtime happen to align.
    if (forcedPaths.has(relativePath) && localFingerprint?.kind === 'file') {
      pathsToHashRemote.add(relativePath);
      pathsToHashLocal.add(relativePath);
      continue;
    }

    // Once both sides independently still match a trusted baseline, they do
    // not need to match each other's mtimes. Upload/download operations often
    // produce different Local and Remote mtimes even though neither side has
    // changed since the last successful sync.
    if (session.capabilities.reliableMtime
      && localFingerprint?.kind === 'file'
      && baselineLocal?.kind === 'file'
      && baselineRemote?.kind === 'file'
      && fingerprintsEqual(localFingerprint, baselineLocal, { mtimeToleranceMs: 0, mtimeReliable: true })
      && fingerprintsEqual(remoteEntry.fingerprint, baselineRemote, { mtimeToleranceMs: tolerance, mtimeReliable: true })) {
      continue;
    }

    // FTP servers frequently provide missing/coarse/incorrect mtimes. When the
    // size still matches the trusted baseline we need content to prove that the
    // remote file did not change.
    if (!session.capabilities.reliableMtime
      && baselineRemote?.kind === 'file'
      && baselineRemote.size === remoteEntry.fingerprint.size) {
      pathsToHashRemote.add(relativePath);
    }

    if (localFingerprint?.kind !== 'file' || localFingerprint.size !== remoteEntry.fingerprint.size) {
      continue;
    }

    const metadataCanProveEqual = session.capabilities.reliableMtime
      && fingerprintsEqual(localFingerprint, remoteEntry.fingerprint, {
        mtimeToleranceMs: tolerance,
        mtimeReliable: true
      });

    if (!metadataCanProveEqual) {
      pathsToHashRemote.add(relativePath);
      pathsToHashLocal.add(relativePath);
    }
  }

  // Once a baseline contains hashes, keep using them for the current file even
  // when metadata happens to be unchanged. Some tools preserve size/mtime while
  // replacing content; silently dropping the trusted hash would allow such a
  // change to be missed and could overwrite it during bidirectional sync.
  for (const [relativePath, baselineEntry] of Object.entries(baseline?.entries || {})) {
    if (isUnderIncompletePath(relativePath, nextLocal.incompletePaths)
      || isUnderIncompletePath(relativePath, nextRemote.incompletePaths)) continue;
    const localFingerprint = nextLocal.entries[relativePath]?.fingerprint;
    if (baselineEntry.local?.kind === 'file'
      && baselineEntry.local.hash
      && localFingerprint?.kind === 'file'
      && baselineEntry.local.size === localFingerprint.size) {
      pathsToHashLocal.add(relativePath);
    }

    const remoteFingerprint = nextRemote.entries[relativePath]?.fingerprint;
    if (baselineEntry.remote?.kind === 'file'
      && baselineEntry.remote.hash
      && remoteFingerprint?.kind === 'file'
      && baselineEntry.remote.size === remoteFingerprint.size) {
      pathsToHashRemote.add(relativePath);
    }
  }

  const jobs: Array<{ relativePath: string; side: 'local' | 'remote'; run: () => Promise<void> }> = [];
  for (const relativePath of pathsToHashRemote) {
    jobs.push({
      relativePath,
      side: 'remote',
      run: async () => {
        throwIfCancelled(options.cancellationToken);
        const entry = nextRemote.entries[relativePath];
        if (!entry || entry.fingerprint.kind !== 'file') return;
        entry.fingerprint.hash = await session.hashFile(joinRemotePath(remoteRoot, entry.physicalRelativePath || relativePath));
      }
    });
  }
  for (const relativePath of pathsToHashLocal) {
    jobs.push({
      relativePath,
      side: 'local',
      run: async () => {
        throwIfCancelled(options.cancellationToken);
        const entry = nextLocal.entries[relativePath];
        if (!entry || entry.fingerprint.kind !== 'file') return;
        entry.fingerprint.hash = await hashLocalFile(safeLocalPath(localRoot, entry.physicalRelativePath || relativePath));
      }
    });
  }

  let completed = 0;
  const concurrency = Math.max(1, Math.min(8, Math.floor(options.concurrency || 4)));
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      throwIfCancelled(options.cancellationToken);
      const index = nextIndex++;
      if (index >= jobs.length) return;
      const job = jobs[index];
      try {
        await job.run();
      } catch (error) {
        if (options.cancellationToken?.isCancellationRequested) throw error;
        const incomplete = job.side === 'remote' ? nextRemote.incompletePaths : nextLocal.incompletePaths;
        if (!incomplete.includes(job.relativePath)) incomplete.push(job.relativePath);
      }
      completed += 1;
      options.onProgress?.(completed, jobs.length, job.relativePath);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, jobs.length)) }, () => worker()));

  return { local: nextLocal, remote: nextRemote };
}

function cloneSnapshot(snapshot: SyncSnapshot): SyncSnapshot {
  const entries: SyncSnapshot['entries'] = {};
  for (const [relativePath, entry] of Object.entries(snapshot.entries)) {
    entries[relativePath] = {
      relativePath: entry.relativePath,
      physicalRelativePath: entry.physicalRelativePath,
      fingerprint: { ...entry.fingerprint }
    };
  }
  return {
    capturedAt: snapshot.capturedAt,
    incompletePaths: [...snapshot.incompletePaths],
    ...(snapshot.incompleteErrors ? { incompleteErrors: { ...snapshot.incompleteErrors } } : {}),
    entries
  };
}

function isUnderIncompletePath(relativePath: string, incompletePaths: string[]): boolean {
  return incompletePaths.some(prefix => !prefix || relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

function throwIfCancelled(token?: { readonly isCancellationRequested: boolean }): void {
  if (token?.isCancellationRequested) throw new Error('Workspace Sync content verification cancelled.');
}
