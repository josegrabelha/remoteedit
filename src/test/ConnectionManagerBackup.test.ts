import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConnectionBackupImportOptions, RemoteEditBackupFile } from '../connection/ConnectionManager';
import { createConnectionManagerHarness, profile, secretKey } from './helpers/ConnectionManagerHarness';
import { WORKSPACE_SYNC_ACTIVITY_KEY } from '../workspaceSync/ui/WorkspaceSyncActivityStore';

const exportOptions = { includeSettings: true, includeConnections: true, includeFavorites: true, includeUsernames: true, includeCredentials: false };
const importOptions: ConnectionBackupImportOptions = { includeSettings: true, includeConnections: true, includeFavorites: true,
  includeUsernames: true, restoreCredentials: false, importMode: 'merge' };
const backup = (connections: RemoteEditBackupFile['connections'], version = 3): RemoteEditBackupFile => ({
  remoteEditExportVersion: version, exportedAt: '2026-09-11T00:00:00Z', connections,
  settings: { sshReadyTimeout: 40000 }, settingsKeys: ['sshReadyTimeout'],
  connectionGroups: [{ id: 'group', name: 'Group' }], savedCommands: { target: [{ command: 'pwd' }] }
});

for (const version of [1, 2]) {
  test(`v${version} imports as Direct and overwrites an existing same-ID Jump reference`, async () => {
    const harness = createConnectionManagerHarness([profile('jump'), profile('target', { jumpProfileId: 'jump' })]);
    await harness.manager.importBackupFile(backup([profile('target', { jumpProfileId: 'missing-legacy-field' })], version), importOptions);
    assert.equal((await harness.manager.getProfile('target'))?.jumpProfileId, undefined);
    const exported = await harness.manager.buildBackupFile(exportOptions);
    assert.equal(exported.remoteEditExportVersion, 3);
    assert.equal(exported.connections?.find(item => item.id === 'target')?.jumpProfileId, undefined);
  });
}

test('v3 references survive a real export/import roundtrip in reversed array order', async () => {
  const source = createConnectionManagerHarness([profile('outer'), profile('near', { jumpProfileId: 'outer' }), profile('target', { jumpProfileId: 'near' })]);
  const exported = await source.manager.buildBackupFile(exportOptions);
  exported.connections?.reverse();
  const destination = createConnectionManagerHarness();
  await destination.manager.importBackupFile(exported, { ...importOptions, importMode: 'replace' });
  assert.deepEqual((await destination.manager.listProfiles()).map(item => [item.id, item.jumpProfileId]), [
    ['target', 'near'], ['near', 'outer'], ['outer', undefined]
  ]);
});

test('merge can reference a retained existing Jump, while replace rejects an omitted Jump before all writes', async () => {
  const data = backup([profile('target', { jumpProfileId: 'jump' })]);
  const merged = createConnectionManagerHarness([profile('jump')]);
  await merged.manager.importBackupFile(data, importOptions);
  assert.equal((await merged.manager.getProfile('target'))?.jumpProfileId, 'jump');
  const replaced = createConnectionManagerHarness([profile('jump')]);
  await assert.rejects(replaced.manager.importBackupFile(data, { ...importOptions, importMode: 'replace' }), /not found/);
  assert.deepEqual(replaced.writes, []);
  assert.deepEqual(replaced.ui.configurationWrites, []);
});

for (const change of ['protocol', 'cycle'] as const) {
  test(`merge validates the final graph after overwriting a Jump ${change}`, async () => {
    const harness = createConnectionManagerHarness([profile('jump'), profile('target', { jumpProfileId: 'jump' })]);
    const incoming = change === 'protocol' ? profile('jump', { connectionType: 'ftp' }) : profile('jump', { jumpProfileId: 'target' });
    await assert.rejects(harness.manager.importBackupFile(backup([incoming]), importOptions), /must use SFTP|cycle/);
    assert.deepEqual(harness.writes, []);
    assert.deepEqual(harness.ui.configurationWrites, []);
  });
}

