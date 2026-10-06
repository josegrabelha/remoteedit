import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import { baselineRequiresStrongFingerprint, classifyCurrentPath, readAndClassifyCurrentPath } from '../../workspaceSync/compare/CurrentPathClassifier';
import type { WorkspaceSyncRemoteEntry, WorkspaceSyncRemoteSession } from '../../workspaceSync/connection/WorkspaceSyncSession';
import type { BaselineEntry } from '../../workspaceSync/types';

function sha(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sessionFor(content: string, reliableMtime = true): WorkspaceSyncRemoteSession {
  const entry: WorkspaceSyncRemoteEntry = { name: 'file.txt', kind: 'file', size: Buffer.byteLength(content), mtimeMs: 1000 };
  return {
    profileId: 'p', connectionIdentity: 'c', connectionType: 'sftp',
    capabilities: { reliableMtime, filenameStyle: 'posix', maxConcurrentMetadata: 2, maxConcurrentTransfers: 2 },
    async list() { return [entry]; },
    async stat() { return entry; },
    async ensureDirectory() {}, async upload() {}, async download() {},
    async hashFile() { return sha(content); },
    async deleteFile() {}, async deleteDirectory() {}, async replaceFile() {}, async reconnect() {}, async disconnect() {}
  };
}

async function withLocalFile(content: string, run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-current-path-'));
  const filePath = path.join(dir, 'file.txt');
  try {
    await fs.writeFile(filePath, content);
    await run(filePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function baseline(content: string): BaselineEntry {
  const fingerprint = { kind: 'file' as const, size: Buffer.byteLength(content), mtimeMs: 1000, hash: sha(content) };
  return { local: { ...fingerprint }, remote: { ...fingerprint }, localRelativePath: 'file.txt', remoteRelativePath: 'file.txt' };
}

test('Local-only replacement remains localChanged when Remote still matches a hashed baseline', async () => {
  await withLocalFile('bbb', async localPath => {
    const result = await readAndClassifyCurrentPath(sessionFor('aaa'), {
      relativePath: 'file.txt', localPath, remotePath: '/file.txt', baseline: baseline('aaa')
    });
    assert.strictEqual(result.diff.status, 'localChanged');
    assert.ok(result.local?.hash);
    assert.strictEqual(result.remote?.hash, sha('aaa'));
  });
});



test('independent Local and Remote replacements remain a real conflict', async () => {
  await withLocalFile('bbb', async localPath => {
    const result = await readAndClassifyCurrentPath(sessionFor('ccc'), {
      relativePath: 'file.txt', localPath, remotePath: '/file.txt', baseline: baseline('aaa')
    });
    assert.strictEqual(result.diff.status, 'conflict');
  });
});







test('a completed upload baseline makes the later Remote Watch observation Same', async () => {
  await withLocalFile('bbb', async localPath => {
    const result = await readAndClassifyCurrentPath(sessionFor('bbb'), {
      relativePath: 'file.txt', localPath, remotePath: '/file.txt', baseline: baseline('bbb')
    });
    assert.strictEqual(result.diff.status, 'same');
  });
});
