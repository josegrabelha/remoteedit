import { WorkspaceSyncUi } from '../../workspaceSync/ui/WorkspaceSyncUi';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConnectionProfile } from '../../connection/ConnectionManager';
import type { WorkspaceSyncRemoteSession } from '../../workspaceSync/connection/WorkspaceSyncSession';
import type { WorkspaceSyncConnectionSnapshot } from '../../workspaceSync/connection/WorkspaceSyncConnectionSnapshot';
import type { WorkspaceSyncSessionFactory } from '../../workspaceSync/connection/WorkspaceSyncSessionManager';
import { inputUi, loadWithVscode, profile } from '../helpers/ConnectionManagerHarness';
import { WorkspaceSyncPassphraseRequiredError } from '../../workspaceSync/connection/WorkspaceSyncConnectionErrors';

const { WorkspaceSyncSessionManager } = loadWithVscode(() =>
  require('../../workspaceSync/connection/WorkspaceSyncSessionManager') as typeof import('../../workspaceSync/connection/WorkspaceSyncSessionManager')
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function configSource(initialProfiles: ConnectionProfile[]) {
  let profiles = structuredClone(initialProfiles);
  const credentials = new Map<string, { password?: string; passphrase?: string }>();
  for (const item of profiles) credentials.set(item.id, { password: `${item.id}-secret` });
  return {
    source: {
      listProfiles: async () => structuredClone(profiles),
      getProfileCredentials: async (id: string) => ({ ...(credentials.get(id) || {}) })
    },
    replaceProfile(id: string, changes: Partial<ConnectionProfile>) {
      profiles = profiles.map(item => item.id === id ? { ...item, ...changes } : item);
    }
  };
}

function fakeSession(snapshot: WorkspaceSyncConnectionSnapshot) {
  let disconnects = 0;
  const session: WorkspaceSyncRemoteSession = {
    profileId: snapshot.profileId,
    connectionIdentity: snapshot.connectionIdentity,
    connectionType: snapshot.connectionType,
    capabilities: { reliableMtime: true, caseSensitive: true, filenameStyle: 'posix', maxConcurrentMetadata: 1, maxConcurrentTransfers: 1 },
    list: async () => [],
    stat: async () => undefined,
    ensureDirectory: async () => undefined,
    upload: async () => undefined,
    download: async () => undefined,
    hashFile: async () => '',
    deleteFile: async () => undefined,
    deleteDirectory: async () => undefined,
    replaceFile: async () => undefined,
    reconnect: async () => undefined,
    disconnect: async () => { disconnects += 1; }
  };
  return { session, get disconnects() { return disconnects; } };
}

const output = { appendLine() {} } as any;

async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

test('WorkspaceSyncSessionManager keeps runtime state private and disconnects its own session', async () => {
  const config = configSource([profile('prod')]);
  const opened: ReturnType<typeof fakeSession>[] = [];
  const factory: WorkspaceSyncSessionFactory = {
    connect: async snapshot => {
      const created = fakeSession(snapshot);
      opened.push(created);
      return created.session;
    }
  };
  const manager = new WorkspaceSyncSessionManager(config.source, output, factory);

  const session = await manager.connect('mapping:target', 'prod');
  assert.equal(manager.getState('mapping:target').status, 'connected');
  assert.equal(manager.getState('mapping:target').profileUpdatedAt, 1);
  assert.equal(manager.getSession('mapping:target'), session);
  assert.equal(opened.length, 1);

  await manager.disconnect('mapping:target');
  assert.equal(manager.getState('mapping:target').status, 'disconnected');
  assert.equal(manager.getSession('mapping:target'), undefined);
  assert.equal(opened[0].disconnects, 1);
  manager.dispose();
});

test('WorkspaceSyncSessionManager closes a late session when Disconnect wins a pending Connect race', async () => {
  const config = configSource([profile('prod')]);
  const gate = deferred<WorkspaceSyncRemoteSession>();
  let created: ReturnType<typeof fakeSession> | undefined;
  const factory: WorkspaceSyncSessionFactory = {
    connect: async snapshot => {
      created = fakeSession(snapshot);
      return gate.promise;
    }
  };
  const manager = new WorkspaceSyncSessionManager(config.source, output, factory);

  const connecting = manager.connect('mapping:target', 'prod');
  await settle();
  assert.equal(manager.getState('mapping:target').status, 'connecting');
  await manager.disconnect('mapping:target');
  assert.equal(manager.getState('mapping:target').status, 'disconnected');

  assert.ok(created);
  gate.resolve(created!.session);
  await assert.rejects(connecting, /cancelled/i);
  assert.equal(created!.disconnects, 1);
  assert.equal(manager.getState('mapping:target').status, 'disconnected');
  assert.equal(manager.getSession('mapping:target'), undefined);
  manager.dispose();
});

test('WorkspaceSyncSessionManager prevents an older Connect from overwriting a newer profile session', async () => {
  const config = configSource([profile('old'), profile('new')]);
  const oldGate = deferred<WorkspaceSyncRemoteSession>();
  let oldCreated: ReturnType<typeof fakeSession> | undefined;
  const openedProfiles: string[] = [];
  const factory: WorkspaceSyncSessionFactory = {
    connect: async snapshot => {
      openedProfiles.push(snapshot.profileId);
      const created = fakeSession(snapshot);
      if (snapshot.profileId === 'old') {
        oldCreated = created;
        return oldGate.promise;
      }
      return created.session;
    }
  };
  const manager = new WorkspaceSyncSessionManager(config.source, output, factory);

  const oldConnect = manager.connect('mapping:target', 'old');
  await settle();
  const newSession = await manager.connect('mapping:target', 'new');
  assert.equal(newSession.profileId, 'new');
  assert.equal(manager.getState('mapping:target').profileId, 'new');

  oldGate.resolve(oldCreated!.session);
  await assert.rejects(oldConnect, /cancelled/i);
  assert.equal(oldCreated!.disconnects, 1);
  assert.equal(manager.getSession('mapping:target'), newSession);
  assert.deepEqual(openedProfiles, ['old', 'new']);
  manager.dispose();
});














test('Disconnect releases a pending Connect that never receives a transport callback', { timeout: 1000 }, async () => {
  const config = configSource([profile('prod')]);
  let signal: AbortSignal | undefined;
  const manager = new WorkspaceSyncSessionManager(config.source, output, {
    connect: async (_snapshot, _diagnostics, abort) => {
      signal = abort;
      return new Promise(() => {});
    }
  });
  const connecting = manager.connect('mapping:target', 'prod');
  const cancelled = assert.rejects(connecting, /cancelled/i);
  await settle();
  await manager.disconnect('mapping:target');
  await cancelled;
  assert.equal(signal?.aborted, true);
  assert.equal(manager.getState('mapping:target').status, 'disconnected');
  manager.dispose();
});



test('simultaneous Connect calls for the same target share one handshake', async () => {
  const config = configSource([profile('prod')]);
  let opened = 0;
  const manager = new WorkspaceSyncSessionManager(config.source, output, {
    connect: async snapshot => { opened += 1; return fakeSession(snapshot).session; }
  });
  try {
    const results = await Promise.allSettled([
      manager.connect('mapping:target', 'prod'),
      manager.connect('mapping:target', 'prod')
    ]);
    assert.ok(results.every(result => result.status === 'fulfilled'));
    assert.equal(opened, 1);
    if (results[0].status === 'fulfilled' && results[1].status === 'fulfilled') {
      assert.equal(results[0].value, results[1].value);
    }
  } finally { manager.dispose(); }
});
