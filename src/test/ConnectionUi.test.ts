import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { createConnectionManagerHarness, profile, secretKey } from './helpers/ConnectionManagerHarness';
import { createConnectionUiHarness, createJumpWebviewHarness } from './helpers/ConnectionUiHarness';
import { SidebarConnectionDraftStore, QUICK_CONNECT_ID } from '../sidebar/ConnectionDraftStore';
import { buildSidebarJumpDisplay } from '../sidebar/ItemHelpers';

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
