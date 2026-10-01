import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { revalidateSyncPlan } from '../../workspaceSync/planning/SyncRevalidator';
import { expandDirectoryDeletePlan } from '../../workspaceSync/planning/DirectoryDeleteExpansion';
import { executeSyncPlan } from '../../workspaceSync/execution/SyncExecutor';
import { readLocalFingerprint } from '../../workspaceSync/snapshot/CurrentState';
import type {
  FileFingerprint,
  SyncOperation,
  SyncPlan,
  WorkspaceSyncMapping,
  WorkspaceSyncTarget
} from '../../workspaceSync/types';
import type {
  WorkspaceSyncRemoteEntry,
  WorkspaceSyncRemoteSession
} from '../../workspaceSync/connection/WorkspaceSyncSession';

function mapping(localRoot: string): WorkspaceSyncMapping {
  return {
    id: 'mapping-1',
    name: 'Mapping',
    localRoot,
    targets: [target()],
    options: {
      direction: 'bidirectional',
      uploadOnSave: false,
      watchLocalChanges: false,
      watchRemoteChanges: false,
      conflictProtection: true,
      atomicTransfer: true,
      propagateDeletes: false,
      ignorePatterns: []
    },
    createdAt: 1,
    updatedAt: 1
  };
}

function target(): WorkspaceSyncTarget {
  return {
    id: 'target-1',
    name: 'Target',
    connectionId: 'connection-1',
    remoteRoot: '/remote',
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  };
}

function plan(operation: SyncOperation): SyncPlan {
  return {
    mappingId: 'mapping-1',
    targetId: 'target-1',
    createdAt: Date.now(),
    direction: 'bidirectional',
    operations: [operation],
    conflicts: [],
    errors: []
  };
}

function remoteEntry(fingerprint?: FileFingerprint): WorkspaceSyncRemoteEntry | undefined {
  if (!fingerprint) return undefined;
  return {
    name: 'file.txt',
    kind: fingerprint.kind,
    size: fingerprint.size,
    mtimeMs: fingerprint.mtimeMs
  };
}

function session(remote: FileFingerprint | undefined, options: { reliableMtime?: boolean; remoteHash?: string } = {}): WorkspaceSyncRemoteSession {
  return {
    profileId: 'connection-1',
    connectionIdentity: 'conn-identity',
    connectionType: options.reliableMtime === false ? 'ftp' : 'sftp',
    capabilities: {
      filenameStyle: 'unknown',
            reliableMtime: options.reliableMtime !== false,
      caseSensitive: true,
      maxConcurrentMetadata: 4,
      maxConcurrentTransfers: 2
    },
    async list() { return []; },
    async stat() { return remoteEntry(remote); },
    async ensureDirectory() {},
    async upload() {},
    async download() {},
    async hashFile() { return options.remoteHash || remote?.hash || 'remote-hash'; },
    async deleteFile() {},
    async deleteDirectory() {},
    async replaceFile() {},
    async reconnect() {},
    async disconnect() {}
  };
}

