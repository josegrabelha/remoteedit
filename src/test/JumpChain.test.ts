import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  JumpChainValidationError,
  resolveJumpProfileChain,
  type JumpChainValidationErrorCode,
  type JumpProfileDescriptor
} from '../connection/JumpChain';
import type { RemoteConnectionType } from '../remote/RemoteConnectionTypes';

function profile(
  id: string,
  jumpProfileId?: string,
  connectionType: RemoteConnectionType = 'sftp'
): JumpProfileDescriptor {
  return {
    id,
    name: `Profile ${id}`,
    connectionType,
    jumpProfileId,
    host: `${id.toLowerCase()}.example.test`,
    port: connectionType === 'sftp' ? 22 : 21
  };
}

function expectJumpError(
  operation: () => unknown,
  code: JumpChainValidationErrorCode
): JumpChainValidationError {
  let captured: JumpChainValidationError | undefined;

  assert.throws(operation, error => {
    assert.ok(error instanceof JumpChainValidationError);
    assert.equal(error.code, code);
    captured = error;
    return true;
  });

  assert.ok(captured);
  return captured;
}

test('resolves Direct, single-hop, and multi-hop chains in network order', () => {
  const outermost = profile('D');
  const middle = profile('C', 'D');
  const nearest = profile('B', 'C');
  const profiles = [nearest, outermost, middle];

  assert.deepEqual(resolveJumpProfileChain(profile('Direct'), profiles), []);
  assert.deepEqual(
    resolveJumpProfileChain(profile('SingleTarget', 'D'), profiles).map(item => item.id),
    ['D']
  );
  assert.deepEqual(
    resolveJumpProfileChain(profile('A', 'B'), profiles).map(item => item.id),
    ['D', 'C', 'B']
  );
});

test('accepts a long finite acyclic chain without an artificial depth cap', () => {
  const hopCount = 512;
  const profiles = Array.from({ length: hopCount }, (_, index) => (
    profile(`J${index}`, index + 1 < hopCount ? `J${index + 1}` : undefined)
  ));

  const chain = resolveJumpProfileChain(profile('Target', 'J0'), profiles);
  assert.equal(chain.length, hopCount);
  assert.equal(chain[0].id, `J${hopCount - 1}`);
  assert.equal(chain.at(-1)?.id, 'J0');
});

test('rejects target and intermediate self-references with stable paths', () => {
  const targetSelf = expectJumpError(
    () => resolveJumpProfileChain(profile('A', 'A'), []),
    'self-reference'
  );
  assert.deepEqual(targetSelf.pathProfileIds, ['A', 'A']);
  assert.equal(targetSelf.profileId, 'A');

  const intermediateSelf = expectJumpError(
    () => resolveJumpProfileChain(profile('A', 'B'), [profile('B', 'B')]),
    'self-reference'
  );
  assert.deepEqual(intermediateSelf.pathProfileIds, ['A', 'B', 'B']);
  assert.equal(intermediateSelf.profileId, 'B');
});

test('rejects cycles that return to the target and cycles wholly inside the Jump graph', () => {
  const targetCycle = expectJumpError(
    () => resolveJumpProfileChain(profile('A', 'B'), [profile('B', 'A')]),
    'cycle'
  );
  assert.deepEqual(targetCycle.pathProfileIds, ['A', 'B', 'A']);

  const internalCycle = expectJumpError(
    () => resolveJumpProfileChain(profile('Target', 'B'), [profile('B', 'C'), profile('C', 'B')]),
    'cycle'
  );
  assert.deepEqual(internalCycle.pathProfileIds, ['Target', 'B', 'C', 'B']);
});

test('detects a long cycle iteratively', () => {
  const hopCount = 96;
  const profiles = Array.from({ length: hopCount }, (_, index) => (
    profile(`Cycle${index}`, index + 1 < hopCount ? `Cycle${index + 1}` : 'Cycle20')
  ));

  const error = expectJumpError(
    () => resolveJumpProfileChain(profile('Target', 'Cycle0'), profiles),
    'cycle'
  );
  assert.equal(error.referencedProfileId, 'Cycle20');
  assert.equal(error.pathProfileIds.length, hopCount + 2);
  assert.equal(error.pathProfileIds.at(-1), 'Cycle20');
});

test('rejects missing, FTP, and FTPS Jump references without falling back to Direct', () => {
  const missing = expectJumpError(
    () => resolveJumpProfileChain(profile('Target', 'missing'), []),
    'missing-profile'
  );
  assert.equal(missing.referencedProfileId, 'missing');
  assert.deepEqual(missing.pathProfileIds, ['Target', 'missing']);

  for (const connectionType of ['ftp', 'ftps'] as const) {
    const unsupported = expectJumpError(
      () => resolveJumpProfileChain(profile('Target', connectionType), [profile(connectionType, undefined, connectionType)]),
      'unsupported-protocol'
    );
    assert.equal(unsupported.profileId, connectionType);
    assert.match(unsupported.message, new RegExp(connectionType, 'i'));
  }
});

test('source keeps iterative visited traversal and defines no Jump depth limit', () => {
  const sourcePath = path.resolve(__dirname, '../../src/connection/JumpChain.ts');
  const source = readFileSync(sourcePath, 'utf8');

  assert.match(source, /new Set<string>\(\)/);
  assert.match(source, /while \(referencedProfileId\)/);
  assert.doesNotMatch(source, /\b(?:maxJump|jumpMax|jumpDepth|maxDepth)\b/i);
  assert.doesNotMatch(source, /\b(?:MAX_[A-Z_]*JUMP|JUMP_[A-Z_]*MAX)\b/);
});
