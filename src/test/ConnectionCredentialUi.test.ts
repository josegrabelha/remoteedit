import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import type { ActiveConnection, ConnectOptions } from '../remote/RemoteSessionTypes';
import { createConnectionManagerHarness, profile, secretKey } from './helpers/ConnectionManagerHarness';
import { createConnectionUiHarness, createJumpWebviewHarness } from './helpers/ConnectionUiHarness';

for (const surface of ['panel', 'sidebar'] as const) {
  test(`${surface} classifies a pre-network Jump password Esc as cancellation`, async () => {
    const harness = createConnectionManagerHarness([profile('jump'), profile('target', { jumpProfileId: 'jump' })]);
    harness.secrets.set(secretKey('target', 'password'), 'synthetic-target');
    let networkCalls = 0;
    const sessions = {
      connect: async () => { networkCalls++; throw new Error('Unexpected network'); },
      listConnections: () => [], getConnection: () => undefined, hasConnection: () => false
    } as unknown as RemoteSessionManager;
    const ui = createConnectionUiHarness(harness, sessions);
    harness.ui.inputs.push(undefined);
    if (surface === 'panel') await ui.panel.connect({ id: 'target' });
    else await ui.sidebar.connectWithPayload({ id: 'target' });
    assert.equal(networkCalls, 0);
    assert.deepEqual(harness.ui.errors, []);
    assert.equal(ui.messages.some(message => message.type === 'error'), false);
    const allFeedback = JSON.stringify({ messages: ui.messages, info: harness.ui.information, logs: harness.logs });
    assert.match(allFeedback, /Connection canceled/);
    assert.doesNotMatch(allFeedback, /Connection failed/);
    assert.equal(ui.panel.pendingConnectionOptions.size, 0);
    assert.equal(ui.panel.activeConnectionCancellationSources.size, 0);
    assert.equal(ui.sidebar.connectingProfileIds.size, 0);
  });
}

for (const surface of ['panel', 'sidebar'] as const) {
  test(`${surface} success exposes only safe snapshots and leaves temporary Jump input unsaved`, async () => {
    const harness = createConnectionManagerHarness([
      profile('outer', { authType: 'privateKey', privateKeyPath: '/synthetic/key' }),
      profile('jump', { jumpProfileId: 'outer' }), profile('target', { jumpProfileId: 'jump' })
    ]);
    const secrets = ['synthetic-target-password', 'synthetic-outer-passphrase', 'synthetic-temporary-jump'];
    harness.secrets.set(secretKey('target', 'password'), secrets[0]);
    harness.secrets.set(secretKey('outer', 'passphrase'), secrets[1]);
    harness.ui.inputs.push(secrets[2]);
    let networkCalls = 0;
    let active: ActiveConnection | undefined;
    const sessions = {
      connect: async (options: ConnectOptions) => {
        networkCalls++;
        assert.equal(options.password, secrets[0]);
        assert.equal(options.jumpChain?.[0].passphrase, secrets[1]);
        assert.equal(options.jumpChain?.[1].password, secrets[2]);
        active = {
          id: options.connectionId, connectionType: 'sftp', name: options.name || '', host: options.host,
          port: options.port, username: options.username, authType: options.authType, startPath: '/', keepAlive: true,
          jumpProfileId: options.jumpProfileId, jumpProfileIds: options.jumpChain?.map(hop => hop.profileId),
          jumpProfileNames: options.jumpChain?.map(hop => hop.name)
        } as ActiveConnection;
        return active;
      },
      listConnections: () => active ? [active] : [], getConnection: () => active,
      hasConnection: () => Boolean(active), isSudoModeEnabled: () => false
    } as unknown as RemoteSessionManager;
    const ui = createConnectionUiHarness(harness, sessions);
    if (surface === 'panel') await ui.panel.connect({ id: 'target', rememberPassword: true });
    else await ui.sidebar.connectWithPayload({ id: 'target', rememberPassword: true });
    assert.equal(networkCalls, 1);
    assert.deepEqual(harness.ui.errors, []);
    assert.equal(harness.secrets.has(secretKey('jump', 'password')), false);
    await ui.panel.sendProfiles();
    ui.panel.sendSessions();
    const outbound = JSON.stringify({ messages: ui.messages, state: [...harness.state], logs: harness.logs });
    for (const secret of secrets) assert.ok(!outbound.includes(secret));
    assert.equal(ui.panel.pendingConnectionOptions.size, 0);
    if (surface === 'panel') {
      const pending = ui.messages.flatMap(message => message.payload.sessions || []).find(session => session.connectionState === 'connecting');
      assert.deepEqual(pending.jumpProfileNames, ['outer', 'jump']);
      assert.equal('jumpChain' in pending, false);
      assert.equal('password' in pending, false);
    }
  });
}

