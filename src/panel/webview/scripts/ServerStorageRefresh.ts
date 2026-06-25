export function renderServerStorageRefresh(): string {
  return `  function getConnectionViewStorageKey() {
    return activeConnectionId || '__default__';
  }

  function isServerViewSupported(session) {
    return Boolean(session && normalizeConnectionTypeValue(session.connectionType) === 'sftp' && getActiveRemoteCapabilities().canRunCommand);
  }

  function getActiveConnectionView() {
    if (!activeConnectionId) return 'files';
    const active = getActiveSession();
    const saved = activeConnectionViewsByConnectionId.get(getConnectionViewStorageKey()) || 'files';
    if (saved === 'server' && !isServerViewSupported(active)) return 'files';
    return saved === 'server' ? 'server' : 'files';
  }

  function setActiveConnectionView(view) {
    const nextView = view === 'server' ? 'server' : 'files';
    const active = getActiveSession();
    if (nextView === 'server' && !isServerViewSupported(active)) {
      activeConnectionViewsByConnectionId.set(getConnectionViewStorageKey(), 'files');
    } else if (activeConnectionId) {
      activeConnectionViewsByConnectionId.set(getConnectionViewStorageKey(), nextView);
    }
    const toolbarLayoutSnapshot = prepareToolbarLayoutTransition();
    updateConnectionViewUi();
    setControls({ animateToolbarLayout: false });
    finishToolbarLayoutTransition(toolbarLayoutSnapshot);
    maybeRequestServerDashboardForActiveView();
    updateServerAutoRefreshTimer();
  }

  function pruneConnectionViewState() {
    const activeIds = new Set(sessions.map(session => session.id).filter(Boolean));
    for (const key of Array.from(activeConnectionViewsByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) activeConnectionViewsByConnectionId.delete(key);
    }
    for (const key of Array.from(serverDashboardStatesByConnectionId.keys())) {
      if (!activeIds.has(key)) serverDashboardStatesByConnectionId.delete(key);
    }
    for (const key of Array.from(serverServiceFiltersByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) serverServiceFiltersByConnectionId.delete(key);
    }
    for (const key of Array.from(serverQuickTaskFiltersByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) serverQuickTaskFiltersByConnectionId.delete(key);
    }
    for (const key of Array.from(serverProcessFiltersByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) serverProcessFiltersByConnectionId.delete(key);
    }
    for (const key of Array.from(serverProcessActionStatesByConnectionId.keys())) {
      if (!activeIds.has(key)) serverProcessActionStatesByConnectionId.delete(key);
    }
    for (const key of Array.from(serverLogShortcutFiltersByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) serverLogShortcutFiltersByConnectionId.delete(key);
    }
    for (const key of Array.from(serverPortForwardFiltersByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) serverPortForwardFiltersByConnectionId.delete(key);
    }
    for (const key of Array.from(serverCardSortsByConnectionId.keys())) {
      const separatorIndex = String(key).indexOf('::');
      const connectionId = separatorIndex >= 0 ? String(key).slice(0, separatorIndex) : String(key);
      if (connectionId !== '__default__' && !activeIds.has(connectionId)) serverCardSortsByConnectionId.delete(key);
    }
    for (const key of Array.from(serverPortForwardRuntimeByConnectionId.keys())) {
      if (!activeIds.has(key)) serverPortForwardRuntimeByConnectionId.delete(key);
    }
  }

  function formatServerAdapterLabel(session) {
    if (!session) return 'unknown';
    const protocol = normalizeConnectionTypeValue(session.connectionType);
    if (protocol !== 'sftp') return protocol;
    return 'ssh/sftp';
  }

  function formatServerSudoLabel(session) {
    if (!session || normalizeConnectionTypeValue(session.connectionType) !== 'sftp') return 'Sudo unavailable';
    if (String(session.username || '').trim().toLowerCase() === 'root') return 'Root user';
    return session.sudoModeEnabled ? 'Sudo enabled' : 'Sudo disabled';
  }

  function formatServerTarget(session) {
    if (!session) return '';
    const user = String(session.username || '').trim();
    const hostValue = String(session.host || '').trim();
    if (user && hostValue) return user + '@' + hostValue;
    return user || hostValue || 'Remote host';
  }

  function createServerLogShortcutId() {
    return 'log-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function createServerLogShortcut(name, path) {
    const normalizedPath = normalizeUiRemotePath(path || '/');
    const normalizedName = String(name || '').trim() || getRemotePathBasename(normalizedPath);
    return {
      id: createServerLogShortcutId(),
      name: normalizedName,
      path: normalizedPath
    };
  }

  function getServerInfoValue(label) {
    const state = getActiveServerDashboardState();
    const items = state && state.data && Array.isArray(state.data.systemInfo) ? state.data.systemInfo : [];
    const target = String(label || '').toLowerCase();
    const item = items.find(info => String(info.label || '').toLowerCase() === target);
    return String((item && item.value) || '').trim();
  }

  function getDefaultServerLogShortcuts(session) {
    const protocol = normalizeConnectionTypeValue(session && session.connectionType);
    if (protocol !== 'sftp') return [];

    const osName = getServerInfoValue('OS').toLowerCase();
    const adapter = getServerInfoValue('Adapter').toLowerCase();
    if (osName === 'aix' || adapter.indexOf('aix') !== -1 || adapter === 'generic-unix') {
      return [
        createServerLogShortcut('AIX messages', '/var/adm/messages'),
        createServerLogShortcut('Messages', '/var/log/messages')
      ];
    }

    return [
      createServerLogShortcut('System log', '/var/log/syslog'),
      createServerLogShortcut('Messages', '/var/log/messages'),
      createServerLogShortcut('Nginx error', '/var/log/nginx/error.log'),
      createServerLogShortcut('Nginx access', '/var/log/nginx/access.log'),
      createServerLogShortcut('Apache error', '/var/log/httpd/error_log'),
      createServerLogShortcut('Apache2 error', '/var/log/apache2/error.log')
    ];
  }

  function sanitizeServerLogShortcut(item) {
    const path = normalizeUiRemotePath(item && item.path ? item.path : '');
    if (!path || path === '/') return null;
    const name = String(item && item.name ? item.name : '').trim() || getRemotePathBasename(path);
    return {
      id: String(item && item.id ? item.id : createServerLogShortcutId()).trim() || createServerLogShortcutId(),
      name: name,
      path: path
    };
  }

  function readServerLogShortcutsStorage() {
    try {
      const raw = localStorage.getItem(SERVER_LOG_SHORTCUTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeServerLogShortcutsStorage(storage) {
    try {
      localStorage.setItem(SERVER_LOG_SHORTCUTS_STORAGE_KEY, JSON.stringify(storage || {}));
      postPersistentStorageSnapshot();
    } catch (_) {
      // Ignore storage quota or disabled storage errors.
    }
  }

  function isServerLogShortcutsPersistent(session) {
    if (!session || session.isQuickConnect === true) return false;
    if (session.isQuickConnect === false) return true;
    return profiles.some(profile => profile.id === session.id);
  }

  function hasServerDashboardDataForLogDefaults() {
    const state = getActiveServerDashboardState();
    return Boolean(state && state.data);
  }

  function getServerLogShortcuts(session) {
    if (!session) return [];
    const connectionId = String(session.id || '').trim();
    if (!connectionId) return [];

    if (isServerLogShortcutsPersistent(session)) {
      const storage = readServerLogShortcutsStorage();
      if (Array.isArray(storage[connectionId])) {
        return storage[connectionId].map(sanitizeServerLogShortcut).filter(Boolean);
      }
      if (!hasServerDashboardDataForLogDefaults()) {
        return [];
      }
      const defaults = getDefaultServerLogShortcuts(session);
      storage[connectionId] = defaults;
      writeServerLogShortcutsStorage(storage);
      return defaults;
    }

    if (serverLogShortcutsSessionByConnectionId.has(connectionId)) {
      return (serverLogShortcutsSessionByConnectionId.get(connectionId) || []).map(sanitizeServerLogShortcut).filter(Boolean);
    }

    if (!hasServerDashboardDataForLogDefaults()) {
      return [];
    }

    const defaults = getDefaultServerLogShortcuts(session);
    serverLogShortcutsSessionByConnectionId.set(connectionId, defaults);
    return defaults;
  }

  function saveServerLogShortcuts(session, shortcuts) {
    if (!session) return;
    const connectionId = String(session.id || '').trim();
    if (!connectionId) return;
    const normalized = (Array.isArray(shortcuts) ? shortcuts : []).map(sanitizeServerLogShortcut).filter(Boolean);

    if (isServerLogShortcutsPersistent(session)) {
      const storage = readServerLogShortcutsStorage();
      storage[connectionId] = normalized;
      writeServerLogShortcutsStorage(storage);
      return;
    }

    serverLogShortcutsSessionByConnectionId.set(connectionId, normalized);
  }

  function getServerLogShortcutById(session, shortcutId) {
    const id = String(shortcutId || '').trim();
    return getServerLogShortcuts(session).find(shortcut => shortcut.id === id) || null;
  }

  function getRemotePathDirname(path) {
    const normalized = normalizeUiRemotePath(path || '/');
    if (normalized === '/') return '/';
    const trimmed = normalized.replace(new RegExp('/+$'), '');
    const index = trimmed.lastIndexOf('/');
    return index <= 0 ? '/' : trimmed.slice(0, index);
  }

  function getServerLogShortcutInitialPickerPath() {
    const typedPath = normalizeUiRemotePath(serverLogShortcutPathInput && serverLogShortcutPathInput.value ? serverLogShortcutPathInput.value : '');
    if (typedPath && typedPath !== '/') {
      return getRemotePathDirname(typedPath);
    }
    const state = getActiveServerDashboardState();
    const info = state && state.data && Array.isArray(state.data.systemInfo) ? state.data.systemInfo : [];
    const osName = String(((info.find(item => item && item.label === 'OS') || {}).value || '')).toLowerCase();
    return osName === 'aix' ? '/var/adm' : '/var/log';
  }

  function ensureServerLogShortcutPathPickerPortal() {
    if (!serverLogShortcutPathPicker || serverLogShortcutPathPicker.parentElement === document.body) return;
    document.body.appendChild(serverLogShortcutPathPicker);
  }

  function positionServerLogShortcutPathPicker() {
    if (!serverLogShortcutPathPickerOpen || !serverLogShortcutPathPicker || !serverLogShortcutPathInput) return;
    ensureServerLogShortcutPathPickerPortal();

    const rect = serverLogShortcutPathInput.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const margin = 8;
    const gap = 4;
    const width = Math.max(240, Math.min(rect.width, viewportWidth - (margin * 2)));
    const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
    const below = Math.max(0, viewportHeight - rect.bottom - margin - gap);
    const above = Math.max(0, rect.top - margin - gap);
    const openAbove = below < 180 && above > below;
    const available = Math.max(120, openAbove ? above : below);
    const maxHeight = Math.min(280, Math.max(120, available));

    serverLogShortcutPathPicker.style.left = Math.round(left) + 'px';
    serverLogShortcutPathPicker.style.right = 'auto';
    serverLogShortcutPathPicker.style.bottom = 'auto';
    serverLogShortcutPathPicker.style.width = Math.round(width) + 'px';
    serverLogShortcutPathPicker.style.maxHeight = Math.round(maxHeight) + 'px';

    if (serverLogShortcutPathPickerList) {
      serverLogShortcutPathPickerList.style.maxHeight = Math.max(80, Math.round(maxHeight - 38)) + 'px';
    }

    const measuredHeight = Math.min(serverLogShortcutPathPicker.offsetHeight || maxHeight, maxHeight);
    const top = openAbove
      ? Math.max(margin, rect.top - gap - measuredHeight)
      : Math.min(rect.bottom + gap, viewportHeight - margin - measuredHeight);
    serverLogShortcutPathPicker.style.top = Math.round(top) + 'px';
  }

  function browseServerLogShortcutPath() {
    if (!activeConnectionId || !serverLogShortcutDialogOpen) return;
    const path = getServerLogShortcutInitialPickerPath();
    showServerLogShortcutPathPicker(path);
    requestServerLogShortcutPathEntries(path);
  }

  function showServerLogShortcutPathPicker(path) {
    serverLogShortcutPathPickerOpen = true;
    serverLogShortcutPathPickerPathValue = normalizeUiRemotePath(path || '/');
    if (serverLogShortcutPathPicker) {
      ensureServerLogShortcutPathPickerPortal();
      serverLogShortcutPathPicker.classList.remove('hidden');
      serverLogShortcutPathPicker.setAttribute('aria-hidden', 'false');
    }
    if (serverLogShortcutPathPickerPath) serverLogShortcutPathPickerPath.textContent = serverLogShortcutPathPickerPathValue;
    if (serverLogShortcutPathPickerList) serverLogShortcutPathPickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
    positionServerLogShortcutPathPicker();
  }

  function hideServerLogShortcutPathPicker() {
    serverLogShortcutPathPickerOpen = false;
    if (serverLogShortcutPathPicker) {
      serverLogShortcutPathPicker.classList.add('hidden');
      serverLogShortcutPathPicker.setAttribute('aria-hidden', 'true');
      serverLogShortcutPathPicker.removeAttribute('style');
      if (serverLogShortcutPathPickerList) serverLogShortcutPathPickerList.style.maxHeight = '';
    }
  }

  function requestServerLogShortcutPathEntries(path) {
    if (!activeConnectionId || !serverLogShortcutDialogOpen) return;
    const scopePath = normalizeUiRemotePath(path || '/');
    serverLogShortcutPathPickerPathValue = scopePath;
    serverLogShortcutPathPickerRequestId += 1;
    if (serverLogShortcutPathPickerPath) serverLogShortcutPathPickerPath.textContent = scopePath;
    if (serverLogShortcutPathPickerList) serverLogShortcutPathPickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
    positionServerLogShortcutPathPicker();
    vscode.postMessage({ type: 'browseRemoteSearchScope', payload: { scopePath, includeFiles: true, purpose: 'serverLogShortcut', requestId: String(serverLogShortcutPathPickerRequestId) } });
  }

  function selectServerLogShortcutPath(path) {
    const selectedPath = normalizeUiRemotePath(path || '');
    if (!selectedPath || selectedPath === '/') return;
    serverLogShortcutPathInput.value = selectedPath;
    validateServerLogShortcutInputs(false);
    hideServerLogShortcutPathPicker();
    serverLogShortcutPathInput.focus();
  }

  function handleServerLogShortcutPathEntriesListed(payload) {
    if (payload && payload.purpose && payload.purpose !== 'serverLogShortcut') return false;
    if (!serverLogShortcutPathPickerOpen) return false;
    if (payload.connectionId && activeConnectionId && payload.connectionId !== activeConnectionId) return true;
    if (payload.requestId && String(payload.requestId) !== String(serverLogShortcutPathPickerRequestId)) return true;
    const path = normalizeUiRemotePath(payload.path || '/');
    const parentPath = normalizeUiRemotePath(payload.parentPath || '/');
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    serverLogShortcutPathPickerPathValue = path;
    if (serverLogShortcutPathPickerPath) serverLogShortcutPathPickerPath.textContent = path;
    if (!serverLogShortcutPathPickerList) return true;
    const parentItem = path && path !== '/' ? '<button class="remote-search-scope-picker-item" type="button" data-server-log-picker-type="directory" data-server-log-picker-path="' + escapeHtml(parentPath || '/') + '"><span aria-hidden="true">..</span></button>' : '';
    if (payload.error) {
      serverLogShortcutPathPickerList.innerHTML = parentItem + '<div class="remote-search-scope-picker-empty error">' + escapeHtml(payload.error || 'Unable to list this directory.') + '</div>';
      positionServerLogShortcutPathPicker();
      return true;
    }
    const currentPath = normalizeUiRemotePath(serverLogShortcutPathInput.value || '');
    const items = entries.map(entry => {
      const entryPath = normalizeUiRemotePath(entry.path || entry.name || '/');
      const type = getEffectiveEntryType(entry) === 'directory' ? 'directory' : 'file';
      const icon = type === 'directory' ? '▸' : '·';
      const selected = type === 'file' && currentPath && entryPath === currentPath ? ' file-selected' : '';
      return '<button class="remote-search-scope-picker-item' + selected + '" type="button" data-server-log-picker-type="' + escapeHtml(type) + '" data-server-log-picker-path="' + escapeHtml(entryPath) + '"><span aria-hidden="true">' + icon + '</span><span>' + escapeHtml(entry.name || entryPath) + '</span><span class="remote-search-scope-picker-item-path">' + escapeHtml(entryPath) + '</span></button>';
    }).join('');
    serverLogShortcutPathPickerList.innerHTML = parentItem + (items || '<div class="remote-search-scope-picker-empty">No files or folders.</div>');
    positionServerLogShortcutPathPicker();
    return true;
  }

  function validateServerLogShortcutInputs(showFeedback) {
    const name = String(serverLogShortcutNameInput.value || '').trim();
    const rawPath = String(serverLogShortcutPathInput.value || '').trim();
    const pathValid = Boolean(rawPath && rawPath.charAt(0) === '/');

    serverLogShortcutNameInput.classList.remove('server-log-shortcut-input-invalid');
    serverLogShortcutPathInput.classList.toggle('server-log-shortcut-input-invalid', !pathValid && showFeedback);

    if (!rawPath) {
      if (showFeedback) serverLogShortcutFeedback.textContent = 'Remote log path is required.';
      return null;
    }

    if (!pathValid) {
      if (showFeedback) serverLogShortcutFeedback.textContent = 'Path must be absolute.';
      return null;
    }

    if (showFeedback) serverLogShortcutFeedback.textContent = '';
    const normalizedPath = normalizeUiRemotePath(rawPath);
    return {
      name: name || getRemotePathBasename(normalizedPath),
      path: normalizedPath
    };
  }

  function showServerLogShortcutDialog(mode, shortcutId) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;
    const editing = mode === 'edit';
    const shortcut = editing ? getServerLogShortcutById(active, shortcutId) : null;
    if (editing && !shortcut) return;

    serverLogShortcutDialogOpen = true;
    serverLogShortcutDialogMode = editing ? 'edit' : 'add';
    serverLogShortcutDialogShortcutId = editing ? shortcut.id : '';

    serverLogShortcutTitle.textContent = editing ? 'Edit Log Shortcut' : 'Add Log Shortcut';
    serverLogShortcutSubtitle.textContent = editing ? 'Update this shortcut name or remote log path.' : 'Create a shortcut to a remote log file.';
    serverLogShortcutSaveButton.textContent = editing ? 'Save' : 'Add';
    if (serverLogShortcutRemoveButton) {
      serverLogShortcutRemoveButton.hidden = !editing;
      serverLogShortcutRemoveButton.disabled = !editing;
    }
    serverLogShortcutNameInput.value = shortcut ? shortcut.name : '';
    serverLogShortcutPathInput.value = shortcut ? shortcut.path : '';
    serverLogShortcutFeedback.textContent = '';
    serverLogShortcutNameInput.classList.remove('server-log-shortcut-input-invalid');
    serverLogShortcutPathInput.classList.remove('server-log-shortcut-input-invalid');

    serverLogShortcutBackdrop.classList.add('visible');
    serverLogShortcutBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (editing) {
        serverLogShortcutNameInput.focus();
        serverLogShortcutNameInput.select();
      } else {
        serverLogShortcutPathInput.focus();
      }
    }, 0);
  }

  function hideServerLogShortcutDialog() {
    hideServerLogShortcutPathPicker();
    serverLogShortcutDialogOpen = false;
    serverLogShortcutDialogMode = 'add';
    serverLogShortcutDialogShortcutId = '';
    if (serverLogShortcutRemoveButton) {
      serverLogShortcutRemoveButton.hidden = true;
      serverLogShortcutRemoveButton.disabled = true;
    }
    serverLogShortcutBackdrop.classList.remove('visible');
    serverLogShortcutBackdrop.setAttribute('aria-hidden', 'true');
  }

  function saveServerLogShortcutDialog() {
    const values = validateServerLogShortcutInputs(true);
    if (!values) {
      serverLogShortcutPathInput.focus();
      return;
    }

    const active = getActiveSession();
    if (!active) return;
    const shortcuts = getServerLogShortcuts(active).slice();

    if (serverLogShortcutDialogMode === 'edit') {
      const index = shortcuts.findIndex(shortcut => shortcut.id === serverLogShortcutDialogShortcutId);
      if (index < 0) return;
      shortcuts[index] = {
        id: shortcuts[index].id,
        name: values.name,
        path: values.path
      };
    } else {
      shortcuts.push(createServerLogShortcut(values.name, values.path));
    }

    saveServerLogShortcuts(active, shortcuts);
    hideServerLogShortcutDialog();
    renderServerView();
  }

  function showServerLogShortcutRemoveDialog(shortcutId) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;
    const shortcut = getServerLogShortcutById(active, shortcutId);
    if (!shortcut) return;

    serverLogShortcutRemoveDialogOpen = true;
    serverLogShortcutRemoveId = shortcut.id;
    serverLogShortcutRemovePath.textContent = shortcut.name + ' — ' + shortcut.path;
    serverLogShortcutRemoveBackdrop.classList.add('visible');
    serverLogShortcutRemoveBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => serverLogShortcutRemoveCancelButton.focus(), 0);
  }

  function hideServerLogShortcutRemoveDialog() {
    serverLogShortcutRemoveDialogOpen = false;
    serverLogShortcutRemoveId = '';
    serverLogShortcutRemoveBackdrop.classList.remove('visible');
    serverLogShortcutRemoveBackdrop.setAttribute('aria-hidden', 'true');
  }

  function confirmRemoveServerLogShortcut() {
    const active = getActiveSession();
    if (!active || !serverLogShortcutRemoveId) return;
    const shortcuts = getServerLogShortcuts(active).filter(shortcut => shortcut.id !== serverLogShortcutRemoveId);
    saveServerLogShortcuts(active, shortcuts);
    hideServerLogShortcutRemoveDialog();
    hideServerLogShortcutDialog();
    renderServerView();
  }

  function getServerDashboardState(connectionId) {
    const key = String(connectionId || '').trim();
    if (!key) return null;
    let state = serverDashboardStatesByConnectionId.get(key);
    if (!state) {
      state = { connectionId: key, data: null, loading: false, refreshing: false, error: '', requestId: '' };
      serverDashboardStatesByConnectionId.set(key, state);
    }
    return state;
  }

  function getActiveServerDashboardState() {
    return getServerDashboardState(activeConnectionId);
  }

  function createServerDashboardRequestId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function getDefaultServerOverviewItems() {
    return [
      { label: 'Uptime', value: '—', help: 'Not loaded' },
      { label: 'Load', value: '—', help: 'Not loaded' },
      { label: 'Memory', value: '—', help: 'Not loaded' },
      { label: 'Disk', value: '—', help: 'Not loaded' },
      { label: 'Sessions', value: '—', help: 'Not loaded' },
      { label: 'Listeners', value: '—', help: 'Not loaded' },
      { label: 'Swap', value: '—', help: 'Not loaded' },
      { label: 'IO Wait', value: '—', help: 'Not loaded' }
    ];
  }

  function requestServerDashboardRefresh(force) {
    const active = getActiveSession();
    if (!activeConnectionId || !active || !isServerViewSupported(active)) return;
    const state = getServerDashboardState(activeConnectionId);
    if (!state) return;
    if (state.refreshing && !force) {
      updateServerAutoRefreshCountdownDisplay();
      return;
    }
    const requestId = createServerDashboardRequestId();
    state.requestId = requestId;
    state.loading = !state.data;
    state.refreshing = true;
    state.error = '';
    renderServerView();
    if (serverRefreshButton) serverRefreshButton.classList.add('busy');
    updateServerAutoRefreshCountdownDisplay();
    vscode.postMessage({ type: 'requestServerDashboard', payload: { connectionId: activeConnectionId, requestId: requestId, force: Boolean(force) } });
  }

  function maybeRequestServerDashboardForActiveView() {
    const active = getActiveSession();
    if (getActiveConnectionView() !== 'server' || !activeConnectionId || !active || !isServerViewSupported(active)) return;
    const state = getServerDashboardState(activeConnectionId);
    if (!state || state.data || state.loading || state.refreshing) return;
    requestServerDashboardRefresh(false);
  }

  function handleServerDashboardSnapshot(payload) {
    const connectionId = String(payload.connectionId || '').trim();
    if (!connectionId) return;
    const state = getServerDashboardState(connectionId);
    if (!state) return;
    if (state.requestId && payload.requestId && state.requestId !== payload.requestId) return;
    const processActionState = getServerProcessActionState(connectionId);
    if (processActionState && state.data) {
      payload = Object.assign({}, payload, {
        processes: Array.isArray(state.data.processes) ? state.data.processes : [],
        processAdapter: state.data.processAdapter || payload.processAdapter || 'ps'
      });
    }
    state.data = payload;
    state.loading = false;
    state.refreshing = false;
    state.error = String(payload.error || '');
    state.requestId = '';
    if (connectionId === activeConnectionId) {
      resetServerAutoRefreshCountdown();
      renderServerView();
      updateServerRefreshBusyState();
      updateServerAutoRefreshCountdownDisplay();
    }
  }

  function updateServerRefreshBusyState() {
    const state = getActiveServerDashboardState();
    const refreshing = Boolean(state && state.refreshing);
    if (serverRefreshButton) serverRefreshButton.classList.toggle('busy', refreshing);
  }

  function getServerAutoRefreshSeconds() {
    const seconds = Number(serverAutoRefreshValue || 0);
    return Number.isFinite(seconds) && seconds > 0 ? Math.max(15, seconds) : 0;
  }

  function canShowServerAutoRefreshCountdown() {
    if (!serverAutoRefreshCountdown) return false;
    const seconds = getServerAutoRefreshSeconds();
    if (!seconds) return false;
    if (getActiveConnectionView() !== 'server') return false;
    const active = getActiveSession();
    if (!activeConnectionId || !active || !isServerViewSupported(active)) return false;
    if (serverToolbarStatus && serverToolbarStatus.classList.contains('visible')) return false;
    return true;
  }

  function updateServerAutoRefreshCountdownDisplay() {
    if (!serverAutoRefreshCountdown) return;
    if (!canShowServerAutoRefreshCountdown()) {
      serverAutoRefreshCountdown.textContent = '';
      serverAutoRefreshCountdown.hidden = true;
      serverAutoRefreshCountdown.classList.remove('refreshing');
      return;
    }
    const state = getActiveServerDashboardState();
    const refreshing = Boolean(state && state.refreshing);
    const seconds = getServerAutoRefreshSeconds();
    const remaining = Math.max(1, Math.ceil(Number(serverAutoRefreshRemainingSeconds || seconds)));
    serverAutoRefreshCountdown.textContent = refreshing ? 'Refreshing...' : 'Refresh in ' + remaining + 's';
    serverAutoRefreshCountdown.hidden = false;
    serverAutoRefreshCountdown.classList.toggle('refreshing', refreshing);
  }

  function resetServerAutoRefreshCountdown() {
    const seconds = getServerAutoRefreshSeconds();
    serverAutoRefreshRemainingSeconds = seconds || 0;
    updateServerAutoRefreshCountdownDisplay();
  }

  function updateServerAutoRefreshTimer() {
    if (serverAutoRefreshTimer) {
      clearInterval(serverAutoRefreshTimer);
      serverAutoRefreshTimer = null;
    }
    resetServerAutoRefreshCountdown();
    const seconds = getServerAutoRefreshSeconds();
    if (!seconds) return;
    if (getActiveConnectionView() !== 'server') return;
    const active = getActiveSession();
    if (!activeConnectionId || !active || !isServerViewSupported(active)) return;
    serverAutoRefreshTimer = setInterval(() => {
      const currentActive = getActiveSession();
      if (getActiveConnectionView() !== 'server' || !activeConnectionId || !currentActive || !isServerViewSupported(currentActive)) {
        updateServerAutoRefreshTimer();
        return;
      }
      const state = getActiveServerDashboardState();
      if (state && state.refreshing) {
        updateServerAutoRefreshCountdownDisplay();
        return;
      }
      serverAutoRefreshRemainingSeconds = Math.max(0, Number(serverAutoRefreshRemainingSeconds || seconds) - 1);
      if (serverAutoRefreshRemainingSeconds <= 0) {
        requestServerDashboardRefresh(false);
        serverAutoRefreshRemainingSeconds = seconds;
      }
      updateServerAutoRefreshCountdownDisplay();
    }, 1000);
  }

`;}
