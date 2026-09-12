import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RemoteSessionManager } from '../remote/RemoteSessionManager';
import { createConnectionManagerHarness, profile } from './helpers/ConnectionManagerHarness';
import { createConnectionUiHarness } from './helpers/ConnectionUiHarness';
import { buildSidebarJumpDisplay } from '../sidebar/ItemHelpers';

for (const scenario of ['direct', 'nested', 'empty', 'escape', 'ftp', 'ftps'] as const) {
  test(`newConnection wizard: ${scenario} flows through the real addConnection and saveProfile`, async () => {
    const profiles = scenario === 'empty' ? [] : [profile('outer'), profile('near', { jumpProfileId: 'outer' }),
      profile('ftp-only', { connectionType: 'ftp' })];
    const harness = createConnectionManagerHarness(profiles);
    const ui = createConnectionUiHarness(harness, {} as RemoteSessionManager);
    const type = scenario === 'ftp' || scenario === 'ftps' ? scenario : 'sftp';
    harness.ui.inputs.push('New target', 'target.invalid', type === 'sftp' ? '22' : '21', 'target-user', '', '/');
    harness.ui.picks.push({ value: type });
    if (type === 'sftp') harness.ui.picks.push({ value: 'password' });
    if (type === 'ftps') harness.ui.picks.push({ value: 'selfSigned' });
    harness.ui.picks.push({ value: true });
    ui.pickChoices.push(options => options.activeItem);
    if (type === 'sftp') ui.pickChoices.push(options => {
      assert.equal(harness.ui.prompts.length, 4, 'Jump follows username and precedes authentication');
      assert.equal(options.activeItem.value, '');
      assert.equal(options.items[0].label, 'Direct');
      const candidates = options.items.filter((item: any) => item.value);
      assert.ok(candidates.every((item: any) => ['outer', 'near'].includes(item.value)));
      if (scenario === 'empty') assert.equal(options.items.length, 1);
      if (scenario === 'escape') return undefined;
      if (scenario === 'nested') {
        const selected = candidates.find((item: any) => item.value === 'near');
        assert.match(selected.detail, /outer.*near/);
        assert.match(selected.description, /near.invalid/);
        return selected;
      }
      return options.activeItem;
    });
    await ui.sidebar.addConnection();
    assert.deepEqual(harness.ui.errors, []);
    if (scenario === 'escape') {
      assert.deepEqual(harness.writes, []);
      assert.equal(ui.revealed.length, 0);
      return;
    }
    const saved = (await harness.manager.listProfiles()).find(item => item.name === 'New target')!;
    assert.ok(saved);
    assert.equal(saved.connectionType, type);
    assert.equal(saved.jumpProfileId, scenario === 'nested' ? 'near' : undefined);
    assert.equal(ui.revealed.length, 1);
    assert.equal(ui.pickRequests.length, type === 'sftp' ? 2 : 1);
    const display = buildSidebarJumpDisplay(saved, await harness.manager.listProfiles());
    assert.equal(display.isAvailable, true);
    assert.match(display.route || display.label, scenario === 'nested' ? /outer.*near/ : /Direct/);
  });
}
