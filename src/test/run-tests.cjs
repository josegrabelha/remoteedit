// Run only compiled *.test.js files; helpers are not test suites.
// The node:test runner chooses its default (automatic) process concurrency.
// This avoids shell-specific globbing and hand-maintained file lists.
'use strict';

const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const testDirectory = path.join(root, 'out', 'test');
function collect(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return collect(absolute);
      if (!entry.isFile() || !entry.name.endsWith('.test.js')) return [];
      // Ignore stale compiled tests left behind after renaming/removing a source file.
      const relative = path.relative(testDirectory, absolute);
      const source = path.join(root, 'src', 'test', relative.replace(/\.js$/, '.ts'));
      return existsSync(source) ? [absolute] : [];
    });
}

function run() {
  let tests;
  try { tests = collect(testDirectory); }
  catch (error) {
    console.error('Compiled tests are missing. Run npm run compile first.', error.message);
    process.exitCode = 1;
    return;
  }
  if (!tests.length) {
    console.error('No compiled *.test.js files found in out/test.');
    process.exitCode = 1;
    return;
  }

  // Optional node:test flags (e.g. --test-name-pattern) may precede filenames.
  const child = spawn(process.execPath, ['--test', ...process.argv.slice(2), ...tests], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  let startFailed = false;
  child.once('error', error => {
    startFailed = true;
    console.error('Failed to start tests:', error.message);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = startFailed ? 1 : (code ?? (signal ? 1 : 1));
  });
}
run();
