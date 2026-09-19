import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { createConnectionManagerHarness, loadWithVscode, profile, secretKey } from './helpers/ConnectionManagerHarness';
import { createConnectionUiHarness, createJumpWebviewHarness } from './helpers/ConnectionUiHarness';
import { SidebarConnectionDraftStore, QUICK_CONNECT_ID } from '../sidebar/ConnectionDraftStore';
import { buildSidebarJumpDisplay } from '../sidebar/ItemHelpers';

for (const existingConnections of [false, true]) {
  test(`Sidebar creates an independent group and notifies the panel with ${existingConnections ? 'existing' : 'no'} connections`, async () => {
    const profiles = existingConnections ? [profile('target')] : [];
    const harness = createConnectionManagerHarness(profiles);
    const ui = createConnectionUiHarness(harness, {} as RemoteSessionManager);
    const before = await harness.manager.listProfiles();
    const { RemoteEditSharedState } = loadWithVscode(() => require('../state/RemoteEditSharedState'));
    let notification: Promise<void> | undefined;
    const listener = RemoteEditSharedState.onProfilesChanged((event: { selectedId?: string }) => {
      notification = ui.panel.sendProfiles(event.selectedId);
    });
    try {
      harness.ui.inputs.push('  Production  ');
      await ui.sidebar.addConnectionGroup();
      assert.ok(notification);
      await notification;
      const groups = await harness.manager.listGroups();
      assert.equal(groups.length, 1);
      assert.equal(groups[0].name, 'Production');
      assert.deepEqual(await harness.manager.listProfiles(), before);
      assert.deepEqual(ui.messages.find(message => message.type === 'profilesLoaded')?.payload.connectionGroups, groups);
      assert.deepEqual(harness.ui.information, ['Connection group "Production" created.']);
      assert.equal(ui.refreshes, 1);

      const writes = harness.writes.length;
      notification = undefined;
      harness.ui.inputs.push(undefined);
      await ui.sidebar.addConnectionGroup();
      assert.equal(harness.writes.length, writes);
      assert.equal(notification, undefined);
      const prompt = harness.ui.prompts.at(-1) as { validateInput(value: string): string | undefined };
      assert.match(prompt.validateInput('  ')!, /required/);
      assert.match(prompt.validateInput(' production ')!, /already exists/);
      assert.equal(prompt.validateInput('Staging'), undefined);
      assert.deepEqual(harness.ui.errors, []);
    } finally { listener.dispose(); }
  });
}

for (const surface of ['sidebar', 'panel']) {
  test(`${surface} rename updates open tabs and survives later session snapshots`, async () => {
    const profiles = [profile('target', { name: 'Original' }), profile('other', { name: 'Original' }),
      profile('quick', { name: 'Saved name must not replace Quick Connect' })];
    const harness = createConnectionManagerHarness(profiles);
    const open = [
      { ...profiles[0], currentPath: '/srv/current' }, profiles[1],
      { ...profile('quick', { name: 'Quick session' }), isQuickConnect: true },
      profile('removed', { name: 'Removed profile session' })
    ];
    const sessions = { listConnections: () => open, hasConnection: () => true, isSudoModeEnabled: () => false } as unknown as RemoteSessionManager;
    const ui = createConnectionUiHarness(harness, sessions);
    const { context: view, messages } = createJumpWebviewHarness(profiles, true);
    view.sessions = structuredClone(open);
    view.activeConnectionId = surface === 'sidebar' ? 'target' : 'other';
    const before = structuredClone(view.sessions);
    const activeId = view.activeConnectionId;
    view.renderSessionTabs();
    const tabNames = () => Array.from(view.sessionTabs.children, (tab: any) =>
      /<span class="session-name">(.*?)<\/span>/.exec(tab.innerHTML)?.[1]);
    assert.deepEqual(tabNames(), ['Original', 'Original', 'Quick session', 'Removed profile session']);

    const name = 'Renamed <host> & "test"';
    if (surface === 'sidebar') {
      const { RemoteEditSharedState } = loadWithVscode(() => require('../state/RemoteEditSharedState'));
      let notification: Promise<void> | undefined;
      const listener = RemoteEditSharedState.onProfilesChanged((event: { selectedId?: string }) => {
        notification = ui.panel.sendProfiles(event.selectedId);
      });
      try {
        harness.ui.inputs.push(name);
        await ui.sidebar.renameSavedConnection('target');
        assert.ok(notification, 'sidebar rename must notify the panel');
        await notification;
      } finally { listener.dispose(); }
    } else {
      await ui.panel.renameConnection({ id: 'target', name });
    }
    const update = ui.messages.find(message => message.type === 'profilesLoaded');
    assert.ok(update);
    view.dispatchMessage({ data: update });
    const expected = ['Renamed &lt;host&gt; &amp; &quot;test&quot;', 'Original', 'Quick session', 'Removed profile session'];
    assert.deepEqual(tabNames(), expected);
    assert.deepEqual(view.sessions, before);
    assert.equal(view.activeConnectionId, activeId);

    view.dispatchMessage({ data: { type: 'sessionsChanged', payload: { sessions: structuredClone(open), activeConnectionId: activeId } } });
    assert.deepEqual(tabNames(), expected);
    assert.deepEqual(Array.from(view.sessions, (session: any) => session.id), open.map(session => session.id));
    assert.equal(view.sessions[0].currentPath, '/srv/current');
    assert.equal(view.activeConnectionId, activeId);
    assert.deepEqual(messages, []);
    assert.deepEqual(harness.ui.errors, []);
  });
}

