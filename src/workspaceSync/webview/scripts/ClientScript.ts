export function renderWorkspaceSyncClientScript(compareIconSvg = ''): string {
  const compareIconMarkup = JSON.stringify(compareIconSvg || '<span class=\"compare-icon-fallback\" aria-hidden=\"true\">⇄</span>');
  return `(() => {
  const vscode = acquireVsCodeApi();
  let state = { connections: [], mappings: [], diffs: [], targetStates: [], targetViews: [] };
  let selected = new Set();
  let filter = 'changes';
  let editingTargets = [];
  let editingMappingId;
  let mappingClientValidationMessage = '';
  let operationActive = false;
  let activeOperationLabel = '';
  let activeOperationKind = '';
  let activeOperationStageKind = '';
  let activeOperationId = 0;
  let latestOperationId = 0;
  let latestStateSequence = 0;
  let operationCancelling = false;
  let operationCancellable = false;
  let interactionActive = false;
  let backgroundOperation = null;
  const persistedUiState = vscode.getState() || {};
  const ALL_ENABLED_TARGETS = '__all_enabled__';
  const persistedAllEnabledMappings = Array.isArray(persistedUiState.allEnabledMappingIds)
    ? persistedUiState.allEnabledMappingIds.map(String)
    : (typeof persistedUiState.allEnabledMappingId === 'string' ? [persistedUiState.allEnabledMappingId] : []);
  let allEnabledMappingIds = new Set(persistedAllEnabledMappings);
  let visibleChangeKeys = [];
  let previewResolutions = {};
  let resolutionRequestSerial = 0;
  let syncPreviewRequested = false;
  const pendingResolutionRequests = new Map();
  const persistedChangesSort = persistedUiState.changesSort;
  let changesSort = persistedChangesSort && ['target', 'path', 'status'].includes(persistedChangesSort.key) && ['asc', 'desc'].includes(persistedChangesSort.direction)
    ? { key: persistedChangesSort.key, direction: persistedChangesSort.direction }
    : { key: '', direction: '' };
  let optionHelpAnchor;
  const optionHelp = {
    unknownChangeProtection: {
      title: 'Unknown Change Protection',
      text: 'Prevents automatic overwrite when Local and Remote differ and Workspace Sync cannot determine which side changed. Known conflicts always require manual resolution. One-way watch modes use their source side as authoritative.'
    },
    atomicTransfer: {
      title: 'Atomic Transfer when supported',
      text: 'Uploads through a temporary file and replaces the destination only after the transfer completes, reducing the risk of partial files.'
    },
    propagateDeletes: {
      title: 'Propagate Deletes',
      text: 'Allows deletions on one side to be propagated to the other side according to the selected sync direction.'
    },
    uploadOnSave: {
      title: 'Upload on Save',
      text: 'Automatically uploads files saved from the VS Code editor. In Local → Remote mode, Local is authoritative. In Bidirectional mode, normal conflict protection rules apply. External file changes or replacements are handled by Watch Local Changes.'
    },
    watchLocalChanges: {
      title: 'Watch Local Changes',
      text: 'Watches the local workspace for file changes. In Local → Remote mode, Local is authoritative and changes are uploaded without requiring a baseline. In Bidirectional mode, baseline and conflict rules apply. When multiple targets affect the same local workspace, operations are processed one at a time to prevent overlapping updates.'
    },
    watchRemoteChanges: {
      title: 'Watch Remote Changes',
      text: 'Watches the remote target for file changes. In Remote → Local mode, Remote is authoritative and changes are downloaded without requiring a baseline. In Bidirectional mode, baseline and conflict rules apply. Operations affecting the same or overlapping local workspaces are processed one at a time to prevent concurrent updates.'
    },
    direction: {
      title: 'Sync Direction',
      text: 'Local → Remote treats Local as authoritative for automatic watch actions. Remote → Local treats Remote as authoritative. In Bidirectional mode, Workspace Sync compares both sides against the last known state. If Local and Remote both changed, the item is reported as a conflict instead of automatically choosing one side.'
    },
    ignorePatterns: {
      title: 'Ignore Patterns',
      text: 'Enter one pattern per line. Blank lines are ignored and rules are applied in order.\\n\\nnode_modules/ — ignore a directory and everything inside it\\n*.log — ignore matching files anywhere\\ndist/** — ignore everything under dist\\n/build/ — ignore build only at the mapping root\\n!dist/keep.txt — re-include a path ignored by an earlier rule\\n# comment — comment line\\n\\nSupported wildcards: *, ?, and **. Use / as the path separator. Ignore rules apply to both Local and Remote scans for this mapping.'
    }
  };

  const $ = id => document.getElementById(id);
  const post = (type, extra = {}) => vscode.postMessage({ type, ...extra });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  const webviewTooltip = $('webviewTooltip');
  const compareIconMarkup = ${compareIconMarkup};
  const TOOLTIP_SHOW_DELAY_MS = 500;
  const ROW_ACTION_TOOLTIP_SHOW_DELAY_MS = 750;
  let activeTooltipTarget = null;
  let tooltipTimer = 0;

  function setTooltip(element, text) {
    if (!element) return;
    const value = String(text || '').trim();
    if (value) element.setAttribute('data-tooltip', value);
    else element.removeAttribute('data-tooltip');
  }

  function hideWebviewTooltip() {
    if (tooltipTimer) {
      clearTimeout(tooltipTimer);
      tooltipTimer = 0;
    }
    activeTooltipTarget = null;
    if (!webviewTooltip) return;
    webviewTooltip.classList.remove('visible');
    webviewTooltip.setAttribute('aria-hidden', 'true');
  }

  function positionWebviewTooltip(target, preferAbove = false) {
    if (!webviewTooltip || !target) return;
    const gap = 7;
    const margin = 8;
    const rect = target.getBoundingClientRect();
    const tooltipRect = webviewTooltip.getBoundingClientRect();
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));
    let top = preferAbove ? (rect.top - tooltipRect.height - gap) : (rect.bottom + gap);
    if (top < margin) top = rect.bottom + gap;
    if (top + tooltipRect.height > window.innerHeight - margin) top = rect.top - tooltipRect.height - gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));
    webviewTooltip.style.left = Math.round(left) + 'px';
    webviewTooltip.style.top = Math.round(top) + 'px';
  }

  function showWebviewTooltip(target) {
    if (!webviewTooltip || !target) return;
    const text = String(target.getAttribute('data-tooltip') || '').trim();
    if (!text) return;
    if (tooltipTimer) clearTimeout(tooltipTimer);
    activeTooltipTarget = target;
    webviewTooltip.textContent = text;
    webviewTooltip.setAttribute('aria-hidden', 'false');
    webviewTooltip.classList.remove('visible');
    webviewTooltip.style.left = '0px';
    webviewTooltip.style.top = '0px';
    const configuredDelay = Number.parseInt(String(target.getAttribute('data-tooltip-delay') || ''), 10);
    const showDelay = Number.isFinite(configuredDelay) && configuredDelay >= 0 ? configuredDelay : TOOLTIP_SHOW_DELAY_MS;
    tooltipTimer = window.setTimeout(() => {
      if (activeTooltipTarget !== target) return;
      const preferAbove = target.classList.contains('tooltip-above') || target.getAttribute('data-tooltip-position') === 'above';
      positionWebviewTooltip(target, preferAbove);
      webviewTooltip.classList.add('visible');
    }, showDelay);
  }

  function getTooltipTarget(eventTarget) {
    return eventTarget && eventTarget.closest ? eventTarget.closest('[data-tooltip]') : null;
  }

  document.addEventListener('mouseover', event => {
    const target = getTooltipTarget(event.target);
    if (!target || target === activeTooltipTarget) return;
    showWebviewTooltip(target);
  });
  document.addEventListener('mouseout', event => {
    const target = getTooltipTarget(event.target);
    if (!target || target !== activeTooltipTarget) return;
    const related = event.relatedTarget;
    if (related && target.contains(related)) return;
    hideWebviewTooltip();
  });
  document.addEventListener('focusin', event => {
    const target = getTooltipTarget(event.target);
    if (target && !target.hasAttribute('data-tooltip-hover-only')) showWebviewTooltip(target);
  });
  document.addEventListener('focusout', event => {
    const target = getTooltipTarget(event.target);
    if (target && target === activeTooltipTarget) hideWebviewTooltip();
  });

  function formatTimestamp(value) {
    const date = new Date(value);
    const pad = part => String(part).padStart(2, '0');
    const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
    const time = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':');
    return day + ' ' + time;
  }

  function activeMapping() {
    return state.mappings.find(mapping => mapping.id === state.activeMappingId);
  }

  function isAllEnabledSelected(mapping = activeMapping()) {
    return Boolean(mapping && mapping.targets?.length > 1 && allEnabledMappingIds.has(mapping.id));
  }

  function enabledTargets(mapping = activeMapping()) {
    return mapping?.targets?.filter(target => target.enabled) || [];
  }

  function enabledTargetStates(mapping = activeMapping()) {
    const ids = new Set(enabledTargets(mapping).map(target => target.id));
    return (state.targetStates || []).filter(item => ids.has(item.targetId));
  }

  function activeTarget() {
    const mapping = activeMapping();
    if (isAllEnabledSelected(mapping)) return undefined;
    return mapping?.targets?.find(target => target.id === state.activeTargetId) || mapping?.targets?.[0];
  }

  function targetForId(targetId, mapping = activeMapping()) {
    return mapping?.targets?.find(target => target.id === targetId);
  }

  function targetStateForId(targetId) {
    return (state.targetStates || []).find(item => item.targetId === targetId);
  }

  function targetViewForId(targetId) {
    return (state.targetViews || []).find(item => item.targetId === targetId);
  }

  function changeKey(targetId, relativePath) {
    return JSON.stringify([String(targetId || ''), String(relativePath || '')]);
  }

  function currentChangeEntries() {
    const mapping = activeMapping();
    if (!mapping) return [];
    if (isAllEnabledSelected(mapping)) {
      const enabledIds = new Set(enabledTargets(mapping).map(target => target.id));
      return (state.targetViews || [])
        .filter(view => enabledIds.has(view.targetId))
        .flatMap(view => (view.diffs || []).map(entry => ({
          ...entry,
          targetId: view.targetId,
          targetName: view.targetName || targetForId(view.targetId, mapping)?.name || view.targetId
        })));
    }
    const target = activeTarget();
    if (!target) return [];
    return (state.diffs || []).map(entry => ({ ...entry, targetId: target.id, targetName: target.name }));
  }

  function findCurrentChange(targetId, relativePath) {
    return currentChangeEntries().find(entry => entry.targetId === targetId && entry.relativePath === relativePath);
  }

  function entryCanOperate(entry) {
    const target = targetForId(entry?.targetId);
    const targetState = targetStateForId(entry?.targetId);
    const targetView = targetViewForId(entry?.targetId);
    return Boolean(target?.enabled
      && targetState?.status === 'connected'
      && !targetView?.showingLastKnownState);
  }

  function persistAllEnabledSelection() {
    vscode.setState(Object.assign({}, vscode.getState() || {}, {
      allEnabledMappingIds: [...allEnabledMappingIds],
      allEnabledMappingId: null
    }));
  }

  function pruneAllEnabledSelections() {
    const valid = new Set((state.mappings || []).filter(mapping => (mapping.targets || []).length > 1).map(mapping => mapping.id));
    let changed = false;
    for (const mappingId of [...allEnabledMappingIds]) {
      if (valid.has(mappingId)) continue;
      allEnabledMappingIds.delete(mappingId);
      changed = true;
    }
    if (changed) persistAllEnabledSelection();
  }

  function allEnabledConnectionState(mapping = activeMapping()) {
    const targets = enabledTargets(mapping);
    const states = enabledTargetStates(mapping);
    const connected = states.filter(item => item.status === 'connected').length;
    const connecting = states.filter(item => item.status === 'connecting').length;
    const errors = states.filter(item => item.status === 'error').length;
    const reconnectRequired = states.filter(item => item.connectionConfigChanged).length;
    const allConnected = targets.length > 0 && connected === targets.length;
    const status = connecting ? 'connecting' : allConnected ? 'connected' : errors && !connected ? 'error' : 'disconnected';
    return { targets, states, connected, connecting, errors, reconnectRequired, allConnected, status };
  }

  function applyResolutionToState(targetId, relativePath, resolution) {
    const updateDiffs = diffs => (diffs || []).map(entry => {
      if (entry.relativePath !== relativePath) return entry;
      const next = { ...entry };
      if (resolution) next.resolution = resolution;
      else delete next.resolution;
      return next;
    });
    state.targetViews = (state.targetViews || []).map(view =>
      view.targetId === targetId ? { ...view, diffs: updateDiffs(view.diffs) } : view
    );
    if (String(state.activeTargetId || '') === String(targetId || '')) state.diffs = updateDiffs(state.diffs);
  }

  function adoptState(nextState) {
    const currentByKey = new Map(currentChangeEntries().map(entry => [changeKey(entry.targetId, entry.relativePath), entry]));
    const pendingSelections = new Map();
    for (const key of pendingResolutionRequests.keys()) pendingSelections.set(key, currentByKey.get(key)?.resolution);
    state = nextState;
    for (const [key, resolution] of pendingSelections) {
      const pair = JSON.parse(key);
      applyResolutionToState(String(pair[0] || ''), String(pair[1] || ''), resolution);
    }
  }

  function syncPreviewTargetViews(mapping = activeMapping()) {
    if (!mapping) return [];
    if (isAllEnabledSelected(mapping)) {
      const enabledIds = new Set(enabledTargets(mapping).map(target => target.id));
      const connectedIds = new Set((state.targetStates || [])
        .filter(item => enabledIds.has(item.targetId) && item.status === 'connected')
        .map(item => item.targetId));
      return (state.targetViews || [])
        .filter(view => connectedIds.has(view.targetId) && view.plan && !view.showingLastKnownState)
        .map(view => ({
          targetId: view.targetId,
          targetName: view.targetName || targetForId(view.targetId, mapping)?.name || view.targetId,
          diffs: view.diffs || [],
          plan: view.plan
        }));
    }
    const target = activeTarget();
    if (!target || state.connectionStatus !== 'connected' || !state.plan || state.showingLastKnownState) return [];
    return [{ targetId: target.id, targetName: target.name, diffs: state.diffs || [], plan: state.plan }];
  }

  function updateSyncAvailability() {
    const mapping = activeMapping();
    const previewTargets = syncPreviewTargetViews(mapping);
    $('sync').disabled = operationActive || interactionActive || !mapping || previewTargets.length === 0;
  }

  function statusLabel(status) {
    return ({
      localOnly: 'Local only', remoteOnly: 'Remote only', localChanged: 'Local changed',
      remoteChanged: 'Remote changed', different: 'Different', conflict: 'Conflict',
      localDeleted: 'Local deleted', remoteDeleted: 'Remote deleted', unknown: 'Unknown', same: 'Same'
    })[status] || status;
  }

  function joinDisplayPath(root, relativePath) {
    const base = String(root || '').trim();
    const relative = String(relativePath || '').replace(/^[\\\\/]+/, '');
    if (!base) return relative;
    if (!relative) return base;

    const separator = base.includes('\\\\') && !base.includes('/') ? '\\\\' : '/';
    const normalizedRelative = relative.replace(/[\\\\/]+/g, separator);
    const trimmedBase = base.replace(/[\\\\/]+$/, '');
    if (!trimmedBase && base.startsWith('/')) return '/' + normalizedRelative;
    return trimmedBase + separator + normalizedRelative;
  }

  function changePathDetails(entry) {
    const mapping = activeMapping();
    const target = targetForId(entry?.targetId, mapping) || activeTarget();
    const relativePath = String(entry?.relativePath || '');
    const localRelativePath = String(entry?.localRelativePath || relativePath);
    const remoteRelativePath = String(entry?.remoteRelativePath || relativePath);
    return {
      relativePath,
      localRelativePath,
      remoteRelativePath,
      localPath: mapping ? joinDisplayPath(mapping.localRoot, localRelativePath) : localRelativePath,
      remotePath: target ? joinDisplayPath(target.remoteRoot, remoteRelativePath) : remoteRelativePath
    };
  }

  function changePathTooltip(entry) {
    const details = changePathDetails(entry);
    const lines = [
      \`Target: \${entry?.targetName || targetForId(entry?.targetId)?.name || ''}\`,
      \`Path: \${details.relativePath}\`,
      \`Local: \${details.localPath}\${entry.local ? '' : ' (missing)'}\`,
      \`Remote: \${details.remotePath}\${entry.remote ? '' : ' (missing)'}\`
    ];
    if (entry.reason) lines.push(\`Reason: \${entry.reason}\`);
    return lines.join('\\n');
  }

  function changeSearchText(entry) {
    const details = changePathDetails(entry);
    return [entry?.targetName || '', details.relativePath, details.localPath, details.remotePath].join('\\n').toLowerCase();
  }

  function marker(status) {
    return ({
      localOnly: '+', remoteOnly: '+', localChanged: '↑', remoteChanged: '↓',
      different: '≠', conflict: '!', localDeleted: '×', remoteDeleted: '×', unknown: '?', same: '='
    })[status] || '•';
  }

  function requiresResolution(entry) {
    return Boolean(entry && (entry.status === 'conflict' || entry.status === 'different'));
  }

  function isStructuralConflict(entry) {
    return Boolean(entry?.local && entry?.remote && entry.local.kind !== entry.remote.kind);
  }

  function resolutionButtonHtml(entry, resolution, label, source = 'changes') {
    const targetId = String(entry?.targetId || state.activeTargetId || '');
    const previewKey = changeKey(targetId, entry.relativePath);
    const selectedResolution = source === 'preview' ? previewResolutions[previewKey] : entry.resolution;
    const selectedClass = selectedResolution === resolution ? ' resolution-selected' : '';
    const structuralDisabled = resolution !== 'skip' && isStructuralConflict(entry);
    const disabled = structuralDisabled ? ' disabled' : '';
    const attribute = source === 'preview' ? 'data-preview-resolve' : 'data-resolve';
    const targetAttribute = ' data-target-id="' + esc(targetId) + '"';
    return \`<button class="ghost resolution-choice\${selectedClass}" \${attribute}="\${resolution}" data-path="\${esc(entry.relativePath)}"\${targetAttribute} aria-pressed="\${selectedResolution === resolution ? 'true' : 'false'}"\${disabled}>\${label}</button>\`;
  }

  function compareButtonHtml(entry, source = 'changes') {
    const bothFiles = entry.local?.kind === 'file' && entry.remote?.kind === 'file';
    if (!bothFiles) return '';
    const targetId = String(entry?.targetId || state.activeTargetId || '');
    const attribute = source === 'preview' ? 'data-preview-diff' : 'data-diff';
    const targetAttribute = ' data-target-id="' + esc(targetId) + '"';
    return \`<button class="ghost icon-action compare-action" \${attribute}="\${esc(entry.relativePath)}"\${targetAttribute} aria-label="Compare Local and Remote" data-tooltip="Compare Local and Remote" data-tooltip-delay="\${ROW_ACTION_TOOLTIP_SHOW_DELAY_MS}" data-tooltip-hover-only>\${compareIconMarkup}</button>\`;
  }

  function updateResolutionControls(targetId, relativePath) {
    const entry = findCurrentChange(targetId, relativePath);
    const selectedResolution = entry?.resolution;
    document.querySelectorAll('[data-resolve]').forEach(element => {
      if (element.dataset.path !== relativePath || String(element.dataset.targetId || '') !== String(targetId || '')) return;
      const selected = element.dataset.resolve === selectedResolution;
      element.classList.toggle('resolution-selected', selected);
      element.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (activeChangeContextPath === relativePath && activeChangeContextTargetId === targetId) {
      for (const [id, resolution] of [['changesContextUseLocal', 'useLocal'], ['changesContextUseRemote', 'useRemote'], ['changesContextSkip', 'skip']]) {
        const button = $(id);
        if (!button) continue;
        button.classList.toggle('resolution-selected', selectedResolution === resolution);
      }
    }
  }

  function setLocalResolution(targetId, relativePath, resolution) {
    applyResolutionToState(targetId, relativePath, resolution);
    updateResolutionControls(targetId, relativePath);
  }

  function chooseResolution(targetId, relativePath, requestedResolution) {
    const entry = findCurrentChange(targetId, relativePath);
    if (!entry || !requiresResolution(entry) || !entryCanOperate(entry)) return;
    const nextResolution = entry.resolution === requestedResolution ? undefined : requestedResolution;
    setLocalResolution(targetId, relativePath, nextResolution);
    const requestId = ++resolutionRequestSerial;
    const key = changeKey(targetId, relativePath);
    pendingResolutionRequests.set(key, requestId);
    updateSyncAvailability();
    post('setConflictResolution', {
      mappingId: state.activeMappingId,
      targetId,
      relativePath,
      resolution: nextResolution || null,
      requestId
    });
  }

  let activeTextEditTarget = null;
  let activeChangeContextPath = '';
  let activeChangeContextTargetId = '';
  let activeActivitySelectionText = '';

  function isTextEditableInput(element) {
    if (!(element instanceof HTMLInputElement)) return false;
    const type = String(element.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'password', 'email', 'number', 'url', 'tel'].includes(type);
  }

  function getTextEditableTarget(target) {
    if (!(target instanceof Element)) return null;
    const editable = target.closest('textarea, input, [contenteditable="true"]');
    if (!editable) return null;
    if (editable instanceof HTMLTextAreaElement) return editable;
    if (isTextEditableInput(editable)) return editable;
    if (editable instanceof HTMLElement && editable.isContentEditable) return editable;
    return null;
  }

  function editableHasValue(element) {
    if (!element) return false;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return String(element.value || '').length > 0;
    return String(element.textContent || '').length > 0;
  }

  function editableIsReadOnly(element) {
    if (!element) return true;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return Boolean(element.disabled || element.readOnly);
    return !(element instanceof HTMLElement) || !element.isContentEditable;
  }

  function editableHasSelection(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return typeof element.selectionStart === 'number' && typeof element.selectionEnd === 'number' && element.selectionEnd > element.selectionStart;
    }
    const selection = window.getSelection ? window.getSelection() : null;
    return Boolean(selection && !selection.isCollapsed && element instanceof Node && element.contains(selection.anchorNode) && element.contains(selection.focusNode));
  }

  function getEditableSelectionText(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (typeof element.selectionStart !== 'number' || typeof element.selectionEnd !== 'number') return '';
      return String(element.value || '').slice(element.selectionStart, element.selectionEnd);
    }
    const selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.isCollapsed || !(element instanceof Node) || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return '';
    return selection.toString();
  }

  function replaceEditableSelection(element, text) {
    if (!element || editableIsReadOnly(element)) return;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const start = typeof element.selectionStart === 'number' ? element.selectionStart : String(element.value || '').length;
      const end = typeof element.selectionEnd === 'number' ? element.selectionEnd : start;
      if (typeof element.setRangeText === 'function') element.setRangeText(text, start, end, 'end');
      else {
        const value = String(element.value || '');
        element.value = value.slice(0, start) + text + value.slice(end);
        const position = start + text.length;
        element.selectionStart = position;
        element.selectionEnd = position;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.focus();
      return;
    }
    element.focus();
    document.execCommand('insertText', false, text);
  }

  function selectAllEditable(element) {
    if (!element) return;
    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (typeof element.select === 'function') element.select();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection ? window.getSelection() : null;
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  async function copyTextFromContextMenu(text) {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (error) {
      // Fall back to the extension host clipboard helper.
    }
    post('copyText', { text });
  }

  async function readTextForContextPaste() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) return await navigator.clipboard.readText();
    } catch (error) {
      return '';
    }
    return '';
  }

  function positionContextMenu(menu, clientX, clientY) {
    if (!menu) return;
    menu.classList.add('visible');
    menu.style.left = '0px';
    menu.style.top = '0px';
    const margin = 6;
    const rect = menu.getBoundingClientRect();
    const left = Math.max(margin, Math.min(clientX, window.innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(clientY, window.innerHeight - rect.height - margin));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function hideTextEditContextMenu() {
    activeTextEditTarget = null;
    $('textEditContextMenu')?.classList.remove('visible');
  }

  function showTextEditContextMenu(element, clientX, clientY) {
    const menu = $('textEditContextMenu');
    if (!menu) return;
    closeChangesContextMenu();
    closeActivityContextMenu();
    closeChangesMenu();
    hideWebviewTooltip();
    activeTextEditTarget = element;
    const readOnly = editableIsReadOnly(element);
    const hasSelection = editableHasSelection(element);
    const hasValue = editableHasValue(element);
    $('textEditContextUndo').disabled = readOnly;
    $('textEditContextRedo').disabled = readOnly;
    $('textEditContextCut').disabled = readOnly || !hasSelection;
    $('textEditContextCopy').disabled = !hasSelection;
    $('textEditContextPaste').disabled = readOnly;
    $('textEditContextSelectAll').disabled = !hasValue;
    positionContextMenu(menu, clientX, clientY);
  }

  async function handleTextEditContextAction(action) {
    const target = activeTextEditTarget;
    if (!target) return;
    if (action === 'undo' || action === 'redo') {
      if (!editableIsReadOnly(target)) {
        target.focus();
        document.execCommand(action);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else if (action === 'cut') {
      const text = getEditableSelectionText(target);
      if (text && !editableIsReadOnly(target)) {
        await copyTextFromContextMenu(text);
        replaceEditableSelection(target, '');
      }
    } else if (action === 'copy') {
      await copyTextFromContextMenu(getEditableSelectionText(target));
    } else if (action === 'paste') {
      if (!editableIsReadOnly(target)) {
        const text = await readTextForContextPaste();
        if (text) replaceEditableSelection(target, text);
        else {
          target.focus();
          try { document.execCommand('paste'); } catch (error) { /* ignore */ }
        }
      }
    } else if (action === 'selectAll') selectAllEditable(target);
    hideTextEditContextMenu();
  }

  function bindTextEditContextButton(id, action) {
    const button = $(id);
    if (!button) return;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void handleTextEditContextAction(action);
    });
  }

  function closeChangesContextMenu() {
    activeChangeContextPath = '';
    activeChangeContextTargetId = '';
    $('changesContextMenu')?.classList.remove('visible');
  }

  function setContextItemVisible(id, visible) {
    const element = $(id);
    if (element) element.hidden = !visible;
  }

  function closeActivityContextMenu() {
    activeActivitySelectionText = '';
    $('activityContextMenu')?.classList.remove('visible');
  }

  function getActivitySelectionText() {
    const log = $('activityLog');
    const selection = window.getSelection ? window.getSelection() : null;
    if (!log || !selection || selection.isCollapsed || !selection.rangeCount) return '';
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode || !log.contains(anchorNode) || !log.contains(focusNode)) return '';
    return selection.toString();
  }

  function showActivityContextMenu(clientX, clientY) {
    const menu = $('activityContextMenu');
    if (!menu) return;
    hideTextEditContextMenu();
    closeChangesContextMenu();
    closeChangesMenu();
    hideWebviewTooltip();
    activeActivitySelectionText = getActivitySelectionText();
    $('activityContextCopySelected').hidden = !activeActivitySelectionText;
    const empty = activity.length === 0;
    $('activityContextCopyAll').disabled = empty;
    $('activityContextClear').disabled = empty;
    positionContextMenu(menu, clientX, clientY);
  }

  function showChangesContextMenu(entry, clientX, clientY) {
    const menu = $('changesContextMenu');
    if (!menu || !entry || !entryCanOperate(entry)) return;
    hideTextEditContextMenu();
    closeActivityContextMenu();
    closeChangesMenu();
    hideWebviewTooltip();
    activeChangeContextPath = String(entry.relativePath || '');
    activeChangeContextTargetId = String(entry.targetId || '');
    const isConflict = entry.status === 'conflict' || entry.status === 'different';
    const structuralConflict = Boolean(entry.local && entry.remote && entry.local.kind !== entry.remote.kind);
    const canCompare = entry.local?.kind === 'file' && entry.remote?.kind === 'file';
    const canUpload = !isConflict && Boolean(entry.local && (entry.local.kind === 'file' || entry.local.kind === 'directory'));
    const canDownload = !isConflict && Boolean(entry.remote && (entry.remote.kind === 'file' || entry.remote.kind === 'directory'));
    const canResolve = isConflict && !structuralConflict;
    setContextItemVisible('changesContextCompare', canCompare);
    setContextItemVisible('changesContextCompareSeparator', canCompare && (canUpload || canDownload || isConflict));
    setContextItemVisible('changesContextUpload', canUpload);
    setContextItemVisible('changesContextDownload', canDownload);
    setContextItemVisible('changesContextUseLocal', canResolve);
    setContextItemVisible('changesContextUseRemote', canResolve);
    setContextItemVisible('changesContextSkip', isConflict);
    for (const [id, resolution] of [['changesContextUseLocal', 'useLocal'], ['changesContextUseRemote', 'useRemote'], ['changesContextSkip', 'skip']]) {
      $(id)?.classList.toggle('resolution-selected', entry.resolution === resolution);
    }
    $('changesContextSkip').textContent = 'Skip';
    const hasAction = canCompare || canUpload || canDownload || isConflict;
    if (!hasAction) return;
    positionContextMenu(menu, clientX, clientY);
  }

  function postChangeContextAction(action) {
    const relativePath = activeChangeContextPath;
    const targetId = activeChangeContextTargetId;
    if (!relativePath || !targetId) return;
    closeChangesContextMenu();
    if (action === 'compare') post('openDiff', { mappingId: state.activeMappingId, targetId, relativePath });
    else if (action === 'upload') post('uploadSelected', { mappingId: state.activeMappingId, targetId, paths: [relativePath] });
    else if (action === 'download') post('downloadSelected', { mappingId: state.activeMappingId, targetId, paths: [relativePath] });
    else if (['useLocal', 'useRemote', 'skip'].includes(action)) chooseResolution(targetId, relativePath, action);
  }

  function closeChangesMenu() {
    const menu = $('changesMenu');
    const button = $('changesMore');
    if (!menu || !button) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  function toggleChangesMenu() {
    const menu = $('changesMenu');
    const button = $('changesMore');
    if (!menu || !button || button.disabled) return;
    const opening = menu.hidden;
    menu.hidden = !opening;
    button.setAttribute('aria-expanded', opening ? 'true' : 'false');
  }

  function render() {
    const mapping = activeMapping();
    const allEnabled = isAllEnabledSelected(mapping);
    const target = activeTarget();
    $('mapping').innerHTML = state.mappings.length
      ? state.mappings.map(item => \`<option value="\${esc(item.id)}" \${item.id === state.activeMappingId ? 'selected' : ''}>\${esc(item.name)}</option>\`).join('')
      : '<option value="">No mappings</option>';

    if (mapping?.targets?.length) {
      const allOption = mapping.targets.length > 1
        ? \`<option value="\${ALL_ENABLED_TARGETS}" \${allEnabled ? 'selected' : ''}>All Enabled</option>\`
        : '';
      const targetOptions = mapping.targets.map(item => \`<option value="\${esc(item.id)}" \${!allEnabled && item.id === state.activeTargetId ? 'selected' : ''}>\${esc(item.name)}\${item.enabled ? '' : ' (Disabled)'}</option>\`).join('');
      $('target').innerHTML = allOption + targetOptions;
    } else {
      $('target').innerHTML = '<option value="">No targets</option>';
    }

    $('localRoot').textContent = mapping?.localRoot || '—';

    let status;
    if (allEnabled) {
      const aggregate = allEnabledConnectionState(mapping);
      $('connectionLabel').textContent = aggregate.targets.length ? 'All enabled targets' : 'No enabled targets';
      $('remoteRoot').textContent = aggregate.targets.length > 1 ? 'Multiple targets' : (aggregate.targets[0]?.remoteRoot || '—');
      $('connect').textContent = aggregate.connecting
        ? 'Connecting...'
        : aggregate.allConnected
          ? (aggregate.reconnectRequired ? 'Reconnect' : 'Disconnect')
          : 'Connect';
      $('connect').disabled = (operationActive || interactionActive) || !mapping || !aggregate.targets.length || Boolean(aggregate.connecting);
      status = aggregate.status;
      if (operationActive && activeOperationKind === 'connect') {
        if (aggregate.connecting && activeOperationStageKind !== 'connect') {
          setActiveOperationLabel('Connecting targets...', 'connect');
        } else if (aggregate.allConnected && activeOperationStageKind === 'connect') {
          setActiveOperationLabel('Refreshing...', 'refresh');
        }
      }
    } else {
      const connection = target ? state.connections.find(item => item.id === target.connectionId) : undefined;
      $('connectionLabel').textContent = connection ? (connection.name + ' - ' + (connection.username ? connection.username + '@' : '') + connection.host + ':' + connection.port) : '—';
      $('remoteRoot').textContent = target?.remoteRoot || '—';
      const targetEnabled = Boolean(target?.enabled);
      status = targetEnabled ? (state.connectionStatus || 'disconnected') : 'disabled';
      $('connect').textContent = !targetEnabled
        ? 'Disabled'
        : status === 'connected'
          ? (state.connectionConfigChanged ? 'Reconnect' : 'Disconnect')
          : status === 'connecting' ? 'Connecting...' : 'Connect';
      $('connect').disabled = (operationActive || interactionActive) || !mapping || !target || !targetEnabled || status === 'connecting';
      if (operationActive && ['connect', 'reconnect'].includes(activeOperationKind)) {
        if (status === 'connecting' && activeOperationStageKind !== activeOperationKind) {
          setActiveOperationLabel(activeOperationKind === 'reconnect' ? 'Reconnecting...' : 'Connecting...', activeOperationKind);
        } else if (status === 'connected' && activeOperationStageKind === activeOperationKind) {
          setActiveOperationLabel('Refreshing...', 'refresh');
        }
      }
    }


    const refreshing = operationActive && activeOperationStageKind === 'refresh';
    $('compare').textContent = refreshing ? 'Refreshing...' : 'Refresh';
    const aggregateRefreshDisabled = allEnabled
      ? (!mapping || !allEnabledConnectionState(mapping).allConnected || Boolean(allEnabledConnectionState(mapping).reconnectRequired))
      : (!mapping || !target || !target.enabled || status !== 'connected');
    $('compare').disabled = (operationActive || interactionActive) || aggregateRefreshDisabled;
    updateSyncAvailability();
    $('manage').disabled = (operationActive || interactionActive) || !mapping;
    $('newMapping').disabled = (operationActive || interactionActive) || !state.connections.length;
    $('changesMore').disabled = (operationActive || interactionActive) || allEnabled || !mapping || !target || !target.enabled || status !== 'connected';
    $('resetBaseline').disabled = $('changesMore').disabled;
    if ($('changesMore').disabled) closeChangesMenu();

    renderChanges();
    renderSnapshotStatus();
    renderOptions();
    renderTargetStates();
    $('mapping').disabled = operationActive || interactionActive;
    $('target').disabled = operationActive || interactionActive;
    controls.refresh();
    renderOperationStatus();
  }

  function updateSearchClearButton() {
    const hasValue = Boolean($('search').value);
    $('searchBox').classList.toggle('has-value', hasValue);
    $('clearSearch').disabled = !hasValue;
  }

  function clearPathFilter() {
    if (!$('search').value) return;
    $('search').value = '';
    updateSearchClearButton();
    renderChanges();
  }

  function persistChangesSort() {
    vscode.setState(Object.assign({}, vscode.getState() || {}, { changesSort }));
  }

  function changeSortLabel(key) {
    return key === 'target' ? 'Target' : key === 'path' ? 'Path' : 'Status';
  }

  function cycleChangesSort(key) {
    if (!['target', 'path', 'status'].includes(key)) return;
    if (changesSort.key !== key) changesSort = { key, direction: 'asc' };
    else if (changesSort.direction === 'asc') changesSort = { key, direction: 'desc' };
    else changesSort = { key: '', direction: '' };
    persistChangesSort();
    renderChanges();
  }

  function compareChangeText(left, right) {
    return String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' });
  }

  function sortChangeEntries(entries) {
    if (!changesSort.key || !changesSort.direction) return entries;
    const direction = changesSort.direction === 'desc' ? -1 : 1;
    return entries.map((entry, index) => ({ entry, index })).sort((left, right) => {
      const leftValue = changesSort.key === 'target'
        ? left.entry.targetName
        : changesSort.key === 'status' ? statusLabel(left.entry.status) : left.entry.relativePath;
      const rightValue = changesSort.key === 'target'
        ? right.entry.targetName
        : changesSort.key === 'status' ? statusLabel(right.entry.status) : right.entry.relativePath;
      const comparison = compareChangeText(leftValue, rightValue);
      return comparison !== 0 ? comparison * direction : left.index - right.index;
    }).map(item => item.entry);
  }

  function updateChangesSortHeaders() {
    document.querySelectorAll('[data-change-sort-column]').forEach(header => {
      const key = header.dataset.changeSortColumn;
      const active = changesSort.key === key && Boolean(changesSort.direction);
      header.setAttribute('aria-sort', active ? (changesSort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      const indicator = header.querySelector('[data-change-sort-indicator]');
      if (indicator) indicator.textContent = active ? (changesSort.direction === 'asc' ? '↑' : '↓') : '';
      const button = header.querySelector('[data-change-sort]');
      const label = changeSortLabel(key);
      if (button) setTooltip(button, active
        ? (changesSort.direction === 'asc' ? 'Sort ' + label + ' descending' : 'Clear ' + label + ' sort')
        : 'Sort ' + label + ' ascending');
    });
  }

  function selectedCurrentEntries() {
    const byKey = new Map(currentChangeEntries().map(entry => [changeKey(entry.targetId, entry.relativePath), entry]));
    return [...selected].map(key => byKey.get(key)).filter(Boolean);
  }

  function selectedGroups() {
    const groups = new Map();
    for (const entry of selectedCurrentEntries()) {
      if (!entryCanOperate(entry)) continue;
      const paths = groups.get(entry.targetId) || [];
      paths.push(entry.relativePath);
      groups.set(entry.targetId, paths);
    }
    return [...groups].map(([targetId, paths]) => ({ targetId, paths }));
  }

  function updateSelectVisibleState() {
    const checkbox = $('selectVisible');
    if (!checkbox) return;
    const selectedVisible = visibleChangeKeys.reduce((count, key) => count + (selected.has(key) ? 1 : 0), 0);
    checkbox.checked = visibleChangeKeys.length > 0 && selectedVisible === visibleChangeKeys.length;
    checkbox.indeterminate = selectedVisible > 0 && selectedVisible < visibleChangeKeys.length;
    checkbox.disabled = (operationActive || interactionActive) || !visibleChangeKeys.length;
    const selectTooltip = !visibleChangeKeys.length
      ? 'No visible items to select'
      : checkbox.checked
        ? 'Deselect all visible items'
        : 'Select all visible items';
    setTooltip(checkbox, selectTooltip);
    checkbox.setAttribute('aria-checked', checkbox.indeterminate ? 'mixed' : (checkbox.checked ? 'true' : 'false'));
    checkbox.setAttribute('aria-label', selectTooltip);
  }

  function renderChanges() {
    closeChangesContextMenu();
    updateSearchClearButton();
    const query = $('search').value.trim().toLowerCase();
    const allEntries = currentChangeEntries();
    updateFilterCounts(allEntries);
    const entries = sortChangeEntries(allEntries
      .filter(matchesFilter)
      .filter(entry => !query || changeSearchText(entry).includes(query)));

    document.querySelectorAll('[data-filter]').forEach(button => {
      button.classList.toggle('filterActive', button.dataset.filter === filter);
      button.setAttribute('aria-pressed', button.dataset.filter === filter ? 'true' : 'false');
    });
    updateChangesSortHeaders();
    visibleChangeKeys = entries.filter(entryCanOperate).map(entry => changeKey(entry.targetId, entry.relativePath));

    if (!entries.length) {
      $('changes').innerHTML = '<div class="empty">' + esc(emptyChangesMessage(allEntries, query)) + '</div>';
      updateSelected();
      updateSelectVisibleState();
      return;
    }

    $('changes').innerHTML = entries.map(entry => {
      const key = changeKey(entry.targetId, entry.relativePath);
      const checked = selected.has(key) ? 'checked' : '';
      const rowDisabled = entryCanOperate(entry) ? '' : ' disabled';
      const isConflict = entry.status === 'conflict' || entry.status === 'different';
      const structuralConflict = Boolean(entry.local && entry.remote && entry.local.kind !== entry.remote.kind);
      const cssClass = isConflict
        ? 'conflict'
        : entry.status.startsWith('local') ? 'local' : entry.status.startsWith('remote') ? 'remote' : '';
      const canUpload = entry.local && (entry.local.kind === 'file' || entry.local.kind === 'directory');
      const canDownload = entry.remote && (entry.remote.kind === 'file' || entry.remote.kind === 'directory');
      const diffButton = compareButtonHtml(entry);
      let actionButtons;
      if (isConflict) {
        actionButtons = diffButton + resolutionButtonHtml(entry, 'useLocal', 'Use Local') + resolutionButtonHtml(entry, 'useRemote', 'Use Remote') + resolutionButtonHtml(entry, 'skip', 'Skip');
      } else {
        const uploadButton = canUpload ? '<button class="ghost icon-action" data-up="' + esc(entry.relativePath) + '" data-target-id="' + esc(entry.targetId) + '" aria-label="Upload to Remote" data-tooltip="Upload to Remote" data-tooltip-delay="' + ROW_ACTION_TOOLTIP_SHOW_DELAY_MS + '" data-tooltip-hover-only>↑</button>' : '';
        const downloadButton = canDownload ? '<button class="ghost icon-action" data-down="' + esc(entry.relativePath) + '" data-target-id="' + esc(entry.targetId) + '" aria-label="Download to Local" data-tooltip="Download to Local" data-tooltip-delay="' + ROW_ACTION_TOOLTIP_SHOW_DELAY_MS + '" data-tooltip-hover-only>↓</button>' : '';
        actionButtons = diffButton + uploadButton + downloadButton;
      }
      const label = statusLabel(entry.status);
      const displayedPath = entry.relativePath;
      return '<div class="row" role="row" data-change-key="' + esc(key) + '" data-change-path="' + esc(entry.relativePath) + '" data-target-id="' + esc(entry.targetId) + '">' +
        '<input class="sel" data-key="' + esc(key) + '" data-path="' + esc(entry.relativePath) + '" data-target-id="' + esc(entry.targetId) + '" type="checkbox" aria-label="Select ' + esc(entry.targetName) + ' / ' + esc(entry.relativePath) + '" ' + checked + rowDisabled + '>' +
        '<div class="' + cssClass + '">' + marker(entry.status) + '</div>' +
        '<div class="target-cell" role="cell" data-tooltip="' + esc(entry.targetName) + '">' + esc(entry.targetName) + '</div>' +
        '<div class="path" role="cell">' + esc(displayedPath) + '</div>' +
        '<div class="kind ' + cssClass + '" role="cell">' + esc(label) + '</div>' +
        '<div class="actions" role="cell">' + actionButtons + '</div></div>';
    }).join('');

    document.querySelectorAll('.sel').forEach(element => element.addEventListener('change', () => {
      element.checked ? selected.add(element.dataset.key) : selected.delete(element.dataset.key);
      updateSelected();
      updateSelectVisibleState();
    }));
    document.querySelectorAll('[data-diff]').forEach(element => element.addEventListener('click', () => post('openDiff', {
      mappingId: state.activeMappingId, targetId: element.dataset.targetId, relativePath: element.dataset.diff
    })));
    document.querySelectorAll('[data-up]').forEach(element => element.addEventListener('click', () => post('uploadSelected', {
      mappingId: state.activeMappingId, targetId: element.dataset.targetId, paths: [element.dataset.up]
    })));
    document.querySelectorAll('[data-down]').forEach(element => element.addEventListener('click', () => post('downloadSelected', {
      mappingId: state.activeMappingId, targetId: element.dataset.targetId, paths: [element.dataset.down]
    })));
    document.querySelectorAll('[data-resolve]').forEach(element => element.addEventListener('click', () => {
      chooseResolution(element.dataset.targetId, element.dataset.path, element.dataset.resolve);
    }));
    document.querySelectorAll('.row').forEach(row => {
      const entry = findCurrentChange(String(row.dataset.targetId || ''), String(row.dataset.changePath || ''));
      const disabled = (operationActive || interactionActive) || !entry || !entryCanOperate(entry);
      row.querySelectorAll('.actions button, input').forEach(button => { button.disabled = disabled || button.disabled; });
    });
    updateSelected();
    updateSelectVisibleState();
  }

  function matchesNamedFilter(entry, filterName) {
    switch (filterName) {
      case 'all':
        return true;
      case 'modified':
        return ['localChanged', 'remoteChanged'].includes(entry.status);
      case 'local':
        return ['localOnly', 'localChanged', 'remoteDeleted'].includes(entry.status);
      case 'remote':
        return ['remoteOnly', 'remoteChanged', 'localDeleted'].includes(entry.status);
      case 'conflict':
        return entry.status === 'conflict' || entry.status === 'different';
      case 'same':
        return entry.status === 'same';
      case 'changes':
      default:
        return entry.status !== 'same';
    }
  }

  function matchesFilter(entry) {
    return matchesNamedFilter(entry, filter);
  }

  function formatFilterCount(count) {
    return count > 999 ? '999+' : String(count);
  }

  function updateFilterCounts(entries) {
    document.querySelectorAll('[data-filter]').forEach(button => {
      const filterName = button.dataset.filter;
      const count = entries.filter(entry => matchesNamedFilter(entry, filterName)).length;
      const countElement = button.querySelector('[data-filter-count]');
      if (countElement) countElement.textContent = formatFilterCount(count);
      const labelElement = button.querySelector('.filter-label');
      const label = labelElement?.textContent || filterName;
      setTooltip(button, \`\${label}: \${count}\`);
      button.setAttribute('aria-label', \`\${label}: \${count}\`);
    });
  }

  function emptyChangesMessage(allEntries, query) {
    if (query) return 'No paths match the current search.';
    if (!state.mappings?.length) return 'Create a mapping to start Workspace Sync.';
    if (isAllEnabledSelected()) {
      const mapping = activeMapping();
      const targets = enabledTargets(mapping);
      if (!targets.length) return 'This mapping has no enabled targets.';
      const enabledIds = new Set(targets.map(target => target.id));
      const views = (state.targetViews || []).filter(view => enabledIds.has(view.targetId));
      const loaded = views.filter(view => view.lastComparedAt);
      if (!loaded.length) return allEnabledConnectionState(mapping).allConnected
        ? 'Refreshing enabled targets...'
        : 'Connect all enabled targets to load the file list.';
      if (!allEntries.length) return 'No files were found under the enabled target roots.';
      if (filter === 'changes' && allEntries.every(entry => entry.status === 'same')) return 'All enabled targets are in sync with Local.';
      return 'No entries match the current filter.';
    }
    if (activeTarget() && !activeTarget().enabled) return 'Enable the selected target in the mapping to use Workspace Sync.';
    if (!state.lastComparedAt) return state.connectionStatus === 'connected'
      ? 'Refreshing...'
      : 'Connect the selected target to load the file list.';
    if (!allEntries.length) return 'No files were found under the mapped roots.';
    if (filter === 'changes' && allEntries.every(entry => entry.status === 'same')) {
      return state.showingLastKnownState ? 'No changes in the last known state.' : 'Local and Remote are in sync.';
    }
    return 'No entries match the current filter.';
  }

  function renderSnapshotStatus() {
    const element = $('snapshotStatus');
    if (!element) return;
    if (isAllEnabledSelected()) {
      const mapping = activeMapping();
      const targets = enabledTargets(mapping);
      const enabledIds = new Set(targets.map(target => target.id));
      const views = (state.targetViews || []).filter(view => enabledIds.has(view.targetId));
      const loaded = views.filter(view => view.lastComparedAt);
      if (!loaded.length) {
        element.textContent = allEnabledConnectionState(mapping).allConnected ? 'Refreshing enabled targets...' : 'No file list loaded yet.';
        element.classList.toggle('stale', !allEnabledConnectionState(mapping).allConnected);
        return;
      }
      const latest = Math.max(...loaded.map(view => Number(view.lastComparedAt || 0)));
      const stale = loaded.filter(view => view.showingLastKnownState).length;
      const loadedLabel = loaded.length === targets.length ? 'All enabled targets loaded' : loaded.length + '/' + targets.length + ' enabled targets loaded';
      element.textContent = loadedLabel + (stale ? ' · ' + stale + ' showing last known state' : '') + ' · Last refreshed: ' + formatTimestamp(latest);
      element.classList.toggle('stale', stale > 0 || loaded.length !== targets.length);
      return;
    }
    const target = activeTarget();
    if (target && !target.enabled) {
      if (!state.lastComparedAt) {
        element.textContent = 'Target disabled.';
        element.classList.add('stale');
        return;
      }
      element.textContent = \`Disabled · Showing last known state · Last refreshed: \${formatTimestamp(state.lastComparedAt)}\`;
      element.classList.add('stale');
      return;
    }
    if (!state.lastComparedAt) {
      element.textContent = state.connectionStatus === 'connected' ? 'Refreshing...' : 'No file list loaded yet.';
      element.classList.toggle('stale', state.connectionStatus !== 'connected');
      return;
    }
    const refreshed = formatTimestamp(state.lastComparedAt);
    if (state.showingLastKnownState) {
      const prefix = state.connectionStatus === 'connected' ? 'Connected' : state.connectionStatus === 'connecting' ? 'Connecting' : state.connectionStatus === 'error' ? 'Connection error' : 'Disconnected';
      element.textContent = \`\${prefix} · Showing last known state · Last refreshed: \${refreshed}\`;
      element.classList.add('stale');
    } else {
      element.textContent = \`Last refreshed: \${refreshed}\`;
      element.classList.remove('stale');
    }
  }

  function positionDirectionHelpButton() {
    const dialog = document.querySelector('#mappingDialog .mapping-dialog');
    const body = $('mappingDialogBody');
    const select = $('mapDirection');
    const button = $('directionHelpButton');
    if (!dialog || !body || !select || !button || $('mappingDialog').hidden) return;

    // Remote Edit replaces the native select with a custom combobox and hides the
    // original select. Position the help icon from the rendered combobox so the
    // Direction field keeps its full width and the icon can use the dialog gutter.
    const renderedControl = document.querySelector('.profile-picker[data-for="mapDirection"] .profile-dropdown-button');
    const control = renderedControl || select;
    const dialogRect = dialog.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const controlRect = control.getBoundingClientRect();
    const visible = controlRect.width > 0 && controlRect.bottom > bodyRect.top && controlRect.top < bodyRect.bottom;
    button.style.visibility = visible ? 'visible' : 'hidden';
    if (!visible) {
      if (optionHelpAnchor === button) closeOptionHelp();
      return;
    }

    button.style.left = (controlRect.right - dialogRect.left + 4) + 'px';
    button.style.top = (controlRect.top - dialogRect.top + ((controlRect.height - 16) / 2)) + 'px';
  }

  function positionIgnoreHelpButton() {
    const dialog = document.querySelector('#mappingDialog .mapping-dialog');
    const body = $('mappingDialogBody');
    const control = $('mapIgnore');
    const button = $('ignoreHelpButton');
    if (!dialog || !body || !control || !button || $('mappingDialog').hidden) return;

    // Keep the Ignore textarea at its full width and place the help icon in the
    // same dialog gutter used by Direction. Center it vertically against the
    // full multi-line textarea so the help control stays visually balanced.
    const dialogRect = dialog.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const controlRect = control.getBoundingClientRect();
    const visible = controlRect.width > 0 && controlRect.bottom > bodyRect.top && controlRect.top < bodyRect.bottom;
    button.style.visibility = visible ? 'visible' : 'hidden';
    if (!visible) {
      if (optionHelpAnchor === button) closeOptionHelp();
      return;
    }

    button.style.left = (controlRect.right - dialogRect.left + 4) + 'px';
    button.style.top = (controlRect.top - dialogRect.top + ((controlRect.height - 16) / 2)) + 'px';
  }

  function positionOptionHelp() {
    const popover = $('optionHelpPopover');
    if (!optionHelpAnchor || popover.hidden) return;
    const anchorRect = optionHelpAnchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    let left = anchorRect.right + gap;
    if (left + popoverRect.width > window.innerWidth - margin) left = anchorRect.left - popoverRect.width - gap;
    left = Math.max(margin, Math.min(left, window.innerWidth - popoverRect.width - margin));
    let top = anchorRect.bottom + gap;
    if (top + popoverRect.height > window.innerHeight - margin) top = anchorRect.top - popoverRect.height - gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - popoverRect.height - margin));
    popover.style.left = \`\${left}px\`;
    popover.style.top = \`\${top}px\`;
  }

  function showOptionHelp(button) {
    const details = optionHelp[button?.dataset?.optionHelp];
    if (!details) return;
    if (optionHelpAnchor && optionHelpAnchor !== button) optionHelpAnchor.setAttribute('aria-expanded', 'false');
    optionHelpAnchor = button;
    $('optionHelpTitle').textContent = details.title;
    $('optionHelpText').textContent = details.text;
    $('optionHelpPopover').hidden = false;
    button.setAttribute('aria-expanded', 'true');
    positionOptionHelp();
  }

  function closeOptionHelp() {
    if (optionHelpAnchor) optionHelpAnchor.setAttribute('aria-expanded', 'false');
    optionHelpAnchor = undefined;
    $('optionHelpPopover').hidden = true;
  }

  function renderOptions() {
    const mapping = activeMapping();
    if (!mapping) {
      $('options').innerHTML = '';
      return;
    }
    const options = mapping.options;
    const directionLabel = options.direction === 'localToRemote'
      ? 'Local → Remote'
      : options.direction === 'remoteToLocal'
        ? 'Remote → Local'
        : 'Bidirectional';
    const rows = [
      [
        ['Direction', directionLabel],
        ['Unknown Change Protection', options.conflictProtection ? 'On' : 'Off'],
        ['Watch Local Changes', options.watchLocalChanges ? 'On' : 'Off']
      ],
      [
        ['Atomic Transfer', options.atomicTransfer ? 'On' : 'Off'],
        ['Propagate Deletes', options.propagateDeletes ? 'On' : 'Off'],
        ['Watch Remote Changes', options.watchRemoteChanges ? 'On' : 'Off']
      ],
      [
        ['Upload on Save', options.uploadOnSave ? 'On' : 'Off'],
        ['', ''],
        ['', '']
      ]
    ];
    $('options').innerHTML = rows.map(row => {
      const cells = row
        .map(([label, value]) => label
          ? \`<span class="metadata-option"><span class="metadata-option-label">\${label}:</span> <span class="metadata-option-value">\${value}</span></span>\`
          : '<span class="metadata-option metadata-option-empty" aria-hidden="true"></span>')
        .join('');
      return \`<div class="metadata-options-row">\${cells}</div>\`;
    }).join('');
  }

  function renderTargetStates() {
    const mapping = activeMapping();
    const element = $('targetStates');
    if (!mapping) {
      element.innerHTML = '';
      element.hidden = true;
      return;
    }
    const targetStates = state.targetStates || [];
    const details = (mapping.targets || []).map(target => {
      const item = targetStates.find(targetState => targetState.targetId === target.id);
      const rawStatus = target.enabled ? (item?.status || 'disconnected') : 'disabled';
      const displayStatus = rawStatus ? rawStatus[0].toUpperCase() + rawStatus.slice(1) : 'Disconnected';
      const extra = target.enabled
        ? (item?.connectionConfigChanged ? ' — reconnect required' : '') + (item?.message ? ' — ' + esc(item.message) : '')
        : '';
      return esc(target.name) + ': <span class="target-status ' + esc(rawStatus) + '">' + esc(displayStatus) + '</span>' + extra;
    }).join(' &nbsp; · &nbsp; ');
    const label = (mapping.targets || []).length === 1 ? 'Target' : 'Targets';
    element.innerHTML = \`<span class="metadata-targets-label">\${label}:</span><span>\${details || '—'}</span>\`;
    element.hidden = false;
  }

  function updateSelected() {
    const selectedEntries = selectedCurrentEntries();
    $('selectedCount').textContent = \`\${selectedEntries.length} selected\`;
    const groups = selectedGroups();
    const transferDisabled = (operationActive || interactionActive) || !groups.length;
    $('uploadSelected').disabled = transferDisabled;
    $('downloadSelected').disabled = transferDisabled;
  }

  function operationKindForStageLabel(label) {
    return ({
      'Refreshing...': 'refresh',
      'Revalidating...': 'sync',
      'Uploading...': 'upload',
      'Downloading...': 'download',
      'Deleting...': 'sync',
      'Creating directory...': 'sync',
      'Comparing...': 'comparison',
      'Verifying...': 'sync',
      'Cancelling...': 'cancel',
      'Finalizing...': 'sync'
    })[String(label || '')] || '';
  }

  function idleOperationStatus() {
    const mapping = activeMapping();
    if (!mapping) return { label: 'No mapping selected.', detail: '', active: false };

    if (isAllEnabledSelected(mapping)) {
      const aggregate = allEnabledConnectionState(mapping);
      const total = aggregate.targets.length;
      if (!total) return { label: 'No enabled targets.', detail: '', active: false };
      let detail = aggregate.connected + '/' + total + ' targets connected';
      if (aggregate.errors) detail += ' · ' + aggregate.errors + ' error' + (aggregate.errors === 1 ? '' : 's');
      if (aggregate.connecting) return { label: 'Connecting targets...', detail, active: true };
      if (aggregate.reconnectRequired) return { label: 'Reconnect required.', detail, active: false };
      if (aggregate.connected === 0 && aggregate.errors) return { label: 'Connection error.', detail, active: false };
      if (aggregate.connected === 0) return { label: 'Disconnected.', detail, active: false };
      return { label: 'Ready.', detail, active: false };
    }

    const target = activeTarget();
    if (!target) return { label: 'No target selected.', detail: '', active: false };
    if (!target.enabled) return { label: 'Target disabled.', detail: target.name || '', active: false };

    const status = state.connectionStatus || 'disconnected';
    if (status === 'connecting') return { label: 'Connecting...', detail: target.name || '', active: true };
    if (status === 'connected' && state.connectionConfigChanged) return { label: 'Reconnect required.', detail: target.name || '', active: false };
    if (status === 'connected') return { label: 'Ready.', detail: target.name || '', active: false };
    if (status === 'error') return { label: 'Connection error.', detail: state.connectionMessage || target.name || '', active: false };
    return { label: 'Disconnected.', detail: target.name || '', active: false };
  }

  function visibleBackgroundOperation() {
    if (!backgroundOperation?.active) return null;
    if (backgroundOperation.mappingId && String(backgroundOperation.mappingId) !== String(state.activeMappingId || '')) return null;
    return backgroundOperation;
  }

  function renderOperationStatus() {
    const background = visibleBackgroundOperation();
    const idle = idleOperationStatus();
    const foreground = operationActive;
    const shown = foreground
      ? { label: activeOperationLabel || 'Workspace Sync operation', detail: $('operationDetail').dataset.foregroundDetail || '', active: true }
      : background
        ? { label: background.label || 'Working...', detail: background.detail || '', active: true }
        : idle;

    $('operationBar').classList.toggle('active', Boolean(shown.active));
    $('operationLabel').textContent = shown.label;
    if (!foreground) $('operationDetail').textContent = shown.detail || '';
    $('cancelOperation').disabled = !operationCancellable;
    $('cancelOperation').hidden = !operationCancellable;
    $('compare').textContent = foreground && activeOperationStageKind === 'refresh' ? 'Refreshing...' : 'Refresh';
  }

  function setForegroundOperationDetail(detail) {
    const value = String(detail || '');
    $('operationDetail').dataset.foregroundDetail = value;
    if (operationActive) $('operationDetail').textContent = value;
  }

  function setActiveOperationLabel(label, stageKind) {
    activeOperationLabel = operationActive ? String(label || '') : '';
    if (operationActive && stageKind) activeOperationStageKind = String(stageKind);
    renderOperationStatus();
  }

  function progressStageLabel(phase) {
    const value = String(phase || '').trim();
    const lower = value.toLowerCase();
    if (!value) return '';
    if (/^(scanning local files|scanning remote files|scanning shared local files|verifying ambiguous file content|verifying file content|refresh complete)/i.test(value)) return 'Refreshing...';
    if (/^revalidating/i.test(value)) return 'Revalidating...';
    if (/(^|:\\s*)upload$/i.test(value)) return 'Uploading...';
    if (/(^|:\\s*)download$/i.test(value)) return 'Downloading...';
    if (/(^|:\\s*)delete(local|remote)$/i.test(value)) return 'Deleting...';
    if (/(^|:\\s*)create(local|remote)directory$/i.test(value)) return 'Creating directory...';
    if (/^comparing\\s/i.test(value)) return 'Comparing...';
    if (/^verifying\\s/i.test(value)) return 'Verifying...';
    if (lower === 'cancelled') return 'Cancelling...';
    if (lower === 'complete' || /sync complete/i.test(value)) return 'Finalizing...';
    return '';
  }

  function updateOperationState(active, label, kind, operationId, cancelling, cancellable) {
    const incomingId = Number(operationId || 0);
    const incomingActive = Boolean(active);

    if (incomingId > 0) {
      if (incomingActive) {
        // Ignore a late active/cancelling update for an operation that the
        // webview has already observed as finished. This closes the race where
        // Cancel cleanup completed after the operation's final inactive state.
        if (incomingId < latestOperationId || (incomingId === latestOperationId && !activeOperationId)) return;
        latestOperationId = Math.max(latestOperationId, incomingId);
        activeOperationId = incomingId;
      } else {
        if (incomingId < latestOperationId) return;
        if (activeOperationId && incomingId !== activeOperationId && incomingId < activeOperationId) return;
        latestOperationId = Math.max(latestOperationId, incomingId);
        activeOperationId = 0;
      }
    }

    operationActive = incomingActive;
    operationCancelling = operationActive && Boolean(cancelling);
    operationCancellable = operationActive && cancellable !== false && !operationCancelling;
    if (operationActive) {
      activeOperationKind = String(kind || activeOperationKind || 'sync');
      activeOperationStageKind = operationCancelling ? 'cancel' : activeOperationKind;
    } else {
      activeOperationKind = '';
      activeOperationStageKind = '';
    }
    setForegroundOperationDetail('');
    setActiveOperationLabel(label || '', activeOperationStageKind);
    if (!operationActive || operationCancelling) setForegroundOperationDetail('');
    render();
  }

  function updateOperationProgress(progress, operationId) {
    if (!progress) return;
    const incomingId = Number(operationId || 0);
    if (incomingId > 0 && (!operationActive || incomingId !== activeOperationId)) return;
    if (operationCancelling) return;
    const phase = String(progress.phase || '').trim();
    const stage = progressStageLabel(phase);
    if (stage) setActiveOperationLabel(stage, operationKindForStageLabel(stage) || activeOperationStageKind);

    if (activeOperationKind === 'disconnect' && Number(progress.total || 0) > 1) {
      setActiveOperationLabel('Disconnecting targets...', 'disconnect');
      setForegroundOperationDetail(Math.max(0, Number(progress.completed || 0)) + '/' + Math.max(0, Number(progress.total || 0)) + ' targets');
      return;
    }

    const simplePhase = /^(upload|download|deleteLocal|deleteRemote|createLocalDirectory|createRemoteDirectory|complete|cancelled)$/i.test(phase);
    const parts = [];
    if (phase && !simplePhase && !/^Refresh complete\\.?$/i.test(phase)) parts.push(phase);
    if (progress.currentPath) parts.push(String(progress.currentPath));
    setForegroundOperationDetail(parts.join(' · '));
  }

  function previewOperationType(entry, resolution) {
    if (resolution === 'skip') return 'skip';
    const useLocal = resolution === 'useLocal';
    const source = useLocal ? entry.local : entry.remote;
    if (!source) return useLocal ? 'deleteRemote' : 'deleteLocal';
    if (source.kind === 'file') return useLocal ? 'upload' : 'download';
    if (source.kind === 'directory') return useLocal ? 'createRemoteDirectory' : 'createLocalDirectory';
    return 'skip';
  }

  function renderPreview() {
    const previewTargets = syncPreviewTargetViews();
    if (!previewTargets.length) {
      $('previewBody').innerHTML = '<p>No sync plan. Run Refresh first.</p>';
      $('startPreviewSync').disabled = true;
      return;
    }

    const aggregate = isAllEnabledSelected();
    const decisions = [];
    const ordinaryOperations = [];
    const unresolvedPlanConflicts = [];
    const compareErrors = [];

    for (const view of previewTargets) {
      const targetDiffs = (view.diffs || []).map(entry => ({
        ...entry,
        targetId: view.targetId,
        targetName: view.targetName
      }));
      const targetDecisions = targetDiffs.filter(requiresResolution);
      const decisionPaths = new Set(targetDecisions.map(entry => entry.relativePath));
      decisions.push(...targetDecisions);
      ordinaryOperations.push(...(view.plan.operations || [])
        .filter(operation => !decisionPaths.has(operation.relativePath))
        .map(operation => ({ ...operation, targetId: view.targetId, targetName: view.targetName })));
      unresolvedPlanConflicts.push(...(view.plan.conflicts || [])
        .filter(entry => !decisionPaths.has(entry.relativePath))
        .map(entry => ({ ...entry, targetId: view.targetId, targetName: view.targetName })));
      compareErrors.push(...(view.plan.errors || [])
        .map(entry => ({ ...entry, targetId: view.targetId, targetName: view.targetName })));
    }

    const effectiveOperations = ordinaryOperations.map(operation => ({ type: operation.type }));
    for (const entry of decisions) {
      const resolution = previewResolutions[changeKey(entry.targetId, entry.relativePath)];
      if (resolution) effectiveOperations.push({ type: previewOperationType(entry, resolution) });
    }

    const counts = { createLocalDirectory: 0, createRemoteDirectory: 0, upload: 0, download: 0, deleteLocal: 0, deleteRemote: 0, skip: 0 };
    effectiveOperations.forEach(operation => { counts[operation.type] = (counts[operation.type] || 0) + 1; });
    const operationLabel = {
      createLocalDirectory: 'Create local directory',
      createRemoteDirectory: 'Create remote directory',
      upload: 'Upload',
      download: 'Download',
      deleteLocal: 'Delete local',
      deleteRemote: 'Delete remote',
      skip: 'Skip'
    };
    const previewPath = entry => aggregate ? entry.targetName + ' / ' + entry.relativePath : entry.relativePath;

    const operations = ordinaryOperations.map(operation =>
      \`<div class="previewRow"><span>\${esc(operationLabel[operation.type] || operation.type)}</span><span class="path">\${esc(previewPath(operation))}</span></div>\`
    ).join('');
    const decisionRows = decisions.map(entry => {
      const resolution = previewResolutions[changeKey(entry.targetId, entry.relativePath)];
      const pendingClass = resolution ? '' : ' pending';
      return \`<div class="previewDecision\${pendingClass}">
        <div class="previewDecisionInfo"><span class="path">\${esc(previewPath(entry))}</span><span class="conflict">\${esc(statusLabel(entry.status))}</span></div>
        <div class="previewDecisionActions">\${compareButtonHtml(entry, 'preview')}\${resolutionButtonHtml(entry, 'useLocal', 'Use Local', 'preview')}\${resolutionButtonHtml(entry, 'useRemote', 'Use Remote', 'preview')}\${resolutionButtonHtml(entry, 'skip', 'Skip', 'preview')}</div>
      </div>\`;
    }).join('');
    const conflicts = unresolvedPlanConflicts.map(entry => \`<div class="previewRow conflict"><span>Conflict</span><span class="path">\${esc(previewPath(entry))}</span></div>\`).join('');
    const errors = compareErrors.map(entry => \`<div class="previewRow conflict"><span>Error</span><span class="path">\${esc(previewPath(entry))}</span></div>\`).join('');
    const pending = decisions.filter(entry => !previewResolutions[changeKey(entry.targetId, entry.relativePath)]).length;
    const operationSection = operations || conflicts || errors
      ? \`<div class="previewSectionTitle">Planned operations</div><div class="previewList">\${operations}\${conflicts}\${errors}</div>\`
      : '';
    const decisionSection = decisionRows
      ? \`<div class="previewSectionTitle">Different and Conflict decisions</div><div class="previewDecisionList">\${decisionRows}</div>\`
      : '';

    const plural = (count, singular, pluralForm = singular + 's') => count === 1 ? singular : pluralForm;
    $('previewBody').innerHTML = \`
      <div class="previewSummary" aria-label="Sync plan summary">
        <span class="previewSummaryItem"><span class="previewSummaryCount">\${counts.upload}</span><span>uploads</span></span>
        <span class="previewSummaryItem"><span class="previewSummaryCount">\${counts.download}</span><span>downloads</span></span>
        <span class="previewSummaryItem"><span class="previewSummaryCount">\${counts.createRemoteDirectory}</span><span>remote folders</span></span>
        <span class="previewSummaryItem"><span class="previewSummaryCount">\${counts.createLocalDirectory}</span><span>local folders</span></span>
        <span class="previewSummaryItem"><span class="previewSummaryCount">\${counts.deleteRemote}</span><span>remote deletes</span></span>
        <span class="previewSummaryItem"><span class="previewSummaryCount">\${counts.deleteLocal}</span><span>local deletes</span></span>
        <span class="previewSummaryItem"><span class="previewSummaryCount">\${counts.skip}</span><span>skipped</span></span>
      </div>
      \${decisionSection}\${operationSection}
      <div class="previewPlanFooter">
        <div class="previewPlanStatus">
          <span class="previewPlanStatusItem"><span class="previewPlanStatusCount">\${pending}</span> \${plural(pending, 'decision pending', 'decisions pending')}</span>
          <span class="previewPlanStatusItem"><span class="previewPlanStatusCount">\${unresolvedPlanConflicts.length}</span> \${plural(unresolvedPlanConflicts.length, 'structural conflict', 'structural conflicts')}</span>
          <span class="previewPlanStatusItem"><span class="previewPlanStatusCount">\${compareErrors.length}</span> \${plural(compareErrors.length, 'compare error', 'compare errors')}</span>
        </div>
        <div class="previewRevalidation">Plan will be revalidated before execution.</div>
      </div>\`;

    document.querySelectorAll('[data-preview-diff]').forEach(element => element.addEventListener('click', () => post('openDiff', {
      mappingId: state.activeMappingId, targetId: element.dataset.targetId, relativePath: element.dataset.previewDiff
    })));
    document.querySelectorAll('[data-preview-resolve]').forEach(element => element.addEventListener('click', () => {
      const relativePath = element.dataset.path;
      const targetId = element.dataset.targetId;
      const key = changeKey(targetId, relativePath);
      const resolution = element.dataset.previewResolve;
      if (previewResolutions[key] === resolution) delete previewResolutions[key];
      else previewResolutions[key] = resolution;
      renderPreview();
    }));
    $('startPreviewSync').disabled = Boolean(pending) || Boolean(unresolvedPlanConflicts.length) || Boolean(compareErrors.length);
  }

  function openPreview() {
    if (pendingResolutionRequests.size > 0) {
      syncPreviewRequested = true;
      return;
    }
    syncPreviewRequested = false;
    previewResolutions = {};
    for (const view of syncPreviewTargetViews()) {
      for (const entry of (view.diffs || []).filter(requiresResolution)) {
        if (entry.resolution) previewResolutions[changeKey(view.targetId, entry.relativePath)] = entry.resolution;
      }
    }
    $('previewDialogTitle').textContent = isAllEnabledSelected() ? 'Sync Review · All Enabled' : 'Sync Review';
    hideWebviewTooltip();
    renderPreview();
    openDialog('previewDialog');
  }

  function normalizeRemoteDirectoryForIdentity(value) {
    let normalized = String(value || '').trim().replaceAll(String.fromCharCode(92), '/');
    if (!normalized) return '';
    while (normalized.includes('//')) normalized = normalized.replaceAll('//', '/');
    const driveCandidate = normalized.startsWith('/') ? normalized.slice(1) : normalized;
    const isDriveRoot = driveCandidate.length === 3
      && /[A-Za-z]/.test(driveCandidate[0])
      && driveCandidate[1] === ':'
      && driveCandidate[2] === '/';
    if (isDriveRoot) return normalized;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized || '/';
  }

  function normalizeLocalDirectoryForIdentity(value) {
    let normalized = String(value || '').trim().replaceAll(String.fromCharCode(92), '/');
    if (!normalized) return '';
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
  }

  function duplicateTargetDestinationError(targets) {
    const destinations = new Map();
    for (const target of targets || []) {
      const connectionId = String(target.connectionId || '').trim();
      const remoteRoot = normalizeRemoteDirectoryForIdentity(target.remoteRoot);
      if (!connectionId || !remoteRoot) continue;
      const name = String(target.name || '').trim() || 'Target';
      const key = JSON.stringify([connectionId, remoteRoot]);
      const existingName = destinations.get(key);
      if (existingName) {
        return "Target '" + name + "' duplicates '" + existingName + "' (same Connection and Remote Directory).";
      }
      destinations.set(key, name);
    }
    return '';
  }

  function duplicateMappingRouteError(localRoot, targets) {
    const normalizedLocalRoot = normalizeLocalDirectoryForIdentity(localRoot);
    if (!normalizedLocalRoot) return '';

    for (const mapping of state.mappings || []) {
      if (String(mapping.id || '') === String(editingMappingId || '')) continue;
      if (normalizeLocalDirectoryForIdentity(mapping.localRoot) !== normalizedLocalRoot) continue;

      for (const target of targets || []) {
        const connectionId = String(target.connectionId || '').trim();
        const remoteRoot = normalizeRemoteDirectoryForIdentity(target.remoteRoot);
        if (!connectionId || !remoteRoot) continue;

        const duplicate = (mapping.targets || []).find(existing =>
          String(existing.connectionId || '').trim() === connectionId
          && normalizeRemoteDirectoryForIdentity(existing.remoteRoot) === remoteRoot
        );
        if (!duplicate) continue;

        const mappingName = String(mapping.name || '').trim() || 'Mapping';
        const targetName = String(duplicate.name || '').trim() || 'Target';
        return "Route duplicates '" + mappingName + ' / ' + targetName + "' (same Local Root, Connection and Remote Directory).";
      }
    }
    return '';
  }

  function updateMappingValidation() {
    const message = duplicateTargetDestinationError(editingTargets)
      || duplicateMappingRouteError($('mapLocal').value, editingTargets);
    const error = $('mappingError');
    if (message) {
      mappingClientValidationMessage = message;
      error.textContent = message;
    } else if (mappingClientValidationMessage && error.textContent === mappingClientValidationMessage) {
      error.textContent = '';
      mappingClientValidationMessage = '';
    }
    $('saveMapping').disabled = interactionActive || Boolean(message);
    return !message;
  }

  function newTarget() {
    return {
      id: '',
      name: \`Target \${editingTargets.length + 1}\`,
      connectionId: state.connections[0]?.id || '',
      remoteRoot: '/',
      enabled: true
    };
  }

  function refreshDirectionalOptionAvailability() {
    const direction = $('mapDirection').value;
    const localToRemoteEnabled = direction !== 'remoteToLocal';
    const remoteToLocalEnabled = direction !== 'localToRemote';

    for (const id of ['optUploadSave', 'optWatch']) {
      const option = $(id);
      option.disabled = !localToRemoteEnabled;
      if (!localToRemoteEnabled) option.checked = false;
      setTooltip(option.closest('.mapping-option-row'), !localToRemoteEnabled ? 'Not available when Direction is Remote → Local.' : '');
    }

    $('optWatchRemote').disabled = !remoteToLocalEnabled;
    if (!remoteToLocalEnabled) $('optWatchRemote').checked = false;
    setTooltip($('optWatchRemote').closest('.mapping-option-row'), !remoteToLocalEnabled ? 'Not available when Direction is Local → Remote.' : '');
  }

  function openMapping(mapping) {
    closeOptionHelp();
    editingMappingId = mapping?.id;
    editingTargets = mapping?.targets ? mapping.targets.map(target => ({ ...target })) : [];
    if (!mapping) editingTargets.push(newTarget());
    $('mappingDialogTitle').textContent = mapping ? 'Workspace Sync Mapping' : 'New Workspace Sync Mapping';
    mappingClientValidationMessage = '';
    $('mappingError').textContent = '';
    $('mapName').value = mapping?.name || '';
    $('mapLocal').value = mapping?.localRoot || '';
    $('mapDirection').value = mapping?.options?.direction || 'bidirectional';
    $('mapIgnore').value = (mapping?.options?.ignorePatterns || ['.git/', 'node_modules/']).join('\\n');
    $('optConflict').checked = mapping?.options?.conflictProtection ?? true;
    $('optAtomic').checked = mapping?.options?.atomicTransfer ?? true;
    $('optDeletes').checked = mapping?.options?.propagateDeletes ?? false;
    $('optUploadSave').checked = mapping?.options?.uploadOnSave ?? false;
    $('optWatch').checked = mapping?.options?.watchLocalChanges ?? false;
    $('optWatchRemote').checked = mapping?.options?.watchRemoteChanges ?? false;
    refreshDirectionalOptionAvailability();
    $('deleteMapping').style.display = mapping ? 'inline-block' : 'none';
    renderTargetEditor();
    $('mappingDialogBody').scrollTop = 0;
    controls.refresh();
    openDialog('mappingDialog');
    requestAnimationFrame(() => {
      positionDirectionHelpButton();
      positionIgnoreHelpButton();
    });
  }

  function openNewMapping() {
    openMapping(undefined);
  }

  function renderTargetEditor() {
    if (editingTargets.length) {
      const header = '<div class="targetHeader" aria-hidden="true"><div class="targetFieldLabel">Target Name</div><div class="targetFieldLabel">Connection</div><div class="targetFieldLabel">Remote Directory</div><div class="targetFieldLabel targetEnabledHeader">Enabled</div><div></div></div>';
      const rows = editingTargets.map((target, index) => {
        const options = state.connections.map(connection => \`<option value="\${esc(connection.id)}" \${connection.id === target.connectionId ? 'selected' : ''}>\${esc(connection.name)}</option>\`).join('');
        return \`<div class="targetRow"><div class="targetField"><input aria-label="Target name" data-ti="\${index}" data-f="name" value="\${esc(target.name || '')}"></div><div class="targetField"><select aria-label="Connection" data-ti="\${index}" data-f="connectionId">\${options}</select></div><div class="targetField"><input aria-label="Remote directory" data-ti="\${index}" data-f="remoteRoot" value="\${esc(target.remoteRoot || '/')}"></div><div class="targetRowControl targetEnabledCell"><input aria-label="Enabled" data-ti="\${index}" data-f="enabled" type="checkbox" class="checkbox-inline" \${target.enabled !== false ? 'checked' : ''}></div><div class="targetRowControl targetRemoveControl"><button class="ghost" data-remove-target="\${index}" data-tooltip="Remove">×</button></div></div>\`;
      }).join('');
      $('targetEditor').innerHTML = header + rows;
    } else {
      $('targetEditor').innerHTML = '<div class="muted">Add at least one target.</div>';
    }

    document.querySelectorAll('[data-ti]').forEach(element => {
      const updateTarget = () => {
        const index = Number(element.dataset.ti);
        const field = element.dataset.f;
        editingTargets[index][field] = field === 'enabled' ? element.checked : element.value;
        updateMappingValidation();
      };
      element.addEventListener('input', updateTarget);
      element.addEventListener('change', updateTarget);
    });
    controls.refresh();
    document.querySelectorAll('[data-remove-target]').forEach(element => {
      element.onclick = () => {
        editingTargets.splice(Number(element.dataset.removeTarget), 1);
        renderTargetEditor();
      };
    });
    updateMappingValidation();
  }

  const controls = window.RemoteEditControls;
  const openDialog = (id, cancel) => controls.openDialog(id, cancel);
  const closeDialog = id => controls.closeDialog(id);
  let requests = [];
  let currentRequest;
  let folderSequence = 0;
  let folderPath = '';
  let folderBrowsePending = false;
  let activity = [];
  let following = true;
  let pendingActivity = [];
  let activityScheduled = false;
  function finishRequest(value) {
    if (!currentRequest) return;
    const id = currentRequest.id;
    $('requestBody').replaceChildren();
    currentRequest = undefined; closeDialog('requestDialog');
    post('uiResponse', { id, value });
    nextRequest();
  }
  function updateFolderGoState() {
    const input = $('folderPath');
    const go = $('folderGo');
    if (!input || !go) return;
    const typedPath = String(input.value || '').trim();
    const currentPath = String(folderPath || '').trim();
    go.disabled = folderBrowsePending || !typedPath || typedPath === currentPath;
  }
  function browse(path) {
    if (!currentRequest || currentRequest.kind !== 'folder') return;
    folderBrowsePending = true;
    $('folderError').textContent = '';
    $('folderList').textContent = 'Loading folders…';
    $('requestAccept').disabled = true;
    updateFolderGoState();
    post('browseLocal', { id: currentRequest.id, path, sequence: ++folderSequence });
  }
  function renderFolderListing(message) {
    if (currentRequest?.id !== message.id || message.sequence !== folderSequence) return;
    folderBrowsePending = false;
    if (message.error) { $('folderList').replaceChildren(); $('folderError').textContent = message.error; updateFolderGoState(); return; }
    folderPath = message.listing.directory; $('folderPath').value = folderPath;
    $('folderList').replaceChildren(); $('folderShortcuts').replaceChildren();
    for (const shortcut of message.listing.shortcuts) {
      const button = document.createElement('button'); button.className = 'secondary'; button.textContent = shortcut; button.onclick = () => browse(shortcut); $('folderShortcuts').append(button);
    }
    const folders = [{name: '..', path: message.listing.parent}, ...message.listing.folders];
    for (const folder of folders) {
      const button = document.createElement('button'); button.className = 'folder-item'; button.textContent = folder.name === '..' ? '↑ Parent folder' : \`▸ \${folder.name}\`; button.onclick = () => browse(folder.path); $('folderList').append(button);
    }
    $('requestAccept').disabled = false;
    updateFolderGoState();
  }
  function nextRequest() {
    if (currentRequest || !requests.length) return;
    currentRequest = requests.shift(); const request = currentRequest;
    $('requestDialogPanel').classList.toggle('folder-dialog', request.kind === 'folder');
    $('requestTitle').textContent = request.title;
    $('requestDetail').textContent = request.detail || '';
    $('requestBody').replaceChildren(); $('requestActions').replaceChildren();
    const cancel = document.createElement('button'); cancel.className = 'secondary'; cancel.textContent = request.kind === 'confirm' && !request.choices?.length ? 'Close' : 'Cancel'; cancel.onclick = () => finishRequest();
    const accept = document.createElement('button'); accept.id = 'requestAccept'; accept.textContent = 'Continue';
    const validation = document.createElement('div'); validation.className = 'validation'; validation.setAttribute('role','alert');
    let input;
    if (request.kind === 'input') {
      input = document.createElement('input'); input.type = request.password ? 'password' : 'text'; input.value = request.value || ''; input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('aria-label',request.title);
      $('requestBody').append(input, validation);
      accept.onclick = () => { if (request.required && !input.value.trim()) { validation.textContent = 'This field is required.'; input.focus(); return; } const value = input.value; input.value = ''; finishRequest(value); };
      input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); accept.click(); } };
    } else if (request.kind === 'folder') {
      folderPath = String(request.value || '').trim();
      folderBrowsePending = false;
      $('requestBody').innerHTML = '<div id="folderShortcuts" class="folder-shortcuts"></div><div class="folder-navigation"><input id="folderPath" aria-label="Directory path" spellcheck="false"><button id="folderGo" class="secondary" disabled>Go</button></div><div id="folderError" class="validation" role="alert"></div><div id="folderList" class="folder-list"></div>';
      $('folderPath').value = request.value || '';
      $('folderGo').onclick = () => browse($('folderPath').value);
      $('folderPath').oninput = updateFolderGoState;
      $('folderPath').onkeydown = event => { if (event.key === 'Enter' && !$('folderGo').disabled) { event.preventDefault(); browse($('folderPath').value); } };
      updateFolderGoState();
      accept.textContent = 'Select Folder'; accept.disabled = true; accept.onclick = () => finishRequest(folderPath);
    }
    $('requestActions').append(cancel);
    if (request.kind === 'confirm') {
      for (const choice of request.choices || []) {
        const button = document.createElement('button'); button.textContent = choice; button.onclick = () => finishRequest(choice); $('requestActions').append(button);
      }
    } else $('requestActions').append(accept);
    openDialog('requestDialog', () => finishRequest());
    if (request.kind === 'folder') browse(request.value || '');
  }
  function activityText(entry) {
    return \`\${formatTimestamp(entry.time)} [\${entry.target || 'Workspace Sync'}] \${entry.message}\`;
  }
  function addActivityNode(entry) {
    const line = document.createElement('div'); line.className = \`activity-line \${entry.level}\`; line.textContent = activityText(entry); $('activityLog').append(line);
  }
  function appendActivities() {
    activityScheduled = false;
    for (const entry of pendingActivity.splice(0)) {
      activity.push(entry); addActivityNode(entry);
    }
    const log = $('activityLog'); const oldHeight = log.scrollHeight; const oldTop = log.scrollTop;
    if (activity.length > 1000) {
      const remove = activity.length - 1000; activity.splice(0, remove);
      for (let i=0; i<remove; i++) log.firstChild?.remove();
      if (!following) log.scrollTop = Math.max(0, oldTop - (oldHeight - log.scrollHeight));
    }
    $('activityCount').textContent = \`\${activity.length} events\`;
    if (following) log.scrollTop = log.scrollHeight;
    $('activityFollow').hidden = following;
  }
  function queueActivity(entry) {
    pendingActivity.push(entry);
    if (!activityScheduled) { activityScheduled = true; requestAnimationFrame(appendActivities); }
  }
  const changesPanel = $('changesPanel');
  const savedChangesPanelHeight = Number(persistedUiState.changesPanelHeight);
  if (Number.isFinite(savedChangesPanelHeight)) changesPanel.style.height = Math.max(180, Math.min(savedChangesPanelHeight, Math.floor(window.innerHeight * .50))) + 'px';
  if (typeof ResizeObserver !== 'undefined') {
    let lastChangesPanelHeight = changesPanel.getBoundingClientRect().height;
    const changesResizeObserver = new ResizeObserver(entries => {
      const height = Math.round(entries[0]?.contentRect?.height || changesPanel.getBoundingClientRect().height);
      if (!height || Math.abs(height - lastChangesPanelHeight) < 1) return;
      lastChangesPanelHeight = height;
      vscode.setState(Object.assign({}, vscode.getState() || {}, { changesPanelHeight: height }));
    });
    changesResizeObserver.observe(changesPanel);
  }

  const activityLog = $('activityLog');
  $('activityLog').addEventListener('scroll', () => { const log = $('activityLog'); following = log.scrollHeight - log.scrollTop - log.clientHeight < 24; $('activityFollow').hidden = following; });
  $('activityFollow').onclick = () => { following = true; $('activityLog').scrollTop = $('activityLog').scrollHeight; $('activityFollow').hidden = true; };
  $('activityClear').onclick = () => post('clearActivity');
  $('activityCopy').onclick = () => post('copyActivity');
  $('closeDiff').onclick = () => { closeDialog('diffDialog'); $('diffLines').replaceChildren(); };
  function showComparison(comparison) {
    $('diffTitle').textContent = comparison.relativePath;
    $('diffSummary').textContent = comparison.identical ? 'Local and Remote are identical.' : \`Local ↔ \${comparison.targetName} · red: Local only · green: Remote only\`;
    const fragment = document.createDocumentFragment();
    comparison.lines.forEach(line => {
      const row = document.createElement('div'); row.className = \`diff-line \${line.kind}\`;
      for (const text of [line.localLine || '',line.remoteLine || '', line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ',line.text]) {
        const cell = document.createElement('span'); cell.textContent = String(text); row.append(cell);
      }
      fragment.append(row);
    });
    $('diffLines').replaceChildren(fragment); openDialog('diffDialog');
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'request') { requests.push(message.request); nextRequest(); }
    else if (message.type === 'dismissRequest') {
      requests = requests.filter(request => request.id !== message.id);
      if (currentRequest?.id === message.id) { $('requestBody').replaceChildren(); currentRequest = undefined; closeDialog('requestDialog'); nextRequest(); }
    } else if (message.type === 'folderListing') renderFolderListing(message);
    else if (message.type === 'comparison') showComparison(message.comparison);
    else if (message.type === 'activity') queueActivity(message.entry);
    else if (message.type === 'activitySnapshot') {
      pendingActivity = []; activity = []; $('activityLog').replaceChildren(); following = true;
      for (const entry of message.entries) queueActivity(entry);
      appendActivities();
    } else if (message.type === 'copiedActivity') { $('activityCopy').textContent = 'Copied'; setTimeout(() => { $('activityCopy').textContent = 'Copy'; }, 1500); }
  });

  $('cancelOperation').onclick = () => post('cancelOperation', { operationId: activeOperationId });
  $('mapping').onchange = event => {
    selected.clear();
    post('selectMapping', { mappingId: event.target.value });
  };
  $('target').onchange = event => {
    selected.clear();
    const mappingId = String(state.activeMappingId || '');
    if (event.target.value === ALL_ENABLED_TARGETS) {
      if (mappingId) allEnabledMappingIds.add(mappingId);
      persistAllEnabledSelection();
      render();
      return;
    }
    if (mappingId) allEnabledMappingIds.delete(mappingId);
    persistAllEnabledSelection();
    post('selectTarget', { mappingId, targetId: event.target.value });
  };
  $('manage').onclick = () => openMapping(activeMapping());
  $('newMapping').onclick = openNewMapping;
  $('connect').onclick = () => {
    const mapping = activeMapping();
    if (!mapping) return;
    if (isAllEnabledSelected(mapping)) {
      const aggregate = allEnabledConnectionState(mapping);
      if (!aggregate.targets.length) return;
      const action = aggregate.allConnected && !aggregate.reconnectRequired ? 'disconnectEnabled' : 'connectEnabled';
      post(action, { mappingId: mapping.id });
      return;
    }
    const target = activeTarget();
    if (!target) return;
    const action = state.connectionStatus === 'connected'
      ? (state.connectionConfigChanged ? 'reconnect' : 'disconnect')
      : 'connect';
    post(action, { mappingId: mapping.id, targetId: target.id });
  };
  $('compare').onclick = () => {
    const mapping = activeMapping();
    if (!mapping) return;
    if (isAllEnabledSelected(mapping)) {
      post('compareEnabled', { mappingId: mapping.id });
      return;
    }
    const target = activeTarget();
    if (target) post('compare', { mappingId: mapping.id, targetId: target.id });
  };
  $('sync').onclick = openPreview;
  $('closePreview').onclick = () => closeDialog('previewDialog');
  $('startPreviewSync').onclick = () => {
    if ($('startPreviewSync').disabled) return;
    const mapping = activeMapping();
    if (!mapping) return;
    const previewTargets = syncPreviewTargetViews(mapping);
    if (!previewTargets.length) return;
    closeDialog('previewDialog');
    if (isAllEnabledSelected(mapping)) {
      const targets = previewTargets.map(view => {
        const resolutions = {};
        for (const entry of (view.diffs || []).filter(requiresResolution)) {
          const resolution = previewResolutions[changeKey(view.targetId, entry.relativePath)];
          if (resolution) resolutions[entry.relativePath] = resolution;
        }
        return { targetId: view.targetId, resolutions };
      });
      post('syncEnabled', { mappingId: mapping.id, targets });
      return;
    }
    const target = previewTargets[0];
    const resolutions = {};
    for (const entry of (target.diffs || []).filter(requiresResolution)) {
      const resolution = previewResolutions[changeKey(target.targetId, entry.relativePath)];
      if (resolution) resolutions[entry.relativePath] = resolution;
    }
    post('sync', { mappingId: mapping.id, targetId: target.targetId, resolutions });
  };
  $('changesMore').onclick = event => { event.preventDefault(); event.stopPropagation(); toggleChangesMenu(); };
  $('resetBaseline').onclick = () => {
    const mapping = activeMapping(); const target = activeTarget();
    closeChangesMenu();
    if (mapping && target) post('resetBaseline', { mappingId: mapping.id, targetId: target.id });
  };
  $('search').oninput = () => { updateSearchClearButton(); renderChanges(); };
  $('search').onkeydown = event => {
    if (event.key !== 'Escape' || !$('search').value) return;
    event.preventDefault();
    event.stopPropagation();
    clearPathFilter();
  };
  $('clearSearch').onclick = () => {
    clearPathFilter();
    $('search').focus();
  };
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.onclick = () => { filter = button.dataset.filter; renderChanges(); };
  });
  document.querySelectorAll('[data-change-sort]').forEach(button => {
    button.onclick = () => cycleChangesSort(button.dataset.changeSort);
  });
  $('selectVisible').onchange = () => {
    const checkbox = $('selectVisible');
    if (checkbox.disabled || !visibleChangeKeys.length) return;
    const selectedVisible = visibleChangeKeys.reduce((count, key) => count + (selected.has(key) ? 1 : 0), 0);
    const shouldSelect = selectedVisible < visibleChangeKeys.length;
    visibleChangeKeys.forEach(key => shouldSelect ? selected.add(key) : selected.delete(key));
    renderChanges();
  };
  $('uploadSelected').onclick = () => post('uploadSelected', { mappingId: state.activeMappingId, selections: selectedGroups() });
  $('downloadSelected').onclick = () => post('downloadSelected', { mappingId: state.activeMappingId, selections: selectedGroups() });

  bindTextEditContextButton('textEditContextUndo', 'undo');
  bindTextEditContextButton('textEditContextRedo', 'redo');
  bindTextEditContextButton('textEditContextCut', 'cut');
  bindTextEditContextButton('textEditContextCopy', 'copy');
  bindTextEditContextButton('textEditContextPaste', 'paste');
  bindTextEditContextButton('textEditContextSelectAll', 'selectAll');
  $('changesContextCompare').onclick = () => postChangeContextAction('compare');
  $('changesContextUpload').onclick = () => postChangeContextAction('upload');
  $('changesContextDownload').onclick = () => postChangeContextAction('download');
  $('changesContextUseLocal').onclick = () => postChangeContextAction('useLocal');
  $('changesContextUseRemote').onclick = () => postChangeContextAction('useRemote');
  $('changesContextSkip').onclick = () => postChangeContextAction('skip');
  $('activityContextCopySelected').onclick = () => {
    const text = activeActivitySelectionText;
    closeActivityContextMenu();
    void copyTextFromContextMenu(text);
  };
  $('activityContextCopyAll').onclick = () => { closeActivityContextMenu(); post('copyActivity'); };
  $('activityContextClear').onclick = () => { closeActivityContextMenu(); post('clearActivity'); };

  document.addEventListener('contextmenu', event => {
    const editable = getTextEditableTarget(event.target);
    if (editable) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showTextEditContextMenu(editable, event.clientX, event.clientY);
      return;
    }
    const row = event.target instanceof Element ? event.target.closest('[data-change-path]') : null;
    if (row) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const relativePath = String(row.getAttribute('data-change-path') || '');
      const targetId = String(row.getAttribute('data-target-id') || '');
      const entry = findCurrentChange(targetId, relativePath);
      if (entry && !operationActive && !interactionActive && entryCanOperate(entry)) {
        showChangesContextMenu(entry, event.clientX, event.clientY);
      } else {
        closeChangesContextMenu();
      }
      return;
    }
    const activityLogTarget = event.target instanceof Element ? event.target.closest('#activityLog') : null;
    if (activityLogTarget) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showActivityContextMenu(event.clientX, event.clientY);
      return;
    }
    event.preventDefault();
    hideTextEditContextMenu();
    closeChangesContextMenu();
    closeActivityContextMenu();
  }, true);

  document.addEventListener('pointerdown', event => {
    const textMenu = $('textEditContextMenu');
    const changesContextMenu = $('changesContextMenu');
    const activityContextMenu = $('activityContextMenu');
    if (textMenu?.classList.contains('visible') && !textMenu.contains(event.target)) hideTextEditContextMenu();
    if (changesContextMenu?.classList.contains('visible') && !changesContextMenu.contains(event.target)) closeChangesContextMenu();
    if (activityContextMenu?.classList.contains('visible') && !activityContextMenu.contains(event.target)) closeActivityContextMenu();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const textVisible = $('textEditContextMenu')?.classList.contains('visible');
    const changesVisible = $('changesContextMenu')?.classList.contains('visible');
    const activityVisible = $('activityContextMenu')?.classList.contains('visible');
    if (!textVisible && !changesVisible && !activityVisible) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    hideTextEditContextMenu();
    closeChangesContextMenu();
    closeActivityContextMenu();
  }, true);

  window.addEventListener('scroll', () => {
    hideWebviewTooltip();
    hideTextEditContextMenu();
    closeChangesContextMenu();
    closeActivityContextMenu();
  }, true);
  window.addEventListener('resize', () => {
    hideWebviewTooltip();
    hideTextEditContextMenu();
    closeChangesContextMenu();
    closeActivityContextMenu();
  });
  document.addEventListener('pointerdown', event => {
    if ($('changesMenu').hidden) return;
    if ($('changesMenu').contains(event.target) || $('changesMore').contains(event.target)) return;
    closeChangesMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || $('changesMenu').hidden) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    closeChangesMenu();
  }, true);
  document.querySelectorAll('[data-option-help]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (optionHelpAnchor === button && !$('optionHelpPopover').hidden) closeOptionHelp();
      else showOptionHelp(button);
    });
  });
  document.addEventListener('pointerdown', event => {
    if ($('optionHelpPopover').hidden) return;
    if ($('optionHelpPopover').contains(event.target) || optionHelpAnchor?.contains(event.target)) return;
    closeOptionHelp();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || $('optionHelpPopover').hidden) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    closeOptionHelp();
  }, true);
  window.addEventListener('resize', () => {
    positionDirectionHelpButton();
    positionIgnoreHelpButton();
    positionOptionHelp();
  });
  $('mappingDialogBody').addEventListener('scroll', () => {
    positionDirectionHelpButton();
    positionIgnoreHelpButton();
    positionOptionHelp();
  });
  $('mapDirection').onchange = () => refreshDirectionalOptionAvailability();
  $('mapLocal').addEventListener('input', updateMappingValidation);
  $('mapLocal').addEventListener('change', updateMappingValidation);
  $('pickLocal').onclick = () => post('pickLocalRoot', { current: $('mapLocal').value });
  $('addTarget').onclick = () => { editingTargets.push(newTarget()); renderTargetEditor(); };
  $('cancelMapping').onclick = () => { closeOptionHelp(); closeDialog('mappingDialog'); };
  $('saveMapping').onclick = () => {
    document.querySelectorAll('[data-ti]').forEach(element => {
      const index = Number(element.dataset.ti);
      const field = element.dataset.f;
      editingTargets[index][field] = field === 'enabled' ? element.checked : element.value;
    });
    if (!updateMappingValidation()) return;
    post('saveMapping', {
      mapping: {
        id: editingMappingId,
        name: $('mapName').value,
        localRoot: $('mapLocal').value,
        targets: editingTargets,
        options: {
          direction: $('mapDirection').value,
          ignorePatterns: $('mapIgnore').value.split(/\\r?\\n/),
          conflictProtection: $('optConflict').checked,
          atomicTransfer: $('optAtomic').checked,
          propagateDeletes: $('optDeletes').checked,
          uploadOnSave: $('optUploadSave').checked,
          watchLocalChanges: $('optWatch').checked,
          watchRemoteChanges: $('optWatchRemote').checked
        }
      }
    });
    $('mappingError').textContent = '';
  };
  $('deleteMapping').onclick = () => {
    if (editingMappingId) {
      post('deleteMapping', { mappingId: editingMappingId });
    }
  };

  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'state') {
      const stateSequence = Number(message.stateSequence || 0);
      if (stateSequence && stateSequence < latestStateSequence) return;
      if (stateSequence) latestStateSequence = stateSequence;
      const changedTarget = state.activeMappingId !== message.state.activeMappingId || state.activeTargetId !== message.state.activeTargetId;
      adoptState(message.state);
      pruneAllEnabledSelections();
      if (changedTarget) {
        pendingResolutionRequests.clear();
        syncPreviewRequested = false;
      }
      const validSelectionKeys = new Set(currentChangeEntries()
        .filter(entry => entry.status !== 'same' && entryCanOperate(entry))
        .map(entry => changeKey(entry.targetId, entry.relativePath)));
      selected = changedTarget
        ? new Set()
        : new Set([...selected].filter(key => validSelectionKeys.has(key)));
      render();
    } else if (message.type === 'resolutionState') {
      const relativePath = String(message.relativePath || '');
      const targetId = String(message.targetId || '');
      const key = changeKey(targetId, relativePath);
      const requestId = Number(message.requestId || 0);
      if (requestId && pendingResolutionRequests.get(key) !== requestId) return;
      pendingResolutionRequests.delete(key);
      const mappingMatches = String(message.mappingId || '') === String(state.activeMappingId || '');
      const belongsToActiveView = mappingMatches && (isAllEnabledSelected()
        ? enabledTargets().some(target => target.id === targetId)
        : targetId === String(state.activeTargetId || ''));
      const stateSequence = Number(message.stateSequence || 0);
      if (belongsToActiveView && (!stateSequence || stateSequence >= latestStateSequence)) {
        if (stateSequence) latestStateSequence = stateSequence;
        adoptState(message.state);
        updateResolutionControls(targetId, relativePath);
        updateSyncAvailability();
      }
      if (!pendingResolutionRequests.size && syncPreviewRequested && belongsToActiveView) openPreview();
    } else if (message.type === 'clearSelection') {
      selected.clear();
      renderChanges();
    } else if (message.type === 'interactionState') {
      interactionActive = Boolean(message.active);
      updateMappingValidation();
      $('deleteMapping').disabled = interactionActive;
      render();
    } else if (message.type === 'mappingSaved') {
      closeOptionHelp();
      closeDialog('mappingDialog');
    } else if (message.type === 'localRootPicked') {
      $('mapLocal').value = message.value;
      updateMappingValidation();
    } else if (message.type === 'error') {
      $('mappingError').textContent = message.message;
    } else if (message.type === 'operationState') {
      updateOperationState(message.active, message.label, message.kind, message.operationId, message.cancelling, message.cancellable);
    } else if (message.type === 'backgroundOperationState') {
      backgroundOperation = message.active ? {
        active: true,
        kind: String(message.kind || ''),
        label: String(message.label || 'Working...'),
        detail: String(message.detail || ''),
        mappingId: String(message.mappingId || '')
      } : null;
      renderOperationStatus();
    } else if (message.type === 'operationProgress') {
      updateOperationProgress(message.progress, message.operationId);
    }
  });

  post('ready');
})();
`;
}
