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