test('duplicate IDs keep the first supported entry and unsupported entries are skipped before graph validation', async () => {
  const harness = createConnectionManagerHarness();
  const data = backup([profile('jump'), profile('jump', { connectionType: 'ftp' }),
    { ...profile('unsupported'), connectionType: 'webdav' }, profile('target', { jumpProfileId: 'jump' })]);
  const result = await harness.manager.importBackupFile(data, importOptions);
  assert.equal(result.skippedUnsupported, 2);
  assert.equal((await harness.manager.getProfile('jump'))?.connectionType, 'sftp');
  const rejected = createConnectionManagerHarness();
  data.connections = [{ ...profile('jump'), connectionType: 'webdav' }, profile('target', { jumpProfileId: 'jump' })];
  await assert.rejects(rejected.manager.importBackupFile(data, importOptions), /not found/);
  assert.deepEqual(rejected.writes, []);
  assert.deepEqual(rejected.ui.configurationWrites, []);
});

for (const connectionType of ['ftp', 'ftps'] as const) {
  test(`v3 ${connectionType} carrying a Jump is rejected, unlike ordinary profile normalization`, async () => {
    const harness = createConnectionManagerHarness();
    await assert.rejects(harness.manager.importBackupFile(backup([profile('jump'), profile('target', { connectionType, jumpProfileId: 'jump' })]), importOptions), /must connect directly/);
    assert.deepEqual(harness.writes, []);
    assert.deepEqual(harness.ui.configurationWrites, []);
  });
}

for (const version of [0, 4]) {
  test(`invalid/future version ${version} fails before settings or storage writes`, async () => {
    const harness = createConnectionManagerHarness();
    await assert.rejects(harness.manager.importBackupFile(backup([profile('target')], version), importOptions), /Invalid|newer/);
    assert.deepEqual(harness.writes, []);
    assert.deepEqual(harness.ui.configurationWrites, []);
  });
}

test('real scrypt/AES-GCM credentials pair same-name profiles by ID and replace removes old secrets', async () => {
  const source = createConnectionManagerHarness([
    profile('outer', { name: 'Same name' }), profile('near', { name: 'Same name', authType: 'privateKey', privateKeyPath: '/synthetic/key', jumpProfileId: 'outer' }),
    profile('target', { name: 'Same name', jumpProfileId: 'near' })
  ]);
  const pairs = [[secretKey('outer', 'password'), 'synthetic-outer'], [secretKey('near', 'passphrase'), 'synthetic-near'], [secretKey('target', 'password'), 'synthetic-target']];
  for (const [key, value] of pairs) source.secrets.set(key, value);
  const plain = await source.manager.buildBackupFile(exportOptions);
  assert.equal(plain.encryptedCredentials, null);
  const encrypted = await source.manager.buildBackupFile({ ...exportOptions, includeCredentials: true, credentialPassword: 'synthetic-backup-key' });
  assert.equal(encrypted.encryptedCredentials?.kdf, 'scrypt');
  assert.equal(encrypted.encryptedCredentials?.cipher, 'aes-256-gcm');
  for (const [, value] of pairs) {
    assert.ok(!JSON.stringify(plain).includes(value));
    assert.ok(!JSON.stringify(encrypted).includes(value));
  }
  const destination = createConnectionManagerHarness([profile('old')]);
  destination.secrets.set(secretKey('old', 'password'), 'synthetic-old');
  const result = await destination.manager.importBackupFile(encrypted, { ...importOptions, importMode: 'replace', restoreCredentials: true, credentialPassword: 'synthetic-backup-key' });
  assert.equal(result.credentialsRestored, 3);
  assert.equal(destination.secrets.has(secretKey('old', 'password')), false);
  for (const [key, value] of pairs) assert.equal(destination.secrets.get(key), value);
  assert.equal((await destination.manager.getProfile('target'))?.jumpProfileId, 'near');
  const publicData = JSON.stringify({ state: [...destination.state], logs: destination.logs });
  for (const [, value] of pairs) assert.ok(!publicData.includes(value));

  const wrongPassword = createConnectionManagerHarness([profile('existing')]);
  await assert.rejects(wrongPassword.manager.importBackupFile(encrypted, { ...importOptions, restoreCredentials: true, credentialPassword: 'wrong' }), /Check the export password/);
  assert.deepEqual(wrongPassword.writes, []);
  assert.deepEqual(wrongPassword.ui.configurationWrites, []);

  const subset = createConnectionManagerHarness();
  await subset.manager.importBackupFile({ ...encrypted, connections: [profile('outer')] }, { ...importOptions, restoreCredentials: true, credentialPassword: 'synthetic-backup-key' });
  assert.deepEqual([...subset.secrets.keys()], [secretKey('outer', 'password')]);
});

