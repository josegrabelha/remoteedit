import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLocalCaseSensitivity, inferSnapshotCaseSensitivity, protectCaseCollisions } from '../../workspaceSync/compare/PathCollisionDetector';
import type { DiffEntry, SyncSnapshot } from '../../workspaceSync/types';

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

test('PathCollisionDetector blocks case-only aliases when Remote may be case-insensitive', () => {
  const local = snapshot(['Readme.md']);
  const remote = snapshot(['README.md']);
  const result = protectCaseCollisions(
    diffs([{ path: 'Readme.md', side: 'local' }, { path: 'README.md', side: 'remote' }]),
    local,
    remote,
    { direction: 'localToRemote', localCaseSensitive: true, remoteCaseSensitive: undefined }
  );

  assert.deepEqual(result.map(entry => entry.status), ['conflict', 'conflict']);
  assert.match(result[0].reason || '', /case sensitivity is unknown/i);
});

test('PathCollisionDetector allows case-only names when the destination is proven case-sensitive', () => {
  const local = snapshot(['Readme.md']);
  const remote = snapshot(['README.md']);
  const result = protectCaseCollisions(
    diffs([{ path: 'Readme.md', side: 'local' }, { path: 'README.md', side: 'remote' }]),
    local,
    remote,
    { direction: 'localToRemote', localCaseSensitive: false, remoteCaseSensitive: true }
  );

  assert.deepEqual(result.map(entry => entry.status), ['localOnly', 'remoteOnly']);
});

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




