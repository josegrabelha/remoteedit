import type { OutputLogDetails } from '../utils/outputLogger';

/**
 * Pure Workspace Sync diagnostic contract.
 *
 * Keep this module free of VS Code runtime dependencies: FTP/SFTP protocol
 * sessions are exercised by plain `node --test` tests and import these types
 * and redaction helpers directly.
 */
export interface WorkspaceSyncDiagnostics {
  debug(source: string, message: string, details?: OutputLogDetails): void;
  performance(source: string, message: string, details?: OutputLogDetails): void;
  timer(): () => number;
}

const SENSITIVE_DETAIL_KEY = /password|passphrase|private\s*key|privateKey|secret|credential|token/i;

export function sanitizeWorkspaceSyncDiagnosticDetails(
  details: OutputLogDetails | undefined
): OutputLogDetails | undefined {
  if (!details) return undefined;
  const safe: OutputLogDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_DETAIL_KEY.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

export function redactWorkspaceSyncDiagnosticText(
  value: unknown,
  secrets: Iterable<string | undefined> = []
): string {
  let text = value instanceof Error ? value.message : String(value);
  const protectedValues = [...secrets]
    .map(secret => String(secret || ''))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const secret of protectedValues) text = text.split(secret).join('[redacted]');
  return text.replace(/\b(password|passphrase)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, 4000);
}