test('Webview Direct selection sends an explicit clear through the real save message and host persistence', async () => {
  const harness = createConnectionManagerHarness([profile('jump'), profile('target', { jumpProfileId: 'jump' })]);
  const { context, messages } = createJumpWebviewHarness(await harness.manager.listProfiles());
  context.selectProfile('target');
  assert.equal(context.isSelectedSavedConnectionDirty(), false);
  context.selectJumpProfile('');
  assert.equal(context.isSelectedSavedConnectionDirty(), true);
  assert.equal(await context.saveCurrentConnection(), true);
  const message = messages.find(message => message.type === 'saveConnection');
  await harness.manager.saveProfile(message.payload);
  assert.equal((await harness.manager.getProfile('target'))?.jumpProfileId, undefined);
  context.profiles = await harness.manager.listProfiles();
  context.selectProfile('target');
  assert.equal(context.jumpProfileId.value, '');
  assert.equal(context.isSelectedSavedConnectionDirty(), false);
});

test('Webview discard/reload, Quick Connect and protocol switching use the same Jump field contract', async () => {
  const harness = createConnectionManagerHarness([profile('outer'), profile('near', { jumpProfileId: 'outer' }), profile('target', { jumpProfileId: 'near' })]);
  const { context } = createJumpWebviewHarness(await harness.manager.listProfiles());
  context.selectProfile('target');
  context.selectJumpProfile('outer');
  assert.equal(context.isSelectedSavedConnectionDirty(), true);
  await context.requestSelectProfile('outer');
  context.selectProfile('target');
  assert.equal(context.jumpProfileId.value, 'near');
  context.selectProfile('');
  context.host.value = 'quick.invalid'; context.username.value = 'user'; context.password.value = 'synthetic-target';
  context.selectJumpProfile('near');
  harness.secrets.set(secretKey('outer', 'password'), 'synthetic-outer');
  harness.secrets.set(secretKey('near', 'password'), 'synthetic-near');
  const runtime = await harness.manager.buildConnectOptions(context.collectConnectionPayload());
  assert.deepEqual(runtime.jumpChain?.map(hop => hop.profileId), ['outer', 'near']);
  context.selectConnectionType('ftp');
  assert.equal(context.jumpProfileId.value, '');
  assert.equal(context.jumpProfileBlock.hidden, true);
  context.selectConnectionType('sftp');
  assert.equal(context.jumpProfileId.value, '');
});

test('both pickers exclude invalid candidates and report an unavailable saved reference', async () => {
  const profiles = [profile('outer'), profile('near', { jumpProfileId: 'outer' }), profile('target', { jumpProfileId: 'missing' }),
    profile('cycle', { jumpProfileId: 'target' }), profile('broken', { jumpProfileId: 'gone' }), profile('ftp', { connectionType: 'ftp' })];
  const harness = createConnectionManagerHarness(profiles);
  const ui = createConnectionUiHarness(harness, {} as RemoteSessionManager);
  await ui.sidebar.promptSidebarJumpProfileId(profiles[2], profiles, 'Edit Jump');
  assert.match(ui.pickRequests[0].placeHolder, /unavailable/);
  assert.deepEqual(ui.pickRequests[0].items.filter((item: any) => item.value).map((item: any) => item.value).sort(), ['near', 'outer']);
  const { context } = createJumpWebviewHarness(profiles);
  context.selectProfile('target');
  assert.equal(context.jumpProfileId.value, 'missing');
  assert.equal(context.jumpProfileDropdownLabel.textContent, 'Unavailable Jump Host');
  assert.match(context.getJumpProfileSelectionError(), /no longer exists/);
  assert.equal(buildSidebarJumpDisplay(profiles[2], profiles).isAvailable, false);
  for (const candidate of ['target', 'cycle', 'broken', 'ftp']) assert.equal(context.analyzeJumpProfileCandidate(candidate, 'target').valid, false);
  assert.equal(context.analyzeJumpProfileCandidate('near', 'target').valid, true);
});

