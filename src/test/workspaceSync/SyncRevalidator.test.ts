import * as fs from 'fs/promises';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import type {
    WorkspaceSyncRemoteEntry,
    WorkspaceSyncRemoteSession
} from '../../workspaceSync/connection/WorkspaceSyncSession';
import { executeSyncPlan } from '../../workspaceSync/execution/SyncExecutor';
import { expandDirectoryDeletePlan } from '../../workspaceSync/planning/DirectoryDeleteExpansion';
import { revalidateSyncPlan } from '../../workspaceSync/planning/SyncRevalidator';
import { readLocalFingerprint } from '../../workspaceSync/snapshot/CurrentState';
import type {
    FileFingerprint,
    SyncOperation,
    SyncPlan,
    WorkspaceSyncMapping,
    WorkspaceSyncTarget
} from '../../workspaceSync/types';
import test from '../helpers/TestHarness';

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

test('SyncRevalidator accepts unchanged Preview, then rejects changed Local and Remote state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-revalidate-'));
  try {
    const localPath = path.join(root, 'file.txt');
    await fs.writeFile(localPath, 'hello');
    const expectedLocal = await readLocalFingerprint(localPath, true);
    assert.ok(expectedLocal);
    const expectedRemote: FileFingerprint = { kind: 'file', size: 5, mtimeMs: 2000, hash: 'remote-hash' };
    const upload: SyncOperation = {
      id: 'op-upload', type: 'upload', relativePath: 'file.txt', reason: 'test',
      expectedLocal, expectedRemote
    };

    const unchanged = await revalidateSyncPlan(mapping(root), target(), plan(upload), session(expectedRemote));
    assert.equal(unchanged.valid.length, 1);
    assert.equal(unchanged.stale.length, 0);

    await fs.writeFile(localPath, 'after-after');
    // Preserve the original Local-only Preview case: Remote was absent.
    const modifiedLocal = await revalidateSyncPlan(mapping(root), target(),
      plan({ ...upload, expectedRemote: undefined }), session(undefined));
    assert.equal(modifiedLocal.valid.length, 0);
    assert.equal(modifiedLocal.stale.length, 1);
    assert.match(modifiedLocal.stale[0].reason, /Local state changed/);

    await fs.rm(localPath);
    const download: SyncOperation = {
      id: 'op-download', type: 'download', relativePath: 'file.txt', reason: 'test',
      expectedLocal: undefined, expectedRemote: { kind: 'file', size: 5, mtimeMs: 1000 }
    };
    const modifiedRemote = await revalidateSyncPlan(mapping(root), target(), plan(download),
      session({ kind: 'file', size: 8, mtimeMs: 2000 }));
    assert.equal(modifiedRemote.valid.length, 0);
    assert.equal(modifiedRemote.stale.length, 1);
    assert.match(modifiedRemote.stale[0].reason, /Remote state changed/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});;

;

;

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
