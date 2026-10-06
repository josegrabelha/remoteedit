import test from 'node:test';
import assert from 'node:assert/strict';
import { collectWatchedDeletePaths } from '../../workspaceSync/watcher/WatchedDeletePlan';
import type { FileFingerprint, SyncBaseline } from '../../workspaceSync/types';

const dir: FileFingerprint = { kind: 'directory', size: 0, mtimeMs: 1 };
const file: FileFingerprint = { kind: 'file', size: 1, mtimeMs: 1 };

function baseline(): SyncBaseline {
  return {
    mappingId: 'm1',
    targetId: 't1',
    capturedAt: 1,
    entries: {
      'folder': { local: dir, remote: dir },
      'folder/a.txt': { local: file, remote: file },
      'folder/deep': { local: dir, remote: dir },
      'folder/deep/b.txt': { local: file, remote: file },
      'folder/remote-only.txt': { remote: file },
      'other.txt': { local: file, remote: file }
    }
  };
}

test('WatchedDeletePlan expands a mirrored directory deepest-first and preserves remote-only descendants', () => {
  assert.deepEqual(collectWatchedDeletePaths(baseline(), 'folder'), [
    'folder/deep/b.txt',
    'folder/deep',
    'folder/a.txt',
    'folder'
  ]);
});
