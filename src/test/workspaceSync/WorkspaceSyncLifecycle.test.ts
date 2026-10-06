import test from 'node:test';
import assert from 'node:assert/strict';
import { Client as SshClient } from 'ssh2';
import { PassThrough } from 'node:stream';
import { SyncJumpHostChain } from '../../workspaceSync/connection/SyncJumpHostChain';
import { loadWithVscode, vscodeStub } from '../helpers/ConnectionManagerHarness';

const { WorkspaceWatcher } = loadWithVscode(() => require('../../workspaceSync/watcher/WorkspaceWatcher') as typeof import('../../workspaceSync/watcher/WorkspaceWatcher'));
const { RemoteWorkspaceWatcher } = loadWithVscode(() => require('../../workspaceSync/watcher/RemoteWorkspaceWatcher') as typeof import('../../workspaceSync/watcher/RemoteWorkspaceWatcher'));
const mapping: any = {
  id: 'mapping', name: 'Mapping', localRoot: '/local',
  options: { watchLocalChanges: true, watchRemoteChanges: true, uploadOnSave: true, direction: 'bidirectional' },
  targets: [{ id: 'one', enabled: true }, { id: 'two', enabled: true }]
};
const output: any = { appendLine() {} };
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function sshFixture(t: any, withForward = true) {
  let client!: SshClient;
  let forwardCallback: Function | undefined;
  const stream = new PassThrough();
  t.mock.method(SshClient.prototype, 'connect', function(this: SshClient) {
    client = this;
    queueMicrotask(() => this.emit('ready'));
    return this;
  });
  t.mock.method(SshClient.prototype, 'forwardOut', function(...args: any[]) {
    forwardCallback = args.at(-1);
    if (withForward) forwardCallback!(undefined, stream);
  });
  t.mock.method(SshClient.prototype, 'end', function(this: SshClient) { return this; });
  t.mock.method(SshClient.prototype, 'destroy', function(this: SshClient) { return this; });
  return { get client() { return client; }, get callback() { return forwardCallback; }, stream };
}
const snapshot: any = { host: 'target', port: 22, jumpChain: [{ profileId: 'jump', name: 'Jump', authType: 'password', host: 'jump', port: 22, username: 'test', password: 'test' }] };





test('Remote Watch stops scheduling new polls when disposed mid-poll', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const polled: string[] = [];
  const watcher = new RemoteWorkspaceWatcher(async request => {
    polled.push(request.targetId);
    await gate;
  }, output);
  watcher.refresh([mapping]);
  const tick = (watcher as any).tick();
  await settle();
  watcher.dispose();
  release();
  await tick;
  const countAtDispose = polled.length;
  await (watcher as any).tick();
  assert.equal(polled.length, countAtDispose);
  assert.deepEqual(polled, ['one', 'two']);
});
