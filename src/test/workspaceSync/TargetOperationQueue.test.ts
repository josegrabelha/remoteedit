import test from 'node:test';
import assert from 'node:assert/strict';
import { TargetOperationQueue } from '../../workspaceSync/execution/TargetOperationQueue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('TargetOperationQueue serializes operations for the same target', async () => {
  const queue = new TargetOperationQueue();
  const gate = deferred();
  const order: string[] = [];
  const first = queue.run('same', async () => {
    order.push('first-start');
    await gate.promise;
    order.push('first-end');
  });
  const second = queue.run('same', async () => { order.push('second'); });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(order, ['first-start']);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('TargetOperationQueue allows unrelated targets to run independently', async () => {
  const queue = new TargetOperationQueue();
  const gate = deferred();
  let secondRan = false;
  const first = queue.run('a', async () => { await gate.promise; });
  const second = queue.run('b', async () => { secondRan = true; });
  await second;
  assert.equal(secondRan, true);
  gate.resolve();
  await first;
});

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




