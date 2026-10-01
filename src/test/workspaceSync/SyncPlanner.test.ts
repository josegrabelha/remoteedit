import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncPlan } from '../../workspaceSync/planning/SyncPlanner';
import type { DiffEntry } from '../../workspaceSync/types';

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

test('SyncPlanner never auto-resolves conflict', () => {
  const plan = buildSyncPlan('m1', 't1', [diff('conflict')], {
    direction: 'bidirectional',
    propagateDeletes: true,
    conflictProtection: true
  });
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.conflicts.length, 1);
});



test('SyncPlanner does not propagate deletes unless enabled', () => {
  const plan = buildSyncPlan('m1', 't1', [diff('localDeleted')], {
    direction: 'bidirectional',
    propagateDeletes: false,
    conflictProtection: true
  });
  assert.equal(plan.operations[0].type, 'skip');
});












test('SyncPlanner blocks a directory delete when the destination contains an unplanned descendant', () => {
  const directory = { kind: 'directory' as const, size: 0, mtimeMs: 1 };
  const file = { kind: 'file' as const, size: 5, mtimeMs: 2 };
  const plan = buildSyncPlan('m1', 't1', [
    {
      relativePath: 'assets',
      status: 'localDeleted',
      remote: directory,
      baseline: { local: directory, remote: directory }
    },
    {
      relativePath: 'assets/remote-only.txt',
      status: 'remoteOnly',
      remote: file
    }
  ], {
    direction: 'bidirectional',
    propagateDeletes: true,
    conflictProtection: true
  });

  assert.equal(plan.operations.some(operation => operation.type === 'deleteRemote' && operation.relativePath === 'assets'), false);
  assert.equal(plan.conflicts.some(conflict => conflict.relativePath === 'assets'), true);
});

test('SyncPlanner permits a directory delete when every destination descendant is part of the same delete plan', () => {
  const directory = { kind: 'directory' as const, size: 0, mtimeMs: 1 };
  const file = { kind: 'file' as const, size: 5, mtimeMs: 1 };
  const plan = buildSyncPlan('m1', 't1', [
    {
      relativePath: 'assets',
      status: 'localDeleted',
      remote: directory,
      baseline: { local: directory, remote: directory }
    },
    {
      relativePath: 'assets/old.txt',
      status: 'localDeleted',
      remote: file,
      baseline: { local: file, remote: file }
    }
  ], {
    direction: 'bidirectional',
    propagateDeletes: true,
    conflictProtection: true
  });

  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.operations.some(operation => operation.type === 'deleteRemote' && operation.relativePath === 'assets'), true);
  assert.equal(plan.operations.some(operation => operation.type === 'deleteRemote' && operation.relativePath === 'assets/old.txt'), true);
});




test('SyncPlanner turns a selected conflict resolution into a planned operation without executing it', () => {
  const entry: DiffEntry = {
    relativePath: 'app.js',
    status: 'conflict',
    resolution: 'useRemote',
    local: { kind: 'file', size: 10, mtimeMs: 100 },
    remote: { kind: 'file', size: 12, mtimeMs: 200 }
  };
  const plan = buildSyncPlan('m1', 't1', [entry], {
    direction: 'bidirectional',
    propagateDeletes: true,
    conflictProtection: true
  });
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].type, 'download');
  assert.match(plan.operations[0].reason, /next Sync will use the Remote version/i);
});





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
