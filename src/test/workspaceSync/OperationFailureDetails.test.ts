import assert from 'node:assert/strict';
import test from '../helpers/TestHarness';

import { formatSyncErrorOutput } from '../../workspaceSync/execution/OperationFailureDetails';

test('Workspace Sync error output preserves safe protocol details without a stack trace', () => {
  const error = Object.assign(new Error('rmdir: Failure /remote/folder'), { code: 4, path: '/remote/folder' });
  const text = formatSyncErrorOutput(error);
  assert.match(text, /rmdir: Failure \/remote\/folder/);
  assert.match(text, /code=4/);
  assert.doesNotMatch(text, /stack=/i);
});
