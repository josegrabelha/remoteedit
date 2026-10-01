import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URI } from 'vscode-uri';
import type { ActiveConnection, RemoteSessionManager } from '../remote/RemoteSessionManager';
import { createConnectionManagerHarness, loadWithVscode, profile, vscodeStub } from './helpers/ConnectionManagerHarness';

// Use VS Code's URI implementation; only the extension-host services are replaced.
Object.assign(vscodeStub, { Uri: URI, FileType: { File: 1, Directory: 2, SymbolicLink: 64, Unknown: 0 } });
Object.assign(vscodeStub.window, { tabGroups: { onDidChangeTabs: () => ({ dispose() {} }) } });
const { resolveEditorRootSegments } = loadWithVscode(() => require('../filesystem/EditorRootLabel') as typeof import('../filesystem/EditorRootLabel'));
const { buildRemoteEditUri, parseRemoteEditUri, RemoteEditFileSystemProvider } = loadWithVscode(() =>
  require('../filesystem/RemoteEditFileSystemProvider') as typeof import('../filesystem/RemoteEditFileSystemProvider'));

test('host is the default and does not load saved names', async () => {
  const harness = createConnectionManagerHarness([profile('target')]);
  const active = { ...profile('target'), name: 'Session' } as ActiveConnection;
  for (const setting of [undefined, 'host']) {
    harness.ui.configuration.set('editorRootLabel', setting);
    assert.equal(await resolveEditorRootSegments('target', active, harness.manager), undefined);
  }
  assert.deepEqual(harness.reads, []);
  assert.deepEqual(harness.writes, []);
});

test('connection labels use the latest saved group and name, with session fallbacks', async () => {
  const harness = createConnectionManagerHarness([profile('target', { name: 'API', groupId: 'production' })]);
  harness.state.set('remoteedit.connectionGroups', [{ id: 'production', name: 'Production', order: 0, createdAt: 1, updatedAt: 1 }]);
  harness.ui.configuration.set('editorRootLabel', 'connectionName');
  const active = { ...profile('target'), name: 'Session' } as ActiveConnection;
  const resolve = (connection = active) => resolveEditorRootSegments('target', connection, harness.manager);
  assert.deepEqual(await resolve(), ['Production', 'API']);
  assert.deepEqual(await resolve({ ...active, isQuickConnect: true }), ['Session']);
  harness.state.set('remoteedit.connectionProfiles', [profile('target', { name: 'Renamed' })]);
  assert.deepEqual(await resolve(), ['Renamed']);
  harness.state.set('remoteedit.connectionProfiles', []);
  assert.deepEqual(await resolve(), ['Session']);
  assert.deepEqual(harness.reads, []);
  assert.deepEqual(harness.writes, []);
});







test('directory browsing strips the complete virtual root for writable and readonly files', async () => {
  const requests: Array<{ id: string; path: string }> = [];
  const sessions = {
    listDirectory: async (id: string, path: string) => { requests.push({ id, path }); return [{ name: 'etc', type: 'directory' }]; }
  } as unknown as RemoteSessionManager;
  for (const readOnly of [false, true]) {
    const provider = new RemoteEditFileSystemProvider(sessions, undefined, readOnly);
    try {
      for (const rootSegments of [['Production', 'API'], ['生产环境', '应用 A'], ['API']]) {
        const file = buildRemoteEditUri('target', '/etc/config.yml', '127.0.0.1', { readOnly, rootSegments });
        const root = file.with({ path: file.path.slice(0, file.path.indexOf('/', 1)) });
        assert.deepEqual(await provider.readDirectory(URI.parse(root.toString())), [['etc', 2]]);
        assert.deepEqual(requests.at(-1), { id: 'target', path: '/' });
        await provider.readDirectory(root.with({ path: `${root.path}/etc` }));
        assert.deepEqual(requests.at(-1), { id: 'target', path: '/etc' });
      }
    } finally { provider.dispose(); }
  }
});
