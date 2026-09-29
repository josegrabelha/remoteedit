import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { assertLocalPathAncestorsSafe, assertRemotePathAncestorsSafe } from '../../workspaceSync/execution/PathSafety';
import type { WorkspaceSyncRemoteSession } from '../../workspaceSync/connection/WorkspaceSyncSession';

function sessionWithStat(stat: WorkspaceSyncRemoteSession['stat']): WorkspaceSyncRemoteSession {
  return {
    profileId: 'p1', connectionIdentity: 'identity', connectionType: 'sftp',
    capabilities: { filenameStyle: 'unknown', reliableMtime: true, maxConcurrentMetadata: 2, maxConcurrentTransfers: 2 },
    async list() { return []; }, stat, async ensureDirectory() {}, async upload() {}, async download() {},
    async hashFile() { return ''; }, async deleteFile() {}, async deleteDirectory() {}, async replaceFile() {}, async reconnect() {}, async disconnect() {}
  };
}

test('PathSafety blocks a Local descendant whose parent was replaced by a symlink', { skip: process.platform === 'win32' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-path-safety-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-path-outside-'));
  try {
    await fs.symlink(outside, path.join(root, 'redirect'));
    await assert.rejects(
      () => assertLocalPathAncestorsSafe(root, 'redirect/file.txt'),
      /Local ancestor.*symbolic link/i
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('PathSafety blocks a Remote descendant below a symlink but permits a missing parent', async () => {
  const unsafe = sessionWithStat(async remotePath => remotePath === '/root/current'
    ? { name: 'current', kind: 'link', size: 0, mtimeMs: 1 }
    : undefined);
  await assert.rejects(
    () => assertRemotePathAncestorsSafe(unsafe, '/root', 'current/app.js'),
    /Remote ancestor.*symbolic link/i
  );

  const missing = sessionWithStat(async () => undefined);
  await assert.doesNotReject(() => assertRemotePathAncestorsSafe(missing, '/root', 'new/sub/app.js'));
});
