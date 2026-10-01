import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { executeSyncPlan } from '../../workspaceSync/execution/SyncExecutor';
import type { SyncOperation, SyncPlan, WorkspaceSyncMapping, WorkspaceSyncTarget } from '../../workspaceSync/types';
import type { WorkspaceSyncRemoteSession } from '../../workspaceSync/connection/WorkspaceSyncSession';

function fixture(localRoot: string): { mapping: WorkspaceSyncMapping; target: WorkspaceSyncTarget } {
  const target: WorkspaceSyncTarget = { id: 't1', name: 'Prod', connectionId: 'p1', remoteRoot: '/remote', enabled: true, createdAt: 1, updatedAt: 1 };
  return {
    target,
    mapping: {
      id: 'm1', name: 'Map', localRoot, targets: [target], createdAt: 1, updatedAt: 1,
      options: { direction: 'bidirectional', uploadOnSave: false, watchLocalChanges: false, watchRemoteChanges: false, conflictProtection: true, atomicTransfer: true, propagateDeletes: false, ignorePatterns: [] }
    }
  };
}

function plan(operation: SyncOperation): SyncPlan {
  return { mappingId: 'm1', targetId: 't1', createdAt: 1, direction: 'bidirectional', operations: [operation], conflicts: [], errors: [] };
}

function fakeSession(overrides: Partial<WorkspaceSyncRemoteSession> = {}): WorkspaceSyncRemoteSession {
  return {
    profileId: 'p1', connectionIdentity: 'conn-identity', connectionType: 'sftp',
    capabilities: { filenameStyle: 'unknown', reliableMtime: true, maxConcurrentMetadata: 2, maxConcurrentTransfers: 2 },
    async list() { return []; }, async stat() { return undefined; }, async ensureDirectory() {}, async upload() {}, async download() {},
    async hashFile() { return ''; }, async deleteFile() {}, async deleteDirectory() {}, async replaceFile() {}, async reconnect() {}, async disconnect() {},
    ...overrides
  };
}

test('SyncExecutor uses a remote temporary file for atomic upload', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-exec-'));
  try {
    await fs.writeFile(path.join(root, 'a.txt'), 'hello');
    const { mapping, target } = fixture(root);
    const calls: string[] = [];
    const session = fakeSession({
      async ensureDirectory(remotePath) { calls.push(`mkdir:${remotePath}`); },
      async upload(_local, remotePath) { calls.push(`upload:${remotePath}`); },
      async replaceFile(oldPath, newPath) { calls.push(`rename:${oldPath}->${newPath}`); }
    });
    const result = await executeSyncPlan(mapping, target, plan({ id: '1', type: 'upload', relativePath: 'a.txt', reason: 'test' }), session, { atomicTransfer: true, retries: 0 });
    assert.equal(result.failed.length, 0);
    assert.equal(calls[0], 'mkdir:/remote');
    assert.match(calls[1], /^upload:\/remote\/a\.txt\.remoteedit-.+\.tmp$/);
    assert.match(calls[2], /^rename:\/remote\/a\.txt\.remoteedit-.+\.tmp->\/remote\/a\.txt$/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SyncExecutor atomically replaces a local file after download', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-exec-'));
  try {
    await fs.writeFile(path.join(root, 'a.txt'), 'old');
    const { mapping, target } = fixture(root);
    const session = fakeSession({ async download(_remote, localPath) { await fs.writeFile(localPath, 'new'); } });
    const result = await executeSyncPlan(mapping, target, plan({ id: '1', type: 'download', relativePath: 'a.txt', reason: 'test' }), session, { atomicTransfer: true, retries: 0 });
    assert.equal(result.failed.length, 0);
    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'new');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});







