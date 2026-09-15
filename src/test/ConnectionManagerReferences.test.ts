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

test('cloning a private-key connection copies a saved passphrase without changing the original', async () => {
  const harness = createConnectionManagerHarness([
    profile('key-source', { name: 'Key host', authType: 'privateKey', privateKeyPath: '/tmp/id_test' })
  ]);
  harness.secrets.set(secretKey('key-source', 'passphrase'), 'synthetic-passphrase');

  const clone = await harness.manager.cloneProfile('key-source');
  assert.equal(clone.name, 'Key host (copy)');
  assert.equal(clone.authType, 'privateKey');
  assert.equal(clone.privateKeyPath, '/tmp/id_test');
  assert.equal(clone.hasSavedPassphrase, true);
  assert.equal(harness.secrets.get(secretKey(clone.id, 'passphrase')), 'synthetic-passphrase');
  assert.equal(harness.secrets.get(secretKey('key-source', 'passphrase')), 'synthetic-passphrase');
});

test('cloning a missing saved connection fails without writes', async () => {
  const harness = createConnectionManagerHarness([profile('source')]);
  await assert.rejects(harness.manager.cloneProfile('missing'), /no longer exists/);
  assert.deepEqual(harness.writes, []);
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

for (const fixture of invalidGraphs) {
  test(`save/build reject ${fixture.name} before any state or secret mutation`, async () => {
    const harness = createConnectionManagerHarness(fixture.profiles);
    harness.secrets.set(secretKey('target', 'password'), 'synthetic-target');
    const before = structuredClone([...harness.state]);
    await assert.rejects(harness.manager.saveProfile({ id: 'target', name: 'Edited' }), fixture.error);
    await assert.rejects(harness.manager.buildConnectOptions({ id: 'target' }), fixture.error);
    assert.deepEqual(harness.writes, []);
    assert.deepEqual([...harness.state], before);
  });
}

test('a candidate save that closes a previously valid cycle is rejected before writes', async () => {
  const harness = createConnectionManagerHarness([profile('outer'), profile('target', { jumpProfileId: 'outer' })]);
  await assert.rejects(harness.manager.saveProfile({ id: 'outer', jumpProfileId: 'target' }), /cycle/);
  assert.deepEqual(harness.writes, []);
});

test('512 saved Jump hops resolve through the real manager without a depth cap', async () => {
  const hops = Array.from({ length: 512 }, (_, i) => profile(`hop-${i}`, { jumpProfileId: i ? `hop-${i - 1}` : undefined }));
  const harness = createConnectionManagerHarness([...hops, profile('target', { jumpProfileId: 'hop-511' })]);
  for (const item of [...hops, profile('target')]) harness.secrets.set(secretKey(item.id, 'password'), 'synthetic-password');
  const options = await harness.manager.buildConnectOptions({ id: 'target' });
  assert.equal(options.jumpChain?.length, 512);
  assert.equal(options.jumpChain?.[0].profileId, 'hop-0');
  assert.equal(options.jumpChain?.[511].profileId, 'hop-511');
});

for (const operation of ['delete', 'ftp', 'ftps'] as const) {
  test(`referenced Jump ${operation} is refused and names dependents before all writes`, async () => {
    const harness = createConnectionManagerHarness([profile('jump'), profile('dependent-one', { jumpProfileId: 'jump' }), profile('dependent-two', { jumpProfileId: 'jump' })]);
    const action = operation === 'delete' ? harness.manager.deleteProfile('jump')
      : harness.manager.saveProfile({ id: 'jump', connectionType: operation, ftpsAllowSelfSignedCertificate: true });
    await assert.rejects(action, error => /dependent-one/.test(String(error)) && /dependent-two/.test(String(error)));
    assert.deepEqual(harness.writes, []);
  });
}

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

for (const externalDependent of [false, true]) {
  test(`deleting a whole group ${externalDependent ? 'rejects external dependents' : 'permits internal references'}`, async () => {
    const harness = createConnectionManagerHarness([
      profile('jump', { groupId: 'group' }), profile('inside', { jumpProfileId: 'jump', groupId: 'group' }),
      ...(externalDependent ? [profile('outside', { jumpProfileId: 'inside' })] : [])
    ]);
    harness.state.set('remoteedit.connectionGroups', [{ id: 'group', name: 'Group', order: 0, createdAt: 1, updatedAt: 1 }]);
    harness.secrets.set(secretKey('jump', 'password'), 'synthetic-jump');
    if (externalDependent) {
      await assert.rejects(harness.manager.deleteGroup('group', true), /outside/);
      assert.deepEqual(harness.writes, []);
    } else {
      assert.deepEqual(await harness.manager.deleteGroup('group', true), ['jump', 'inside']);
      assert.deepEqual(await harness.manager.listProfiles(), []);
      assert.equal(harness.secrets.size, 0);
    }
  });
}

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

for (const connectionType of ['ftp', 'ftps'] as const) {
  test(`ordinary ${connectionType} save/connect normalize Jump to Direct`, async () => {
    const harness = createConnectionManagerHarness([profile('jump'), profile('target', { jumpProfileId: 'jump' })]);
    const input = { id: 'target', connectionType, password: 'synthetic-target', jumpProfileId: 'missing', ftpsAllowSelfSignedCertificate: true };
    const options = await harness.manager.buildConnectOptions(input);
    assert.equal(options.jumpProfileId, undefined);
    assert.equal(options.jumpChain, undefined);
    assert.equal((await harness.manager.saveProfile(input)).jumpProfileId, undefined);
  });
}
