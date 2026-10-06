import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { ControlledSftp, SftpSessionManager, TestCancellationSource, deferred, flush, harness, options, resetHarness } from './helpers/SftpSessionHarness';
import type { ConnectionManager } from '../connection/ConnectionManager';

const loader = require('node:module');
const original = loader._load;
let inputToken: TestCancellationSource['token'] | undefined;
loader._load = (request: string, parent: unknown, isMain: boolean) => request === 'vscode'
  ? { CancellationTokenSource: TestCancellationSource,
    window: { showInputBox: (_options: unknown, token: TestCancellationSource['token']) => { inputToken = token; return harness.prompt(); } },
    workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) =>
      key === 'diagnostics.debugLogs' || key === 'diagnostics.performanceLogs' ? true : fallback }) } }
  : Reflect.apply(original, loader, [request, parent, isMain]);
const { CommandSessions } = require('../multiTargetCommands/CommandSessions') as typeof import('../multiTargetCommands/CommandSessions');
loader._load = original;
const profiles = {
  listProfiles: async () => [{ id: 'target', name: 'Target', connectionType: 'sftp', username: 'tester', authType: 'password', host: 'test.invalid', port: 22, keepAlive: true }],
  getProfileCredentials: async () => ({ password: 'synthetic' }),
  buildConnectOptions: async () => options()
} as unknown as ConnectionManager;
beforeEach(resetHarness);

test('private command pool joins same-target connects and does not share Files sessions', async () => {
  const files = new SftpSessionManager(); const commands = new SftpSessionManager();
  harness.clients.push(new ControlledSftp(), new ControlledSftp());
  await files.connect(options());
  const pool = new CommandSessions(commands, profiles, () => {});
  const one = pool.connect('target'); const two = pool.connect('target');
  assert.equal(one, two); await one;
  assert.equal(pool.states.get('target'), 'Connected');
  await pool.disconnect('target');
  assert.equal(files.hasConnection('target'), true); assert.equal(commands.hasConnection('target'), false);
  pool.dispose(); await files.disconnectAll();
});

test('disconnect during credential loading prevents a late private handshake', async () => {
  const gate = deferred<any[]>();
  const source = { ...profiles, listProfiles: () => gate.promise } as unknown as ConnectionManager;
  const commands = new SftpSessionManager(); const pool = new CommandSessions(commands, source, () => {});
  const connecting = assert.rejects(pool.connect('target'), /cancel/i);
  await flush(); await pool.disconnect('target');
  gate.resolve(await profiles.listProfiles()); await connecting;
  assert.equal(commands.hasConnection('target'), false);
  assert.equal(pool.states.get('target'), 'Disconnected'); pool.dispose();
});

test('closing the view cancels pending handshakes and rejects future connections', async () => {
  const client = new ControlledSftp(); const gate = deferred<void>(); client.connectWork = () => gate.promise;
  harness.clients.push(client);
  const commands = new SftpSessionManager(); const pool = new CommandSessions(commands, profiles, () => {});
  const connecting = assert.rejects(pool.connect('target'), /cancel/i);
  await flush(); pool.dispose(); gate.resolve(); await connecting;
  assert.equal(commands.hasConnection('target'), false);
  await assert.rejects(pool.connect('target'), /closed/i);
});

test('remote transport closure updates target state and reconnect uses a new private client', async () => {
  const client = new ControlledSftp(); harness.clients.push(client, new ControlledSftp());
  const commands = new SftpSessionManager(); const pool = new CommandSessions(commands, profiles, () => {});
  await pool.connect('target'); client.client.emit('close'); await flush();
  assert.equal(pool.states.get('target'), 'Disconnected');
  await pool.connect('target'); assert.equal(pool.states.get('target'), 'Connected');
  await pool.disconnect('target'); pool.dispose();
});


test('password prompts receive the target cancellation token and cannot reconnect after Stop', async () => {
  const password = deferred<string | undefined>(); harness.prompt = () => password.promise;
  const source = { ...profiles, getProfileCredentials: async () => ({}) } as unknown as ConnectionManager;
  const commands = new SftpSessionManager(); const pool = new CommandSessions(commands, source, () => {});
  const connecting = assert.rejects(pool.connect('target'), /cancel/i);
  await flush(); assert.ok(inputToken); assert.equal(inputToken.isCancellationRequested, false);
  await pool.disconnect('target'); assert.equal(inputToken.isCancellationRequested, true);
  password.resolve('synthetic'); await connecting;
  assert.equal(commands.hasConnection('target'), false); pool.dispose();
});
