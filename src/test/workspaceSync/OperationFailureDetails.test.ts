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

test('Workspace Sync failure guidance explains remote directory delete failures without inventing a cause', () => {
  const text = describeSyncOperationFailure(operation('deleteRemote', 'directory'), 'rmdir: Failure /remote/folder');
  assert.match(text || '', /Refresh and inspect the remaining Remote directory contents and permissions/);
  assert.match(text || '', /may still contain files or may have changed/);
});

test('Workspace Sync failure guidance recommends reconnect and Refresh for connection failures', () => {
  const text = describeSyncOperationFailure(operation('upload'), 'ECONNRESET: socket connection lost');
  assert.match(text || '', /Reconnect the target, run Refresh, and retry/);
  assert.match(text || '', /does not advance its synchronization baseline/);
});

test('Workspace Sync failure guidance is operation-specific for uploads and downloads', () => {
  assert.match(describeSyncOperationFailure(operation('upload'), 'generic failure') || '', /Remote write permissions/);
  assert.match(describeSyncOperationFailure(operation('download'), 'generic failure') || '', /Remote read permissions, Local write permissions/);
});

test('Workspace Sync failure guidance does not add retry instructions to cancellation', () => {
  assert.equal(describeSyncOperationFailure(operation('upload'), 'Workspace Sync operation cancelled.'), undefined);
});

import { formatSyncErrorOutput } from '../../workspaceSync/execution/OperationFailureDetails';

test('Workspace Sync error output preserves safe protocol details without a stack trace', () => {
  const error = Object.assign(new Error('rmdir: Failure /remote/folder'), { code: 4, path: '/remote/folder' });
  const text = formatSyncErrorOutput(error);
  assert.match(text, /rmdir: Failure \/remote\/folder/);
  assert.match(text, /code=4/);
  assert.doesNotMatch(text, /stack=/i);
});

test('Workspace Sync error output includes Node filesystem details when available', () => {
  const error = Object.assign(new Error("ENOENT: no such file or directory, open '/tmp/missing'"), {
    code: 'ENOENT', errno: -2, syscall: 'open', path: '/tmp/missing'
  });
  const text = formatSyncErrorOutput(error);
  assert.match(text, /code=ENOENT/);
  assert.match(text, /errno=-2/);
  assert.match(text, /syscall=open/);
});

test('Workspace Sync error output does not serialize arbitrary error properties', () => {
  const error = Object.assign(new Error('FTP failed'), { code: 550, password: 'secret-value', nested: { token: 'hidden' } });
  const text = formatSyncErrorOutput(error);
  assert.match(text, /code=550/);
  assert.doesNotMatch(text, /secret-value|hidden/);
});
