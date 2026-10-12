import assert from 'node:assert/strict';
import { TargetOperationQueue } from '../../workspaceSync/execution/TargetOperationQueue';
import test, { deferred } from '../helpers/TestHarness';


test('TargetOperationQueue serializes the same target while executing unrelated targets independently', async () => {
  const queue = new TargetOperationQueue();
  const gate = deferred();
  const events: string[] = [];
  const first = queue.run('same', async () => {
    events.push('first-start');
    await gate.promise;
    events.push('first-end');
  });
  const queued = queue.run('same', async () => { events.push('second'); });
  const independent = queue.run('unrelated', async () => { events.push('independent'); });

  // The independent target completing gives the runner an observable progress
  // barrier; no fixed sleep is needed to check the still-queued same target.
  try {
    await independent;
    assert.ok(events.includes('first-start'));
    assert.ok(events.includes('independent'));
    assert.equal(events.includes('second'), false);
  } finally {
    gate.resolve();
  }
  await Promise.all([first, queued]);
  assert.ok(events.indexOf('first-end') < events.indexOf('second'));
});;

;

test('Disconnect cancels queued work but keeps active work serialized before reconnect', async () => {
  const queue = new TargetOperationQueue();
  const gate = deferred();
  const calls: string[] = [];
  const active = queue.run('target', async () => { calls.push('active'); await gate.promise; });
  await new Promise(resolve => setImmediate(resolve));
  const waiting = queue.run('target', async () => { calls.push('stale'); });
  const cancelled = assert.rejects(waiting, /cancelled/);
  queue.cancelPending('target');
  await cancelled;
  const reconnect = queue.run('target', async () => { calls.push('reconnect'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['active']);
  gate.resolve();
  await Promise.all([active, reconnect, queue.waitForIdle('target')]);
  assert.deepEqual(calls, ['active', 'reconnect']);
});