test('Sidebar editing only the cloned port preserves the saved Jump in the draft, discard and save', async () => {
  const harness = createConnectionManagerHarness([profile('jump'), profile('source', { jumpProfileId: 'jump' })]);
  const ui = createConnectionUiHarness(harness, { hasConnection: () => false } as unknown as RemoteSessionManager);
  const target = await harness.manager.cloneProfile('source');
  assert.equal(target.jumpProfileId, 'jump');

  for (const action of ['discard', 'save']) {
    harness.ui.inputs.push('2222');
    await ui.sidebar.editConnectionDetail(target.id, 'port');
    const visible = ui.sidebar.connectionDrafts.mergeProfileWithDraft(target);
    assert.equal(visible.port, 2222);
    assert.equal(visible.jumpProfileId, 'jump');
    const display = buildSidebarJumpDisplay(visible, await harness.manager.listProfiles());
    assert.equal(display.isAvailable, true);
    assert.match(display.route || display.label, /jump/);
    assert.deepEqual(await harness.manager.getProfile(target.id), target);

    if (action === 'discard') ui.sidebar.discardConnectionChanges(target.id);
    else await ui.sidebar.saveConnectionChanges(target.id);
    const saved = (await harness.manager.getProfile(target.id))!;
    assert.equal(saved.port, action === 'discard' ? 22 : 2222);
    assert.equal(saved.jumpProfileId, 'jump');
    assert.equal(ui.sidebar.connectionDrafts.hasDraft(target.id), false);
    assert.equal(ui.sidebar.connectionDrafts.mergeProfileWithDraft(saved).jumpProfileId, 'jump');
  }
  assert.equal((await harness.manager.getProfile('source'))?.port, 22);
  assert.equal((await harness.manager.getProfile('source'))?.jumpProfileId, 'jump');
  assert.deepEqual(harness.ui.errors, []);
});

for (const jumpProfileId of ['', 'other-jump']) {
  test(`Sidebar port editing preserves an explicit Jump selection: ${jumpProfileId || 'Direct'}`, async () => {
    const harness = createConnectionManagerHarness([
      profile('jump'), profile('other-jump'), profile('target', { jumpProfileId: 'jump' })
    ]);
    const ui = createConnectionUiHarness(harness, { hasConnection: () => false } as unknown as RemoteSessionManager);
    const target = (await harness.manager.getProfile('target'))!;
    ui.pickChoices.push(options => options.items.find((item: any) => item.value === jumpProfileId));
    await ui.sidebar.editConnectionDetail('target', 'jumpProfileId');
    harness.ui.inputs.push('2222');
    await ui.sidebar.editConnectionDetail('target', 'port');
    assert.equal(ui.sidebar.connectionDrafts.mergeProfileWithDraft(target).jumpProfileId, jumpProfileId);
    await ui.sidebar.saveConnectionChanges('target');
    const saved = (await harness.manager.getProfile('target'))!;
    assert.equal(saved.port, 2222);
    assert.equal(saved.jumpProfileId, jumpProfileId || undefined);
    assert.deepEqual(harness.ui.errors, []);
  });
}

for (const connectionType of ['ftp', 'ftps']) {
  test(`Sidebar switching a saved Jump connection to ${connectionType} and back keeps Direct`, async () => {
    const harness = createConnectionManagerHarness([profile('jump'), profile('target', { jumpProfileId: 'jump' })]);
    const ui = createConnectionUiHarness(harness, { hasConnection: () => false } as unknown as RemoteSessionManager);
    const target = (await harness.manager.getProfile('target'))!;
    harness.ui.picks.push({ value: connectionType });
    await ui.sidebar.editConnectionDetail('target', 'connectionType');
    const visible = ui.sidebar.connectionDrafts.mergeProfileWithDraft(target);
    assert.equal(visible.connectionType, connectionType);
    assert.equal(visible.jumpProfileId, undefined);
    harness.ui.picks.push({ value: 'sftp' });
    await ui.sidebar.editConnectionDetail('target', 'connectionType');
    assert.equal(ui.sidebar.connectionDrafts.mergeProfileWithDraft(target).jumpProfileId, '');
    await ui.sidebar.saveConnectionChanges('target');
    assert.equal((await harness.manager.getProfile('target'))?.jumpProfileId, undefined);
    assert.deepEqual(harness.ui.errors, []);
  });
}

