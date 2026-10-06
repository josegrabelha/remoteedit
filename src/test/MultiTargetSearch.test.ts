import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TestCancellationSource, TestEventEmitter, deferred, flush, harness } from './helpers/SftpSessionHarness';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import type { RemoteCommandStreamingCallbacks } from '../remote/RemoteSessionTypes';
import { formatMultiTargetCommandsCompletedStatus, formatMultiTargetConnectionFailureStatus, formatMultiTargetOperationStatus, formatMultiTargetSearchCompletedStatus, formatMultiTargetSkippedStatus, formatMultiTargetUnavailableStatus, renderMultiTargetFeedbackScript } from '../multiTarget/MultiTargetFeedback';
import { renderMultiTargetHtml } from '../multiTarget/MultiTargetHtml';
import { renderMultiTargetScript } from '../multiTarget/MultiTargetScript';
import { multiTargetStyles } from '../multiTarget/MultiTargetStyles';
import { normalizeSavedMultiTargetSets } from '../multiTarget/MultiTargetStorage';

const loader = require('node:module');
const original = loader._load;
loader._load = (request: string, parent: unknown, isMain: boolean) => request === 'vscode'
  ? { CancellationTokenSource: TestCancellationSource }
  : Reflect.apply(original, loader, [request, parent, isMain]);
const { SearchBatch, DEFAULT_SEARCH_QUERY, formatSearchResults } = require('../multiTargetSearch/SearchBatch') as typeof import('../multiTargetSearch/SearchBatch');
loader._load = original;

