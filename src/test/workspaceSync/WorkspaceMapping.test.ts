import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import {
  createWorkspaceMapping,
  normalizeRemoteRoot,
  validateUniqueMappingRoutes,
  validateUniqueTargetDestinations
} from '../../workspaceSync/mapping/WorkspaceMapping';
import { WorkspaceMappingStore } from '../../workspaceSync/mapping/WorkspaceMappingStore';

class FakeMemento {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? this.values.get(key) as T : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }
}

function fakeContext(): any {
  return { globalState: new FakeMemento() };
}

function mappingInput(name = 'Production') {
  return {
    name,
    localRoot: './project',
    targets: [{ name: 'Primary', connectionId: 'conn-1', remoteRoot: '\\var\\www\\app\\' }]
  };
}

test('WorkspaceMapping normalizes roots and applies safe defaults', () => {
  const mapping = createWorkspaceMapping(mappingInput());
  assert.equal(mapping.localRoot, path.resolve('./project'));
  assert.equal(mapping.targets[0].remoteRoot, '/var/www/app');
  assert.equal(mapping.options.direction, 'bidirectional');
  assert.equal(mapping.options.conflictProtection, true);
  assert.equal(mapping.options.atomicTransfer, true);
  assert.equal(mapping.options.propagateDeletes, false);
  assert.equal(mapping.options.uploadOnSave, false);
  assert.equal(mapping.options.watchLocalChanges, false);
  assert.equal(mapping.options.watchRemoteChanges, false);
  assert.deepEqual(mapping.options.ignorePatterns, ['.git/', 'node_modules/']);
});

test('WorkspaceMapping normalizes direction-dependent automatic sync options', () => {
  const localToRemote = createWorkspaceMapping({
    ...mappingInput('Local to Remote'),
    options: {
      direction: 'localToRemote',
      uploadOnSave: true,
      watchLocalChanges: true,
      watchRemoteChanges: true
    }
  });
  assert.equal(localToRemote.options.uploadOnSave, true);
  assert.equal(localToRemote.options.watchLocalChanges, true);
  assert.equal(localToRemote.options.watchRemoteChanges, false);

  const remoteToLocal = createWorkspaceMapping({
    ...mappingInput('Remote to Local'),
    options: {
      direction: 'remoteToLocal',
      uploadOnSave: true,
      watchLocalChanges: true,
      watchRemoteChanges: true
    }
  });
  assert.equal(remoteToLocal.options.uploadOnSave, false);
  assert.equal(remoteToLocal.options.watchLocalChanges, false);
  assert.equal(remoteToLocal.options.watchRemoteChanges, true);

  const bidirectional = createWorkspaceMapping({
    ...mappingInput('Bidirectional'),
    options: {
      direction: 'bidirectional',
      uploadOnSave: true,
      watchLocalChanges: true,
      watchRemoteChanges: true
    }
  });
  assert.equal(bidirectional.options.uploadOnSave, true);
  assert.equal(bidirectional.options.watchLocalChanges, true);
  assert.equal(bidirectional.options.watchRemoteChanges, true);
});

test('WorkspaceMapping rejects duplicate target names case-insensitively', () => {
  assert.throws(() => createWorkspaceMapping({
    name: 'Production',
    localRoot: './project',
    targets: [
      { name: 'Prod', connectionId: 'conn-1', remoteRoot: '/one' },
      { name: 'prod', connectionId: 'conn-2', remoteRoot: '/two' }
    ]
  }), /Duplicate Workspace Sync target name/);
});

test('normalizeRemoteRoot keeps root and removes duplicate/trailing separators', () => {
  assert.equal(normalizeRemoteRoot('/'), '/');
  assert.equal(normalizeRemoteRoot('//var///www/app///'), '/var/www/app');
  assert.equal(normalizeRemoteRoot('C:\\sites\\app\\'), 'C:/sites/app');
});


test('WorkspaceMapping requires an absolute remote root and preserves Windows drive roots', () => {
  assert.equal(normalizeRemoteRoot('C:/'), 'C:/');
  assert.equal(normalizeRemoteRoot('/C:/'), '/C:/');
  assert.throws(() => createWorkspaceMapping({
    name: 'Unsafe',
    localRoot: './project',
    targets: [{ name: 'Primary', connectionId: 'conn-1', remoteRoot: 'relative/path' }]
  }), /Remote root.*must be absolute/i);

  const windows = createWorkspaceMapping({
    name: 'Windows',
    localRoot: './project',
    targets: [{ name: 'Primary', connectionId: 'conn-1', remoteRoot: 'C:/' }]
  });
  assert.equal(windows.targets[0].remoteRoot, 'C:/');
});

