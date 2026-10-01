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
