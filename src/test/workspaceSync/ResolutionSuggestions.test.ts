import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestConflictResolution } from '../../workspaceSync/compare/ResolutionSuggestions';
import type { DiffEntry, FileFingerprint } from '../../workspaceSync/types';

function file(size: number, mtimeMs: number, hash?: string): FileFingerprint {
  return { kind: 'file', size, mtimeMs, ...(hash ? { hash } : {}) };
}

function conflict(overrides: Partial<DiffEntry> = {}): DiffEntry {
  return {
    relativePath: 'file.txt',
    status: 'conflict',
    local: file(10, 3000, 'local-current'),
    remote: file(10, 2000, 'remote-current'),
    baseline: {
      local: file(10, 1000, 'baseline-local'),
      remote: file(10, 1000, 'baseline-remote')
    },
    ...overrides
  };
}

test('resolution suggestions prefer the side changed against a strong baseline', () => {
  assert.equal(suggestConflictResolution(conflict({
    local: file(10, 1000, 'baseline-local'),
    remote: file(10, 2500, 'remote-current')
  }), { remoteTimestampAbsolute: false }), 'useRemote');

  assert.equal(suggestConflictResolution(conflict({
    local: file(10, 2500, 'local-current'),
    remote: file(10, 1000, 'baseline-remote')
  }), { remoteTimestampAbsolute: false }), 'useLocal');
});

test('resolution suggestions use strong equal hashes and structural safety before timestamps', () => {
  assert.equal(suggestConflictResolution(conflict({
    local: file(10, 3000, 'same-content'),
    remote: file(10, 1000, 'same-content')
  }), { remoteTimestampAbsolute: true }), 'skip');

  assert.equal(suggestConflictResolution(conflict({
    local: { kind: 'directory', size: 0, mtimeMs: 3000 },
    remote: file(10, 2000, 'remote-current')
  }), { remoteTimestampAbsolute: true }), 'skip');
});




test('resolution suggestions never choose a side from timestamp alone', () => {
  const entry = conflict({
    local: file(10, 9000),
    remote: file(10, 3000),
    baseline: undefined
  });
  assert.equal(suggestConflictResolution(entry, { remoteTimestampAbsolute: true, mtimeToleranceMs: 2000 }), undefined);
  assert.equal(suggestConflictResolution(entry, { remoteTimestampAbsolute: false, mtimeToleranceMs: 2000 }), undefined);
});


