const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Point VSCODE_EXECUTABLE at an installed VS Code executable (Code.exe on Windows).
// The test uses an empty extension and isolated settings; no saved connections are loaded.
const executable = process.env.VSCODE_EXECUTABLE;
if (!executable) {
  throw new Error('Set VSCODE_EXECUTABLE to the VS Code executable before running this test.');
}
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'remoteedit-root-label-test-'));
const extension = path.join(directory, 'extension');
fs.mkdirSync(extension);
const manifest = require(path.join(root, 'package.json'));
fs.writeFileSync(path.join(extension, 'package.json'), JSON.stringify({
  name: 'remoteedit-root-label-test', publisher: 'local-test', version: '0.0.1',
  engines: manifest.engines, main: './extension.js', activationEvents: ['*'],
  contributes: { configuration: manifest.contributes.configuration, resourceLabelFormatters: manifest.contributes.resourceLabelFormatters }
}));
fs.writeFileSync(path.join(extension, 'extension.js'), 'exports.activate = () => {};');
console.log(`Isolated VS Code test data: ${directory}`);
const result = spawnSync(executable, [
  `--extensionDevelopmentPath=${extension}`,
  `--extensionTestsPath=${path.join(root, 'out/test/RemoteEditorRootLabel.integration.js')}`,
  `--user-data-dir=${path.join(directory, 'profile')}`,
  `--extensions-dir=${path.join(directory, 'extensions')}`,
  '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-workspace-trust', '--new-window'
], { stdio: 'inherit', windowsHide: true, timeout: 120000, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
