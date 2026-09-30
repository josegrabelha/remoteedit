import * as crypto from 'crypto';
import * as fs from 'fs';
import type { FileFingerprint } from '../types';

export interface FingerprintComparisonOptions {
  mtimeToleranceMs?: number;
  requireHashWhenAvailable?: boolean;
  mtimeReliable?: boolean;
}

export function fingerprintsEqual(
  left: FileFingerprint | undefined,
  right: FileFingerprint | undefined,
  options: FingerprintComparisonOptions = {}
): boolean {
  if (!left || !right) {
    return left === right;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'directory') {
    return true;
  }
  if (left.size !== right.size) {
    return false;
  }

  if (left.hash && right.hash) {
    return left.hash === right.hash;
  }
  if (options.requireHashWhenAvailable && (left.hash || right.hash)) {
    return false;
  }

  if (options.mtimeReliable === false) {
    return false;
  }
  const tolerance = Math.max(0, options.mtimeToleranceMs ?? 2000);
  if (!left.mtimeMs || !right.mtimeMs) {
    return false;
  }
  return Math.abs(left.mtimeMs - right.mtimeMs) <= tolerance;
}

export async function hashLocalFile(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
