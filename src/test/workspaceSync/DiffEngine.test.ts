import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncSnapshot } from '../../workspaceSync/snapshot/SyncSnapshot';
import { diffSnapshots } from '../../workspaceSync/compare/DiffEngine';
import type { FileFingerprint, SyncBaseline } from '../../workspaceSync/types';

const file = (size: number, mtimeMs: number): FileFingerprint => ({ kind: 'file', size, mtimeMs });

function snapshot(entries: Record<string, FileFingerprint>) {
  return createSyncSnapshot(Object.entries(entries).map(([relativePath, fingerprint]) => ({ relativePath, fingerprint })));
}

test('DiffEngine reports same files as same', () => {
  const local = snapshot({ 'a.txt': file(10, 1000) });
  const remote = snapshot({ 'a.txt': file(10, 1000) });
  assert.equal(diffSnapshots(local, remote)[0].status, 'same');
});

test('DiffEngine detects both-sides change as conflict', () => {
  const baseline: SyncBaseline = {
    mappingId: 'm1',
    targetId: 't1',
    capturedAt: 1,
    entries: { 'a.txt': { local: file(10, 1000), remote: file(10, 1000) } }
  };
  const local = snapshot({ 'a.txt': file(11, 5000) });
  const remote = snapshot({ 'a.txt': file(12, 6000) });
  assert.equal(diffSnapshots(local, remote, baseline)[0].status, 'conflict');
});

test('DiffEngine distinguishes remote delete from remote-only absence', () => {
  const baseline: SyncBaseline = {
    mappingId: 'm1',
    targetId: 't1',
    capturedAt: 1,
    entries: { 'a.txt': { local: file(10, 1000), remote: file(10, 1000) } }
  };
  const local = snapshot({ 'a.txt': file(10, 1000) });
  const remote = snapshot({});
  assert.equal(diffSnapshots(local, remote, baseline)[0].status, 'remoteDeleted');
});

test('DiffEngine fails closed when a scan is incomplete', () => {
  const local = createSyncSnapshot([{ relativePath: 'dir/a.txt', fingerprint: file(1, 1) }]);
  const remote = createSyncSnapshot([], ['dir']);
  assert.equal(diffSnapshots(local, remote)[0].status, 'unknown');
});


test('DiffEngine does not trust same-size files when remote mtimes are unreliable and no hashes exist', () => {
  const local = snapshot({ 'a.txt': file(10, 1000) });
  const remote = snapshot({ 'a.txt': file(10, 0) });
  const diffs = diffSnapshots(local, remote, undefined, { remoteMtimeReliable: false });
  assert.equal(diffs[0].status, 'different');
});

test('DiffEngine always reports a file/directory mismatch as a structural conflict', () => {
  const local = snapshot({ 'config': { kind: 'directory', size: 0, mtimeMs: 1000 } });
  const remote = snapshot({ 'config': file(10, 1000) });
  const result = diffSnapshots(local, remote);
  assert.equal(result[0].status, 'conflict');
  assert.match(result[0].reason || '', /structural conflicts/i);
});

test('DiffEngine honors a trusted local hash when metadata is unchanged', () => {
  const baselineLocal: FileFingerprint = { kind: 'file', size: 5, mtimeMs: 1000, hash: 'before' };
  const currentLocal: FileFingerprint = { kind: 'file', size: 5, mtimeMs: 1000, hash: 'after' };
  const baselineRemote: FileFingerprint = { kind: 'file', size: 5, mtimeMs: 2000, hash: 'remote' };
  const baseline: SyncBaseline = {
    mappingId: 'm1',
    targetId: 't1',
    capturedAt: 1,
    entries: { 'a.txt': { local: baselineLocal, remote: baselineRemote } }
  };
  const local = snapshot({ 'a.txt': currentLocal });
  const remote = snapshot({ 'a.txt': baselineRemote });
  assert.equal(diffSnapshots(local, remote, baseline)[0].status, 'localChanged');
});

test('DiffEngine does not let current metadata equality override a trusted one-sided baseline change', () => {
  const baseline: SyncBaseline = {
    mappingId: 'm1',
    targetId: 't1',
    capturedAt: 1,
    entries: {
      'large-file.bin': {
        local: file(100, 1000),
        remote: file(100, 1500)
      }
    }
  };
  // Local changed after the baseline, but the current Local/Remote mtimes are
  // close enough that the old implementation could incorrectly return Same.
  const local = snapshot({ 'large-file.bin': file(100, 1600) });
  const remote = snapshot({ 'large-file.bin': file(100, 1500) });
  const result = diffSnapshots(local, remote, baseline, { mtimeToleranceMs: 2000, remoteMtimeReliable: true });
  assert.equal(result[0].status, 'localChanged');
});

test('DiffEngine trusts matching current hashes after both sides independently changed', () => {
  const baseline: SyncBaseline = {
    mappingId: 'm1',
    targetId: 't1',
    capturedAt: 1,
    entries: {
      'a.txt': {
        local: file(5, 1000),
        remote: file(5, 1000)
      }
    }
  };
  const local = snapshot({ 'a.txt': { kind: 'file', size: 5, mtimeMs: 5000, hash: 'same-hash' } });
  const remote = snapshot({ 'a.txt': { kind: 'file', size: 5, mtimeMs: 6000, hash: 'same-hash' } });
  assert.equal(diffSnapshots(local, remote, baseline)[0].status, 'same');
});

test('DiffEngine treats NFC and NFD spellings as one logical path while preserving side paths', () => {
  const nfc = 'folder/çã-special.txt';
  const nfd = nfc.normalize('NFD');
  assert.notEqual(nfc, nfd);

  const local = createSyncSnapshot([{ relativePath: nfd, fingerprint: file(10, 1000) }]);
  const remote = createSyncSnapshot([{ relativePath: nfc, fingerprint: file(10, 1000) }]);
  const diffs = diffSnapshots(local, remote);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].relativePath, nfc);
  assert.equal(diffs[0].localRelativePath, nfd);
  assert.equal(diffs[0].remoteRelativePath, nfc);
  assert.equal(diffs[0].status, 'same');
});

test('SyncSnapshot rejects two same-side names that collapse to the same Unicode-normalized path', () => {
  const nfc = 'çã-special.txt';
  const nfd = nfc.normalize('NFD');
  assert.throws(() => createSyncSnapshot([
    { relativePath: nfc, fingerprint: file(1, 1) },
    { relativePath: nfd, fingerprint: file(1, 1) }
  ]), /differ only by Unicode normalization/i);
});
