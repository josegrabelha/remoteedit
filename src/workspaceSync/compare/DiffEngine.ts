import type { BaselineEntry, DiffEntry, FileFingerprint, SyncBaseline, SyncSnapshot } from '../types';
import { fingerprintsEqual } from '../snapshot/FileFingerprint';
import { buildClassificationEvidence } from './ClassificationEvidence';

export interface DiffEngineOptions {
  mtimeToleranceMs?: number;
  remoteMtimeReliable?: boolean;
}

export function diffSnapshots(
  local: SyncSnapshot,
  remote: SyncSnapshot,
  baseline?: SyncBaseline,
  options: DiffEngineOptions = {}
): DiffEntry[] {
  const paths = new Set([
    ...Object.keys(local.entries),
    ...Object.keys(remote.entries),
    ...Object.keys(baseline?.entries || {}),
    ...local.incompletePaths.filter(Boolean),
    ...remote.incompletePaths.filter(Boolean)
  ]);

  return [...paths]
    .sort((a, b) => a.localeCompare(b))
    .map(relativePath => classifyPath(
      relativePath,
      local.entries[relativePath]?.fingerprint,
      remote.entries[relativePath]?.fingerprint,
      baseline?.entries[relativePath],
      local.incompletePaths,
      remote.incompletePaths,
      local.incompleteErrors,
      remote.incompleteErrors,
      options,
      local.entries[relativePath]?.physicalRelativePath || baseline?.entries[relativePath]?.localRelativePath,
      remote.entries[relativePath]?.physicalRelativePath || baseline?.entries[relativePath]?.remoteRelativePath
    ));
}

function classifyPath(
  relativePath: string,
  local: FileFingerprint | undefined,
  remote: FileFingerprint | undefined,
  baseline: BaselineEntry | undefined,
  localIncomplete: string[],
  remoteIncomplete: string[],
  localErrors: Record<string, string> | undefined,
  remoteErrors: Record<string, string> | undefined,
  options: DiffEngineOptions,
  localRelativePath?: string,
  remoteRelativePath?: string
): DiffEntry {
  const paths = { localRelativePath, remoteRelativePath };
  const localScanIncomplete = isUnderIncompletePath(relativePath, localIncomplete);
  const remoteScanIncomplete = isUnderIncompletePath(relativePath, remoteIncomplete);
  if (localScanIncomplete || remoteScanIncomplete) {
    const side = localScanIncomplete && remoteScanIncomplete ? 'Local and Remote' : localScanIncomplete ? 'Local' : 'Remote';
    const details = [
      localScanIncomplete && localErrors?.[relativePath] ? `Local: ${localErrors[relativePath]}` : '',
      remoteScanIncomplete && remoteErrors?.[relativePath] ? `Remote: ${remoteErrors[relativePath]}` : ''
    ].filter(Boolean);
    return {
      relativePath, ...paths, status: 'unknown', local, remote, baseline,
      reason: `${side} scan incomplete for this path${details.length ? ` (${details.join('; ')})` : ''}. It may have disappeared or become inaccessible during scanning. Retry Refresh after the path stabilizes, or exclude transient entries using Ignore Patterns.`
    };
  }

  if (local && remote && local.kind !== remote.kind) {
    return {
      relativePath,
      ...paths,
      status: 'conflict',
      local,
      remote,
      baseline,
      reason: `Local is ${local.kind} while Remote is ${remote.kind}. Structural conflicts are never resolved automatically.`
    };
  }

  // Without trusted history, current Local/Remote equality is the only signal
  // available. With a baseline, however, metadata equality between the two
  // current files must never override a proven one-sided change. This matters
  // especially after interrupted atomic transfers where the destination stays
  // untouched but size/mtime can still look deceptively similar.
  if (!baseline) {
    const equal = fingerprintsEqual(local, remote, {
      mtimeToleranceMs: options.mtimeToleranceMs,
      mtimeReliable: options.remoteMtimeReliable !== false,
      requireHashWhenAvailable: true
    });
    if (local && remote && equal) {
      return { relativePath, ...paths, status: 'same', local, remote, classificationEvidence: { hasBaseline: false, currentContentEqual: true } };
    }
    if (local && remote) {
      return { relativePath, ...paths, status: 'different', local, remote, classificationEvidence: { hasBaseline: false, currentContentEqual: false } };
    }
    if (local) {
      return { relativePath, ...paths, status: 'localOnly', local };
    }
    if (remote) {
      return { relativePath, ...paths, status: 'remoteOnly', remote };
    }
    return { relativePath, ...paths, status: 'unknown', reason: 'Path has no current or baseline state.' };
  }

  // Local/Remote baseline evidence is produced once and is reused by both
  // classification and advisory resolution suggestions.
  const classificationEvidence = buildClassificationEvidence(local, remote, baseline, {
    mtimeToleranceMs: options.mtimeToleranceMs,
    remoteMtimeReliable: options.remoteMtimeReliable !== false
  });
  const localChanged = Boolean(classificationEvidence.localChanged);
  const remoteChanged = Boolean(classificationEvidence.remoteChanged);
  const hadLocal = Boolean(baseline.local);
  const hadRemote = Boolean(baseline.remote);

  if (local && remote) {
    // Matching hashes are stronger evidence than metadata/baseline history. If
    // content verification proved the two current files equal, trust it even if
    // both sides independently changed since the previous baseline.
    const contentProvesEqual = Boolean(classificationEvidence.currentContentEqual);
    if (contentProvesEqual) {
      return { relativePath, ...paths, status: 'same', local, remote, baseline, classificationEvidence: { ...classificationEvidence, currentContentEqual: true }, reason: 'Local and Remote content hashes match.' };
    }
    if (localChanged && remoteChanged) {
      return { relativePath, ...paths, status: 'conflict', local, remote, baseline, classificationEvidence, reason: 'Local and remote both changed since the baseline.' };
    }
    if (localChanged) {
      return { relativePath, ...paths, status: 'localChanged', local, remote, baseline, classificationEvidence };
    }
    if (remoteChanged) {
      return { relativePath, ...paths, status: 'remoteChanged', local, remote, baseline, classificationEvidence };
    }
    return { relativePath, ...paths, status: 'same', local, remote, baseline, classificationEvidence, reason: 'Both sides still match their trusted baseline.' };
  }

  if (local && !remote) {
    if (hadRemote) {
      if (localChanged) {
        return { relativePath, ...paths, status: 'conflict', local, baseline, classificationEvidence, reason: 'Remote was deleted while local changed.' };
      }
      return { relativePath, ...paths, status: 'remoteDeleted', local, baseline, classificationEvidence };
    }
    return { relativePath, ...paths, status: 'localOnly', local, baseline };
  }

  if (!local && remote) {
    if (hadLocal) {
      if (remoteChanged) {
        return { relativePath, ...paths, status: 'conflict', remote, baseline, classificationEvidence, reason: 'Local was deleted while remote changed.' };
      }
      return { relativePath, ...paths, status: 'localDeleted', remote, baseline, classificationEvidence };
    }
    return { relativePath, ...paths, status: 'remoteOnly', remote, baseline };
  }

  if ((hadLocal && !hadRemote) || (!hadLocal && hadRemote) || (hadLocal && hadRemote)) {
    return { relativePath, ...paths, status: 'same', baseline, classificationEvidence };
  }

  return { relativePath, ...paths, status: 'unknown', baseline, reason: 'Path has no current state.' };
}

function isUnderIncompletePath(relativePath: string, incompletePaths: string[]): boolean {
  return incompletePaths.some(prefix => {
    if (!prefix) {
      return true;
    }
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  });
}
