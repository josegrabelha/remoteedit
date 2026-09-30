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

test('SyncPlanner always protects a known conflict even when unknown change protection is disabled', () => {
  const plan = buildSyncPlan('m1', 't1', [diff('conflict')], {
    direction: 'localToRemote',
    propagateDeletes: true,
    conflictProtection: false
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


test('SyncPlanner treats an untrusted difference as a conflict in Local to Remote mode when protection is enabled', () => {
  const entry: DiffEntry = {
    relativePath: 'existing.txt',
    status: 'different',
    local: { kind: 'file', size: 10, mtimeMs: 100 },
    remote: { kind: 'file', size: 11, mtimeMs: 200 }
  };
  const plan = buildSyncPlan('m1', 't1', [entry], {
    direction: 'localToRemote',
    propagateDeletes: false,
    conflictProtection: true
  });
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.conflicts.length, 1);
});

test('SyncPlanner allows a directional overwrite of an untrusted difference only when unknown change protection is disabled', () => {
  const entry: DiffEntry = {
    relativePath: 'existing.txt',
    status: 'different',
    local: { kind: 'file', size: 10, mtimeMs: 100 },
    remote: { kind: 'file', size: 11, mtimeMs: 200 }
  };
  const plan = buildSyncPlan('m1', 't1', [entry], {
    direction: 'localToRemote',
    propagateDeletes: false,
    conflictProtection: false
  });
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].type, 'upload');
});

test('SyncPlanner creates missing directories rather than skipping them', () => {
  const entry: DiffEntry = {
    relativePath: 'assets',
    status: 'localOnly',
    local: { kind: 'directory', size: 0, mtimeMs: 1 }
  };
  const plan = buildSyncPlan('m1', 't1', [entry], {
    direction: 'localToRemote',
    propagateDeletes: false,
    conflictProtection: true
  });
  assert.equal(plan.operations[0].type, 'createRemoteDirectory');
});

test('SyncPlanner restores a destination deleted out of a directional mapping', () => {
  const local = { kind: 'file' as const, size: 10, mtimeMs: 1 };
  const remoteDeleted: DiffEntry = {
    relativePath: 'a.txt',
    status: 'remoteDeleted',
    local,
    baseline: { local, remote: local }
  };
  const plan = buildSyncPlan('m1', 't1', [remoteDeleted], {
    direction: 'localToRemote',
    propagateDeletes: false,
    conflictProtection: true
  });
  assert.equal(plan.operations[0].type, 'upload');
});

test('SyncPlanner preserves source-side-only files in the opposite directional mode', () => {
  const entry: DiffEntry = {
    relativePath: 'local.txt',
    status: 'localOnly',
    local: { kind: 'file', size: 1, mtimeMs: 1 }
  };
  const plan = buildSyncPlan('m1', 't1', [entry], {
    direction: 'remoteToLocal',
    propagateDeletes: true,
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


test('SyncPlanner preserves side-specific physical paths for execution', () => {
  const localRelativePath = 'folder/c\u0327a\u0303.txt';
  const remoteRelativePath = localRelativePath.normalize('NFC');
  const canonicalPath = remoteRelativePath;
  const entry: DiffEntry = {
    relativePath: canonicalPath,
    localRelativePath,
    remoteRelativePath,
    status: 'localChanged',
    local: { kind: 'file', size: 1, mtimeMs: 2 },
    remote: { kind: 'file', size: 1, mtimeMs: 1 }
  };
  const plan = buildSyncPlan('m1', 't1', [entry], {
    direction: 'localToRemote',
    propagateDeletes: false,
    conflictProtection: true
  });

  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].relativePath, canonicalPath);
  assert.equal(plan.operations[0].localRelativePath, localRelativePath);
  assert.equal(plan.operations[0].remoteRelativePath, remoteRelativePath);
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

test('SyncPlanner lets Skip override an automatic Different operation', () => {
  const entry: DiffEntry = {
    relativePath: 'app.js',
    status: 'different',
    resolution: 'skip',
    local: { kind: 'file', size: 10, mtimeMs: 100 },
    remote: { kind: 'file', size: 12, mtimeMs: 200 }
  };
  const plan = buildSyncPlan('m1', 't1', [entry], {
    direction: 'localToRemote',
    propagateDeletes: true,
    conflictProtection: false
  });
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].type, 'skip');
});

test('SyncPlanner re-evaluates directory delete safety after a child conflict resolution is selected', () => {
  const directory = { kind: 'directory' as const, size: 0, mtimeMs: 1 };
  const file = { kind: 'file' as const, size: 5, mtimeMs: 2 };
  const plan = buildSyncPlan('m1', 't1', [
    {
      relativePath: 'folder',
      status: 'localDeleted',
      remote: directory,
      baseline: { local: directory, remote: directory }
    },
    {
      relativePath: 'folder/app.js',
      status: 'conflict',
      resolution: 'useLocal',
      remote: file,
      baseline: { local: file, remote: file }
    }
  ], {
    direction: 'bidirectional',
    propagateDeletes: true,
    conflictProtection: true
  });

  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.operations.some(operation => operation.type === 'deleteRemote' && operation.relativePath === 'folder/app.js'), true);
  assert.equal(plan.operations.some(operation => operation.type === 'deleteRemote' && operation.relativePath === 'folder'), true);
});
