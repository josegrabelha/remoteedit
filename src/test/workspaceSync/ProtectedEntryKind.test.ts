import assert from 'node:assert/strict';
import { normalizeRemoteEntryKind } from '../../workspaceSync/scan/RemoteScanner';
import test from '../helpers/TestHarness';

test('SFTP preserves special remote entry types as unknown', () => {
  assert.equal(normalizeRemoteEntryKind('-'), 'file');
  assert.equal(normalizeRemoteEntryKind('d'), 'directory');
  assert.equal(normalizeRemoteEntryKind('l'), 'link');
  for (const type of ['s', 'p', 'c', 'b', '?']) assert.equal(normalizeRemoteEntryKind(type), 'unknown');
});
