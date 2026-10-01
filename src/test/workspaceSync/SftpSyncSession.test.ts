import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import SftpClient from 'ssh2-sftp-client';
import { SftpSyncSession } from '../../workspaceSync/connection/SftpSyncSession';
import { SessionLifetime } from '../../workspaceSync/connection/SessionLifetime';
import { scanRemoteTree } from '../../workspaceSync/scan/RemoteScanner';
import { createSyncSnapshot } from '../../workspaceSync/snapshot/SyncSnapshot';
import { diffSnapshots } from '../../workspaceSync/compare/DiffEngine';
import { buildSyncPlan } from '../../workspaceSync/planning/SyncPlanner';
import { revalidateSyncPlan } from '../../workspaceSync/planning/SyncRevalidator';
import type { WorkspaceSyncMapping, WorkspaceSyncTarget } from '../../workspaceSync/types';

type Entry = { type: '-' | 'd' | 'l' | 's'; size: number; mtime: number };

// Exercise the installed ssh2-sftp-client's real list/lstat conversion. Only
// the underlying SSH channel is simulated, so its boolean FileStats contract
// cannot accidentally be replaced with Node-style methods by the test.
function fixture() {
  const entries = new Map<string, Entry>([
    ['/remote/file.txt', { type: '-', size: 5, mtime: 1000 }],
    ['/remote/nested', { type: 'd', size: 4096, mtime: 1000 }],
    ['/remote/nested/child.txt', { type: '-', size: 8, mtime: 1000 }],
    ['/remote/link', { type: 'l', size: 6, mtime: 1000 }],
    ['/remote/socket', { type: 's', size: 0, mtime: 1000 }]
  ]);
  const attrs = (entry: Entry) => ({
    size: entry.size, mtime: entry.mtime, atime: entry.mtime, uid: 1000, gid: 1000, mode: 0,
    isFile: () => entry.type === '-', isDirectory: () => entry.type === 'd',
    isSymbolicLink: () => entry.type === 'l', isSocket: () => entry.type === 's',
    isBlockDevice: () => false, isCharacterDevice: () => false, isFIFO: () => false
  });
  const client = new SftpClient();
  (client as any).sftp = {
    lstat(remotePath: string, callback: Function) {
      const entry = entries.get(remotePath);
      if (entry) callback(null, attrs(entry));
      else callback(Object.assign(new Error('No such file'), { code: 2 }));
    },
    readdir(remotePath: string, callback: Function) {
      callback(null, [...entries].filter(([name]) => path.posix.dirname(name) === remotePath).map(([name, entry]) => ({
        filename: path.posix.basename(name), longname: `${entry.type}rwxr-xr-x`, attrs: attrs(entry)
      })));
    }
  };
  const session = Reflect.construct(SftpSyncSession, ['connection-1', {}]) as SftpSyncSession;
  (session as any).client = client;
  return { session, entries };
}

test('SFTP idle deadline closes a stuck transport, settles sibling requests and recovers on the next request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { session } = fixture();
  const internal = session as any;
  let destroyed = 0;
  let reconnects = 0;
  internal.client = {
    list: () => new Promise(() => {}),
    lstat: () => new Promise(() => {}),
    client: { destroy: () => { destroyed++; } }
  };
  internal.openFreshConnection = async () => {
    reconnects++;
    internal.client = { list: async () => [] };
    internal.transportLifetime = new SessionLifetime();
  };
  const pending = [assert.rejects(session.list('/remote'), /timed out/), assert.rejects(session.stat('/remote/file'), /timed out/)];
  await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(30001);
  await Promise.all(pending);
  assert.equal(destroyed, 1);
  assert.equal(session.isDisconnected, false, 'timeout invalidates a transport, not the user session');
  assert.deepEqual(await session.list('/remote'), []);
  assert.equal(reconnects, 1);
});





test('SFTP reconnect setup cannot leave the next Watch round waiting forever', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { session } = fixture();
  const internal = session as any;
  let destroyed = false;
  internal.openFreshConnection = async () => {
    internal.openingClient = { client: { destroy: () => { destroyed = true; } } };
    return new Promise(() => {});
  };
  const rejected = assert.rejects(session.reconnect(), /setup timed out/);
  await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(60001);
  await rejected;
  assert.equal(destroyed, true);
  assert.equal(internal.reconnectPromise, undefined);
  internal.openFreshConnection = async () => {};
  await session.reconnect();
});

