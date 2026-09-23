import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyLogLevel, classifyLogRecord, classifyLogRecordWithContext, isLogContinuationLine } from '../logViewer/LogLevelClassifier';

test('classifies common Linux and AIX text log levels without message-word false positives', () => {
  assert.equal(classifyLogLevel('2026-09-23 17:00:00 INFO Application started'), 'info');
  assert.equal(classifyLogLevel('2026-09-23 17:00:01 WARN Filesystem usage high'), 'warn');
  assert.equal(classifyLogLevel('2026/09/23 17:00:02 [error] upstream failed'), 'error');
  assert.equal(classifyLogLevel('DEBUG Testing error handler'), 'debug');
  assert.equal(classifyLogLevel('INFO Request completed without error'), 'info');
  assert.equal(classifyLogLevel('WARN Previous error recovered'), 'warn');
  assert.equal(classifyLogLevel('Database error while connecting'), '');
  assert.equal(classifyLogLevel('Sep 23 17:00:00 aix01 daemon: service restarted'), '');
  assert.equal(classifyLogLevel('Sep 23 17:00:00 aix01 ERROR service failed'), 'error');
});

test('classifies syslog PRI and facility severity formats', () => {
  assert.equal(classifyLogLevel('<34>Sep 23 17:00:00 host app: message'), 'error'); // severity 2
  assert.equal(classifyLogLevel('<36>Sep 23 17:00:00 host app: message'), 'warn'); // severity 4
  assert.equal(classifyLogLevel('<38>Sep 23 17:00:00 host app: message'), 'info'); // severity 6
  assert.equal(classifyLogLevel('<39>Sep 23 17:00:00 host app: message'), 'debug'); // severity 7
  assert.equal(classifyLogLevel('daemon.err service failed'), 'error');
  assert.equal(classifyLogLevel('local0.warning disk usage high'), 'warn');
  assert.equal(classifyLogLevel('Sep 23 17:00:00 host myapp[123]: ERROR request failed'), 'error');
  assert.equal(classifyLogLevel('Sep 23 17:00:00 host myapp[123]: INFO request completed without error'), 'info');
});

test('classifies journald, Pino/Bunyan and OpenTelemetry structured severity', () => {
  assert.equal(classifyLogLevel('', { PRIORITY: '3', MESSAGE: 'failed' }), 'error');
  assert.equal(classifyLogLevel('', { PRIORITY: '4', MESSAGE: 'warning' }), 'warn');
  assert.equal(classifyLogLevel('', { level: 10, msg: 'trace' }), 'debug');
  assert.equal(classifyLogLevel('', { level: 20, msg: 'debug' }), 'debug');
  assert.equal(classifyLogLevel('', { level: 30, msg: 'info' }), 'info');
  assert.equal(classifyLogLevel('', { level: 40, msg: 'warn' }), 'warn');
  assert.equal(classifyLogLevel('', { level: 50, msg: 'error' }), 'error');
  assert.equal(classifyLogLevel('', { level: 60, msg: 'fatal' }), 'error');
  assert.equal(classifyLogLevel('', { severityNumber: 2 }), 'debug');
  assert.equal(classifyLogLevel('', { severityNumber: 10 }), 'info');
  assert.equal(classifyLogLevel('', { severityNumber: 14 }), 'warn');
  assert.equal(classifyLogLevel('', { severityNumber: 18 }), 'error');
  assert.equal(classifyLogLevel('', { severityNumber: 22 }), 'error');
});

test('classifies Windows and .NET text logging conventions', () => {
  assert.equal(classifyLogLevel('info: Microsoft.Hosting.Lifetime[14]'), 'info');
  assert.equal(classifyLogLevel('warn: MyApplication[0] Request slow'), 'warn');
  assert.equal(classifyLogLevel('fail: MyApplication[0] Request failed'), 'error');
  assert.equal(classifyLogLevel('crit: MyApplication[0] Application failed'), 'error');
  assert.equal(classifyLogLevel('[17:20:00 INF] Request started'), 'info');
  assert.equal(classifyLogLevel('[17:20:01 WRN] Request slow'), 'warn');
  assert.equal(classifyLogLevel('[17:20:02 ERR] Request failed'), 'error');
  assert.equal(classifyLogLevel('[17:20:03 DBG] Processing'), 'debug');
  assert.equal(classifyLogLevel('[17:20:04 FTL] Application terminated'), 'error');
  assert.equal(classifyLogLevel('[17:20:05 VRB] Verbose details'), 'debug');
  assert.equal(classifyLogLevel('Level: Error'), 'error');
  assert.equal(classifyLogLevel('SeverityText=Warning'), 'warn');
  assert.equal(classifyLogLevel('2026-09-23 17:20:00 10.0.0.1 GET /index.html 500'), '');
});

test('classifies case-insensitive, dotted and nested JSON severity fields', () => {
  assert.equal(classifyLogLevel('', { Level: 'Error' }), 'error');
  assert.equal(classifyLogLevel('', { severityText: 'WARNING' }), 'warn');
  assert.equal(classifyLogLevel('', { severity_text: 'INFO' }), 'info');
  assert.equal(classifyLogLevel('', { '@l': 'Debug' }), 'debug');
  assert.equal(classifyLogLevel('', { 'log.level': 'fatal' }), 'error');
  assert.equal(classifyLogLevel('', { 'log.level.name': 'warn' }), 'warn');
  assert.equal(classifyLogLevel('', { log: { level: 'info' } }), 'info');
  assert.equal(classifyLogLevel('', { event: { severityText: 'trace' } }), 'debug');
  assert.equal(classifyLogLevel('', { payload: { priority: 1, message: 'business priority' } }), '');
});