test('Panel cancellation without a saved/client ID still resets busy state without an error', async () => {
  const harness = createConnectionManagerHarness([profile('jump')]);
  const sessions = { listConnections: () => [], getConnection: () => undefined } as unknown as RemoteSessionManager;
  const ui = createConnectionUiHarness(harness, sessions);
  await ui.panel.connect({ host: 'target.invalid', username: 'user', password: 'synthetic-target', jumpProfileId: 'jump' });
  assert.ok(ui.messages.some(message => message.type === 'busy' && !message.payload.isBusy && /canceled/.test(message.payload.message)));
  assert.ok(ui.messages.every(message => message.type !== 'error'));
});

test('Sidebar Connect Without Saving carries the draft password through to Jump password Esc', async () => {
  const harness = createConnectionManagerHarness([profile('jump'), profile('target')]);
  let networkCalls = 0;
  const sessions = {
    connect: async () => { networkCalls++; throw new Error('Unexpected network'); }
  } as unknown as RemoteSessionManager;
  const ui = createConnectionUiHarness(harness, sessions);
  ui.sidebar.connectionDrafts.updateDraftValue('target', {
    jumpProfileId: 'jump', password: 'synthetic-draft-password', rememberPassword: true
  });
  harness.ui.picks.push({ action: 'connectWithoutSaving' });
  harness.ui.inputs.push(undefined);
  await ui.sidebar.openSavedConnection('target');
  assert.equal(harness.ui.prompts.length, 1, 'Must reach the Jump password prompt');
  assert.match(JSON.stringify(harness.ui.prompts), /jump/);
  assert.deepEqual(harness.ui.errors, []);
  assert.deepEqual(harness.ui.information, ['Connection canceled.']);
  assert.equal(networkCalls, 0);
  assert.deepEqual(harness.writes, []);
  assert.equal(ui.sidebar.connectingProfileIds.size, 0);
  assert.ok(!JSON.stringify({ logs: harness.logs, state: [...harness.state], messages: ui.messages }).includes('synthetic-draft-password'));
});

for (const authType of ['password', 'privateKey'] as const) {
  test(`Sidebar Connect Without Saving uses temporary ${authType} credentials instead of saved ones`, async () => {
    const target = profile('target', { authType, privateKeyPath: '/synthetic/key' });
    const harness = createConnectionManagerHarness([target]);
    const field = authType === 'password' ? 'password' : 'passphrase';
    harness.secrets.set(secretKey('target', field), 'synthetic-saved');
    let networkCalls = 0;
    const sessions = {
      connect: async (options: ConnectOptions) => {
        networkCalls++;
        assert.equal(options[field], 'synthetic-draft');
        return target;
      }
    } as unknown as RemoteSessionManager;
    const ui = createConnectionUiHarness(harness, sessions);
    ui.sidebar.connectionDrafts.updateDraftValue('target', { authType, privateKeyPath: target.privateKeyPath,
      [field]: 'synthetic-draft', rememberPassword: true, rememberPassphrase: true });
    const display = ui.sidebar.connectionDrafts.mergeProfileWithDraft(target);
    assert.equal(display.password, undefined);
    assert.equal(display.passphrase, undefined);
    harness.ui.picks.push({ action: 'connectWithoutSaving' });
    await ui.sidebar.openSavedConnection('target');
    assert.equal(networkCalls, 1);
    assert.deepEqual(harness.ui.errors, []);
    assert.deepEqual(harness.writes, []);
    assert.equal(harness.secrets.get(secretKey('target', field)), 'synthetic-saved');
    assert.ok(!JSON.stringify({ logs: harness.logs, state: [...harness.state], messages: ui.messages }).includes('synthetic-draft'));
  });
}

