import type { SyncOperation } from '../types';

/**
 * Returns concise, actionable guidance for a failed Workspace Sync operation.
 * The original protocol/filesystem error is logged separately and must remain
 * visible for troubleshooting; this helper only adds context and a next step.
 */
export function describeSyncOperationFailure(operation: SyncOperation, error: string): string | undefined {
  const raw = String(error || '').trim();
  if (!raw || /cancel(?:led|ed)|cancellation/i.test(raw)) return undefined;

  const lower = raw.toLowerCase();
  const connectionFailure = /(?:connection|socket|channel).*(?:closed|lost|reset|ended)|econn(?:reset|refused|aborted)|not connected|timed?\s*out|timeout|broken pipe|network.*(?:unreachable|down)|421\b|425\b/.test(lower);
  const permissionFailure = /permission denied|eacces|eperm|access denied|not permitted|operation not permitted|(?:^|\s)550(?:\s|$).*(?:permission|denied)/.test(lower);
  const spaceFailure = /enospc|no space left|disk full|quota exceeded|exceeded.*quota/.test(lower);

  if (connectionFailure) {
    return 'Suggested action: Reconnect the target, run Refresh, and retry. The failed operation does not advance its synchronization baseline.';
  }

  if (spaceFailure) {
    const destination = operation.type === 'download' || operation.type === 'createLocalDirectory' || operation.type === 'deleteLocal'
      ? 'Local destination'
      : 'Remote destination';
    return `Suggested action: Check free space or quota on the ${destination}, run Refresh, and retry.`;
  }

  if (permissionFailure) {
    const destination = operation.type === 'download' || operation.type === 'createLocalDirectory' || operation.type === 'deleteLocal'
      ? 'Local path'
      : 'Remote path';
    return `Suggested action: Verify permissions for the ${destination}, run Refresh, and retry.`;
  }

  switch (operation.type) {
    case 'deleteRemote':
      if (operation.expectedRemote?.kind === 'directory') {
        return 'Suggested action: Refresh and inspect the remaining Remote directory contents and permissions before retrying. The directory may still contain files or may have changed during the operation.';
      }
      return 'Suggested action: Refresh, verify that the Remote path still exists and can be removed, then retry.';

    case 'deleteLocal':
      if (operation.expectedLocal?.kind === 'directory') {
        return 'Suggested action: Refresh and inspect the remaining Local directory contents and permissions before retrying. The directory may still contain files or may have changed during the operation.';
      }
      return 'Suggested action: Refresh, verify that the Local path can be removed, then retry.';

    case 'upload':
      return 'Suggested action: Verify the connection, Remote write permissions, and available Remote space; then run Refresh and retry.';

    case 'download':
      return 'Suggested action: Verify the connection, Remote read permissions, Local write permissions, and available Local space; then run Refresh and retry.';

    case 'createRemoteDirectory':
      return 'Suggested action: Verify the Remote parent path and write permissions, run Refresh, and retry.';

    case 'createLocalDirectory':
      return 'Suggested action: Verify the Local parent path and write permissions, run Refresh, and retry.';

    case 'skip':
      return undefined;
  }
}

/**
 * Formats the useful technical output carried by protocol and filesystem errors
 * without dumping a stack trace or arbitrary object properties into Activity.
 * Only a small allow-list of common error fields is exposed; WorkspaceSyncUi
 * still sanitizes secrets before the line is rendered or copied.
 */
export function formatSyncErrorOutput(error: unknown): string {
  const message = normalizeTechnicalValue(errorMessage(error));
  const details: string[] = [];
  const record = isRecord(error) ? error : undefined;

  if (record) {
    const fields: Array<[string, string]> = [
      ['code', 'code'],
      ['status', 'status'],
      ['statusCode', 'statusCode'],
      ['responseCode', 'responseCode'],
      ['ftpCode', 'ftpCode'],
      ['errno', 'errno'],
      ['syscall', 'syscall'],
      ['path', 'path'],
      ['dest', 'dest'],
      ['command', 'command'],
      ['response', 'response'],
      ['serverMessage', 'serverMessage']
    ];

    for (const [key, label] of fields) {
      const value = primitiveTechnicalValue(record[key]);
      if (!value) continue;
      details.push(`${label}=${value}`);
    }

    const cause = record.cause;
    if (cause !== undefined && cause !== null) {
      const causeMessage = normalizeTechnicalValue(errorMessage(cause));
      if (causeMessage && causeMessage !== message && !message.includes(causeMessage)) details.push(`cause=${causeMessage}`);
    }
  }

  const combined = [message, ...dedupe(details)].filter(Boolean).join(' | ');
  return combined.slice(0, 3000) || 'Unknown error';
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && typeof error.message === 'string' && error.message.trim()) return error.message;
  return String(error ?? 'Unknown error');
}

function primitiveTechnicalValue(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const normalized = normalizeTechnicalValue(String(value));
    return normalized || undefined;
  }
  return undefined;
}

function normalizeTechnicalValue(value: string): string {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 1500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