test('WorkspaceMappingStore keeps one shared mapping name namespace and active target state', async () => {
  const context = fakeContext();
  const store = new WorkspaceMappingStore(context);
  const first = await store.save(mappingInput('Production'));

  assert.equal(store.getActiveId(), first.id);
  assert.equal(store.getActive()?.name, 'Production');
  assert.equal(store.getActiveTarget(first)?.name, 'Primary');

  await assert.rejects(
    store.save(mappingInput('production')),
    /already exists/
  );

  const stagingInput = mappingInput('Staging');
  stagingInput.targets[0].remoteRoot = '/var/www/staging';
  const second = await store.save(stagingInput);
  assert.equal(store.getActiveId(), second.id);
  await store.delete(second.id);
  assert.equal(store.getActiveId(), first.id);
});

test('WorkspaceMappingStore remembers the active target independently for each mapping', async () => {
  const context = fakeContext();
  const store = new WorkspaceMappingStore(context);
  const first = await store.save({
    name: 'First',
    localRoot: './project-first',
    targets: [
      { name: 'First A', connectionId: 'conn-1', remoteRoot: '/first/a' },
      { name: 'First B', connectionId: 'conn-1', remoteRoot: '/first/b' }
    ]
  });
  const second = await store.save({
    name: 'Second',
    localRoot: './project-second',
    targets: [
      { name: 'Second A', connectionId: 'conn-1', remoteRoot: '/second/a' },
      { name: 'Second B', connectionId: 'conn-1', remoteRoot: '/second/b' }
    ]
  });

  await store.setActiveTargetId(first.id, first.targets[1].id);
  await store.setActiveTargetId(second.id, second.targets[0].id);

  await store.setActiveId(first.id);
  assert.equal(store.getActiveTarget(store.getActive()!)?.id, first.targets[1].id);
  await store.setActiveId(second.id);
  assert.equal(store.getActiveTarget(store.getActive()!)?.id, second.targets[0].id);
  await store.setActiveId(first.id);
  assert.equal(store.getActiveTarget(store.getActive()!)?.id, first.targets[1].id);
});

test('WorkspaceMappingStore preserves target revision for no-op saves and advances it on target changes', async () => {
  const context = fakeContext();
  const store = new WorkspaceMappingStore(context);
  const first = await store.save(mappingInput('Production'));
  const original = first.targets[0];

  const noOp = await store.save({
    id: first.id,
    name: first.name,
    localRoot: first.localRoot,
    targets: first.targets.map(target => ({ ...target })),
    options: first.options
  });
  assert.equal(noOp.targets[0].createdAt, original.createdAt);
  assert.equal(noOp.targets[0].updatedAt, original.updatedAt);

  const changed = await store.save({
    id: noOp.id,
    name: noOp.name,
    localRoot: noOp.localRoot,
    targets: noOp.targets.map(target => ({ ...target, remoteRoot: '/var/www/new-root' })),
    options: noOp.options
  });
  assert.equal(changed.targets[0].createdAt, original.createdAt);
  assert.ok(changed.targets[0].updatedAt > original.updatedAt);
  assert.equal(changed.targets[0].remoteRoot, '/var/www/new-root');
});

test('WorkspaceMappingStore persists mappings globally across extension restarts', async () => {
  const globalState = new FakeMemento();
  const firstContext = { globalState } as any;
  const firstStore = new WorkspaceMappingStore(firstContext);
  const saved = await firstStore.save(mappingInput('Persistent'));

  const restartedContext = { globalState } as any;
  const restartedStore = new WorkspaceMappingStore(restartedContext);
  assert.equal(restartedStore.get(saved.id)?.name, 'Persistent');
  assert.equal(restartedStore.getActiveId(), saved.id);
  assert.equal(restartedStore.getActiveTargetId(saved.id), saved.targets[0].id);
});


test('WorkspaceMapping rejects duplicate target identities while legacy duplicate destinations remain loadable', () => {
  assert.throws(() => createWorkspaceMapping({
    name: 'Duplicate IDs',
    localRoot: './project',
    targets: [
      { id: 'target-same', name: 'One', connectionId: 'conn-1', remoteRoot: '/one' },
      { id: 'target-same', name: 'Two', connectionId: 'conn-2', remoteRoot: '/two' }
    ]
  }), /Duplicate Workspace Sync target id/);

  const mapping = createWorkspaceMapping({
    name: 'Duplicate Destination',
    localRoot: './project',
    targets: [
      { name: 'One', connectionId: 'conn-1', remoteRoot: '/same/' },
      { name: 'Two', connectionId: 'conn-1', remoteRoot: '/same' }
    ]
  });
  assert.equal(mapping.targets.length, 2);
  assert.notEqual(mapping.targets[0].id, mapping.targets[1].id);
  assert.equal(mapping.targets[0].remoteRoot, '/same');
  assert.equal(mapping.targets[1].remoteRoot, '/same');
});

test('Workspace Sync rejects duplicate remote destinations on mutation paths after normalization', () => {
  assert.throws(() => validateUniqueTargetDestinations([
    { name: 'T1', connectionId: 'conn-1', remoteRoot: '/var/www/app/' },
    { name: 'T2', connectionId: 'conn-1', remoteRoot: '\\var\\www\\app' }
  ]), /same Connection and Remote Directory/);

  assert.doesNotThrow(() => validateUniqueTargetDestinations([
    { name: 'T1', connectionId: 'conn-1', remoteRoot: '/var/www/app/' },
    { name: 'T2', connectionId: 'conn-2', remoteRoot: '/var/www/app' }
  ]));
});

