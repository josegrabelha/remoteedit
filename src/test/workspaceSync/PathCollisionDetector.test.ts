import assert from 'node:assert/strict';
import { protectCaseCollisions } from '../../workspaceSync/compare/PathCollisionDetector';
import type { DiffEntry, SyncSnapshot } from '../../workspaceSync/types';
import test from '../helpers/TestHarness';

function snapshot(paths: string[]): SyncSnapshot {
  return {
    capturedAt: 1,
    incompletePaths: [],
    entries: Object.fromEntries(paths.map(relativePath => [relativePath, {
      relativePath,
      fingerprint: { kind: 'file' as const, size: 1, mtimeMs: 1 }
    }]))
  };
}

function diffs(paths: Array<{ path: string; side: 'local' | 'remote' }>): DiffEntry[] {
  return paths.map(item => ({
    relativePath: item.path,
    status: item.side === 'local' ? 'localOnly' : 'remoteOnly',
    ...(item.side === 'local'
      ? { local: { kind: 'file' as const, size: 1, mtimeMs: 1 } }
      : { remote: { kind: 'file' as const, size: 1, mtimeMs: 1 } })
  }));
}

test('PathCollisionDetector blocks unknown Remote case sensitivity but permits proven case-sensitive destinations', () => {
  const local = snapshot(['Readme.md']);
  const remote = snapshot(['README.md']);
  const entries = diffs([{ path: 'Readme.md', side: 'local' }, { path: 'README.md', side: 'remote' }]);

  const blocked = protectCaseCollisions(entries, local, remote, {
    direction: 'localToRemote', localCaseSensitive: true, remoteCaseSensitive: undefined
  });
  assert.deepEqual(blocked.map(entry => entry.status), ['conflict', 'conflict']);
  assert.match(blocked[0].reason || '', /case sensitivity is unknown/i);

  const permitted = protectCaseCollisions(entries, local, remote, {
    direction: 'localToRemote', localCaseSensitive: false, remoteCaseSensitive: true
  });
  assert.deepEqual(permitted.map(entry => entry.status), ['localOnly', 'remoteOnly']);
});;

;

test('PathCollisionDetector protects a case-insensitive Local destination from Remote aliases', () => {
  const local = snapshot([]);
  const remote = snapshot(['Config.json', 'config.json']);
  const result = protectCaseCollisions(
    diffs([{ path: 'Config.json', side: 'remote' }, { path: 'config.json', side: 'remote' }]),
    local,
    remote,
    { direction: 'remoteToLocal', localCaseSensitive: false, remoteCaseSensitive: undefined }
  );

  assert.equal(result.every(entry => entry.status === 'conflict'), true);
});
