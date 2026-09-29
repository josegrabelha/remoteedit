import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLocalCaseSensitivity } from '../../workspaceSync/compare/LocalFilesystemCapabilities';

function fakeFs(mode: 'sensitive' | 'insensitive' | 'unavailable'): any {
  return {
    async writeFile() {
      if (mode === 'unavailable') {
        const error = new Error('read only') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      }
    },
    async lstat() {
      if (mode === 'sensitive') {
        const error = new Error('missing') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return {};
    },
    async rm() {}
  };
}

test('LocalFilesystemCapabilities detects case-sensitive and case-insensitive volumes', async () => {
  assert.equal(await detectLocalCaseSensitivity('/mapping', fakeFs('sensitive')), true);
  assert.equal(await detectLocalCaseSensitivity('/mapping', fakeFs('insensitive')), false);
});

test('LocalFilesystemCapabilities returns unknown when a safe probe cannot be created', async () => {
  assert.equal(await detectLocalCaseSensitivity('/mapping', fakeFs('unavailable')), undefined);
});
