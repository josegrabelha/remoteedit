import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceSyncUi } from '../../workspaceSync/ui/WorkspaceSyncUi';
import { WORKSPACE_SYNC_ACTIVITY_KEY, WorkspaceSyncActivityStore } from '../../workspaceSync/ui/WorkspaceSyncActivityStore';
import { compareText } from '../../workspaceSync/compare/TextComparison';
import { listLocalFolders } from '../../workspaceSync/ui/LocalFolderBrowser';
import { renderWorkspaceSyncBody } from '../../workspaceSync/webview/markup/Body';
import { renderWorkspaceSyncClientScript } from '../../workspaceSync/webview/scripts/ClientScript';
import { renderSyncStyles } from '../../workspaceSync/webview/styles/Styles';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';


class MemoryActivityState {
  readonly values = new Map<string, unknown>();
  updates = 0;

  get<T>(key: string, defaultValue: T): T {
    return this.values.has(key) ? this.values.get(key) as T : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.updates += 1;
    this.values.set(key, value);
  }
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

test('webview request bridge rejects stale responses and cancels inputs on disposal', async () => {
  const ui = new WorkspaceSyncUi(); const messages: any[] = [];
  const detach = ui.attach(message => messages.push(message));
  const pending = ui.input({ title: 'Password', password: true });
  const id = messages[0].request.id;
  ui.respond('stale-id', 'secret'); detach();
  assert.equal(await pending, undefined);
  ui.respond(id, 'late-secret');
  assert.equal(await ui.input({ title: 'Detached input' }), undefined);
});

test('webview validates confirmations and required inputs', async () => {
  const ui = new WorkspaceSyncUi(); let message: any;
  ui.attach(value => { message = value; });
  const confirmation = ui.confirm('Delete?', ['Delete']);
  ui.respond(message.request.id, 'unexpected');
  ui.respond(message.request.id, 'Delete');
  assert.equal(await confirmation, 'Delete');
  const input = ui.input({ required: true });
  ui.respond(message.request.id, '   '); ui.respond(message.request.id, 'value');
  assert.equal(await input, 'value');
});

test('activity bounds history, redacts credentials and clears the webview', async () => {
  const ui = new WorkspaceSyncUi(); const messages: any[] = [];
  ui.attach(value => messages.push(value));
  const pending = ui.input({ password: true });
  ui.respond(messages[0].request.id, 'super-secret'); await pending;
  for (let i = 0; i < 1100; i++) ui.log(`Event ${i}: super-secret password=other-value`, 'error', 'Target');
  const history = ui.snapshot();
  assert.equal(history.length, 1000);
  assert.equal(history[0].id, 101);
  assert.ok(history.every(entry => !entry.message.includes('super-secret') && !entry.message.includes('other-value')));
  ui.clear(); assert.equal(ui.snapshot().length, 0);
  assert.equal(messages.at(-1).type, 'activitySnapshot');
});


test('Activity persists locally in bounded batches and restores after recreation', async () => {
  const state = new MemoryActivityState();
  const store = new WorkspaceSyncActivityStore(state);
  const ui = new WorkspaceSyncUi(store, 5);

  ui.log('First event');
  ui.log('Second event', 'success', 'DEV / Target 1');
  assert.equal(state.updates, 0);

  await delay(20);
  assert.equal(state.updates, 1);

  const persisted = state.get<any[]>(WORKSPACE_SYNC_ACTIVITY_KEY, []);
  assert.deepEqual(persisted.map(entry => entry.message), ['First event', 'Second event']);

  const restored = new WorkspaceSyncUi(new WorkspaceSyncActivityStore(state), 5);
  assert.deepEqual(restored.snapshot().map(entry => entry.message), ['First event', 'Second event']);
  restored.log('Third event');
  assert.equal(restored.snapshot().at(-1)?.id, 3);

  await delay(20);
  restored.dispose();
  ui.dispose();
});


test('Activity disposal flushes pending history before the debounce window', async () => {
  const state = new MemoryActivityState();
  const ui = new WorkspaceSyncUi(new WorkspaceSyncActivityStore(state), 10_000);
  ui.log('Pending restart event');
  assert.equal(state.updates, 0);

  ui.dispose();
  await delay(0);

  const restored = new WorkspaceSyncUi(new WorkspaceSyncActivityStore(state), 5);
  assert.deepEqual(restored.snapshot().map(entry => entry.message), ['Pending restart event']);
  restored.dispose();
});

test('Activity restoration keeps only the most recent 1000 valid events', () => {
  const state = new MemoryActivityState();
  state.values.set(WORKSPACE_SYNC_ACTIVITY_KEY, Array.from({ length: 1005 }, (_, index) => ({
    id: index + 1,
    time: 1000 + index,
    level: 'info',
    message: `Event ${index + 1}`
  })));

  const ui = new WorkspaceSyncUi(new WorkspaceSyncActivityStore(state), 5);
  const history = ui.snapshot();
  assert.equal(history.length, 1000);
  assert.equal(history[0].id, 6);
  assert.equal(history.at(-1)?.id, 1005);
  ui.log('Next event');
  assert.equal(ui.snapshot().at(-1)?.id, 1006);
  ui.dispose();
});

test('Activity Clear removes persisted history and wins over queued writes', async () => {
  class DelayedActivityState extends MemoryActivityState {
    override async update(key: string, value: unknown): Promise<void> {
      this.updates += 1;
      await delay(10);
      this.values.set(key, value);
    }
  }

  const state = new DelayedActivityState();
  const ui = new WorkspaceSyncUi(new WorkspaceSyncActivityStore(state), 1);
  ui.log('Will be cleared');
  await delay(3);
  ui.clear();
  await delay(30);

  assert.deepEqual(state.get<any[]>(WORKSPACE_SYNC_ACTIVITY_KEY, []), []);
  const restored = new WorkspaceSyncUi(new WorkspaceSyncActivityStore(state), 1);
  assert.equal(restored.snapshot().length, 0);
  restored.dispose();
  ui.dispose();
});

test('notifications produce one Activity entry without a header banner message', () => {
  const ui = new WorkspaceSyncUi(); const messages: any[] = [];
  ui.attach(value => messages.push(value));
  ui.notify('Connecting...');
  ui.notify('Path failed validation.', 'warning');
  ui.notify('Transfer failed.', 'error');
  ui.notify('Sync completed.', 'success');
  assert.deepEqual(messages.map(message => message.type), ['activity', 'activity', 'activity', 'activity']);
  assert.deepEqual(ui.snapshot().map(entry => entry.level), ['info', 'warning', 'error', 'success']);
});

test('text comparison reconstructs both inputs including insertions, deletions and CRLF', () => {
  for (const [a, b] of [['one\ntwo\nthree', 'zero\none\nthree'], ['a\r\nb\r\n', 'a\nb\n'], ['', 'new\n'], ['same', 'same'], ['a\na\nb', 'a\nb\nb']]) {
    const lines = compareText(a, b);
    assert.equal(lines.filter(line => line.kind !== 'added').map(line => line.text).join('\n'), a);
    assert.equal(lines.filter(line => line.kind !== 'removed').map(line => line.text).join('\n'), b);
    assert.deepEqual(lines.filter(line => line.localLine).map(line => line.localLine), a.split('\n').map((_, i) => i + 1));
    assert.deepEqual(lines.filter(line => line.remoteLine).map(line => line.remoteLine), b.split('\n').map((_, i) => i + 1));
  }
});

test('large text comparison produces a bounded valid replacement', () => {
  const a = Array.from({length: 2000}, (_, i) => `old ${i}`).join('\n');
  const b = Array.from({length: 2000}, (_, i) => `new ${i}`).join('\n');
  const lines = compareText(a, b);
  assert.equal(lines.length, 4000);
  assert.equal(lines.filter(line => line.kind !== 'added').map(line => line.text).join('\n'), a);
  assert.equal(lines.filter(line => line.kind !== 'removed').map(line => line.text).join('\n'), b);
});

test('local folder browser lists directories and rejects a file path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteedit-browser-'));
  try {
    await fs.mkdir(path.join(root, 'child'));
    await fs.writeFile(path.join(root, 'file.txt'), 'file');
    const listing = await listLocalFolders(root);
    assert.deepEqual(listing.folders.map(item => item.name), ['child']);
    assert.equal(listing.directory, await fs.realpath(root));
    await assert.rejects(listLocalFolders(path.join(root, 'file.txt')), /directory/i);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('Workspace Sync comparison tabs keep conflicts separate from Modified and expose Same', () => {
  const body = renderWorkspaceSyncBody();
  const script = renderWorkspaceSyncClientScript();
  assert.match(body, /data-filter="conflict"[\s\S]*>Conflicts<[\s\S]*data-filter="same"[\s\S]*>Same<[\s\S]*data-filter="all"[\s\S]*>All</);
  assert.match(script, /case 'modified':[\s\S]*\['localChanged', 'remoteChanged'\]\.includes\(entry\.status\)/);
  assert.match(script, /case 'same':[\s\S]*return entry\.status === 'same';/);
});


test('Workspace Sync mapping direction immediately disables incompatible automatic options', () => {
  const script = renderWorkspaceSyncClientScript();
  assert.match(script, /function refreshDirectionalOptionAvailability\(\)/);
  assert.match(script, /const localToRemoteEnabled = direction !== 'remoteToLocal';/);
  assert.match(script, /const remoteToLocalEnabled = direction !== 'localToRemote';/);
  assert.match(script, /\['optUploadSave', 'optWatch'\]/);
  assert.match(script, /if \(!localToRemoteEnabled\) option\.checked = false;/);
  assert.match(script, /if \(!remoteToLocalEnabled\) \$\('optWatchRemote'\)\.checked = false;/);
  assert.match(script, /\$\('mapDirection'\)\.onchange = \(\) => refreshDirectionalOptionAvailability\(\);/);
});

test('Workspace Sync mapping options use click-only bundled question help for every option', () => {
  const questionSvg = '<svg data-test-question="true" viewBox="0 0 16 16"><path d="M1 1h14v14H1z"/></svg>';
  const body = renderWorkspaceSyncBody(questionSvg);
  const script = renderWorkspaceSyncClientScript();
  assert.match(body, /Unknown Change Protection/);
  assert.doesNotMatch(body, />\s*Conflict Protection\s*</);
  assert.equal((body.match(/data-option-help=/g) || []).length, 8);
  assert.equal((body.match(/data-test-question="true"/g) || []).length, 8);
  for (const key of ['unknownChangeProtection', 'atomicTransfer', 'propagateDeletes', 'uploadOnSave', 'watchLocalChanges', 'watchRemoteChanges', 'direction', 'ignorePatterns']) {
    assert.match(body, new RegExp(`data-option-help="${key}"`));
  }
  assert.match(script, /Known conflicts always require manual resolution\./);
  assert.match(script, /External file changes or replacements are handled by Watch Local Changes\./);
  assert.match(script, /Local is authoritative and changes are uploaded without requiring a baseline\./);
  assert.match(script, /Remote is authoritative and changes are downloaded without requiring a baseline\./);
  assert.match(script, /If Local and Remote both changed, the item is reported as a conflict instead of automatically choosing one side\./);
  assert.match(script, /Enter one pattern per line\. Blank lines are ignored and rules are applied in order\./);
  assert.match(script, /node_modules\/ — ignore a directory and everything inside it/);
  assert.match(script, /!dist\/keep\.txt — re-include a path ignored by an earlier rule/);
  assert.match(script, /Supported wildcards: \*, \?, and \*\*\./);
  assert.match(script, /Ignore rules apply to both Local and Remote scans for this mapping\./);
  assert.match(script, /When multiple targets affect the same local workspace, operations are processed one at a time/);
  assert.match(script, /Operations affecting the same or overlapping local workspaces are processed one at a time/);
  assert.match(body, /id="directionHelpButton"[^>]*data-option-help="direction"/);
  assert.match(body, /id="ignoreHelpButton"[^>]*data-option-help="ignorePatterns"/);
  assert.match(renderSyncStyles(), /\.direction-help-button,[\s\S]*\.ignore-help-button \{[\s\S]*position:\s*absolute;[\s\S]*visibility:\s*hidden;/);
  assert.match(renderSyncStyles(), /\.option-help-text \{[^}]*white-space:\s*pre-line;/);
  assert.match(script, /requestAnimationFrame\(\(\) => \{[\s\S]*positionDirectionHelpButton\(\);[\s\S]*positionIgnoreHelpButton\(\);[\s\S]*\}\);/);
  assert.match(script, /profile-picker\[data-for=\"mapDirection\"\] \.profile-dropdown-button/);
  assert.match(script, /const control = renderedControl \|\| select;/);
  assert.match(script, /function positionIgnoreHelpButton\(\)[\s\S]*const control = \$\('mapIgnore'\);[\s\S]*button\.style\.top = \(controlRect\.top - dialogRect\.top \+ \(\(controlRect\.height - 16\) \/ 2\)\) \+ 'px';/);
  assert.doesNotMatch(script, /const firstRowHeight = Math\.min\(controlRect\.height, 29\);/);
  assert.match(script, /button\.addEventListener\('click'/);
  assert.doesNotMatch(script, /addEventListener\('mouseenter'/);
  assert.doesNotMatch(script, /addEventListener\('focus'/);
  assert.match(renderSyncStyles(), /\.option-help-button:hover\s*\{[\s\S]*background:\s*transparent;[\s\S]*opacity:\s*\.78;/);
  assert.match(renderSyncStyles(), /\.option-help-icon > svg \{[\s\S]*width:\s*14px;[\s\S]*height:\s*14px;/);
  assert.match(script, /event\.key !== 'Escape' \|\| \$\('optionHelpPopover'\)\.hidden/);
  assert.match(script, /event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*event\.stopImmediatePropagation\(\);[\s\S]*closeOptionHelp\(\);[\s\S]*\}, true\);/);
  assert.match(script, /\['Unknown Change Protection', options\.conflictProtection \? 'On' : 'Off'\]/);
});

test('Workspace Sync keeps Refresh and Sync with Changes without deployment or Git actions', async () => {
  const body = renderWorkspaceSyncBody();
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();
  assert.match(body, /class="changes-primary-actions"><button id="compare">Refresh<\/button><button id="sync">Sync<\/button><\/div><div class="changes-more-wrap">/);
  const connectionStart = body.indexOf('<div class="card connection-card">');
  const changesStart = body.indexOf('<div class="card changes-card">');
  assert.ok(connectionStart >= 0 && changesStart > connectionStart);
  const connectionMarkup = body.slice(connectionStart, changesStart);
  assert.doesNotMatch(connectionMarkup, /id="compare"|id="sync"/);
  assert.doesNotMatch(styles, /\.metadata-block \{[^}]*border-bottom:/);
  assert.match(styles, /\.changes-primary-actions \{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*margin-left:\s*2px;[^}]*padding-left:\s*8px;[^}]*border-left:\s*1px solid var\(--vscode-panel-border\);/);
  assert.doesNotMatch(body, /Deploy Targets|Select Git Changes|Deploy Git Changes|Git Since|id="deployTargets"|id="gitChanges"|id="deployGit"|id="deployGitSince"/);
  assert.doesNotMatch(script, /deployTargets|selectGitChanges|deployGit|deployGitSince|message\.type === 'gitChanges'|request\.kind === 'targets'/);

  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  assert.doesNotMatch(controller, /previewDeployment|executeDeployment|discardDeployment|getGitChanges|GitChangedFilesProvider|pendingDeployments/);
  assert.doesNotMatch(panel, /previewDeployment|executeDeployment|discardDeployment|pickDeploymentTargets|confirmDeployment|Deploy Git|Deployment Targets/);
});

test('Workspace Sync Connect flow exposes Refresh and retains last-known-state UI', () => {
  const body = renderWorkspaceSyncBody();
  const script = renderWorkspaceSyncClientScript();
  assert.match(body, /<button id="compare">Refresh<\/button>/);
  assert.doesNotMatch(body, /<button id="compare">Compare<\/button>/);
  assert.match(body, /id="snapshotStatus"/);
  assert.match(script, /\$\('compare'\)\.textContent = refreshing \? 'Refreshing\.\.\.' : 'Refresh';/);
  assert.match(script, /Showing last known state/);
  assert.match(script, /Connect the selected target to load the file list\./);
  assert.match(script, /state\.showingLastKnownState/);
});


test('Workspace Sync timestamps use local YYYY-MM-DD HH:mm:ss in 24-hour format', async () => {
  const script = renderWorkspaceSyncClientScript();
  assert.match(script, /function formatTimestamp\(value\)/);
  assert.match(script, /date\.getFullYear\(\)/);
  assert.match(script, /date\.getHours\(\)/);
  assert.match(script, /const refreshed = formatTimestamp\(state\.lastComparedAt\);/);
  assert.match(script, /formatTimestamp\(entry\.time\)/);
  assert.doesNotMatch(script, /toLocaleTimeString\(/);

  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  assert.match(panel, /function formatWorkspaceSyncTimestamp\(value: number\): string/);
  assert.match(panel, /formatWorkspaceSyncTimestamp\(entry\.time\)/);
  assert.doesNotMatch(panel, /toLocaleTimeString\(/);
});

test('Workspace Sync sections share the same outer padding without extra Connection bottom spacing', () => {
  const styles = renderSyncStyles();
  assert.match(styles, /:root \{[^}]*--workspace-section-padding-y:\s*12px;[^}]*--workspace-section-padding-x:\s*12px;/);
  assert.match(styles, /\.card \{[^}]*padding:\s*var\(--workspace-section-padding-y\) var\(--workspace-section-padding-x\);/);
  assert.match(styles, /\.metadata-block \{[\s\S]*padding:\s*5px 0 0;[\s\S]*border-top:/);
  assert.doesNotMatch(styles, /\.metadata-block \{[^}]*padding:\s*5px 0;/);
});

test('Workspace Sync layout pins Activity to the bottom and lets Changes fill the middle area', () => {
  const body = renderWorkspaceSyncBody();
  const styles = renderSyncStyles();
  assert.match(body, /class="card connection-card"/);
  assert.match(styles, /#workspaceContent \{[\s\S]*height:\s*calc\(100vh - 20px\);[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*overflow:\s*hidden;/);
  assert.match(styles, /#workspaceContent > \.changes-card \{[\s\S]*flex:\s*1 1 auto;[\s\S]*min-height:\s*220px;[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/);
  assert.match(styles, /\.changes-panel \{[\s\S]*flex:\s*1 1 auto;[\s\S]*height:\s*auto;[\s\S]*min-height:\s*120px;[\s\S]*resize:\s*none;/);
  assert.match(styles, /#workspaceContent > \.activity-card \{[\s\S]*flex:\s*0 0 auto;[\s\S]*margin-bottom:\s*0;/);
  assert.match(styles, /\.activity-log \{[\s\S]*height:\s*140px;[\s\S]*min-height:\s*140px;[\s\S]*max-height:\s*140px;[\s\S]*resize:\s*none;/);
  assert.doesNotMatch(renderWorkspaceSyncClientScript(), /activityLogHeight|savedActivityHeight|activityResizeObserver/);
});

test('Workspace Sync Activity actions live beside Cancel in the bottom operation bar', () => {
  const body = renderWorkspaceSyncBody();
  const styles = renderSyncStyles();
  const headingStart = body.indexOf('<div class="activity-heading">');
  const logStart = body.indexOf('<div id="activityLog"', headingStart);
  assert.ok(headingStart >= 0 && logStart > headingStart);
  const headingMarkup = body.slice(headingStart, logStart);
  assert.match(headingMarkup, /id="activityFollow"/);
  assert.doesNotMatch(headingMarkup, /id="activityCopy"|id="activityClear"/);
  assert.match(body, /class="operationActions"[\s\S]*id="cancelOperation"[\s\S]*id="activityCopy"[\s\S]*id="activityClear"/);
  assert.match(styles, /\.operationActions \{[\s\S]*display:\s*flex;[\s\S]*justify-content:\s*flex-end;/);
  assert.match(styles, /\.operationActions \.activityUtilityAction \{ margin-left:\s*7px; \}/);
  assert.match(styles, /#activityCopy \{[^}]*width:\s*58px;[^}]*min-width:\s*58px;[^}]*max-width:\s*58px;/);
});

test('Workspace Sync uses one compact Activity spinner instead of progress bars', async () => {
  const body = renderWorkspaceSyncBody();
  const styles = renderSyncStyles();
  const script = renderWorkspaceSyncClientScript();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');

  assert.doesNotMatch(body, /id="busy"|operationTrack|operationFill/);
  assert.match(body, /id="operationSpinner" class="operationSpinner"/);
  assert.match(body, /id="cancelOperation" class="secondary" disabled hidden/);
  assert.doesNotMatch(styles, /(?:^|\n)\.busy\s*\{|operationTrack|operationFill|@keyframes pulse/);
  assert.match(styles, /\.operationBar \{[\s\S]*grid-template-columns:\s*minmax\(180px, 1fr\) auto;/);
  assert.match(styles, /\.operationBar\.active \.operationSpinner \{ display:\s*inline-block; \}/);
  assert.match(styles, /\.operationSpinner \{[\s\S]*border:\s*1px solid/);
  assert.match(styles, /@keyframes workspaceSyncSpin/);
  assert.match(script, /\$\('cancelOperation'\)\.hidden = !operationCancellable;/);
  assert.doesNotMatch(script, /operationFill|\$\('busy'\)/);
  assert.doesNotMatch(panel, /type:\s*'busy'/);
});

test('Workspace Sync Watch pushes successful automatic changes back into the Changes view', async () => {
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');

  assert.match(controller, /readonly onDidChangeViewState = this\.viewStateChangedEmitter\.event;/);
  assert.match(panel, /controller\.onDidChangeViewState\(\(\) => void this\.postState\(\)\)/);
  assert.match(controller, /reflectAutomaticOperationsInView\(mapping, target, session, result\.completed\)/);
  assert.match(controller, /Watch operations may target paths created after the last full Refresh/);
  assert.doesNotMatch(controller, /handleRemoteWatchChangesForTarget\(currentMapping, currentTarget, session, snapshot, changedPaths\);\s*this\.remoteWatchSnapshots\.set\(key, currentState\);\s*this\.runtimeByTarget\.delete\(key\);/);
});

test('Workspace Sync automatic monitors keep Changes live only for the focused mapping', async () => {
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  assert.match(controller, /private async refreshAutomaticPathsInView\(/);
  assert.match(controller, /scheduleAutomaticViewStateChanged\(mappingId: string\)[\s\S]*this\.mappings\.getActive\(\)\?\.id[\s\S]*automaticViewDirtyMappings\.has\(activeMappingId\)/);
  assert.match(controller, /Coalesce bursts of watcher activity/);
  assert.match(controller, /change\.kind === 'delete'[\s\S]*refreshAutomaticPathsInView\(mapping, target, session/);
  assert.match(controller, /Remote Watch just perceived|Remote Watch detected/);
  assert.match(controller, /remoteKnown: true,[\s\S]*remote,/);
  assert.match(controller, /forceConflictReason: reason/);
  assert.match(controller, /applyCompletedOperationsToRuntime\(mapping, target, session, runtime, completed\)/);
  assert.doesNotMatch(controller, /handleWatchedChangeForTarget[\s\S]{0,1200}compareTargetCore\(/);
});

test('Workspace Sync exposes Reset Baseline as a scoped Changes maintenance action', async () => {
  const body = renderWorkspaceSyncBody();
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  assert.match(body, /id="changesMore"[\s\S]*id="changesMenu"[\s\S]*id="resetBaseline"[\s\S]*Reset Baseline…/);
  assert.match(script, /function closeChangesMenu\(\)/);
  assert.match(script, /post\('resetBaseline', \{ mappingId: mapping\.id, targetId: target\.id \}\)/);
  assert.match(script, /\$\('changesMore'\)\.disabled = \(operationActive \|\| interactionActive\) \|\| allEnabled \|\| !mapping \|\| !target \|\| !target\.enabled \|\| status !== 'connected';/);
  assert.match(body, /id="changesMore" class="secondary changes-more-button"[\s\S]*class="changes-more-glyph"/);
  assert.match(styles, /\.changes-more-wrap \{[\s\S]*padding-left:\s*8px;[\s\S]*border-left:\s*1px solid var\(--vscode-panel-border\);/);
  assert.match(styles, /\.changes-more-button \{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;/);
  assert.match(styles, /\.changes-more-glyph \{[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;/);
  assert.match(styles, /\.changes-menu \{[\s\S]*position:\s*absolute;[\s\S]*right:\s*0;/);
  assert.match(panel, /case 'resetBaseline':[\s\S]*Local and Remote files will not be modified[\s\S]*controller\.resetBaseline/);
  assert.match(controller, /async resetBaseline\([\s\S]*await this\.baselines\.clear\(mapping\.id, target\.id\);[\s\S]*this\.strongVerificationPaths\.delete\(runtimeKey\);[\s\S]*return this\.compareTargetCore/);
});

test('Workspace Sync failure diagnostics keep the technical error and add actionable guidance', async () => {
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');

  assert.match(controller, /describeSyncOperationFailure\(event\.operation, event\.message\)/);
  assert.match(controller, /Error output:/);
  assert.match(controller, /if \(guidance\) this\.ui\.log\(guidance, 'warning', targetLabel\)/);
  assert.match(controller, /local delete was only partially propagated:[\s\S]*remote delete operation\(s\) failed\. Refresh to inspect the remaining Remote contents before retrying\./);
  assert.match(controller, /Next step: Refresh if needed, then resolve the path with Use Local, Use Remote, or Skip\. No file was overwritten by this conflict\./);
  assert.match(panel, /See Activity for the original error and suggested action\./);
});


test('Workspace Sync rows show mapping-relative paths without a filename tooltip', () => {
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();

  assert.match(script, /function joinDisplayPath\(root, relativePath\)/);
  assert.doesNotMatch(script, /function conflictPathLabel\(entry\)/);
  assert.match(script, /const localRelativePath = String\(entry\?\.localRelativePath \|\| relativePath\)/);
  assert.match(script, /const remoteRelativePath = String\(entry\?\.remoteRelativePath \|\| relativePath\)/);
  assert.match(script, /function changePathTooltip\(entry\)[\s\S]*Path: \$\{details\.relativePath\}[\s\S]*Local: \$\{details\.localPath\}[\s\S]*Remote: \$\{details\.remotePath\}/);
  assert.match(script, /const displayedPath = entry\.relativePath;/);
  assert.doesNotMatch(script, /<div class="path" role="cell" data-tooltip=/);
  assert.match(script, /changeSearchText\(entry\)\.includes\(query\)/);
  assert.match(styles, /\.row \{[\s\S]*min-height:\s*24px;/);
  assert.match(styles, /\.path \{ overflow:\s*hidden; text-overflow:\s*ellipsis; white-space:\s*nowrap; \}/);
});


test('Workspace Sync Activity status reports sequential phases instead of combined connection/refresh labels', async () => {
  const script = renderWorkspaceSyncClientScript();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');

  assert.doesNotMatch(panel, /Connecting and refreshing|Reconnecting and refreshing|Resetting baseline and refreshing|Refreshing Local and Remote/);
  assert.match(panel, /withProgressOperation\('Connecting\.\.\.'/);
  assert.match(panel, /withProgressOperation\('Reconnecting\.\.\.'/);
  assert.match(panel, /withProgressOperation\('Refreshing\.\.\.'/);
  assert.match(panel, /withProgressOperation\('Resetting baseline\.\.\.'/);
  assert.match(panel, /withProgressOperation\('Connecting targets\.\.\.'/);
  assert.match(script, /function progressStageLabel\(phase\)/);
  assert.match(script, /scanning local files[\s\S]*return 'Refreshing\.\.\.'/i);
  assert.match(script, /status === 'connected'[\s\S]*activeOperationKind[\s\S]*setActiveOperationLabel\('Refreshing\.\.\.', 'refresh'\)/);
  assert.match(script, /aggregate\.allConnected[\s\S]*activeOperationKind === 'connect'[\s\S]*setActiveOperationLabel\('Refreshing\.\.\.', 'refresh'\)/);
});



test('Workspace Sync Activity status is structured, contextual and includes Disconnect lifecycle', async () => {
  const script = renderWorkspaceSyncClientScript();
  const body = renderWorkspaceSyncBody();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  assert.doesNotMatch(script, /No operation in progress\./);
  assert.doesNotMatch(body, /No operation in progress\./);
  assert.match(script, /function idleOperationStatus\(\)/);
  assert.match(script, /label: 'Ready\.'/);
  assert.match(script, /label: 'Disconnected\.'/);
  assert.match(script, /label: 'Reconnect required\.'/);
  assert.match(script, /targets connected/);
  assert.match(script, /let activeOperationKind = '';/);
  assert.match(script, /activeOperationKind === 'connect'/);
  assert.match(script, /activeOperationStageKind === 'refresh'/);

  assert.match(panel, /case 'disconnect':[\s\S]*withProgressOperation\([\s\S]*'Disconnecting\.\.\.'/);
  assert.match(panel, /case 'disconnectEnabled':[\s\S]*'Disconnecting targets\.\.\.'/);
  assert.match(panel, /kind: 'disconnect'/);
  assert.match(controller, /async disconnectEnabledTargets\([\s\S]*progress\?: \(progress: WorkspaceSyncProgress\) => void/);
  assert.match(controller, /Disconnected \$\{completed\} of \$\{enabled\.length\} target\(s\)\./);
});

test('Workspace Sync Activity background status never overrides a foreground operation', async () => {
  const script = renderWorkspaceSyncClientScript();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  assert.match(controller, /onDidChangeBackgroundActivity/);
  assert.match(controller, /label: 'Refreshing after mapping update\.\.\.'/);
  assert.match(panel, /backgroundOperationState/);
  assert.match(script, /const shown = foreground[\s\S]*background[\s\S]*idle;/);
  assert.match(script, /message\.type === 'backgroundOperationState'/);
  assert.match(script, /backgroundOperation\.mappingId[\s\S]*state\.activeMappingId/);
});
test('Workspace Sync target Connected status reuses the Activity success color', () => {
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();

  assert.match(script, /target-status ' \+ esc\(rawStatus\) \+ '\">'/);
  assert.match(styles, /\.activity-line\.success, \.target-status\.connected \{ color: var\(--vscode-testing-iconPassed,#73c991\); \}/);
});

test('Workspace Sync connection metadata text does not use hover tooltips', () => {
  const script = renderWorkspaceSyncClientScript();
  const body = renderWorkspaceSyncBody();

  assert.doesNotMatch(script, /setTooltip\(\$\('connectionLabel'\)/);
  assert.doesNotMatch(script, /setTooltip\(\$\('localRoot'\)/);
  assert.doesNotMatch(script, /setTooltip\(\$\('remoteRoot'\)/);
  assert.doesNotMatch(body, /id="connectionLabel"[^>]*data-tooltip/);
  assert.doesNotMatch(body, /id="localRoot"[^>]*data-tooltip/);
  assert.doesNotMatch(body, /id="remoteRoot"[^>]*data-tooltip/);
  assert.doesNotMatch(body, /id="targetStates"[^>]*data-tooltip/);
});

test('Workspace Sync Activity follow control does not resize the section and detail text is secondary', () => {
  const styles = renderSyncStyles();
  assert.match(styles, /\.activity-heading \{[\s\S]*display:\s*grid;[\s\S]*height:\s*27px;[\s\S]*min-height:\s*27px;/);
  assert.match(styles, /#operationDetail \{[\s\S]*color:\s*var\(--vscode-descriptionForeground\);[\s\S]*font-size:\s*10px;/);
});

test('Workspace Sync uses Remote Edit style webview tooltips and no native title tooltips', () => {
  const body = renderWorkspaceSyncBody();
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();

  assert.match(body, /id="webviewTooltip" class="webview-tooltip" role="tooltip"/);
  assert.match(body, /data-tooltip="Clear Filter"/);
  assert.match(body, /data-tooltip="Sort by Path"/);
  assert.doesNotMatch(body, /\btitle="/);
  assert.doesNotMatch(script, /\btitle=|\.title\s*=|setAttribute\(['"]title/);
  assert.match(styles, /\.webview-tooltip \{[\s\S]*background: var\(--vscode-editorWidget-background\);[\s\S]*border: 1px solid var\(--vscode-editorWidget-border, var\(--vscode-panel-border\)\);[\s\S]*font-size: 12px;/);
  assert.match(script, /const TOOLTIP_SHOW_DELAY_MS = 500;/);
  assert.match(script, /const ROW_ACTION_TOOLTIP_SHOW_DELAY_MS = 750;/);
  assert.match(script, /data-tooltip-delay=\"\$\{ROW_ACTION_TOOLTIP_SHOW_DELAY_MS\}\"/);
  assert.match(script, /const showDelay = Number\.isFinite\(configuredDelay\)[\s\S]*TOOLTIP_SHOW_DELAY_MS;/);
  assert.match(script, /document\.addEventListener\('mouseover'[\s\S]*showWebviewTooltip\(target\)/);
  assert.match(script, /document\.addEventListener\('focusin'[\s\S]*showWebviewTooltip\(target\)/);
});

test('Workspace Sync replaces native right-click menus with Remote Edit style context menus', async () => {
  const body = renderWorkspaceSyncBody();
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');

  assert.match(body, /id="changesContextMenu" class="context-menu changes-context-menu"/);
  assert.match(body, /changesContextUpload[\s\S]*Upload to Remote[\s\S]*changesContextDownload[\s\S]*Download to Local/);
  assert.match(body, /id="activityContextMenu" class="context-menu activity-context-menu"[\s\S]*Copy Selected[\s\S]*Copy All[\s\S]*Clear/);
  assert.match(body, /id="textEditContextMenu" class="context-menu text-edit-context-menu"/);
  assert.match(body, /textEditContextUndo[\s\S]*textEditContextRedo[\s\S]*textEditContextCut[\s\S]*textEditContextCopy[\s\S]*textEditContextPaste[\s\S]*textEditContextSelectAll/);
  assert.match(styles, /\.context-menu \{[\s\S]*border-radius: 4px;[\s\S]*background: var\(--vscode-menu-background, var\(--vscode-editorWidget-background\)\);[\s\S]*box-shadow: 0 8px 22px rgba\(0, 0, 0, 0\.35\);/);
  assert.match(script, /document\.addEventListener\('contextmenu'[\s\S]*event\.preventDefault\(\);[\s\S]*showTextEditContextMenu/);
  assert.match(script, /closest\('\[data-change-path\]'\)[\s\S]*showChangesContextMenu/);
  assert.match(script, /closest\('#activityLog'\)[\s\S]*showActivityContextMenu/);
  assert.match(script, /getActivitySelectionText\(\)[\s\S]*activityContextCopySelected/);
  assert.match(script, /activityContextCopyAll[\s\S]*post\('copyActivity'\)/);
  assert.match(script, /activityContextClear[\s\S]*post\('clearActivity'\)/);
  assert.match(script, /event\.preventDefault\(\);[\s\S]*hideTextEditContextMenu\(\);[\s\S]*closeChangesContextMenu\(\);[\s\S]*closeActivityContextMenu\(\);[\s\S]*\}, true\);/);
  assert.match(panel, /message\?\.type === 'copyText'[\s\S]*vscode\.env\.clipboard\.writeText/);
});

test('Workspace Sync Different and Conflict choices are mutually exclusive planned resolutions', async () => {
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  assert.match(script, /function resolutionButtonHtml\(entry, resolution, label, source = 'changes'\)/);
  assert.match(script, /selectedResolution === resolution \? ' resolution-selected' : ''/);
  assert.match(script, /function chooseResolution\(targetId, relativePath, requestedResolution\)/);
  assert.match(script, /entry\.resolution === requestedResolution \? undefined : requestedResolution/);
  assert.match(script, /post\('setConflictResolution'[\s\S]*requestId/);
  assert.match(script, /chooseResolution\(element\.dataset\.targetId, element\.dataset\.path, element\.dataset\.resolve\)/);
  assert.match(script, /chooseResolution\(targetId, relativePath, action\)/);
  assert.doesNotMatch(script, /post\('resolveConflict'/);
  assert.doesNotMatch(script, /Skipped/);
  assert.doesNotMatch(script, /\(skipped\)/);
  assert.match(styles, /button\.resolution-choice\.resolution-selected[\s\S]*var\(--vscode-list-activeSelectionBackground/);
  assert.doesNotMatch(styles, /resolution-selected[\s\S]{0,200}::before[\s\S]{0,100}check/i);

  assert.match(panel, /message\?\.type === 'setConflictResolution'[\s\S]*handleConflictResolutionMessage/);
  assert.match(panel, /handleConflictResolutionMessage[\s\S]*setConflictResolution\(mappingId, targetId, relativePath, resolution, false\)[\s\S]*type: 'resolutionState'/);
  assert.doesNotMatch(panel, /case 'setConflictResolution':/);
  assert.match(controller, /async setConflictResolution\([\s\S]*resolution\?: WorkspaceSyncConflictResolution,[\s\S]*notifyViewState = true[\s\S]*setConflictResolutions/);
  assert.match(controller, /resolutionByPath\.has\(diff\.relativePath\)[\s\S]*delete reset\.resolution/);
  assert.match(controller, /async setConflictResolutions\([\s\S]*runtime\.diffs = runtime\.diffs\.map[\s\S]*runtime\.plan =/);
  assert.match(panel, /rawResolution === null[\s\S]*controller\.setConflictResolution/);
});

test('Workspace Sync resolution selection updates locally without rerendering the webview', async () => {
  const script = renderWorkspaceSyncClientScript();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');

  assert.match(script, /function setLocalResolution\(targetId, relativePath, resolution\)[\s\S]*updateResolutionControls\(targetId, relativePath\)/);
  assert.match(script, /pendingResolutionRequests\.set\(key, requestId\)/);
  assert.doesNotMatch(script, /\$\('sync'\)\.disabled =[^;]*pendingResolutionRequests/);
  assert.match(script, /function openPreview\(\) \{[\s\S]*pendingResolutionRequests\.size > 0[\s\S]*syncPreviewRequested = true;[\s\S]*return;/);
  assert.match(script, /message\.type === 'resolutionState'[\s\S]*updateResolutionControls\(targetId, relativePath\)[\s\S]*updateSyncAvailability\(\)[\s\S]*!pendingResolutionRequests\.size && syncPreviewRequested[\s\S]*openPreview\(\)/);
  assert.doesNotMatch(script, /message\.type === 'resolutionState'[\s\S]{0,500}render\(\)/);
  assert.match(panel, /message\?\.type === 'setConflictResolution'[\s\S]*return;[\s\S]*if \(this\.handling\) return;/);
});

test('Workspace Sync confirmation reuses resolution choices and blocks execution while a decision is pending', async () => {
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  assert.match(script, /let previewResolutions = \{\};/);
  assert.match(script, /Different and Conflict decisions/);
  assert.match(script, /resolutionButtonHtml\(entry, 'useLocal', 'Use Local', 'preview'\)/);
  assert.match(script, /resolutionButtonHtml\(entry, 'useRemote', 'Use Remote', 'preview'\)/);
  assert.match(script, /resolutionButtonHtml\(entry, 'skip', 'Skip', 'preview'\)/);
  assert.match(script, /const key = changeKey\(targetId, relativePath\);[\s\S]*if \(previewResolutions\[key\] === resolution\) delete previewResolutions\[key\];/);
  assert.match(script, /else previewResolutions\[key\] = resolution;/);
  assert.match(script, /\$\('startPreviewSync'\)\.disabled = Boolean\(pending\)/);
  assert.match(script, /post\('sync', \{ mappingId: mapping\.id, targetId: target\.targetId, resolutions \}\)/);
  assert.match(styles, /\.previewDecisionActions[\s\S]*display: flex/);

  assert.match(panel, /case 'sync':[\s\S]*parseConflictResolutions\(message\.resolutions\)[\s\S]*setConflictResolutions[\s\S]*executeCurrentPlan/);
  assert.match(panel, /case 'syncEnabled':[\s\S]*setConflictResolutions[\s\S]*executeCurrentPlansAcrossTargets/);
  assert.match(controller, /Select Use Local, Use Remote, or Skip for every Different or Conflict path before starting Sync\./);
  assert.match(controller, /invalidateStaleResolutions[\s\S]*delete reset\.resolution/);
});


test('Workspace Sync review modal uses compact stable metadata and Changes row density', () => {
  const body = renderWorkspaceSyncBody();
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();

  assert.match(body, /id="previewDialogTitle" class="dialog-title">Sync Review</);
  assert.match(script, /previewDialogTitle'\)\.textContent = isAllEnabledSelected\(\) \? 'Sync Review · All Enabled' : 'Sync Review'/);
  assert.match(script, /class="previewSummary"/);
  assert.match(script, /class="previewSummaryCount"/);
  assert.match(script, /class="previewPlanStatus"/);
  assert.match(script, /decision pending', 'decisions pending'/);
  assert.match(script, /structural conflict', 'structural conflicts'/);
  assert.match(script, /compare error', 'compare errors'/);
  assert.match(script, /class="previewRevalidation">Plan will be revalidated before execution\./);
  assert.doesNotMatch(script, /decision\(s\) pending/);

  assert.match(styles, /\.previewSummary[\s\S]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.previewSummaryCount[\s\S]*width: 4ch/);
  assert.match(styles, /\.previewSummary[\s\S]*font-variant-numeric: tabular-nums/);
  assert.match(styles, /\.previewDecision \{[\s\S]*min-height: 24px;[\s\S]*padding: 1px 7px;[\s\S]*font-size: 11px/);
  assert.match(styles, /\.previewDecisionActions button[\s\S]*min-height: 22px;[\s\S]*padding: 2px 5px;[\s\S]*font-size: 11px/);
  assert.match(styles, /\.previewPlanStatus[\s\S]*grid-template-columns: 150px 190px 145px/);
  assert.match(styles, /\.previewPlanStatusCount[\s\S]*width: 3ch/);
  assert.match(styles, /\.previewPlanFooter[\s\S]*font-size: 10px/);
  assert.match(styles, /\.previewRevalidation[\s\S]*margin-top: 3px;[\s\S]*padding-left: 2ch/);

  const resolutionHelperStart = script.indexOf('function resolutionButtonHtml');
  const resolutionHelperEnd = script.indexOf('function compareButtonHtml', resolutionHelperStart);
  const resolutionHelper = script.slice(resolutionHelperStart, resolutionHelperEnd);
  assert.doesNotMatch(resolutionHelper, /data-tooltip/);
  assert.match(script, /function compareButtonHtml[\s\S]*data-preview-diff[\s\S]*Compare Local and Remote/);
  assert.match(script, /previewDecisionActions[\s\S]*compareButtonHtml\(entry, 'preview'\)/);
  assert.match(script, /document\.querySelectorAll\('\[data-preview-diff\]'\)[\s\S]*post\('openDiff'/);
  assert.doesNotMatch(script, /previewRow[^\n]*data-tooltip/);
  assert.doesNotMatch(script, /previewDecisionInfo[^\n]*data-tooltip/);
});



test('Workspace Sync keeps Changes metadata muted and row icon tooltips hover-only', () => {
  const styles = renderSyncStyles();
  const script = renderWorkspaceSyncClientScript('<svg viewBox="0 0 16 16"></svg>');

  assert.match(styles, /\.changes-card \.snapshot-status \{[\s\S]*color:\s*var\(--vscode-descriptionForeground\);[\s\S]*font-size:\s*11px;[\s\S]*font-weight:\s*400;/);
  assert.match(styles, /button\.compare-action svg \{[^}]*width:\s*14px;[^}]*height:\s*14px;/);
  assert.match(script, /Compare Local and Remote[^`]*data-tooltip-hover-only/);
  assert.match(script, /Upload to Remote[^`]*data-tooltip-hover-only/);
  assert.match(script, /Download to Local[^`]*data-tooltip-hover-only/);
  assert.match(script, /focusin[\s\S]*!target\.hasAttribute\('data-tooltip-hover-only'\)/);
});

test('Workspace Sync loads the supplied arrow-swap SVG for Compare actions', async () => {
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  const html = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncHtml.ts'), 'utf8');
  const compareSvg = await fs.readFile(path.join(root, 'resources', 'arrow-swap.svg'), 'utf8');

  assert.match(compareSvg, /^<svg[\s\S]*viewBox="0 0 16 16"[\s\S]*fill="currentColor"/);
  assert.match(panel, /loadWorkspaceSyncSvg\(this\.context\.extensionUri, 'arrow-swap\.svg'\)/);
  assert.match(html, /renderWorkspaceSyncClientScript\(compareIconSvg\)/);
});

test('Workspace Sync cancellation lifecycle cannot leave a stale Cancelling state', async () => {
  const script = renderWorkspaceSyncClientScript();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  assert.match(panel, /operationSequence = 0/);
  assert.match(panel, /operationId: operation\.id[\s\S]*cancelling: true[\s\S]*cancellable: false/);
  assert.match(panel, /requestedOperationId > 0 && requestedOperationId !== operation\.id/);
  assert.match(script, /post\('cancelOperation', \{ operationId: activeOperationId \}\)/);
  assert.match(panel, /const cancelConnect = this\.cancelConnect;[\s\S]*void cancelConnect\(\)\.catch/);
  assert.doesNotMatch(panel, /if \(this\.cancelConnect\) await this\.cancelConnect\(\)/);
  assert.match(panel, /finally \{[\s\S]*this\.activeOperation\?\.id === operation\.id[\s\S]*type: 'operationState', active: false, operationId: operation\.id/);
  assert.match(panel, /type: 'operationProgress', progress: state, operationId: operation\.id/);
  assert.match(panel, /withBusy<[\s\S]*cancellable: false/);

  assert.match(script, /let activeOperationId = 0;[\s\S]*let latestOperationId = 0;/);
  assert.match(script, /incomingId === latestOperationId && !activeOperationId/);
  assert.match(script, /operationCancellable = operationActive && cancellable !== false && !operationCancelling/);
  assert.match(script, /\$\('cancelOperation'\)\.hidden = !operationCancellable/);
  assert.match(script, /if \(operationCancelling\) return;/);
  assert.match(script, /updateOperationState\(message\.active, message\.label, message\.kind, message\.operationId, message\.cancelling, message\.cancellable\)/);
  assert.match(script, /updateOperationProgress\(message\.progress, message\.operationId\)/);

  assert.match(controller, /async connectEnabledTargets\([\s\S]*cancellationToken\?: \{ readonly isCancellationRequested: boolean \}/);
  assert.match(controller, /this\.reconnect\(mapping\.id, target\.id, progress, cancellationToken\)/);
  assert.match(controller, /this\.connect\(mapping\.id, target\.id, progress, cancellationToken\)/);

  const connectEnabledSource = controller.slice(
    controller.indexOf('async connectEnabledTargets('),
    controller.indexOf('async disconnectEnabledTargets(')
  );
  assert.match(connectEnabledSource, /for \(const target of enabled\)/);
  assert.doesNotMatch(connectEnabledSource, /Promise\.allSettled/);
  assert.match(controller, /new LocalRootOperationCoordinator\(\)/);
  assert.doesNotMatch(controller, /mapping\.targets\.some\(item => this\.operations\.hasPending/);
});

test('Workspace Sync new mapping target numbering starts at Target 1 for each modal', () => {
  const script = renderWorkspaceSyncClientScript();

  assert.match(script, /function newTarget\(\) \{[\s\S]*name: `Target \${editingTargets\.length \+ 1}`/);
  assert.match(script, /editingTargets = mapping\?\.targets \? mapping\.targets\.map\(target => \(\{ \.\.\.target \}\)\) : \[\];[\s\S]*if \(!mapping\) editingTargets\.push\(newTarget\(\)\);/);
  assert.match(script, /\$\('addTarget'\)\.onclick = \(\) => \{ editingTargets\.push\(newTarget\(\)\); renderTargetEditor\(\); \};/);
});

test('Workspace Sync mapping target editor renders one shared aligned header including Enabled', () => {
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();

  assert.match(script, /class="targetHeader"[^>]*><div class="targetFieldLabel">Target Name<\/div><div class="targetFieldLabel">Connection<\/div><div class="targetFieldLabel">Remote Directory<\/div><div class="targetFieldLabel targetEnabledHeader">Enabled<\/div><div><\/div><\/div>/);
  assert.match(script, /const rows = editingTargets\.map/);
  assert.doesNotMatch(script, /class="targetRow"><div class="targetField"><div class="targetFieldLabel"/);
  assert.match(script, /aria-label="Remote directory"/);
  assert.match(script, /class="targetRowControl targetEnabledCell"><input aria-label="Enabled"/);
  assert.doesNotMatch(script, /<span>enabled<\/span>/);
  assert.match(script, /class="targetRowControl targetRemoveControl"/);

  assert.match(styles, /\.targetHeader, \.targetRow \{[^}]*grid-template-columns:\s*110px minmax\(0, 1fr\) minmax\(0, 1\.3fr\) 56px 22px;/);
  assert.match(styles, /\.targetHeader \{[^}]*align-items:\s*end;/);
  assert.match(styles, /\.targetFieldLabel \{[^}]*color:\s*var\(--vscode-descriptionForeground\);[^}]*font-size:\s*11px;[^}]*font-weight:\s*400;/);
  assert.match(styles, /\.targetEnabledHeader \{[^}]*text-align:\s*center;/);
  assert.match(styles, /\.targetRow \{[^}]*align-items:\s*center;/);
  assert.match(styles, /\.targetField > input, \.targetField > select \{[^}]*min-height:\s*29px;/);
  assert.match(styles, /\.targetRowControl \{[^}]*min-height:\s*29px;[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*align-self:\s*center;/);
  assert.match(styles, /\.targetEnabledCell \{[^}]*justify-content:\s*center;/);
});

test('Workspace Sync Disabled targets are globally non-operational', async () => {
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');
  const store = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'mapping', 'WorkspaceMappingStore.ts'), 'utf8');

  // UI: disabled targets stay visible/configurable but all operational controls are unavailable.
  assert.match(script, /item\.enabled \? '' : ' \(Disabled\)'/);
  assert.match(script, /status = targetEnabled \? \(state\.connectionStatus \|\| 'disconnected'\) : 'disabled';/);
  assert.match(script, /\$\('connect'\)\.textContent = !targetEnabled[\s\S]*\? 'Disabled'/);
  assert.match(script, /\$\('connect'\)\.disabled = [^;]*!targetEnabled/);
  assert.match(script, /const aggregateRefreshDisabled = allEnabled[\s\S]*!target\.enabled[\s\S]*\$\('compare'\)\.disabled = [^;]*aggregateRefreshDisabled/);
  assert.match(script, /function syncPreviewTargetViews[\s\S]*enabledTargets\(mapping\)[\s\S]*item\.status === 'connected'[\s\S]*view\.plan/);
  assert.match(script, /\$\('sync'\)\.disabled = [^;]*previewTargets\.length === 0/);
  assert.match(script, /\$\('changesMore'\)\.disabled = [^;]*!target\.enabled/);
  assert.match(script, /function entryCanOperate\(entry\)[\s\S]*target\?\.enabled[\s\S]*targetState\?\.status === 'connected'/);
  assert.match(script, /function selectedGroups\(\)[\s\S]*if \(!entryCanOperate\(entry\)\) continue;/);
  assert.match(script, /Target disabled\./);
  assert.match(script, /Enable the selected target in the mapping to use Workspace Sync\./);
  assert.match(script, /const rawStatus = target\.enabled \? \(item\?\.status \|\| 'disconnected'\) : 'disabled';/);
  assert.match(styles, /\.target-status\.disabled \{ color: var\(--vscode-descriptionForeground\); \}/);

  // Backend: UI state is not trusted; every manual operation requires an enabled target.
  assert.match(controller, /private requireEnabledTarget\([\s\S]*if \(!target\.enabled\)[\s\S]*is disabled\. Enable it in the mapping/);
  for (const method of ['connect', 'reconnect', 'compare', 'resetBaseline', 'executeCurrentPlan', 'executeSelected', 'setConflictResolutions', 'openDiff']) {
    const methodPattern = new RegExp(`async ${method}\\([\\s\\S]*?const target = this\\.requireEnabledTarget\\(mapping, targetId\\);`);
    assert.match(controller, methodPattern, `${method} must reject disabled targets`);
  }
  assert.match(controller, /handleWatchedChangeForTarget\([\s\S]*const currentTarget = currentMapping\?\.targets\.find[\s\S]*if \(!currentMapping \|\| !currentTarget\?\.enabled\) return;/);
  assert.match(controller, /handleWatchedChangeForTarget\([\s\S]*!currentTarget\?\.enabled\) return;[\s\S]*getConnectedAutomaticSession\(mapping\.id, target\.id\)/);

  // Saving a mapping moves away from a disabled active target when another enabled target exists.
  assert.match(store, /!activeTargetEntry\.enabled && mapping\.targets\.some\(target => target\.enabled\)/);
  assert.match(store, /setActiveTargetId\(mapping\.id, mapping\.targets\.find\(target => target\.enabled\)\?\.id/);
});


test('Workspace Sync target view replies are ordered and conflict-resolution replies are target-scoped', async () => {
  const script = renderWorkspaceSyncClientScript();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');
  const mapping = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'mapping', 'WorkspaceMapping.ts'), 'utf8');

  assert.match(panel, /private stateRequestSequence = 0/);
  assert.match(panel, /const stateSequence = \+\+this\.stateRequestSequence;[\s\S]*type: 'state'[\s\S]*stateSequence/);
  assert.match(panel, /type: 'resolutionState'[\s\S]*stateSequence, mappingId, targetId, relativePath, requestId/);
  assert.match(script, /let latestStateSequence = 0/);
  assert.match(script, /stateSequence && stateSequence < latestStateSequence/);
  assert.match(script, /belongsToActiveView = mappingMatches[\s\S]*isAllEnabledSelected\(\)[\s\S]*targetId === String\(state\.activeTargetId \|\| ''\)/);
  assert.match(script, /pendingResolutionRequests\.clear\(\);[\s\S]*syncPreviewRequested = false/);

  // Runtime, baseline and persisted last-view state are all keyed by mapping + target.
  assert.match(controller, /private runtimeKey\(mappingId: string, targetId: string\): string \{[\s\S]*`\$\{mappingId\}::\$\{targetId\}`/);
  assert.match(controller, /this\.baselines\.get\(mapping\.id, target\.id\)/);
  assert.match(controller, /this\.lastViews\.set\(mapping, target, runtime\.diffs, runtime\.lastComparedAt\)/);
  assert.match(mapping, /Duplicate Workspace Sync target id/);
  const createMappingStart = mapping.indexOf('export function createWorkspaceMapping');
  const createTargetStart = mapping.indexOf('export function createWorkspaceSyncTarget');
  const createMappingBody = mapping.slice(createMappingStart, createTargetStart);
  assert.doesNotMatch(createMappingBody, /validateUniqueTargetDestinations/, 'legacy mappings must remain loadable during activation');
});

test('Workspace Sync All Enabled aggregates target views, keeps Target sortable, and remembers the selection per mapping', async () => {
  const body = renderWorkspaceSyncBody();
  const script = renderWorkspaceSyncClientScript();
  const styles = renderSyncStyles();
  const root = path.resolve(__dirname, '../../..');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  // The Target column is always present and follows the same sortable-header pattern as Path/Status.
  assert.match(body, /data-change-sort-column="target"[\s\S]*data-change-sort="target"[\s\S]*<span>Target<\/span>/);
  assert.match(script, /\['target', 'path', 'status'\]\.includes\(persistedChangesSort\.key\)/);
  assert.match(script, /function cycleChangesSort\(key\)[\s\S]*\['target', 'path', 'status'\]\.includes\(key\)/);
  assert.match(script, /localeCompare\(String\(right \|\| ''\), undefined, \{ numeric: true, sensitivity: 'base' \}\)/);
  assert.match(styles, /\.changes-table-header \{[\s\S]*grid-template-columns:[^;]*minmax\(96px, 132px\)[^;]*minmax\(180px, 1fr\)/);
  assert.match(styles, /\.target-cell, \.path \{[^}]*text-overflow:\s*ellipsis/);

  // All Enabled is a view over the enabled targets, not a merged baseline/runtime.
  assert.match(script, /function currentChangeEntries\(\)[\s\S]*isAllEnabledSelected\(mapping\)[\s\S]*state\.targetViews[\s\S]*flatMap/);
  assert.match(script, /function changeKey\(targetId, relativePath\)/);
  assert.match(script, /data-target-id="' \+ esc\(entry\.targetId\)/);
  assert.match(controller, /export interface WorkspaceSyncTargetViewState[\s\S]*targetId: string;[\s\S]*diffs: DiffEntry\[\]/);
  assert.match(controller, /targetViews: WorkspaceSyncTargetViewState\[\]/);
  assert.match(controller, /async compareEnabledTargets\([\s\S]*refreshTargetsInParallel\(mapping, enabled/);
  assert.match(controller, /MAX_PARALLEL_TARGET_REFRESHES = 4/);
  assert.match(controller, /getLocalSnapshot:[\s\S]*localSnapshotPromise[\s\S]*scanLocalTree\(mapping\.localRoot/);
  assert.match(controller, /runWithConcurrency\(targets, MAX_PARALLEL_TARGET_REFRESHES/);
  assert.match(controller, /localRootOperations\.runShared\(mapping\.localRoot/);
  assert.match(controller, /requestCoalescedRefresh\(mapping, target/);
  assert.match(controller, /viewStateChangedEmitter\.fire\(\);[\s\S]*Refresh completed/);
  const aggregateCompareStart = controller.indexOf('async compareEnabledTargets(');
  const resetBaselineStart = controller.indexOf('async resetBaseline(', aggregateCompareStart);
  assert.ok(aggregateCompareStart >= 0 && resetBaselineStart > aggregateCompareStart);
  const aggregateCompare = controller.slice(aggregateCompareStart, resetBaselineStart);
  assert.match(aggregateCompare, /getSession\(this\.sessionKey\(mapping\.id, target\.id\)\)/);
  assert.doesNotMatch(aggregateCompare, /sessions\.connect|ensureSession/);
  assert.match(panel, /case 'compareEnabled':[\s\S]*compareEnabledTargets\(mappingId/);
  assert.match(panel, /executeSelectedAcrossTargets\(mappingId, selections, direction/);

  // Each mapping independently remembers whether its last UI selection was All Enabled.
  assert.match(script, /allEnabledMappingIds = new Set\(persistedAllEnabledMappings\)/);
  assert.match(script, /allEnabledMappingIds: \[\.\.\.allEnabledMappingIds\]/);
  assert.match(script, /if \(event\.target\.value === ALL_ENABLED_TARGETS\)[\s\S]*allEnabledMappingIds\.add\(mappingId\)/);
  assert.match(script, /if \(mappingId\) allEnabledMappingIds\.delete\(mappingId\);[\s\S]*post\('selectTarget'/);
  const mappingChangeStart = script.indexOf("$('mapping').onchange");
  const targetChangeStart = script.indexOf("$('target').onchange");
  assert.ok(mappingChangeStart >= 0 && targetChangeStart > mappingChangeStart);
  assert.doesNotMatch(script.slice(mappingChangeStart, targetChangeStart), /allEnabledMappingIds\.(?:delete|clear)/);

  // Aggregate operations still require already-connected sessions; All Enabled never becomes an auto-connect path.
  const aggregateExecuteStart = controller.indexOf('async executeSelectedAcrossTargets(');
  const conflictResolutionStart = controller.indexOf('async setConflictResolution(', aggregateExecuteStart);
  assert.ok(aggregateExecuteStart >= 0 && conflictResolutionStart > aggregateExecuteStart);
  const aggregateExecute = controller.slice(aggregateExecuteStart, conflictResolutionStart);
  assert.match(aggregateExecute, /this\.requireSession\(mapping\.id, selection\.target\.id\)/);
  assert.match(aggregateExecute, /mapWithConcurrencyLimit\([\s\S]*MAX_PARALLEL_TARGET_SYNCS[\s\S]*this\.executeSelected\(/);
  assert.doesNotMatch(aggregateExecute, /sessions\.connect|ensureSession/);

  // Sync Review and execution aggregate only enabled targets that are already connected and have a live plan.
  assert.match(script, /function syncPreviewTargetViews\(mapping = activeMapping\(\)\)[\s\S]*item\.status === 'connected'[\s\S]*view\.plan && !view\.showingLastKnownState/);
  assert.match(script, /\$\('sync'\)\.disabled = operationActive \|\| interactionActive \|\| !mapping \|\| previewTargets\.length === 0/);
  assert.match(script, /Sync Review · All Enabled/);
  assert.match(script, /post\('syncEnabled', \{ mappingId: mapping\.id, targets \}\)/);
  assert.match(panel, /case 'syncEnabled':[\s\S]*executeCurrentPlansAcrossTargets/);
  assert.match(controller, /async executeCurrentPlansAcrossTargets\([\s\S]*this\.requireSession\(mapping\.id, target\.id\)[\s\S]*mapWithConcurrencyLimit\([\s\S]*this\.executeCurrentPlan/);
});

test('Workspace Sync mapping Save closes before Ignore refresh completes', async () => {
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');
  const panel = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'webview', 'WorkspaceSyncPanel.ts'), 'utf8');
  const script = renderWorkspaceSyncClientScript();

  const saveStart = controller.indexOf('async saveMapping(');
  const deleteStart = controller.indexOf('async deleteMapping(', saveStart);
  const saveBody = controller.slice(saveStart, deleteStart);
  assert.match(saveBody, /void this\.refreshConnectedTargetsAfterIgnoreChange\(mapping\)\.catch/);
  assert.doesNotMatch(saveBody, /await this\.refreshConnectedTargetsAfterIgnoreChange/);
  assert.match(panel, /case 'saveMapping':[\s\S]*await this\.controller\.saveMapping[\s\S]*type: 'mappingSaved'[\s\S]*postState/);
  assert.match(script, /message\.type === 'mappingSaved'[\s\S]*closeDialog\('mappingDialog'\)/);
});

test('Workspace Sync prevents duplicate Connection + Remote Directory targets only on mutation paths', async () => {
  const script = renderWorkspaceSyncClientScript();
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');
  const store = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'mapping', 'WorkspaceMappingStore.ts'), 'utf8');
  const mapping = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'mapping', 'WorkspaceMapping.ts'), 'utf8');

  // Modal: normalize the Remote Directory, show the error immediately and keep Save disabled.
  assert.match(script, /function normalizeRemoteDirectoryForIdentity\(value\)/);
  assert.match(script, /function duplicateTargetDestinationError\(targets\)/);
  assert.match(script, /same Connection and Remote Directory/);
  assert.match(script, /\$\('saveMapping'\)\.disabled = interactionActive \|\| Boolean\(message\)/);
  assert.match(script, /if \(!updateMappingValidation\(\)\) return;/);
  assert.match(script, /element\.addEventListener\('input', updateTarget\);[\s\S]*element\.addEventListener\('change', updateTarget\)/);

  // Backend/save path: the UI is not trusted. Save and backup import enforce the same rule.
  assert.match(controller, /validateUniqueTargetDestinations\(input\.targets \|\| \[\]\)/);
  assert.match(store, /async save\([\s\S]*validateUniqueTargetDestinations\(input\.targets \|\| \[\]\)/);
  assert.match(store, /for \(const mapping of importedMappings\) validateUniqueTargetDestinations\(mapping\.targets\)/);
  assert.match(mapping, /export function validateUniqueTargetDestinations/);
  assert.match(mapping, /export function validateUniqueMappingRoutes/);
  assert.match(controller, /validateUniqueMappingRoutes\(\[/);
  assert.match(store, /validateUniqueMappingRoutes\(\[/);
  assert.match(store, /validateUniqueMappingRoutes\(mappings\)/);
  assert.match(script, /function duplicateMappingRouteError\(localRoot, targets\)/);
  assert.match(script, /same Local Root, Connection and Remote Directory/);

  // Loading remains intentionally permissive so an old invalid mapping can open and be repaired.
  const createMappingStart = mapping.indexOf('export function createWorkspaceMapping');
  const createTargetStart = mapping.indexOf('export function createWorkspaceSyncTarget');
  assert.doesNotMatch(mapping.slice(createMappingStart, createTargetStart), /validateUniqueTargetDestinations/);
});

test('Workspace Sync mapping validation stays in a fixed footer slot without shifting the modal', () => {
  const body = renderWorkspaceSyncBody();
  const styles = renderSyncStyles();
  const script = renderWorkspaceSyncClientScript();

  const dialogBodyStart = body.indexOf('id="mappingDialogBody"');
  const footerStart = body.indexOf('class="toolbar dialog-actions mapping-dialog-actions"');
  const errorStart = body.indexOf('id="mappingError"');
  assert.ok(dialogBodyStart >= 0 && footerStart > dialogBodyStart && errorStart > footerStart, 'mapping validation must live in the footer, not above the form');
  assert.match(body, /mapping-dialog-actions[^>]*><div id="mappingError" class="mapping-dialog-validation"/);
  assert.match(body, /mapping-dialog-action-buttons[^>]*><button id="deleteMapping"[\s\S]*id="cancelMapping"[\s\S]*id="saveMapping"/);
  assert.match(styles, /\.mapping-dialog-actions \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) auto;[^}]*align-items: center;/);
  assert.match(styles, /\.mapping-dialog-validation \{[^}]*height: 16px;[^}]*font-size: 10px;[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
  assert.match(styles, /\.mapping-dialog-action-buttons \{[^}]*display: flex;[^}]*justify-content: flex-end;/);
  assert.match(script, /duplicates '.*same Connection and Remote Directory/);
});

test('Workspace Sync rechecks current target enabled state inside queued watch operations', async () => {
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');
  assert.match(controller, /handleWatchedChangeForTarget\([\s\S]*const currentMapping = this\.mappings\.get\(mapping\.id\);[\s\S]*!currentTarget\?\.enabled\) return;/);
  assert.match(controller, /handleWatchedChangeForTarget\([\s\S]*const currentMapping = this\.mappings\.get\(mapping\.id\);[\s\S]*if \(!currentMapping \|\| !currentTarget\?\.enabled\) return;[\s\S]*getConnectedAutomaticSession/);
});



test('Workspace Sync automatic Watch and Upload on Save never establish sessions', async () => {
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  // Only explicit Connect/Reconnect are allowed to create a private session.
  const connectCalls = controller.match(/this\.sessions\.connect\(/g) || [];
  assert.equal(connectCalls.length, 2);
  assert.doesNotMatch(controller, /private async ensureSession\(/);
  assert.match(controller, /private getConnectedAutomaticSession\([\s\S]*disconnectRequested\.has\(key\)[\s\S]*status !== 'connected'[\s\S]*getSession\(key\)/);

  // Manual Disconnect marks intent before it waits behind any queued automatic work.
  assert.match(controller, /async disconnect\([\s\S]*this\.disconnectRequested\.add\(sessionKey\);[\s\S]*this\.operations\.run/);
  assert.match(controller, /handleWatchedChangeForTarget\([\s\S]*const session = this\.getConnectedAutomaticSession\(mapping\.id, target\.id\);[\s\S]*if \(!session\) return;/);
  assert.match(controller, /pollRemoteChanges\([\s\S]*getConnectedAutomaticSession\(mapping\.id, target\.id\)[\s\S]*getConnectedAutomaticSession\(currentMapping\.id, currentTarget\.id\)/);
  assert.doesNotMatch(controller, /Upload on Save skipped: target is not connected\./);
  assert.doesNotMatch(controller, /hasSaveOrigin/);
});

test('Workspace Sync registers automatic resources only for connected targets', async () => {
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');
  const watcher = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'watcher', 'WorkspaceWatcher.ts'), 'utf8');

  assert.match(controller, /private refreshWatchers[\s\S]*targets: mapping\.targets\.filter[\s\S]*getConnectedAutomaticSession\(mapping\.id, target\.id\)[\s\S]*filter\(mapping => mapping\.targets\.length > 0\)/);
  assert.match(controller, /async disconnect[\s\S]*disconnectRequested\.add\(sessionKey\);[\s\S]*this\.refreshWatchers\(\);[\s\S]*sessions\.disconnect/);
  assert.match(controller, /async connect[\s\S]*finally \{[\s\S]*this\.refreshWatchers\(\);/);
  assert.match(watcher, /private saveSubscription: vscode\.Disposable \| undefined/);
  assert.match(watcher, /private refreshSaveSubscription\(\): void[\s\S]*this\.mappings\.some\(mapping => mapping\.options\.uploadOnSave\)[\s\S]*onDidSaveTextDocument/);
});

test('Workspace Sync rescans connected targets when Ignore rules change', async () => {
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  assert.match(controller, /ignorePatternsChanged[\s\S]*stringArraysEqual/);
  assert.match(controller, /if \(ignorePatternsChanged\) \{[\s\S]*lastViews\.clear\(mapping\.id\)[\s\S]*refreshConnectedTargetsAfterIgnoreChange\(mapping\)/);
  assert.match(controller, /refreshConnectedTargetsAfterIgnoreChange[\s\S]*getConnectedAutomaticSession[\s\S]*compareTargetCore/);
});

test('Workspace Sync comparison tab badges show up to 999 before using 999+', () => {
  const script = renderWorkspaceSyncClientScript();
  assert.match(script, /return count > 999 \? '999\+' : String\(count\);/);
  assert.match(script, /setTooltip\(button, `\$\{label\}: \$\{count\}`\)/);
});


test('Workspace Sync Stage 2 parallelizes safe remote-only target Sync and avoids clean full Refreshes', async () => {
  const root = path.resolve(__dirname, '../../..');
  const controller = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncController.ts'), 'utf8');

  assert.match(controller, /MAX_PARALLEL_TARGET_SYNCS = 2/);
  assert.match(controller, /function planMutatesLocal\(plan: SyncPlan\)[\s\S]*operation\.type === 'download'[\s\S]*operation\.type === 'createLocalDirectory'[\s\S]*operation\.type === 'deleteLocal'/);
  assert.match(controller, /runWithPlanLocalRootProtection<[\s\S]*planMutatesLocal\(plan\)[\s\S]*localRootOperations\.run\(mapping\.localRoot, task\)[\s\S]*localRootOperations\.runShared\(mapping\.localRoot, task\)/);
  assert.match(controller, /executeCurrentPlansAcrossTargets\([\s\S]*mapWithConcurrencyLimit\([\s\S]*MAX_PARALLEL_TARGET_SYNCS/);
  assert.match(controller, /executeSelectedAcrossTargets\([\s\S]*mapWithConcurrencyLimit\([\s\S]*MAX_PARALLEL_TARGET_SYNCS/);

  const executeStart = controller.indexOf('async executeCurrentPlan(');
  const aggregateStart = controller.indexOf('async executeCurrentPlansAcrossTargets(', executeStart);
  const executeBody = controller.slice(executeStart, aggregateStart);
  assert.match(executeBody, /updateBaselineForOperations[\s\S]*!result\.cancelled && !result\.failed\.length[\s\S]*reflectSuccessfulManualOperationsInView/);
  assert.match(executeBody, /Running a full Refresh because the Sync did not complete cleanly\.[\s\S]*compareTargetCore/);
  assert.doesNotMatch(executeBody, /runtimeByTarget\.delete[\s\S]*if \(!result\.cancelled\) await this\.compareTargetCore/);

  assert.match(controller, /reflectSuccessfulManualOperationsInView\([\s\S]*refreshAutomaticPathsInView\(mapping, target, session, observations, baseRuntime, true, true\)/);
  assert.match(controller, /Post-Sync Changes updated incrementally[\s\S]*full Refresh was not required/);
  assert.match(controller, /updateBaselineForOperations\([\s\S]*localKnown: true[\s\S]*remoteKnown: true/);
});

test('Workspace Sync command registration survives runtime initialization errors', async () => {
  const root = path.resolve(__dirname, '../../..');
  const feature = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncFeature.ts'), 'utf8');
  const registerIndex = feature.indexOf('vscode.commands.registerCommand(COMMAND_OPEN_WORKSPACE_SYNC');
  const initializeIndex = feature.indexOf('this.ensureController();');
  assert.ok(registerIndex >= 0, 'Workspace Sync open command must be registered');
  assert.ok(initializeIndex > registerIndex, 'command registration must happen before eager controller initialization');
  assert.match(feature, /try \{[\s\S]*this\.ensureController\(\);[\s\S]*\} catch \(error\) \{[\s\S]*logInitializationFailure/);
  assert.match(feature, /Workspace Sync could not be opened:/);
});

test('Workspace Sync UI settings mirror Remote Edit controls and wire the editor/status buttons', async () => {
  const root = path.resolve(__dirname, '../../..');
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as any;
  const configurations = packageJson.contributes.configuration as Array<{ title: string; properties: Record<string, any> }>;
  const remoteUiIndex = configurations.findIndex(section => section.title === 'Remote Edit: UI');
  const workspaceSyncUiIndex = configurations.findIndex(section => section.title === 'Remote Edit: Workspace Sync UI');

  assert.equal(workspaceSyncUiIndex, remoteUiIndex + 1);
  const properties = configurations[workspaceSyncUiIndex].properties;
  assert.deepEqual(properties['remoteedit.workspaceSync.editorTitleButtonPosition'], {
    type: 'string',
    default: 'hidden',
    enum: ['right', 'hidden'],
    enumDescriptions: [
      'Show the Workspace Sync button in the Editor Title area.',
      'Hide the Workspace Sync Editor Title button.'
    ],
    description: 'Controls whether the Workspace Sync button appears in the editor title area.',
    order: 10
  });
  assert.equal(properties['remoteedit.workspaceSync.statusBarButtonPosition'].default, 'left');
  assert.deepEqual(properties['remoteedit.workspaceSync.statusBarButtonPosition'].enum, ['left', 'right', 'hidden']);
  assert.equal(properties['remoteedit.workspaceSync.statusBarButtonStyle'].default, 'iconAndText');
  assert.deepEqual(properties['remoteedit.workspaceSync.statusBarButtonStyle'].enum, ['iconAndText', 'iconOnly', 'textOnly']);
  assert.equal(properties['remoteedit.workspaceSync.statusBarButtonPriority'].default, 999);

  const editorTitle = packageJson.contributes.menus['editor/title'] as Array<Record<string, string>>;
  assert.ok(editorTitle.some(item =>
    item.command === 'remoteedit.workspaceSync.open' &&
    item.when === 'config.remoteedit.workspaceSync.editorTitleButtonPosition == right'
  ));

  const feature = await fs.readFile(path.join(root, 'src', 'workspaceSync', 'WorkspaceSyncFeature.ts'), 'utf8');
  assert.match(feature, /const CONFIG_SECTION = 'remoteedit\.workspaceSync';/);
  assert.match(feature, /const DEFAULT_STATUS_BAR_PRIORITY = 999;/);
  assert.match(feature, /createStatusBarItem\(alignment, priority\)/);
  assert.match(feature, /return '\$\(sync\) Workspace Sync';/);
  assert.match(feature, /return '\$\(sync\)';/);
  assert.match(feature, /return 'Workspace Sync';/);
  assert.match(feature, /item\.command = COMMAND_OPEN_WORKSPACE_SYNC;/);
  assert.match(feature, /event\.affectsConfiguration\(CONFIG_SECTION\)/);
});