test('credential restoration selection requires an encrypted block before any writes', async () => {
  const harness = createConnectionManagerHarness();
  await assert.rejects(harness.manager.importBackupFile(backup([profile('target')]), { ...importOptions, restoreCredentials: true }), /does not contain encrypted/);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.ui.configurationWrites, []);
});

test('merge without restore retains existing secrets; replace without restore removes them', async () => {
  for (const importMode of ['merge', 'replace'] as const) {
    const harness = createConnectionManagerHarness([profile('target')]);
    harness.secrets.set(secretKey('target', 'password'), 'synthetic-existing');
    await harness.manager.importBackupFile(backup([profile('target')]), { ...importOptions, importMode });
    assert.equal(harness.secrets.get(secretKey('target', 'password')), importMode === 'merge' ? 'synthetic-existing' : undefined);
  }
});

test('settings-only import keeps its independent path and does not mutate connection data', async () => {
  const harness = createConnectionManagerHarness([profile('existing')]);
  const result = await harness.manager.importBackupFile(backup([profile('invalid', { jumpProfileId: 'missing' })]), { ...importOptions, includeConnections: false });
  assert.equal(result.settingsImported, true);
  assert.equal(harness.ui.configuration.get('sshReadyTimeout'), 40000);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual((await harness.manager.listProfiles()).map(item => item.id), ['existing']);
});

test('editor root label setting is included in backup and restored', async () => {
  const source = createConnectionManagerHarness();
  source.ui.configuration.set('editorRootLabel', 'connectionName');

  const exported = await source.manager.buildBackupFile({
    ...exportOptions,
    includeConnections: false
  });

  assert.equal(exported.settings?.editorRootLabel, 'connectionName');
  assert.ok(exported.settingsKeys?.includes('editorRootLabel'));

  const destination = createConnectionManagerHarness();
  await destination.manager.importBackupFile(exported, {
    ...importOptions,
    includeConnections: false
  });

  assert.equal(destination.ui.configuration.get('editorRootLabel'), 'connectionName');
});

