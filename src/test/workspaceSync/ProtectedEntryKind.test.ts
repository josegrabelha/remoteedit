import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLocalStat } from '../../workspaceSync/scan/LocalEntryKind';
import { classifyFtpEntry } from '../../workspaceSync/connection/FtpEntryKind';
import { normalizeRemoteEntryKind } from '../../workspaceSync/scan/RemoteScanner';

function fakeStat(type: string) {
  return {
    isDirectory: () => type === 'directory',
    isFile: () => type === 'file',
    isSymbolicLink: () => type === 'link',
    isSocket: () => type === 'socket',
    isFIFO: () => type === 'fifo',
    isBlockDevice: () => type === 'block',
    isCharacterDevice: () => type === 'character'
  };
}







test('SFTP preserves special remote entry types as unknown', () => {
  assert.equal(normalizeRemoteEntryKind('-'), 'file');
  assert.equal(normalizeRemoteEntryKind('d'), 'directory');
  assert.equal(normalizeRemoteEntryKind('l'), 'link');
  for (const type of ['s', 'p', 'c', 'b', '?']) assert.equal(normalizeRemoteEntryKind(type), 'unknown');
});
