import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConnectionManagerHarness, profile, secretKey } from './helpers/ConnectionManagerHarness';


test('cloning a saved connection creates an independent copy next to the source and copies stored credentials', async () => {
  const harness = createConnectionManagerHarness([
    profile('jump', { name: 'Jump' }),
    profile('source', {
      name: 'Ubuntu', host: 'ubuntu.invalid', port: 2222, username: 'admin', startPath: '/srv/app',
      jumpProfileId: 'jump', groupId: 'lab', favoriteRemotePaths: ['/srv/app', '/var/log']
    }),
    profile('copy-one', { name: 'Ubuntu (copy)' }),
    profile('copy-two', { name: 'ubuntu (COPY 2)' }),
    profile('dependent', { name: 'Dependent', jumpProfileId: 'source' })
  ]);
  harness.state.set('remoteedit.connectionGroups', [{ id: 'lab', name: 'Lab', order: 0, createdAt: 1, updatedAt: 1 }]);
  harness.secrets.set(secretKey('source', 'password'), 'synthetic-source-password');

  const clone = await harness.manager.cloneProfile('source');
  assert.equal(clone.name, 'Ubuntu (copy 3)');
  assert.notEqual(clone.id, 'source');
  assert.equal(clone.host, 'ubuntu.invalid');
  assert.equal(clone.port, 2222);
  assert.equal(clone.username, 'admin');
  assert.equal(clone.startPath, '/srv/app');
  assert.equal(clone.jumpProfileId, 'jump');
  assert.equal(clone.groupId, 'lab');
  assert.deepEqual(clone.favoriteRemotePaths, ['/srv/app', '/var/log']);
  assert.equal(clone.hasSavedPassword, true);
  assert.equal(harness.secrets.get(secretKey(clone.id, 'password')), 'synthetic-source-password');

  const profiles = await harness.manager.listProfiles();
  assert.deepEqual(profiles.slice(0, 3).map(item => item.id), ['jump', 'source', clone.id]);
  await harness.manager.renameProfile(clone.id, 'Independent clone');
  assert.equal((await harness.manager.getProfile('source'))?.name, 'Ubuntu');
  assert.equal((await harness.manager.getProfile(clone.id))?.name, 'Independent clone');
  assert.equal((await harness.manager.getProfile('dependent'))?.jumpProfileId, 'source');
});





const invalidGraphs = [
  { name: 'self reference', profiles: [profile('target', { jumpProfileId: 'target' })], error: /itself|self/i },
  { name: 'target cycle', profiles: [profile('target', { jumpProfileId: 'jump' }), profile('jump', { jumpProfileId: 'target' })], error: /cycle/i },
  { name: 'intermediate cycle', profiles: [profile('target', { jumpProfileId: 'a' }), profile('a', { jumpProfileId: 'b' }), profile('b', { jumpProfileId: 'a' })], error: /cycle/i },
  { name: 'missing Jump', profiles: [profile('target', { jumpProfileId: 'absent' })], error: /not found/i },
  ...(['ftp', 'ftps'] as const).map(connectionType => ({ name: `${connectionType} Jump`, profiles: [
    profile('target', { jumpProfileId: 'jump' }), profile('jump', { connectionType })
  ], error: /must use SFTP/i }))
];



test('a candidate save that closes a previously valid cycle is rejected before writes', async () => {
  const harness = createConnectionManagerHarness([profile('outer'), profile('target', { jumpProfileId: 'outer' })]);
  await assert.rejects(harness.manager.saveProfile({ id: 'outer', jumpProfileId: 'target' }), /cycle/);
  assert.deepEqual(harness.writes, []);
});





test('rename and group moves preserve Jump identity; group-only deletion keeps both connections', async () => {
  const harness = createConnectionManagerHarness([profile('jump'), profile('target', { jumpProfileId: 'jump' })]);
  const group = await harness.manager.createGroup('Group');
  assert.equal((await harness.manager.renameProfile('jump', 'Renamed Jump')).id, 'jump');
  await harness.manager.moveProfileToGroup('jump', group.id);
  await harness.manager.moveProfileToGroup('target', group.id);
  assert.equal((await harness.manager.getProfile('target'))?.jumpProfileId, 'jump');
  assert.deepEqual(await harness.manager.deleteGroup(group.id), []);
  const profiles = await harness.manager.listProfiles();
  assert.equal(profiles.length, 2);
  assert.ok(profiles.every(item => !item.groupId));
  assert.equal(profiles.find(item => item.id === 'target')?.jumpProfileId, 'jump');
});



test('SFTP omission preserves Jump while an explicit empty string clears it for connect and save', async () => {
  const harness = createConnectionManagerHarness([profile('jump'), profile('target', { jumpProfileId: 'jump' })]);
  for (const id of ['jump', 'target']) harness.secrets.set(secretKey(id, 'password'), `synthetic-${id}`);
  assert.equal((await harness.manager.buildConnectOptions({ id: 'target' })).jumpProfileId, 'jump');
  assert.equal((await harness.manager.buildConnectOptions({ id: 'target', jumpProfileId: '' })).jumpProfileId, undefined);
  assert.equal((await harness.manager.saveProfile({ id: 'target', rememberPassword: true })).jumpProfileId, 'jump');
  assert.equal((await harness.manager.saveProfile({ id: 'target', jumpProfileId: '', rememberPassword: true })).jumpProfileId, undefined);
  await harness.manager.deleteProfile('jump');
  assert.deepEqual((await harness.manager.listProfiles()).map(item => item.id), ['target']);
});


