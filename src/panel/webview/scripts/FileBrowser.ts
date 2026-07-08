export function renderFileBrowser(): string {
  return `    const updatePath = normalizeUiRemotePath(payload.path || '/');
    const currentDirectory = normalizeUiRemotePath(currentPath.value || '/');
    if (updatePath !== currentDirectory) return;

    const updates = Array.isArray(payload.updates) ? payload.updates : [];
    if (!updates.length) return;

    const updatesByPath = new Map();
    updates.forEach(update => {
      const path = normalizeUiRemotePath(update && update.path || '');
      const modifyTime = Number(update && update.modifyTime || 0);
      if (path && modifyTime > 0) updatesByPath.set(path, modifyTime);
    });
    if (!updatesByPath.size) return;

    let changed = false;
    currentEntries.forEach(entry => {
      const entryPath = normalizeUiRemotePath(entry && entry.path || '');
      const modifyTime = updatesByPath.get(entryPath);
      if (modifyTime && Number(entry.modifyTime || 0) !== modifyTime) {
        entry.modifyTime = modifyTime;
        changed = true;
      }
    });

    if (!changed) return;

    updatesByPath.forEach((modifyTime, path) => {
      const row = entriesBody.querySelector('tr.entry-row[data-entry-path="' + cssEscape(path) + '"]');
      if (!row) return;
      const modifiedCell = row.querySelector('td.modified');
      if (modifiedCell) modifiedCell.textContent = formatDate(modifyTime);
    });
  }

  function listDirectory(path, options = {}) {
    if (!activeConnectionId || busy) return;
    saveActiveFileListSnapshot();
    if (options.forceRefresh) markFileListSnapshotStale(activeConnectionId);
    setBusy(true, 'Loading ' + path + '...');
    vscode.postMessage({ type: 'listDirectory', payload: { path, forceRefresh: Boolean(options.forceRefresh) } });
  }

  function openPath(path) {
    if (!activeConnectionId || busy) return;
    setBusy(true, 'Opening ' + path + '...');
    vscode.postMessage({ type: 'openPath', payload: { path } });
  }



  function normalizeNavigationHistoryState(value) {
    const entries = Array.isArray(value && value.entries)
      ? value.entries.map(entry => normalizeUiRemotePath(entry || '/')).filter(Boolean)
      : [];
    if (!entries.length) return { entries: [], index: -1 };
    const index = Math.max(0, Math.min(entries.length - 1, Number.isFinite(Number(value.index)) ? Number(value.index) : entries.length - 1));
    return { entries, index };
  }

  function restoreNavigationHistoryFromState(value) {
    if (!value || typeof value !== 'object') return;
    const source = value.navigationHistoryByConnectionId && typeof value.navigationHistoryByConnectionId === 'object'
      ? value.navigationHistoryByConnectionId
      : value;
    for (const [connectionId, rawState] of Object.entries(source)) {
      if (!connectionId) continue;
      const normalizedState = normalizeNavigationHistoryState(rawState);
      if (normalizedState.index >= 0) {
        navigationHistoryByConnectionId.set(connectionId, normalizedState);
      }
    }
  }

  function serializeNavigationHistory() {
    const serialized = {};
    for (const [connectionId, state] of navigationHistoryByConnectionId.entries()) {
      const normalizedState = normalizeNavigationHistoryState(state);
      if (normalizedState.index >= 0) {
        serialized[connectionId] = normalizedState;
      }
    }
    return serialized;
  }

  function persistNavigationHistory() {
    const historyState = { navigationHistoryByConnectionId: serializeNavigationHistory() };
    vscode.setState(Object.assign({}, vscode.getState() || {}, historyState));
    try {
      localStorage.setItem(NAVIGATION_HISTORY_STORAGE_KEY, JSON.stringify(historyState));
    } catch (_) {
      // Ignore storage failures. vscode.setState still preserves the history while this webview is alive.
    }
  }

  function getNavigationHistoryState(connectionId) {
    const id = connectionId || activeConnectionId;
    if (!id) return { entries: [], index: -1 };
    let state = navigationHistoryByConnectionId.get(id);
    if (!state) {
      state = { entries: [], index: -1 };
      navigationHistoryByConnectionId.set(id, state);
    }
    return state;
  }



  function initializeNavigationHistoryForActiveSession() {
    const active = getActiveSession();
    if (!active || !active.currentPath) return;
    const state = getNavigationHistoryState(active.id || activeConnectionId);
    if (state.index >= 0) return;
    state.entries = [normalizeUiRemotePath(active.currentPath || '/')];
    state.index = 0;
    persistNavigationHistory();
  }

  function pruneNavigationHistoryForSessions() {
    const activeIds = new Set(sessions.map(session => session.id).filter(Boolean));
    let changed = false;
    for (const id of Array.from(navigationHistoryByConnectionId.keys())) {
      if (!activeIds.has(id)) {
        navigationHistoryByConnectionId.delete(id);
        changed = true;
      }
    }
    if (changed) persistNavigationHistory();
  }

  function recordNavigationHistory(path, mode) {
    if (!activeConnectionId) return;
    const normalizedPath = normalizeUiRemotePath(path || '/');
    const state = getNavigationHistoryState(activeConnectionId);

    if (mode === 'back' || mode === 'forward') {
      persistNavigationHistory();
      updateRemotePathNavigationControls();
      return;
    }

    if (state.entries[state.index] === normalizedPath) {
      updateRemotePathNavigationControls();
      return;
    }

    if (state.index < state.entries.length - 1) {
      state.entries = state.entries.slice(0, state.index + 1);
    }

    state.entries.push(normalizedPath);
    state.index = state.entries.length - 1;
    persistNavigationHistory();
    updateRemotePathNavigationControls();
  }

  function updateRemotePathNavigationControls() {
    const hasActiveSession = Boolean(activeConnectionId);
    const state = hasActiveSession ? getNavigationHistoryState(activeConnectionId) : { entries: [], index: -1 };
    if (remotePathBackButton) {
      remotePathBackButton.disabled = busy || !hasActiveSession || state.index <= 0;
    }
    if (remotePathForwardButton) {
      remotePathForwardButton.disabled = busy || !hasActiveSession || state.index < 0 || state.index >= state.entries.length - 1;
    }
  }

  function navigateRemotePathHistory(direction) {
    if (!activeConnectionId || busy) return;
    const state = getNavigationHistoryState(activeConnectionId);
    const nextIndex = direction === 'back' ? state.index - 1 : state.index + 1;
    if (nextIndex < 0 || nextIndex >= state.entries.length) return;

    state.index = nextIndex;
    persistNavigationHistory();
    pendingNavigationHistoryMode = direction;
    listDirectory(state.entries[nextIndex]);
    updateRemotePathNavigationControls();
  }

  function copyRemotePath(path) {
    if (!activeConnectionId || busy) return;
    vscode.postMessage({ type: 'copyRemotePath', payload: { path } });
  }

  function cancelPendingFilterApply() {
    if (!pendingFilterApplyTimer) return;
    window.clearTimeout(pendingFilterApplyTimer);
    pendingFilterApplyTimer = 0;
  }

  function clearFilterText() {
    cancelPendingFilterApply();
    filterText = '';
    filterInput.value = '';
    updateFilterClearButton();
  }

  function updateFilterStateFromInput() {
    filterText = filterInput.value.trim().toLowerCase();
    updateFilterClearButton();
    const visibleEntries = getVisibleEntries();
    const visibleEntryPaths = new Set(visibleEntries.map(entry => entry.path || entry.name));
    selectedEntryPaths = new Set(Array.from(selectedEntryPaths).filter(entryPath => visibleEntryPaths.has(entryPath)));
    if (selectedEntryPath && !selectedEntryPaths.has(selectedEntryPath)) {
      selectedEntryPath = Array.from(selectedEntryPaths).pop() || '';
    }
    return visibleEntries;
  }

  function applyFilterInput() {
    cancelPendingFilterApply();
    renderEntries(updateFilterStateFromInput());
  }

  function scheduleFilterInputApply() {
    updateFilterClearButton();
    cancelPendingFilterApply();
    pendingFilterApplyTimer = window.setTimeout(() => {
      pendingFilterApplyTimer = 0;
      renderEntries(updateFilterStateFromInput());
    }, FILE_FILTER_DEBOUNCE_MS);
  }

  function flushPendingFilterInputWithoutRender() {
    if (!pendingFilterApplyTimer) return;
    cancelPendingFilterApply();
    updateFilterStateFromInput();
  }

  function updateFilterClearButton() {
    const hasValue = Boolean(filterInput.value);
    filterBox.classList.toggle('has-value', hasValue);
    clearFilterButton.disabled = filterInput.disabled || !hasValue;
  }

  function scrollEntriesToTop() {
    entriesTableWrap.scrollTop = 0;
    entriesTableWrap.scrollLeft = 0;
  }

  function cloneFileListEntries(entries) {
    return Array.isArray(entries) ? entries.map(entry => Object.assign({}, entry || {})) : [];
  }

  function getFileListSnapshot(connectionId) {
    const id = String(connectionId || '').trim();
    return id ? fileListSnapshotsByConnectionId.get(id) : undefined;
  }

  function saveFileListSnapshot(connectionId, options = {}) {
    const id = String(connectionId || activeConnectionId || '').trim();
    if (!id) return;
    const path = normalizeUiRemotePath((currentPath && currentPath.value) || '/');
    const existing = fileListSnapshotsByConnectionId.get(id) || {};
    fileListSnapshotsByConnectionId.set(id, {
      path,
      entries: cloneFileListEntries(currentEntries),
      filterText,
      filterInputValue: filterInput ? String(filterInput.value || '') : filterText,
      currentSort: Object.assign({}, currentSort || { key: '', direction: '' }),
      selectedEntryPath,
      selectedEntryPaths: Array.from(selectedEntryPaths || []),
      selectionAnchorPath,
      scrollTop: entriesTableWrap ? Number(entriesTableWrap.scrollTop || 0) : 0,
      scrollLeft: entriesTableWrap ? Number(entriesTableWrap.scrollLeft || 0) : 0,
      stale: Object.prototype.hasOwnProperty.call(options, 'stale') ? Boolean(options.stale) : Boolean(existing.stale),
      loaded: Object.prototype.hasOwnProperty.call(options, 'loaded') ? Boolean(options.loaded) : Boolean(existing.loaded),
      updatedAt: Date.now()
    });
  }

  function saveDirectoryPayloadSnapshot(connectionId, path, entries, options = {}) {
    const id = String(connectionId || '').trim();
    if (!id) return;
    const existing = fileListSnapshotsByConnectionId.get(id) || {};
    fileListSnapshotsByConnectionId.set(id, {
      path: normalizeUiRemotePath(path || '/'),
      entries: cloneFileListEntries(entries),
      filterText: String(existing.filterText || ''),
      filterInputValue: String(existing.filterInputValue || existing.filterText || ''),
      currentSort: Object.assign({ key: '', direction: '' }, existing.currentSort || {}),
      selectedEntryPath: '',
      selectedEntryPaths: [],
      selectionAnchorPath: '',
      scrollTop: 0,
      scrollLeft: 0,
      stale: Object.prototype.hasOwnProperty.call(options, 'stale') ? Boolean(options.stale) : false,
      loaded: true,
      updatedAt: Date.now()
    });
  }

  function saveActiveFileListSnapshot(options = {}) {
    saveFileListSnapshot(activeConnectionId, options);
  }

  function markFileListSnapshotStale(connectionId) {
    const id = String(connectionId || activeConnectionId || '').trim();
    if (!id) return;
    const existing = fileListSnapshotsByConnectionId.get(id);
    if (existing) {
      existing.stale = true;
      existing.updatedAt = Date.now();
      fileListSnapshotsByConnectionId.set(id, existing);
      return;
    }
    saveFileListSnapshot(id, { stale: true });
  }

  function invalidateFileListSnapshot(connectionId) {
    const id = String(connectionId || '').trim();
    if (id) fileListSnapshotsByConnectionId.delete(id);
  }

  function pruneFileListSnapshotsForSessions() {
    const activeIds = new Set(sessions.map(session => session.id).filter(Boolean));
    for (const id of Array.from(fileListSnapshotsByConnectionId.keys())) {
      if (!activeIds.has(id)) fileListSnapshotsByConnectionId.delete(id);
    }
  }

  function restoreFileListSnapshotForConnection(connectionId, options = {}) {
    const id = String(connectionId || '').trim();
    const snapshot = getFileListSnapshot(id);
    if (!snapshot || !snapshot.loaded || !Array.isArray(snapshot.entries)) return false;

    currentEntries = cloneFileListEntries(snapshot.entries);
    currentPath.value = normalizeUiRemotePath(snapshot.path || '/');
    filterText = String(snapshot.filterText || '');
    if (filterInput) filterInput.value = String(snapshot.filterInputValue || snapshot.filterText || '');
    updateFilterClearButton();
    currentSort = Object.assign({ key: '', direction: '' }, snapshot.currentSort || {});
    selectedEntryPath = String(snapshot.selectedEntryPath || '');
    selectedEntryPaths = new Set(Array.isArray(snapshot.selectedEntryPaths) ? snapshot.selectedEntryPaths : []);
    selectionAnchorPath = String(snapshot.selectionAnchorPath || '');
    hideContextMenu();
    renderEntries(getVisibleEntries());
    if (entriesTableWrap) {
      const scrollTop = Number(snapshot.scrollTop || 0);
      const scrollLeft = Number(snapshot.scrollLeft || 0);
      window.requestAnimationFrame(() => {
        entriesTableWrap.scrollTop = scrollTop;
        entriesTableWrap.scrollLeft = scrollLeft;
      });
    }
    updateActiveSessionPath(currentPath.value || '/');
    updateConnectionViewUi();
    updatePathFavoriteControls();
    if (pathFavoritesOpen) renderPathFavoritesPopover();
    setFilesLoadedStatusForConnection(id, currentEntries);
    if (options.updateStatus !== false) restoreFilesStatusForActiveConnection();
    return !snapshot.stale;
  }

  function invalidateActiveFileListSnapshotForMutation() {
    markFileListSnapshotStale(activeConnectionId);
  }

  function renderEntries(entries) {
    updateFileListPlatformColumns();
    const renderGeneration = ++entriesRenderGeneration;
    const renderStart = performance.now();
    entriesBody.innerHTML = '';

    if (!entries.length) {
      const message = filterText ? 'No items match the current filter.' : 'This folder is empty.';
      renderEntriesEmptyMessage(message);
      postRenderPerformance(entries.length, performance.now() - renderStart);
      return;
    }

    if (entries.length <= ENTRY_RENDER_DIRECT_THRESHOLD) {
      const fragment = document.createDocumentFragment();
      for (const entry of entries) {
        fragment.appendChild(createEntryRow(entry));
      }
      entriesBody.appendChild(fragment);
      postRenderPerformance(entries.length, performance.now() - renderStart);
      return;
    }

    let index = 0;

    const renderNextChunk = () => {
      if (renderGeneration !== entriesRenderGeneration) {
        return;
      }

      const fragment = document.createDocumentFragment();
      const end = Math.min(index + ENTRY_RENDER_CHUNK_SIZE, entries.length);

      for (; index < end; index += 1) {
        fragment.appendChild(createEntryRow(entries[index]));
      }

      entriesBody.appendChild(fragment);

      if (index < entries.length) {
        scheduleEntryRenderChunk(renderNextChunk);
        return;
      }

      postRenderPerformance(entries.length, performance.now() - renderStart);
    };

    renderNextChunk();
  }

  function scheduleEntryRenderChunk(callback) {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => callback());
      return;
    }

    window.setTimeout(callback, 0);
  }

  function createEntryRow(entry) {
    const row = document.createElement('tr');
    const entryKey = entry.path || entry.name;
    row.className = 'entry-row' + (selectedEntryPaths.has(entryKey) ? ' selected' : '');
    row.dataset.entryPath = entryKey;
    if (!isParentEntry(entry)) row.draggable = true;
    const showOwnership = shouldShowPosixOwnership();
    const showPermissions = shouldShowPosixPermissions();
    const posixCells = showOwnership || showPermissions
      ? (showOwnership
          ? '<td class="owner">' + escapeHtml(formatMetadata(entry.owner)) + '</td>' +
            '<td class="group">' + escapeHtml(formatMetadata(entry.group)) + '</td>'
          : '<td class="owner"></td><td class="group"></td>') +
        (showPermissions
          ? '<td class="permissions">' + escapeHtml(formatPermissionsForDisplay(entry.permissions)) + '</td>'
          : '<td class="permissions"></td>')
      : '';

    row.innerHTML = '<td><div class="entry-name"><span class="entry-icon">' + iconFor(entry) + '</span><span class="entry-text" data-entry-name-action="open">' + escapeHtml(formatEntryName(entry)) + '</span></div></td>' +
      '<td class="type">' + escapeHtml(formatEntryType(entry)) + '</td>' +
      '<td class="size">' + (isDirectoryLike(entry) ? '' : formatSize(entry.size)) + '</td>' +
      posixCells +
      '<td class="modified">' + formatDate(entry.modifyTime) + '</td>';

    return row;
  }

  function getEntryRowFromEvent(event) {
    if (!(event && event.target instanceof Element)) return null;
    return event.target.closest('tr.entry-row');
  }

  function findCurrentEntryByPath(entryPath) {
    const normalizedPath = String(entryPath || '');
    if (!normalizedPath) return null;
    return currentEntries.find(entry => String(entry.path || entry.name || '') === normalizedPath) || null;
  }

  function handleEntryRowClick(event) {
    const row = getEntryRowFromEvent(event);
    if (!row) return;
    const entryKey = row.dataset.entryPath || '';
    const entry = findCurrentEntryByPath(entryKey);
    if (!entry) return;

    const isNameOpenAction = event.target instanceof Element && event.target.closest('[data-entry-name-action="open"]');
    if (isNameOpenAction && openFileListItemsOnNameClick && !(event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)) {
      event.preventDefault();
      event.stopPropagation();
      hideContextMenu();
      if (event.detail > 1) return;
      selectEntry(entryKey);
      vscode.postMessage({ type: 'openEntry', payload: entry });
      return;
    }

    hideContextMenu();

    if (isParentEntry(entry)) {
      selectEntry(entryKey);
      return;
    }

    if (event.shiftKey && selectionAnchorPath) {
      selectEntryRange(selectionAnchorPath, entryKey);
    } else if (event.metaKey || event.ctrlKey) {
      toggleEntrySelection(entryKey);
    } else {
      selectEntry(entryKey);
    }
  }

  function handleEntryRowDoubleClick(event) {
    const row = getEntryRowFromEvent(event);
    if (!row) return;
    const entryKey = row.dataset.entryPath || '';
    const entry = findCurrentEntryByPath(entryKey);
    if (!entry) return;

    const isNameOpenAction = event.target instanceof Element && event.target.closest('[data-entry-name-action="open"]');
    if (isNameOpenAction && openFileListItemsOnNameClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    hideContextMenu();
    vscode.postMessage({ type: 'openEntry', payload: entry });
  }

  function handleEntryRowContextMenu(event) {
    const row = getEntryRowFromEvent(event);
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();

    const entryKey = row.dataset.entryPath || '';
    const entry = findCurrentEntryByPath(entryKey);
    if (!entry) return;

    hideContextMenu();
    if (!selectedEntryPaths.has(entryKey)) {
      selectEntry(entryKey);
    } else {
      selectedEntryPath = entryKey;
    }
    if (!isParentEntry(entry)) {
      showContextMenu(entry, event.clientX, event.clientY);
    }
  }

  function postRenderPerformance(itemCount, renderMs) {
    vscode.postMessage({
      type: 'performanceLog',
      payload: {
        message: 'renderEntries',
        items: itemCount,
        renderMs: renderMs
      }
    });
  }

  function selectEntry(entryPath) {
    selectedEntryPaths = new Set([entryPath]);
    selectedEntryPath = entryPath;
    selectionAnchorPath = entryPath;
    syncSelectedRows();
  }

  function toggleEntrySelection(entryPath) {
    if (selectedEntryPaths.has(entryPath)) {
      selectedEntryPaths.delete(entryPath);
      if (selectedEntryPath === entryPath) {
        selectedEntryPath = Array.from(selectedEntryPaths).pop() || '';
      }
    } else {
      selectedEntryPaths.add(entryPath);
      selectedEntryPath = entryPath;
      selectionAnchorPath = entryPath;
    }

    syncSelectedRows();
  }

  function selectEntryRange(anchorPath, targetPath) {
    const visibleEntries = getVisibleEntries().filter(entry => !isParentEntry(entry));
    const visiblePaths = visibleEntries.map(entry => entry.path || entry.name);
    const anchorIndex = visiblePaths.indexOf(anchorPath);
    const targetIndex = visiblePaths.indexOf(targetPath);

    if (anchorIndex === -1 || targetIndex === -1) {
      selectEntry(targetPath);
      return;
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    selectedEntryPaths = new Set(visiblePaths.slice(start, end + 1));
    selectedEntryPath = targetPath;
    syncSelectedRows();
  }

  function syncSelectedRows() {
    for (const row of entriesBody.querySelectorAll('tr.entry-row')) {
      const entryPath = row.dataset.entryPath || '';
      row.classList.toggle('selected', selectedEntryPaths.has(entryPath));
    }
    updateTransferButtons();
  }

  function clearEntrySelection() {
    selectedEntryPath = '';
    selectedEntryPaths.clear();
    selectionAnchorPath = '';
    syncSelectedRows();
  }

  function showContextMenu(entry, clientX, clientY) {
    if (busy || !activeConnectionId) return;

    const selectedEntries = getSelectedActionEntries();
    setEntryContextActionsVisible(selectedEntries);
    hideRemoteSearchResultContextMenu();
    hideTextEditContextMenu();
    entryContextMenu.classList.add('visible');
    entryContextMenu.style.left = '0px';
    entryContextMenu.style.top = '0px';

    const menuRect = entryContextMenu.getBoundingClientRect();
    const left = Math.min(clientX, Math.max(0, window.innerWidth - menuRect.width - 8));
    const top = Math.min(clientY, Math.max(0, window.innerHeight - menuRect.height - 8));
    entryContextMenu.style.left = left + 'px';
    entryContextMenu.style.top = top + 'px';
  }

  function setRemoteSearchContextActionVisible(element, visible) {
    if (element) element.style.display = visible ? '' : 'none';
  }

  function showRemoteSearchResultContextMenu(path, kind, clientX, clientY) {
    if (!activeConnectionId || !remoteSearchResultContextMenu) return;
    const normalizedPath = path ? normalizeUiRemotePath(path) : '';
    const normalizedKind = kind === 'directory' ? 'directory' : (normalizedPath ? 'file' : '');
    const hasPath = Boolean(normalizedPath);
    const isDirectory = normalizedKind === 'directory';
    const hasResults = Array.isArray(remoteSearchState.results) && remoteSearchState.results.length > 0;

    remoteSearchContextPath = normalizedPath;
    remoteSearchContextKind = normalizedKind;

    setRemoteSearchContextActionVisible(remoteSearchContextOpen, hasPath && !isDirectory);
    setRemoteSearchContextActionVisible(remoteSearchContextOpenReadOnly, hasPath && !isDirectory);
    setRemoteSearchContextActionVisible(remoteSearchContextFileSeparator, hasPath && !isDirectory);
    setRemoteSearchContextActionVisible(remoteSearchContextCopyPath, hasPath);
    setRemoteSearchContextActionVisible(remoteSearchContextCopyName, hasPath);
    setRemoteSearchContextActionVisible(remoteSearchContextResultsSeparator, hasPath && hasResults);
    setRemoteSearchContextActionVisible(remoteSearchContextCopyResults, hasResults);

    if (!hasPath && !hasResults) return;

    hideContextMenu();
    hideTextEditContextMenu();
    remoteSearchResultContextMenu.classList.add('visible');
    remoteSearchResultContextMenu.style.left = '0px';
    remoteSearchResultContextMenu.style.top = '0px';

    const menuRect = remoteSearchResultContextMenu.getBoundingClientRect();
    const left = Math.min(clientX, Math.max(0, window.innerWidth - menuRect.width - 8));
    const top = Math.min(clientY, Math.max(0, window.innerHeight - menuRect.height - 8));
    remoteSearchResultContextMenu.style.left = left + 'px';
    remoteSearchResultContextMenu.style.top = top + 'px';
  }

  function hideRemoteSearchResultContextMenu() {
    remoteSearchContextPath = '';
    remoteSearchContextKind = '';
    if (remoteSearchResultContextMenu) remoteSearchResultContextMenu.classList.remove('visible');
  }

  function getRemotePathBasename(path) {
    const normalized = normalizeUiRemotePath(path || '/');
    if (normalized === '/') return '/';
    const trimmed = normalized.replace(new RegExp('/+$'), '');
    const index = trimmed.lastIndexOf('/');
    return index >= 0 ? trimmed.slice(index + 1) : trimmed;
  }

  function getRemoteSearchContextEntry() {
    const path = normalizeUiRemotePath(remoteSearchContextPath || '');
    if (!path) return null;
    return {
      path,
      name: getRemotePathBasename(path),
      type: remoteSearchContextKind === 'directory' ? 'directory' : 'file',
      effectiveType: remoteSearchContextKind === 'directory' ? 'directory' : 'file',
      linkTarget: '',
      permissions: ''
    };
  }

  function setEntryContextActionsVisible(entries) {
    const selectedEntries = Array.isArray(entries) ? entries : [];
    const hasEntryActions = selectedEntries.length > 0;
    const isSingleEntry = selectedEntries.length === 1;
    const selectedTypes = selectedEntries.map(entry => getEffectiveEntryType(entry));
    const hasDirectory = selectedTypes.includes('directory');
    const allDirectories = hasEntryActions && selectedTypes.every(type => type === 'directory');
    const allFiles = hasEntryActions && selectedEntries.every(entry => getEffectiveEntryType(entry) === 'file' || entry.type === 'link');
    const isSingleDirectory = isSingleEntry && allDirectories;
    const isSingleFile = isSingleEntry && allFiles;
    const isMixedSelection = hasEntryActions && !allDirectories && !allFiles;
    const capabilities = getActiveRemoteCapabilities();
    const canOpen = isSingleDirectory || allFiles;
    const canOpenReadOnly = allFiles;
    const canCompare = selectedEntries.length === 2 && allFiles;
    const canMakeCopy = isSingleFile && selectedEntries[0].type === 'file';
    const canRename = isSingleEntry;
    const canCutRemote = hasEntryActions;
    const canPasteRemote = Boolean(activeConnectionId)
      && remoteClipboardState
      && remoteClipboardState.canPaste
      && (!remoteClipboardState.connectionId || remoteClipboardState.connectionId === activeConnectionId)
      && (!hasEntryActions || isSingleDirectory || isSingleFile);
    const currentContextDirectory = getCurrentContextDirectory();
    const selectedDirectoryTarget = isSingleDirectory ? normalizeUiRemotePath(selectedEntries[0].path || currentContextDirectory) : '';
    const canPasteHereRemote = canPasteRemote && canPasteRemoteToDirectory(currentContextDirectory);
    const canPasteIntoFolderRemote = canPasteRemote && isSingleDirectory && canPasteRemoteToDirectory(selectedDirectoryTarget);
    const canCopy = hasEntryActions;
    const canCompress = hasEntryActions && capabilities.canCreateArchive;
    const canCalculateChecksums = canMakeCopy && capabilities.canCalculateServerChecksums;
    const canShowProperties = isSingleEntry;
    const canChangePermissions = hasEntryActions && capabilities.canChangePermissions;
    const canChangeOwnerGroup = hasEntryActions && capabilities.canChangeOwnerGroup;
    const hasCurrentDirectoryActions = Boolean(activeConnectionId) && !hasEntryActions;
    const canCreateInContext = hasCurrentDirectoryActions || isSingleDirectory;
    const canRefresh = Boolean(activeConnectionId);
    const canRunRemoteCommand = Boolean(activeConnectionId) && capabilities.canRunCommand;
    const canOpenSshTerminal = Boolean(activeConnectionId) && capabilities.canOpenSshTerminal;
    const canOpenLogViewer = Boolean(activeConnectionId) && capabilities.canFollowLogFiles && (!hasEntryActions || isSingleFile);
    const canUpload = Boolean(activeConnectionId) && !hasEntryActions;
    const canCopyCurrentPath = Boolean(activeConnectionId) && !hasEntryActions;
    const canDownload = hasEntryActions;
    const canUploadWithEntryActions = Boolean(activeConnectionId) && canDownload;
    const hasTransferActions = canDownload || canUploadWithEntryActions;
    const hasItemToolActions = canCompress || canCalculateChecksums || canShowProperties || canChangePermissions || canChangeOwnerGroup;
    const canDelete = hasEntryActions;

    contextOpen.style.display = canOpen ? '' : 'none';
    contextOpen.textContent = isSingleDirectory
      ? 'Enter Directory'
      : (isSingleEntry && selectedEntries[0].type === 'link' ? 'Open Link' : 'View/Edit');
    contextOpenReadOnly.style.display = canOpenReadOnly ? '' : 'none';
    contextCompare.style.display = canCompare ? '' : 'none';

    contextOpenSeparator.style.display = (canOpen || canOpenReadOnly || canCompare) && (canMakeCopy || canRename || canCutRemote || canPasteHereRemote || canPasteIntoFolderRemote || canCopy || canCompress || canDownload || canRefresh || canDelete) ? '' : 'none';

    contextMakeCopy.style.display = canMakeCopy ? '' : 'none';
    contextRename.style.display = canRename ? '' : 'none';

    if (contextCutRemote) contextCutRemote.style.display = canCutRemote ? '' : 'none';
    if (contextPasteRemoteHere) contextPasteRemoteHere.style.display = canPasteHereRemote ? '' : 'none';
    if (contextPasteRemote) contextPasteRemote.style.display = canPasteIntoFolderRemote ? '' : 'none';
    if (contextPasteRemote) contextPasteRemote.textContent = 'Paste Into This Folder';
    if (contextRemoteClipboardSeparator) contextRemoteClipboardSeparator.style.display = (canCutRemote || canPasteHereRemote || canPasteIntoFolderRemote) && (canMakeCopy || canRename || canOpen || canOpenReadOnly || canCompare) ? '' : 'none';

    contextCopySeparator.style.display = canCopy && (canMakeCopy || canRename || canCutRemote || canPasteHereRemote || canPasteIntoFolderRemote || canOpen || canOpenReadOnly || canCompare) ? '' : 'none';
    contextCopyPath.style.display = canCopy ? '' : 'none';
    contextCopyName.style.display = canCopy ? '' : 'none';
    contextCompressSubmenu.style.display = canCompress ? '' : 'none';

    contextCopyPath.textContent = selectedEntries.length > 1 ? 'Copy Paths' : 'Copy Path';
    if (selectedEntries.length > 1) {
      contextCopyName.textContent = isMixedSelection ? 'Copy Names' : allDirectories ? 'Copy Directory Names' : 'Copy Filenames';
    } else {
      contextCopyName.textContent = isSingleDirectory ? 'Copy Directory Name' : 'Copy Filename';
    }

    contextItemSeparator.style.display = (hasTransferActions || hasItemToolActions) && (canCopy || canMakeCopy || canRename || canOpen || canOpenReadOnly || canCompare) ? '' : 'none';
    contextDownload.style.display = canDownload ? '' : 'none';
    contextDownload.textContent = selectedEntries.length > 1 ? 'Download Selected...' : 'Download...';
    contextUploadEntry.style.display = canUploadWithEntryActions ? '' : 'none';
    contextUploadEntry.textContent = 'Upload...';
    contextTransferSeparator.style.display = hasTransferActions && hasItemToolActions ? '' : 'none';
    contextCalculateChecksums.style.display = canCalculateChecksums ? '' : 'none';
    contextFileProperties.style.display = canShowProperties ? '' : 'none';
    contextSetPermissions.style.display = canChangePermissions ? '' : 'none';
    contextChangeOwnerGroup.style.display = canChangeOwnerGroup ? '' : 'none';

    contextRefreshSeparator.style.display = (canCreateInContext || canRefresh || canRunRemoteCommand || canUpload) && (hasEntryActions || canOpen || canOpenReadOnly || canCompare) ? '' : 'none';
    contextCreateFile.style.display = canCreateInContext ? '' : 'none';
    contextCreateDirectory.style.display = canCreateInContext ? '' : 'none';
    contextUpload.style.display = canUpload ? '' : 'none';
    contextUpload.textContent = 'Upload...';
    contextEmptyCopySeparator.style.display = canCopyCurrentPath && canUpload ? '' : 'none';
    contextCopyCurrentPath.style.display = canCopyCurrentPath ? '' : 'none';
    contextEmptyRefreshSeparator.style.display = canCopyCurrentPath && (canRefresh || canOpenLogViewer || canRunRemoteCommand || canOpenSshTerminal) ? '' : 'none';
    contextRefresh.style.display = canRefresh ? '' : 'none';
    if (contextOpenLogViewer) contextOpenLogViewer.style.display = canOpenLogViewer ? '' : 'none';
    if (contextOpenLogViewer) contextOpenLogViewer.textContent = isSingleFile ? 'Open in Log Viewer' : 'Open Log Viewer';
    contextRunRemoteCommand.style.display = canRunRemoteCommand ? '' : 'none';
    contextOpenSshTerminal.style.display = canOpenSshTerminal ? '' : 'none';

    contextDeleteSeparator.style.display = canDelete ? '' : 'none';
    contextDelete.style.display = canDelete ? '' : 'none';
    contextDelete.textContent = selectedEntries.length > 1 ? 'Delete Selected' : 'Delete';

    normalizeContextMenuSeparators();
  }

  function isContextMenuNodeVisible(node) {
    return node && node.style && node.style.display !== 'none';
  }

  function normalizeContextMenuSeparators() {
    const nodes = Array.from(entryContextMenu.children);
    const isSeparator = node => node.classList && node.classList.contains('context-menu-separator');

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!isSeparator(node) || !isContextMenuNodeVisible(node)) continue;

      let previousVisible = null;
      for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
        if (isContextMenuNodeVisible(nodes[previousIndex])) {
          previousVisible = nodes[previousIndex];
          break;
        }
      }

      let nextVisible = null;
      for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
        if (isContextMenuNodeVisible(nodes[nextIndex])) {
          nextVisible = nodes[nextIndex];
          break;
        }
      }

      const shouldHide = !previousVisible || !nextVisible || isSeparator(previousVisible) || isSeparator(nextVisible);
      if (shouldHide) node.style.display = 'none';
    }
  }

  function copyCurrentRemotePathText() {
    const path = normalizeUiRemotePath(currentPath.value || '/');
    vscode.postMessage({ type: 'copyStatus', payload: { text: path, message: 'Copied current path' } });
  }

  function copySelectedEntryText(entries, field) {
    const selectedEntries = Array.isArray(entries) ? entries.filter(entry => entry && !isParentEntry(entry)) : [];
    if (!selectedEntries.length) return;

    const values = selectedEntries.map(entry => String(field === 'name' ? entry.name || '' : entry.path || '').trim()).filter(Boolean);
    if (!values.length) return;

    const plural = values.length > 1;
    const message = field === 'name'
      ? (plural ? 'Copied names' : 'Copied name')
      : (plural ? 'Copied paths' : 'Copied path');

    vscode.postMessage({ type: 'copyStatus', payload: { text: values.join('\\n'), message } });
  }

  function setOptimisticRemoteClipboardCutState(entries) {
    const cutEntries = (Array.isArray(entries) ? entries : [])
      .filter(entry => entry && !isParentEntry(entry))
      .map(entry => ({
        path: normalizeUiRemotePath(entry.path || ''),
        name: String(entry.name || ''),
        type: getEffectiveEntryType(entry) || entry.type || 'unknown'
      }))
      .filter(entry => entry.path && entry.path !== '/' && entry.name && entry.name !== '..');

    if (!cutEntries.length) return;

    remoteClipboardState = {
      hasItems: true,
      operation: 'cut',
      connectionId: activeConnectionId || '',
      protocol: '',
      connectionLabel: '',
      itemCount: cutEntries.length,
      itemNames: cutEntries.map(entry => entry.name),
      sourceItems: cutEntries,
      sourceParentDirectories: Array.from(new Set(cutEntries.map(entry => getRemoteParentPath(entry.path)))),
      canPaste: Boolean(activeConnectionId)
    };
  }

  function hideContextMenu() {
    if (entryContextMenu) entryContextMenu.classList.remove('visible');
  }

  function getRemoteParentPath(path) {
    const normalized = normalizeUiRemotePath(path || '/');
    if (normalized === '/') return '/';
    const trimmed = normalized.replace(new RegExp('/+$'), '');
    const index = trimmed.lastIndexOf('/');
    return index <= 0 ? '/' : trimmed.slice(0, index);
  }

  function isRemotePathAncestorOrSelf(ancestorPath, targetPath) {
    const ancestor = normalizeUiRemotePath(ancestorPath || '/');
    const target = normalizeUiRemotePath(targetPath || '/');
    return Boolean(ancestor && ancestor !== '/' && (ancestor === target || target.startsWith(ancestor + '/')));
  }

  function canPasteRemoteToDirectory(targetDirectory) {
    if (!remoteClipboardState || !remoteClipboardState.canPaste) return false;
    const target = normalizeUiRemotePath(targetDirectory || '/');
    const sourceItems = Array.isArray(remoteClipboardState.sourceItems) ? remoteClipboardState.sourceItems : [];
    const sourceParents = new Set();
    if (Array.isArray(remoteClipboardState.sourceParentDirectories)) {
      remoteClipboardState.sourceParentDirectories.forEach(path => sourceParents.add(normalizeUiRemotePath(path || '/')));
    }
    sourceItems.forEach(item => {
      if (!item || !item.path) return;
      sourceParents.add(getRemoteParentPath(item.path));
    });

    if (sourceParents.has(target)) {
      return false;
    }

    return !sourceItems.some(item => {
      if (!item || item.type !== 'directory') return false;
      const sourcePath = normalizeUiRemotePath(item.path || '');
      return isRemotePathAncestorOrSelf(sourcePath, target);
    });
  }

  function getCurrentContextDirectory() {
    return normalizeUiRemotePath(currentPath.value || '/');
  }

  function getContextWorkingDirectory() {
    const entries = getSelectedActionEntries();
    if (entries.length !== 1) return getCurrentContextDirectory();

    const entry = entries[0];
    const entryType = getEffectiveEntryType(entry);
    if (entryType === 'directory') {
      return normalizeUiRemotePath(entry.path || currentPath.value || '/');
    }

    return getRemoteParentPath(entry.path || currentPath.value || '/');
  }

  function getSelectedActionEntries() {
    if (!canStartTransferAction() || selectedEntryPaths.size === 0) return [];
    return currentEntries.filter(item => selectedEntryPaths.has(item.path || item.name) && !isParentEntry(item));
  }

  function getSelectedActionEntry() {
    const entries = getSelectedActionEntries();
    return entries.length === 1 ? entries[0] : null;
  }

  function actionPayload(entry) {
    return {
      path: entry.path,
      name: entry.name,
      type: entry.type,
      effectiveType: entry.effectiveType || '',
      linkTarget: entry.linkTarget || '',
      permissions: entry.permissions || ''
    };
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/"/g, '\\"');
  }

  function getVisibleEntries() {
    const parentEntries = currentEntries.filter(isParentEntry);
    let visibleEntries = currentEntries.filter(entry => !isParentEntry(entry));

    if (filterText) {
      visibleEntries = visibleEntries.filter(entry => String(entry.name || '').toLowerCase().includes(filterText));
    }

    if (currentSort.key && currentSort.direction) {
      const directionMultiplier = currentSort.direction === 'asc' ? 1 : -1;
      visibleEntries.sort((left, right) => compareEntries(left, right, currentSort.key) * directionMultiplier);
    }

    return parentEntries.concat(visibleEntries);
  }

  function isParentEntry(entry) {
    return entry && entry.name === '..' && entry.type === 'directory';
  }

  function cycleSort(key) {
    if (!key) return;
    flushPendingFilterInputWithoutRender();

    if (currentSort.key !== key) {
      currentSort = { key, direction: 'asc' };
    } else if (currentSort.direction === 'asc') {
      currentSort = { key, direction: 'desc' };
    } else {
      currentSort = { key: '', direction: '' };
    }

    updateSortIndicators();
    renderEntries(getVisibleEntries());
  }

  function updateSortIndicators() {
    for (const header of entriesTable.querySelectorAll('th.sortable')) {
      const indicator = header.querySelector('.sort-indicator');
      const isActive = header.dataset.sortKey === currentSort.key && currentSort.direction;
      header.setAttribute('aria-sort', isActive ? (currentSort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      if (indicator) indicator.textContent = isActive ? (currentSort.direction === 'asc' ? '↑' : '↓') : '';
    }
  }

  function compareEntries(left, right, key) {
    if (key === 'size' || key === 'modified') {
      return compareNumbers(sortValue(left, key), sortValue(right, key));
    }

    return compareText(sortValue(left, key), sortValue(right, key));
  }

  function sortValue(entry, key) {
    if (key === 'modified') return Number(entry.modifyTime || 0);
    if (key === 'size') return isDirectoryLike(entry) ? -1 : Number(entry.size || 0);
    if (key === 'type') return formatEntryType(entry);
    if (key === 'name') return formatEntryName(entry);
    if (key === 'owner') return formatMetadata(entry.owner);
    if (key === 'group') return formatMetadata(entry.group);
    if (key === 'permissions') return entry.permissions || '';
    return entry[key] || '';
  }

  function compareNumbers(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  function compareText(left, right) {
    return String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' });
  }

  function applyColumnWidths() {
    let totalWidth = 0;
    for (const column of columnOrder) {
      const width = columnWidths[column];
      totalWidth += width;
      const col = entriesTable.querySelector('col[data-column="' + column + '"]');
      if (col) col.style.width = width + 'px';
    }
    entriesTable.style.minWidth = '100%';
    entriesTable.style.maxWidth = '100%';
  }

  function startColumnResize(event) {
    event.preventDefault();
    event.stopPropagation();

    const resizer = event.currentTarget;
    const column = resizer.dataset.column;
    if (!column) return;

    const startX = event.clientX;
    const startWidth = columnWidths[column] || minColumnWidths[column] || 72;
    resizer.classList.add('resizing');
    document.body.classList.add('resizing-columns');

    const onMouseMove = moveEvent => {
      const minWidth = minColumnWidths[column] || 72;
      columnWidths[column] = Math.max(minWidth, startWidth + moveEvent.clientX - startX);
      applyColumnWidths();
    };

    const onMouseUp = () => {
      resizer.classList.remove('resizing');
      document.body.classList.remove('resizing-columns');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  const entryIcons = {
    file: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M252.31-100Q222-100 201-121q-21-21-21-51.31v-615.38Q180-818 201-839q21-21 51.31-21H570l210 210v477.69Q780-142 759-121q-21 21-51.31 21H252.31ZM540-620v-180H252.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v615.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85h455.38q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46V-620H540ZM240-800v180-180V-160v-640Z"/></svg>',
    folder: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M172.31-180Q142-180 121-201q-21-21-21-51.31v-455.38Q100-738 121-759q21-21 51.31-21h219.61l80 80h315.77Q818-700 839-679q21 21 21 51.31v375.38Q860-222 839-201q-21 21-51.31 21H172.31Z"/></svg>',
    link: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M323-140q-75.85 0-129.42-53.58Q140-247.15 140-323q0-36.92 13.66-70.23 13.65-33.31 39.73-59.38l127.46-126.47L363-536.92 235.54-409.85q-17.77 17.77-26.85 40.23-9.07 22.47-9.07 46.62 0 51.31 36.03 87.15Q271.69-200 323-200q24.15 0 46.92-9.08 22.77-9.07 40.54-26.84L537.31-363l42.77 42.77-127.47 126.46q-26.07 26.08-59.38 39.92Q359.92-140 323-140Zm76.31-216.92-42.39-42.77 203.77-203.77 42.77 42.77-204.15 203.77Zm239.84-23.39L597-422.69l127.46-126.85q17.39-17.38 26.16-39.34 8.76-21.97 8.76-46.12 0-51.92-35.73-88.46Q687.92-760 636-760q-24.15 0-46.62 9.08-22.46 9.07-39.84 26.46L422.69-597l-42.38-42.15 127.08-127.08q26.07-26.08 59.38-39.92Q600.08-820 637-820q75.85 0 129.11 53.77 53.27 53.77 53.27 130.23 0 36.31-13.34 69.42-13.35 33.12-39.43 59.19L639.15-380.31Z"/></svg>',
    unknown: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M438.62-329.23q0-67.92 15.65-104t65.35-80q38.69-34.46 58.65-62.5t19.96-63.58q0-47.15-32.11-78.38-32.12-31.23-88.43-31.23-51.38 0-80 27.53-28.61 27.54-43.46 61.47l-73-32.08q23.31-57.46 72.77-95.81 49.46-38.34 123.69-38.34 96.92 0 149.19 54.65 52.27 54.65 52.27 129.73 0 46.92-20.34 82.81-20.35 35.88-61.73 74.73-52.08 47.77-64.5 75.34-12.43 27.58-12.43 79.66h-81.53ZM477.69-100q-24.54 0-42.27-17.73-17.73-17.73-17.73-42.27 0-24.54 17.73-42.27Q453.15-220 477.69-220q24.54 0 42.27 17.73 17.73 17.73 17.73 42.27 0 24.54-17.73 42.27Q502.23-100 477.69-100Z"/></svg>'
  };

  function iconFor(entryOrType) {
    const originalType = typeof entryOrType === 'string' ? entryOrType : entryOrType.type;
    const type = typeof entryOrType === 'string' ? entryOrType : getEffectiveEntryType(entryOrType);
    if (originalType === 'link') return entryIcons.link;
    if (type === 'directory') return entryIcons.folder;
    if (type === 'unknown') return entryIcons.unknown;
    return entryIcons.file;
  }

  function getEffectiveEntryType(entry) {
    if (!entry) return 'unknown';
    if (entry.effectiveType === 'file' || entry.effectiveType === 'directory') return entry.effectiveType;
    return entry.type || 'unknown';
  }

  function isDirectoryLike(entry) {
    return getEffectiveEntryType(entry) === 'directory';
  }

  function formatEntryName(entry) {
    if (entry && entry.type === 'link' && entry.linkTarget) {
      return String(entry.name || '') + ' -> ' + String(entry.linkTarget || '');
    }

    return String(entry && entry.name ? entry.name : '');
  }

  function formatEntryType(entry) {
    if (entry && entry.type === 'link') {
      return 'link';
    }

    return String(entry && entry.type ? entry.type : 'unknown');
  }

  function formatSize(size) {
    const value = Number(size || 0);
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB';
    return (value / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  }

  function formatDate(value) {
    const timestamp = Number(value || 0);
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString();
  }

  function formatMetadata(value) {
    if (value === undefined || value === null || value === '') return '';
    return String(value);
  }

  function showServerToolbarStatus(message, kind = 'info', durationMs = 0) {
    if (!serverToolbarStatus) return;
    const text = String(message || '').trim();
    if (serverToolbarStatusTimer) {
      window.clearTimeout(serverToolbarStatusTimer);
      serverToolbarStatusTimer = 0;
    }
    serverToolbarStatus.textContent = text;
    if (text) serverToolbarStatus.setAttribute('data-tooltip', text); else serverToolbarStatus.removeAttribute('data-tooltip');
    serverToolbarStatus.classList.toggle('error', kind === 'error');
    serverToolbarStatus.classList.toggle('visible', Boolean(text) && getActiveConnectionView() === 'server');
    updateServerAutoRefreshCountdownDisplay();
    if (!text) return;
    const timeout = Number(durationMs || 0) || (kind === 'error' ? 7000 : 3000);
    serverToolbarStatusTimer = window.setTimeout(() => {
      serverToolbarStatus.textContent = '';
      serverToolbarStatus.removeAttribute('data-tooltip');
      serverToolbarStatus.classList.remove('visible', 'error');
      serverToolbarStatusTimer = 0;
      updateServerAutoRefreshCountdownDisplay();
    }, timeout);
  }

`;}
