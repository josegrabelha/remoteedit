import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { createConnectionManagerHarness, profile } from './helpers/ConnectionManagerHarness';
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
