import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionManagerHarness, loadWithVscode, profile, secretKey } from '../helpers/ConnectionManagerHarness';

const snapshotModule = loadWithVscode(() => require('../../workspaceSync/connection/WorkspaceSyncConnectionSnapshot') as typeof import('../../workspaceSync/connection/WorkspaceSyncConnectionSnapshot'));
const { loadWorkspaceSyncConnectionSnapshot, resolveWorkspaceSyncJumpChain } = snapshotModule;

test('Workspace Sync connection snapshot reads shared configuration and credentials without Remote Edit runtime helpers', async () => {
  const harness = createConnectionManagerHarness([
    profile('outer'),
    profile('near', { jumpProfileId: 'outer', authType: 'privateKey', privateKeyPath: '/tmp/near-key' }),
    profile('target', { jumpProfileId: 'near', host: 'target.example.com', username: 'deploy' })
  ]);
  harness.secrets.set(secretKey('outer', 'password'), 'outer-secret');
  harness.secrets.set(secretKey('near', 'passphrase'), 'near-secret');
  harness.secrets.set(secretKey('target', 'password'), 'target-secret');

  // This is the architectural boundary: Workspace Sync may read saved config
  // and secrets, but must not delegate connection-runtime construction back to
  // Remote Edit.
  (harness.manager as any).buildConnectOptions = async () => {
    throw new Error('Remote Edit runtime helper must not be used');
  };

  const snapshot = await loadWorkspaceSyncConnectionSnapshot(harness.manager, 'target');

  assert.equal(snapshot.host, 'target.example.com');
  assert.equal(snapshot.profileUpdatedAt, 1);
  assert.equal(snapshot.username, 'deploy');
  assert.equal(snapshot.password, 'target-secret');
  assert.deepEqual(snapshot.jumpChain.map(item => [item.profileId, item.password, item.passphrase]), [
    ['outer', 'outer-secret', undefined],
    ['near', undefined, 'near-secret']
  ]);
  assert.ok(snapshot.connectionIdentity);
  assert.deepEqual(harness.writes, []);
});

test('Workspace Sync jump resolver is independent and rejects cycles', () => {
  const outer = profile('outer');
  const near = profile('near', { jumpProfileId: 'outer' });
  const target = profile('target', { jumpProfileId: 'near' });
  assert.deepEqual(resolveWorkspaceSyncJumpChain(target, [target, near, outer]).map(item => item.id), ['outer', 'near']);

  const cyclicOuter = profile('outer', { jumpProfileId: 'near' });
  assert.throws(
    () => resolveWorkspaceSyncJumpChain(target, [target, near, cyclicOuter]),
    /cycle/i
  );
});

test('Workspace Sync prompts for an unsaved password without persisting it', async () => {
  const harness = createConnectionManagerHarness([profile('target')]);
  const prompts: import('../../workspaceSync/ui/WorkspaceSyncUi').SyncInputOptions[] = [];

  const snapshot = await loadWorkspaceSyncConnectionSnapshot(harness.manager, 'target', async options => {
    prompts.push(options);
    return 'temporary-sync-password';
  });

  assert.equal(snapshot.password, 'temporary-sync-password');
  assert.equal(harness.secrets.has(secretKey('target', 'password')), false);
  assert.ok(prompts.some(prompt => prompt.password === true));
  assert.deepEqual(harness.ui.prompts, []);
  assert.deepEqual(harness.writes, []);
});


test('Workspace Sync snapshots FTPS security configuration without creating Remote Edit runtime state', async () => {
  const harness = createConnectionManagerHarness([
    profile('ftps', {
      connectionType: 'ftps',
      port: 990,
      authType: 'password',
      ftpsAllowSelfSignedCertificate: true,
      ftpsCaCertificatePath: '/tmp/ca.pem'
    })
  ]);
  harness.secrets.set(secretKey('ftps', 'password'), 'ftps-secret');

  const snapshot = await loadWorkspaceSyncConnectionSnapshot(harness.manager, 'ftps');

  assert.equal(snapshot.connectionType, 'ftps');
  assert.equal(snapshot.port, 990);
  assert.equal(snapshot.password, 'ftps-secret');
  assert.equal(snapshot.ftpsAllowSelfSignedCertificate, true);
  assert.equal(snapshot.ftpsCaCertificatePath, '/tmp/ca.pem');
  assert.deepEqual(snapshot.jumpChain, []);
  assert.deepEqual(harness.writes, []);
});

test('Workspace Sync jump resolver rejects non-SFTP targets independently', () => {
  const jump = profile('jump');
  const ftp = profile('ftp', { connectionType: 'ftp', port: 21, jumpProfileId: 'jump' });

  assert.throws(
    () => resolveWorkspaceSyncJumpChain(ftp, [ftp, jump]),
    /only SFTP connections support SSH jump chains/i
  );
});
