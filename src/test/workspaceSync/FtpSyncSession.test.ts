import { Client as FtpClient } from 'basic-ftp';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FtpSyncSession } from '../../workspaceSync/connection/FtpSyncSession';

function deferred<T = void>() {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = value => done(value as T | PromiseLike<T>); reject = fail; });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

function sessionWithClient(client: any): FtpSyncSession {
  const snapshot = {
    connectionIdentity: 'ftp:test',
    connectionType: 'ftp',
    keepAlive: true
  } as any;
  const session = Reflect.construct(FtpSyncSession as any, ['profile-1', 'ftp', snapshot]) as FtpSyncSession;
  (session as any).client = client;
  return session;
}

function fileInfo(name: string) {
  return {
    name,
    isDirectory: false,
    isSymbolicLink: false,
    isFile: true,
    size: 4,
    modifiedAt: new Date(1000)
  };
}

test('FTP Workspace Sync falls back to CWD + LIST when direct absolute-path LIST is rejected', async () => {
  const calls: string[] = [];
  let current = '/';
  const client = {
    closed: false,
    async list(remotePath: string) {
      calls.push(`list:${remotePath}`);
      if (remotePath === '/remote') throw new Error('501 No such directory');
      if (remotePath === '' && current === '/remote') return [fileInfo('app.js')];
      return [];
    },
    async pwd() { calls.push('pwd'); return current; },
    async cd(remotePath: string) { calls.push(`cd:${remotePath}`); current = remotePath; }
  };
  const session = sessionWithClient(client);

  const entries = await session.list('/remote');

  assert.deepEqual(entries.map(entry => entry.name), ['app.js']);
  assert.deepEqual(calls, ['list:/remote', 'pwd', 'cd:/remote', 'list:', 'cd:/']);
});







test('FTP Workspace Sync Keep Alive never overlaps real client commands', async () => {
  const calls: string[] = [];
  const listGate = deferred<void>();
  const noopGate = deferred<void>();
  const client = {
    closed: false,
    async list() {
      calls.push('list:start');
      await listGate.promise;
      calls.push('list:end');
      return [fileInfo('app.js')];
    },
    async sendIgnoringError(command: string) {
      calls.push(`${command}:start`);
      await noopGate.promise;
      calls.push(`${command}:end`);
    },
    async uploadFrom() { calls.push('upload'); }
  };
  const session = sessionWithClient(client);

  const listing = session.list('/remote');
  await settle();
  await (session as any).sendKeepAliveIfIdle();
  assert.deepEqual(calls, ['list:start']);

  listGate.resolve();
  await listing;

  const keepAlive = (session as any).sendKeepAliveIfIdle() as Promise<void>;
  await settle();
  const upload = session.upload('/local/app.js', '/remote/app.js');
  await settle();
  assert.deepEqual(calls, ['list:start', 'list:end', 'NOOP:start']);

  noopGate.resolve();
  await Promise.all([keepAlive, upload]);
  assert.deepEqual(calls, ['list:start', 'list:end', 'NOOP:start', 'NOOP:end', 'upload']);
});

test('FTP reconnect cannot deadlock with a command queued in the same turn', { timeout: 1000 }, async () => {
  const calls: string[] = [];
  const session = sessionWithClient({ closed: false, list: async () => { calls.push('list'); return []; } });
  (session as any).openFreshConnection = async () => { calls.push('reconnect'); };
  const listing = session.list('/remote');
  const reconnect = session.reconnect();
  await Promise.all([listing, reconnect]);
  assert.deepEqual(calls, ['list', 'reconnect']);
});



test('FTP Disconnect settles a stalled transfer even when close gives no callback', { timeout: 1000 }, async () => {
  let closed = false;
  const session = sessionWithClient({
    closed: false,
    uploadFrom: () => new Promise(() => {}),
    close: () => { closed = true; }
  });
  const upload = session.upload('/local/file', '/remote/file');
  const failed = assert.rejects(upload, /disconnected/);
  await settle();
  await session.disconnect();
  await failed;
  assert.equal(closed, true);
  await assert.rejects(session.list('/remote'), /disconnected/);
});



