import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { scanLocalTree, safeLocalPath } from '../../workspaceSync/scan/LocalScanner';
import { scanRemoteTree, joinRemotePath } from '../../workspaceSync/scan/RemoteScanner';
import { remoteParentDirectory } from '../../workspaceSync/execution/SyncPathUtils';
import type { WorkspaceSyncRemoteSession } from '../../workspaceSync/connection/WorkspaceSyncSession';

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

test('safeLocalPath rejects paths that escape the mapping root', () => {
  assert.throws(() => safeLocalPath('/tmp/root', '../outside.txt'), /escapes the mapping root/i);
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



test('LocalScanner reports an unreadable root instead of treating it as an empty tree', async () => {
  const missing = path.join(os.tmpdir(), `remoteedit-missing-${Date.now()}-${Math.random()}`);
  await assert.rejects(
    () => scanLocalTree(missing),
    /cannot scan Local root/i
  );
});

test('RemoteScanner reports an unreadable root instead of treating it as an empty tree', async () => {
  const session = remoteSession(async remotePath => {
    if (remotePath === '/missing') throw new Error('Permission denied');
    return [];
  });
  await assert.rejects(
    () => scanRemoteTree(session, '/missing'),
    /cannot scan Remote root.*Permission denied/i
  );
});


test('Remote path helpers preserve Windows drive roots', () => {
  assert.equal(joinRemotePath('C:/', ''), 'C:/');
  assert.equal(joinRemotePath('C:/', 'site/app.js'), 'C:/site/app.js');
  assert.equal(joinRemotePath('/C:/', 'site/app.js'), '/C:/site/app.js');
  assert.equal(remoteParentDirectory('C:/app.js'), 'C:/');
  assert.equal(remoteParentDirectory('/C:/app.js'), '/C:/');
  assert.equal(remoteParentDirectory('C:/site/app.js'), 'C:/site');
});

test('joinRemotePath rejects traversal outside the mapping root', () => {
  assert.throws(() => joinRemotePath('/var/www', '../etc/passwd'), /escapes the mapping root/i);
});

test('LocalScanner rejects a symbolic-link Local root instead of following it', { skip: process.platform === 'win32' }, async () => {
  const actual = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-real-root-'));
  const holder = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-link-root-'));
  const linked = path.join(holder, 'linked-root');
  try {
    await fs.writeFile(path.join(actual, 'a.txt'), 'a');
    await fs.symlink(actual, linked);
    await assert.rejects(() => scanLocalTree(linked), /Local root cannot be a symbolic link/i);
  } finally {
    await fs.rm(holder, { recursive: true, force: true });
    await fs.rm(actual, { recursive: true, force: true });
  }
});


test('Local and Remote scanners collapse Unicode normalization variants to one logical path while preserving physical names', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-scan-unicode-'));
  try {
    const localName = 'c\u0327a\u0303-special.txt';
    const remoteName = localName.normalize('NFC');
    const localPhysical = `folder/${localName}`;
    const remotePhysical = `folder/${remoteName}`;
    await fs.mkdir(path.join(root, 'folder'));
    await fs.writeFile(path.join(root, 'folder', localName), 'x');

    const local = await scanLocalTree(root);
    const session = remoteSession(async remotePath => {
      if (remotePath === '/root') return [{ name: 'folder', kind: 'directory', size: 0, mtimeMs: 1 }];
      if (remotePath === '/root/folder') return [{ name: path.posix.basename(remotePhysical), kind: 'file', size: 1, mtimeMs: 1 }];
      return [];
    });
    const remote = await scanRemoteTree(session, '/root');
    const logical = remotePhysical;

    assert.ok(local.entries[logical]);
    assert.ok(remote.entries[logical]);
    assert.equal(local.entries[logical].physicalRelativePath, localPhysical);
    assert.equal(remote.entries[logical].physicalRelativePath, remotePhysical);
    assert.equal(Object.keys(local.entries).filter(value => value.endsWith('special.txt')).length, 1);
    assert.equal(Object.keys(remote.entries).filter(value => value.endsWith('special.txt')).length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('RemoteScanner uses directory-list metadata without per-entry stat round trips', async () => {
  let statCalls = 0;
  const base = remoteSession(async remotePath => {
    if (remotePath === '/root') {
      return [
        { name: 'file.txt', kind: 'file', size: 12, mtimeMs: 123 },
        { name: 'folder', kind: 'directory', size: 0, mtimeMs: 124 }
      ];
    }
    if (remotePath === '/root/folder') {
      return [{ name: 'nested.txt', kind: 'file', size: 3, mtimeMs: 125 }];
    }
    return [];
  });
  const session: WorkspaceSyncRemoteSession = {
    ...base,
    async stat() {
      statCalls += 1;
      throw new Error('RemoteScanner should not stat entries returned by list().');
    }
  };

  const snapshot = await scanRemoteTree(session, '/root');
  assert.equal(statCalls, 0);
  assert.equal(snapshot.entries['file.txt']?.fingerprint.size, 12);
  assert.equal(snapshot.entries['folder/nested.txt']?.fingerprint.mtimeMs, 125);
});
