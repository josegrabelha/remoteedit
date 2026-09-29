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

test('FTP Workspace Sync recognizes a real "No such directory" as missing during stat', async () => {
  const client = {
    closed: false,
    async list() { throw new Error('501 No such directory'); },
    async pwd() { return '/'; },
    async cd(remotePath: string) {
      if (remotePath !== '/') throw new Error('501 No such directory');
    }
  };
  const session = sessionWithClient(client);

  assert.equal(await session.stat('/missing/file.txt'), undefined);
});



test('FTP Workspace Sync does not classify every 501 response as a missing path', async () => {
  const client = {
    closed: false,
    async list() { throw new Error('501 Syntax error in parameters'); },
    async pwd() { return '/'; },
    async cd(remotePath: string) {
      if (remotePath !== '/') throw new Error('501 Syntax error in parameters');
    }
  };
  const session = sessionWithClient(client);

  await assert.rejects(session.stat('/missing/file.txt'), /501 Syntax error in parameters/);
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
