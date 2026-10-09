export type ProxyFailureReason = 'timeout' | 'authentication' | 'connection-refused' | 'cancelled' | 'destination-rejected' | 'connection-failed' | 'invalid-response' | 'invalid-configuration';
export type ProxyDiagnostic = { type: string; status: 'connecting' | 'connected' | 'failed'; durationMs: number; reason?: ProxyFailureReason };
let report: ((event: ProxyDiagnostic) => void) | undefined;
export function setProxyDiagnostics(listener?: (event: ProxyDiagnostic) => void): void { report = listener; }
export function proxyDiagnostic(event: ProxyDiagnostic): void {
  try { report?.(event); } catch { /* Diagnostics must not affect connections. */ }
}
/** Only fixed categories are logged, never error text or handshake data. */
export function proxyFailureReason(error: unknown): ProxyFailureReason {
  const message = error instanceof Error ? error.message : '';
  if (/connection refused/i.test(message)) return 'connection-refused';
  if (/timed out/i.test(message)) return 'timeout';
  if (/cancelled/i.test(message)) return 'cancelled';
  if (/authentication|credentials/i.test(message)) return 'authentication';
  if (/rejected/i.test(message)) return 'destination-rejected';
  if (/response|headers/i.test(message)) return 'invalid-response';
  if (/Invalid|Unsupported|does not support|too long/i.test(message)) return 'invalid-configuration';
  return 'connection-failed';
}
