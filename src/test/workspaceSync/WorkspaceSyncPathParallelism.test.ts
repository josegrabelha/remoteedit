import assert from 'node:assert/strict';
import * as path from 'node:path';
import { LocalRootOperationCoordinator } from '../../workspaceSync/execution/LocalRootOperationCoordinator';
import test, { deferred } from '../helpers/TestHarness';
import { workspaceSyncControllerHarness } from '../helpers/WorkspaceSyncControllerHarness';

function harness(): Record<string, any> {
  const h = workspaceSyncControllerHarness({
    methods: ['runWithPlanLocalRootProtection', 'runWithAutomaticPathProtection'],
    functions: ['planLocalPathAccesses', 'remoteEndpointLockRoot'],
    globals: {
      path,
      resolveSyncPaths: (mapping: any, _target: any, relativePath: string, operation: any) => ({
        localPath: path.resolve(mapping.localRoot, operation.localRelativePath || relativePath)
      })
    }
  });
  h.localRootOperations = new LocalRootOperationCoordinator();
  h.remoteEndpointOperations = new LocalRootOperationCoordinator();
  return h;
}


function fixture(root: string) {
  const mapping = { id: 'TST', name: 'TST', localRoot: root };
  const t1 = { id: 'T1', remoteRoot: '/first' };
  const t2 = { id: 'T2', remoteRoot: '/second' };
  const s1 = { connectionIdentity: 'host-1' };
  const s2 = { connectionIdentity: 'host-2' };
  const plan = (type: string, relativePath: string, localRelativePath?: string) => ({
    operations: [{ id: 'op', type, relativePath, localRelativePath }]
  });
  return { mapping, t1, t2, s1, s2, plan };
}

test('Plan-level guards reconcile independent targets in parallel, including two Local downloads', async () => {
  const h = await harness();
  const f = fixture(path.resolve('/tmp/remoteedit-parallel-two-targets'));
  const gate = deferred();
  let secondStarted = false;
  const first = h.runWithPlanLocalRootProtection(f.mapping, f.t1, f.plan('download', 'a.txt'), f.s1,
    async () => { await gate.promise; });
  const second = h.runWithPlanLocalRootProtection(f.mapping, f.t2, f.plan('download', 'b.txt'), f.s2,
    async () => { secondStarted = true; });
  await second;
  assert.equal(secondStarted, true);
  gate.resolve();
  await first;
});

test('A stale second plan revalidates only after the conflicting first download releases the file', async () => {
  const h = await harness();
  const f = fixture(path.resolve('/tmp/remoteedit-parallel-stale'));
  const gate = deferred();
  let localValue = 'old';
  let appliedSecond = false;
  const events: string[] = [];
  const first = h.runWithPlanLocalRootProtection(f.mapping, f.t1, f.plan('download', 'config.json'), f.s1,
    async () => { events.push('first-validated'); await gate.promise; localValue = 'new'; events.push('first-finished'); });
  const second = h.runWithPlanLocalRootProtection(f.mapping, f.t2, f.plan('download', 'config.json'), f.s2,
    async () => {
      events.push('second-validating');
      if (localValue === 'old') appliedSecond = true; // A real revalidator refuses an old fingerprint.
    });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(events, ['first-validated']);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-validated', 'first-finished', 'second-validating']);
  assert.equal(appliedSecond, false, 'The second target cannot apply a stale plan');
});

test('Watch Local readers and Watch Remote writers use the same path lock', async () => {
  const h = await harness();
  const f = fixture(path.resolve('/tmp/remoteedit-parallel-watch'));
  const file = path.join(f.mapping.localRoot, 'index.html');
  const gate = deferred();
  let downloaded = false;
  const localWatch = h.runWithAutomaticPathProtection(f.mapping, f.s1, [{ path: file, mode: 'read' }],
    async () => { await gate.promise; });
  const remoteWatch = h.runWithAutomaticPathProtection(f.mapping, f.s2, [{ path: file, mode: 'write' }],
    async () => { downloaded = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(downloaded, false);
  gate.resolve();
  await Promise.all([localWatch, remoteWatch]);
  assert.equal(downloaded, true);
});

test('Directory creation retains a whole-root fallback; physical aliases stay in the plan footprint', async () => {
  const h = await harness();
  const f = fixture(path.resolve('/tmp/remoteedit-parallel-physical'));
  const gate = deferred();
  let independentStarted = false;
  const first = h.runWithPlanLocalRootProtection(f.mapping, f.t1, f.plan('createLocalDirectory', 'src'), f.s1,
    async () => { await gate.promise; });
  const second = h.runWithPlanLocalRootProtection(f.mapping, f.t2, f.plan('download', 'assets/image.png'), f.s2,
    async () => { independentStarted = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(independentStarted, false, 'Recursive local mkdir must block other writes even at a different path');
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(independentStarted, true);
  const aliasPlan = f.plan('download', 'logical.txt', 'physical.txt');
  const gate2 = deferred();
  let aliasStarted = false;
  const alias = h.runWithPlanLocalRootProtection(f.mapping, f.t1, aliasPlan, f.s1,
    async () => { await gate2.promise; });
  const exact = h.runWithPlanLocalRootProtection(f.mapping, f.t2, f.plan('download', 'physical.txt'), f.s2,
    async () => { aliasStarted = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(aliasStarted, false);
  gate2.resolve();
  await Promise.all([alias, exact]);
  assert.equal(aliasStarted, true);
});
