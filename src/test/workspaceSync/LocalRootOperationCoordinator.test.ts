import assert from 'node:assert/strict';
import * as path from 'path';
import { LocalRootOperationCoordinator } from '../../workspaceSync/execution/LocalRootOperationCoordinator';
import test, { deferred } from '../helpers/TestHarness';


test('LocalRootOperationCoordinator serializes one Local Root while permitting an independent root', async () => {
  const coordinator = new LocalRootOperationCoordinator();
  const gate = deferred();
  const events: string[] = [];
  const root = path.resolve('/tmp/workspace-sync-same');
  const first = coordinator.run(root, async () => {
    events.push('first-start');
    await gate.promise;
    events.push('first-end');
  });
  const queued = coordinator.run(root, async () => { events.push('second'); });
  const independent = coordinator.run(path.resolve('/tmp/workspace-sync-independent'), async () => {
    events.push('independent');
  });

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
    // Unrelated path work is an observable barrier: the aliased write must
    // remain blocked while another independent path can complete.
    try {
      await c.runPaths(real, [{ path: path.join(real, 'other.txt'), mode: 'write' }], async () => {});
      assert.equal(aliasEntered, false, 'Aliases to one real path must conflict');
    } finally {
      gate.resolve();
    }
    await Promise.all([direct, indirect]);
    assert.equal(aliasEntered, true);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});
