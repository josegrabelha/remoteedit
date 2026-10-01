import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { loadWithVscode, createConnectionManagerHarness } from '../helpers/ConnectionManagerHarness';
import type { WorkspaceSyncRemoteSession, WorkspaceSyncRemoteEntry } from '../../workspaceSync/connection/WorkspaceSyncSession';
import { createWorkspaceMapping } from '../../workspaceSync/mapping/WorkspaceMapping';
import { WORKSPACE_SYNC_MAPPINGS_KEY } from '../../workspaceSync/mapping/WorkspaceMappingStore';

const { WorkspaceSyncController } = loadWithVscode(() => require('../../workspaceSync/WorkspaceSyncController') as typeof import('../../workspaceSync/WorkspaceSyncController'));
const { RemoteWorkspaceWatcher } = loadWithVscode(() => require('../../workspaceSync/watcher/RemoteWorkspaceWatcher') as typeof import('../../workspaceSync/watcher/RemoteWorkspaceWatcher'));
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

class DiskSession implements WorkspaceSyncRemoteSession {
  readonly connectionType = 'sftp' as const;
  readonly capabilities = { reliableMtime: true, caseSensitive: true, filenameStyle: 'posix' as const, maxConcurrentMetadata: 4, maxConcurrentTransfers: 2 };
  readonly profileId = 'fixture';
  readonly connectionIdentity: string;
  failures = new Set<string>();
  constructor(readonly root: string) { this.connectionIdentity = root; }
  async list(remotePath: string): Promise<WorkspaceSyncRemoteEntry[]> {
    return Promise.all((await fs.readdir(remotePath)).map(async name => (await this.stat(path.join(remotePath, name)))!));
  }
  async stat(remotePath: string): Promise<WorkspaceSyncRemoteEntry | undefined> {
    try {
      const stat = await fs.lstat(remotePath);
      return { name: path.basename(remotePath), kind: stat.isDirectory() ? 'directory' : 'file', size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  async ensureDirectory(remotePath: string) { await fs.mkdir(remotePath, { recursive: true }); }
  async upload(localPath: string, remotePath: string) { await fs.copyFile(localPath, remotePath); }
  async download(remotePath: string, localPath: string) {
    if (this.failures.has(remotePath)) throw new Error('Injected file operation failure');
    await fs.copyFile(remotePath, localPath);
  }
  async hashFile(remotePath: string) { return crypto.createHash('sha256').update(await fs.readFile(remotePath)).digest('hex'); }
  async deleteFile(remotePath: string) {
    if (this.failures.has(remotePath)) throw new Error('Injected file operation failure');
    await fs.rm(remotePath, { force: true });
  }
  async deleteDirectory(remotePath: string) { await fs.rmdir(remotePath); }
  async replaceFile(from: string, to: string) { await fs.rename(from, to); }
  async reconnect() {}
  async disconnect() {}
}

async function fixture(t: import('node:test').TestContext, mappingCount = 1, targetCount = 1) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'watch-recovery-'));
  const localRoot = path.join(root, 'local');
  await fs.mkdir(localRoot);
  const base = createConnectionManagerHarness();
  Object.assign(base.context, { globalStorageUri: { fsPath: path.join(root, 'storage') } });
  const mappings = Array.from({ length: mappingCount }, (_, m) => createWorkspaceMapping({
    id: `m${m}`, name: `Mapping ${m}`, localRoot,
    targets: Array.from({ length: targetCount }, (_, n) => ({ id: `t${n}`, name: `Target ${n}`, connectionId: `c${m}-${n}`, remoteRoot: path.join(root, `remote-${m}-${n}`), enabled: true })),
    options: { direction: 'bidirectional', watchLocalChanges: true, watchRemoteChanges: true, propagateDeletes: true, conflictProtection: true, ignorePatterns: ['*.ignored'] }
  }));
  base.state.set(WORKSPACE_SYNC_MAPPINGS_KEY, mappings);
  const controller = new WorkspaceSyncController(base.context, base.manager, base.output);
  const internal = controller as any;
  const sessions = new Map<string, DiskSession>();
  for (const mapping of mappings) for (const target of mapping.targets) {
    await fs.mkdir(target.remoteRoot);
    sessions.set(`mapping:${mapping.id}:target:${target.id}`, new DiskSession(target.remoteRoot));
  }
  controller.sessions.getSession = key => sessions.get(key);
  controller.sessions.getState = key => ({ sessionKey: key, profileId: 'fixture', status: sessions.has(key) ? 'connected' : 'disconnected' });
  // Native watcher delivery is simulated explicitly; classifier, queue, locks,
  // scanner, planner, executor, baseline and Activity are the production code.
  internal.watcher.refresh = () => {};
  internal.remoteWatcher.refresh = () => {};
  t.after(async () => {
    controller.dispose();
    await settle();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
  });
  async function seed(relativePath: string, content: string) {
    for (const dir of [localRoot, ...[...sessions.values()].map(session => session.root)]) {
      await fs.mkdir(path.dirname(path.join(dir, relativePath)), { recursive: true });
      await fs.writeFile(path.join(dir, relativePath), content);
      await fs.utimes(path.join(dir, relativePath), 1000000, 1000000);
    }
  }
  async function compare() { for (const mapping of mappings) for (const target of mapping.targets) await controller.compare(mapping.id, target.id); }
  async function change(relativePath: string, kind = 'delete') {
    await Promise.all(mappings.map(mapping => internal.handleWatchedChange({ mappingId: mapping.id, relativePath, physicalRelativePath: relativePath, absolutePath: path.join(localRoot, relativePath), source: 'watcher', kind })));
  }
  return { ...base, controller, internal, mappings, sessions, localRoot, seed, compare, change };
}

