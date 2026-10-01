import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { LocalRootOperationCoordinator } from '../../workspaceSync/execution/LocalRootOperationCoordinator';

async function controllerHarness(methods: string[], globals: Record<string, unknown> = {}): Promise<any> {
  const source = await fs.readFile(path.join(__dirname, '../../../src/workspaceSync/WorkspaceSyncController.ts'), 'utf8');
  const tree = ts.createSourceFile('WorkspaceSyncController.ts', source, ts.ScriptTarget.ES2022, true);
  const klass = tree.statements.find((node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'WorkspaceSyncController');
  assert.ok(klass);
  const members = methods.map(name => {
    const node = klass.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(tree) === name);
    assert.ok(node, `Controller.${name} must exist`);
    return node.getText(tree);
  });
  const code = ts.transpileModule(`class Harness { ${members.join('\n')} }\nHarness;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const Harness = runInNewContext(code, { setTimeout, clearTimeout, Date, Promise, ...globals });
  return new Harness();
}

function mappingFixture() {
  const targets = [
    { id: 'T1', name: 'TST T1', enabled: true, connectionId: 'conn-1', remoteRoot: '/one', updatedAt: 1 },
    { id: 'T2', name: 'TST T2', enabled: true, connectionId: 'conn-2', remoteRoot: '/two', updatedAt: 1 },
    { id: 'T3', name: 'TST T3', enabled: true, connectionId: 'conn-3', remoteRoot: '/three', updatedAt: 1 },
    { id: 'T4', name: 'TST T4', enabled: false, connectionId: 'conn-4', remoteRoot: '/four', updatedAt: 1 }
  ];
  const options = { ignorePatterns: [], watchLocalChanges: true, watchRemoteChanges: true,
    direction: 'bidirectional', propagateDeletes: false, conflictProtection: true, atomicTransfer: true };
  return { id: 'TST', name: 'TST', localRoot: '/shared-root', updatedAt: 1, options, targets };
}

test('Save prepares every connected target, never auto-connects disconnected/disabled targets or depends on combobox selection', async () => {
  const h = await controllerHarness(['saveMapping'], {
    stringArraysEqual: (left: string[], right: string[]) => JSON.stringify(left) === JSON.stringify(right)
  });
  const before = mappingFixture();
  const after = { ...before, updatedAt: 2, options: { ...before.options, ignorePatterns: ['*.tmp'] } };
  const sessions = new Map([['T1', { id: 'session-1' }], ['T2', { id: 'session-2' }], ['T4', { id: 'disabled-session' }]]);
  const keys = (id: string) => `TST::${id}`;
  const scheduled: string[][] = [];
  const cleared: string[] = [];
  const watcherCount: string[][] = [];
  h.validateMappingInput = async () => {};
  h.mappings = {
    get: () => before,
    save: async () => after,
    getActiveTarget: () => { throw new Error('Save must not consult selected Target'); }
  };
  h.sessions = {
    getState: (key: string) => ({ status: sessions.has(key.split('::')[1]) ? 'connected' : 'disconnected' }),
    getSession: (key: string) => sessions.get(key.split('::')[1]),
    connect: () => { throw new Error('Watch must never auto-connect'); }
  };
  h.runtimeKey = (_map: string, id: string) => keys(id);
  h.sessionKey = h.runtimeKey;
  h.disconnectRequested = new Set();
  h.preparingTargets = new Set();
  h.initializingMappings = new Map();
  h.runtimeByTarget = new Map();
  h.lastViews = { clear: async (map: string) => { cleared.push(map); } };
  h.remoteWatchSnapshots = new Map();
  h.refreshWatchers = () => watcherCount.push([...h.preparingTargets]);
  h.startPostConnectInitialization = (_mapping: any, items: any[]) => {
    scheduled.push(items.map(item => item.target.id));
    assert.ok(items.every(item => h.preparingTargets.has(keys(item.target.id))), 'No target is operable during preparation');
  };
  h.ui = { notify: () => {} };
  await h.saveMapping({ ...after });
  assert.deepEqual(scheduled, [['T1', 'T2']]);
  assert.deepEqual(cleared, ['TST']);
  assert.equal(h.preparingTargets.has(keys('T3')), false);
  assert.equal(h.preparingTargets.has(keys('T4')), false);
  assert.equal(watcherCount.length, 1);
});



test('Automatic Watch publishes completed Changes before the batch ends without accepting failed paths', async () => {
  const h = await controllerHarness(['reconcileWatchRuntimeCore', 'applyCompletedOperationsToRuntime'], {
    initialWatchReconcileDecision: () => ({ local: true, remote: false, conflict: false }),
    initialWatchOperation: (diff: any) => ({ id: diff.relativePath, type: 'upload', relativePath: diff.relativePath, expectedLocal: diff.local }),
    singleOperationPlan: (_mapping: any, _target: any, operations: any[]) => ({ operations }),
    buildSyncPlan: (_map: string, _target: string, diffs: any[]) => ({ operations: [], conflicts: [], errors: [], diffs }),
    localFilenameStyle: () => 'posix',
    formatDuration: (value: number) => `${value} ms`
  });
  const mapping = mappingFixture();
  const target = mapping.targets[0];
  const session = { id: 'session', capabilities: { filenameStyle: 'posix', reliableMtime: true } };
  const makeDiff = (relativePath: string) => ({
    relativePath, status: 'localChanged', local: { kind: 'file', size: 2, mtimeMs: 0 }
  });
  const runtime = { diffs: [makeDiff('a.txt'), makeDiff('b.txt')], localMutationEpoch: 1, lastComparedAt: 1 };
  const progress: any[] = [];
  const live: any[] = [];
  const journal: any[] = [];
  h.watchRefreshGeneration = 10;
  h.runtimeByTarget = new Map([['TST::T1', runtime]]);
  h.runtimeKey = (_map: string, id: string) => `TST::${id}`;
  h.sessionKey = h.runtimeKey;
  h.sessions = { getSession: () => session };
  h.diagnostics = { timer: () => () => 1, debug: () => {}, performance: () => {} };
  h.ui = { log: () => {} };
  h.journal = {};
  h.backgroundActivityEmitter = { fire: (value: any) => progress.push(value) };
  h.revalidatePlan = async (_m: any, _t: any, plan: any) => ({ valid: plan.operations, stale: [] });
  h.localRootChangedAfter = () => false;
  h.runWithPlanLocalRootProtection = async (_m: any, _t: any, _p: any, _s: any, task: () => Promise<any>) => task();
  h.scheduleAutomaticViewStateChanged = () => live.push(h.runtimeByTarget.get('TST::T1').diffs.map((item: any) => item.status));
  h.scheduleSharedLocalReclassification = (_m: any, _t: any, ops: any[]) => journal.push(...ops);
  h.updateBaselineForOperations = async (_m: any, _t: any, _s: any, ops: any[]) => {
    assert.deepEqual(ops.map(op => op.relativePath), ['a.txt']);
    return [];
  };
  h.executePlan = async (_m: any, _t: any, plan: any, _s: any, options: any) => {
    options.onActivity({ kind: 'completed', operation: plan.operations[0] });
    await new Promise(resolve => setTimeout(resolve, 120));
    const mid = h.runtimeByTarget.get('TST::T1').diffs;
    assert.equal(mid.find((item: any) => item.relativePath === 'a.txt')?.status, 'same');
    assert.equal(mid.find((item: any) => item.relativePath === 'b.txt')?.status, 'localChanged');
    options.onActivity({ kind: 'failed', operation: plan.operations[1], message: 'Remote temporarily unavailable' });
    return { completed: [plan.operations[0]], failed: [{ operation: plan.operations[1] }], skipped: [], deferred: [], cancelled: false };
  };
  const changed = await h.reconcileWatchRuntimeCore(mapping, target, session, runtime, 10);
  assert.equal(changed, false);
  assert.equal(live.length > 0, true);
  assert.deepEqual([...h.runtimeByTarget.get('TST::T1').diffs.map((item: any) => item.status)], ['same', 'localChanged']);
  assert.deepEqual(journal.map(item => item.relativePath), ['a.txt']);
});



test('A watcher create/change retry that now finds Local missing is reclassified through the normal delete path', async () => {
  const remote = { kind: 'file', size: 12, mtimeMs: 100 };
  const executed: any[] = [];
  const refreshed: any[] = [];
  const h = await controllerHarness(['handleWatchedChangeForTarget'], {
    crypto: { randomUUID: () => 'retry-delete' },
    isWatchSourceAuthoritative: (direction: string, side: string) => direction === 'localToRemote' && side === 'local',
    resolveSyncPaths: (_mapping: any, _target: any, relativePath: string) => ({
      localPath: `/shared-root/${relativePath}`,
      remotePath: `/remote/${relativePath}`,
      localRelativePath: relativePath,
      remoteRelativePath: relativePath
    }),
    readAndClassifyCurrentPath: async () => ({
      local: undefined,
      remote,
      diff: { relativePath: 'gone.txt', status: 'localDeleted', remote }
    }),
    collectWatchedDeletePaths: () => [],
    readRemoteFingerprint: async () => remote,
    singleOperationPlan: (_mapping: any, _target: any, operations: any[]) => ({ operations })
  });
  const mapping = {
    ...mappingFixture(),
    options: { ...mappingFixture().options, direction: 'localToRemote', propagateDeletes: true }
  };
  const target = mapping.targets[0];
  const session = { capabilities: { reliableMtime: true } };
  h.mappings = { get: () => mapping };
  h.getConnectedAutomaticSession = () => session;
  h.ensureBaselineContext = async () => {};
  h.baselines = { get: async () => undefined, updatePath: async () => {} };
  h.refreshAutomaticPathsInView = async (...args: any[]) => refreshed.push(args);
  h.revalidatePlan = async (_mapping: any, _target: any, plan: any) => ({ valid: plan.operations, stale: [] });
  h.executePlan = async (_mapping: any, _target: any, plan: any) => {
    executed.push(...plan.operations);
    return { completed: plan.operations, failed: [], skipped: [], deferred: [], cancelled: false };
  };
  h.updateBaselineForOperations = async () => {};
  h.reflectAutomaticOperationsInView = async () => {};
  h.scheduleLocalWatchRetry = () => { throw new Error('Successful reclassification must not schedule another retry'); };
  h.reportAutomaticConflict = async () => { throw new Error('Authoritative delete must not report a conflict'); };
  h.log = () => {};
  h.ui = { log: () => {} };

  await h.handleWatchedChangeForTarget(mapping, target, {
    mappingId: mapping.id,
    relativePath: 'gone.txt',
    physicalRelativePath: 'gone.txt',
    absolutePath: '/shared-root/gone.txt',
    kind: 'change',
    source: 'watcher'
  });

  assert.equal(executed.length, 1);
  assert.equal(executed[0].type, 'deleteRemote');
  assert.equal(executed[0].relativePath, 'gone.txt');
  assert.ok(refreshed.length >= 1);
});





test('A completed download reclassifies every other connected target sharing the Local Root, regardless of Watch selection', async () => {
  const path = await import('node:path');
  const h = await controllerHarness(['scheduleSharedLocalReclassification', 'localRootChangedAfter'], {
    path,
    localRootsOverlap: (a: string, b: string) => a === b,
    IgnoreMatcher: class { ignores() { return false; } },
    loadEffectiveIgnorePatterns: async () => []
  });
  const tst = mappingFixture();
  const dev = { ...mappingFixture(), id: 'DEV', name: 'DEV',
    targets: [
      { id: 'D1', name: 'DEV T1', enabled: true },
      { id: 'D2', name: 'DEV T2', enabled: true }
    ], options: { ...tst.options, watchLocalChanges: false } };
  const unrelated = { ...dev, id: 'OTHER', localRoot: '/unrelated' };
  const mappings = [tst, dev, unrelated];
  const connected = new Set(['TST::T1', 'DEV::D1', 'DEV::D2', 'OTHER::D1']);
  const observed: string[] = [];
  h.mappings = { list: () => mappings, get: (id: string) => mappings.find(mapping => mapping.id === id) };
  h.runtimeKey = (mapping: string, target: string) => `${mapping}::${target}`;
  h.sessionKey = h.runtimeKey;
  const sessionByKey = new Map([...connected].map(key => [key, { id: key }]));
  h.sessions = { getSession: (key: string) => sessionByKey.get(key) };
  h.getConnectedAutomaticSession = (mapping: string, target: string) => sessionByKey.get(`${mapping}::${target}`);
  h.localRootOperations = new LocalRootOperationCoordinator();
  h.operations = { run: async (_key: string, fn: () => Promise<any>) => fn() };
  h.runWithAutomaticPathProtection = async (mapping: any, _session: any, accesses: any[], task: () => Promise<any>) =>
    h.localRootOperations.runPaths(mapping.localRoot, accesses, task);
  h.pendingSharedLocalPaths = new Map();
  h.localMutationEpoch = 0;
  h.lastLocalMutationByRoot = new Map();
  h.refreshAutomaticPathsInView = async (mapping: any, target: any, _session: any, paths: any[]) => {
    observed.push(`${mapping.id}:${target.id}:${paths.map(item => item.relativePath).join(',')}`);
  };
  h.log = () => {};

  const coordinatorLocked = new Promise<void>(resolve => {
    void h.localRootOperations.run('/shared-root', async () => {
      h.scheduleSharedLocalReclassification(tst, tst.targets[0], [{ type: 'download', relativePath: 'folder/a.txt' }]);
      await new Promise(resolveHeld => setTimeout(resolveHeld, 160));
      assert.deepEqual(observed, [], 'A peer must not rescan while another target holds the exclusive Local Root lock');
      resolve();
    });
  });
  await coordinatorLocked;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(h.localRootChangedAfter('/shared-root', 0), true);
  assert.deepEqual(observed.sort(), ['DEV:D1:folder/a.txt', 'DEV:D2:folder/a.txt']);
});



test('A shared Local delete preserves delete semantics when routed into the common Watch pipeline', async () => {
  const path = await import('node:path');
  const h = await controllerHarness(['scheduleSharedLocalReclassification'], {
    path,
    IgnoreMatcher: class { ignores() { return false; } },
    loadEffectiveIgnorePatterns: async () => []
  });
  const tst = mappingFixture();
  const dev = {
    ...mappingFixture(), id: 'DEV', name: 'DEV',
    targets: [{ id: 'D1', name: 'DEV T1', enabled: true }],
    options: { ...tst.options, watchLocalChanges: true, direction: 'bidirectional' }
  };
  const mappings = [tst, dev];
  const session = { id: 'dev-session' };
  const received: any[] = [];
  h.mappings = { list: () => mappings, get: (id: string) => mappings.find(mapping => mapping.id === id) };
  h.runtimeKey = (mapping: string, target: string) => `${mapping}::${target}`;
  h.sessionKey = h.runtimeKey;
  h.sessions = { getSession: (key: string) => key === 'DEV::D1' || key === 'TST::T1' ? session : undefined };
  h.getConnectedAutomaticSession = (mapping: string, target: string) => `${mapping}::${target}` === 'DEV::D1' ? session : undefined;
  h.operations = { run: async (_key: string, fn: () => Promise<any>) => fn() };
  h.runWithAutomaticPathProtection = async (_mapping: any, _session: any, _accesses: any[], task: () => Promise<any>) => task();
  h.handleWatchedChangeForTarget = async (_mapping: any, _target: any, change: any) => received.push(change);
  h.refreshAutomaticPathsInView = async () => {};
  h.pendingSharedLocalPaths = new Map();
  h.localMutationEpoch = 0;
  h.lastLocalMutationByRoot = new Map();
  h.log = () => {};

  h.scheduleSharedLocalReclassification(tst, tst.targets[0], [{
    type: 'deleteLocal', relativePath: 'removed.txt', localRelativePath: 'removed.txt'
  }]);
  await new Promise(resolve => setTimeout(resolve, 160));

  assert.equal(received.length, 1);
  assert.equal(received[0].kind, 'delete');
  assert.equal(received[0].relativePath, 'removed.txt');
});



test('Deferred Watch directory delete automatically re-evaluates only its subtree and retries after releasing locks', async () => {
  const h = await controllerHarness(['reconcileWatchRuntimeCore'], {
    initialWatchReconcileDecision: () => ({ local: false, remote: true, conflict: false }),
    initialWatchOperation: (diff: any) => ({
      id: diff.relativePath,
      type: 'deleteLocal',
      relativePath: diff.relativePath,
      expectedLocal: diff.local,
      expectedRemote: diff.remote
    }),
    singleOperationPlan: (_mapping: any, _target: any, operations: any[]) => ({ operations }),
    formatDuration: (value: number) => `${value} ms`,
    MAX_DEFERRED_DELETE_REEVALUATIONS: 3
  });
  const mapping = { ...mappingFixture(), options: { ...mappingFixture().options, propagateDeletes: true } };
  const target = mapping.targets[0];
  const session = { id: 'session' };
  const directory = { kind: 'directory', size: 0, mtimeMs: 1 };
  const file = { kind: 'file', size: 1, mtimeMs: 1 };
  const initialRuntime = {
    diffs: [{ relativePath: '.dotnet', status: 'remoteDeleted', local: directory, remote: undefined }],
    localMutationEpoch: 1,
    lastComparedAt: 1
  };
  const refreshedRuntime = {
    diffs: [
      { relativePath: '.dotnet/late.lock', status: 'remoteDeleted', local: file, remote: undefined },
      { relativePath: '.dotnet', status: 'remoteDeleted', local: directory, remote: undefined },
      { relativePath: 'unrelated.txt', status: 'localChanged', local: file, remote: file }
    ],
    localMutationEpoch: 2,
    lastComparedAt: 2
  };
  let refreshes = 0;
  let executions = 0;
  const executedPaths: string[][] = [];
  const activity: string[] = [];
  h.watchRefreshGeneration = 10;
  h.diagnostics = { timer: () => () => 1, debug: () => {}, performance: () => {} };
  h.ui = { log: (message: string) => activity.push(message) };
  h.log = () => {};
  h.runtimeKey = (_mapping: string, id: string) => `TST::${id}`;
  h.sessionKey = h.runtimeKey;
  h.sessions = { getSession: () => session };
  h.runtimeByTarget = new Map([['TST::T1', initialRuntime]]);
  h.localRootChangedAfter = () => false;
  h.runWithPlanLocalRootProtection = async (_m: any, _t: any, _p: any, _s: any, task: () => Promise<any>) => task();
  h.localRootOperations = { runShared: async (_root: string, task: () => Promise<any>) => task() };
  h.revalidatePlan = async (_m: any, _t: any, plan: any) => ({ valid: plan.operations, stale: [] });
  h.refreshAutomaticPathsInView = async () => {};
  h.updateBaselineForOperations = async () => [];
  h.compareTargetCore = async () => { throw new Error('Deferred delete retry must not run a full target Refresh.'); };
  h.compareTargetScopesCore = async (_m: any, _t: any, scopes: string[]) => {
    refreshes += 1;
    assert.equal(Array.from(scopes).join(','), '.dotnet');
    return refreshedRuntime;
  };
  h.executePlan = async (_m: any, _t: any, plan: any) => {
    executions += 1;
    executedPaths.push(plan.operations.map((operation: any) => operation.relativePath));
    if (executions === 1) {
      return {
        completed: [], failed: [], skipped: [], cancelled: false,
        deferred: [{ operation: plan.operations[0], reason: 'Directory contents changed' }]
      };
    }
    return { completed: plan.operations, failed: [], skipped: [], deferred: [], cancelled: false };
  };

  const changed = await h.reconcileWatchRuntimeCore(mapping, target, session, initialRuntime, 10);
  assert.equal(changed, true);
  assert.equal(refreshes, 1, 'Deferred delete must trigger one automatic re-evaluation');
  assert.equal(executions, 2);
  assert.equal(Array.from(executedPaths[0]).join(','), '.dotnet');
  assert.equal(Array.from(executedPaths[1]).sort().join(','), '.dotnet,.dotnet/late.lock');
  assert.equal(executedPaths[1].includes('unrelated.txt'), false, 'Deferred retry must stay scoped to the affected subtree');
  assert.equal(activity.some(message => /Re-evaluating deferred Watch delete/.test(message)), true);
});


