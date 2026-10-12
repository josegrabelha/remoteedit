import * as fs from 'fs/promises';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import * as os from 'os';
import * as path from 'path';
import { BaselineStore } from '../../workspaceSync/baseline/BaselineStore';
import type { SyncBaseline } from '../../workspaceSync/types';
import test from '../helpers/TestHarness';

function contextAt(root: string): any {
  return { globalStorageUri: { fsPath: root } };
}

function baseline(mappingId = 'mapping-1', targetId = 'target-1'): SyncBaseline {
  return {
    mappingId,
    targetId,
    capturedAt: 1,
    entries: {
      'src/app.ts': {
        local: { kind: 'file', size: 10, mtimeMs: 100, hash: 'same' },
        remote: { kind: 'file', size: 10, mtimeMs: 200, hash: 'same' }
      }
    }
  };
}

const baselineContext = {
  localRoot: '/local/project',
  remoteRoot: '/remote/project',
  connectionId: 'connection-1',
  connectionIdentity: 'endpoint-a'
};

async function fixture(t: TestContext, prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const stores: BaselineStore[] = [];
  t.after(async () => {
    // clear() cancels debounce timers and awaits writes before the directory is removed.
    for (const store of stores) await store.clear('mapping-1');
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    createStore() {
      const store = new BaselineStore(contextAt(root));
      stores.push(store);
      return store;
    }
  };
}

async function waitForPersist(root: string): Promise<void> {
  // Wait for the actual disk record, rather than assuming a timer completed on time.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const files = await fs.readdir(root, { recursive: true });
    for (const file of files.filter(file => file.endsWith('.json'))) {
      const record = JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
      if (record.baseline) return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Baseline was not persisted within 5 seconds');
}

test('BaselineStore persists and reloads a baseline for the same mapping context', async t => {
  const { root, createStore } = await fixture(t, 'remoteedit-baseline-');
  const first = createStore();
  assert.equal(await first.ensureContext('mapping-1', 'target-1', baselineContext), false);
  await first.set(baseline());
  await waitForPersist(root);

  const second = createStore();
  assert.equal(await second.ensureContext('mapping-1', 'target-1', baselineContext), false);
  assert.deepEqual(await second.get('mapping-1', 'target-1'), baseline());
});

test('BaselineStore clears a persisted baseline when connection or root context changes', async t => {
  const { root, createStore } = await fixture(t, 'remoteedit-baseline-context-');
  const store = createStore();
  await store.ensureContext('mapping-1', 'target-1', baselineContext);
  await store.set(baseline());
  assert.ok(await store.get('mapping-1', 'target-1'));

  await waitForPersist(root);
  const reloaded = createStore();
  const changed = await reloaded.ensureContext('mapping-1', 'target-1', {
    ...baselineContext,
    remoteRoot: '/remote/other-project'
  });

  assert.equal(changed, true);
  assert.equal(await reloaded.get('mapping-1', 'target-1'), undefined);
});

test('BaselineStore isolates two targets in the same mapping', async t => {
  const { createStore } = await fixture(t, 'remoteedit-baseline-same-mapping-targets-');
  const store = createStore();
  const contextA = { ...baselineContext, remoteRoot: '/remote/a' };
  const contextB = { ...baselineContext, remoteRoot: '/remote/b' };
  await store.ensureContext('mapping-1', 'target-a', contextA);
  await store.ensureContext('mapping-1', 'target-b', contextB);
  await store.set({
    mappingId: 'mapping-1', targetId: 'target-a', capturedAt: 1,
    entries: { 'file.txt': { local: { kind: 'file', size: 10, mtimeMs: 1 }, remote: { kind: 'file', size: 11, mtimeMs: 1 } } }
  });
  await store.set({
    mappingId: 'mapping-1', targetId: 'target-b', capturedAt: 2,
    entries: { 'file.txt': { local: { kind: 'file', size: 20, mtimeMs: 2 }, remote: { kind: 'file', size: 21, mtimeMs: 2 } } }
  });

  await store.updatePath('mapping-1', 'target-a', 'file.txt',
    { kind: 'file', size: 30, mtimeMs: 3 },
    { kind: 'file', size: 31, mtimeMs: 3 });

  assert.equal((await store.get('mapping-1', 'target-a'))?.entries['file.txt']?.local?.size, 30);
  assert.equal((await store.get('mapping-1', 'target-b'))?.entries['file.txt']?.local?.size, 20);
  assert.equal((await store.get('mapping-1', 'target-b'))?.entries['file.txt']?.remote?.size, 21);
});