test('multi-target feedback is normalized across Commands and Search', () => {
  assert.equal(formatMultiTargetOperationStatus('Running on', 1), 'Running on 1 connected target...');
  assert.equal(formatMultiTargetOperationStatus('Running on', 3), 'Running on 3 connected targets...');
  assert.equal(formatMultiTargetOperationStatus('Searching', 1), 'Searching 1 connected target...');
  assert.equal(formatMultiTargetOperationStatus('Searching', 4), 'Searching 4 connected targets...');
  assert.equal(formatMultiTargetSkippedStatus(1), '1 disconnected target skipped.');
  assert.equal(formatMultiTargetSkippedStatus(3), '3 disconnected targets skipped.');
  assert.equal(formatMultiTargetUnavailableStatus(1, 'Production'), '1 unavailable target skipped while loading "Production".');
  assert.equal(formatMultiTargetUnavailableStatus(2, 'Production'), '2 unavailable targets skipped while loading "Production".');
  assert.equal(formatMultiTargetConnectionFailureStatus(1), '1 target failed to connect.');
  assert.equal(formatMultiTargetConnectionFailureStatus(2), '2 targets failed to connect.');
  assert.equal(formatMultiTargetSearchCompletedStatus(1, 4), 'Search completed · 1 target searched · 4 results found.');
  assert.equal(formatMultiTargetSearchCompletedStatus(2, 1, 1), 'Search completed · 2 targets searched · 1 result found · 1 failed.');
  assert.equal(formatMultiTargetCommandsCompletedStatus(1), 'Commands completed · 1 target finished.');
  assert.equal(formatMultiTargetCommandsCompletedStatus(2, 1, 1), 'Commands completed · 2 targets finished · 1 failed · 1 stopped.');
  assert.match(multiTargetStyles, /#feedback\{[^}]*height:22px/);
  assert.match(multiTargetStyles, /#feedback-primary,#feedback-secondary\{[^}]*font-size:10px/);
  assert.doesNotMatch(multiTargetStyles, /#feedback\.feedback-warning/);
  assert.doesNotMatch(multiTargetStyles, /#feedback\.feedback-error/);
  const script = renderMultiTargetFeedbackScript();
  assert.match(script, /feedbackSecondaryPriority/);
  assert.match(script, /beginOperationFeedback/);
  assert.match(script, /feedbackSecondaryScope !== 'connection'/);
  assert.match(script, /clearTransientFeedback/);
});

test('Target Sets keep per-target working directories and expose Save New for a loaded set', () => {
  assert.deepEqual(normalizeSavedMultiTargetSets([{ id: 'set', title: 'Servers', targets: [
    { connectionId: 'dev', workingDirectory: '/srv/dev' },
    { connectionId: 'test', workingDirectory: '/srv/test' }
  ] }]), [{ id: 'set', title: 'Servers', targets: [
    { connectionId: 'dev', workingDirectory: '/srv/dev' },
    { connectionId: 'test', workingDirectory: '/srv/test' }
  ] }]);
  const html = renderMultiTargetHtml({} as any);
  assert.match(html, /<th>Working Directory<\/th>/);
  assert.match(html, /id="target-set-save-new"[^>]*hidden>Save New<\/button>/);
  const script = renderMultiTargetScript();
  assert.match(script, /item\.id === state\.targetSetId/);
  assert.match(script, /workingDirectory: String\(target\.workingDirectory \|\| ''\)/);
  assert.match(script, /saveAsNew/);
  assert.match(script, /loadAfterSave/);
});

const target = (id: string) => ({ connectionId: id, name: id, workingDirectory: '' });
function remote(run: (id: string, path: string, command: string, callbacks: RemoteCommandStreamingCallbacks) => Promise<{ code: number }>): RemoteSessionManager {
  return {
    getConnection: (id: string) => ({ id, startPath: '/home/' + id, remotePlatform: 'posix' }),
    hasConnection: () => true,
    runRemoteCommandStreaming: run,
    connect: () => { throw new Error('Search must never connect'); }
  } as unknown as RemoteSessionManager;
}

test('search uses the existing engine, limits concurrency, streams results, and isolates failures', async () => {
  let running = 0, maximum = 0, incrementals = 0;
  const paths: string[] = [];
  const sessions = remote(async (id, path, command, callbacks) => {
    paths.push(path); maximum = Math.max(maximum, ++running);
    assert.match(command, /find/); assert.match(command, /grep -n -F -i/);
    callbacks.onStdout?.(`/home/${id}/a.log:12:found `);
    callbacks.onStdout?.('text\n');
    await flush(); running--;
    if (id === 'bad') throw new Error('permission denied');
    return { code: 0 };
  });
  const batch = new SearchBatch(['one', 'bad', 'three', 'four'].map(target),
    { ...DEFAULT_SEARCH_QUERY, fileName: '*.log', textToFind: 'text', searchInsideFiles: true }, sessions, undefined,
    item => { if (item.status === 'Running' && item.results.length) incrementals++; }, 2);
  await batch.run();
  assert.equal(maximum, 2); assert.ok(incrementals >= 4);
  assert.deepEqual(paths, ['/home/one', '/home/bad', '/home/three', '/home/four']);
  assert.deepEqual(batch.executions.map(item => item.status), ['Finished', 'Failed', 'Finished', 'Finished']);
  assert.deepEqual(batch.executions[0].results, [{ path: '/home/one/a.log', type: 'file', line: 12, text: 'found text' }]);
  assert.equal(batch.executions[1].error, 'permission denied');
});


test('search batch prepares each target for sudo and isolates preparation failures', async () => {
  const prepared: string[] = [];
  const sessions = remote(async (_id, _path, _command, callbacks) => {
    callbacks.onStdout?.('F\t/home/result.log\n');
    return { code: 0 };
  });
  const batch = new SearchBatch(['one', 'bad', 'three'].map(target),
    { ...DEFAULT_SEARCH_QUERY, useSudo: true }, sessions, undefined, () => {}, 2,
    async item => {
      prepared.push(item.connectionId);
      if (item.connectionId === 'bad') throw new Error('Bad sudo password');
    });
  await batch.run();
  assert.deepEqual(prepared.sort(), ['bad', 'one', 'three']);
  assert.deepEqual(batch.executions.map(item => item.status), ['Finished', 'Failed', 'Finished']);
  assert.equal(batch.executions[1].error, 'Bad sudo password');
});

test('Stop All stops active work, skips queued targets, and rejects late results', async () => {
  const gate = deferred<{ code: number }>(); const started: string[] = []; let late!: RemoteCommandStreamingCallbacks;
  const sessions = remote(async (id, _path, _command, callbacks) => {
    started.push(id); late = callbacks;
    callbacks.onControl?.({ stop: () => gate.resolve({ code: 0 }) } as any);
    callbacks.onStdout?.('F\t/home/a\n');
    return gate.promise;
  });
  const batch = new SearchBatch(['one', 'two', 'three'].map(target), DEFAULT_SEARCH_QUERY, sessions, undefined, () => {}, 1);
  const run = batch.run(); await flush(); batch.stop(); late.onStdout?.('F\t/late\n'); await run;
  assert.deepEqual(started, ['one']);
  assert.deepEqual(batch.executions.map(item => item.status), ['Stopped', 'Stopped', 'Stopped']);
  assert.equal(batch.executions[0].results.length, 1);
});

test('connection loss fails one target without reconnecting or stopping peers', async () => {
  const gates = new Map(['one', 'two'].map(id => [id, deferred<{ code: number }>()]));
  const sessions = remote(async (id, _path, _command, callbacks) => {
    callbacks.onControl?.({ stop: () => gates.get(id)!.resolve({ code: 0 }) } as any);
    return gates.get(id)!.promise;
  });
  const batch = new SearchBatch(['one', 'two'].map(target), DEFAULT_SEARCH_QUERY, sessions, undefined, () => {});
  const run = batch.run(); await flush(); batch.connectionClosed('one'); gates.get('two')!.resolve({ code: 0 }); await run;
  assert.deepEqual(batch.executions.map(item => item.status), ['Failed', 'Finished']);
  assert.match(batch.executions[0].error!, /Connection closed/);
});

test('filename results and copying retain paths, match lines and text', async () => {
  const sessions = remote(async (_id, _path, command, callbacks) => {
    assert.doesNotMatch(command, /grep/);
    callbacks.onStdout?.('F\t/home/test/a.log\nD\t/home/test/folder\n'); return { code: 0 };
  });
  const batch = new SearchBatch([target('test')], DEFAULT_SEARCH_QUERY, sessions, undefined, () => {});
  await batch.run();
  assert.equal(formatSearchResults(batch.executions[0].results), '/home/test/a.log\n/home/test/folder');
  assert.equal(formatSearchResults([{path:'/a',line:2,text:'hello'},{path:'/a',line:8,text:'world'}]), '/a (2 matches)\n  2: hello\n  8: world');
});

test('closing/reopening the tab keeps session state; extension restart starts Multi-Target clean', async () => {
  harness.configuration.set('diagnostics.debugLogs', true);
  harness.configuration.set('diagnostics.performanceLogs', true);
  const diagnostics: string[] = [];
  const output = { appendLine: (line: string) => diagnostics.push(line) } as any;
  const registrations = new Map<string, () => void>();
  const panels: any[] = [], remotes: any[] = [];
  const state = new Map<string, unknown>();
  state.set('remoteedit.multiTarget', { activeTab: 'search', command: 'legacy runtime draft', targets: [{ connectionId: 'legacy' }] });
  let stops = 0, connects = 0;
  const gate = deferred<{ code: number }>();
  const commandGate = deferred<{ code: number }>();
  const launches: Array<{ command: string; sudo: boolean }> = [];
  class FakeRemote {
    connected = false;
    sudoEnabled = false;
    sudoPasswords: string[] = [];
    closed = new TestEventEmitter<string>();
    onDidCloseConnection = this.closed.event;
    constructor() { remotes.push(this); }
    getConnection(id: string) { return this.connected ? { id, username: 'tester', connectionType: 'sftp', startPath: '/home/test', remotePlatform: 'posix' } : undefined; }
    hasConnection() { return this.connected; }
    isSudoModeEnabled() { return this.sudoEnabled; }
    async enableSudoMode(_id: string, password: string) { this.sudoPasswords.push(password); this.sudoEnabled = true; }
    disableSudoMode() { this.sudoEnabled = false; }
    async runRemoteCommandStreaming(_id: string, _path: string, _command: string, callbacks: RemoteCommandStreamingCallbacks) {
      launches.push({ command: _command, sudo: this.sudoEnabled });
      const completion = _command === 'echo concurrent' ? commandGate : gate;
      callbacks.onControl?.({ stop: () => { stops++; completion.resolve({ code: 0 }); } } as any);
      callbacks.onStdout?.(_command === 'echo concurrent' ? 'command output\n' : 'F\t/home/test/result.log\n'); return completion.promise;
    }
  }
  class FakeSessions {
    states = new Map<string, string>();
    constructor(readonly remote: FakeRemote, _profiles: unknown, readonly changed: () => void) {}
    async connect(id: string) { connects++; this.remote.connected = true; this.states.set(id, 'Connected'); this.changed(); }
    async disconnect(id: string) { this.remote.connected = false; this.states.set(id, 'Disconnected'); this.remote.closed.fire(id); this.changed(); }
    dispose() { this.remote.connected = false; }
  }
  const fakeVscode = {
    CancellationTokenSource: TestCancellationSource, EventEmitter: TestEventEmitter, ViewColumn: { Active: 1 }, ThemeIcon: class {},
    commands: { registerCommand: (name: string, fn: () => void) => { registrations.set(name, fn); return { dispose() { registrations.delete(name); } }; } },
    window: { createWebviewPanel: () => {
      const incoming = new TestEventEmitter<any>(), close = new TestEventEmitter<void>();
      const panel = { incoming, messages: [] as any[], reveal() {}, dispose: () => close.fire(),
        onDidDispose: close.event, onDidChangeViewState: () => ({ dispose() {} }),
        webview: { html: '', onDidReceiveMessage: incoming.event, postMessage(message: unknown) { panel.messages.push(message); return Promise.resolve(true); } } };
      panels.push(panel); return panel;
    } }, env: { clipboard: { writeText: async () => undefined } }
  };
  const baseLoad = loader._load;
  loader._load = (request: string, parent: unknown, isMain: boolean) => {
    if (request === 'vscode') return fakeVscode;
    if (request.endsWith('/SftpSessionManager')) return { SftpSessionManager: FakeRemote };
    if (request.endsWith('/CommandSessions')) return { CommandSessions: FakeSessions };
    return Reflect.apply(baseLoad, loader, [request, parent, isMain]);
  };
  let Feature: typeof import('../multiTarget/MultiTargetPanel').MultiTargetFeature;
  try { Feature = require('../multiTarget/MultiTargetPanel').MultiTargetFeature; }
  finally { loader._load = baseLoad; }
  const context = { globalState: { get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
    update: async (key: string, value: unknown) => { if (value === undefined) state.delete(key); else state.set(key, value); } } } as any;
  const profiles = { listProfiles: async () => [{ id: 'dev', name: 'DEV', username: 'tester', host: 'dev.example', connectionType: 'sftp' }], listGroups: async () => [] } as any;
  const feature = new Feature(context, profiles, output);
  registrations.get('remoteedit.multiTarget.open')!(); await flush();
  const first = panels[0];
  first.incoming.fire({ type: 'targets', ids: ['dev'] }); await flush();
  first.incoming.fire({ type: 'connect' }); await flush();
  assert.equal(first.messages.findLast((message: any) => message.type === 'state').targets[0].sudoPasswordRequired, true);
  first.incoming.fire({ type: 'directory', ids: ['dev'], value: '/var/log' }); await flush();
  first.incoming.fire({ type: 'run', mode: 'search', query: { ...DEFAULT_SEARCH_QUERY, fileName: '*.log', useSudo: true }, sudoPasswords: [{ connectionId: 'dev', password: 'secret' }] }); await flush();
  assert.deepEqual(remotes[0].sudoPasswords, ['secret']);
  assert.equal(remotes[0].sudoEnabled, true);
  // One session supports both modes; each launch snapshots its own Sudo state.
  first.incoming.fire({ type: 'run', mode: 'commands', command: 'echo concurrent', useSudo: false }); await flush();
  assert.equal(remotes.length, 1); assert.equal(launches.length, 2);
  assert.equal(launches[0].sudo, true); assert.equal(launches[1].sudo, false);
  assert.equal(first.messages.findLast((m: any) => m.type === 'state' && m.mode === 'commands').busy, true);
  assert.equal(first.messages.findLast((m: any) => m.type === 'state' && m.mode === 'search').busy, true);
  const commandBatch = first.messages.findLast((m: any) => m.type === 'batch' && m.mode === 'commands');
  first.incoming.fire({ type: 'stop', mode: 'commands', batchId: commandBatch.batchId }); await flush();
  assert.equal(stops, 1);
  assert.equal(first.messages.findLast((m: any) => m.type === 'state' && m.mode === 'commands').busy, false);
  assert.equal(first.messages.findLast((m: any) => m.type === 'state' && m.mode === 'search').busy, true);
  first.incoming.fire({ type: 'activeTab', mode: 'search' }); await flush();
  first.dispose(); assert.equal(stops, 1); assert.equal(remotes[0].connected, true);
  registrations.get('remoteedit.multiTarget.open')!(); await flush();
  const second = panels[1];
  second.incoming.fire({ type: 'ready' }); await flush();
  const batch = second.messages.findLast((message: any) => message.type === 'batch');
  assert.equal(batch.executions[0].status, 'Running'); assert.equal(batch.executions[0].results.length, 1);
  assert.equal(connects, 1);
  gate.resolve({ code: 0 }); await flush();
  const diagnosticText = diagnostics.join('\n');
  assert.match(diagnosticText, /\[DEBUG\] \[MultiTargetCommands\] Batch started\./);
  assert.match(diagnosticText, /\[DEBUG\] \[MultiTargetCommands\] Stop requested\./);
  assert.match(diagnosticText, /\[PERF\] \[MultiTargetCommands\] target execution completed/);
  assert.match(diagnosticText, /\[PERF\] \[MultiTargetCommands\] batch completed/);
  assert.match(diagnosticText, /\[DEBUG\] \[MultiTargetSearch\] Batch started\./);
  assert.match(diagnosticText, /\[PERF\] \[MultiTargetSearch\] batch completed/);
  assert.doesNotMatch(diagnosticText, /secret/);
  // Shared set membership does not overwrite the tool's local directory.
  state.set('remoteedit.multiTarget.targetSets', [{ id: 'shared', title: 'Servers', targets: [{ connectionId: 'dev', workingDirectory: '/saved/log' }] }]);
  second.incoming.fire({ type: 'loadTargetSet', id: 'shared' }); await flush();
  const loaded = second.messages.findLast((message: any) => message.type === 'state');
  assert.equal(loaded.targets[0].workingDirectory, '/saved/log');
  assert.equal(loaded.targetSetId, 'shared');
  second.incoming.fire({ type: 'saveTargetSet', id: 'shared', title: 'Servers',
    targets: [{ connectionId: 'dev', workingDirectory: '/saved/log' }], loadAfterSave: true }); await flush();
  assert.equal((state.get('remoteedit.multiTarget.targetSets') as any[])[0].targets[0].workingDirectory, '/saved/log');
  second.incoming.fire({ type: 'saveTargetSet', id: 'shared', title: 'Servers Copy', saveAsNew: true,
    targets: [{ connectionId: 'dev', workingDirectory: '/saved/log' }], loadAfterSave: true }); await flush();
  const copiedSet = (state.get('remoteedit.multiTarget.targetSets') as any[]).find(item => item.title === 'Servers Copy');
  assert.ok(copiedSet);
  assert.equal(second.messages.findLast((message: any) => message.type === 'state').targetSetId, copiedSet.id);

  // Import refresh updates saved data immediately without replacing the live runtime targets.
  state.set('remoteedit.multiTargetCommands.savedCommands', [{ id: 'imported-command', title: 'Imported', command: 'hostname' }]);
  state.set('remoteedit.multiTarget.targetSets', [{ id: 'imported-set', title: 'Imported Set', targets: [{ connectionId: 'dev', workingDirectory: '/imported' }] }]);
  const { RemoteEditSharedState } = require('../state/RemoteEditSharedState') as typeof import('../state/RemoteEditSharedState');
  RemoteEditSharedState.fireMultiTargetChanged('sidebar', 'importBackup'); await flush();
  const refreshed = second.messages.findLast((message: any) => message.type === 'state' && message.mode === 'commands');
  assert.equal(refreshed.targetSetId, '');
  assert.equal(refreshed.targets[0].connectionId, 'dev');
  assert.equal(refreshed.targets[0].workingDirectory, '/saved/log');
  const importedCommands = second.messages.findLast((message: any) => message.type === 'savedCommands');
  assert.deepEqual(importedCommands.items, [{ id: 'imported-command', title: 'Imported', command: 'hostname' }]);
  const importedSets = second.messages.findLast((message: any) => message.type === 'targetSets');
  assert.deepEqual(importedSets.items, [{ id: 'imported-set', title: 'Imported Set', targets: [{ connectionId: 'dev', workingDirectory: '/imported' }] }]);

  feature.dispose();
  const restarted = new Feature(context, profiles, output);
  registrations.get('remoteedit.multiTarget.open')!(); await flush();
  const restored = panels[2].messages.findLast((message: any) => message.type === 'state');
  assert.equal(restored.activeTab, 'commands');
  assert.equal(restored.targetSetId, '');
  assert.deepEqual(restored.targets, []);
  assert.equal(restored.command, '');
  assert.equal(restored.useSudo, false);
  const restoredSearch = panels[2].messages.findLast((message: any) => message.type === 'state' && message.mode === 'search');
  assert.equal(restoredSearch.query.fileName, '*'); assert.equal(restoredSearch.query.useSudo, false);
  assert.equal(connects, 1);
  assert.equal(state.has('remoteedit.multiTarget'), false);
  assert.doesNotMatch(JSON.stringify([...state]), /secret/); restarted.dispose();
  harness.configuration.clear();
});

test('shared Target Set writes from Commands and Search cannot overwrite one another', async () => {
  const { updateSharedTargetSets, MULTI_TARGET_TARGET_SETS_STORAGE_KEY } = await import('../multiTarget/MultiTargetStorage');
  const data = new Map<string, unknown>();
  const state = { get: <T>(key: string, fallback: T): T => (data.get(key) as T) ?? fallback,
    update: async (key: string, value: unknown) => { await flush(); data.set(key, value); } };
  await Promise.all([
    updateSharedTargetSets(state, current => [...current, { id: 'commands', title: 'Commands group', targets: [{ connectionId: 'one', workingDirectory: '/one' }] }]),
    updateSharedTargetSets(state, current => [...current, { id: 'search', title: 'Search group', targets: [{ connectionId: 'two', workingDirectory: '/two' }] }])
  ]);
  assert.deepEqual((data.get(MULTI_TARGET_TARGET_SETS_STORAGE_KEY) as any[]).map(item => item.id), ['commands', 'search']);
});