const target: WorkspaceSyncTarget = {
  id: 'target-1', name: 'Target', connectionId: 'connection-1', remoteRoot: '/remote', enabled: true, createdAt: 1, updatedAt: 1
};
function mapping(localRoot: string): WorkspaceSyncMapping {
  return {
    id: 'mapping-1', name: 'Mapping', localRoot, targets: [target], createdAt: 1, updatedAt: 1,
    options: { direction: 'bidirectional', uploadOnSave: false, watchLocalChanges: false, watchRemoteChanges: false, conflictProtection: true, atomicTransfer: true, propagateDeletes: false, ignorePatterns: [] }
  };
}



test('SFTP Compare plan revalidates unchanged root and nested files and detects a real change', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-sftp-revalidate-'));
  try {
    const { session, entries } = fixture();
    const remote = await scanRemoteTree(session, target.remoteRoot);
    const diffs = diffSnapshots(createSyncSnapshot([]), remote);
    const plan = buildSyncPlan('mapping-1', target.id, diffs, mapping(root).options);
    assert.equal(plan.operations.filter(op => op.type === 'download').length, 2);
    assert.equal(plan.operations.filter(op => op.type === 'createLocalDirectory').length, 1);
    const unchanged = await revalidateSyncPlan(mapping(root), target, plan, session);
    assert.deepEqual(unchanged.stale, []);
    assert.equal(unchanged.valid.length, plan.operations.length);

    entries.get('/remote/nested/child.txt')!.size += 1;
    const changed = await revalidateSyncPlan(mapping(root), target, plan, session);
    assert.deepEqual(changed.stale.map(item => item.operation.relativePath), ['nested/child.txt']);
    assert.match(changed.stale[0].reason, /Remote state changed/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('SFTP revalidation blocks a directory replaced by a symbolic link after Compare', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-sftp-symlink-'));
  try {
    const { session, entries } = fixture();
    const remote = await scanRemoteTree(session, target.remoteRoot);
    const plan = buildSyncPlan('mapping-1', target.id, diffSnapshots(createSyncSnapshot([]), remote), mapping(root).options);
    entries.get('/remote/nested')!.type = 'l';
    const result = await revalidateSyncPlan(mapping(root), target, plan, session);
    const child = result.stale.find(item => item.operation.relativePath === 'nested/child.txt');
    assert.ok(child);
    assert.match(child.reason, /Remote ancestor.*symbolic link/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('SFTP Disconnect bounds graceful shutdown and destroys SSH plus Jump Hosts', { timeout: 2500 }, async () => {
  const session = Reflect.construct(SftpSyncSession, ['profile', { jumpChain: [] }]) as SftpSyncSession;
  let destroyed = 0;
  let jumpsClosed = 0;
  (session as any).client = {
    end: () => new Promise(() => {}),
    client: { destroy: () => { destroyed += 1; } }
  };
  (session as any).jumpChain = { dispose: () => { jumpsClosed += 1; } };
  await session.disconnect();
  assert.equal(destroyed, 1);
  assert.equal(jumpsClosed, 1);
  await assert.rejects(session.reconnect(), /disconnected/);
});

test('SFTP Disconnect settles a stuck transfer without relying on SSH callbacks', { timeout: 1000 }, async () => {
  const session = Reflect.construct(SftpSyncSession, ['profile', { jumpChain: [] }]) as SftpSyncSession;
  let destroyed = 0;
  (session as any).client = {
    fastPut: () => new Promise(() => {}),
    end: async () => {},
    client: { destroy: () => { destroyed += 1; } }
  };
  const upload = session.upload('/local/file', '/remote/file');
  const failed = assert.rejects(upload, /disconnected/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.interruptPendingReads(), false, 'soft interruption must preserve an active transfer');
  await session.disconnect();
  await failed;
  assert.ok(destroyed >= 1);
});





