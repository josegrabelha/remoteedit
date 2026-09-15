import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConnectionManagerHarness, profile, secretKey } from './helpers/ConnectionManagerHarness';

test('real manager resolves each Jump credential by profile identity with no persistence', async () => {
  const harness = createConnectionManagerHarness([
    profile('outer'), profile('middle', { authType: 'privateKey', privateKeyPath: '/synthetic/key', jumpProfileId: 'outer' }),
    profile('near', { jumpProfileId: 'middle' }), profile('target', { jumpProfileId: 'near' })
  ]);
  for (const id of ['outer', 'near', 'target']) harness.secrets.set(secretKey(id, 'password'), `synthetic-${id}-password`);
  harness.secrets.set(secretKey('middle', 'passphrase'), 'synthetic-middle-passphrase');
  const runtime = await harness.manager.buildConnectOptions({ id: 'target' });
  assert.deepEqual(runtime.jumpChain?.map(hop => [hop.profileId, hop.password, hop.passphrase]), [
    ['outer', 'synthetic-outer-password', undefined], ['middle', undefined, 'synthetic-middle-passphrase'],
    ['near', 'synthetic-near-password', undefined]
  ]);
  assert.equal(runtime.password, 'synthetic-target-password');
  assert.deepEqual(harness.writes, []);
  const snapshots = JSON.stringify({ profiles: await harness.manager.listProfiles(), state: [...harness.state], logs: harness.logs });
  for (const secret of harness.secrets.values()) assert.ok(!snapshots.includes(secret));
});

test('a missing Jump password is prompted before connect, stays temporary, and Esc cancels', async () => {
  const harness = createConnectionManagerHarness([profile('jump'), profile('target', { jumpProfileId: 'jump' })]);
  harness.secrets.set(secretKey('target', 'password'), 'synthetic-target');
  harness.ui.inputs.push('synthetic-temporary-jump');
  const runtime = await harness.manager.buildConnectOptions({ id: 'target' });
  assert.equal(runtime.jumpChain?.[0].password, 'synthetic-temporary-jump');
  assert.equal(harness.secrets.has(secretKey('jump', 'password')), false);
  assert.deepEqual(harness.writes, []);
  assert.equal((harness.ui.prompts[0] as any).password, true);
  harness.ui.inputs.push(undefined);
  await assert.rejects(harness.manager.buildConnectOptions({ id: 'target' }), /cancel/i);
  assert.deepEqual(harness.writes, []);
});

test('credential preferences preserve remember semantics and isolate the target from its Jump', async () => {
  const harness = createConnectionManagerHarness([profile('jump'), profile('target', { jumpProfileId: 'jump' })]);
  harness.secrets.set(secretKey('jump', 'password'), 'synthetic-jump');
  await harness.manager.applyCredentialPreferences('target', 'password', { password: 'synthetic-target', rememberPassword: true });
  assert.equal(harness.secrets.get(secretKey('target', 'password')), 'synthetic-target');
  await harness.manager.applyCredentialPreferences('target', 'password', { rememberPassword: true });
  assert.equal(harness.secrets.get(secretKey('target', 'password')), 'synthetic-target');
  await harness.manager.applyCredentialPreferences('target', 'password', { rememberPassword: false });
  assert.equal(harness.secrets.has(secretKey('target', 'password')), false);
  await harness.manager.applyCredentialPreferences('target', 'privateKey', { passphrase: 'synthetic-phrase', rememberPassphrase: true });
  assert.equal(harness.secrets.get(secretKey('target', 'passphrase')), 'synthetic-phrase');
  await harness.manager.applyCredentialPreferences('target', 'privateKey', { rememberPassphrase: false });
  assert.equal(harness.secrets.has(secretKey('target', 'passphrase')), false);
  assert.equal(harness.secrets.get(secretKey('jump', 'password')), 'synthetic-jump');
  assert.ok(harness.writes.every(write => write.key.includes('.target.')));
});

test('saving a profile writes credentials only to SecretStorage and keeps snapshots clean', async () => {
  const harness = createConnectionManagerHarness([profile('jump')]);
  const saved = await harness.manager.saveProfile({ name: 'Saved target', host: 'target.invalid', username: 'user',
    password: 'synthetic-saved-target', rememberPassword: true, jumpProfileId: 'jump' });
  assert.equal(harness.secrets.get(secretKey(saved.id, 'password')), 'synthetic-saved-target');
  const publicWrites = harness.writes.filter(write => write.kind === 'state');
  const snapshots = JSON.stringify({ saved, publicWrites, profiles: await harness.manager.listProfiles(), logs: harness.logs });
  assert.ok(!snapshots.includes('synthetic-saved-target'));
  assert.equal(saved.jumpProfileId, 'jump');
});
