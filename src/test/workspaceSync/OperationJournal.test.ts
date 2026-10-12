import assert from 'node:assert/strict';
import * as path from 'path';
import { OperationJournal } from '../../workspaceSync/watcher/OperationJournal';
import test from '../helpers/TestHarness';

test('OperationJournal suppresses a local mutation for the full operation lifetime and a grace period', t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const journal = new OperationJournal(40);
  const root = path.resolve('/tmp/workspace-sync-journal');
  const origin = { mappingId: 'mapping-a', targetId: 'target-a' };
  const finish = journal.beginLocalMutation(root, origin);
  assert.equal(journal.isLocalMutation(path.join(root, 'child.txt'), origin), true);
  now += 60;
  assert.equal(journal.isLocalMutation(path.join(root, 'child.txt'), origin), true);
  finish();
  assert.equal(journal.isLocalMutation(path.join(root, 'child.txt'), origin), true);
  now += 60;
  assert.equal(journal.isLocalMutation(path.join(root, 'child.txt'), origin), false);
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
