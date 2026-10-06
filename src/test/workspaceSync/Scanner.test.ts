import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { scanLocalTree, safeLocalPath } from '../../workspaceSync/scan/LocalScanner';
import { scanRemoteTree, joinRemotePath } from '../../workspaceSync/scan/RemoteScanner';
import { remoteParentDirectory } from '../../workspaceSync/execution/SyncPathUtils';
import type { WorkspaceSyncRemoteSession } from '../../workspaceSync/connection/WorkspaceSyncSession';
import { createSyncSnapshot } from '../../workspaceSync/snapshot/SyncSnapshot';
import { diffSnapshots } from '../../workspaceSync/compare/DiffEngine';

function remoteSession(listImpl: WorkspaceSyncRemoteSession['list']): WorkspaceSyncRemoteSession {
  return {
    profileId: 'p1', connectionIdentity: 'conn-identity', connectionType: 'sftp',
    capabilities: { filenameStyle: 'unknown', reliableMtime: true, maxConcurrentMetadata: 4, maxConcurrentTransfers: 2 },
    list: listImpl,
    async stat() { return undefined; }, async ensureDirectory() {}, async upload() {}, async download() {},
    async hashFile() { return ''; }, async deleteFile() {}, async deleteDirectory() {}, async replaceFile() {}, async reconnect() {}, async disconnect() {}
  };
}

test('LocalScanner respects ignore rules and records symbolic links without following them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-scan-'));
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src', 'a.txt'), 'a');
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'node_modules', 'ignored.txt'), 'x');
    if (process.platform !== 'win32') await fs.symlink(path.join(root, 'src'), path.join(root, 'link'));
    const snapshot = await scanLocalTree(root, { ignorePatterns: ['node_modules/'] });
    assert.ok(snapshot.entries['src']);
    assert.ok(snapshot.entries['src/a.txt']);
    assert.equal(snapshot.entries['node_modules'], undefined);
    if (process.platform !== 'win32') assert.equal(snapshot.entries['link']?.fingerprint.kind, 'link');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});



test('LocalScanner keeps permission failures visible as Unknown with their error code', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-permission-scan-'));
  const restricted = path.join(root, 'restricted.txt');
  const fsModule = require('fs/promises') as typeof import('fs/promises');
  const originalLstat = fsModule.lstat.bind(fsModule);
  try {
    await fs.writeFile(restricted, 'private');
    t.mock.method(fsModule, 'lstat', async (file: any, options?: any) => {
      if (file === restricted) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return originalLstat(file, options);
    });
    const snapshot = await scanLocalTree(root);
    assert.deepEqual(snapshot.incompletePaths, ['restricted.txt']);
    assert.equal(snapshot.incompleteErrors?.['restricted.txt'], 'EACCES');
    const diff = diffSnapshots(snapshot, createSyncSnapshot([]));
    assert.equal(diff.length, 1);
    assert.equal(diff[0].status, 'unknown');
    assert.match(diff[0].reason || '', /Local: EACCES/);
  } finally {
    t.mock.restoreAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});









test('RemoteScanner fails closed when a directory listing fails', async () => {
  const session = remoteSession(async remotePath => {
    if (remotePath === '/root') return [{ name: 'ok.txt', kind: 'file', size: 1, mtimeMs: 1 }, { name: 'private', kind: 'directory', size: 0, mtimeMs: 1 }];
    if (remotePath === '/root/private') throw new Error('Permission denied');
    return [];
  });
  const snapshot = await scanRemoteTree(session, '/root');
  assert.ok(snapshot.entries['ok.txt']);
  assert.ok(snapshot.entries['private']);
  assert.deepEqual(snapshot.incompletePaths, ['private']);
});








test('joinRemotePath rejects traversal outside the mapping root', () => {
  assert.throws(() => joinRemotePath('/var/www', '../etc/passwd'), /escapes the mapping root/i);
});







