import test from 'node:test';
import assert from 'node:assert/strict';
import { isInitialBidirectionalWatchOperationEnabled, isLocalChangeEnabled, isWatchSourceAuthoritative, mergeLocalChangeSource } from '../../workspaceSync/watcher/WatcherCoalescing';





test('one-way watch treats only the configured source side as authoritative', () => {
  assert.equal(isWatchSourceAuthoritative('localToRemote', 'local'), true);
  assert.equal(isWatchSourceAuthoritative('localToRemote', 'remote'), false);
  assert.equal(isWatchSourceAuthoritative('remoteToLocal', 'local'), false);
  assert.equal(isWatchSourceAuthoritative('remoteToLocal', 'remote'), true);
  assert.equal(isWatchSourceAuthoritative('bidirectional', 'local'), false);
  assert.equal(isWatchSourceAuthoritative('bidirectional', 'remote'), false);
});

test('initial Watch reconciliation makes the configured one-way source authoritative', () => {
  const { initialWatchReconcileDecision } = require('../../workspaceSync/watcher/WatcherCoalescing') as typeof import('../../workspaceSync/watcher/WatcherCoalescing');
  const localOptions = { watchLocalChanges: true, watchRemoteChanges: false };
  assert.deepEqual(initialWatchReconcileDecision('localToRemote', 'remoteChanged', localOptions), { local: true, remote: false, conflict: false });
  assert.deepEqual(initialWatchReconcileDecision('localToRemote', 'conflict', localOptions), { local: true, remote: false, conflict: false });
  assert.deepEqual(initialWatchReconcileDecision('localToRemote', 'remoteOnly', localOptions), { local: false, remote: false, conflict: false });

  const remoteOptions = { watchLocalChanges: false, watchRemoteChanges: true };
  assert.deepEqual(initialWatchReconcileDecision('remoteToLocal', 'localChanged', remoteOptions), { local: false, remote: true, conflict: false });
  assert.deepEqual(initialWatchReconcileDecision('remoteToLocal', 'different', remoteOptions), { local: false, remote: true, conflict: false });
  assert.deepEqual(initialWatchReconcileDecision('remoteToLocal', 'localOnly', remoteOptions), { local: false, remote: false, conflict: false });
});

test('initial Bidirectional Watch reconciles attributable sides once and keeps ambiguous differences manual', () => {
  const { initialWatchReconcileDecision } = require('../../workspaceSync/watcher/WatcherCoalescing') as typeof import('../../workspaceSync/watcher/WatcherCoalescing');
  const both = { watchLocalChanges: true, watchRemoteChanges: true };
  assert.deepEqual(initialWatchReconcileDecision('bidirectional', 'localChanged', both), { local: true, remote: false, conflict: false });
  assert.deepEqual(initialWatchReconcileDecision('bidirectional', 'remoteChanged', both), { local: false, remote: true, conflict: false });
  assert.deepEqual(initialWatchReconcileDecision('bidirectional', 'localDeleted', both), { local: true, remote: false, conflict: false });
  assert.deepEqual(initialWatchReconcileDecision('bidirectional', 'remoteDeleted', both), { local: false, remote: true, conflict: false });
  assert.deepEqual(initialWatchReconcileDecision('bidirectional', 'conflict', both), { local: false, remote: false, conflict: true });
  assert.deepEqual(initialWatchReconcileDecision('bidirectional', 'different', both), { local: false, remote: false, conflict: true });
});



