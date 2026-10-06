import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceSyncUi } from '../../workspaceSync/ui/WorkspaceSyncUi';
import { WORKSPACE_SYNC_ACTIVITY_KEY, WorkspaceSyncActivityStore } from '../../workspaceSync/ui/WorkspaceSyncActivityStore';
import { compareText } from '../../workspaceSync/compare/TextComparison';
import { listLocalFolders } from '../../workspaceSync/ui/LocalFolderBrowser';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { runInNewContext } from 'node:vm';


class MemoryActivityState {
  readonly values = new Map<string, unknown>();
  updates = 0;

  get<T>(key: string, defaultValue: T): T {
    return this.values.has(key) ? this.values.get(key) as T : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.updates += 1;
    this.values.set(key, value);
  }
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));





test('activity bounds history, redacts credentials and clears the webview', async () => {
  const ui = new WorkspaceSyncUi(); const messages: any[] = [];
  ui.attach(value => messages.push(value));
  const pending = ui.input({ password: true });
  ui.respond(messages[0].request.id, 'super-secret'); await pending;
  for (let i = 0; i < 1100; i++) ui.log(`Event ${i}: super-secret password=other-value`, 'error', 'Target');
  const history = ui.snapshot();
  assert.equal(history.length, 1000);
  assert.equal(history[0].id, 101);
  assert.ok(history.every(entry => !entry.message.includes('super-secret') && !entry.message.includes('other-value')));
  ui.clear(); assert.equal(ui.snapshot().length, 0);
  assert.equal(messages.at(-1).type, 'activitySnapshot');
});


test('Activity persists locally in bounded batches and restores after recreation', async () => {
  const state = new MemoryActivityState();
  const store = new WorkspaceSyncActivityStore(state);
  const ui = new WorkspaceSyncUi(store, 5);

  ui.log('First event');
  ui.log('Second event', 'success', 'DEV / Target 1');
  assert.equal(state.updates, 0);

  await delay(20);
  assert.equal(state.updates, 1);

  const persisted = state.get<any[]>(WORKSPACE_SYNC_ACTIVITY_KEY, []);
  assert.deepEqual(persisted.map(entry => entry.message), ['First event', 'Second event']);

  const restored = new WorkspaceSyncUi(new WorkspaceSyncActivityStore(state), 5);
  assert.deepEqual(restored.snapshot().map(entry => entry.message), ['First event', 'Second event']);
  restored.log('Third event');
  assert.equal(restored.snapshot().at(-1)?.id, 3);

  await delay(20);
  restored.dispose();
  ui.dispose();
});








test('text comparison reconstructs both inputs including insertions, deletions and CRLF', () => {
  for (const [a, b] of [['one\ntwo\nthree', 'zero\none\nthree'], ['a\r\nb\r\n', 'a\nb\n'], ['', 'new\n'], ['same', 'same'], ['a\na\nb', 'a\nb\nb']]) {
    const lines = compareText(a, b);
    assert.equal(lines.filter(line => line.kind !== 'added').map(line => line.text).join('\n'), a);
    assert.equal(lines.filter(line => line.kind !== 'removed').map(line => line.text).join('\n'), b);
    assert.deepEqual(lines.filter(line => line.localLine).map(line => line.localLine), a.split('\n').map((_, i) => i + 1));
    assert.deepEqual(lines.filter(line => line.remoteLine).map(line => line.remoteLine), b.split('\n').map((_, i) => i + 1));
  }
});





test('Workspace Sync All Enabled opens connections concurrently before starting any Refresh', async () => {
  // Execute the actual controller method in isolation. This regression test
  // checks scheduling, rather than depending on the spelling of a for loop.
  // In particular, target 2 must start while target 1 is still connecting.
  const root = path.resolve(__dirname, '../../..');
  const source = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');
  const file = ts.createSourceFile('WorkspaceSyncController.ts', source, ts.ScriptTarget.ES2022, true);
  const controller = file.statements.find((node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'WorkspaceSyncController'
  );
  const connectEnabled = controller?.members.find((node): node is ts.MethodDeclaration =>
    ts.isMethodDeclaration(node) && node.name.getText(file) === 'connectEnabledTargets'
  );
  const concurrent = file.statements.find(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'runWithConcurrency'
  );
  assert.ok(connectEnabled && concurrent, 'connection and concurrency methods must be available');
  const isolated = ts.transpileModule(
    `const MAX_PARALLEL_TARGET_REFRESHES = 4;\n${concurrent.getText(file)}\nclass Harness { ${connectEnabled.getText(file)} }\nHarness;`,
    { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  const Harness = runInNewContext(isolated) as new () => Record<string, any>;
  const harness = new Harness();
  const events: string[] = [];
  const releases = new Map<string, () => void>();
  const mapping = {
    id: 'DEV',
    targets: [
      { id: 'target-1', connectionId: 'profile-1', name: 'Target 1', enabled: true },
      { id: 'target-2', connectionId: 'profile-2', name: 'Target 2', enabled: true }
    ]
  };
  harness.requireMapping = () => mapping;
  harness.connectionManager = { listProfiles: async () => [
    { id: 'profile-1', updatedAt: 1 }, { id: 'profile-2', updatedAt: 1 }
  ] };
  harness.sessions = {
    getState: () => ({ status: 'disconnected' }),
    getSession: () => undefined
  };
  harness.sessionKey = (mappingId: string, targetId: string) => `${mappingId}::${targetId}`;
  harness.disconnectRequested = new Set();
  harness.refreshWatchers = () => {};
  harness.openTargetConnection = (_mapping: unknown, target: { id: string }) =>
    new Promise(resolve => {
      events.push(`connection-start:${target.id}`);
      releases.set(target.id, () => {
        events.push(`connection-finished:${target.id}`);
        resolve({});
      });
    });
  harness.startPostConnectInitialization = (_mapping: unknown, connections: unknown[]) => {
    events.push(`refresh-start:${connections.length}`);
  };

  const pending = harness.connectEnabledTargets('DEV');
  await delay(0);
  assert.deepEqual(events, ['connection-start:target-1', 'connection-start:target-2']);
  assert.equal(events.some(item => item.startsWith('refresh-start:')), false);
  releases.get('target-2')?.();
  await delay(0);
  assert.equal(events.some(item => item.startsWith('refresh-start:')), false);
  releases.get('target-1')?.();
  await pending;
  assert.equal(events.at(-1), 'refresh-start:2');
});






