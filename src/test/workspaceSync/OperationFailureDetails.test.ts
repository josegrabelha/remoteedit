import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSyncOperationFailure } from '../../workspaceSync/execution/OperationFailureDetails';
import type { SyncOperation } from '../../workspaceSync/types';

function operation(type: SyncOperation['type'], kind?: 'file' | 'directory'): SyncOperation {
  const fingerprint = kind ? { kind, size: kind === 'file' ? 10 : undefined, mtimeMs: 1 } : undefined;
  return {
    id: 'op-1',
    type,
    relativePath: 'folder/item.txt',
    reason: 'test',
    expectedLocal: type === 'deleteLocal' ? fingerprint : undefined,
    expectedRemote: type === 'deleteRemote' ? fingerprint : undefined
  } as SyncOperation;
}







import { formatSyncErrorOutput } from '../../workspaceSync/execution/OperationFailureDetails';

test('Workspace Sync error output preserves safe protocol details without a stack trace', () => {
  const error = Object.assign(new Error('rmdir: Failure /remote/folder'), { code: 4, path: '/remote/folder' });
  const text = formatSyncErrorOutput(error);
  assert.match(text, /rmdir: Failure \/remote\/folder/);
  assert.match(text, /code=4/);
  assert.doesNotMatch(text, /stack=/i);
});


