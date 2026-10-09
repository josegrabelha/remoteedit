import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { createConnectionManagerHarness, loadWithVscode, profile, secretKey } from './helpers/ConnectionManagerHarness';
import { createConnectionUiHarness, createJumpWebviewHarness } from './helpers/ConnectionUiHarness';
import { SidebarConnectionDraftStore, QUICK_CONNECT_ID } from '../sidebar/ConnectionDraftStore';
import { buildSidebarJumpDisplay } from '../sidebar/ItemHelpers';
import { RemoteEditDialogManager } from '../panel/DialogManager';
import { renderStateDialogs } from '../panel/webview/scripts/StateDialogs';
import { renderTransferContextActions } from '../panel/webview/scripts/TransferContextActions';




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


test('Manage Connections editor preserves identity, secure credentials and active sessions and posts a refresh without changing selection', async () => {
  const harness = createConnectionManagerHarness([profile('active'), profile('edited')]);
  harness.secrets.set(secretKey('edited', 'password'), 'existing-password');
  const group = await harness.manager.createGroup('Production');
  let sessionMutations = 0;
  const sessions = { hasConnection: () => true, disconnect: () => { sessionMutations++; }, connect: () => { sessionMutations++; } } as unknown as RemoteSessionManager;
  const ui = createConnectionUiHarness(harness, sessions);
  await ui.panel.saveConnection({ id: 'edited', name: 'Renamed', host: 'new.invalid', port: 2222,
    groupId: group.id, authType: 'password', rememberPassword: true, password: '', editorSave: true });
  const saved = await harness.manager.getProfile('edited');
  assert.equal(saved?.name, 'Renamed');
  assert.equal(saved?.groupId, group.id);
  assert.equal(saved?.createdAt, 1);
  assert.equal(harness.secrets.get(secretKey('edited', 'password')), 'existing-password');
  assert.deepEqual((await harness.manager.listProfiles()).map(p => p.id), ['active', 'edited']);
  assert.equal(sessionMutations, 0);
  const snapshot = ui.messages.find(message => message.type === 'profilesLoaded')?.payload;
  assert.equal(snapshot.editorRefresh, true);
  assert.equal(snapshot.editedProfileId, 'edited');
  assert.equal(snapshot.selectedId, undefined);
  assert.equal(JSON.stringify(snapshot).includes('existing-password'), false);
  assert.deepEqual(ui.messages.find(message => message.type === 'connectionEditResult')?.payload, { id: 'edited', saved: true });
});

test('Manage Connections editor rejects stale profiles, duplicate names and circular jumps and keeps the editor open on error', async () => {
  const harness = createConnectionManagerHarness([profile('first'), profile('second', { jumpProfileId: 'first' })]);
  const ui = createConnectionUiHarness(harness, {} as RemoteSessionManager);
  for (const payload of [
    { id: 'missing', name: 'Missing', host: 'missing.invalid' },
    { id: 'first', name: ' SECOND ', host: 'first.invalid' },
    { id: 'first', name: 'first', host: 'first.invalid', jumpProfileId: 'second' }
  ]) {
    ui.messages.length = 0;
    await ui.panel.saveConnection({ ...payload, editorSave: true });
    const result = ui.messages.find(message => message.type === 'connectionEditResult');
    assert.equal(result?.payload.id, payload.id);
    assert.ok(result?.payload.error);
    assert.equal(result?.payload.saved, undefined);
    assert.equal(ui.messages.some(message => message.type === 'profilesLoaded'), false);
  }
  assert.deepEqual((await harness.manager.listProfiles()).map(p => [p.id, p.name]), [['first', 'first'], ['second', 'second']]);
});


test('dialog focus restoration cancels pending tooltips and preserves mouse and keyboard tooltips', () => {
  const listeners = new Map<string, (event: any) => void>();
  const timers = new Map<number, () => void>();
  const classes = new Set<string>();
  let timerId = 0, focused = false;
  const target: any = {
    disabled: false, classList: { contains: () => false },
    closest: () => target, contains: (value: any) => value === target,
    hasAttribute: () => false, getAttribute: () => 'Connection & Settings Management',
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 30, height: 20, bottom: 30 }),
    focus: () => { focused = true; listeners.get('focusin')!({ target }); }
  };
  const context: any = {
    webviewTooltip: {
      classList: { remove: (name: string) => classes.delete(name), add: (name: string) => classes.add(name), toggle() {} },
      style: {}, setAttribute() {}, getBoundingClientRect: () => ({ width: 50, height: 20 })
    },
    sessionTabDragging: false, manageProfileDragging: false,
    document: { addEventListener: (name: string, callback: any) => listeners.set(name, callback) },
    window: { innerWidth: 800, innerHeight: 600, setTimeout: (callback: () => void) => {
      timers.set(++timerId, callback); return timerId;
    } },
    clearTimeout: (id: number) => timers.delete(id)
  };
  const script = renderStateDialogs(false, false, 'symbolic');
  runInNewContext(script.slice(script.indexOf('  const TOOLTIP_SHOW_DELAY_MS'), script.indexOf("  window.addEventListener('scroll'")), context);
  listeners.get('mouseover')!({ target });
  assert.equal(timers.size, 1);
  context.restoreDialogFocus(target);
  assert.equal(focused, true);
  assert.equal(timers.size, 0);
  assert.equal(classes.has('visible'), false);
  for (const event of ['mouseover', 'focusin']) {
    listeners.get(event)!({ target });
    assert.equal(timers.size, 1);
    for (const callback of timers.values()) callback();
    assert.equal(classes.has('visible'), true);
    context.hideWebviewTooltip();
  }
});
