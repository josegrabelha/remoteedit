import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { OperationJournal } from '../../workspaceSync/watcher/OperationJournal';

test('OperationJournal suppresses a local mutation for the full operation lifetime and a grace period', async () => {
  const journal = new OperationJournal(40);
  const root = path.resolve('/tmp/workspace-sync-journal');
  const origin = { mappingId: 'mapping-a', targetId: 'target-a' };
  const finish = journal.beginLocalMutation(root, origin);
  assert.equal(journal.isLocalMutation(path.join(root, 'child.txt'), origin), true);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(journal.isLocalMutation(path.join(root, 'child.txt'), origin), true);
  finish();
  assert.equal(journal.isLocalMutation(path.join(root, 'child.txt'), origin), true);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(journal.isLocalMutation(path.join(root, 'child.txt'), origin), false);
});

test('OperationJournal scopes echo suppression to the mapping and target that caused the mutation', () => {
  const journal = new OperationJournal(1000);
  const file = path.resolve('/tmp/shared-local-root/file.txt');
  const mappingBTargetB = { mappingId: 'mapping-b', targetId: 'target-b' };
  const mappingATargetA = { mappingId: 'mapping-a', targetId: 'target-a' };
  const mappingBTargetC = { mappingId: 'mapping-b', targetId: 'target-c' };

  const finish = journal.beginLocalMutation(file, mappingBTargetB);

  assert.equal(journal.isLocalMutation(file, mappingBTargetB), true, 'origin target must suppress its own echo');
  assert.equal(journal.isLocalMutation(file, mappingATargetA), false, 'another mapping sharing the Local Root must see the change');
  assert.equal(journal.isLocalMutation(file, mappingBTargetC), false, 'another target in the same mapping must see the change');
  assert.equal(journal.isLocalMutation(file), true, 'unscoped diagnostic query still reports an internal mutation');

  finish();
});

test('OperationJournal scopes descendant suppression for directory mutations without hiding overlapping mappings', () => {
  const journal = new OperationJournal(1000);
  const root = path.resolve('/tmp/shared-local-root/folder');
  const child = path.join(root, 'nested', 'file.txt');
  const origin = { mappingId: 'mapping-b', targetId: 'target-b' };
  const observer = { mappingId: 'mapping-a', targetId: 'target-a' };

  const finish = journal.beginLocalMutation(root, origin);
  assert.equal(journal.isLocalMutation(child, origin), true);
  assert.equal(journal.isLocalMutation(child, observer), false);
  finish();
});