test('Sidebar draft editing, discard, Quick Connect and save preserve explicit Direct', async () => {
  const harness = createConnectionManagerHarness([profile('jump'), profile('target', { jumpProfileId: 'jump' })]);
  const drafts = new SidebarConnectionDraftStore();
  const target = (await harness.manager.getProfile('target'))!;
  drafts.updateConnectionDetailDraft('target', 'jumpProfileId', '');
  assert.equal(drafts.hasDraft('target'), true);
  assert.equal(drafts.mergeProfileWithDraft(target).jumpProfileId, '');
  drafts.deleteDraft('target');
  assert.equal(drafts.mergeProfileWithDraft(target).jumpProfileId, 'jump');
  drafts.updateConnectionDetailDraft('target', 'jumpProfileId', '');
  await harness.manager.saveProfile(drafts.getDraft('target')!);
  assert.equal((await harness.manager.getProfile('target'))?.jumpProfileId, undefined);
  drafts.updateDraftValue(QUICK_CONNECT_ID, { host: 'quick.invalid', username: 'user', password: 'synthetic-target' });
  drafts.updateConnectionDetailDraft(QUICK_CONNECT_ID, 'jumpProfileId', 'jump');
  assert.equal(drafts.buildQuickConnectProfile().jumpProfileId, 'jump');
  drafts.updateDraftValue(QUICK_CONNECT_ID, { connectionType: 'ftps' });
  assert.equal(drafts.buildQuickConnectProfile().jumpProfileId, undefined);
  drafts.updateDraftValue(QUICK_CONNECT_ID, { connectionType: 'sftp' });
  assert.equal(drafts.buildQuickConnectProfile().jumpProfileId, '');
});

test('Webview Jump Host filter narrows valid candidates while keeping Direct connection pinned', () => {
  const profiles = [
    profile('ubuntu', { name: 'Ubuntu Bastion', host: 'ubuntu.example.com', username: 'jump-user' }),
    profile('rhel', { name: 'RHEL Gateway', host: 'rhel.example.com', username: 'admin' }),
    profile('target', { name: 'Target' })
  ];
  const { context } = createJumpWebviewHarness(profiles);
  context.selectProfile('target');
  assert.equal(context.jumpProfileDropdownLabel.textContent, 'Direct connection');

  context.jumpProfileDropdownFilterText = 'ubuntu';
  context.updateJumpProfilePicker();
  const menu = context.jumpProfileDropdownMenu.children;
  assert.equal(menu[1].children[0].dataset.jumpProfileId, '');
  assert.equal(menu[1].children[0].children[0].textContent, 'Direct connection');
  assert.equal(menu[2].children.length, 1);
  assert.equal(menu[2].children[0].dataset.jumpProfileId, 'ubuntu');

  context.jumpProfileDropdownFilterText = 'admin@rhel.example.com';
  context.updateJumpProfilePicker();
  assert.equal(context.jumpProfileDropdownMenu.children[2].children.length, 1);
  assert.equal(context.jumpProfileDropdownMenu.children[2].children[0].dataset.jumpProfileId, 'rhel');

  context.jumpProfileDropdownFilterText = 'does-not-exist';
  context.updateJumpProfilePicker();
  assert.equal(context.jumpProfileDropdownMenu.children[1].children[0].dataset.jumpProfileId, '');
  assert.equal(context.jumpProfileDropdownMenu.children[2].children[0].textContent, 'No Jump Hosts found.');
});

test('Webview Save As uses the current draft, a new name, and the selected saved profile as the credential source', async () => {
  const profiles = [profile('ubuntu', { name: 'Ubuntu', username: 'admin', groupId: 'group-a' })];
  const { context, messages } = createJumpWebviewHarness(profiles);
  context.selectProfile('ubuntu');
  context.username.value = 'different-user';
  context.startPath.value = '/srv/different';
  let dialogOptions: any;
  context.showConnectionNameDialog = async (initialName: string, groupId: string, options: any) => {
    assert.equal(initialName, 'Ubuntu (copy)');
    assert.equal(groupId, 'group-a');
    dialogOptions = options;
    return { name: 'Ubuntu Alternate', groupId: 'group-b', newGroupName: '' };
  };

  assert.equal(await context.saveCurrentConnectionAs(), true);
  assert.equal(dialogOptions.title, 'Save Connection As');
  assert.equal(dialogOptions.includeGroup, true);
  const message = messages.find(message => message.type === 'saveConnectionAs');
  assert.ok(message);
  assert.equal(message.payload.sourceProfileId, 'ubuntu');
  assert.equal(message.payload.id, undefined);
  assert.equal(message.payload.name, 'Ubuntu Alternate');
  assert.equal(message.payload.username, 'different-user');
  assert.equal(message.payload.startPath, '/srv/different');
  assert.equal(message.payload.groupId, 'group-b');
});
