import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { createConnectionManagerHarness, loadWithVscode, profile, secretKey } from './helpers/ConnectionManagerHarness';
import { createConnectionUiHarness, createJumpWebviewHarness } from './helpers/ConnectionUiHarness';
import { SidebarConnectionDraftStore, QUICK_CONNECT_ID } from '../sidebar/ConnectionDraftStore';
import { buildSidebarJumpDisplay } from '../sidebar/ItemHelpers';
import { RemoteEditDialogManager } from '../panel/DialogManager';
import { renderStateDialogs } from '../panel/webview/scripts/StateDialogs';
import { renderTransferContextActions } from '../panel/webview/scripts/TransferContextActions';



test('webview confirm dialogs distinguish Escape dismissal from the cancel button', async () => {
  const messages: any[] = [];
  const manager = new RemoteEditDialogManager(() => true, (type, payload) => messages.push({ type, payload }));
  const options = { title: 'Conflict', message: 'Choose', confirmLabel: 'Replace', cancelLabel: 'Keep Current' };

  const dismissed = manager.showConfirmDialogDecision(options);
  manager.handleConfirmDialogResponse({ requestId: messages.at(-1).payload.requestId, confirmed: false, dismissed: true });
  assert.equal(await dismissed, 'dismiss');

  const kept = manager.showConfirmDialogDecision(options);
  manager.handleConfirmDialogResponse({ requestId: messages.at(-1).payload.requestId, confirmed: false, dismissed: false });
  assert.equal(await kept, 'cancel');

  const replaced = manager.showConfirmDialogDecision(options);
  manager.handleConfirmDialogResponse({ requestId: messages.at(-1).payload.requestId, confirmed: true, dismissed: false });
  assert.equal(await replaced, 'confirm');

  assert.match(renderStateDialogs(true, true, 'symbolic'), /dismissed: Boolean\(dismissed\)/);
  assert.match(renderTransferContextActions(), /closeConfirmDialog\([^;]+, true\);/);
});


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

test('Webview Master Password selection persists as a source and never submits the individual field', async () => {
  const saved = profile('shared', { passwordSource: 'master' });
  const { context } = createJumpWebviewHarness([saved]);
  context.selectProfile('shared');
  assert.equal(context.passwordSource, 'master');
  assert.equal(context.isSelectedSavedConnectionDirty(), false);
  context.password.value = 'stale-individual';
  context.rememberPassword.checked = true;
  const payload = context.collectConnectionPayload();
  assert.equal(payload.passwordSource, 'master');
  assert.equal(payload.password, '');
  assert.equal(payload.rememberPassword, false);
  assert.equal(context.isSelectedSavedConnectionDirty(), false);
  context.passwordSource = 'connection';
  assert.equal(context.isSelectedSavedConnectionDirty(), true);
  assert.equal(context.collectConnectionPayload().password, 'stale-individual');
});
