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















test('recognizes common multiline stack-trace continuation shapes', () => {
  assert.equal(isLogContinuationLine('    at com.example.Service.run(Service.java:42)'), true);
  assert.equal(isLogContinuationLine('Caused by: java.io.IOException: failed'), true);
  assert.equal(isLogContinuationLine('Traceback (most recent call last):'), true);
  assert.equal(isLogContinuationLine('  File "/app/main.py", line 12, in run'), true);
  assert.equal(isLogContinuationLine('System.InvalidOperationException: invalid state'), true);
  assert.equal(isLogContinuationLine('goroutine 1 [running]:'), true);
  assert.equal(isLogContinuationLine('Sep 23 17:00:00 host service started'), false);
});




test('does not scan arbitrary message text for severity words', () => {
  assert.equal(classifyLogLevel('Request completed without error'), '');
  assert.equal(classifyLogLevel('The warning threshold is configured'), '');
  assert.equal(classifyLogLevel('/var/log/error.log rotated successfully'), '');
  assert.equal(classifyLogLevel('success=yes error=0 warning_count=0'), '');
  assert.equal(classifyLogLevel('[error handler] initialized'), '');
});


