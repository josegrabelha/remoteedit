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

test('WorkspaceSyncSessionManager snapshots saved config only when creating a new private session', async () => {
  const config = configSource([profile('prod', { host: 'old.example.com' })]);
  const identities: string[] = [];
  const factory: WorkspaceSyncSessionFactory = {
    connect: async snapshot => {
      identities.push(snapshot.connectionIdentity);
      return fakeSession(snapshot).session;
    }
  };
  const manager = new WorkspaceSyncSessionManager(config.source, output, factory);

  const first = await manager.connect('mapping:target', 'prod');
  config.replaceProfile('prod', { host: 'new.example.com' });
  const stillFirst = await manager.connect('mapping:target', 'prod');
  assert.equal(stillFirst, first);
  assert.equal(identities.length, 1);

  await manager.disconnect('mapping:target');
  const second = await manager.connect('mapping:target', 'prod');
  assert.notEqual(second.connectionIdentity, first.connectionIdentity);
  assert.equal(identities.length, 2);
  manager.dispose();
});


test('WorkspaceSyncSessionManager keeps a prompted private-key passphrase runtime-only', async () => {
  const ui = new WorkspaceSyncUi();
  ui.attach((message: any) => {
    if (message.type === 'request') ui.respond(message.request.id, 'runtime-only-passphrase');
  });
  const config = configSource([profile('prod', { authType: 'privateKey', privateKeyPath: '/tmp/key' })]);
  let attempts = 0;
  const factory: WorkspaceSyncSessionFactory = {
    connect: async snapshot => {
      attempts += 1;
      if (attempts === 1) {
        throw new WorkspaceSyncPassphraseRequiredError(snapshot.profileId, snapshot.name, false);
      }
      assert.equal(snapshot.passphrase, 'runtime-only-passphrase');
      return fakeSession(snapshot).session;
    }
  };
  // Remove any saved password created by the generic helper; private-key
  // snapshots only read the passphrase slot, which remains empty here.
  const manager = new WorkspaceSyncSessionManager(config.source, output, factory, ui);

  const session = await manager.connect('mapping:target', 'prod');

  assert.equal(session.profileId, 'prod');
  assert.equal(attempts, 2);
  assert.equal(manager.getState('mapping:target').status, 'connected');
  manager.dispose();
});


test('WorkspaceSyncSessionManager closes a connected session when target preparation fails', async () => {
  const config = configSource([profile('prod')]);
  let created: ReturnType<typeof fakeSession> | undefined;
  const factory: WorkspaceSyncSessionFactory = {
    connect: async snapshot => {
      created = fakeSession(snapshot);
      return created.session;
    }
  };
  const manager = new WorkspaceSyncSessionManager(config.source, output, factory);

  const session = await manager.connect('mapping:target', 'prod');
  await manager.failConnectedSession('mapping:target', session, new Error('501 No such directory'));

  assert.ok(created);
  assert.equal(created!.disconnects, 1);
  assert.equal(manager.getSession('mapping:target'), undefined);
  assert.equal(manager.getState('mapping:target').status, 'error');
  assert.match(manager.getState('mapping:target').message || '', /501 No such directory/);
  manager.dispose();
});

test('WorkspaceSyncSessionManager can cancel preparation without leaving an automatic session connected', async () => {
  const config = configSource([profile('prod')]);
  let created: ReturnType<typeof fakeSession> | undefined;
  const factory: WorkspaceSyncSessionFactory = {
    connect: async snapshot => {
      created = fakeSession(snapshot);
      return created.session;
    }
  };
  const manager = new WorkspaceSyncSessionManager(config.source, output, factory);

  const session = await manager.connect('mapping:target', 'prod');
  await manager.disconnectSessionIfCurrent('mapping:target', session);

  assert.ok(created);
  assert.equal(created!.disconnects, 1);
  assert.equal(manager.getSession('mapping:target'), undefined);
  assert.equal(manager.getState('mapping:target').status, 'disconnected');
  manager.dispose();
});


test('WorkspaceSyncSessionManager Diagnostics ON and OFF preserve the same private-session lifecycle result', async () => {
  async function run(enabled: boolean) {
    inputUi.configuration.clear();
    inputUi.configuration.set('diagnostics.debugLogs', enabled);
    inputUi.configuration.set('diagnostics.performanceLogs', enabled);

    const config = configSource([profile(`diag-${enabled ? 'on' : 'off'}`)]);
    const opened: ReturnType<typeof fakeSession>[] = [];
    const lines: string[] = [];
    const factory: WorkspaceSyncSessionFactory = {
      connect: async snapshot => {
        const created = fakeSession(snapshot);
        opened.push(created);
        return created.session;
      }
    };
    const manager = new WorkspaceSyncSessionManager(
      config.source,
      { appendLine: (line: string) => lines.push(line) } as any,
      factory
    );

    await manager.connect('mapping:target', `diag-${enabled ? 'on' : 'off'}`);
    const connectedStatus = manager.getState('mapping:target').status;
    await manager.disconnect('mapping:target');
    const result = {
      connectedStatus,
      disconnectedStatus: manager.getState('mapping:target').status,
      sessionAfterDisconnect: manager.getSession('mapping:target'),
      disconnects: opened[0].disconnects
    };
    manager.dispose();
    return { result, lines };
  }

  const off = await run(false);
  const on = await run(true);
  assert.deepEqual(on.result, off.result);
  assert.equal(off.lines.some(line => /\[(?:DEBUG|PERF)\]/.test(line)), false);
  assert.equal(on.lines.some(line => /\[DEBUG\]/.test(line)), true);
  assert.equal(on.lines.some(line => /\[PERF\]/.test(line)), true);
});
