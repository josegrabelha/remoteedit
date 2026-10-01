import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { inputUi, loadWithVscode } from '../helpers/ConnectionManagerHarness';

const { createWorkspaceSyncDiagnostics } = loadWithVscode(() =>
  require('../../workspaceSync/WorkspaceSyncDiagnosticsFactory') as typeof import('../../workspaceSync/WorkspaceSyncDiagnosticsFactory')
);
const { redactWorkspaceSyncDiagnosticText } = require('../../workspaceSync/WorkspaceSyncDiagnostics') as typeof import('../../workspaceSync/WorkspaceSyncDiagnostics');

function outputHarness() {
  const lines: string[] = [];
  return {
    lines,
    output: { appendLine: (line: string) => lines.push(line) } as any
  };
}






test('Workspace Sync diagnostics never emit secret-bearing detail fields', () => {
  inputUi.configuration.clear();
  inputUi.configuration.set('diagnostics.debugLogs', true);
  const { lines, output } = outputHarness();
  const diagnostics = createWorkspaceSyncDiagnostics(output);

  diagnostics.debug('Session', 'connection snapshot', {
    Connection: 'prod',
    password: 'never-log-password',
    passphrase: 'never-log-passphrase',
    privateKey: 'never-log-private-key',
    credentialToken: 'never-log-token'
  } as any);

  assert.equal(lines.length, 1);
  assert.match(lines[0], /Connection=prod/);
  assert.doesNotMatch(lines[0], /never-log-password|never-log-passphrase|never-log-private-key|never-log-token/);
  assert.doesNotMatch(lines[0], /password=|passphrase=|privateKey=|credentialToken=/);
});


test('Workspace Sync diagnostics redact secrets embedded in diagnostic error text', () => {
  const secret = 'super-secret-value';
  const result = redactWorkspaceSyncDiagnosticText(
    new Error(`Authentication failed: password=${secret}; retry used ${secret}`),
    [secret]
  );

  assert.doesNotMatch(result, /super-secret-value/);
  assert.match(result, /password=\[redacted\]/);
});
