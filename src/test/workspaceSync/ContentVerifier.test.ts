import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { verifyComparisonContent } from '../../workspaceSync/compare/ContentVerifier';
import { diffSnapshots } from '../../workspaceSync/compare/DiffEngine';
import { createSyncSnapshot } from '../../workspaceSync/snapshot/SyncSnapshot';
import type { WorkspaceSyncRemoteSession } from '../../workspaceSync/connection/WorkspaceSyncSession';

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fakeSession(remoteContent: Record<string, string>): WorkspaceSyncRemoteSession {
  return {
    profileId: 'p1',
    connectionIdentity: 'conn-identity',
    connectionType: 'ftp',
    capabilities: {
      filenameStyle: 'unknown',
            reliableMtime: false,
      maxConcurrentMetadata: 1,
      maxConcurrentTransfers: 1
    },
    async list() { return []; },
    async stat() { return undefined; },
    async ensureDirectory() {},
    async upload() {},
    async download() {},
    async hashFile(remotePath: string) {
      const content = remoteContent[remotePath];
      if (content === undefined) throw new Error(`Missing fake remote file: ${remotePath}`);
      return hash(content);
    },
    async deleteFile() {},
    async deleteDirectory() {},
    async replaceFile() {},
    async reconnect() {},
    async disconnect() {}
  };
}

test('ContentVerifier prevents unreliable FTP mtimes from treating same-size different content as equal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-ws-'));
  try {
    await fs.writeFile(path.join(root, 'a.txt'), 'local');
    const local = createSyncSnapshot([{ relativePath: 'a.txt', fingerprint: { kind: 'file', size: 5, mtimeMs: 1000 } }]);
    const remote = createSyncSnapshot([{ relativePath: 'a.txt', fingerprint: { kind: 'file', size: 5, mtimeMs: 0 } }]);
    const verified = await verifyComparisonContent(root, '/remote', fakeSession({ '/remote/a.txt': 'other' }), local, remote);
    const diff = diffSnapshots(verified.local, verified.remote, undefined, { remoteMtimeReliable: false });
    assert.equal(diff[0].status, 'different');
    assert.notEqual(verified.local.entries['a.txt'].fingerprint.hash, verified.remote.entries['a.txt'].fingerprint.hash);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ContentVerifier can prove identical content when the remote timestamp is unreliable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-ws-'));
  try {
    await fs.writeFile(path.join(root, 'a.txt'), 'same!');
    const local = createSyncSnapshot([{ relativePath: 'a.txt', fingerprint: { kind: 'file', size: 5, mtimeMs: 1000 } }]);
    const remote = createSyncSnapshot([{ relativePath: 'a.txt', fingerprint: { kind: 'file', size: 5, mtimeMs: 0 } }]);
    const verified = await verifyComparisonContent(root, '/remote', fakeSession({ '/remote/a.txt': 'same!' }), local, remote);
    const diff = diffSnapshots(verified.local, verified.remote, undefined, { remoteMtimeReliable: false });
    assert.equal(diff[0].status, 'same');
    assert.equal(verified.local.entries['a.txt'].fingerprint.hash, verified.remote.entries['a.txt'].fingerprint.hash);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});







test('ContentVerifier force-hashes a failed-transfer path even when reliable metadata looks equal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-ws-force-hash-'));
  try {
    await fs.writeFile(path.join(root, 'large-file.bin'), 'LOCAL');
    const local = createSyncSnapshot([{ relativePath: 'large-file.bin', fingerprint: { kind: 'file', size: 5, mtimeMs: 1500 } }]);
    const remote = createSyncSnapshot([{ relativePath: 'large-file.bin', fingerprint: { kind: 'file', size: 5, mtimeMs: 1600 } }]);
    const baseline = {
      mappingId: 'm1', targetId: 't1', capturedAt: 1,
      entries: {
        'large-file.bin': {
          local: { kind: 'file' as const, size: 5, mtimeMs: 1000 },
          remote: { kind: 'file' as const, size: 5, mtimeMs: 1600 }
        }
      }
    };
    const session: WorkspaceSyncRemoteSession = {
      ...fakeSession({ '/remote/large-file.bin': 'OLD!!' }),
      connectionType: 'sftp',
      capabilities: { filenameStyle: 'unknown', reliableMtime: true, maxConcurrentMetadata: 1, maxConcurrentTransfers: 1 }
    };

    const verified = await verifyComparisonContent(root, '/remote', session, local, remote, baseline, {
      forceHashPaths: ['large-file.bin']
    });
    const diff = diffSnapshots(verified.local, verified.remote, baseline, { remoteMtimeReliable: true, mtimeToleranceMs: 2000 });
    assert.equal(diff[0].status, 'localChanged');
    assert.notEqual(verified.local.entries['large-file.bin'].fingerprint.hash, verified.remote.entries['large-file.bin'].fingerprint.hash);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
