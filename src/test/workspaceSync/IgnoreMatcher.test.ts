import test from 'node:test';
import assert from 'node:assert/strict';
import { IgnoreMatcher } from '../../workspaceSync/ignore/IgnoreMatcher';

test('IgnoreMatcher handles directory and wildcard patterns', () => {
  const matcher = new IgnoreMatcher(['node_modules/', '*.log', 'dist/**']);
  assert.equal(matcher.ignores('node_modules/pkg/index.js', false), true);
  assert.equal(matcher.ignores('logs/app.log', false), true);
  assert.equal(matcher.ignores('dist/assets/app.js', false), true);
  assert.equal(matcher.ignores('src/app.ts', false), false);
});

test('IgnoreMatcher applies negation in rule order', () => {
  const matcher = new IgnoreMatcher(['dist/**', '!dist/keep.txt']);
  assert.equal(matcher.ignores('dist/a.js', false), true);
  assert.equal(matcher.ignores('dist/keep.txt', false), false);
});


