import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { createConnectionManagerHarness, inputUi, profile } from './helpers/ConnectionManagerHarness';
import { RemoteEditPanel, createConnectionUiHarness } from './helpers/ConnectionUiHarness';
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


test('sidebar proxy picker pins actions, selects the current proxy and preserves selection on cancel', async () => {
  const h = createConnectionManagerHarness([profile('source')]);
  const ui = createConnectionUiHarness(h, { hasConnection: () => false } as unknown as RemoteSessionManager);
  await h.manager.proxyProfiles.save({ id: 'proxy', name: 'Office', type: 'http', host: 'proxy.invalid', port: 8080, authentication: 'none' });
  assert.equal(await ui.sidebar.promptSidebarProxyProfileId('proxy'), 'proxy');
  const request = ui.pickRequests[0];
  assert.deepEqual(request.items.slice(0, 2).map((item: any) => [item.label, item.alwaysShow]), [
    ['New Proxy', true], ['Manage Proxies (Webview)', true]
  ]);
  assert.equal(request.items[3].label, 'No Proxy');
  ui.sidebar.connectionDrafts.updateDraftValue('source', { proxyProfileId: 'proxy', host: 'unsaved.invalid' });
  ui.pickChoices.push(() => undefined);
  await ui.sidebar.editConnectionDetail('source', 'proxyProfileId');
  assert.equal(ui.sidebar.connectionDrafts.mergeProfileWithDraft((await h.manager.getProfile('source'))!).host, 'unsaved.invalid');
});

test('native proxy creation stores credentials securely and changes only the originating draft', async () => {
  const h = createConnectionManagerHarness([profile('source')]);
  const ui = createConnectionUiHarness(h, { hasConnection: () => false } as unknown as RemoteSessionManager);
  ui.pickChoices.push(options => options.items[0]);
  inputUi.picks.push({ value: 'socks5' }, { value: 'password' });
  inputUi.inputs.push('Office', 'proxy.invalid', '1080', 'user', 'proxy-secret');
  await ui.sidebar.editConnectionDetail('source', 'proxyProfileId');
  const saved = (await h.manager.getProfile('source'))!;
  const id = ui.sidebar.connectionDrafts.mergeProfileWithDraft(saved).proxyProfileId;
  assert.ok(id);
  assert.equal((await h.manager.proxyProfiles.resolve(id))?.password, 'proxy-secret');
  assert.equal((await h.manager.getProfile('source'))?.proxyProfileId, undefined);
  assert.ok(!JSON.stringify([...h.state]).includes('proxy-secret'));
});

test('canceling native proxy creation does not save a partial proxy', async () => {
  const h = createConnectionManagerHarness();
  const ui = createConnectionUiHarness(h, { hasConnection: () => false } as unknown as RemoteSessionManager);
  inputUi.inputs.push('Canceled');
  inputUi.picks.push(undefined);
  assert.equal(await ui.sidebar.createSidebarProxy(), undefined);
  assert.deepEqual(await h.manager.proxyProfiles.list(), []);
});

test('Manage Proxies opens the webview without changing the sidebar association', async () => {
  const h = createConnectionManagerHarness([profile('source')]);
  const ui = createConnectionUiHarness(h, { hasConnection: () => false } as unknown as RemoteSessionManager);
  const original = RemoteEditPanel.openProxyProfiles;
  let opened = false;
  RemoteEditPanel.openProxyProfiles = () => { opened = true; };
  try {
    ui.pickChoices.push(options => options.items[1]);
    assert.equal(await ui.sidebar.promptSidebarProxyProfileId(), undefined);
    assert.equal(opened, true);
    assert.equal((await h.manager.getProfile('source'))?.proxyProfileId, undefined);
  } finally {
    RemoteEditPanel.openProxyProfiles = original;
  }
});


test('sidebar Import dispatches backup and application imports and does nothing on cancel', async () => {
  const h = createConnectionManagerHarness([profile('source')]);
  const ui = createConnectionUiHarness(h, {} as RemoteSessionManager);
  let backups = 0;
  let applications = 0;
  ui.sidebar.backupController = { importBackup: async () => { backups++; } };
  const original = RemoteEditPanel.openConnectionImport;
  RemoteEditPanel.openConnectionImport = () => { applications++; };
  try {
    ui.pickChoices.push(options => {
      assert.equal(options.title, 'Import');
      assert.deepEqual(options.items.map((item: any) => item.label), [
        'Import Remote Edit Backup', 'Import Connections from Other Applications (Webview)'
      ]);
      assert.ok(options.items.every((item: any) => !item.iconPath && !item.kind && !item.label.includes('$(')));
      return options.items[0];
    }, options => options.items[1], () => undefined);
    await ui.sidebar.importConnections();
    assert.equal(backups, 1);
    assert.equal(applications, 0);
    await ui.sidebar.importConnections();
    assert.equal(backups, 1);
    assert.equal(applications, 1);
    await ui.sidebar.importConnections();
    assert.equal(backups, 1);
    assert.equal(applications, 1);
  } finally {
    RemoteEditPanel.openConnectionImport = original;
  }
});

test('application import opens in a ready webview and queues during initialization', () => {
  const panelClass = RemoteEditPanel as any;
  const original = panelClass.getOrCreate;
  const messages: string[] = [];
  const panel = { webviewReady: false, pendingConnectionImportOpen: false, postMessage: (type: string) => messages.push(type) };
  panelClass.getOrCreate = () => panel;
  const h = createConnectionManagerHarness();
  try {
    RemoteEditPanel.openConnectionImport(h.context, {} as RemoteSessionManager, h.manager, h.output);
    assert.equal(panel.pendingConnectionImportOpen, true);
    assert.deepEqual(messages, []);
    panel.webviewReady = true;
    panel.pendingConnectionImportOpen = false;
    RemoteEditPanel.openConnectionImport(h.context, {} as RemoteSessionManager, h.manager, h.output);
    assert.deepEqual(messages, ['showConnectionImport']);
    assert.equal(panel.pendingConnectionImportOpen, false);
  } finally {
    panelClass.getOrCreate = original;
  }
});
