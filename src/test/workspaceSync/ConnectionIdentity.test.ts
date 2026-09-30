import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceSyncConnectionIdentity } from '../../workspaceSync/connection/ConnectionIdentity';

const base = {
  connectionType: 'sftp' as const,
  host: 'Server.Example.COM.',
  port: 22,
  username: 'deploy',
  jumpChain: [{ host: 'Bastion.Example.COM', port: 22, username: 'jump' }]
};

test('ConnectionIdentity is stable across hostname case and trailing-dot differences', () => {
  const first = buildWorkspaceSyncConnectionIdentity(base);
  const second = buildWorkspaceSyncConnectionIdentity({
    ...base,
    host: 'server.example.com',
    jumpChain: [{ ...base.jumpChain[0], host: 'bastion.example.com.' }]
  });
  assert.equal(first, second);
});

test('ConnectionIdentity changes when the target endpoint or Jump Host route changes', () => {
  const original = buildWorkspaceSyncConnectionIdentity(base);
  assert.notEqual(original, buildWorkspaceSyncConnectionIdentity({ ...base, port: 2222 }));
  assert.notEqual(original, buildWorkspaceSyncConnectionIdentity({
    ...base,
    jumpChain: [{ host: 'other-bastion.example.com', port: 22, username: 'jump' }]
  }));
  assert.notEqual(original, buildWorkspaceSyncConnectionIdentity({ ...base, username: 'other-user' }));
});
