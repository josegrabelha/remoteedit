import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { verifyComparisonContent } from '../../workspaceSync/compare/ContentVerifier';
import { diffSnapshots } from '../../workspaceSync/compare/DiffEngine';
import type { WorkspaceSyncRemoteSession } from '../../workspaceSync/connection/WorkspaceSyncSession';
import { createSyncSnapshot } from '../../workspaceSync/snapshot/SyncSnapshot';
import test from '../helpers/TestHarness';

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

test('ContentVerifier hashes equal-sized FTP files when mtimes are unreliable, distinguishing equal and different content', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-ws-'));
  try {
    const local = createSyncSnapshot([{ relativePath: 'a.txt', fingerprint: { kind: 'file', size: 5, mtimeMs: 1000 } }]);
    const remote = createSyncSnapshot([{ relativePath: 'a.txt', fingerprint: { kind: 'file', size: 5, mtimeMs: 0 } }]);
    for (const { localText, remoteText, status } of [
      { localText: 'local', remoteText: 'other', status: 'different' },
      { localText: 'same!', remoteText: 'same!', status: 'same' }
    ] as const) {
      await fs.writeFile(path.join(root, 'a.txt'), localText);
      const verified = await verifyComparisonContent(root, '/remote', fakeSession({ '/remote/a.txt': remoteText }), local, remote);
      const diff = diffSnapshots(verified.local, verified.remote, undefined, { remoteMtimeReliable: false });
      assert.equal(diff[0].status, status, `FTP content ${status}`);
      const hashesMatch = verified.local.entries['a.txt'].fingerprint.hash === verified.remote.entries['a.txt'].fingerprint.hash;
      assert.equal(hashesMatch, status === 'same', `FTP hashes ${status}`);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});;

;

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
