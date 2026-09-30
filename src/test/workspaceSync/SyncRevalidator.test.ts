import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { revalidateSyncPlan } from '../../workspaceSync/planning/SyncRevalidator';
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

test('SyncRevalidator uses content hash for unreliable FTP mtimes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-revalidate-ftp-'));
  try {
    const expectedRemote: FileFingerprint = { kind: 'file', size: 5, mtimeMs: 0, hash: 'abc' };
    const currentRemote: FileFingerprint = { kind: 'file', size: 5, mtimeMs: 999999 };
    const operation: SyncOperation = {
      id: 'op-1',
      type: 'download',
      relativePath: 'file.txt',
      reason: 'test',
      expectedLocal: undefined,
      expectedRemote
    };

    const unchanged = await revalidateSyncPlan(
      mapping(root),
      target(),
      plan(operation),
      session(currentRemote, { reliableMtime: false, remoteHash: 'abc' })
    );
    assert.equal(unchanged.valid.length, 1);

    const changed = await revalidateSyncPlan(
      mapping(root),
      target(),
      plan(operation),
      session(currentRemote, { reliableMtime: false, remoteHash: 'different' })
    );
    assert.equal(changed.stale.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
