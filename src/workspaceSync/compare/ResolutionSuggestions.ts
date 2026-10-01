import type { DiffEntry, WorkspaceSyncConflictResolution } from '../types';
import { buildClassificationEvidence } from './ClassificationEvidence';

export interface ResolutionSuggestionOptions {
  /** True only when Local and Remote mtimes are absolute instants that can be compared. */
  remoteTimestampAbsolute: boolean;
  mtimeToleranceMs?: number;
}

/**
 * Returns a conservative UI suggestion for a path that already requires a
 * manual resolution. This function NEVER changes a plan. Suggestions consume
 * evidence from the same baseline classifier used by Refresh/Watch; timestamps
 * may corroborate diagnostics but never choose a winner on their own.
 */
export function suggestConflictResolution(
  diff: DiffEntry,
  options: ResolutionSuggestionOptions
): WorkspaceSyncConflictResolution | undefined {
  if (diff.status !== 'conflict' && diff.status !== 'different') return undefined;

  const local = diff.local;
  const remote = diff.remote;

  // A file-vs-directory (or other kind) collision has no safe automatic side.
  // Skip is the only non-destructive resolution exposed by the current UI.
  if (local && remote && local.kind !== remote.kind) return 'skip';

  const evidence = diff.classificationEvidence || buildClassificationEvidence(local, remote, diff.baseline, {
    remoteMtimeReliable: options.remoteTimestampAbsolute,
    mtimeToleranceMs: options.mtimeToleranceMs ?? 2000
  });

  // Strong current-content equality is safer than choosing either side.
  if (evidence.currentContentEqual) return 'skip';

  // Reuse the common classifier's baseline evidence. If exactly one side still
  // matches the trusted baseline, the other side is the only proven change.
  if (evidence.hasBaseline) {
    if (evidence.localChanged === false && evidence.remoteChanged === true) return 'useRemote';
    if (evidence.localChanged === true && evidence.remoteChanged === false) return 'useLocal';
  }

  // A timestamp may break the tie only after the common classifier has
  // already proved, against a trusted baseline, that BOTH sides changed. This
  // restores a useful advisory for genuine conflicts without reintroducing a
  // standalone "newer timestamp wins" rule. FTP/FTPS server-local times are
  // never used here; remoteTimestampAbsolute is true only for comparable SFTP
  // instants.
  if (evidence.hasBaseline
    && evidence.localChanged === true
    && evidence.remoteChanged === true
    && options.remoteTimestampAbsolute
    && local?.kind === 'file'
    && remote?.kind === 'file'
    && local.mtimeMs > 0
    && remote.mtimeMs > 0) {
    const tolerance = Math.max(0, options.mtimeToleranceMs ?? 2000);
    const delta = local.mtimeMs - remote.mtimeMs;
    if (Math.abs(delta) > tolerance) return delta > 0 ? 'useLocal' : 'useRemote';
  }

  return undefined;
}