test('Workspace Sync configuration survives a backup/restore roundtrip without requiring connections', async () => {
  const source = createConnectionManagerHarness();
  const mapping = {
    id: 'ws-production',
    name: 'Production',
    localRoot: '/tmp/project',
    targets: [{
      id: 'target-primary',
      name: 'Primary',
      connectionId: 'conn-production',
      remoteRoot: '/var/www/app',
      enabled: true,
      createdAt: 10,
      updatedAt: 20
    }],
    options: {
      direction: 'localToRemote' as const,
      uploadOnSave: true,
      watchLocalChanges: true,
      watchRemoteChanges: false,
      conflictProtection: true,
      atomicTransfer: true,
      propagateDeletes: false,
      ignorePatterns: ['.git/', 'node_modules/', '.env']
    },
    createdAt: 10,
    updatedAt: 20
  };
  source.state.set('remoteedit.workspaceSync.mappings.v1', [mapping]);
  source.state.set(WORKSPACE_SYNC_ACTIVITY_KEY, [{ id: 1, time: 123, level: 'info', message: 'Local-only Activity marker' }]);

  const exported = await source.manager.buildBackupFile({
    includeSettings: false,
    includeConnections: false,
    includeWorkspaceSync: true,
    includeFavorites: false,
    includeUsernames: false,
    includeCredentials: false
  });

  assert.deepEqual(exported.workspaceSync?.mappings, [mapping]);
  assert.equal('activity' in (exported.workspaceSync || {}), false);
  assert.equal(JSON.stringify(exported).includes('Local-only Activity marker'), false);
  assert.equal('activeMappingId' in (exported.workspaceSync || {}), false);
  assert.equal('activeTargetIds' in (exported.workspaceSync || {}), false);
  const summary = source.manager.summarizeBackupFile(exported);
  assert.equal(summary.workspaceSyncMappingCount, 1);
  assert.equal(summary.workspaceSyncTargetCount, 1);

  const destination = createConnectionManagerHarness();
  const destinationActivity = [{ id: 9, time: 999, level: 'info', message: 'Keep local Activity' }];
  destination.state.set(WORKSPACE_SYNC_ACTIVITY_KEY, destinationActivity);
  const result = await destination.manager.importBackupFile(exported, {
    includeSettings: false,
    includeConnections: false,
    includeWorkspaceSync: true,
    includeFavorites: false,
    includeUsernames: false,
    restoreCredentials: false,
    importMode: 'replace'
  });

  assert.equal(result.workspaceSyncMappingsImported, 1);
  assert.equal(result.workspaceSyncTargetsImported, 1);
  assert.deepEqual(destination.state.get('remoteedit.workspaceSync.mappings.v1'), [mapping]);
  assert.deepEqual(destination.state.get(WORKSPACE_SYNC_ACTIVITY_KEY), destinationActivity);
  assert.equal(destination.state.get('remoteedit.workspaceSync.activeMapping.v1'), mapping.id);
  assert.deepEqual(destination.state.get('remoteedit.workspaceSync.activeTargets.v1'), {});
});

test('Workspace Sync merge rejects a same-name mapping with a different identity before connection writes', async () => {
  const harness = createConnectionManagerHarness([profile('existing')]);
  harness.state.set('remoteedit.workspaceSync.mappings.v1', [{
    id: 'ws-existing', name: 'Production', localRoot: '/tmp/existing',
    targets: [{ id: 'target-existing', name: 'Primary', connectionId: 'existing', remoteRoot: '/existing', enabled: true, createdAt: 1, updatedAt: 1 }],
    options: { direction: 'bidirectional', uploadOnSave: false, watchLocalChanges: false, watchRemoteChanges: false, conflictProtection: true, atomicTransfer: true, propagateDeletes: false, ignorePatterns: [] },
    createdAt: 1, updatedAt: 1
  }]);

  const data = backup([profile('incoming')]);
  data.workspaceSync = {
    mappings: [{
      id: 'ws-incoming', name: 'Production', localRoot: '/tmp/incoming',
      targets: [{ id: 'target-incoming', name: 'Primary', connectionId: 'incoming', remoteRoot: '/incoming', enabled: true, createdAt: 2, updatedAt: 2 }],
      options: { direction: 'bidirectional', uploadOnSave: false, watchLocalChanges: false, watchRemoteChanges: false, conflictProtection: true, atomicTransfer: true, propagateDeletes: false, ignorePatterns: [] },
      createdAt: 2, updatedAt: 2
    }]
  };

  await assert.rejects(harness.manager.importBackupFile(data, {
    ...importOptions,
    includeWorkspaceSync: true
  }), /Workspace Sync mapping 'Production' already exists/);
  assert.deepEqual(harness.writes, []);
});

