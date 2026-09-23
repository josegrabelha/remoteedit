export type LogHighlightLevel = 'error' | 'warn' | 'info' | 'debug' | '';

export type LogLevelSource =
  | 'structured'
  | 'journald'
  | 'pino'
  | 'opentelemetry'
  | 'syslog-pri'
  | 'syslog-facility'
  | 'key-value'
  | 'process-prefix'
  | 'bracket-prefix'
  | 'text-prefix'
  | 'auditd'
  | 'selinux'
  | 'rsyslog'
  | 'continuation'
  | '';

export interface LogLevelClassification {
  level: LogHighlightLevel;
  source: LogLevelSource;
}

/**
 * Classifies common text and structured log severity formats into the four
 * visual levels supported by Log Viewer. Detection is deliberately bounded to
 * a short prefix for text formats so very large log records stay inexpensive.
 *
 * The function is self-contained because its compiled source is also injected
 * into the Log Viewer webview as a compatibility fallback for transient partial
 * lines and snapshots produced by older extension state.
 */
export function classifyLogRecord(raw: unknown, structured?: unknown): LogLevelClassification {
  type Level = LogHighlightLevel;
  type Source = LogLevelSource;
  type Result = LogLevelClassification;

  const none = (): Result => ({ level: '', source: '' });
  const result = (level: Level, source: Source): Result => ({ level, source });

  const fromAlias = (value: unknown): Level => {
    const token = String(value ?? '')
      .trim()
      .replace(/^['"\[\](){}<>]+|['"\[\](){}<>:;,]+$/g, '')
      .toUpperCase();
    if (!token) return '';

    if ([
      'EMERG', 'EMERGENCY', 'ALERT', 'CRIT', 'CRITICAL', 'FATAL', 'FTL',
      'ERROR', 'ERR', 'FAIL', 'FAILED', 'SEVERE', 'PANIC'
    ].includes(token)) return 'error';

    if (['WARN', 'WARNING', 'WRN'].includes(token)) return 'warn';

    if (['NOTICE', 'INFO', 'INF', 'INFORMATION'].includes(token)) return 'info';

    if ([
      'DEBUG', 'DBG', 'DBUG', 'TRACE', 'TRC', 'TRCE', 'VERBOSE', 'VRB'
    ].includes(token)) return 'debug';

    return '';
  };

  const fromSyslogSeverity = (value: unknown): Level => {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 7) return '';
    if (numeric <= 3) return 'error';
    if (numeric === 4) return 'warn';
    if (numeric <= 6) return 'info';
    return 'debug';
  };

  const fromPinoLevel = (value: unknown): Level => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '';
    if (numeric >= 50) return 'error';
    if (numeric >= 40) return 'warn';
    if (numeric >= 30) return 'info';
    if (numeric >= 10) return 'debug';
    return '';
  };

  const fromOtelSeverityNumber = (value: unknown): Level => {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 24) return '';
    if (numeric >= 17) return 'error';
    if (numeric >= 13) return 'warn';
    if (numeric >= 9) return 'info';
    return 'debug';
  };

  const classifyStructuredValue = (key: string, value: unknown): Result => {
    const rawKey = String(key || '');
    const normalizedKey = rawKey.toLowerCase().replace(/[^a-z0-9@]/g, '');
    const alias = fromAlias(value);
    if (alias) return result(alias, 'structured');

    if (rawKey === 'PRIORITY') {
      const level = fromSyslogSeverity(value);
      return level ? result(level, 'journald') : none();
    }

    if (['syslogseverity', 'syslogseveritycode', 'syslogpriority'].includes(normalizedKey)) {
      const level = fromSyslogSeverity(value);
      return level ? result(level, 'structured') : none();
    }

    if (normalizedKey === 'severitynumber' || normalizedKey === 'otelseveritynumber') {
      const level = fromOtelSeverityNumber(value);
      return level ? result(level, 'opentelemetry') : none();
    }

    if ([
      'level', 'levelname', 'lvl', '@l', 'loglevel', 'loglevelname'
    ].includes(normalizedKey)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 10) {
        const level = fromPinoLevel(numeric);
        return level ? result(level, 'pino') : none();
      }
    }

    return none();
  };

  const findStructuredLevel = (value: unknown, depth: number): Result => {
    if (!value || typeof value !== 'object' || depth > 3) return none();
    const objectValue = value as Record<string, unknown>;
    const entries = Object.entries(objectValue);

    // Explicit severity fields always win over message text.
    for (const [key, fieldValue] of entries) {
      const normalizedKey = String(key || '').toLowerCase().replace(/[^a-z0-9@]/g, '');
      if ([
        'level', 'levelname', 'lvl', '@l', 'loglevel', 'loglevelname', 'severity',
        'severitytext', 'severityname', 'severitynumber', 'otelseveritynumber', 'priority',
        'syslogseverity', 'syslogseveritycode', 'syslogpriority'
      ].includes(normalizedKey)) {
        const classified = classifyStructuredValue(key, fieldValue);
        if (classified.level) return classified;
      }
    }

    // Recurse only through common logging wrappers. Avoid walking arbitrary
    // business payloads where fields such as "priority" may mean something else.
    const preferredNestedKeys = ['log', 'event', 'record', 'attributes', 'metadata', 'meta'];
    for (const key of preferredNestedKeys) {
      const entry = entries.find(([candidate]) => candidate.toLowerCase() === key);
      if (!entry) continue;
      const classified = findStructuredLevel(entry[1], depth + 1);
      if (classified.level) return classified;
    }
    return none();
  };

  const structuredLevel = findStructuredLevel(structured, 0);
  if (structuredLevel.level) return structuredLevel;

  const text = String(raw ?? '');
  if (!text) return none();
  const rawHead = text.slice(0, 4096);
  if (!rawHead.trim() && text.length <= 4096) return none();

  // JSON.parse can be relatively expensive for huge records. Structured JSON
  // severity normally appears near the top-level and ordinary logs are much
  // smaller, so cap fallback parsing while retaining text detection below.
  if (structured === undefined && text.length <= 65536) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        const parsedLevel = findStructuredLevel(parsed, 0);
        if (parsedLevel.level) return parsedLevel;
      } catch {
        // Fall through to text-format detection for malformed JSON.
      }
    }
  }

  const stripAnsi = (value: string): string => value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '');

  // Text classifiers only need the beginning of a record. This keeps giant
  // SELinux/audit records and stack payloads cheap to inspect.
  let head = stripAnsi(rawHead);
  head = head.replace(/^\s*stderr:\s*/i, '');

  // RFC 3164 / RFC 5424 syslog PRI: facility * 8 + severity.
  const priMatch = /^\s*<(\d{1,3})>/.exec(head);
  if (priMatch) {
    const pri = Number(priMatch[1]);
    if (Number.isInteger(pri) && pri >= 0 && pri <= 191) {
      const level = fromSyslogSeverity(pri % 8);
      if (level) return result(level, 'syslog-pri');
    }
  }

  // Explicit key/value severity, including text exports of Windows Event Log.
  const keyValueMatch = /(?:^|[\s,{])((?:log\.)?level(?:\.name)?|lvl|severity(?:Text|_text|Name|_name|Number|_number)?|priority|@l)\s*[:=]\s*["']?([A-Za-z]+|\d+)/i.exec(head);
  if (keyValueMatch) {
    const classified = classifyStructuredValue(keyValueMatch[1], keyValueMatch[2]);
    if (classified.level) {
      return result(classified.level, classified.source === 'structured' ? 'key-value' : classified.source);
    }
  }

  // Facility.severity output used by some syslog templates.
  const facilityMatch = /\b(?:auth|authpriv|cron|daemon|kern|lpr|mail|news|syslog|user|uucp|local[0-7])\.(emerg|emergency|alert|crit|critical|err|error|warning|warn|notice|info|debug)\b/i.exec(head);
  if (facilityMatch) {
    const level = fromAlias(facilityMatch[1]);
    if (level) return result(level, 'syslog-facility');
  }

  // Linux audit/auditd. Successful audit records remain neutral; highlight only
  // explicit failures/denials and anomaly records so normal audit volume does
  // not become an all-info wall of color.
  const looksLikeAudit = /\bmsg=audit\(/i.test(head)
    || /\btype=(?:AVC|USER_AVC|SYSCALL|USER_AUTH|USER_LOGIN|ANOM_[A-Z0-9_]+)\b/i.test(head);
  if (looksLikeAudit) {
    if (/\b(?:success\s*=\s*(?:no|false)|res\s*=\s*["']?(?:failed|denied|failure)|result\s*=\s*["']?(?:failed|denied|failure))\b/i.test(head)) {
      return result('error', 'auditd');
    }
    if (/\btype=(?:AVC|USER_AVC)\b/i.test(head) && /\bdenied\b/i.test(head)) {
      return result('error', 'selinux');
    }
    if (/\btype=ANOM_[A-Z0-9_]+\b/i.test(head)) {
      return result('warn', 'auditd');
    }
  }

  // SELinux/setroubleshoot denial signatures. These are system-generated,
  // semantically strong signals rather than generic message-word heuristics.
  if (/\bSELinux\s+is\s+preventing\b/i.test(head) || /\bavc:\s*denied\b/i.test(head)) {
    return result('error', 'selinux');
  }

  // Small, conservative set of rsyslog signatures that carry clear severity.
  if (/\brsyslogd(?:\[\d+\])?:/i.test(head)) {
    if (/\bmessage\s+too\s+long\b/i.test(head) || /\baction\b[^\n]{0,220}\bsuspended\b/i.test(head)) {
      return result('warn', 'rsyslog');
    }
    if (/\bcannot\s+connect\b/i.test(head) || /\berror\s+during\s+parsing\b/i.test(head)) {
      return result('error', 'rsyslog');
    }
  }

  // Syslog often wraps an application log as "process[pid]: LEVEL message".
  // Only classify the first token after the process prefix, not arbitrary words
  // later in the message.
  const processPrefixMatch = /\b[A-Za-z0-9_.\/-]+(?:\[\d+\])?:\s*([A-Za-z]+)\b(?=\s|:|-)/.exec(head.slice(0, 512));
  if (processPrefixMatch) {
    const level = fromAlias(processPrefixMatch[1]);
    if (level) return result(level, 'process-prefix');
  }

  // Serilog compact output: [HH:mm:ss INF], plus conventional [ERROR] blocks.
  const bracketPattern = /\[(?:(?:\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s+)?([A-Za-z]+)\]/g;
  let bracketMatch: RegExpExecArray | null;
  const bracketHead = head.slice(0, 256);
  while ((bracketMatch = bracketPattern.exec(bracketHead)) !== null) {
    const level = fromAlias(bracketMatch[1]);
    if (level) return result(level, 'bracket-prefix');
  }

  // Strip common timestamps so the first semantic token can be treated as a
  // level without scanning arbitrary message text for words such as "error".
  let prefix = head.trimStart();
  const timestampPatterns = [
    /^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s+/,
    /^\[?\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s+/,
    /^\[?\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s+/,
    /^\[?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s+/,
    /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+(?:\S+\s+)?/i
  ];
  for (const pattern of timestampPatterns) {
    const match = pattern.exec(prefix);
    if (match) {
      prefix = prefix.slice(match[0].length);
      break;
    }
  }

  // Optional thread/process block commonly found between a timestamp and level.
  prefix = prefix.replace(/^\[[^\]]{1,80}\]\s+/, '');

  const firstTokenMatch = /^([A-Za-z]+)\b(?=\s|:|-|\]|\))/i.exec(prefix);
  if (firstTokenMatch) {
    const level = fromAlias(firstTokenMatch[1]);
    if (level) return result(level, 'text-prefix');
  }

  return none();
}

/** Backwards-compatible convenience API used by existing callers/tests. */
export function classifyLogLevel(raw: unknown, structured?: unknown): LogHighlightLevel {
  return classifyLogRecord(raw, structured).level;
}

/**
 * Returns true only for shapes that strongly resemble continuation lines from
 * Java/.NET/Node/Python/Go stack traces or indented multi-line log records.
 * This is intentionally used only when a preceding record already had a level.
 */
export function isLogContinuationLine(raw: unknown): boolean {
  const text = String(raw ?? '')
    .slice(0, 2048)
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/^\s*stderr:\s*/i, '');
  if (!text.trim()) return false;

  return /^\s{2,}\S/.test(text)
    || /^\s*at\s+/i.test(text)
    || /^\s*(?:Caused by|Suppressed):\s+/i.test(text)
    || /^\s*\.\.\.\s+\d+\s+more\s*$/i.test(text)
    || /^\s*---\s+End of (?:inner exception )?stack trace\s+---\s*$/i.test(text)
    || /^\s*Traceback \(most recent call last\):\s*$/i.test(text)
    || /^\s*File\s+["'].+["'],\s+line\s+\d+/i.test(text)
    || /^\s*goroutine\s+\d+\s+\[/i.test(text)
    || /^\s*[A-Za-z_$][\w.$]*(?:Error|Exception):\s*/.test(text);
}

/**
 * Applies conservative multiline inheritance to a single record. Callers keep
 * one previous level per stream so interleaved stdout/stderr cannot leak level
 * state into each other.
 */
export function classifyLogRecordWithContext(
  raw: unknown,
  previousLevel: LogHighlightLevel = ''
): LogLevelClassification {
  const classified = classifyLogRecord(raw);
  if (classified.level) {
    return classified;
  }
  if (previousLevel && isLogContinuationLine(raw)) {
    return { level: previousLevel, source: 'continuation' };
  }
  return { level: '', source: '' };
}
