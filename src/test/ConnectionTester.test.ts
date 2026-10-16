import assert from 'node:assert/strict';
import { test } from './helpers/TestHarness';
import { createConnectionManagerHarness, loadWithVscode, profile, secretKey, vscodeStub } from './helpers/ConnectionManagerHarness';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import type { ConnectOptions } from '../remote/RemoteSessionTypes';

const { ConnectionTester } = loadWithVscode(() => require('../connection/ConnectionTester') as typeof import('../connection/ConnectionTester'));

test('temporary tests use unsaved protocol settings and stored credentials without writing profiles or touching operational sessions', async () => {
  const h = createConnectionManagerHarness([profile('saved')]);
  h.secrets.set(secretKey('saved', 'password'), 'stored-password');
  const connected: ConnectOptions[] = []; let closed = 0;
  const sessions = { connect: async (options: ConnectOptions) => { connected.push(options); return { id: options.connectionId }; },
    disconnectAll: async () => { closed++; } } as unknown as RemoteSessionManager;
  const tester = new ConnectionTester(h.manager, () => sessions);
  for (const connectionType of ['sftp', 'ftp', 'ftps'] as const) {
    assert.deepEqual(await tester.test({ id: 'saved', host: 'unsaved.invalid', username: 'draft-user', connectionType,
      port: connectionType === 'sftp' ? 22 : 21, ftpsAllowSelfSignedCertificate: true }), { success: true });
    const options = connected.at(-1)!;
    assert.equal(options.connectionType, connectionType);
    assert.equal(options.host, 'unsaved.invalid'); assert.equal(options.username, 'draft-user');
    assert.equal(options.password, 'stored-password'); assert.notEqual(options.connectionId, 'saved');
  }
  assert.equal(closed, 3); assert.equal(new Set(connected.map(o => o.connectionId)).size, 3);
  assert.equal((await h.manager.getProfile('saved'))?.host, 'saved.invalid'); assert.deepEqual(h.writes, []);
});

test('temporary tests close on failures, redact resolved secrets and allow retries', async () => {
  const h = createConnectionManagerHarness([profile('saved')]);
  h.secrets.set(secretKey('saved', 'password'), 'hidden-secret');
  let closed = 0;
  const tester = new ConnectionTester(h.manager, () => ({ connect: async () => { throw new Error('Authentication failed hidden-secret'); },
    disconnectAll: async () => { closed++; } } as unknown as RemoteSessionManager));
  for (let attempt = 0; attempt < 2; attempt++) assert.deepEqual(await tester.test({id:'saved'}), {error:'Authentication failed [redacted]'});
  assert.equal(closed, 2); assert.deepEqual(h.writes, []);
});

test('cancelled tests release the pending session and suppress success even if connect completes late', async () => {
  const h = createConnectionManagerHarness([profile('saved')]);
  let finish!: () => void, entered!: () => void, cancelled = false, closed = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const tester = new ConnectionTester(h.manager, () => ({ connect: async (_options: any, token: any) => {
    token.onCancellationRequested(() => { cancelled = true; }); entered();
    await new Promise<void>(resolve => { finish = resolve; }); return {};
  }, disconnectAll: async () => { closed = true; } } as unknown as RemoteSessionManager));
  const testing = tester.test({id:'saved',password:'draft'}); await started;
  assert.match((await tester.test({id:'saved'})).error!, /already running/);
  tester.cancel(); finish(); assert.deepEqual(await testing, {cancelled:true});
  assert.equal(cancelled, true); assert.equal(closed, true); assert.deepEqual(h.writes, []);
});

test('temporary tests preserve Master Password, proxy and jump credentials plus fresh private-key passphrases', async () => {
  const h = createConnectionManagerHarness([profile('saved'), profile('jump')]);
  await h.manager.setMasterPassword('master-secret','master-secret');
  h.secrets.set(secretKey('jump','password'), 'jump-secret');
  const proxy = await h.manager.proxyProfiles.save({name:'proxy',type:'socks5',host:'proxy.invalid',port:1080,authentication:'password',username:'proxy-user',password:'proxy-secret'} as any);
  h.writes.length = 0;
  const seen: ConnectOptions[] = [];
  const tester = new ConnectionTester(h.manager, () => ({connect: async (options: ConnectOptions) => {seen.push(options); return {};},disconnectAll:async () => {}} as unknown as RemoteSessionManager));
  assert.deepEqual(await tester.test({id:'saved',passwordSource:'master',proxyProfileId:proxy.id,jumpProfileId:'jump'}), {success:true});
  assert.equal(seen[0].password,'master-secret'); assert.equal(seen[0].proxy?.password,'proxy-secret');
  assert.equal(seen[0].jumpChain?.[0].password,'jump-secret');
  assert.deepEqual(await tester.test({id:'saved',authType:'privateKey',privateKeyPath:'/draft/key',freshPrivateKey:true,passphrase:'draft-phrase'}), {success:true});
  assert.equal(seen[1].privateKeyPath,'/draft/key'); assert.equal(seen[1].passphrase,'draft-phrase'); assert.deepEqual(h.writes, []);
});

test('cancelling a test dismisses a pending Jump Host password request before any transport opens', async () => {
  const h = createConnectionManagerHarness([profile('saved'), profile('jump')]);
  const original = vscodeStub.window.showInputBox;
  let prompted!: () => void, connected = false, closed = false;
  const started = new Promise<void>(resolve => { prompted = resolve; });
  (vscodeStub.window as any).showInputBox = async (_options: any, token: any) => {
    assert.ok(token);
    prompted();
    return new Promise(resolve => token.onCancellationRequested(() => resolve(undefined)));
  };
  const tester = new ConnectionTester(h.manager, () => ({connect:async () => {connected = true;return {};},
    disconnectAll:async () => {closed = true;} } as unknown as RemoteSessionManager));
  try {
    const testing = tester.test({id:'saved',password:'draft',jumpProfileId:'jump'});
    await started; tester.cancel();
    assert.deepEqual(await testing,{cancelled:true});assert.equal(connected,false);assert.equal(closed,true);
    assert.deepEqual(h.writes,[]);
  } finally { vscodeStub.window.showInputBox = original; }
});
