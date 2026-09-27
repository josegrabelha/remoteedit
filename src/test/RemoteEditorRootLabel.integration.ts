import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { ConnectionManager, ConnectionProfile } from '../connection/ConnectionManager';
import type { ActiveConnection, RemoteSessionManager } from '../remote/RemoteSessionManager';
import { parseRemoteEditUri, RemoteEditFileSystemProvider } from '../filesystem/RemoteEditFileSystemProvider';
import { RemoteEditPanel } from '../panel/RemoteEditPanel';
import { RemoteEditSidebarController } from '../sidebar/SidebarController';

// Run in an isolated VS Code extension host via scripts/test-editor-root-label.cjs.
export async function run(): Promise<void> {
  const config = vscode.workspace.getConfiguration('remoteedit');
  const connection = { id: 'connection-a', name: 'Session name', host: '127.0.0.1', port: 2201, username: 'root' } as ActiveConnection;
  const profile = { id: connection.id, name: '应用 A', groupId: 'production' } as ConnectionProfile | undefined;
  const manager = {
    getProfile: async (id: string) => { assert.equal(id, connection.id); return profile; },
    listGroups: async () => [{ id: 'production', name: '生产环境' }]
  } as unknown as ConnectionManager;
  const roundTrip = (uri: vscode.Uri) => parseRemoteEditUri(vscode.Uri.parse(uri.toString()));
  await config.update('editorRootLabel', 'connectionName', vscode.ConfigurationTarget.Global);

  const operations: Array<{ operation: string; id: string; path: string }> = [];
  let backing: Buffer = Buffer.from('base\n');
  const sessions = {
    hasConnection: () => true,
    getConnection: (id: string) => { assert.equal(id, connection.id); return connection; },
    prepareFileForOpen: async () => undefined,
    stat: async () => ({ type: 'file', modifyTime: 1, size: backing.length }),
    listDirectory: async (id: string, path: string) => {
      operations.push({ operation: 'list', id, path });
      return [{ name: 'etc', type: 'directory' }];
    },
    readFile: async (id: string, path: string) => { operations.push({ operation: 'read', id, path }); return backing; },
    writeFile: async (id: string, path: string, content: Buffer) => { operations.push({ operation: 'write', id, path }); backing = content; },
    rename: async () => { assert.fail('Display settings must not rename remote files'); },
    delete: async () => { assert.fail('Display settings must not delete remote files'); }
  } as unknown as RemoteSessionManager;
  const provider = new RemoteEditFileSystemProvider(sessions);
  const readonlyProvider = new RemoteEditFileSystemProvider(sessions, undefined, true);
  const registrations = [
    vscode.workspace.registerFileSystemProvider('remoteedit', provider, { isCaseSensitive: true }),
    vscode.workspace.registerFileSystemProvider('remoteedit-readonly', readonlyProvider, { isCaseSensitive: true, isReadonly: true })
  ];
  try {
    // Exercise the real open methods, replacing only unrelated services and view feedback.
    const panel = Object.assign(Object.create(RemoteEditPanel.prototype), {
      sessions, connectionManager: manager, requireActiveConnectionId: () => connection.id,
      postBusy() {}, logInfo() {}, buildRemoteReference: (path: string) => path
    });
    const sidebar = Object.assign(Object.create(RemoteEditSidebarController.prototype), { sessions, connectionManager: manager });
    await panel.openFile('/etc/config.yml');
    const editor = vscode.window.activeTextEditor!;
    assert.equal(editor.document.uri.path, '/生产环境 | 应用 A/etc/config.yml');
    await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'unsaved\n'));
    const oldUri = editor.document.uri.toString();
    const writesBefore = operations.filter(item => item.operation === 'write').length;
    await config.update('editorRootLabel', 'host', vscode.ConfigurationTarget.Global);
    assert.equal(editor.document.uri.toString(), oldUri);
    assert.equal(editor.document.getText(), 'unsaved\nbase\n');
    assert.equal(editor.document.isDirty, true);
    assert.equal(operations.filter(item => item.operation === 'write').length, writesBefore);
    await vscode.commands.executeCommand('undo');
    assert.equal(editor.document.getText(), 'base\n');
    await vscode.commands.executeCommand('redo');
    assert.equal(editor.document.getText(), 'unsaved\nbase\n');
    assert.equal(await editor.document.save(), true);
    assert.deepEqual(operations.filter(item => item.operation === 'write').at(-1), { operation: 'write', id: connection.id, path: '/etc/config.yml' });
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await panel.openFile('/etc/config.yml');
    assert.equal(vscode.window.activeTextEditor!.document.uri.path, '/127.0.0.1/etc/config.yml');
    for (const setting of [undefined, 'host']) {
      await config.update('editorRootLabel', setting, vscode.ConfigurationTarget.Global);
      for (const readOnly of [false, true]) {
        await panel.openEntriesWithMode({ entries: [{ path: '/etc/host.yml', type: 'file' }] }, readOnly);
        const webviewUri = vscode.window.activeTextEditor!.document.uri;
        await sidebar.openRemoteFileInEditor(connection.id, '/etc/host.yml', readOnly);
        const sidebarUri = vscode.window.activeTextEditor!.document.uri;
        assert.equal(sidebarUri.path, webviewUri.path);
        assert.equal(sidebarUri.authority, webviewUri.authority);
        assert.equal(sidebarUri.scheme, webviewUri.scheme);
        assert.equal(roundTrip(sidebarUri).remotePath, '/etc/host.yml');
      }
    }
    await config.update('editorRootLabel', 'connectionName', vscode.ConfigurationTarget.Global);
    for (const readOnly of [false, true]) {
      await sidebar.openRemoteFileInEditor(connection.id, '/etc/sidebar.yml', readOnly);
      assert.equal(vscode.window.activeTextEditor!.document.uri.path, '/生产环境 | 应用 A/etc/sidebar.yml');
      assert.equal(vscode.window.activeTextEditor!.document.uri.scheme, readOnly ? 'remoteedit-readonly' : 'remoteedit');
      await panel.openEntriesWithMode({ entries: [{ path: '/etc/selection.yml', type: 'file' }] }, readOnly);
      assert.equal(vscode.window.activeTextEditor!.document.uri.path, '/生产环境 | 应用 A/etc/selection.yml');
      assert.equal(vscode.window.activeTextEditor!.document.uri.scheme, readOnly ? 'remoteedit-readonly' : 'remoteedit');
    }
    await panel.compareSelectedEntries({ entries: [{ path: '/left/config.yml', type: 'file' }, { path: '/right/config.yml', type: 'file' }] });
    const input = vscode.window.tabGroups.activeTabGroup.activeTab!.input;
    assert.ok(input instanceof vscode.TabInputTextDiff);
    assert.equal(input.original.path, '/生产环境 | 应用 A/left/config.yml');
    assert.equal(input.modified.path, '/生产环境 | 应用 A/right/config.yml');
    assert.equal(input.original.scheme, 'remoteedit-readonly');
    assert.ok(operations.filter(item => item.operation === 'read').every(item => !item.path.includes('生产环境')));
    console.log(`Editor root label integration passed in VS Code ${vscode.version}.`);
  } finally {
    for (const document of vscode.workspace.textDocuments.filter(item => item.isDirty && item.uri.scheme === 'remoteedit')) {
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    for (const registration of registrations) registration.dispose();
    provider.dispose();
    readonlyProvider.dispose();
    await config.update('editorRootLabel', undefined, vscode.ConfigurationTarget.Global);
  }
}