test('SyncRevalidator accepts an operation when local and remote state still match the plan', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-revalidate-'));
  try {
    const localPath = path.join(root, 'file.txt');
    await fs.writeFile(localPath, 'hello');
    const local = await readLocalFingerprint(localPath, true);
    assert.ok(local);
    const remote: FileFingerprint = { kind: 'file', size: 5, mtimeMs: 2000, hash: 'remote-hash' };
    const operation: SyncOperation = {
      id: 'op-1',
      type: 'upload',
      relativePath: 'file.txt',
      reason: 'test',
      expectedLocal: local,
      expectedRemote: remote
    };

    const result = await revalidateSyncPlan(mapping(root), target(), plan(operation), session(remote));
    assert.equal(result.valid.length, 1);
    assert.equal(result.stale.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SyncRevalidator blocks an operation when the local file changed after Preview', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-revalidate-local-'));
  try {
    const localPath = path.join(root, 'file.txt');
    await fs.writeFile(localPath, 'before');
    const expectedLocal = await readLocalFingerprint(localPath, true);
    assert.ok(expectedLocal);
    await fs.writeFile(localPath, 'after-after');

    const operation: SyncOperation = {
      id: 'op-1',
      type: 'upload',
      relativePath: 'file.txt',
      reason: 'test',
      expectedLocal,
      expectedRemote: undefined
    };

    const result = await revalidateSyncPlan(mapping(root), target(), plan(operation), session(undefined));
    assert.equal(result.valid.length, 0);
    assert.equal(result.stale.length, 1);
    assert.match(result.stale[0].reason, /Local state changed/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SyncRevalidator blocks an operation when the remote file changed after Preview', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-revalidate-remote-'));
  try {
    const expectedRemote: FileFingerprint = { kind: 'file', size: 5, mtimeMs: 1000 };
    const currentRemote: FileFingerprint = { kind: 'file', size: 8, mtimeMs: 2000 };
    const operation: SyncOperation = {
      id: 'op-1',
      type: 'download',
      relativePath: 'file.txt',
      reason: 'test',
      expectedLocal: undefined,
      expectedRemote
    };

    const result = await revalidateSyncPlan(mapping(root), target(), plan(operation), session(currentRemote));
    assert.equal(result.valid.length, 0);
    assert.equal(result.stale.length, 1);
    assert.match(result.stale[0].reason, /Remote state changed/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});



test('SyncRevalidator cascades a stale child delete to its parent directory delete', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-revalidate-delete-tree-'));
  try {
    const dirPath = path.join(root, 'dir');
    const childPath = path.join(dirPath, 'child.txt');
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(childPath, 'before');
    const expectedDir = await readLocalFingerprint(dirPath, false);
    const expectedChild = await readLocalFingerprint(childPath, true);
    assert.ok(expectedDir);
    assert.ok(expectedChild);

    // Change only the child contents. The directory itself can still have the
    // same metadata, so dependency-aware revalidation must invalidate the
    // parent delete explicitly rather than relying on directory mtime.
    await fs.writeFile(childPath, 'after-after');

    const syncPlan: SyncPlan = {
      mappingId: 'mapping-1',
      targetId: 'target-1',
      createdAt: Date.now(),
      direction: 'bidirectional',
      conflicts: [],
      errors: [],
      operations: [
        {
          id: 'child-delete',
          type: 'deleteLocal',
          relativePath: 'dir/child.txt',
          reason: 'test',
          expectedLocal: expectedChild,
          expectedRemote: undefined
        },
        {
          id: 'parent-delete',
          type: 'deleteLocal',
          relativePath: 'dir',
          reason: 'test',
          expectedLocal: expectedDir,
          expectedRemote: undefined
        }
      ]
    };

    const result = await revalidateSyncPlan(mapping(root), target(), syncPlan, session(undefined));
    assert.equal(result.valid.length, 0);
    assert.equal(result.stale.length, 2);
    assert.ok(result.stale.some(item => item.operation.id === 'child-delete' && /Local state changed/.test(item.reason)));
    assert.ok(result.stale.some(item => item.operation.id === 'parent-delete' && /descendant 'dir\/child\.txt'/.test(item.reason)));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('directory delete expansion removes stable hidden descendants before the parent directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-revalidate-hidden-delete-'));
  try {
    const dirPath = path.join(root, 'dir');
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(path.join(dirPath, '.hidden'), 'hidden');
    const expectedDir = await readLocalFingerprint(dirPath, false);
    assert.ok(expectedDir);

    const m = mapping(root);
    // Even an explicitly ignored hidden file must not strand a propagated
    // parent-directory delete. The delete manifest is deliberately complete.
    m.options.ignorePatterns = ['.*'];
    m.options.propagateDeletes = true;
    const deletePlan: SyncPlan = {
      mappingId: m.id,
      targetId: 'target-1',
      createdAt: Date.now(),
      direction: 'bidirectional',
      conflicts: [],
      errors: [],
      operations: [{
        id: 'delete-parent',
        type: 'deleteLocal',
        relativePath: 'dir',
        reason: 'Remote deletion is being propagated.',
        expectedLocal: expectedDir,
        expectedRemote: undefined
      }]
    };
    const remote = session(undefined);
    const expanded = await expandDirectoryDeletePlan(m, target(), deletePlan, remote);
    assert.ok(expanded.operations.some(operation => operation.relativePath === 'dir/.hidden' && operation.type === 'deleteLocal'));

    const revalidated = await revalidateSyncPlan(m, target(), expanded, remote);
    assert.equal(revalidated.stale.length, 0);
    const result = await executeSyncPlan(
      m,
      target(),
      { ...expanded, operations: revalidated.valid },
      remote,
      { atomicTransfer: true, retries: 0 }
    );
    assert.equal(result.failed.length, 0);
    assert.equal(result.deferred.length, 0);
    await assert.rejects(fs.lstat(dirPath), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
