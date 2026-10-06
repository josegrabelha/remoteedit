import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { createConnectionManagerHarness, inputUi, profile } from './helpers/ConnectionManagerHarness';
import { createConnectionUiHarness } from './helpers/ConnectionUiHarness';
import { buildSidebarJumpDisplay } from '../sidebar/ItemHelpers';



test('sidebar Clone Connection creates an independent saved profile beside the source', async () => {
  const source = profile('source', { name: 'Ubuntu', groupId: 'lab', host: 'ubuntu.invalid', port: 2222, username: 'admin' });
  const harness = createConnectionManagerHarness([source]);
  const ui = createConnectionUiHarness(harness, {} as RemoteSessionManager);

  harness.secrets.set('remoteedit.connectionSecret.source.password', 'saved-password');
  await ui.sidebar.cloneSavedConnection('source');

  const profiles = await harness.manager.listProfiles();
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].id, 'source');
  assert.equal(profiles[1].name, 'Ubuntu (copy)');
  assert.notEqual(profiles[1].id, source.id);
  assert.equal(profiles[1].groupId, 'lab');
  assert.equal(harness.secrets.get(`remoteedit.connectionSecret.${profiles[1].id}.password`), 'saved-password');
  assert.equal(ui.refreshes, 1);
  assert.deepEqual(harness.ui.errors, []);
  assert.deepEqual(harness.ui.information, ['Connection cloned as "Ubuntu (copy)".']);
});


test('sidebar credentials can configure and select Master Password without opening the webview', async () => {
  const source = profile('source', { name: 'Source' });
  const harness = createConnectionManagerHarness([source]);
  const sessions = { hasConnection: () => false } as unknown as RemoteSessionManager;
  const ui = createConnectionUiHarness(harness, sessions);

  inputUi.picks.push(
    { label: 'Master Password', action: 'useMasterPassword' },
    { label: 'Configure Master Password', value: 'configure' }
  );
  inputUi.inputs.push('shared-secret', 'shared-secret');

  await (ui.sidebar as any).manageConnectionCredentials('source');

  const saved = await harness.manager.getProfile('source');
  assert.ok(saved);
  const merged = (ui.sidebar as any).connectionDrafts.mergeProfileWithDraft(saved);
  assert.equal(merged.passwordSource, 'master');
  assert.equal(harness.secrets.get('remoteedit.masterPassword'), 'shared-secret');
  assert.equal(harness.secrets.has('remoteedit.connectionSecret.source.password'), false);
});



test('sidebar Master Password header action changes and removes the global secret without changing saved profiles', async () => {
  const source = profile('source', { name: 'Source', passwordSource: 'master' });
  const harness = createConnectionManagerHarness([source]);
  const sessions = { hasConnection: () => false } as unknown as RemoteSessionManager;
  const ui = createConnectionUiHarness(harness, sessions);

  harness.secrets.set('remoteedit.masterPassword', 'old-secret');
  inputUi.picks.push({ label: 'Change Master Password', value: 'change' });
  inputUi.inputs.push('new-secret', 'new-secret');

  await (ui.sidebar as any).manageMasterPasswordFromSidebar();

  assert.equal(harness.secrets.get('remoteedit.masterPassword'), 'new-secret');
  assert.equal((await harness.manager.getProfile('source'))?.passwordSource, 'master');
  assert.equal(inputUi.pickPrompts[0]?.options?.title, 'Master Password');
  assert.equal(inputUi.pickPrompts[0]?.options?.placeHolder, 'Configured · Used by 1 saved connection');

  inputUi.picks.push({ label: 'Remove Master Password', value: 'remove' });
  inputUi.warningResponses.push('Remove');

  await (ui.sidebar as any).manageMasterPasswordFromSidebar();

  assert.equal(harness.secrets.has('remoteedit.masterPassword'), false);
  assert.equal((await harness.manager.getProfile('source'))?.passwordSource, 'master');
  assert.equal(inputUi.warnings.length, 1);
  assert.equal(inputUi.warnings[0].message, 'Remove Master Password?');
  assert.deepEqual(inputUi.warnings[0].items, ['Remove']);
});

