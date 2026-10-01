import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceSyncDiffTempStore } from '../../workspaceSync/compare/DiffTempStore';



test('DiffTempStore prunes expired files and keeps the newest files within the limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-diff-prune-'));
  try {
    const store = new WorkspaceSyncDiffTempStore(root);
    const old = path.join(root, 'old.tmp');
    const one = path.join(root, 'one.tmp');
    const two = path.join(root, 'two.tmp');
    await fs.writeFile(old, 'old');
    await fs.writeFile(one, 'one');
    await fs.writeFile(two, 'two');
    const now = Date.now();
    await fs.utimes(old, new Date(now - 20_000), new Date(now - 20_000));
    await fs.utimes(one, new Date(now - 2_000), new Date(now - 2_000));
    await fs.utimes(two, new Date(now - 1_000), new Date(now - 1_000));

    await store.prune(10_000, 1);
    const remaining = await fs.readdir(root);
    assert.deepEqual(remaining, ['two.tmp']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
