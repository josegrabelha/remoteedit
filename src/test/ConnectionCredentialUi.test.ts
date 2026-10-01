import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import type { ActiveConnection, ConnectOptions } from '../remote/RemoteSessionTypes';
import { createConnectionManagerHarness, profile, secretKey } from './helpers/ConnectionManagerHarness';
import { createConnectionUiHarness, createJumpWebviewHarness } from './helpers/ConnectionUiHarness';







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
