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

test('Save As creates an independent profile from current values and carries unchanged saved credentials securely', async () => {
  const source = profile('ubuntu', {
    name: 'Ubuntu',
    host: 'ubuntu.example.com',
    username: 'admin',
    startPath: '/home/admin',
    favoriteRemotePaths: ['/var/log', '/opt/app']
  });
  const harness = createConnectionManagerHarness([source]);
  harness.secrets.set(secretKey('ubuntu', 'password'), 'synthetic-source-password');

  const saved = await harness.manager.saveProfileAs('ubuntu', {
    name: 'Ubuntu Test',
    host: 'ubuntu.example.com',
    username: 'test-user',
    startPath: '/srv/test',
    rememberPassword: true
  });

  assert.notEqual(saved.id, source.id);
  assert.equal(saved.name, 'Ubuntu Test');
  assert.equal(saved.username, 'test-user');
  assert.equal(saved.startPath, '/srv/test');
  assert.deepEqual(saved.favoriteRemotePaths, ['/var/log', '/opt/app']);
  assert.equal(harness.secrets.get(secretKey(saved.id, 'password')), 'synthetic-source-password');
  assert.equal(harness.secrets.get(secretKey(source.id, 'password')), 'synthetic-source-password');

  const original = await harness.manager.getProfile(source.id);
  assert.equal(original?.name, 'Ubuntu');
  assert.equal(original?.username, 'admin');
  assert.equal(original?.startPath, '/home/admin');

  await assert.rejects(
    harness.manager.saveProfileAs('ubuntu', { name: 'ubuntu', host: 'other.invalid', username: 'other' }),
    /already exists/i
  );
});



test('Master Password resolves across protocols and Jump Hosts without exposing or copying the secret', async () => {
  const h = createConnectionManagerHarness([
    profile('jump', { passwordSource: 'master' }),
    profile('sftp', { passwordSource: 'master', jumpProfileId: 'jump' }),
    profile('ftp', { connectionType: 'ftp', passwordSource: 'master' }),
    profile('ftps', { connectionType: 'ftps', passwordSource: 'master', ftpsAllowSelfSignedCertificate: true })
  ]);
  await h.manager.setMasterPassword('synthetic-master', 'synthetic-master');
  for (const id of ['sftp', 'ftp', 'ftps']) {
    const options = await h.manager.buildConnectOptions({ id, password: 'ignored-individual' });
    assert.equal(options.password, 'synthetic-master');
    if (id === 'sftp') assert.equal(options.jumpChain?.[0].password, 'synthetic-master');
  }
  assert.deepEqual(await h.manager.getMasterPasswordState(), { configured: true, usedBy: 4 });
  const publicState = JSON.stringify({ profiles: await h.manager.listProfiles(), state: [...h.state], logs: h.logs });
  assert.ok(!publicState.includes('synthetic-master'));
  assert.equal(h.secrets.size, 1);
});

test('Master Password changes and removal apply to Sync and Multi-Target snapshots without fallback', async () => {
  const { loadWorkspaceSyncConnectionSnapshot } = await import('../workspaceSync/connection/WorkspaceSyncConnectionSnapshot');
  const h = createConnectionManagerHarness([profile('jump', { passwordSource: 'master' }), profile('target', { passwordSource: 'master', jumpProfileId: 'jump' })]);
  h.secrets.set(secretKey('target', 'password'), 'stale-individual');
  await h.manager.setMasterPassword('first-global', 'first-global');
  const snapshot = await loadWorkspaceSyncConnectionSnapshot(h.manager, 'target');
  assert.equal(snapshot.password, 'first-global');
  assert.equal(snapshot.jumpChain[0].password, 'first-global');
  await h.manager.setMasterPassword('new-global', 'new-global');
  assert.equal((await loadWorkspaceSyncConnectionSnapshot(h.manager, 'target')).password, 'new-global');
  const before = [...h.state];
  await h.manager.removeMasterPassword();
  assert.deepEqual([...h.state], before);
  await assert.rejects(h.manager.buildConnectOptions({ id: 'target', password: 'ignored' }), /Master Password is not configured/);
  await assert.rejects(loadWorkspaceSyncConnectionSnapshot(h.manager, 'target', async () => { assert.fail('must not prompt for individual password'); }), /Master Password is not configured/);
  assert.equal(h.ui.prompts.length, 0);
  await h.manager.setMasterPassword('restored-global', 'restored-global');
  assert.equal((await h.manager.getProfileCredentials('target')).password, 'restored-global');
});

test('Master Password save, clone and Save As preserve the source while individual and key modes remain independent', async () => {
  const h = createConnectionManagerHarness([profile('target')]);
  h.secrets.set(secretKey('target', 'password'), 'old-individual');
  await h.manager.setMasterPassword('shared-value', 'shared-value');
  await h.manager.saveProfile({ id: 'target', passwordSource: 'master', password: 'ignored', rememberPassword: true });
  assert.equal(h.secrets.has(secretKey('target', 'password')), false);
  const clone = await h.manager.cloneProfile('target');
  const copy = await h.manager.saveProfileAs('target', { name: 'Second copy', host: 'copy.invalid', username: 'user', rememberPassword: true });
  for (const saved of [clone, copy]) {
    assert.equal(saved.passwordSource, 'master');
    assert.equal(h.secrets.has(secretKey(saved.id, 'password')), false);
    assert.equal((await h.manager.buildConnectOptions({ id: saved.id })).password, 'shared-value');
  }
  await h.manager.saveProfile({ id: 'target', passwordSource: 'connection', password: 'own-value', rememberPassword: true });
  assert.equal((await h.manager.buildConnectOptions({ id: 'target' })).password, 'own-value');
  await h.manager.saveProfile({ id: 'target', authType: 'privateKey', privateKeyPath: '/test/key', passwordSource: 'master', passphrase: 'key-value', rememberPassphrase: true });
  await h.manager.removeMasterPassword();
  const key = await h.manager.buildConnectOptions({ id: 'target' });
  assert.equal(key.passphrase, 'key-value');
  assert.equal(key.password, undefined);
  await assert.rejects(h.manager.setMasterPassword('', ''), /required/);
  await assert.rejects(h.manager.setMasterPassword('one', 'two'), /do not match/);
});
