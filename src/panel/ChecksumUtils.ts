import { formatBytes } from '../utils/progressUtils';
import type { RemoteChecksumSummary, RemoteChecksumValue } from '../ssh/SftpSessionManager';

export function formatChecksumLine(checksum: RemoteChecksumValue): string {
  if (checksum.value) {
    return checksum.command ? `${checksum.value} (${checksum.command})` : checksum.value;
  }

  return checksum.error || 'Not available';
}

export function buildChecksumsCopyText(remotePath: string, result: RemoteChecksumSummary): string {
  const lines = [`Remote file: ${remotePath}`];

  if (result.sha256.value) {
    lines.push(`SHA-256: ${result.sha256.value}`);
  }
  if (result.md5.value) {
    lines.push(`MD5: ${result.md5.value}`);
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

export function formatTimestampForDialog(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return 'unknown';
  }

  return new Date(value).toLocaleString();
}

export function buildChecksumsDialogPayload(remotePath: string, size: number, modifyTime: number, result: RemoteChecksumSummary): Record<string, string> {
  return {
    remotePath,
    size: formatBytes(size),
    modified: formatTimestampForDialog(modifyTime),
    sha256: formatChecksumLine(result.sha256),
    md5: formatChecksumLine(result.md5),
    sha256Value: result.sha256.value || '',
    md5Value: result.md5.value || '',
    copyAllText: buildChecksumsCopyText(remotePath, result)
  };
}