for (const quick of [false, true]) {
  test(`Webview clears ${quick ? 'Quick Connect' : 'saved'} pending state after real Jump password Esc messages`, async () => {
    const profiles = [profile('jump'), profile('target', { jumpProfileId: 'jump' })];
    const harness = createConnectionManagerHarness(profiles);
    let networkCalls = 0;
    const sessions = {
      connect: async () => { networkCalls++; throw new Error('Unexpected network'); },
      listConnections: () => [], getConnection: () => undefined, hasConnection: () => false
    } as unknown as RemoteSessionManager;
    const ui = createConnectionUiHarness(harness, sessions);
    const webview = createJumpWebviewHarness(profiles, true);
    const view = webview.context;
    view.selectProfile('target');
    if (quick) view.selectedProfileId = '';
    const payload = { ...view.collectConnectionPayload(), password: 'synthetic-target' };
    payload.clientConnectionId = view.createClientConnectionId(payload);
    view.createClientPendingSession(payload, payload.clientConnectionId);
    assert.ok(view.getPendingSessionForCurrentForm());
    await ui.panel.connect(payload);
    for (const message of ui.messages) view.dispatchMessage({ data: message });
    assert.equal(networkCalls, 0);
    assert.equal(view.hasAnyConnectingSession(), false);
    assert.equal(view.getPendingSessionForCurrentForm(), undefined);
    assert.equal(view.clientPendingSessionsByConnectionId.size, 0);
    assert.equal(view.sessions.length, 0);
    assert.equal(view.activeConnectionId, '');
    assert.equal(view.busy, false);
    assert.equal(view.statusMessage, 'Connection canceled.');
    assert.equal(webview.messages.some(message => message.type === 'cancelConnection'), false);
    ui.panel.sendSessions();
    view.dispatchMessage({ data: ui.messages.at(-1) });
    assert.equal(view.activeConnectionId, '');
  });
}

test('Webview network cancellation preserves other connected and client-pending sessions', async () => {
  const profiles = [profile('target')];
  const harness = createConnectionManagerHarness(profiles);
  const existing = profile('existing');
  const sessions = {
    connect: async () => { throw new Error('Connection canceled'); },
    listConnections: () => [existing], getConnection: () => existing,
    isSudoModeEnabled: () => false, hasConnection: () => false
  } as unknown as RemoteSessionManager;
  const ui = createConnectionUiHarness(harness, sessions);
  const webview = createJumpWebviewHarness(profiles, true);
  const view = webview.context;
  view.sessions = [existing];
  view.createClientPendingSession(profile('other'), 'other');
  view.selectProfile('target');
  const payload = { ...view.collectConnectionPayload(), password: 'synthetic-target', clientConnectionId: 'target' };
  view.createClientPendingSession(payload, 'target');
  await ui.panel.connect(payload);
  for (const message of ui.messages) view.dispatchMessage({ data: message });
  assert.deepEqual(Array.from(view.clientPendingSessionsByConnectionId.keys()), ['other']);
  assert.deepEqual(Array.from(view.sessions, (session: any) => session.id), ['existing', 'other']);
  assert.equal(view.activeConnectionId, 'existing');
  assert.equal(view.getPendingSessionForCurrentForm(), undefined);
  assert.equal(view.hasAnyConnectingSession(), true);
  assert.equal(webview.messages.some(message => message.type === 'cancelConnection'), false);
  assert.equal(ui.messages.some(message => message.type === 'error'), false);
  assert.equal(ui.panel.pendingConnectionOptions.size, 0);
});