test('a busy polling target does not stall other targets or later polling rounds', async () => {
  const mapping = createWorkspaceMapping({ name: 'Watch', localRoot: '/local', targets: ['one', 'two'].map(id => ({ id, name: id, connectionId: id, remoteRoot: '/remote', enabled: true })), options: { watchRemoteChanges: true } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const watcher = new RemoteWorkspaceWatcher(async request => { calls.push(request.targetId); if (request.targetId === 'one') await gate; }, { appendLine() {} } as any);
  try {
    watcher.refresh([mapping]);
    void (watcher as any).tick();
    await settle();
    void (watcher as any).tick();
    await settle();
    assert.equal(calls.filter(id => id === 'one').length, 1, 'at most one pending poll per target');
    assert.equal(calls.filter(id => id === 'two').length, 2, 'healthy target keeps polling');
  } finally { watcher.dispose(); release(); await settle(); }
});



test('Remote Watch does not interpret a newly ignored file as a remote deletion', async t => {
  const h = await fixture(t);
  await h.seed('keep.txt', 'original');
  await h.compare();
  const mapping = h.mappings[0];
  mapping.options.ignorePatterns.push('keep.txt');
  mapping.updatedAt++;
  h.state.set(WORKSPACE_SYNC_MAPPINGS_KEY, h.mappings);
  await h.internal.pollRemoteChanges(mapping.id, mapping.targets[0].id);
  assert.equal(await fs.readFile(path.join(h.localRoot, 'keep.txt'), 'utf8'), 'original');
});





test('failed Remote Watch download is retried even without another remote edit', async t => {
  const h = await fixture(t);
  await h.seed('edit.txt', 'before');
  await h.compare();
  const session = [...h.sessions.values()][0];
  const remotePath = path.join(session.root, 'edit.txt');
  session.failures.add(remotePath);
  await fs.writeFile(remotePath, 'after edit');
  await h.internal.pollRemoteChanges(h.mappings[0].id, h.mappings[0].targets[0].id);
  assert.equal(await fs.readFile(path.join(h.localRoot, 'edit.txt'), 'utf8'), 'before');
  session.failures.clear();
  await h.internal.pollRemoteChanges(h.mappings[0].id, h.mappings[0].targets[0].id);
  assert.equal(await fs.readFile(path.join(h.localRoot, 'edit.txt'), 'utf8'), 'after edit');
});

test('vanished unbaselined Remote candidate does not poison later create/delete propagation', async t => {
  const h = await fixture(t);
  await h.compare();
  const mapping = h.mappings[0];
  const target = mapping.targets[0];
  const session = [...h.sessions.values()][0];
  const key = `${mapping.id}::${target.id}`;

  // Simulate a transient Remote file that was present in the previous polling
  // snapshot but disappeared before it ever established a trusted baseline. A
  // second, real Remote create in the same batch must still be executed.
  h.internal.remoteWatchSnapshots.set(key, {
    snapshot: {
      capturedAt: Date.now() - 1,
      incompletePaths: [],
      entries: {
        'z-ghost.txt': {
          relativePath: 'z-ghost.txt',
          physicalRelativePath: 'z-ghost.txt',
          fingerprint: { kind: 'file', size: 1, mtimeMs: 1 }
        }
      }
    },
    connectionIdentity: session.connectionIdentity,
    mappingUpdatedAt: mapping.updatedAt,
    targetUpdatedAt: target.updatedAt
  });

  await fs.writeFile(path.join(session.root, 'a-new.txt'), 'remote create');
  await h.internal.pollRemoteChanges(mapping.id, target.id);

  assert.equal(
    await fs.readFile(path.join(h.localRoot, 'a-new.txt'), 'utf8'),
    'remote create',
    'a vanished transient candidate must not abort a valid Remote create in the same poll'
  );
  assert.equal(
    h.internal.runtimeByTarget.get(key)?.diffs.some((diff: { relativePath: string }) => diff.relativePath === 'z-ghost.txt'),
    false,
    'the vanished transient candidate must not remain stuck in Changes'
  );

  await fs.rm(path.join(session.root, 'a-new.txt'));
  await h.internal.pollRemoteChanges(mapping.id, target.id);
  assert.equal(
    await session.stat(path.join(h.localRoot, 'a-new.txt')),
    undefined,
    'Remote Watch must keep polling and propagate a later Remote delete'
  );
});



test('failed Local upload whose source disappears is retried as a delete and Watch continues', async t => {
  const h = await fixture(t);
  await h.seed('race.txt', 'before');
  await h.compare();
  const mapping = h.mappings[0];
  const target = mapping.targets[0];
  const session = [...h.sessions.values()][0];
  const remotePath = path.join(session.root, 'race.txt');
  const originalUpload = session.upload.bind(session);
  let removeBeforeUpload = true;
  session.upload = async (localPath: string, destination: string) => {
    if (removeBeforeUpload && path.basename(localPath) === 'race.txt') {
      removeBeforeUpload = false;
      await fs.rm(localPath);
    }
    await originalUpload(localPath, destination);
  };

  await fs.writeFile(path.join(h.localRoot, 'race.txt'), 'after local edit');
  await h.change('race.txt', 'change');
  assert.ok(await session.stat(remotePath), 'The failed upload must leave the old Remote file in place');
  assert.equal(h.internal.localWatchRetries.entries.size, 1, 'The failed upload must schedule a Local Watch retry');

  await h.internal.localWatchRetries.runDue(Date.now() + 120000);
  assert.equal(await session.stat(remotePath), undefined, 'The retry must reclassify the vanished Local source as a delete');
  assert.equal(h.internal.localWatchRetries.entries.size, 0);

  await fs.writeFile(path.join(h.localRoot, 'later.txt'), 'later local');
  await h.change('later.txt', 'create');
  assert.equal(await fs.readFile(path.join(session.root, 'later.txt'), 'utf8'), 'later local', 'Local Watch must keep working after the failed upload');

  await fs.writeFile(path.join(session.root, 'later.txt'), 'later remote edit');
  await h.internal.pollRemoteChanges(mapping.id, target.id);
  assert.equal(await fs.readFile(path.join(h.localRoot, 'later.txt'), 'utf8'), 'later remote edit', 'Remote Watch must keep working after the failed upload');
});

test('Local delete retry reclassifies a conflicting remote edit and preserves it', async t => {
  const h = await fixture(t);
  await h.seed('keep.txt', 'original');
  await h.compare();
  const session = [...h.sessions.values()][0];
  const remotePath = path.join(session.root, 'keep.txt');
  session.failures.add(remotePath);
  await fs.rm(path.join(h.localRoot, 'keep.txt'));
  await h.change('keep.txt');
  session.failures.clear();
  await fs.writeFile(remotePath, 'concurrent remote edit');
  await h.internal.localWatchRetries.runDue(Date.now() + 120000);
  assert.equal(await fs.readFile(remotePath, 'utf8'), 'concurrent remote edit');
  assert.equal(h.internal.localWatchRetries.entries.size, 0, 'a real conflict is surfaced, not retried indefinitely');
});

test('pending Local Watch retries cannot cross a Disconnect/reconnect boundary', async t => {
  const h = await fixture(t);
  await h.seed('keep.txt', 'original');
  await h.compare();
  const [key, session] = [...h.sessions][0];
  const remotePath = path.join(session.root, 'keep.txt');
  session.failures.add(remotePath);
  await fs.rm(path.join(h.localRoot, 'keep.txt'));
  await h.change('keep.txt');
  assert.equal(h.internal.localWatchRetries.entries.size, 1);
  h.sessions.set(key, new DiskSession(session.root));
  await h.internal.localWatchRetries.runDue(Date.now() + 120000);
  assert.equal(await fs.readFile(remotePath, 'utf8'), 'original');
  assert.equal(h.internal.localWatchRetries.entries.size, 0);
});

test('Activity rollover does not stop mass deletion or subsequent Local and Remote Watch work', { timeout: 60000 }, async t => {
  const h = await fixture(t, 2, 2);
  const paths = Array.from({ length: 1001 }, (_, index) => `file-${index}.txt`);
  for (let offset = 0; offset < paths.length; offset += 20) await Promise.all(paths.slice(offset, offset + 20).map(name => h.seed(name, name)));
  await h.compare();
  await Promise.all(paths.map(name => fs.rm(path.join(h.localRoot, name))));
  await Promise.all(paths.map(name => h.change(name)));
  for (const session of h.sessions.values()) assert.deepEqual(await fs.readdir(session.root), []);
  assert.equal(h.controller.ui.snapshot().length, 1000);
  await fs.writeFile(path.join(h.localRoot, 'later.txt'), 'later local');
  await h.change('later.txt', 'create');
  for (const session of h.sessions.values()) assert.equal(await fs.readFile(path.join(session.root, 'later.txt'), 'utf8'), 'later local');
  const session = [...h.sessions.values()][0];
  await fs.writeFile(path.join(session.root, 'later.txt'), 'later remote edit');
  await h.internal.pollRemoteChanges(h.mappings[0].id, h.mappings[0].targets[0].id);
  assert.equal(await fs.readFile(path.join(h.localRoot, 'later.txt'), 'utf8'), 'later remote edit');
});


