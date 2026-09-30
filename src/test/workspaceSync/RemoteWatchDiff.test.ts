import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRemoteWatchChangedPaths } from '../../workspaceSync/watcher/RemoteWatchDiff';
import type { SyncSnapshot } from '../../workspaceSync/types';

function snapshot(entries: Array<[string, 'file' | 'directory', number, number]>): SyncSnapshot {
  return {
    capturedAt: 1,
    incompletePaths: [],
    entries: Object.fromEntries(entries.map(([relativePath, kind, size, mtimeMs]) => [relativePath, {
      relativePath,
      fingerprint: { kind, size, mtimeMs }
    }]))
  };
}

test('Remote Watch diff detects recursive create, change, and delete candidates', () => {
  const previous = snapshot([
    ['src', 'directory', 0, 10],
    ['src/a.txt', 'file', 10, 10],
    ['old.txt', 'file', 5, 10]
  ]);
  const current = snapshot([
    ['src', 'directory', 0, 20],
    ['src/a.txt', 'file', 11, 20],
    ['src/new.txt', 'file', 2, 20]
  ]);

  assert.deepEqual(collectRemoteWatchChangedPaths(previous, current), [
    'old.txt',
    'src/a.txt',
    'src/new.txt'
  ]);
});

test('Remote Watch diff ignores directory mtime-only changes', () => {
  const previous = snapshot([['nested', 'directory', 0, 10]]);
  const current = snapshot([['nested', 'directory', 0, 99]]);
  assert.deepEqual(collectRemoteWatchChangedPaths(previous, current), []);
});
