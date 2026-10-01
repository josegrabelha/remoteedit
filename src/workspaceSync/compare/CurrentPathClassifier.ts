import type { WorkspaceSyncRemoteSession } from '../connection/WorkspaceSyncSession';
import type { BaselineEntry, DiffEntry, FileFingerprint, SyncBaseline, SyncSnapshot } from '../types';
import { readLocalFingerprint, readRemoteFingerprint } from '../snapshot/CurrentState';
import { fingerprintsEqual } from '../snapshot/FileFingerprint';
import { diffSnapshots } from './DiffEngine';

export interface CurrentPathClassifierOptions {
  relativePath: string;
  localPath: string;
  remotePath: string;
  baseline?: BaselineEntry;
  baselineCapturedAt?: number;
  localRelativePath?: string;
  remoteRelativePath?: string;
  localKnown?: boolean;
  local?: FileFingerprint;
  remoteKnown?: boolean;
  remote?: FileFingerprint;
  mtimeToleranceMs?: number;
}

export interface CurrentPathClassification {
  local?: FileFingerprint;
  remote?: FileFingerprint;
  diff: DiffEntry;
}


export function baselineRequiresStrongFingerprint(
  baseline: BaselineEntry | undefined,
  remoteMtimeReliable: boolean,
  forceStrong = false
): boolean {
  return forceStrong
    || !remoteMtimeReliable
    || Boolean(baseline?.local?.hash)
    || Boolean(baseline?.remote?.hash);
}

/**
 * Reads and classifies one Local/Remote path using exactly the same baseline
 * semantics as a full Refresh. Watch Local, Watch Remote and incremental view
 * refreshes must go through this helper rather than reimplementing changed-side
 * detection independently.
 *
 * A trusted hash is never compared to metadata-only state: if either baseline
 * side already carries a hash, that current side is upgraded to a hash before
 * classification. For unreliable Remote mtimes, both current regular files are
 * hashed when needed so current equality can be proven symmetrically.
 */
export async function readAndClassifyCurrentPath(
  session: WorkspaceSyncRemoteSession,
  options: CurrentPathClassifierOptions
): Promise<CurrentPathClassification> {
  const tolerance = Math.max(0, options.mtimeToleranceMs ?? 2000);
  const baseline = options.baseline;
  const reliableRemoteMtime = session.capabilities.reliableMtime;

  const localHashRequired = Boolean(baseline?.local?.hash) || !reliableRemoteMtime;
  const remoteHashRequired = Boolean(baseline?.remote?.hash) || !reliableRemoteMtime;

  let local = options.localKnown
    ? options.local
    : await readLocalFingerprint(options.localPath, localHashRequired);
  let remote = options.remoteKnown
    ? options.remote
    : await readRemoteFingerprint(session, options.remotePath, remoteHashRequired);

  if (local?.kind === 'file' && localHashRequired && !local.hash) {
    local = await readLocalFingerprint(options.localPath, true) || local;
  }
  if (remote?.kind === 'file' && remoteHashRequired && !remote.hash) {
    remote = await readRemoteFingerprint(session, options.remotePath, true) || remote;
  }

  // With no trusted history, metadata differences are not enough to claim the
  // files differ. Hash one changed path on both sides to avoid a false
  // Different/Conflict caused only by timestamp differences.
  if (!baseline && local?.kind === 'file' && remote?.kind === 'file') {
    const metadataEqual = fingerprintsEqual(local, remote, {
      mtimeToleranceMs: tolerance,
      mtimeReliable: reliableRemoteMtime,
      requireHashWhenAvailable: false
    });
    if (!metadataEqual || !reliableRemoteMtime) {
      if (!local.hash) local = await readLocalFingerprint(options.localPath, true) || local;
      if (!remote.hash) remote = await readRemoteFingerprint(session, options.remotePath, true) || remote;
    }
  }

  return {
    local,
    remote,
    diff: classifyCurrentPath({
      relativePath: options.relativePath,
      local,
      remote,
      baseline,
      baselineCapturedAt: options.baselineCapturedAt,
      localRelativePath: options.localRelativePath,
      remoteRelativePath: options.remoteRelativePath,
      remoteMtimeReliable: reliableRemoteMtime,
      mtimeToleranceMs: tolerance
    })
  };
}

export function classifyCurrentPath(options: {
  relativePath: string;
  local?: FileFingerprint;
  remote?: FileFingerprint;
  baseline?: BaselineEntry;
  baselineCapturedAt?: number;
  localRelativePath?: string;
  remoteRelativePath?: string;
  remoteMtimeReliable: boolean;
  mtimeToleranceMs?: number;
}): DiffEntry {
  const capturedAt = Date.now();
  const localSnapshot: SyncSnapshot = {
    capturedAt,
    entries: options.local ? {
      [options.relativePath]: {
        relativePath: options.relativePath,
        physicalRelativePath: options.localRelativePath || options.relativePath,
        fingerprint: options.local
      }
    } : {},
    incompletePaths: []
  };
  const remoteSnapshot: SyncSnapshot = {
    capturedAt,
    entries: options.remote ? {
      [options.relativePath]: {
        relativePath: options.relativePath,
        physicalRelativePath: options.remoteRelativePath || options.relativePath,
        fingerprint: options.remote
      }
    } : {},
    incompletePaths: []
  };
  const scopedBaseline: SyncBaseline | undefined = options.baseline ? {
    mappingId: '__path__',
    targetId: '__path__',
    capturedAt: options.baselineCapturedAt || capturedAt,
    entries: { [options.relativePath]: options.baseline }
  } : undefined;

  const diff = diffSnapshots(localSnapshot, remoteSnapshot, scopedBaseline, {
    mtimeToleranceMs: Math.max(0, options.mtimeToleranceMs ?? 2000),
    remoteMtimeReliable: options.remoteMtimeReliable
  })[0];

  // A one-path classification must always return a DiffEntry, even when the
  // path disappeared from both sides and has no baseline. Full-tree diffing
  // naturally omits such a path because there is no snapshot key to union, but
  // Watch callers already have an explicit candidate path from a previous
  // observation. Returning a stable Unknown result keeps that transient race
  // from turning into an undefined dereference in the watcher pipeline.
  return diff || {
    relativePath: options.relativePath,
    localRelativePath: options.localRelativePath,
    remoteRelativePath: options.remoteRelativePath,
    status: 'unknown',
    reason: 'Path has no current or baseline state.'
  };
}
