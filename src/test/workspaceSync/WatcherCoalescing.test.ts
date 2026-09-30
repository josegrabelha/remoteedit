import test from 'node:test';
import assert from 'node:assert/strict';
import { isInitialBidirectionalWatchOperationEnabled, isLocalChangeEnabled, isWatchSourceAuthoritative, mergeLocalChangeSource } from '../../workspaceSync/watcher/WatcherCoalescing';

test('watcher coalescing preserves both save and filesystem watcher origins', () => {
  assert.equal(mergeLocalChangeSource(undefined, 'save'), 'save');
  assert.equal(mergeLocalChangeSource('save', 'save'), 'save');
  assert.equal(mergeLocalChangeSource('watcher', 'watcher'), 'watcher');
  assert.equal(mergeLocalChangeSource('save', 'watcher'), 'both');
  assert.equal(mergeLocalChangeSource('watcher', 'save'), 'both');
  assert.equal(mergeLocalChangeSource('both', 'save'), 'both');
});

test('a coalesced save+watch event runs when either automation option is enabled', () => {
  assert.equal(isLocalChangeEnabled('both', { uploadOnSave: false, watchLocalChanges: true }), true);
  assert.equal(isLocalChangeEnabled('both', { uploadOnSave: true, watchLocalChanges: false }), true);
  assert.equal(isLocalChangeEnabled('both', { uploadOnSave: true, watchLocalChanges: true }), true);
  assert.equal(isLocalChangeEnabled('both', { uploadOnSave: false, watchLocalChanges: false }), false);
});

test('single-origin events still honor their own option', () => {
  assert.equal(isLocalChangeEnabled('save', { uploadOnSave: true, watchLocalChanges: false }), true);
  assert.equal(isLocalChangeEnabled('save', { uploadOnSave: false, watchLocalChanges: true }), false);
  assert.equal(isLocalChangeEnabled('watcher', { uploadOnSave: false, watchLocalChanges: true }), true);
  assert.equal(isLocalChangeEnabled('watcher', { uploadOnSave: true, watchLocalChanges: false }), false);
});

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


test('initial Bidirectional Watch executes Compare-planned operations only for enabled watcher sides', () => {
  const both = { watchLocalChanges: true, watchRemoteChanges: true };
  assert.equal(isInitialBidirectionalWatchOperationEnabled('upload', both), true);
  assert.equal(isInitialBidirectionalWatchOperationEnabled('createRemoteDirectory', both), true);
  assert.equal(isInitialBidirectionalWatchOperationEnabled('deleteRemote', both), true);
  assert.equal(isInitialBidirectionalWatchOperationEnabled('download', both), true);
  assert.equal(isInitialBidirectionalWatchOperationEnabled('createLocalDirectory', both), true);
  assert.equal(isInitialBidirectionalWatchOperationEnabled('deleteLocal', both), true);
  assert.equal(isInitialBidirectionalWatchOperationEnabled('skip', both), false);

  const localOnly = { watchLocalChanges: true, watchRemoteChanges: false };
  assert.equal(isInitialBidirectionalWatchOperationEnabled('upload', localOnly), true);
  assert.equal(isInitialBidirectionalWatchOperationEnabled('download', localOnly), false);

  const remoteOnly = { watchLocalChanges: false, watchRemoteChanges: true };
  assert.equal(isInitialBidirectionalWatchOperationEnabled('upload', remoteOnly), false);
  assert.equal(isInitialBidirectionalWatchOperationEnabled('download', remoteOnly), true);
});
