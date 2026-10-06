import { renderRemoteSearchSnippetFunctions } from '../search/RemoteSearchPresentation';
import { renderMultiTargetOverlays } from '../multiTarget/MultiTargetOverlays';
import { renderMultiTargetFeedbackScript } from '../multiTarget/MultiTargetFeedback';
export function renderMultiTargetScript(): string {
  return String.raw`
(() => {
  const vscode = acquireVsCodeApi();
  let mode = 'commands';
  const isSearch = () => mode === 'search';
  const $ = id => document.getElementById(isSearch() && (id === 'sudo' || id === 'run') ? 'search-' + id : id);
  const post = (type, values = {}) => vscode.postMessage({ type, mode, ...values });
  let state = { targets: [], profiles: [], groups: [], busy: false };
  let bootstrapped = false, pendingScroll;
  const views = { commands: {}, search: {} };
  let resultView = {}, batchQuery = {};
  let initialized = false, batchId = '', selected = '', filter = 'All', ratio = .3, activeInputRequestId = '';
  let activeTooltipTarget = null, tooltipTimer = 0, activeTextEditTarget = null;
  let draftTargets = new Set(), activeManageGroup = '', savedCommands = [], targetSets = [], preferenceTimer, sessionStateTimer;
  let editingSavedCommandId = '', pendingReplaceId = '', pendingDeleteId = '', returnToSavedCommands = false, resetSavedSearchOnOpen = false;
  let editingTargetSetId = '', pendingTargetSetReplaceId = '', pendingTargetSetDeleteId = '', returnToTargetSets = false, resetTargetSetSearchOnOpen = false;
  let draftTargetSetTargets = new Map();
  const executions = new Map(), resultRows = new Map(), targetRows = new Map();
  // Exact connect/disconnect icons used by the Remote Edit Connection Profiles dropdown.
  const PROFILE_ACTION_CONNECT_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" focusable="false" aria-hidden="true"><path d="M10.723 4H10V1.5C10 1.224 9.776 1 9.5 1C9.224 1 9 1.224 9 1.5V4H7V1.5C7 1.224 6.776 1 6.5 1C6.224 1 6 1.224 6 1.5V4H5.277C4.573 4 4 4.573 4 5.278V8C4 10.036 5.529 11.722 7.5 11.969V14.5C7.5 14.776 7.724 15 8 15C8.276 15 8.5 14.776 8.5 14.5V11.969C10.471 11.722 12 10.037 12 8V5.278C12 4.573 11.427 4 10.723 4ZM11 8C11 9.654 9.654 11 8 11C6.346 11 5 9.654 5 8V5.278C5 5.125 5.124 5 5.277 5H10.722C10.875 5 10.999 5.125 10.999 5.278V8H11Z"/></svg>';
  const PROFILE_ACTION_DISCONNECT_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" focusable="false" aria-hidden="true"><path d="M15.3542 0.646006C15.1592 0.451006 14.8422 0.451006 14.6472 0.646006L12.5772 2.71601C11.2072 1.71701 9.20723 1.87301 7.93723 3.14401L7.80623 3.27501C7.31923 3.76201 7.31923 4.55501 7.80623 5.04301L10.9882 8.22501C11.2312 8.46901 11.5512 8.59101 11.8722 8.59101C12.1932 8.59101 12.5132 8.46901 12.7562 8.22501L12.9762 8.00501C13.6522 7.33001 14.0162 6.43101 14.0012 5.47601C13.9892 4.72001 13.7412 4.00601 13.2912 3.41701L15.3542 1.35401C15.5492 1.15901 15.5492 0.841006 15.3542 0.646006ZM12.2682 7.29701L12.0482 7.51701C11.9502 7.61501 11.7922 7.61501 11.6942 7.51701L8.51223 4.33501C8.41423 4.23701 8.41423 4.07901 8.51223 3.98101L8.64323 3.85001C9.16723 3.32601 9.86023 3.06001 10.5402 3.06001C11.1502 3.06001 11.7512 3.27401 12.2112 3.70801C12.7092 4.17601 12.9882 4.80901 12.9992 5.49101C13.0092 6.17301 12.7502 6.81501 12.2682 7.29701ZM8.14623 9.14601L7.26623 10.026L5.97323 8.73301L6.85323 7.85301C7.04823 7.65801 7.04823 7.34101 6.85323 7.14601C6.65823 6.95101 6.34123 6.95101 6.14623 7.14601L5.26623 8.02601L5.01323 7.77301C4.52723 7.28701 3.73223 7.28701 3.24523 7.77401L3.02523 7.99401C2.34923 8.66901 1.98523 9.56801 2.00023 10.523C2.01223 11.279 2.26023 11.993 2.71023 12.582L0.647227 14.645C0.452227 14.84 0.452227 15.157 0.647227 15.352C0.745227 15.45 0.873227 15.498 1.00123 15.498C1.12923 15.498 1.25723 15.449 1.35523 15.352L3.42523 13.282C4.02223 13.717 4.73723 13.934 5.46123 13.934C6.39923 13.934 7.34923 13.571 8.06523 12.854L8.19623 12.723C8.68323 12.236 8.68323 11.443 8.19623 10.955L7.97423 10.733L8.85423 9.85301C9.04923 9.65801 9.04923 9.34101 8.85423 9.14601C8.65923 8.95101 8.34223 8.95101 8.14723 9.14601H8.14623ZM7.48923 12.018L7.35723 12.149C6.36323 13.144 4.76123 13.208 3.78923 12.291C3.29123 11.823 3.01223 11.19 3.00123 10.508C2.99123 9.82601 3.25123 9.18401 3.73323 8.70201L3.95323 8.48201C4.00223 8.43301 4.06523 8.40901 4.13023 8.40901C4.19523 8.40901 4.25823 8.43301 4.30723 8.48201C5.37118 9.54596 6.42725 10.602 7.48723 11.662C7.58523 11.76 7.58523 11.918 7.48723 12.016L7.48923 12.018Z"/></svg>';
  const active = status => ['Pending', 'Connecting', 'Running'].includes(status);
  const targetIsLive = target => target && (target.status === 'Connected' || target.status === 'Connecting');
  function globalConnectionAction() {
    const hasLive = state.targets.some(targetIsLive);
    const hasConnectable = state.targets.some(target => !targetIsLive(target));
    if (state.anyBusy && hasLive) return 'disconnect';
    return hasConnectable ? 'connect' : (hasLive ? 'disconnect' : 'connect');
  }
  const countText = count => count > 999 ? '999+' : String(count);
  function cell(text = '') { const td = document.createElement('td'); td.textContent = text; return td; }
  function escapeHtml(value) { return String(value || '').replace(/[&<>\"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' })[char]); }
${renderMultiTargetFeedbackScript()}  function setTemporaryPasswordVisible(input, visible) {
    if (!input || input.disabled) return;
    input.type = visible ? 'text' : 'password';
  }
  function hideTemporaryPassword(input) {
    if (!input) return;
    input.type = 'password';
  }
  function bindTemporaryPasswordReveal(button, input) {
    if (!button || !input) return;
    const show = event => {
      if (button.disabled || input.disabled) return;
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      setTemporaryPasswordVisible(input, true);
    };
    const hide = event => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      hideTemporaryPassword(input);
    };
    bindHoldButton(button, show, hide);
  }
  function bindHoldButton(button, show, hide) {
    button.addEventListener('mousedown', show);
    button.addEventListener('mouseup', hide);
    button.addEventListener('mouseleave', hide);
    button.addEventListener('blur', hide);
    button.addEventListener('touchstart', show, { passive: false });
    button.addEventListener('touchend', hide);
    button.addEventListener('touchcancel', hide);
    button.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') show(event);
    });
    button.addEventListener('keyup', event => {
      if (event.key === ' ' || event.key === 'Enter') hide(event);
    });
    button.addEventListener('click', event => event.preventDefault());
  }
${renderMultiTargetOverlays(true)}
  function queryFields() {
    return { fileName: $('filename').value, textToFind: $('text-to-find').value,
      includeSubdirectories: $('include-subdirectories').checked, includeHiddenFiles: $('include-hidden-files').checked,
      caseSensitive: $('case-sensitive').checked, searchInsideFiles: $('search-inside-file').checked, useSudo: $('sudo').checked };
  }
  function currentScrollState() { return { output: $('output-wrap').scrollTop, table: $('result-table-wrap').scrollTop }; }
  function currentUiState() { return isSearch()
    ? { ratio, query: queryFields(), resultView, filter, selectedCommandId: selected, scroll: currentScrollState() }
    : { ratio, command: $('command').value, useSudo: $('sudo').checked, filter, selectedCommandId: selected, scroll: currentScrollState() }; }

  function showTemporaryButtonText(button, text = 'Copied', durationMs = 1200) {
    if (!button) return;
    const originalText = button.getAttribute('data-original-text') || button.textContent || '';
    button.setAttribute('data-original-text', originalText);
    button.textContent = String(text || 'Copied');
    if (button._remoteEditCopyFeedbackTimer) window.clearTimeout(button._remoteEditCopyFeedbackTimer);
    button._remoteEditCopyFeedbackTimer = window.setTimeout(() => {
      button.textContent = button.getAttribute('data-original-text') || originalText || 'Copy';
      button._remoteEditCopyFeedbackTimer = 0;
    }, Number(durationMs || 0) || 1200);
  }
  function updateCopyControls() {
    const hasConnected = state.targets.some(target => target.status === 'Connected');
    const selectedExecution = executions.get(selected);
    $('copy-output').disabled = !(isSearch() ? selectedExecution?.results?.length : selectedExecution?.output);
    $('copy-all-outputs').disabled = ![...executions.values()].some(execution => isSearch() ? execution.results?.length : execution.output);
  }
  function syncUiState() { post('uiState', currentUiState()); }
  function savePreferences() { post('preferences', currentUiState()); }
  function scheduleUiState() { clearTimeout(sessionStateTimer); sessionStateTimer = setTimeout(syncUiState, 100); }
  function controls() {
    const connected = state.targets.filter(t => t.status === 'Connected').length;
    const hasConnected = connected > 0;
    const connectionAction = globalConnectionAction();
    $('run').textContent = isSearch() ? 'Search' : 'Run';
    $('run').disabled = state.busy || !hasConnected || (isSearch() ? ($('search-inside-file').checked && !$('text-to-find').value) : !$('command').value.trim());
    $('manage').disabled = state.anyBusy;
    $('bulk-directory').disabled = state.anyBusy || !state.targets.length;
    $('save-target-set').disabled = state.anyBusy || !state.targets.length;
    $('target-sets').disabled = state.anyBusy;
    if (isSearch()) {
    for (const id of ['filename', 'include-subdirectories', 'include-hidden-files', 'case-sensitive', 'sudo', 'search-inside-file']) $(id).disabled = state.busy;
    const searchInsideFiles = $('search-inside-file').checked;
    $('text-to-find').disabled = state.busy || !searchInsideFiles;
    $('text-to-find-field').classList.toggle('inactive', !searchInsideFiles);
    $('text-to-find-field').setAttribute('aria-hidden', searchInsideFiles ? 'false' : 'true');
    resize();
    } else {
    $('save-command').disabled = state.busy || !hasConnected || !$('command').value.trim();
    $('saved').disabled = state.busy || !hasConnected;
    $('sudo').disabled = state.busy;
    $('command').readOnly = state.busy;
    }
    $('connect').textContent = connectionAction === 'disconnect' ? 'Disconnect' : 'Connect';
    $('connect').classList.remove('secondary');
    $('connect').disabled = !state.targets.length || (state.anyBusy && connectionAction === 'connect');
    for (const target of state.targets) {
      const row = targetRows.get(target.connectionId);
      if (!row) continue;
      const connect = row.querySelector('.target-connect-action');
      const remove = row.querySelector('.target-remove-action');
      const live = targetIsLive(target);
      if (connect) {
        const connected = target.status === 'Connected';
        const connecting = target.status === 'Connecting';
        const icon = connect.querySelector('.target-connect-action-icon');
        connect.classList.toggle('busy', connecting);
        if (icon) icon.innerHTML = connected ? PROFILE_ACTION_DISCONNECT_ICON : PROFILE_ACTION_CONNECT_ICON;
        const connectTooltip = (connecting ? 'Connecting ' : (connected ? 'Disconnect ' : 'Connect ')) + target.name;
        connect.setAttribute('data-tooltip', connectTooltip);
        connect.setAttribute('aria-label', connectTooltip);
        connect.disabled = connecting || (state.anyBusy && !connected);
      }
      if (remove) remove.disabled = state.anyBusy;
    }
    document.querySelectorAll('[data-filter]').forEach(button => button.disabled = !executions.size);
    $('stop-all').disabled = ![...executions.values()].some(e => active(e.status));
    $('clear').disabled = state.busy || (!executions.size && !$('feedback-primary').textContent && !$('feedback-secondary').textContent);
    updateCopyControls();
    for (const row of resultRows.values()) {
      const stop = row.children[4]?.firstChild;
      if (stop) stop.disabled = false;
    }
  }
  function renderTargets() {
    const ids = new Set(state.targets.map(t => t.connectionId));
    for (const [id, row] of targetRows) if (!ids.has(id)) { row.remove(); targetRows.delete(id); }
    for (const target of state.targets) {
      let row = targetRows.get(target.connectionId);
      if (!row) {
        row = document.createElement('tr'); row.append(cell(), cell(), cell(), cell()); row.children[0].className = 'target-name'; row.children[3].className = 'target-actions-cell';
        const input = document.createElement('input'); input.className = 'directory'; input.placeholder = 'Default'; input.spellcheck = false;
        input.addEventListener('change', () => post('directory', { ids: [target.connectionId], value: input.value }));
        row.children[1].append(input);
        const actions = document.createElement('div'); actions.className = 'target-row-actions';
        const connect = document.createElement('button'); connect.className = 'target-connect-action';
        connect.type = 'button';
        const spinner = document.createElement('span'); spinner.className = 'target-connect-action-spinner'; spinner.setAttribute('aria-hidden', 'true');
        const icon = document.createElement('span'); icon.className = 'target-connect-action-icon'; icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = PROFILE_ACTION_CONNECT_ICON;
        connect.append(spinner, icon);
        connect.addEventListener('click', () => {
          const current = state.targets.find(item => item.connectionId === target.connectionId);
          if (!current || connect.disabled) return;
          feedback(); post('clearFeedback'); post(targetIsLive(current) ? 'disconnectTarget' : 'connectTarget', { connectionId: target.connectionId });
        });
        const remove = document.createElement('button'); remove.className = 'secondary target-remove-action'; remove.textContent = '×';
        remove.setAttribute('data-tooltip', 'Remove ' + target.name); remove.setAttribute('aria-label', 'Remove ' + target.name + ' from Multi-Target Commands & Search');
        remove.addEventListener('click', () => { if (!remove.disabled) { feedback(); post('clearFeedback'); post('removeTarget', { connectionId: target.connectionId }); } });
        actions.append(connect, remove); row.children[3].append(actions);
        targetRows.set(target.connectionId, row); $('target-rows').append(row);
      }
      row.children[0].textContent = target.name;
      const input = row.children[1].firstChild;
      input.setAttribute('aria-label', 'Working directory for ' + target.name); input.disabled = state.anyBusy;
      if (document.activeElement !== input) input.value = target.workingDirectory;
      row.children[2].textContent = target.status; row.children[2].className = 'status-' + target.status;
      const remove = row.querySelector('.target-remove-action');
      if (remove) { remove.setAttribute('data-tooltip', 'Remove ' + target.name); remove.setAttribute('aria-label', 'Remove ' + target.name + ' from Multi-Target Commands & Search'); }
    }
    $('target-empty').hidden = !!state.targets.length;
    $('target-summary').textContent = state.targets.length ? state.targets.length + ' targets · ' + state.targets.filter(t => t.status === 'Connected').length + ' connected' : 'No targets selected';
    controls();
  }
  function resize() {
    const splitterHeight = $('splitter').offsetHeight || 3;
    const height = $('work').clientHeight - splitterHeight;
    const commandMinHeight = 195;
    const resultsMinHeight = 190;
    const commandHeight = Math.max(commandMinHeight, Math.min(height - resultsMinHeight, height * ratio));
    $('command-section').style.flexBasis = commandHeight + 'px';
    $('splitter').setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  }
  new ResizeObserver(resize).observe($('work'));
  const splitter = $('splitter');
  splitter.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    splitter.setPointerCapture(event.pointerId); splitter.classList.add('dragging'); event.preventDefault();
  });
  splitter.addEventListener('pointermove', event => {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    const rect = $('work').getBoundingClientRect();
    ratio = Math.max(.1, Math.min(.8, (event.clientY - rect.top) / (rect.height - ($('splitter').offsetHeight || 3)))); resize();
  });
  function finishResize() { splitter.classList.remove('dragging'); savePreferences(); }
  splitter.addEventListener('pointerup', event => { if (splitter.hasPointerCapture(event.pointerId)) splitter.releasePointerCapture(event.pointerId); finishResize(); });
  splitter.addEventListener('pointercancel', finishResize);
  splitter.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); ratio = event.key === 'Home' ? .1 : event.key === 'End' ? .8 : Math.max(.1, Math.min(.8, ratio + (event.key === 'ArrowUp' ? -.025 : .025)));
    resize(); savePreferences();
  });
  function renderOutput(text, placeholder = false) {
    if (placeholder) return '<span class="output-placeholder">' + escapeHtml(text) + '</span>';
    return escapeHtml(text).split('\n').map(line => {
      if (!line) return '';
      const value = line.replace(/&amp;/g, '&');
      if (value.startsWith('$ ')) return '<span class="output-command">' + line + '</span>';
      if (value.startsWith('[Earlier output truncated]') || value.startsWith('Process exited with code ') || / command\(s\) failed\.$/.test(value) || value.startsWith('Suggested action:')) {
        return '<span class="output-system">' + line + '</span>';
      }
      return line;
    }).join('\n');
  }
  function showOutput() {
    if (isSearch()) { showSearchOutput(); return; }
    const execution = executions.get(selected);
    const output = $('output'), wrap = $('output-wrap');
    const hasExecutionOutput = Boolean(execution && execution.output);
    const text = execution ? (execution.truncated ? '[Earlier output truncated]\n' : '') + (execution.output || (active(execution.status) ? 'Waiting for output…' : execution.status === 'Stopped' ? 'Execution stopped.' : 'No output.')) : 'Select a result to view its output.';
    const html = renderOutput(text, !execution || !hasExecutionOutput);
    if (output.textContent !== text) {
      const follow = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 35;
      output.innerHTML = html;
      if (follow) wrap.scrollTop = wrap.scrollHeight;
    }
    $('output-title').textContent = execution ? 'Output · ' + execution.name + ' · ' + execution.status : 'Output';
    updateCopyControls();
  }
${renderRemoteSearchSnippetFunctions()}
  function targetResultView() {
    return resultView[selected] || (resultView[selected] = { expanded: [], selected: '', limit: 500, scrollTop: 0 });
  }
  function showSearchOutput() {
    const execution = executions.get(selected), output = $('output');
    $('output-title').textContent = execution ? 'Search Results · ' + execution.name + ' · ' + execution.status : 'Search Results';
    if (!execution) { output.innerHTML = '<div class="remote-search-empty">Select a target to view its search results.</div>'; updateCopyControls(); return; }
    const view = targetResultView(), all = execution.results || [], results = all.slice(0, view.limit || 500);
    let html = execution.error ? '<div class="remote-search-empty">' + escapeHtml(execution.error) + '</div>' : '';
    if (!all.length) html += '<div class="remote-search-empty">' + (active(execution.status) ? 'Searching…' : 'No results.') + '</div>';
    const expanded = new Set(view.expanded || []);
    const rowAttrs = (key, path) => ' tabindex="0" data-key="' + escapeHtml(key) + '" data-path="' + escapeHtml(path) + '" data-tooltip="' + escapeHtml(path) + '"';
    if (!batchQuery.searchInsideFiles) {
      html += results.map((result, index) => '<div class="remote-search-result-row remote-search-file-result' + (view.selected === 'file:' + index ? ' selected' : '') + '"' + rowAttrs('file:' + index, result.path) + '>' + escapeHtml(result.path) + '</div>').join('');
    } else {
      const groups = new Map();
      results.forEach((result, index) => { if (!groups.has(result.path)) groups.set(result.path, []); groups.get(result.path).push({ ...result, index }); });
      html += [...groups].map(([path, matches]) => {
        const key = 'group:' + path, open = expanded.has(path);
        return '<div class="remote-search-result-group"><div class="remote-search-result-row remote-search-result-path' + (view.selected === key ? ' selected' : '') + '"' + rowAttrs(key, path) + '>' + (open ? '▾ ' : '▸ ') + escapeHtml(path) + ' <span class="remote-search-match-count">(' + matches.length + (matches.length === 1 ? ' match' : ' matches') + ')</span></div>' + (open ? matches.map(match => '<div class="remote-search-result-row remote-search-match' + (view.selected === 'match:' + match.index ? ' selected' : '') + '"' + rowAttrs('match:' + match.index, path) + '><span class="remote-search-line-number">' + escapeHtml(String(match.line || '')) + '</span><span class="remote-search-line-text">' + renderRemoteSearchMatchSnippet(match.text || '', batchQuery.textToFind, batchQuery.caseSensitive) + '</span></div>').join('') : '') + '</div>';
      }).join('');
    }
    if (all.length > results.length) html += '<div class="remote-search-show-more"><span>Showing ' + results.length + ' of ' + all.length + ' results. Copy Results includes all results.</span><button class="secondary" data-show-more>Show more</button></div>';
    if (output.innerHTML !== html) output.innerHTML = html;
    $('output-wrap').scrollTop = view.scrollTop || 0;
    updateCopyControls();
  }
  function selectedSearchResultText(mode = 'result') {
    if (!isSearch()) return ''; 
    const execution = executions.get(selected); if (!execution) return '';
    const key = targetResultView().selected || '';
    const result = key.startsWith('group:') ? { path: key.slice(6) } : execution.results[Number(key.split(':')[1])];
    if (!result) return '';
    if (mode === 'name') return result.path.split('/').pop() || result.path;
    if (mode === 'path' || result.line === undefined) return result.path;
    return result.path + ':' + result.line + ': ' + (result.text || '');
  }
  function selectSearchContextRow(row) {
    targetResultView().selected = row.dataset.key;
    $('output').querySelectorAll('[data-key]').forEach(item => item.classList.toggle('selected', item.dataset.key === row.dataset.key));
    syncUiState();
  }
  for (const [id, mode] of [['searchCopyPath', 'path'], ['searchCopyName', 'name']]) {
    $(id).addEventListener('click', async () => { await copyTextForContextMenu(selectedSearchResultText(mode)); hideCustomContextMenus(); });
  }
  function selectSearchRow(event) {
    if (!isSearch()) return;
    const more = event.target.closest('[data-show-more]');
    if (more) { targetResultView().limit = (targetResultView().limit || 500) + 500; showOutput(); syncUiState(); return; }
    const row = event.target.closest('[data-key]'); if (!row) return;
    const view = targetResultView(); view.selected = row.dataset.key;
    if (row.dataset.key.startsWith('group:')) {
      const expanded = new Set(view.expanded); if (expanded.has(row.dataset.path)) expanded.delete(row.dataset.path); else expanded.add(row.dataset.path); view.expanded = [...expanded];
    }
    showOutput(); syncUiState();
    [...$('output').querySelectorAll('[data-key]')].find(item => item.dataset.key === view.selected)?.focus({ preventScroll: true });
  }
  $('output').addEventListener('click', selectSearchRow);
  $('output').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectSearchRow(event); } });
  $('output-wrap').addEventListener('scroll', () => {
    if (isSearch() && selected) targetResultView().scrollTop = $('output-wrap').scrollTop;
    scheduleUiState();
  });
  $('result-table-wrap').addEventListener('scroll', scheduleUiState);
  function selectResult(id) {
    resultRows.get(selected)?.classList.remove('selected'); resultRows.get(selected)?.setAttribute('aria-selected', 'false');
    selected = id; resultRows.get(id)?.classList.add('selected'); resultRows.get(id)?.setAttribute('aria-selected', 'true');
    $('output').replaceChildren(); showOutput(); savePreferences();
  }
  function updateRow(execution) {
    let row = resultRows.get(execution.commandId);
    if (!row) {
      row = document.createElement('tr'); row.tabIndex = 0;
      for (let i = 0; i < 5; i++) row.append(cell());
      const stop = document.createElement('button'); stop.className = 'secondary compact'; stop.textContent = 'Stop';
      stop.setAttribute('aria-label', 'Stop ' + execution.name);
      stop.addEventListener('click', event => { event.stopPropagation(); post('stop', { batchId, commandId: execution.commandId }); });
      row.children[4].append(stop);
      row.addEventListener('click', () => selectResult(execution.commandId));
      row.addEventListener('keydown', event => { if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectResult(execution.commandId); } });
      resultRows.set(execution.commandId, row); $('result-rows').append(row);
    }
    row.children[0].textContent = execution.name;
    row.children[1].textContent = execution.status; row.children[1].className = 'status-' + execution.status;
    row.children[2].textContent = isSearch() ? countText(execution.results?.length || 0) : (typeof execution.code === 'number' ? String(execution.code) : '—');
    row.children[4].firstChild.hidden = !active(execution.status);
    row.hidden = filter !== 'All' && !(filter === 'Running' ? active(execution.status) : execution.status === filter);
    duration(execution, row);
  }
  function duration(execution, row) {
    row.children[3].textContent = execution.startedAt ? (Math.max(0, (execution.finishedAt || Date.now()) - execution.startedAt) / 1000).toFixed(1) + 's' : '—';
  }
  function summaries() {
    const values = [...executions.values()];
    const running = values.filter(e => active(e.status)).length, finished = values.filter(e => e.status === 'Finished').length, failed = values.filter(e => e.status === 'Failed').length;
    const counts = { All: values.length, Running: running, Finished: finished, Failed: failed };
    document.querySelectorAll('[data-filter]').forEach(button => { button.textContent = button.dataset.filter + ' ' + countText(counts[button.dataset.filter]); button.classList.toggle('active', filter === button.dataset.filter); });
    const stopped = values.filter(e => e.status === 'Stopped').length;
    $('result-summary').textContent = values.length ? [values.length + ' targets', running ? running + ' active' : 'Completed', finished + ' finished', failed + ' failed', stopped ? stopped + ' stopped' : ''].filter(Boolean).join(' · ') : (isSearch() ? 'No search yet' : 'No execution yet');
    $('result-empty').hidden = [...resultRows.values()].some(row => !row.hidden);
    $('result-empty').textContent = values.length ? 'No results match this filter.' : (isSearch() ? 'Search connected targets to see results.' : 'Run a command to see results.');
    controls();
  }
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; executions.forEach(updateRow); summaries(); savePreferences(); }));
  setInterval(() => { executions.forEach(e => { if (active(e.status)) duration(e, resultRows.get(e.commandId)); }); }, 500);
  $('command').addEventListener('input', () => { controls(); syncUiState(); clearTimeout(preferenceTimer); preferenceTimer = setTimeout(savePreferences, 250); });
  function startRun(sudoPasswords = []) {
    beginOperationFeedback(); state.busy = true; controls();
    post('run', isSearch() ? { query: queryFields(), sudoPasswords } : { command: $('command').value, useSudo: $('sudo').checked, sudoPasswords });
  }
  function sudoPasswordTargets() {
    return state.targets.filter(target => target.status === 'Connected' && target.sudoPasswordRequired === true);
  }
  function clearSudoDialog() {
    $('sudo-target-rows').replaceChildren();
    $('sudo-shared').checked = false;
    $('sudo-shared-password').value = '';
    hideTemporaryPassword($('sudo-shared-password'));
    $('sudo-shared-field').hidden = true;
    $('sudo-dialog').classList.remove('shared-password');
    $('sudo-validation').textContent = '';
  }
  function closeSudoDialog() {
    if ($('sudo-dialog').open) $('sudo-dialog').close();
    clearSudoDialog();
  }
  function sudoPasswordInputs() { return [...$('sudo-target-rows').querySelectorAll('input[data-connection-id]')]; }
  function validateSudoDialog() {
    const valid = $('sudo-shared').checked
      ? Boolean($('sudo-shared-password').value)
      : sudoPasswordInputs().every(input => Boolean(input.value));
    $('sudo-run').disabled = !valid;
    if (valid) $('sudo-validation').textContent = '';
    return valid;
  }
  function updateSharedSudoMode() {
    const shared = $('sudo-shared').checked;
    $('sudo-dialog').classList.toggle('shared-password', shared);
    $('sudo-shared-field').hidden = !shared;
    validateSudoDialog();
    queueMicrotask(() => (shared ? $('sudo-shared-password') : sudoPasswordInputs()[0])?.focus());
  }
  function openSudoDialog(targets) {
    clearSudoDialog();
    const rows = $('sudo-target-rows');
    for (const target of targets) {
      const row = document.createElement('tr');
      const name = cell(target.name);
      const passwordCell = document.createElement('td'); passwordCell.className = 'sudo-password-cell';
      const inputWrap = document.createElement('div'); inputWrap.className = 'input-with-button';
      const input = document.createElement('input');
      input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false; input.dataset.connectionId = target.connectionId;
      input.setAttribute('aria-label', 'Root password for ' + target.name);
      const reveal = document.createElement('button'); reveal.className = 'input-icon-button password-reveal-button has-tooltip'; reveal.type = 'button';
      reveal.setAttribute('aria-label', 'Temporarily Show Password'); reveal.setAttribute('data-tooltip', 'Hold to Show Password');
      reveal.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.3 3 1.73 6.11 1 8c.73 1.89 3.3 5 7 5s6.27-3.11 7-5c-.73-1.89-3.3-5-7-5Zm0 8.5A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7Zm0-1.25A2.25 2.25 0 1 0 8 5.75a2.25 2.25 0 0 0 0 4.5Z" /></svg>';
      bindTemporaryPasswordReveal(reveal, input);
      input.addEventListener('input', () => { $('sudo-validation').textContent = ''; validateSudoDialog(); });
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && validateSudoDialog()) { event.preventDefault(); submitSudoRun(); } });
      inputWrap.append(input, reveal); passwordCell.append(inputWrap); row.append(name, passwordCell); rows.append(row);
    }
    $('sudo-count').textContent = targets.length + (targets.length === 1 ? ' target' : ' targets');
    const option = $('sudo-shared').closest('label'); if (option) option.hidden = targets.length < 2;
    $('sudo-dialog').showModal();
    sudoPasswordInputs()[0]?.focus();
  }
  function submitSudoRun() {
    if (!validateSudoDialog()) {
      $('sudo-validation').textContent = $('sudo-shared').checked ? 'Enter the password to continue.' : 'Enter a password for every target.';
      return;
    }
    const shared = $('sudo-shared').checked ? $('sudo-shared-password').value : '';
    const sudoPasswords = sudoPasswordInputs().map(input => ({ connectionId: input.dataset.connectionId, password: shared || input.value }));
    closeSudoDialog();
    startRun(sudoPasswords);
  }
  function runCommands() {
    if ($('run').disabled) return;
    if (!$('sudo').checked) { startRun(); return; }
    const targets = sudoPasswordTargets();
    if (!targets.length) { startRun(); return; }
    openSudoDialog(targets);
  }
  $('run').addEventListener('click', runCommands);
  $('search-run').addEventListener('click', runCommands);
  for (const id of ['filename', 'text-to-find', 'include-subdirectories', 'include-hidden-files', 'case-sensitive', 'search-sudo', 'search-inside-file']) {
    $(id).addEventListener('input', () => { controls(); syncUiState(); clearTimeout(preferenceTimer); preferenceTimer = setTimeout(savePreferences, 250); });
    $(id).addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); runCommands(); } });
  }
  $('sudo').addEventListener('change', savePreferences);
  $('sudo-shared').addEventListener('change', updateSharedSudoMode);
  bindTemporaryPasswordReveal($('sudo-shared-password-reveal'), $('sudo-shared-password'));
  bindTemporaryPasswordReveal($('input-value-reveal'), $('input-value'));
  $('sudo-shared-password').addEventListener('input', () => { $('sudo-validation').textContent = ''; validateSudoDialog(); });
  $('sudo-shared-password').addEventListener('keydown', event => { if (event.key === 'Enter' && validateSudoDialog()) { event.preventDefault(); submitSudoRun(); } });
  $('sudo-cancel').addEventListener('click', closeSudoDialog);
  $('sudo-run').addEventListener('click', submitSudoRun);
  $('sudo-dialog').addEventListener('cancel', event => { event.preventDefault(); closeSudoDialog(); });
  $('command').addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      runCommands();
    }
  });
  $('save-command').addEventListener('click', () => openSaveCommandDialog(undefined, $('command').value, false));
  $('saved').addEventListener('click', () => { feedback(); resetSavedSearchOnOpen = true; post('savedCommands'); });
  $('save-target-set').addEventListener('click', () => {
    const loaded = targetSets.find(item => item.id === state.targetSetId);
    openSaveTargetSetDialog(loaded, false, true);
  });
  $('target-sets').addEventListener('click', () => { feedback(); resetTargetSetSearchOnOpen = true; post('targetSets'); });
  $('connect').addEventListener('click', () => {
    if ($('connect').disabled) return;
    feedback(); post('clearFeedback'); post(globalConnectionAction() === 'disconnect' ? 'disconnect' : 'connect');
  });
  $('stop-all').addEventListener('click', () => post('stop', { batchId }));
  $('clear').addEventListener('click', () => { feedback(); post('clearFeedback'); post('clear'); });
  $('copy-output').addEventListener('click', () => post('copyOutput', { commandId: selected }));
  $('copy-all-outputs').addEventListener('click', () => post('copyAllOutputs'));
  function visibleSavedCommands() {
    const query = $('saved-search').value.trim().toLowerCase();
    return savedCommands.filter(item => !query || [item.title, item.command].join(' ').toLowerCase().includes(query));
  }
  function loadSavedCommand(item) {
    if (!item || state.busy) return;
    $('command').value = item.command; controls(); savePreferences(); $('saved-dialog').close(); $('command').focus();
  }
  function savedCommandDuplicate(title, excludeId = '') {
    return savedCommands.find(item => item.id !== excludeId && String(item.title || '').localeCompare(title, undefined, { sensitivity: 'accent' }) === 0);
  }
  function renderSavedCommands() {
    const list = $('saved-list'); list.replaceChildren();
    const visible = visibleSavedCommands();
    for (const item of visible) {
      const card = document.createElement('div'); card.className = 'saved-command-card';
      const main = document.createElement('div'); main.className = 'saved-command-main'; main.tabIndex = 0; main.setAttribute('role', 'button'); main.setAttribute('aria-label', 'Load ' + item.title);
      const title = document.createElement('div'); title.className = 'saved-command-name'; title.textContent = item.title || 'Saved command';
      const command = document.createElement('div'); command.className = 'saved-command-text'; command.textContent = String(item.command || '').replace(/\s+/g, ' ').trim();
      main.append(title, command);
      main.addEventListener('click', () => loadSavedCommand(item));
      main.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); loadSavedCommand(item); } });
      const actions = document.createElement('div'); actions.className = 'saved-command-actions';
      const edit = document.createElement('button'); edit.className = 'secondary compact'; edit.textContent = 'Edit'; edit.setAttribute('data-tooltip', 'Edit saved command');
      edit.addEventListener('click', () => { $('saved-dialog').close(); openSaveCommandDialog(item, item.command, true); });
      const remove = document.createElement('button'); remove.className = 'secondary compact'; remove.textContent = 'Delete'; remove.setAttribute('data-tooltip', 'Delete saved command');
      remove.addEventListener('click', () => openDeleteSavedCommand(item));
      actions.append(edit, remove); card.append(main, actions); list.append(card);
    }
    if (!visible.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = savedCommands.length ? 'No commands match this search.' : 'No commands saved for Multi-Target Commands.'; list.append(empty); }
    $('saved-count').textContent = savedCommands.length + (savedCommands.length === 1 ? ' command' : ' commands');
  }
  $('saved-search').addEventListener('input', renderSavedCommands);
  $('saved-close').addEventListener('click', () => $('saved-dialog').close());
  function openSavedCommands(items, resetSearch = true) {
    if (Array.isArray(items)) savedCommands = items;
    if (resetSearch) $('saved-search').value = '';
    renderSavedCommands();
    if (!$('saved-dialog').open) $('saved-dialog').showModal();
    $('saved-search').focus();
  }
  function resetSaveCommandConfirmation() {
    pendingReplaceId = '';
    $('saved-command-validation').textContent = '';
    $('saved-command-submit').textContent = 'Save';
  }
  function openSaveCommandDialog(item, command, returnToSaved) {
    editingSavedCommandId = item?.id || '';
    returnToSavedCommands = Boolean(returnToSaved);
    pendingReplaceId = '';
    $('save-command-title').textContent = item ? 'Edit Saved Command' : 'Save Command';
    $('saved-command-name').value = item?.title || '';
    $('saved-command-body').value = item?.command || command || '';
    $('saved-command-validation').textContent = '';
    $('saved-command-submit').textContent = 'Save';
    $('save-command-dialog').showModal();
    $('saved-command-name').focus();
    $('saved-command-name').select();
  }
  function closeSaveCommandDialog(reopen = returnToSavedCommands) {
    if ($('save-command-dialog').open) $('save-command-dialog').close();
    editingSavedCommandId = ''; pendingReplaceId = ''; returnToSavedCommands = false;
    if (reopen) openSavedCommands(undefined, false);
  }
  function submitSavedCommand() {
    const title = $('saved-command-name').value.trim();
    const command = $('saved-command-body').value;
    if (!title) { $('saved-command-validation').textContent = 'Enter a title.'; $('saved-command-name').focus(); return; }
    if (!command.trim()) { $('saved-command-validation').textContent = 'Enter a command.'; $('saved-command-body').focus(); return; }
    const duplicate = savedCommandDuplicate(title, editingSavedCommandId);
    if (duplicate && pendingReplaceId !== duplicate.id) {
      pendingReplaceId = duplicate.id;
      $('saved-command-validation').textContent = 'A command named "' + title + '" already exists. Click Replace to overwrite it.';
      $('saved-command-submit').textContent = 'Replace';
      return;
    }
    const reopen = returnToSavedCommands;
    feedback(); post('clearFeedback'); post('saveSavedCommand', { id: editingSavedCommandId, title, command, replaceId: pendingReplaceId, reopen });
    if ($('save-command-dialog').open) $('save-command-dialog').close();
    editingSavedCommandId = ''; pendingReplaceId = ''; returnToSavedCommands = false;
  }
  $('saved-command-name').addEventListener('input', resetSaveCommandConfirmation);
  $('saved-command-body').addEventListener('input', resetSaveCommandConfirmation);
  $('saved-command-cancel').addEventListener('click', () => closeSaveCommandDialog());
  $('saved-command-submit').addEventListener('click', submitSavedCommand);
  $('save-command-dialog').addEventListener('cancel', event => { event.preventDefault(); closeSaveCommandDialog(); });
  $('saved-command-name').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitSavedCommand(); } });
  function openDeleteSavedCommand(item) {
    pendingDeleteId = item?.id || '';
    if (!pendingDeleteId) return;
    $('saved-delete-message').textContent = 'Delete “' + item.title + '”? This saved command will be permanently removed.';
    $('saved-dialog').close();
    $('saved-delete-dialog').showModal();
    $('saved-delete-confirm').focus();
  }
  function closeDeleteSavedCommand(reopen = true) {
    if ($('saved-delete-dialog').open) $('saved-delete-dialog').close();
    pendingDeleteId = '';
    if (reopen) openSavedCommands(undefined, false);
  }
  $('saved-delete-cancel').addEventListener('click', () => closeDeleteSavedCommand(true));
  $('saved-delete-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDeleteSavedCommand(true); });
  $('saved-delete-confirm').addEventListener('click', () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId; pendingDeleteId = '';
    $('saved-delete-dialog').close();
    feedback(); post('clearFeedback'); post('deleteSavedCommand', { id, reopen: true });
  });
  function syncTargetSetSearchClearButton() {
    const input = $('target-set-search'), box = $('target-set-search-box'), clear = $('clear-target-set-search');
    const hasValue = Boolean(input.value);
    box.classList.toggle('has-value', hasValue);
    clear.disabled = !hasValue;
  }
  function visibleTargetSets() {
    const query = $('target-set-search').value.trim().toLowerCase();
    return targetSets.filter(item => !query || [item.title, ...(item.targets || []).map(target => {
      const profile = state.profiles.find(profile => profile.id === target.connectionId);
      return profile?.name || target.connectionId;
    })].join(' ').toLowerCase().includes(query));
  }
  function targetSetDuplicate(title, excludeId = '') {
    return targetSets.find(item => item.id !== excludeId && String(item.title || '').localeCompare(title, undefined, { sensitivity: 'accent' }) === 0);
  }
  function renderTargetSets() {
    const list = $('target-set-list'); list.replaceChildren();
    const visible = visibleTargetSets();
    for (const item of visible) {
      const card = document.createElement('div'); card.className = 'target-set-card';
      const main = document.createElement('div'); main.className = 'target-set-main'; main.tabIndex = 0; main.setAttribute('role', 'button'); main.setAttribute('aria-label', 'Load ' + item.title);
      const title = document.createElement('div'); title.className = 'target-set-name'; title.textContent = item.title || 'Target set';
      const detail = document.createElement('div'); detail.className = 'target-set-detail';
      detail.textContent = (item.targets?.length || 0) + ((item.targets?.length || 0) === 1 ? ' target' : ' targets');
      main.append(title, detail);
      const loadTargetSet = () => { feedback(); $('target-sets-dialog').close(); post('loadTargetSet', { id: item.id }); };
      main.addEventListener('click', loadTargetSet);
      main.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); loadTargetSet(); } });
      const actions = document.createElement('div'); actions.className = 'target-set-actions';
      const edit = document.createElement('button'); edit.className = 'secondary compact'; edit.textContent = 'Edit'; edit.addEventListener('click', () => openSaveTargetSetDialog(item, true));
      const del = document.createElement('button'); del.className = 'secondary compact'; del.textContent = 'Delete'; del.addEventListener('click', () => openDeleteTargetSet(item));
      actions.append(edit, del); card.append(main, actions); list.append(card);
    }
    if (!visible.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = targetSets.length ? 'No target sets match this search.' : 'No shared target sets saved.'; list.append(empty); }
    $('target-set-count').textContent = targetSets.length + (targetSets.length === 1 ? ' set' : ' sets');
  }
  function openTargetSets(items, resetSearch = true) {
    if (Array.isArray(items)) targetSets = items;
    if (resetSearch) $('target-set-search').value = '';
    syncTargetSetSearchClearButton();
    renderTargetSets();
    if (!$('target-sets-dialog').open) $('target-sets-dialog').showModal();
    $('target-set-search').focus();
  }
  function clearTargetSetSearch() {
    $('target-set-search').value = '';
    syncTargetSetSearchClearButton();
    renderTargetSets();
    $('target-set-search').focus();
  }
  $('target-set-search').addEventListener('input', () => { syncTargetSetSearchClearButton(); renderTargetSets(); });
  $('target-set-search').addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !$('target-set-search').value) return;
    event.preventDefault(); event.stopPropagation(); clearTargetSetSearch();
  });
  $('clear-target-set-search').addEventListener('click', clearTargetSetSearch);
  $('target-sets-close').addEventListener('click', () => $('target-sets-dialog').close());
  $('target-sets-dialog').addEventListener('cancel', event => { event.preventDefault(); $('target-sets-dialog').close(); });
  function buildTargetSetEditorRows(sourceTargets) {
    draftTargetSetTargets = new Map((sourceTargets || []).map(target => [target.connectionId, {
      connectionId: target.connectionId,
      workingDirectory: String(target.workingDirectory || '')
    }]));
    const profiles = [...state.profiles];
    for (const target of sourceTargets || []) {
      if (!profiles.some(profile => profile.id === target.connectionId)) profiles.push({ id: target.connectionId, name: 'Unavailable connection', host: '', username: '', groupId: '' });
    }
    profiles.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const tbody = $('target-set-editor-rows'); tbody.replaceChildren();
    for (const profile of profiles) {
      const row = document.createElement('tr'); row.dataset.connectionId = profile.id;
      const targetCell = document.createElement('td');
      const choice = document.createElement('label'); choice.className = 'target-set-choice';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = draftTargetSetTargets.has(profile.id);
      const name = document.createElement('span'); name.textContent = profile.name || profile.id;
      choice.append(checkbox, name); targetCell.append(choice);
      const directoryCell = document.createElement('td');
      const directory = document.createElement('input'); directory.className = 'target-set-directory'; directory.type = 'text'; directory.spellcheck = false;
      directory.placeholder = 'Default';
      directory.value = draftTargetSetTargets.get(profile.id)?.workingDirectory
        ?? state.targets.find(target => target.connectionId === profile.id)?.workingDirectory
        ?? '';
      directory.disabled = !checkbox.checked;
      directory.setAttribute('aria-label', 'Working directory for ' + (profile.name || profile.id));
      directory.addEventListener('input', () => {
        if (checkbox.checked) draftTargetSetTargets.set(profile.id, { connectionId: profile.id, workingDirectory: directory.value });
        $('target-set-validation').textContent = '';
      });
      directoryCell.append(directory);
      checkbox.addEventListener('change', () => {
        directory.disabled = !checkbox.checked;
        if (checkbox.checked) draftTargetSetTargets.set(profile.id, { connectionId: profile.id, workingDirectory: directory.value });
        else draftTargetSetTargets.delete(profile.id);
        $('target-set-validation').textContent = '';
      });
      row.append(targetCell, directoryCell); tbody.append(row);
    }
  }
  function resetTargetSetConfirmation() {
    pendingTargetSetReplaceId = '';
    $('target-set-validation').textContent = '';
    $('target-set-submit').textContent = 'Save';
  }
  function openSaveTargetSetDialog(item, fromTargetSets, useCurrentTargets = false) {
    editingTargetSetId = item?.id || '';
    returnToTargetSets = Boolean(fromTargetSets);
    pendingTargetSetReplaceId = '';
    const canSaveNew = Boolean(item?.id && !fromTargetSets && item.id === state.targetSetId);
    $('save-target-set-title').textContent = fromTargetSets && item ? 'Edit Target Set' : 'Save Target Set';
    $('target-set-name').value = item?.title || '';
    $('target-set-validation').textContent = '';
    $('target-set-submit').textContent = 'Save';
    $('target-set-save-new').hidden = !canSaveNew;
    const sourceTargets = useCurrentTargets
      ? state.targets.map(target => ({ connectionId: target.connectionId, workingDirectory: target.workingDirectory || '' }))
      : (item?.targets || state.targets.map(target => ({ connectionId: target.connectionId, workingDirectory: target.workingDirectory || '' })));
    buildTargetSetEditorRows(sourceTargets);
    if ($('target-sets-dialog').open) $('target-sets-dialog').close();
    $('save-target-set-dialog').showModal();
    $('target-set-name').focus(); $('target-set-name').select();
  }
  function closeSaveTargetSetDialog(reopen = returnToTargetSets) {
    if ($('save-target-set-dialog').open) $('save-target-set-dialog').close();
    editingTargetSetId = ''; pendingTargetSetReplaceId = ''; returnToTargetSets = false; draftTargetSetTargets = new Map();
    $('target-set-save-new').hidden = true;
    if (reopen) openTargetSets(undefined, false);
  }
  function submitTargetSet(saveAsNew = false) {
    const title = $('target-set-name').value.trim();
    const targets = [...draftTargetSetTargets.values()].map(target => ({ connectionId: target.connectionId, workingDirectory: String(target.workingDirectory || '').trim() }));
    if (!title) { $('target-set-validation').textContent = 'Enter a title.'; $('target-set-name').focus(); return; }
    if (!targets.length) { $('target-set-validation').textContent = 'Select at least one target.'; return; }
    if (targets.some(target => target.workingDirectory.includes('\0') || /[\r\n]/.test(target.workingDirectory))) {
      $('target-set-validation').textContent = 'Enter each working directory on one line.'; return;
    }
    const duplicate = targetSetDuplicate(title, saveAsNew ? '' : editingTargetSetId);
    if (saveAsNew && duplicate) {
      $('target-set-validation').textContent = 'A target set named "' + title + '" already exists. Enter a different title to save a new set.';
      $('target-set-name').focus(); return;
    }
    if (duplicate && pendingTargetSetReplaceId !== duplicate.id) {
      pendingTargetSetReplaceId = duplicate.id;
      $('target-set-validation').textContent = 'A target set named "' + title + '" already exists. Click Replace to overwrite it.';
      $('target-set-submit').textContent = 'Replace';
      return;
    }
    const reopen = returnToTargetSets;
    feedback(); post('clearFeedback'); post('saveTargetSet', {
      id: editingTargetSetId,
      title,
      targets,
      replaceId: pendingTargetSetReplaceId,
      reopen,
      saveAsNew,
      loadAfterSave: !returnToTargetSets
    });
    if ($('save-target-set-dialog').open) $('save-target-set-dialog').close();
    editingTargetSetId = ''; pendingTargetSetReplaceId = ''; returnToTargetSets = false; draftTargetSetTargets = new Map();
  }
  $('target-set-name').addEventListener('input', resetTargetSetConfirmation);
  $('target-set-cancel').addEventListener('click', () => closeSaveTargetSetDialog());
  $('target-set-save-new').addEventListener('click', () => submitTargetSet(true));
  $('target-set-submit').addEventListener('click', () => submitTargetSet(false));
  $('save-target-set-dialog').addEventListener('cancel', event => { event.preventDefault(); closeSaveTargetSetDialog(); });
  $('target-set-name').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitTargetSet(false); } });
  function openDeleteTargetSet(item) {
    pendingTargetSetDeleteId = item?.id || '';
    if (!pendingTargetSetDeleteId) return;
    $('target-set-delete-message').textContent = 'Delete “' + item.title + '”? This target set will be permanently removed.';
    if ($('target-sets-dialog').open) $('target-sets-dialog').close();
    $('target-set-delete-dialog').showModal(); $('target-set-delete-confirm').focus();
  }
  function closeDeleteTargetSet(reopen = true) {
    if ($('target-set-delete-dialog').open) $('target-set-delete-dialog').close();
    pendingTargetSetDeleteId = '';
    if (reopen) openTargetSets(undefined, false);
  }
  $('target-set-delete-cancel').addEventListener('click', () => closeDeleteTargetSet(true));
  $('target-set-delete-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDeleteTargetSet(true); });
  $('target-set-delete-confirm').addEventListener('click', () => {
    if (!pendingTargetSetDeleteId) return;
    const id = pendingTargetSetDeleteId; pendingTargetSetDeleteId = '';
    $('target-set-delete-dialog').close(); feedback(); post('clearFeedback'); post('deleteTargetSet', { id, reopen: true });
  });
  function closeInputPrompt(notifyCancel) {
    if (!$('input-dialog').open) { activeInputRequestId = ''; return; }
    const requestId = activeInputRequestId; activeInputRequestId = ''; $('input-dialog').close();
    $('input-value').value = '';
    $('input-value').type = 'text';
    $('input-value-wrap').classList.add('reveal-hidden');
    $('input-value-reveal').disabled = true;
    $('input-value-reveal').style.display = 'none';
    if (notifyCancel && requestId) post('inputPromptResult', { requestId, cancelled: true });
  }
  function openInputPrompt(message) {
    if ($('input-dialog').open) closeInputPrompt(true);
    activeInputRequestId = String(message.requestId || '');
    $('input-title').textContent = message.title || 'Multi-Target Commands & Search';
    $('input-prompt').textContent = message.prompt || '';
    const inputPasswordMode = Boolean(message.password);
    $('input-value').type = inputPasswordMode ? 'password' : 'text';
    $('input-value').placeholder = message.placeHolder || '';
    $('input-value').value = message.value || '';
    $('input-value-wrap').classList.toggle('reveal-hidden', !inputPasswordMode);
    $('input-value-reveal').disabled = !inputPasswordMode;
    $('input-value-reveal').style.display = inputPasswordMode ? '' : 'none';
    $('input-validation').textContent = '';
    $('input-dialog').showModal(); $('input-value').focus(); $('input-value').select();
  }
  function submitInputPrompt() {
    if (!activeInputRequestId) return;
    $('input-validation').textContent = '';
    post('inputPromptResult', { requestId: activeInputRequestId, value: $('input-value').value });
  }
  $('input-submit').addEventListener('click', submitInputPrompt);
  $('input-cancel').addEventListener('click', () => closeInputPrompt(true));
  $('input-value').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submitInputPrompt(); } });
  $('input-dialog').addEventListener('cancel', event => { event.preventDefault(); closeInputPrompt(true); });
  function syncManageSearchClearButton() {
    const input = $('search'), box = $('manage-search-box'), clear = $('clear-manage-search');
    const hasValue = Boolean(input.value);
    box.classList.toggle('has-value', hasValue);
    clear.disabled = !hasValue;
  }
  function visibleProfiles() {
    const search = $('search').value.trim().toLowerCase(), group = activeManageGroup;
    return state.profiles.filter(profile => (!group || (group === '__ungrouped__' ? !profile.groupId : profile.groupId === group)) && (!search || [profile.name, profile.host, profile.username].join(' ').toLowerCase().includes(search)));
  }
  function syncSelectVisible() {
    const checkbox = $('select-visible');
    const profiles = visibleProfiles();
    const selectedCount = profiles.reduce((count, profile) => count + (draftTargets.has(profile.id) ? 1 : 0), 0);
    checkbox.disabled = profiles.length === 0;
    checkbox.checked = profiles.length > 0 && selectedCount === profiles.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < profiles.length;
  }
  function renderManageGroups() {
    const list = $('manage-groups'); list.replaceChildren();
    const groups = [{ id: '', name: 'All' }, { id: '__ungrouped__', name: 'Ungrouped' }, ...state.groups];
    for (const group of groups) {
      const item = document.createElement('button'); item.type = 'button'; item.className = 'manage-group-item' + (activeManageGroup === group.id ? ' selected' : '');
      item.textContent = group.name; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', activeManageGroup === group.id ? 'true' : 'false');
      item.addEventListener('click', () => { if (activeManageGroup === group.id) return; activeManageGroup = group.id; renderManageGroups(); renderProfiles(); });
      list.append(item);
    }
  }
  function renderProfiles() {
    $('manage-list').replaceChildren();
    for (const profile of visibleProfiles()) {
      const label = document.createElement('label'); label.className = 'profile';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = draftTargets.has(profile.id);
      checkbox.addEventListener('change', () => { if (checkbox.checked) draftTargets.add(profile.id); else draftTargets.delete(profile.id); $('manage-count').textContent = draftTargets.size + ' selected'; syncSelectVisible(); });
      const name = document.createElement('span'); name.className = 'profile-text'; name.textContent = profile.name;
      const details = document.createElement('span'); details.className = 'detail'; details.textContent = [profile.username ? profile.username + '@' + profile.host : profile.host, state.groups.find(g => g.id === profile.groupId)?.name].filter(Boolean).join(' · ');
      name.append(details); label.append(checkbox, name); $('manage-list').append(label);
    }
    if (!$('manage-list').children.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No matching SSH/SFTP connections.'; $('manage-list').append(empty); }
    $('manage-count').textContent = draftTargets.size + ' selected'; syncSelectVisible();
  }
  $('manage').addEventListener('click', () => {
    draftTargets = new Set(state.targets.map(t => t.connectionId)); activeManageGroup = ''; $('search').value = '';
    syncManageSearchClearButton(); renderManageGroups(); renderProfiles(); $('manage-dialog').showModal(); $('search').focus();
  });
  function clearManageSearch() {
    $('search').value = ''; syncManageSearchClearButton(); renderProfiles(); $('search').focus();
  }
  $('search').addEventListener('input', () => { syncManageSearchClearButton(); renderProfiles(); });
  $('search').addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !$('search').value) return;
    event.preventDefault(); event.stopPropagation(); clearManageSearch();
  });
  $('clear-manage-search').addEventListener('click', clearManageSearch);
  $('select-visible').addEventListener('change', () => { const checked = $('select-visible').checked; visibleProfiles().forEach(profile => checked ? draftTargets.add(profile.id) : draftTargets.delete(profile.id)); renderProfiles(); });
  $('manage-cancel').addEventListener('click', () => $('manage-dialog').close());
  $('manage-save').addEventListener('click', () => { post('targets', { ids: [...draftTargets] }); $('manage-dialog').close(); });
  $('bulk-directory').addEventListener('click', () => { $('bulk-path').value = ''; $('directory-dialog').showModal(); $('bulk-path').focus(); });
  $('directory-cancel').addEventListener('click', () => $('directory-dialog').close());
  $('directory-save').addEventListener('click', () => { feedback(); post('clearFeedback'); post('directory', { ids: state.targets.map(t => t.connectionId), value: $('bulk-path').value }); $('directory-dialog').close(); });
  function receive(message) {
    if (message.mode && message.mode !== mode) return;
    if (message.type === 'busy') { const wasBusy = state.busy; state.busy = message.busy; if (wasBusy && !state.busy) clearTransientFeedback(); controls(); }
    else if (message.type === 'state') {
      state = message; savedCommands = Array.isArray(message.savedCommands) ? message.savedCommands : savedCommands; targetSets = Array.isArray(message.targetSets) ? message.targetSets : targetSets;
      if (!initialized) {
        initialized = true; ratio = message.ratio;
        if (message.scroll && typeof message.scroll === 'object') pendingScroll = message.scroll;
        if (isSearch()) {
          resultView = message.resultView || resultView;
          const query = message.query || {};
          $('filename').value = query.fileName || '*'; $('text-to-find').value = query.textToFind || '';
          $('include-subdirectories').checked = query.includeSubdirectories !== false; $('include-hidden-files').checked = Boolean(query.includeHiddenFiles);
          $('case-sensitive').checked = Boolean(query.caseSensitive); $('sudo').checked = Boolean(query.useSudo); $('search-inside-file').checked = Boolean(query.searchInsideFiles);
        } else { $('command').value = message.command; $('sudo').checked = Boolean(message.useSudo); }

        filter = ['All', 'Running', 'Finished', 'Failed'].includes(message.filter) ? message.filter : 'All';
        selected = typeof message.selectedCommandId === 'string' ? message.selectedCommandId : ''; resize();
      }
      renderTargets();
    } else if (message.type === 'batch') {
      const preferredSelection = (typeof message.selectedCommandId === 'string' ? message.selectedCommandId : '') || selected;
      if (isSearch() && batchId && batchId !== message.batchId) resultView = {};
      batchQuery = message.query || {};
      batchId = message.batchId || ''; selected = ''; executions.clear(); resultRows.clear(); $('result-rows').replaceChildren();
      for (const execution of message.executions) { executions.set(execution.commandId, execution); updateRow(execution); }
      const selection = preferredSelection && executions.has(preferredSelection) ? preferredSelection : (message.executions[0]?.commandId || '');
      if (selection) selectResult(selection); else showOutput(); summaries();
      const scroll = pendingScroll; pendingScroll = undefined;
      if (scroll) { $('output-wrap').scrollTop = scroll.output; $('result-table-wrap').scrollTop = scroll.table; }
    } else if (message.type === 'executions' && message.batchId === batchId) {
      for (const execution of message.executions) {
        if (execution.batchId !== batchId) continue;
        const previous = executions.get(execution.commandId);
        if (isSearch()) execution.results = Array.isArray(execution.appendResults) ? [...(previous?.results || []), ...execution.appendResults] : (execution.results || []);
        if (typeof execution.appendOutput === 'string') execution.output = (previous?.output || '') + execution.appendOutput;
        executions.set(execution.commandId, execution); updateRow(execution);
      }
      summaries(); showOutput();
    } else if (message.type === 'command') { $('command').value = message.command; controls(); $('command').focus(); }
    else if (message.type === 'savedCommands') { savedCommands = Array.isArray(message.items) ? message.items : []; if (message.open) { openSavedCommands(savedCommands, resetSavedSearchOnOpen); resetSavedSearchOnOpen = false; } else if ($('saved-dialog').open) renderSavedCommands(); }
    else if (message.type === 'targetSets') { targetSets = Array.isArray(message.items) ? message.items : []; if (message.open) { openTargetSets(targetSets, resetTargetSetSearchOnOpen); resetTargetSetSearchOnOpen = false; } else if ($('target-sets-dialog').open) renderTargetSets(); }
    else if (message.type === 'copied') {
      if (message.target === 'output') showTemporaryButtonText($('copy-output'));
      else if (message.target === 'allOutputs') showTemporaryButtonText($('copy-all-outputs'));
    }
    else if (message.type === 'notice') { feedback(message.message || '', message.severity || 'info', Boolean(message.persistent), message.channel || 'secondary', message.scope || '', message.tooltip || ''); }
    else if (message.type === 'inputPrompt') { openInputPrompt(message); }
    else if (message.type === 'inputPromptValidation' && message.requestId === activeInputRequestId) { $('input-validation').textContent = message.message || ''; $('input-value').focus(); }
    else if (message.type === 'inputPromptClose' && message.requestId === activeInputRequestId) { closeInputPrompt(false); }
    else if (message.type === 'error') { feedback(message.message || '', 'error', true, 'secondary', message.scope || 'action', message.tooltip || ''); }
      controls();
  }
  function captureView() {
    return { initialized, batchId, selected, filter, state, resultView, batchQuery,
      executions: [...executions.values()],
      scroll: { output: $('output-wrap').scrollTop, table: $('result-table-wrap').scrollTop },
      feedback: { primary: $('feedback-primary').textContent, secondary: $('feedback-secondary').textContent,
        primaryTooltip: $('feedback-primary').getAttribute('data-tooltip'), secondaryTooltip: $('feedback-secondary').getAttribute('data-tooltip'),
        feedbackPrimaryPersistent, feedbackSecondaryPersistent, feedbackSecondaryPriority, feedbackSecondaryScope } };
  }
  function switchMode(next, notify = true) {
    if (next !== 'commands' && next !== 'search') return;
    if (next === mode && bootstrapped) return;
    clearTimeout(preferenceTimer);
    clearTimeout(sessionStateTimer);
    if (initialized) savePreferences();
    views[mode] = captureView();
    hideCustomContextMenus(); hideWebviewTooltip();
    mode = next;
    const view = views[mode]; pendingScroll = view.scroll;
    initialized = Boolean(view.initialized); batchId = view.batchId || ''; selected = view.selected || ''; filter = view.filter || 'All';
    state = { ...state, busy: view.state?.busy || false }; resultView = view.resultView || {}; batchQuery = view.batchQuery || {};
    executions.clear(); resultRows.clear(); $('result-rows').replaceChildren();
    document.body.dataset.mode = mode;
    for (const name of ['commands', 'search']) {
      $(name + '-fields').hidden = name !== mode; $(name + '-footer').hidden = name !== mode;
      const tab = $('tab-' + name);
      const selectedTab = name === mode;
      tab.setAttribute('aria-selected', String(selectedTab));
      tab.tabIndex = selectedTab ? 0 : -1;
    }
    $('mode-description').textContent = isSearch() ? 'Same search for every target' : 'Same command for every target';
    $('directory-heading').textContent = isSearch() ? 'Search Directory' : 'Working Directory';
    $('result-value-heading').textContent = isSearch() ? 'Results' : 'Exit';
    $('copy-output').textContent = isSearch() ? 'Copy Results' : 'Copy Output';
    $('copy-all-outputs').textContent = isSearch() ? 'Copy All Results' : 'Copy All Outputs';
    for (const id of ['copy-output', 'copy-all-outputs']) { $(id).removeAttribute('data-original-text'); clearTimeout($(id)._remoteEditCopyFeedbackTimer); }
    $('searchCopyPath').hidden = !isSearch(); $('searchCopyName').hidden = !isSearch();
    $('sudo-run').textContent = isSearch() ? 'Search' : 'Run';
    $('output').replaceChildren();
    for (const execution of view.executions || []) { executions.set(execution.commandId, execution); updateRow(execution); }
    resultRows.get(selected)?.classList.add('selected'); showOutput(); summaries();
    feedback();
    if (view.feedback) {
      const f = view.feedback;
      setFeedbackLine('primary', f.primary, f.feedbackPrimaryPersistent, '', f.primaryTooltip);
      setFeedbackLine('secondary', f.secondary, f.feedbackSecondaryPersistent, f.feedbackSecondaryScope, f.secondaryTooltip);
      feedbackSecondaryPriority = f.feedbackSecondaryPriority;
    }
    renderTargets(); resize();
    if (view.scroll) { $('output-wrap').scrollTop = view.scroll.output; $('result-table-wrap').scrollTop = view.scroll.table; }
    if (notify) post('activeTab');
  }
  for (const name of ['commands', 'search']) {
    $('tab-' + name).addEventListener('click', () => switchMode(name));
    $('tab-' + name).addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 'commands' : event.key === 'End' ? 'search' : (isSearch() ? 'commands' : 'search');
        switchMode(next); $('tab-' + next).focus();
      }
    });
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (!bootstrapped && message.type === 'state') { switchMode(message.activeTab || 'commands', false); bootstrapped = true; }
    receive(message);
  });
  window.addEventListener('pagehide', () => { clearTimeout(preferenceTimer); clearTimeout(sessionStateTimer); savePreferences(); });
  post('ready');
})();`;
}
