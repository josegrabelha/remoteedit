import assert from 'node:assert/strict';
import { buildSyncPlan } from '../../workspaceSync/planning/SyncPlanner';
import type { DiffEntry } from '../../workspaceSync/types';
import test from '../helpers/TestHarness';

function diff(status: DiffEntry['status'], relativePath = 'a.txt'): DiffEntry {
  return { relativePath, status };
}

test('SyncPlanner plans local and remote changes in bidirectional mode', () => {
  const plan = buildSyncPlan('m1', 't1', [
    { relativePath: 'l.txt', status: 'localChanged', local: { kind: 'file', size: 1, mtimeMs: 2 }, remote: { kind: 'file', size: 1, mtimeMs: 1 } },
    { relativePath: 'r.txt', status: 'remoteChanged', local: { kind: 'file', size: 1, mtimeMs: 1 }, remote: { kind: 'file', size: 1, mtimeMs: 2 } }
  ], {
    direction: 'bidirectional',
    propagateDeletes: false,
    conflictProtection: true
  });
  assert.deepEqual(plan.operations.map(op => [op.relativePath, op.type]), [
    ['l.txt', 'upload'],
    ['r.txt', 'download']
  ]);
});

test('SyncPlanner leaves unresolved conflicts untouched, but plans an explicit Remote review decision', () => {
  const options = { direction: 'bidirectional' as const, propagateDeletes: true, conflictProtection: true };
  const unresolved = buildSyncPlan('m1', 't1', [diff('conflict')], options);
  assert.equal(unresolved.operations.length, 0);
  assert.equal(unresolved.conflicts.length, 1);

  const entry: DiffEntry = {
    relativePath: 'app.js',
    status: 'conflict',
    resolution: 'useRemote',
    local: { kind: 'file', size: 10, mtimeMs: 100 },
    remote: { kind: 'file', size: 12, mtimeMs: 200 }
  };
  const reviewed = buildSyncPlan('m1', 't1', [entry], options);
  assert.equal(reviewed.conflicts.length, 0);
  assert.equal(reviewed.operations.length, 1);
  assert.equal(reviewed.operations[0].type, 'download');
  assert.match(reviewed.operations[0].reason, /next Sync will use the Remote version/i);
});;

test('SyncPlanner does not propagate deletes unless enabled', () => {
  const plan = buildSyncPlan('m1', 't1', [diff('localDeleted')], {
    direction: 'bidirectional',
    propagateDeletes: false,
    conflictProtection: true
  });
  assert.equal(plan.operations[0].type, 'skip');
});

test('SyncPlanner protects directory deletion unless every destination descendant is included', () => {
  const directory = { kind: 'directory' as const, size: 0, mtimeMs: 1 };
  const file = { kind: 'file' as const, size: 5, mtimeMs: 2 };
  const parent: DiffEntry = {
    relativePath: 'assets', status: 'localDeleted', remote: directory,
    baseline: { local: directory, remote: directory }
  };
  const options = { direction: 'bidirectional' as const, propagateDeletes: true, conflictProtection: true };
  const blocked = buildSyncPlan('m1', 't1', [parent, {
    relativePath: 'assets/remote-only.txt', status: 'remoteOnly', remote: file
  }], options);
  assert.equal(blocked.operations.some(op => op.type === 'deleteRemote' && op.relativePath === 'assets'), false);
  assert.equal(blocked.conflicts.some(conflict => conflict.relativePath === 'assets'), true);

  const deletedFile = { ...file, mtimeMs: 1 };
  const permitted = buildSyncPlan('m1', 't1', [parent, {
    relativePath: 'assets/old.txt', status: 'localDeleted', remote: deletedFile,
    baseline: { local: deletedFile, remote: deletedFile }
  }], options);
  assert.equal(permitted.conflicts.length, 0);
  assert.equal(permitted.operations.some(op => op.type === 'deleteRemote' && op.relativePath === 'assets'), true);
  assert.equal(permitted.operations.some(op => op.type === 'deleteRemote' && op.relativePath === 'assets/old.txt'), true);
});;

;

;

test('SyncPlanner lets an explicit review decision resolve a plan-level directory conflict', () => {
  const directory = { kind: 'directory' as const, size: 0, mtimeMs: 1 };
  const file = { kind: 'file' as const, size: 5, mtimeMs: 2 };
  const plan = buildSyncPlan('m1', 't1', [
    {
      relativePath: 'folder',
      status: 'localDeleted',
      resolution: 'useRemote',
      remote: directory,
      baseline: { local: directory, remote: directory }
    },
    {
      relativePath: 'folder/new.txt',
      status: 'remoteOnly',
      remote: file
    }
  ], {
    direction: 'bidirectional',
    propagateDeletes: true,
    conflictProtection: true
  });

  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.operations.some(operation => operation.type === 'createLocalDirectory' && operation.relativePath === 'folder'), true);
  assert.equal(plan.operations.some(operation => operation.type === 'download' && operation.relativePath === 'folder/new.txt'), true);
});
