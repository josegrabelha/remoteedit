import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { BaselineStore } from '../../workspaceSync/baseline/BaselineStore';
import { WorkspaceSyncLastKnownViewStore } from '../../workspaceSync/view/LastKnownViewStore';
import type { SyncBaseline } from '../../workspaceSync/types';

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

async function waitForPersist(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 350));
}

test('BaselineStore persists and reloads a baseline for the same mapping context', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-baseline-'));
  try {
    const first = new BaselineStore(contextAt(root));
    assert.equal(await first.ensureContext('mapping-1', 'target-1', baselineContext), false);
    await first.set(baseline());
    await waitForPersist();

    const second = new BaselineStore(contextAt(root));
    assert.equal(await second.ensureContext('mapping-1', 'target-1', baselineContext), false);
    assert.deepEqual(await second.get('mapping-1', 'target-1'), baseline());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('BaselineStore clears a persisted baseline when connection or root context changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-baseline-context-'));
  try {
    const store = new BaselineStore(contextAt(root));
    await store.ensureContext('mapping-1', 'target-1', baselineContext);
    await store.set(baseline());
    assert.ok(await store.get('mapping-1', 'target-1'));

    const changed = await store.ensureContext('mapping-1', 'target-1', {
      ...baselineContext,
      remoteRoot: '/remote/other-project'
    });

    assert.equal(changed, true);
    assert.equal(await store.get('mapping-1', 'target-1'), undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
















test('BaselineStore isolates two targets in the same mapping', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-baseline-same-mapping-targets-'));
  try {
    const store = new BaselineStore(contextAt(root));
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
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


