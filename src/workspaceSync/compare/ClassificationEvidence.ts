import type { BaselineEntry, DiffClassificationEvidence, FileFingerprint } from '../types';
import { fingerprintsEqual } from '../snapshot/FileFingerprint';

export interface ClassificationEvidenceOptions {
  remoteMtimeReliable: boolean;
  mtimeToleranceMs?: number;
}

/**
 * Produces the baseline/content evidence used by the common classifier and by
 * advisory conflict suggestions. Keeping this in one helper prevents the UI
 * suggestion route from inventing a second interpretation of Local/Remote
 * change history.
 */
export function buildClassificationEvidence(
  local: FileFingerprint | undefined,
  remote: FileFingerprint | undefined,
  baseline: BaselineEntry | undefined,
  options: ClassificationEvidenceOptions
): DiffClassificationEvidence {
  const currentContentEqual = Boolean(
    local?.kind === 'file'
    && remote?.kind === 'file'
    && local.hash
    && remote.hash
    && local.hash === remote.hash
  );

  if (!baseline) {
    return { hasBaseline: false, currentContentEqual };
  }

  const localChanged = !fingerprintsEqual(local, baseline.local, {
    mtimeToleranceMs: 0,
    mtimeReliable: true,
    requireHashWhenAvailable: Boolean(baseline.local?.hash)
  });
  const remoteChanged = !fingerprintsEqual(remote, baseline.remote, {
    mtimeToleranceMs: options.mtimeToleranceMs,
    mtimeReliable: options.remoteMtimeReliable,
    requireHashWhenAvailable: Boolean(baseline.remote?.hash)
  });

  return {
    hasBaseline: true,
    localChanged,
    remoteChanged,
    currentContentEqual
  };
}
