import assert from 'node:assert/strict';
import { settlesWithin } from '../../workspaceSync/connection/SessionLifetime';
import { TargetOperationQueue } from '../../workspaceSync/execution/TargetOperationQueue';
import test from '../helpers/TestHarness';
import { workspaceSyncControllerHarness } from '../helpers/WorkspaceSyncControllerHarness';

function controllerWithMethods(names: string[]): Record<string, any> {
  return workspaceSyncControllerHarness({
    methods: names,
    preamble: 'const formatDuration = value => String(value);',
    globals: { settlesWithin }
  });
}

test('Disconnect releases a queued target while initial Refresh is blocked in a network read', async () => {
  const harness = await controllerWithMethods(['cancelInitialRefresh', 'disconnect']);
  let resumeRead: () => void = () => {};
  const pendingRead = new Promise<void>(resolve => { resumeRead = resolve; });
  const mapping = { id: 'DEV', targets: [{ id: 'one' }, { id: 'two' }] };
  const interrupted: string[] = [];
  const disconnected: string[] = [];
  const source = { cancelled: false, cancel() { this.cancelled = true; } };

  harness.mappings = { get: () => mapping };
  harness.diagnostics = { timer: () => () => 1, debug: () => {}, performance: () => {} };
  harness.log = () => {};
  harness.runtimeKey = (mappingId: string, targetId: string) => `${mappingId}::${targetId}`;
  harness.sessionKey = harness.runtimeKey;
  harness.disconnectRequested = new Set();
  harness.preparingTargets = new Set(['DEV::one', 'DEV::two']);
  harness.suspendedTargets = new Set();
  harness.initialRefreshTokens = new Map([['DEV', new Set([source])]]);
  harness.backgroundActivityEmitter = { fire: () => {} };
  harness.viewStateChangedEmitter = { fire: () => {} };
  harness.refreshWatchers = () => {};
  harness.sessions = {
    cancelPendingConnection: () => {},
    interruptPendingReads: (key: string) => {
      interrupted.push(key);
      if (key === 'DEV::one') resumeRead();
      return false;
    },
    disconnect: async (key: string) => { disconnected.push(key); }
  };
  // Model a metadata read holding the target queue until the adapter interrupts it.
  harness.operations = new TargetOperationQueue();
  const reading = harness.operations.run('DEV::one', () => pendingRead);
  await new Promise(resolve => setImmediate(resolve));

  await harness.disconnect('DEV', 'one');
  await reading;
  assert.equal(source.cancelled, false, 'disconnecting one target must not cancel other targets in the batch');
  assert.deepEqual(interrupted, ['DEV::one']);
  assert.deepEqual(disconnected, ['DEV::one']);
  assert.equal(harness.disconnectRequested.has('DEV::one'), true);
  assert.equal(harness.preparingTargets.has('DEV::one'), false);
  assert.equal(harness.preparingTargets.has('DEV::two'), true);
});

test('Cancelling initial Refresh keeps established sessions connected and uses soft cancellation', async () => {
  const harness = await controllerWithMethods(['cancelInitialRefresh']);
  const mapping = { id: 'TST', targets: [{ id: 'a' }, { id: 'b' }] };
  const sources = [{ cancelled: false, cancel() { this.cancelled = true; } }, { cancelled: false, cancel() { this.cancelled = true; } }];
  const interrupts: string[] = [];
  const disconnections: string[] = [];
  const activities: any[] = [];
  harness.mappings = { get: () => mapping };
  harness.initialRefreshTokens = new Map([['TST', new Set(sources)]]);
  harness.runtimeKey = (mappingId: string, targetId: string) => `${mappingId}::${targetId}`;
  harness.sessionKey = harness.runtimeKey;
  harness.preparingTargets = new Set(['TST::a', 'TST::b']);
  harness.sessions = {
    interruptPendingReads: (key: string) => { interrupts.push(key); return true; },
    disconnect: async (key: string) => { disconnections.push(key); }
  };
  harness.backgroundActivityEmitter = { fire: (activity: any) => activities.push(activity) };
  harness.viewStateChangedEmitter = { fire: () => {} };
  harness.log = () => {};

  harness.cancelInitialRefresh('TST');
  await Promise.resolve();
  assert.equal(sources.every(source => source.cancelled), true);
  assert.deepEqual(interrupts, []);
  assert.deepEqual(disconnections, []);
  assert.equal(activities.at(-1)?.cancellable, false, 'the UI must not offer a second Cancel while stopping');
});

test('a late initial preparation failure cannot erase a replacement session state', async () => {
  const harness = await controllerWithMethods(['failInitialPreparation']);
  const oldSession = {};
  const newSession = {};
  const runtime = { marker: 'new-session-plan' };
  harness.runtimeKey = harness.sessionKey = () => 'mapping::target';
  harness.runtimeByTarget = new Map([['mapping::target', runtime]]);
  harness.preparingTargets = new Set(['mapping::target']);
  harness.disconnectRequested = new Set();
  let failures = 0;
  harness.sessions = {
    getSession: () => newSession,
    failConnectedSession: async () => { failures += 1; }
  };
  harness.ui = { log: () => {} };
  await harness.failInitialPreparation({ id: 'mapping', name: 'Mapping' }, { id: 'target', name: 'Target' }, oldSession, new Error('Old read failed'));
  assert.equal(harness.runtimeByTarget.get('mapping::target'), runtime);
  assert.equal(harness.preparingTargets.has('mapping::target'), true);
  assert.equal(failures, 0);
});