test('Workspace Sync replace can restore an explicitly empty configuration', async () => {
  const harness = createConnectionManagerHarness();
  harness.state.set('remoteedit.workspaceSync.mappings.v1', [{
    id: 'ws-old', name: 'Old', localRoot: '/tmp/old',
    targets: [{ id: 'target-old', name: 'Old target', connectionId: 'old', remoteRoot: '/old', enabled: true, createdAt: 1, updatedAt: 1 }],
    options: { direction: 'bidirectional', uploadOnSave: false, watchLocalChanges: false, watchRemoteChanges: false, conflictProtection: true, atomicTransfer: true, propagateDeletes: false, ignorePatterns: [] },
    createdAt: 1, updatedAt: 1
  }]);

  const data: RemoteEditBackupFile = {
    remoteEditExportVersion: 3,
    exportedAt: '2026-09-25T00:00:00Z',
    workspaceSync: { mappings: [] }
  };
  const summary = harness.manager.summarizeBackupFile(data);
  assert.equal(summary.hasWorkspaceSync, true);
  assert.equal(summary.workspaceSyncMappingCount, 0);

  await harness.manager.importBackupFile(data, {
    includeSettings: false,
    includeConnections: false,
    includeWorkspaceSync: true,
    includeFavorites: false,
    includeUsernames: false,
    restoreCredentials: false,
    importMode: 'replace'
  });

  assert.deepEqual(harness.state.get('remoteedit.workspaceSync.mappings.v1'), []);
  assert.deepEqual(harness.state.get('remoteedit.workspaceSync.activeTargets.v1'), {});
});

test('Workspace Sync UI settings survive a settings backup/restore roundtrip', async () => {
  const source = createConnectionManagerHarness();
  source.ui.configuration.set('workspaceSync.editorTitleButtonPosition', 'right');
  source.ui.configuration.set('workspaceSync.statusBarButtonPosition', 'right');
  source.ui.configuration.set('workspaceSync.statusBarButtonStyle', 'textOnly');
  source.ui.configuration.set('workspaceSync.statusBarButtonPriority', 777);

  const exported = await source.manager.buildBackupFile({
    includeSettings: true,
    includeConnections: false,
    includeWorkspaceSync: false,
    includeFavorites: false,
    includeUsernames: false,
    includeCredentials: false
  });

  assert.equal(exported.settings?.['workspaceSync.editorTitleButtonPosition'], 'right');
  assert.equal(exported.settings?.['workspaceSync.statusBarButtonPosition'], 'right');
  assert.equal(exported.settings?.['workspaceSync.statusBarButtonStyle'], 'textOnly');
  assert.equal(exported.settings?.['workspaceSync.statusBarButtonPriority'], 777);
  assert.ok(exported.settingsKeys?.includes('workspaceSync.editorTitleButtonPosition'));
  assert.ok(exported.settingsKeys?.includes('workspaceSync.statusBarButtonPosition'));
  assert.ok(exported.settingsKeys?.includes('workspaceSync.statusBarButtonStyle'));
  assert.ok(exported.settingsKeys?.includes('workspaceSync.statusBarButtonPriority'));

  const destination = createConnectionManagerHarness();
  const result = await destination.manager.importBackupFile(exported, {
    includeSettings: true,
    includeConnections: false,
    includeWorkspaceSync: false,
    includeFavorites: false,
    includeUsernames: false,
    restoreCredentials: false,
    importMode: 'merge'
  });

  assert.equal(result.settingsImported, true);
  assert.equal(destination.ui.configuration.get('workspaceSync.editorTitleButtonPosition'), 'right');
  assert.equal(destination.ui.configuration.get('workspaceSync.statusBarButtonPosition'), 'right');
  assert.equal(destination.ui.configuration.get('workspaceSync.statusBarButtonStyle'), 'textOnly');
  assert.equal(destination.ui.configuration.get('workspaceSync.statusBarButtonPriority'), 777);

});
