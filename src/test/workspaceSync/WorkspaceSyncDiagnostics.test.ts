import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
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


test('Workspace Sync diagnostic contract can load in pure Node without the VS Code runtime', () => {
  const root = path.resolve(__dirname, '../../..');
  const modulePath = path.join(root, 'out', 'workspaceSync', 'WorkspaceSyncDiagnostics.js');
  const probe = `
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'vscode') throw new Error('WorkspaceSyncDiagnostics loaded the VS Code runtime');
      return originalLoad.call(this, request, parent, isMain);
    };
    require(${JSON.stringify(modulePath)});
  `;
  const result = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Workspace Sync diagnostics follow the existing session-only Debug and Performance settings dynamically', () => {
  inputUi.configuration.clear();
  inputUi.configuration.set('diagnostics.debugLogs', false);
  inputUi.configuration.set('diagnostics.performanceLogs', false);
  const { lines, output } = outputHarness();
  const diagnostics = createWorkspaceSyncDiagnostics(output);

  diagnostics.debug('Watch', 'hidden debug');
  diagnostics.performance('Refresh', 'hidden perf');
  assert.deepEqual(lines, []);

  inputUi.configuration.set('diagnostics.debugLogs', true);
  diagnostics.debug('Watch', 'visible debug', { Mapping: 'DEV', Target: 'T1' });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[DEBUG\] \[Workspace Sync Watch\] visible debug/);
  assert.match(lines[0], /Mapping=DEV/);
  assert.match(lines[0], /Target=T1/);

  inputUi.configuration.set('diagnostics.performanceLogs', true);
  diagnostics.performance('Refresh', 'visible perf', { Entries: 12 });
  assert.equal(lines.length, 2);
  assert.match(lines[1], /\[PERF\] \[Workspace Sync Refresh\] visible perf/);
  assert.match(lines[1], /Entries=12/);

  inputUi.configuration.set('diagnostics.debugLogs', false);
  diagnostics.debug('Watch', 'hidden again');
  assert.equal(lines.length, 2);
});

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

test('Workspace Sync performance timing is kept out of Activity and routed through Diagnostics', async () => {
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  const timingMethod = controller.match(/private logRefreshTiming[\s\S]*?\n  }\n\n  private async refreshConnectedTargetsAfterIgnoreChange/)?.[0] || '';
  assert.match(timingMethod, /this\.diagnostics\.performance\('Refresh'/);
  assert.doesNotMatch(timingMethod, /appendOutputLog\(/);
  assert.doesNotMatch(timingMethod, /this\.ui\.log\(/);

  assert.match(controller, /this\.ui\.log\('Refresh completed\.', 'success'/);
  assert.match(controller, /Post-Sync Changes updated incrementally; full Refresh was not required\./);
  assert.match(controller, /this\.diagnostics\.performance\('View', `Post-Sync Changes updated incrementally in/);
});