test('SyncExecutor does not run destructive deletes after an earlier transfer failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-exec-'));
  try {
    await fs.writeFile(path.join(root, 'upload.txt'), 'hello');
    const { mapping, target } = fixture(root);
    let deleted = false;
    const session = fakeSession({
      capabilities: { filenameStyle: 'unknown', reliableMtime: true, maxConcurrentMetadata: 1, maxConcurrentTransfers: 1 },
      async upload() { throw new Error('permission denied'); },
      async deleteFile() { deleted = true; },
      async stat(remotePath) {
        if (remotePath.endsWith('old.txt')) return { name: 'old.txt', kind: 'file', size: 1, mtimeMs: 1 };
        return undefined;
      }
    });
    const syncPlan: SyncPlan = {
      mappingId: 'm1', targetId: 't1', createdAt: 1, direction: 'localToRemote', conflicts: [], errors: [],
      operations: [
        { id: 'upload', type: 'upload', relativePath: 'upload.txt', reason: 'test' },
        { id: 'delete', type: 'deleteRemote', relativePath: 'old.txt', reason: 'test', expectedRemote: { kind: 'file', size: 1, mtimeMs: 1 } }
      ]
    };
    const result = await executeSyncPlan(mapping, target, syncPlan, session, { atomicTransfer: false, retries: 0 });
    assert.equal(result.failed.length, 1);
    assert.equal(deleted, false);
    assert.equal(result.skipped.some(operation => operation.id === 'delete'), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SyncExecutor waits for child deletes before removing a parent remote directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-exec-delete-order-'));
  try {
    const { mapping, target } = fixture(root);
    let childExists = true;
    const calls: string[] = [];
    const session = fakeSession({
      capabilities: { filenameStyle: 'unknown', reliableMtime: true, maxConcurrentMetadata: 2, maxConcurrentTransfers: 2 },
      async stat(remotePath) {
        if (remotePath.endsWith('/dir/child.txt') && childExists) {
          return { name: 'child.txt', kind: 'file', size: 1, mtimeMs: 1 };
        }
        if (remotePath.endsWith('/dir')) {
          return { name: 'dir', kind: 'directory', size: 0, mtimeMs: 1 };
        }
        return undefined;
      },
      async deleteFile(remotePath) {
        calls.push(`delete-file-start:${remotePath}`);
        await new Promise(resolve => setTimeout(resolve, 20));
        childExists = false;
        calls.push(`delete-file-end:${remotePath}`);
      },
      async deleteDirectory(remotePath) {
        calls.push(`delete-dir:${remotePath}`);
        if (childExists) throw new Error('rmdir: Failure /remote/dir');
      }
    });
    const syncPlan: SyncPlan = {
      mappingId: 'm1', targetId: 't1', createdAt: 1, direction: 'localToRemote', conflicts: [], errors: [],
      operations: [
        { id: 'child', type: 'deleteRemote', relativePath: 'dir/child.txt', reason: 'test', expectedRemote: { kind: 'file', size: 1, mtimeMs: 1 } },
        { id: 'dir', type: 'deleteRemote', relativePath: 'dir', reason: 'test', expectedRemote: { kind: 'directory', size: 0, mtimeMs: 1 } }
      ]
    };

    const result = await executeSyncPlan(mapping, target, syncPlan, session, { atomicTransfer: true, retries: 0 });

    assert.equal(result.failed.length, 0);
    assert.deepEqual(calls, [
      'delete-file-start:/remote/dir/child.txt',
      'delete-file-end:/remote/dir/child.txt',
      'delete-dir:/remote/dir'
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});



test('SyncExecutor refuses to upload through a Local symlink ancestor', { skip: process.platform === 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-exec-safe-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-exec-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'secret.txt'), 'do not upload');
    await fs.symlink(outside, path.join(root, 'redirect'));
    const { mapping, target } = fixture(root);
    let uploaded = false;
    const result = await executeSyncPlan(
      mapping,
      target,
      plan({ id: 'unsafe', type: 'upload', relativePath: 'redirect/secret.txt', reason: 'test' }),
      fakeSession({ async upload() { uploaded = true; } }),
      { atomicTransfer: false, retries: 0 }
    );
    assert.equal(result.failed.length, 1);
    assert.equal(uploaded, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});



test('SyncExecutor reports an orphaned atomic temp when cleanup cannot run after an interrupted upload', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-exec-orphan-'));
  try {
    await fs.writeFile(path.join(root, 'large-file.bin'), 'hello');
    const { mapping, target } = fixture(root);
    const orphaned: Array<{ tempPath: string; relativePath: string }> = [];
    const session = fakeSession({
      async upload() { throw new Error('ECONNRESET'); },
      async deleteFile() { throw new Error('not connected'); },
      async reconnect() { throw new Error('still disconnected'); }
    });
    const operation: SyncOperation = { id: '1', type: 'upload', relativePath: 'large-file.bin', reason: 'test' };
    const result = await executeSyncPlan(mapping, target, plan(operation), session, {
      atomicTransfer: true,
      retries: 0,
      onOrphanedRemoteTemp: (tempPath, failedOperation) => orphaned.push({ tempPath, relativePath: failedOperation.relativePath })
    });

    assert.equal(result.failed.length, 1);
    assert.equal(orphaned.length, 1);
    assert.equal(orphaned[0].relativePath, 'large-file.bin');
    assert.match(orphaned[0].tempPath, /^\/remote\/large-file\.bin\.remoteedit-[0-9a-f-]+\.tmp$/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});




test('SyncExecutor uses the exact Remote Unicode spelling captured during Preview', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-exec-unicode-'));
  try {
    const { mapping, target } = fixture(root);
    const logical = 'folder/çã-special.txt';
    const remotePhysical = logical.normalize('NFD');
    const calls: string[] = [];
    const session = fakeSession({
      async stat(remotePath) {
        calls.push(`stat:${remotePath}`);
        if (remotePath === '/remote/folder') {
          return { name: 'folder', kind: 'directory', size: 0, mtimeMs: 1 };
        }
        return { name: path.posix.basename(remotePath), kind: 'file', size: 1, mtimeMs: 1 };
      },
      async deleteFile(remotePath) { calls.push(`delete:${remotePath}`); }
    });

    const operation: SyncOperation = {
      id: 'unicode-delete',
      type: 'deleteRemote',
      relativePath: logical,
      remoteRelativePath: remotePhysical,
      reason: 'test',
      expectedRemote: { kind: 'file', size: 1, mtimeMs: 1 }
    };
    const result = await executeSyncPlan(mapping, target, plan(operation), session, { atomicTransfer: true, retries: 0 });

    assert.equal(result.failed.length, 0);
    assert.ok(calls.includes(`stat:/remote/${remotePhysical}`));
    assert.ok(calls.includes(`delete:/remote/${remotePhysical}`));
    assert.ok(!calls.includes(`delete:/remote/${logical}`));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