test('WorkspaceMappingStore rejects duplicate destinations on save but can still load a legacy duplicate mapping', async () => {
  const context = fakeContext();
  const store = new WorkspaceMappingStore(context);
  await assert.rejects(() => store.save({
    name: 'Duplicate Destination',
    localRoot: './project',
    targets: [
      { name: 'T1', connectionId: 'conn-1', remoteRoot: '/same/' },
      { name: 'T2', connectionId: 'conn-1', remoteRoot: '/same' }
    ]
  }), /same Connection and Remote Directory/);

  const legacy = createWorkspaceMapping({
    id: 'legacy-duplicate',
    name: 'Legacy Duplicate',
    localRoot: './project',
    targets: [
      { id: 'target-1', name: 'T1', connectionId: 'conn-1', remoteRoot: '/same/' },
      { id: 'target-2', name: 'T2', connectionId: 'conn-1', remoteRoot: '/same' }
    ]
  });
  await context.globalState.update('remoteedit.workspaceSync.mappings.v1', [legacy]);
  assert.equal(store.list()[0]?.targets.length, 2);
});

test('WorkspaceMappingStore moves the active target to an enabled target when the current target is disabled', async () => {
  const context = fakeContext();
  const store = new WorkspaceMappingStore(context);
  const saved = await store.save({
    name: 'Multi Target',
    localRoot: './project',
    targets: [
      { name: 'T1', connectionId: 'conn-1', remoteRoot: '/one', enabled: true },
      { name: 'T2', connectionId: 'conn-2', remoteRoot: '/two', enabled: true }
    ]
  });

  const firstTargetId = saved.targets[0].id;
  const secondTargetId = saved.targets[1].id;
  await store.setActiveTargetId(saved.id, firstTargetId);
  assert.equal(store.getActiveTargetId(saved.id), firstTargetId);

  const updated = await store.save({
    id: saved.id,
    name: saved.name,
    localRoot: saved.localRoot,
    targets: saved.targets.map(target => ({
      ...target,
      enabled: target.id !== firstTargetId
    })),
    options: saved.options
  });

  assert.equal(updated.targets.find(target => target.id === firstTargetId)?.enabled, false);
  assert.equal(updated.targets.find(target => target.id === secondTargetId)?.enabled, true);
  assert.equal(store.getActiveTargetId(saved.id), secondTargetId);
  assert.equal(store.getActiveTarget(updated)?.id, secondTargetId);
});


test('Workspace Sync rejects duplicate complete routes across different mappings', () => {
  assert.throws(() => validateUniqueMappingRoutes([
    {
      id: 'mapping-a',
      name: 'Mapping A',
      localRoot: './project/',
      targets: [{ name: 'T1', connectionId: 'conn-1', remoteRoot: '/var/www/app/' }]
    },
    {
      id: 'mapping-b',
      name: 'Mapping B',
      localRoot: path.join('.', 'project'),
      targets: [{ name: 'T2', connectionId: 'conn-1', remoteRoot: '\\var\\www\\app' }]
    }
  ]), /same Local Root, Connection, and Remote Directory/);

  assert.doesNotThrow(() => validateUniqueMappingRoutes([
    {
      id: 'mapping-a',
      name: 'Mapping A',
      localRoot: './project',
      targets: [{ name: 'T1', connectionId: 'conn-1', remoteRoot: '/var/www/app' }]
    },
    {
      id: 'mapping-b',
      name: 'Mapping B',
      localRoot: './project',
      targets: [{ name: 'T2', connectionId: 'conn-1', remoteRoot: '/var/www/other' }]
    },
    {
      id: 'mapping-c',
      name: 'Mapping C',
      localRoot: './other-project',
      targets: [{ name: 'T3', connectionId: 'conn-1', remoteRoot: '/var/www/app' }]
    }
  ]));
});

test('WorkspaceMappingStore rejects a route already owned by another mapping', async () => {
  const context = fakeContext();
  const store = new WorkspaceMappingStore(context);
  await store.save({
    name: 'Mapping A',
    localRoot: './project',
    targets: [{ name: 'T1', connectionId: 'conn-1', remoteRoot: '/same' }]
  });

  await assert.rejects(() => store.save({
    name: 'Mapping B',
    localRoot: './project',
    targets: [{ name: 'T2', connectionId: 'conn-1', remoteRoot: '/same/' }]
  }), /same Local Root, Connection, and Remote Directory/);

  await assert.doesNotReject(() => store.save({
    name: 'Mapping C',
    localRoot: './project',
    targets: [{ name: 'T3', connectionId: 'conn-1', remoteRoot: '/different' }]
  }));
});
