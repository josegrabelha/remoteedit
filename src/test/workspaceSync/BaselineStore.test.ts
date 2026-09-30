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

test('BaselineStore removes a path completely when neither side remains', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-baseline-delete-'));
  try {
    const store = new BaselineStore(contextAt(root));
    await store.ensureContext('mapping-1', 'target-1', baselineContext);
    await store.set(baseline());
    await store.updatePath('mapping-1', 'target-1', 'src/app.ts');

    const current = await store.get('mapping-1', 'target-1');
    assert.ok(current);
    assert.equal(current.entries['src/app.ts'], undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('BaselineStore clears a baseline when the resolved connection endpoint identity changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-baseline-identity-'));
  try {
    const store = new BaselineStore(contextAt(root));
    await store.ensureContext('mapping-1', 'target-1', baselineContext);
    await store.set(baseline());

    const changed = await store.ensureContext('mapping-1', 'target-1', {
      ...baselineContext,
      connectionIdentity: 'endpoint-b'
    });

    assert.equal(changed, true);
    assert.equal(await store.get('mapping-1', 'target-1'), undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('WorkspaceSyncLastKnownViewStore persists the last file list outside configuration storage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-last-view-'));
  try {
    const mapping: any = { id: 'mapping-1', localRoot: '/local/project' };
    const target: any = { id: 'target-1', connectionId: 'connection-1', remoteRoot: '/remote/project' };
    const diffs: any[] = [{ relativePath: 'src/app.ts', status: 'localChanged', local: { kind: 'file', size: 10, mtimeMs: 100 } }];
    const first = new WorkspaceSyncLastKnownViewStore(contextAt(root));
    await first.set(mapping, target, diffs, 1234);

    const second = new WorkspaceSyncLastKnownViewStore(contextAt(root));
    assert.deepEqual(await second.get(mapping, target), {
      localRoot: '/local/project',
      connectionId: 'connection-1',
      remoteRoot: '/remote/project',
      diffs,
      lastRefreshedAt: 1234
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('WorkspaceSyncLastKnownViewStore refuses a cached list after roots or connection change', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-last-view-context-'));
  try {
    const store = new WorkspaceSyncLastKnownViewStore(contextAt(root));
    const mapping: any = { id: 'mapping-1', localRoot: '/local/project' };
    const target: any = { id: 'target-1', connectionId: 'connection-1', remoteRoot: '/remote/project' };
    await store.set(mapping, target, [{ relativePath: 'a.txt', status: 'same' } as any], 1234);

    assert.equal(await store.get({ ...mapping, localRoot: '/local/other' }, target), undefined);
    assert.equal(await store.get(mapping, { ...target, remoteRoot: '/remote/other' }), undefined);
    assert.equal(await store.get(mapping, { ...target, connectionId: 'connection-2' }), undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('BaselineStore keeps independent history for mappings and targets that share the same roots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-baseline-shared-roots-'));
  try {
    const store = new BaselineStore(contextAt(root));
    const sharedContext = {
      localRoot: '/local/shared',
      remoteRoot: '/remote/shared',
      connectionId: 'connection-shared',
      connectionIdentity: 'endpoint-shared'
    };
    await store.ensureContext('mapping-a', 'target-a', sharedContext);
    await store.ensureContext('mapping-b', 'target-b', sharedContext);
    await store.set({
      mappingId: 'mapping-a',
      targetId: 'target-a',
      capturedAt: 1,
      entries: { 'file.txt': { local: { kind: 'file', size: 1, mtimeMs: 1 }, remote: { kind: 'file', size: 1, mtimeMs: 1 } } }
    });
    await store.set({
      mappingId: 'mapping-b',
      targetId: 'target-b',
      capturedAt: 2,
      entries: { 'file.txt': { local: { kind: 'file', size: 2, mtimeMs: 2 }, remote: { kind: 'file', size: 2, mtimeMs: 2 } } }
    });

    assert.equal((await store.get('mapping-a', 'target-a'))?.entries['file.txt']?.local?.size, 1);
    assert.equal((await store.get('mapping-b', 'target-b'))?.entries['file.txt']?.local?.size, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('BaselineStore clears only the selected mapping target baseline', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-baseline-reset-target-'));
  try {
    const store = new BaselineStore(contextAt(root));
    await store.ensureContext('mapping-1', 'target-a', baselineContext);
    await store.ensureContext('mapping-1', 'target-b', { ...baselineContext, remoteRoot: '/remote/project-b' });
    await store.set(baseline('mapping-1', 'target-a'));
    await store.set({ ...baseline('mapping-1', 'target-b'), capturedAt: 2 });

    await store.clear('mapping-1', 'target-a');

    assert.equal(await store.get('mapping-1', 'target-a'), undefined);
    assert.ok(await store.get('mapping-1', 'target-b'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('BaselineStore canonicalizes legacy Unicode keys and preserves physical side spellings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-baseline-unicode-'));
  try {
    const store = new BaselineStore(contextAt(root));
    await store.ensureContext('mapping-1', 'target-1', baselineContext);
    const nfc = 'folder/çã-special.txt';
    const nfd = nfc.normalize('NFD');
    await store.set({
      mappingId: 'mapping-1',
      targetId: 'target-1',
      capturedAt: 1,
      entries: {
        [nfd]: {
          local: { kind: 'file', size: 1, mtimeMs: 1 },
          remote: { kind: 'file', size: 1, mtimeMs: 1 },
          localRelativePath: nfd,
          remoteRelativePath: nfc
        }
      }
    });

    const current = await store.get('mapping-1', 'target-1');
    assert.ok(current);
    assert.deepEqual(Object.keys(current.entries), [nfc]);
    assert.equal(current.entries[nfc].localRelativePath, nfd);
    assert.equal(current.entries[nfc].remoteRelativePath, nfc);
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

test('WorkspaceSyncLastKnownViewStore isolates two targets in the same mapping', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-last-view-same-mapping-targets-'));
  try {
    const store = new WorkspaceSyncLastKnownViewStore(contextAt(root));
    const mapping: any = { id: 'mapping-1', localRoot: '/local/shared' };
    const targetA: any = { id: 'target-a', connectionId: 'connection-a', remoteRoot: '/remote/a' };
    const targetB: any = { id: 'target-b', connectionId: 'connection-b', remoteRoot: '/remote/b' };
    await store.set(mapping, targetA, [{ relativePath: 'a.txt', status: 'localChanged' } as any], 100);
    await store.set(mapping, targetB, [{ relativePath: 'b.txt', status: 'remoteChanged' } as any], 200);

    const viewA = await store.get(mapping, targetA);
    const viewB = await store.get(mapping, targetB);
    assert.equal(viewA?.diffs[0]?.relativePath, 'a.txt');
    assert.equal(viewA?.lastRefreshedAt, 100);
    assert.equal(viewB?.diffs[0]?.relativePath, 'b.txt');
    assert.equal(viewB?.lastRefreshedAt, 200);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