test('supports explicit severity fields in raw structured text even when JSON rendering is disabled', () => {
  assert.equal(classifyLogLevel('{"level":"error","message":"failed"}'), 'error');
  assert.equal(classifyLogLevel('{"severityText":"INFO","body":"ready"}'), 'info');
  assert.equal(classifyLogLevel('{"PRIORITY":"4","MESSAGE":"disk"}'), 'warn');
  assert.equal(classifyLogLevel('{"severityNumber":18,"body":"failed"}'), 'error');
});

test('classifies Linux auditd failures but leaves successful audit records neutral', () => {
  const success = 'node=10.149.5.4 type=SYSCALL msg=audit(1790200348.255:5017157): arch=c000003e syscall=87 success=yes exit=0 key="delete"';
  const failure = 'node=10.149.5.4 type=SYSCALL msg=audit(1790200348.255:5017157): arch=c000003e syscall=87 success=no exit=-13 key="delete"';
  const authFailure = 'type=USER_AUTH msg=audit(1790200400.1:10): pid=100 uid=0 res=failed';
  const anomaly = 'type=ANOM_ABEND msg=audit(1790200400.2:11): auid=1000 uid=1000';
  assert.equal(classifyLogLevel(success), '');
  assert.deepEqual(classifyLogRecord(failure), { level: 'error', source: 'auditd' });
  assert.deepEqual(classifyLogRecord(authFailure), { level: 'error', source: 'auditd' });
  assert.deepEqual(classifyLogRecord(anomaly), { level: 'warn', source: 'auditd' });
});

test('classifies SELinux and setroubleshoot denial signatures', () => {
  assert.deepEqual(
    classifyLogRecord('Sep 23 21:52:12 host setroubleshoot[3268307]: SELinux is preventing /tbin/db2/bin/db2fmcd from open access on the file /var/db2/global.reg.'),
    { level: 'error', source: 'selinux' }
  );
  assert.deepEqual(
    classifyLogRecord('type=AVC msg=audit(1790200400.3:12): avc: denied { read } for pid=123 comm="db2"'),
    { level: 'error', source: 'selinux' }
  );
});

test('classifies conservative rsyslog service signatures', () => {
  assert.deepEqual(
    classifyLogRecord('Sep 23 21:52:11 host rsyslogd[1146]: message too long (8453) with configured size 8096'),
    { level: 'warn', source: 'rsyslog' }
  );
  assert.deepEqual(
    classifyLogRecord("Sep 23 21:52:11 host rsyslogd[1146]: action 'action-0-builtin:omfwd' suspended"),
    { level: 'warn', source: 'rsyslog' }
  );
  assert.deepEqual(
    classifyLogRecord('Sep 23 21:52:11 host rsyslogd[1146]: error during parsing file /etc/rsyslog.conf'),
    { level: 'error', source: 'rsyslog' }
  );
});

test('strips ANSI control sequences before level detection', () => {
  assert.equal(classifyLogLevel('\u001b[31mERROR\u001b[0m request failed'), 'error');
  assert.equal(classifyLogLevel('\u001b[33mWARN\u001b[0m request slow'), 'warn');
  assert.equal(classifyLogLevel('stderr: \u001b[32mINFO\u001b[0m service ready'), 'info');
});

test('recognizes common multiline stack-trace continuation shapes', () => {
  assert.equal(isLogContinuationLine('    at com.example.Service.run(Service.java:42)'), true);
  assert.equal(isLogContinuationLine('Caused by: java.io.IOException: failed'), true);
  assert.equal(isLogContinuationLine('Traceback (most recent call last):'), true);
  assert.equal(isLogContinuationLine('  File "/app/main.py", line 12, in run'), true);
  assert.equal(isLogContinuationLine('System.InvalidOperationException: invalid state'), true);
  assert.equal(isLogContinuationLine('goroutine 1 [running]:'), true);
  assert.equal(isLogContinuationLine('Sep 23 17:00:00 host service started'), false);
});


test('inherits explicit levels only for likely multiline continuation records', () => {
  assert.deepEqual(
    classifyLogRecordWithContext('    at com.example.Service.run(Service.java:42)', 'error'),
    { level: 'error', source: 'continuation' }
  );
  assert.deepEqual(
    classifyLogRecordWithContext('Caused by: java.io.IOException: failed', 'warn'),
    { level: 'warn', source: 'continuation' }
  );
  assert.deepEqual(
    classifyLogRecordWithContext('Sep 23 17:00:00 host unrelated service started', 'error'),
    { level: '', source: '' }
  );
  assert.deepEqual(
    classifyLogRecordWithContext('INFO explicit new event', 'error'),
    { level: 'info', source: 'text-prefix' }
  );
});

test('does not scan arbitrary message text for severity words', () => {
  assert.equal(classifyLogLevel('Request completed without error'), '');
  assert.equal(classifyLogLevel('The warning threshold is configured'), '');
  assert.equal(classifyLogLevel('/var/log/error.log rotated successfully'), '');
  assert.equal(classifyLogLevel('success=yes error=0 warning_count=0'), '');
  assert.equal(classifyLogLevel('[error handler] initialized'), '');
});

test('bounds text-format inspection for very large records', () => {
  const hugeSelinux = 'Sep 23 21:52:12 host setroubleshoot[1]: SELinux is preventing access ' + 'x'.repeat(100_000);
  assert.deepEqual(classifyLogRecord(hugeSelinux), { level: 'error', source: 'selinux' });

  const lateWord = 'ordinary message ' + 'x'.repeat(5000) + ' ERROR';
  assert.equal(classifyLogLevel(lateWord), '');
});
