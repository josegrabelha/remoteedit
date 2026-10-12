import assert from 'node:assert/strict';
import { loadWithVscode } from '../helpers/ConnectionManagerHarness';
import test from '../helpers/TestHarness';

const { RemoteWorkspaceWatcher } = loadWithVscode(() => require('../../workspaceSync/watcher/RemoteWorkspaceWatcher') as typeof import('../../workspaceSync/watcher/RemoteWorkspaceWatcher'));
const mapping: any = {
  id: 'mapping', name: 'Mapping', localRoot: '/local',
  options: { watchLocalChanges: true, watchRemoteChanges: true, uploadOnSave: true, direction: 'bidirectional' },
  targets: [{ id: 'one', enabled: true }, { id: 'two', enabled: true }]
};
const output: any = { appendLine() {} };
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('Remote Watch stops scheduling new polls when disposed mid-poll', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const polled: string[] = [];
  const watcher = new RemoteWorkspaceWatcher(async request => {
    polled.push(request.targetId);
    await gate;
  }, output);
  t.after(() => { watcher.dispose(); release(); });
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
