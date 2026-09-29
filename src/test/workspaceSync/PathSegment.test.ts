import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeSyncPathSegment } from '../../workspaceSync/scan/PathSegment';

test('PathSegment accepts ordinary filesystem entry names', () => {
  assert.doesNotThrow(() => assertSafeSyncPathSegment('app.ts', 'Local'));
  assert.doesNotThrow(() => assertSafeSyncPathSegment('config.production.json', 'Remote'));
  assert.doesNotThrow(() => assertSafeSyncPathSegment('résumé.txt', 'Local'));
});

test('PathSegment rejects names that would change meaning in the neutral sync namespace', () => {
  assert.throws(() => assertSafeSyncPathSegment('nested/file.txt', 'Remote'), /path separator/i);
  assert.throws(() => assertSafeSyncPathSegment('nested\\file.txt', 'Local'), /path separator/i);
  assert.throws(() => assertSafeSyncPathSegment('..', 'Remote'), /invalid.*path segment/i);
  assert.throws(() => assertSafeSyncPathSegment('', 'Local'), /invalid.*path segment/i);
});
