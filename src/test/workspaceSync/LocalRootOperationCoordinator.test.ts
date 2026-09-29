import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { LocalRootOperationCoordinator, localRootsOverlap } from '../../workspaceSync/execution/LocalRootOperationCoordinator';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('LocalRootOperationCoordinator detects equal, parent/child, and independent roots', () => {
  const base = path.resolve('/tmp/workspace-sync-root');
  assert.equal(localRootsOverlap(base, base), true);
  assert.equal(localRootsOverlap(base, path.join(base, 'nested')), true);
  assert.equal(localRootsOverlap(path.join(base, 'nested'), base), true);
  assert.equal(localRootsOverlap(`${base}-a`, `${base}-b`), false);
});

test('LocalRootOperationCoordinator serializes the same Local Root', async () => {
  const coordinator = new LocalRootOperationCoordinator();
  const gate = deferred();
  const order: string[] = [];
  const root = path.resolve('/tmp/workspace-sync-same');

  const first = coordinator.run(root, async () => {
    order.push('first-start');
    await gate.promise;
    order.push('first-end');
  });
  const second = coordinator.run(root, async () => { order.push('second'); });

  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(order, ['first-start']);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('LocalRootOperationCoordinator serializes parent and child roots', async () => {
  const coordinator = new LocalRootOperationCoordinator();
  const gate = deferred();
  const order: string[] = [];
  const parent = path.resolve('/tmp/workspace-sync-parent');
  const child = path.join(parent, 'child');

  const first = coordinator.run(parent, async () => {
    order.push('parent-start');
    await gate.promise;
    order.push('parent-end');
  });
  const second = coordinator.run(child, async () => { order.push('child'); });

  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(order, ['parent-start']);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['parent-start', 'parent-end', 'child']);
});

test('LocalRootOperationCoordinator allows independent roots to run in parallel', async () => {
  const coordinator = new LocalRootOperationCoordinator();
  const gate = deferred();
  let secondRan = false;

  const first = coordinator.run(path.resolve('/tmp/workspace-sync-independent-a'), async () => {
    await gate.promise;
  });
  const second = coordinator.run(path.resolve('/tmp/workspace-sync-independent-b'), async () => {
    secondRan = true;
  });

  await second;
  assert.equal(secondRan, true);
  gate.resolve();
  await first;
});

test('LocalRootOperationCoordinator preserves FIFO for overlapping waiters and releases after failure', async () => {
  const coordinator = new LocalRootOperationCoordinator();
  const gate = deferred();
  const order: string[] = [];
  const root = path.resolve('/tmp/workspace-sync-fifo');

  const first = coordinator.run(root, async () => {
    order.push('first');
    await gate.promise;
    throw new Error('expected');
  });
  const second = coordinator.run(path.join(root, 'child'), async () => { order.push('second'); });
  const third = coordinator.run(root, async () => { order.push('third'); });

  gate.resolve();
  await assert.rejects(first, /expected/);
  await Promise.all([second, third]);
  assert.deepEqual(order, ['first', 'second', 'third']);
});

test('LocalRootOperationCoordinator allows overlapping shared Refresh work in parallel', async () => {
  const coordinator = new LocalRootOperationCoordinator();
  const gate = deferred();
  const root = path.resolve('/tmp/workspace-sync-shared');
  let secondRan = false;

  const first = coordinator.runShared(root, async () => {
    await gate.promise;
  });
  const second = coordinator.runShared(path.join(root, 'child'), async () => {
    secondRan = true;
  });

  await second;
  assert.equal(secondRan, true);
  gate.resolve();
  await first;
});

test('LocalRootOperationCoordinator keeps shared Refresh work out of an active exclusive mutation', async () => {
  const coordinator = new LocalRootOperationCoordinator();
  const gate = deferred();
  const root = path.resolve('/tmp/workspace-sync-exclusive-blocks-shared');
  const order: string[] = [];

  const mutation = coordinator.run(root, async () => {
    order.push('mutation-start');
    await gate.promise;
    order.push('mutation-end');
  });
  const refresh = coordinator.runShared(root, async () => { order.push('refresh'); });

  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(order, ['mutation-start']);
  gate.resolve();
  await Promise.all([mutation, refresh]);
  assert.deepEqual(order, ['mutation-start', 'mutation-end', 'refresh']);
});

test('LocalRootOperationCoordinator gives an earlier exclusive waiter priority over later shared Refreshes', async () => {
  const coordinator = new LocalRootOperationCoordinator();
  const firstGate = deferred();
  const mutationGate = deferred();
  const root = path.resolve('/tmp/workspace-sync-writer-fairness');
  const order: string[] = [];

  const firstRefresh = coordinator.runShared(root, async () => {
    order.push('refresh-1-start');
    await firstGate.promise;
    order.push('refresh-1-end');
  });
  const mutation = coordinator.run(root, async () => {
    order.push('mutation-start');
    await mutationGate.promise;
    order.push('mutation-end');
  });
  const secondRefresh = coordinator.runShared(root, async () => { order.push('refresh-2'); });

  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(order, ['refresh-1-start']);
  firstGate.resolve();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(order, ['refresh-1-start', 'refresh-1-end', 'mutation-start']);
  mutationGate.resolve();
  await Promise.all([firstRefresh, mutation, secondRefresh]);
  assert.deepEqual(order, ['refresh-1-start', 'refresh-1-end', 'mutation-start', 'mutation-end', 'refresh-2']);
});
