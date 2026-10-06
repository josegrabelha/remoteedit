import { TargetOperationQueue } from '../../workspaceSync/execution/TargetOperationQueue';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { LocalRootOperationCoordinator, localRootsOverlap } from '../../workspaceSync/execution/LocalRootOperationCoordinator';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

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







test('Path coordinator admits independent downloads concurrently but serializes writes to the same file', async () => {
  const c = new LocalRootOperationCoordinator();
  const root = path.resolve('/tmp/ws-parallel-paths');
  const gate = deferred();
  const events: string[] = [];
  const a = c.runPaths(root, [{ path: path.join(root, 'a.txt'), mode: 'write' }], async () => {
    events.push('a-start'); await gate.promise; events.push('a-end');
  });
  const b = c.runPaths(root, [{ path: path.join(root, 'b.txt'), mode: 'write' }], async () => { events.push('b-start'); });
  const same = c.runPaths(root, [{ path: path.join(root, 'a.txt'), mode: 'write' }], async () => { events.push('same-start'); });
  await b;
  assert.deepEqual(events, ['a-start', 'b-start']);
  gate.resolve();
  await Promise.all([a, same]);
  assert.deepEqual(events, ['a-start', 'b-start', 'a-end', 'same-start']);
});











test('Path coordinator recognizes symlink aliases of the same Local Root', async t => {
  if (process.platform === 'win32') return t.skip('Creating directory junctions requires platform-specific privileges; run Windows integration test separately.');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-path-alias-'));
  const real = path.join(scratch, 'real');
  const alias = path.join(scratch, 'alias');
  try {
    await fs.mkdir(real);
    await fs.symlink(real, alias);
    const c = new LocalRootOperationCoordinator();
    const gate = deferred();
    let aliasEntered = false;
    const direct = c.runPaths(real, [{ path: path.join(real, 'file.txt'), mode: 'write' }], async () => { await gate.promise; });
    const indirect = c.runPaths(alias, [{ path: path.join(alias, 'file.txt'), mode: 'write' }], async () => { aliasEntered = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(aliasEntered, false, 'Aliases to one real path must conflict');
    gate.resolve();
    await Promise.all([direct, indirect]);
    assert.equal(aliasEntered, true);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});



