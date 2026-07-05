export function renderServerJobsPortsActions(): string {
  return `  function getServerScheduledJobFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerScheduledJobFilterText() {
    return serverScheduledJobFiltersByConnectionId.get(getServerScheduledJobFilterKey()) || '';
  }

  function setServerScheduledJobFilterText(value) {
    const key = getServerScheduledJobFilterKey();
    const text = String(value || '');
    if (text) serverScheduledJobFiltersByConnectionId.set(key, text);
    else serverScheduledJobFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusScheduledFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverScheduledFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerScheduledJobFilter(item, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const haystack = [
      item && item.name,
      item && item.countLabel,
      item && item.typeLabel,
      item && item.source,
      item && item.sourceType,
      item && item.user,
      item && item.path
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function renderServerCron() {
    const state = getActiveServerDashboardState();
    const data = state && state.data ? state.data : null;
    const items = data && Array.isArray(data.scheduledJobs) ? data.scheduledJobs : [];
    const adapter = data && data.scheduledJobsAdapter ? String(data.scheduledJobsAdapter) : (state && state.loading ? 'loading' : 'not loaded');
    const isWindowsScheduledTasks = String(adapter || '').toLowerCase().indexOf('windows') >= 0;
    const scheduledTitle = isWindowsScheduledTasks ? 'Scheduled Tasks' : 'Cron Jobs';
    const scheduledFilterLabel = isWindowsScheduledTasks ? 'scheduled tasks' : 'cron jobs';
    const filterText = getServerScheduledJobFilterText();
    const filteredItems = items.filter(item => matchesServerScheduledJobFilter(item, filterText));
    const visibleItems = sortServerItems('cron', filteredItems, (item, key) => {
      if (key === 'entries') return item && (item.count || item.countLabel);
      if (key === 'type') return item && (item.typeLabel || item.sourceType);
      return item && (item.name || item.source);
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countDetail = formatServerListCount(items.length, filteredItems.length, filterHasValue, Boolean(!data && state && state.loading));
    const filterBox = '<div class="server-scheduled-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverScheduledFilterInput" class="server-scheduled-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter ' + scheduledFilterLabel + '" value="' + escapeHtml(filterText) + '" aria-label="Filter ' + scheduledFilterLabel + '"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Scheduled Items Filter" data-tooltip="Clear Filter" data-server-scheduled-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div>';
    const header = '<div class="server-section-title-row server-scheduled-title-row"><div class="server-section-title-wrap"><div class="server-section-title">' + escapeHtml(scheduledTitle) + '</div><span class="server-section-count">' + escapeHtml(countDetail) + '</span></div><div class="server-section-title-right">' + filterBox + '</div></div>';

    if (!data && state && state.loading) {
      return '<section class="server-section-card server-scheduled-card">' + header + '<div class="server-placeholder">Loading ' + escapeHtml(scheduledFilterLabel) + '...</div></section>';
    }

    if (!items.length) {
      const message = data ? 'No ' + escapeHtml(scheduledFilterLabel) + ' found.' : '' + escapeHtml(scheduledTitle) + ' are not loaded yet.';
      return '<section class="server-section-card server-scheduled-card">' + header + '<div class="server-placeholder">' + escapeHtml(message) + '</div></section>';
    }

    if (!filteredItems.length) {
      return '<section class="server-section-card server-scheduled-card">' + header + '<div class="server-placeholder">No ' + escapeHtml(scheduledFilterLabel) + ' match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('cron', 'server-scheduled-main', [
      { key: 'name', label: 'Name' },
      { key: 'entries', label: isWindowsScheduledTasks ? 'State' : 'Entries' },
      { key: 'type', label: 'Type' }
    ], '<div class="server-list-column-header-trailing"><span class="server-list-column-header-actions-space server-scheduled-actions-space" aria-hidden="true"></span></div>');
    return '<section class="server-section-card server-scheduled-card">' + header + columns + '<div class="server-list server-scheduled-list">'
      + visibleItems.map(item => {
        const name = String(item.name || item.source || 'Scheduled item');
        const countLabel = String(item.countLabel || '—');
        const typeLabel = String(item.typeLabel || item.sourceType || '—');
        const source = String(item.source || '');
        const sourceType = String(item.sourceType || '');
        const user = String(item.user || '');
        const path = String(item.path || '');
        const copyValue = String(item.copyValue || path || source || name);
        const isWindowsTask = sourceType === 'windows-task';
        const canOpen = isWindowsTask || item.canOpen !== false;
        const dataset = ' data-server-scheduled-id="' + escapeHtml(item.id || '') + '" data-server-scheduled-name="' + escapeHtml(name) + '" data-server-scheduled-count="' + escapeHtml(countLabel) + '" data-server-scheduled-type-label="' + escapeHtml(typeLabel) + '" data-server-scheduled-source="' + escapeHtml(source) + '" data-server-scheduled-source-type="' + escapeHtml(sourceType) + '" data-server-scheduled-user="' + escapeHtml(user) + '" data-server-scheduled-path="' + escapeHtml(path) + '" data-server-scheduled-copy="' + escapeHtml(copyValue) + '"';
        const openTooltip = isWindowsTask ? 'View Scheduled Task Details' : (canOpen ? 'Open Read-Only' : 'Open unavailable');
        const openLabel = isWindowsTask ? 'Details' : 'View';
        return '<div class="server-list-row server-scheduled-row"' + dataset + '>'
          + '<div class="server-list-main server-scheduled-main">'
          + '<span class="server-scheduled-name tooltip-above" data-tooltip="' + escapeHtml(source || name) + '">' + escapeHtml(name) + '</span>'
          + '<span class="server-scheduled-count tooltip-above" data-tooltip="' + escapeHtml(countLabel) + '">' + escapeHtml(countLabel) + '</span>'
          + '<span class="server-scheduled-type tooltip-above" data-tooltip="' + escapeHtml(typeLabel) + '">' + escapeHtml(typeLabel) + '</span>'
          + '</div><div class="server-scheduled-actions">'
          + '<span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(openTooltip) + '"><button class="secondary server-scheduled-action-button" type="button" data-server-scheduled-action="open"' + dataset + (canOpen ? '' : ' disabled') + '>' + escapeHtml(openLabel) + '</button></span>'
          + '<span class="tooltip-anchor tooltip-above" data-tooltip="Copy Source"><button class="secondary server-scheduled-action-button" type="button" data-server-scheduled-action="copy"' + dataset + '>Copy</button></span>'
          + '</div></div>';
      }).join('')
      + '</div></section>';
  }


  function createServerPortForwardId() {
    return 'pf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function sanitizeServerPortForward(value) {
    if (!value || typeof value !== 'object') return null;
    const id = String(value.id || '').trim();
    const localPort = Number(value.localPort || 0);
    const remotePort = Number(value.remotePort || 0);
    if (!id || !isValidServerPort(localPort) || !isValidServerPort(remotePort)) return null;
    const localHost = String(value.localHost || '').trim() || 'localhost';
    const remoteHost = String(value.remoteHost || '').trim() || '127.0.0.1';
    const name = String(value.name || '').trim() || buildServerPortForwardDefaultName(localPort, remotePort);
    return {
      id: id,
      name: name,
      localHost: localHost,
      localPort: localPort,
      remoteHost: remoteHost,
      remotePort: remotePort,
      autoStartOnConnect: Boolean(value.autoStartOnConnect),
      createdAt: Number(value.createdAt || Date.now()),
      updatedAt: Number(value.updatedAt || value.createdAt || Date.now())
    };
  }

  function createServerPortForward(values) {
    const now = Date.now();
    return {
      id: createServerPortForwardId(),
      name: String(values.name || '').trim() || buildServerPortForwardDefaultName(values.localPort, values.remotePort),
      localHost: String(values.localHost || '').trim() || 'localhost',
      localPort: Number(values.localPort || 0),
      remoteHost: String(values.remoteHost || '').trim() || '127.0.0.1',
      remotePort: Number(values.remotePort || 0),
      autoStartOnConnect: Boolean(values.autoStartOnConnect),
      createdAt: now,
      updatedAt: now
    };
  }

  function buildServerPortForwardDefaultName(localPort, remotePort) {
    const local = Number(localPort || 0);
    const remote = Number(remotePort || 0);
    if (local && remote) return local + ' → ' + remote;
    return 'Port forward';
  }

  function getServerPortForwardStorageKey(session) {
    return String((session && session.id) || activeConnectionId || '').trim();
  }

  function loadAllServerPortForwardsFromStorage() {
    try {
      return JSON.parse(localStorage.getItem(SERVER_PORT_FORWARDS_STORAGE_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function saveAllServerPortForwardsToStorage(all) {
    try {
      localStorage.setItem(SERVER_PORT_FORWARDS_STORAGE_KEY, JSON.stringify(all || {}));
      postPersistentStorageSnapshot();
    } catch (_) {
      // Ignore storage write errors.
    }
  }

  function getServerPortForwards(session) {
    const connectionId = getServerPortForwardStorageKey(session);
    if (!connectionId) return [];
    if (serverPortForwardsSessionByConnectionId.has(connectionId)) {
      return (serverPortForwardsSessionByConnectionId.get(connectionId) || []).map(sanitizeServerPortForward).filter(Boolean);
    }
    const all = loadAllServerPortForwardsFromStorage();
    const normalized = Array.isArray(all[connectionId]) ? all[connectionId].map(sanitizeServerPortForward).filter(Boolean) : [];
    serverPortForwardsSessionByConnectionId.set(connectionId, normalized);
    return normalized;
  }

  function saveServerPortForwards(session, forwards) {
    const connectionId = getServerPortForwardStorageKey(session);
    if (!connectionId) return;
    const normalized = (Array.isArray(forwards) ? forwards : []).map(sanitizeServerPortForward).filter(Boolean);
    serverPortForwardsSessionByConnectionId.set(connectionId, normalized);
    const all = loadAllServerPortForwardsFromStorage();
    all[connectionId] = normalized;
    saveAllServerPortForwardsToStorage(all);
  }

  function getServerPortForwardById(session, id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return null;
    return getServerPortForwards(session).find(item => item.id === normalizedId) || null;
  }

  function getServerPortForwardFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerPortForwardFilterText() {
    return serverPortForwardFiltersByConnectionId.get(getServerPortForwardFilterKey()) || '';
  }

  function setServerPortForwardFilterText(value) {
    const key = getServerPortForwardFilterKey();
    const text = String(value || '');
    if (text) serverPortForwardFiltersByConnectionId.set(key, text);
    else serverPortForwardFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusPortForwardsFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverPortForwardsFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerPortForwardFilter(item, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const haystack = [
      item && item.name,
      item && item.localHost,
      item && item.localPort,
      item && item.remoteHost,
      item && item.remotePort,
      item && item.autoStartOnConnect ? 'auto auto-start autostart' : '',
      formatServerPortForwardTarget(item)
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function getServerPortForwardRuntimeMap(connectionId) {
    const key = String(connectionId || '').trim();
    if (!key) return new Map();
    let map = serverPortForwardRuntimeByConnectionId.get(key);
    if (!map) {
      map = new Map();
      serverPortForwardRuntimeByConnectionId.set(key, map);
    }
    return map;
  }

  function getServerPortForwardRuntimeState(connectionId, id) {
    const map = getServerPortForwardRuntimeMap(connectionId);
    return map.get(String(id || '').trim()) || { id: String(id || '').trim(), connectionId: connectionId, status: 'stopped', error: '' };
  }

  function setServerPortForwardRuntimeState(connectionId, state) {
    const id = String(state && state.id || '').trim();
    if (!connectionId || !id) return;
    const map = getServerPortForwardRuntimeMap(connectionId);
    map.set(id, {
      id: id,
      connectionId: connectionId,
      status: String(state.status || 'stopped'),
      error: String(state.error || ''),
      localUrl: String(state.localUrl || '')
    });
  }

  function handleServerPortForwardState(payload) {
    const connectionId = String(payload.connectionId || '').trim();
    const id = String(payload.id || '').trim();
    if (!connectionId || !id) return;
    setServerPortForwardRuntimeState(connectionId, payload);
    const pendingKey = connectionId + ':' + id;
    const pendingAction = serverPortForwardPendingActions.get(pendingKey) || '';
    const nextStatus = String(payload.status || '').trim();
    if (connectionId === activeConnectionId && pendingAction) {
      if ((nextStatus === 'running' && pendingAction === 'start') || (nextStatus === 'stopped' && pendingAction === 'stop')) {
        serverPortForwardPendingActions.delete(pendingKey);
      } else if (nextStatus === 'error') {
        const errorText = String(payload.error || '').trim();
        showServerToolbarStatus(errorText ? 'Port forward failed: ' + errorText : 'Port forward failed.', 'error', 7000);
        serverPortForwardPendingActions.delete(pendingKey);
      }
    }
    if (connectionId === activeConnectionId) {
      renderServerView();
    }
  }

  function formatServerPortForwardTarget(item) {
    if (!item) return '';
    return String(item.localHost || 'localhost') + ':' + String(item.localPort || '') + ' → ' + String(item.remoteHost || '127.0.0.1') + ':' + String(item.remotePort || '');
  }

  function isServerPortForwardBusy(status) {
    return status === 'starting' || status === 'stopping';
  }

  function isValidServerPort(port) {
    const value = Number(port || 0);
    return Number.isInteger(value) && value >= 1 && value <= 65535;
  }

  function normalizeServerPortForwardHost(value, fallback) {
    return String(value || '').trim() || fallback;
  }

  function markServerPortForwardInputInvalid(input, invalid) {
    if (!input) return;
    input.classList.toggle('server-port-forward-input-invalid', Boolean(invalid));
  }

  function readServerPortForwardDialogValues(showFeedback) {
    const name = String(serverPortForwardNameInput.value || '').trim();
    const localHost = normalizeServerPortForwardHost(serverPortForwardLocalHostInput.value, 'localhost');
    const remoteHost = normalizeServerPortForwardHost(serverPortForwardRemoteHostInput.value, '127.0.0.1');
    const localPort = Number(String(serverPortForwardLocalPortInput.value || '').trim());
    const remotePort = Number(String(serverPortForwardRemotePortInput.value || '').trim());
    const autoStartOnConnect = Boolean(serverPortForwardAutoStartInput && serverPortForwardAutoStartInput.checked);
    const localPortValid = isValidServerPort(localPort);
    const remotePortValid = isValidServerPort(remotePort);
    const localHostValid = Boolean(localHost);
    const remoteHostValid = Boolean(remoteHost);
    markServerPortForwardInputInvalid(serverPortForwardLocalPortInput, !localPortValid && showFeedback);
    markServerPortForwardInputInvalid(serverPortForwardRemotePortInput, !remotePortValid && showFeedback);
    markServerPortForwardInputInvalid(serverPortForwardLocalHostInput, !localHostValid && showFeedback);
    markServerPortForwardInputInvalid(serverPortForwardRemoteHostInput, !remoteHostValid && showFeedback);
    if (!localHostValid || !remoteHostValid || !localPortValid || !remotePortValid) {
      if (showFeedback && serverPortForwardFeedback) serverPortForwardFeedback.textContent = 'Enter valid hosts and ports between 1 and 65535.';
      return null;
    }
    if (serverPortForwardFeedback) serverPortForwardFeedback.textContent = '';
    return { name: name || buildServerPortForwardDefaultName(localPort, remotePort), localHost, localPort, remoteHost, remotePort, autoStartOnConnect };
  }

  function showServerPortForwardDialog(mode, forwardId) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;
    const editing = mode === 'edit';
    const forward = editing ? getServerPortForwardById(active, forwardId) : null;
    const runtime = forward ? getServerPortForwardRuntimeState(activeConnectionId, forward.id) : null;
    const status = runtime ? String(runtime.status || 'stopped') : 'stopped';
    const running = status === 'running' || status === 'starting' || status === 'stopping';

    serverPortForwardDialogOpen = true;
    serverPortForwardDialogMode = editing && forward ? 'edit' : 'add';
    serverPortForwardDialogForwardId = forward ? forward.id : '';
    if (serverPortForwardTitle) serverPortForwardTitle.textContent = forward ? 'Edit Port Forward' : 'Add Port Forward';
    if (serverPortForwardSubtitle) serverPortForwardSubtitle.textContent = forward ? formatServerPortForwardTarget(forward) : 'Create a local SSH port forward for this connection.';
    serverPortForwardNameInput.value = forward ? forward.name : '';
    serverPortForwardLocalHostInput.value = forward ? forward.localHost : 'localhost';
    serverPortForwardLocalPortInput.value = forward ? String(forward.localPort) : '';
    serverPortForwardRemoteHostInput.value = forward ? forward.remoteHost : '127.0.0.1';
    serverPortForwardRemotePortInput.value = forward ? String(forward.remotePort) : '';
    if (serverPortForwardAutoStartInput) serverPortForwardAutoStartInput.checked = Boolean(forward && forward.autoStartOnConnect);
    if (serverPortForwardFeedback) serverPortForwardFeedback.textContent = '';
    for (const input of [serverPortForwardNameInput, serverPortForwardLocalHostInput, serverPortForwardLocalPortInput, serverPortForwardRemoteHostInput, serverPortForwardRemotePortInput]) {
      if (input) input.classList.remove('server-port-forward-input-invalid');
    }
    for (const input of [serverPortForwardNameInput, serverPortForwardLocalHostInput, serverPortForwardLocalPortInput, serverPortForwardRemoteHostInput, serverPortForwardRemotePortInput]) {
      if (input) input.disabled = running;
    }
    if (serverPortForwardAutoStartInput) serverPortForwardAutoStartInput.disabled = running;
    if (serverPortForwardRunningNote) serverPortForwardRunningNote.hidden = !running;
    if (serverPortForwardDeleteButton) {
      serverPortForwardDeleteButton.hidden = !forward;
      serverPortForwardDeleteButton.disabled = running;
    }
    if (serverPortForwardSaveButton) serverPortForwardSaveButton.disabled = running;
    serverPortForwardBackdrop.classList.add('visible');
    serverPortForwardBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (running) serverPortForwardCancelButton.focus();
      else serverPortForwardNameInput.focus();
    }, 0);
  }

  function hideServerPortForwardDialog() {
    serverPortForwardDialogOpen = false;
    serverPortForwardDialogMode = 'add';
    serverPortForwardDialogForwardId = '';
    serverPortForwardBackdrop.classList.remove('visible');
    serverPortForwardBackdrop.setAttribute('aria-hidden', 'true');
  }

  function saveServerPortForwardDialog(startAfterSave) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return null;
    const existing = serverPortForwardDialogMode === 'edit' ? getServerPortForwardById(active, serverPortForwardDialogForwardId) : null;
    if (existing) {
      const runtime = getServerPortForwardRuntimeState(activeConnectionId, existing.id);
      if (runtime.status === 'running' || runtime.status === 'starting' || runtime.status === 'stopping') {
        if (startAfterSave && runtime.status === 'running') requestStopServerPortForward(existing.id);
        return existing;
      }
    }
    const values = readServerPortForwardDialogValues(true);
    if (!values) return null;
    const forwards = getServerPortForwards(active).slice();
    let saved;
    if (existing) {
      const index = forwards.findIndex(item => item.id === existing.id);
      if (index < 0) return null;
      saved = Object.assign({}, existing, values, { updatedAt: Date.now() });
      forwards[index] = saved;
    } else {
      saved = createServerPortForward(values);
      forwards.push(saved);
    }
    saveServerPortForwards(active, forwards);
    hideServerPortForwardDialog();
    renderServerView();
    if (startAfterSave && saved) {
      requestStartServerPortForward(saved);
    }
    return saved;
  }

  function requestServerPortForwardStatesForSession(session) {
    if (!session || !isServerViewSupported(session)) return;
    const connectionId = getServerPortForwardStorageKey(session);
    if (!connectionId) return;
    const ids = getServerPortForwards(session).map(item => item.id).filter(Boolean);
    if (!ids.length) return;
    vscode.postMessage({ type: 'requestPortForwardState', payload: { connectionId: connectionId, ids: ids } });
  }

  function maybeAutoStartServerPortForwardsForSession(session, isNewConnection) {
    if (!isNewConnection || !session || !isServerViewSupported(session)) return;
    const connectionId = getServerPortForwardStorageKey(session);
    if (!connectionId || serverPortForwardAutoStartedConnectionIds.has(connectionId)) return;
    serverPortForwardAutoStartedConnectionIds.add(connectionId);
    const forwards = getServerPortForwards(session).filter(item => item && item.autoStartOnConnect);
    forwards.forEach(forward => {
      const runtime = getServerPortForwardRuntimeState(connectionId, forward.id);
      if (runtime.status === 'running' || runtime.status === 'starting') return;
      requestStartServerPortForwardForConnection(connectionId, forward);
    });
  }

  function requestStartServerPortForwardForConnection(connectionId, forward) {
    if (!forward || !connectionId) return;
    serverPortForwardPendingActions.set(connectionId + ':' + forward.id, 'start');
    setServerPortForwardRuntimeState(connectionId, { id: forward.id, connectionId: connectionId, status: 'starting', error: '' });
    if (connectionId === activeConnectionId) renderServerView();
    vscode.postMessage({ type: 'startPortForward', payload: { connectionId: connectionId, forward: forward } });
  }

  function requestStartServerPortForward(forward) {
    requestStartServerPortForwardForConnection(activeConnectionId, forward);
  }

  function requestStopServerPortForward(forwardId) {
    if (!forwardId || !activeConnectionId) return;
    serverPortForwardPendingActions.set(activeConnectionId + ':' + forwardId, 'stop');
    setServerPortForwardRuntimeState(activeConnectionId, { id: forwardId, connectionId: activeConnectionId, status: 'stopping', error: '' });
    renderServerView();
    vscode.postMessage({ type: 'stopPortForward', payload: { connectionId: activeConnectionId, id: forwardId } });
  }

  function handleServerPortForwardAction(action, forwardId) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;
    if (action === 'add') {
      showServerPortForwardDialog('add', '');
      return;
    }
    const forward = getServerPortForwardById(active, forwardId);
    if (!forward) return;
    const runtime = getServerPortForwardRuntimeState(activeConnectionId, forward.id);
    if (action === 'stop') {
      requestStopServerPortForward(forward.id);
      return;
    }
    if (action === 'start') {
      requestStartServerPortForward(forward);
      return;
    }
    showServerPortForwardDialog('edit', forward.id);
  }

  function showServerPortForwardRemoveDialog() {
    const active = getActiveSession();
    if (!active || !serverPortForwardDialogForwardId) return;
    const forward = getServerPortForwardById(active, serverPortForwardDialogForwardId);
    if (!forward) return;
    serverPortForwardRemoveDialogOpen = true;
    serverPortForwardRemoveId = forward.id;
    if (serverPortForwardRemovePath) serverPortForwardRemovePath.textContent = forward.name + ' — ' + formatServerPortForwardTarget(forward);
    serverPortForwardRemoveBackdrop.classList.add('visible');
    serverPortForwardRemoveBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => serverPortForwardRemoveCancelButton.focus(), 0);
  }

  function hideServerPortForwardRemoveDialog() {
    serverPortForwardRemoveDialogOpen = false;
    serverPortForwardRemoveId = '';
    serverPortForwardRemoveBackdrop.classList.remove('visible');
    serverPortForwardRemoveBackdrop.setAttribute('aria-hidden', 'true');
  }

  function confirmRemoveServerPortForward() {
    const active = getActiveSession();
    if (!active || !serverPortForwardRemoveId) return;
    const runtime = getServerPortForwardRuntimeState(activeConnectionId, serverPortForwardRemoveId);
    if (runtime.status === 'running' || runtime.status === 'starting' || runtime.status === 'stopping') {
      requestStopServerPortForward(serverPortForwardRemoveId);
    }
    const forwards = getServerPortForwards(active).filter(item => item.id !== serverPortForwardRemoveId);
    saveServerPortForwards(active, forwards);
    hideServerPortForwardRemoveDialog();
    hideServerPortForwardDialog();
    renderServerView();
  }

  function renderServerPortForwarding() {
    const active = getActiveSession();
    const forwards = getServerPortForwards(active);
    const filterText = getServerPortForwardFilterText();
    const filtered = forwards.filter(item => matchesServerPortForwardFilter(item, filterText));
    const visible = sortServerItems('portForwards', filtered, (item, key) => {
      if (key === 'target') return formatServerPortForwardTarget(item);
      if (key === 'status') return (item && item.autoStartOnConnect ? 'auto ' : '') + getServerPortForwardRuntimeState(activeConnectionId, item && item.id).status;
      return item && item.name;
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countDetail = formatServerListCount(forwards.length, filtered.length, filterHasValue, false);
    const filterBox = '<div class="server-port-forwards-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverPortForwardsFilterInput" class="server-port-forwards-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter forwards" value="' + escapeHtml(filterText) + '" aria-label="Filter port forwards"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Port Forwarding Filter" data-tooltip="Clear Filter" data-server-port-forwards-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div>';
    const addButton = '<span class="tooltip-anchor tooltip-above" data-tooltip="Add port forward"><button class="secondary remote-command-icon-button" type="button" aria-label="Add port forward" data-server-port-forward-action="add"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 3h1v4.5H13v1H8.5V13h-1V8.5H3v-1h4.5V3Z"></path></svg></button></span>';
    const header = '<div class="server-section-title-row server-port-forwards-title-row"><div class="server-section-title-wrap"><div class="server-section-title">Port Forwarding</div><span class="server-section-count">' + escapeHtml(countDetail) + '</span></div><div class="server-section-title-right"><div class="server-section-title-actions">' + addButton + '</div><span class="server-section-title-separator" aria-hidden="true"></span>' + filterBox + '</div></div>';

    if (!forwards.length) {
      return '<section class="server-section-card server-port-forwards-card">' + header + '<div class="server-port-forward-empty">No port forwards yet. Use + to add one.</div></section>';
    }

    if (!filtered.length) {
      return '<section class="server-section-card server-port-forwards-card">' + header + '<div class="server-port-forward-empty">No port forwards match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('portForwards', 'server-port-forward-main', [
      { key: 'name', label: 'Name' },
      { key: 'target', label: 'Target' }
    ], '<div class="server-port-forward-trailing server-list-column-header-trailing">' + renderServerSortButton('portForwards', 'status', 'Status') + '<span class="server-list-column-header-actions-space server-port-forward-actions-space" aria-hidden="true"></span></div>');
    return '<section class="server-section-card server-port-forwards-card">' + header + columns + '<div class="server-list server-port-forwards-list">'
      + visible.map(item => {
        const runtime = getServerPortForwardRuntimeState(activeConnectionId, item.id);
        const status = String(runtime.status || 'stopped');
        const action = status === 'running' ? 'stop' : 'start';
        const label = status === 'running' ? 'Stop' : 'Start';
        const disabled = isServerPortForwardBusy(status);
        const target = formatServerPortForwardTarget(item);
        const statusTooltip = status === 'error' && runtime.error ? runtime.error : status;
        const autoBadge = item.autoStartOnConnect ? '<span class="server-port-forward-auto-badge tooltip-above" data-tooltip="Auto-start on connect">auto-start</span>' : '';
        return '<div class="server-list-row server-port-forward-row" data-server-port-forward-id="' + escapeHtml(item.id) + '" data-tooltip="Edit port forward">'
          + '<div class="server-list-main server-port-forward-main"><span class="server-port-forward-name tooltip-above" data-tooltip="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span><span class="server-port-forward-target tooltip-above" data-tooltip="' + escapeHtml(target) + '">' + escapeHtml(target) + '</span></div>'
          + '<div class="server-port-forward-trailing">' + autoBadge + '<span class="server-port-forward-status ' + escapeHtml(status) + ' tooltip-above" data-tooltip="' + escapeHtml(statusTooltip) + '">' + escapeHtml(status) + '</span><div class="server-port-forward-actions"><span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(disabled ? status : label + ' forward') + '"><button class="secondary server-port-forward-action-button" type="button" data-server-port-forward-action="' + escapeHtml(action) + '" data-server-port-forward-id="' + escapeHtml(item.id) + '"' + (disabled ? ' disabled' : '') + '>' + escapeHtml(label) + '</button></span></div></div>'
          + '</div>';
      }).join('')
      + '</div></section>';
  }

  function renderServerSystemInfo(session) {
    const state = getActiveServerDashboardState();
    const data = state && state.data ? state.data : null;
    const loadingValue = state && state.loading ? 'Loading...' : '—';
    const items = data && Array.isArray(data.systemInfo)
      ? data.systemInfo
      : [
        { label: 'OS', value: loadingValue },
        { label: 'OS Version', value: loadingValue },
        { label: 'Adapter', value: loadingValue },
        { label: 'Hostname', value: session.host || loadingValue },
        { label: 'IP Addresses', value: loadingValue },
        { label: 'User', value: session.username || loadingValue },
        { label: 'Group', value: loadingValue },
        { label: 'Home', value: loadingValue },
        { label: 'Shell', value: loadingValue },
        { label: 'Architecture', value: loadingValue },
        { label: 'Protocol', value: getConnectionTypeLabel(session.connectionType) },
        { label: 'Sudo', value: formatServerSudoLabel(session) },
        { label: 'Server Time', value: loadingValue },
        { label: 'Last refresh', value: '—' }
      ];
    const errorBlock = state && state.error ? '<div class="server-placeholder">' + escapeHtml(state.error) + '</div>' : '';
    return '<section class="server-section-card full-width"><div class="server-section-title-row"><div class="server-section-title">System Info</div></div>' + errorBlock + '<div class="server-system-info-grid">'
      + items.map(item => '<div class="server-system-info-item"><div class="server-system-info-label">' + escapeHtml(item.label || '') + '</div><div class="server-system-info-value tooltip-above" data-tooltip="' + escapeHtml(item.value || '—') + '">' + escapeHtml(item.value || '—') + '</div></div>').join('')
      + '</div></section>';
  }


  function renderServerUnsupported(session) {
    const protocol = getConnectionTypeLabel(session && session.connectionType);
    return '<div class="server-disabled-state"><div><div class="server-disabled-title">Server management requires SSH/SFTP.</div><div>' + escapeHtml(protocol) + ' connections support file browsing and transfers only.</div></div></div>';
  }

  function getServerAutoRefreshLabel(value) {
    if (value === '15') return 'Auto: 15s';
    if (value === '30') return 'Auto: 30s';
    if (value === '60') return 'Auto: 1m';
    if (value === '300') return 'Auto: 5m';
    return 'Auto: Off';
  }

  function updateServerAutoRefreshDropdown() {
    if (serverAutoRefreshDropdownLabel) serverAutoRefreshDropdownLabel.textContent = getServerAutoRefreshLabel(serverAutoRefreshValue);
    if (!serverAutoRefreshDropdownMenu) return;
    Array.from(serverAutoRefreshDropdownMenu.querySelectorAll('[data-server-auto-refresh]')).forEach(item => {
      const selected = item.getAttribute('data-server-auto-refresh') === serverAutoRefreshValue;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function showServerAutoRefreshDropdown() {
    if (!serverAutoRefreshDropdownButton || !serverAutoRefreshDropdownMenu || serverAutoRefreshDropdownButton.disabled) return;
    hideProfileDropdown();
    hideConnectionTypeDropdown();
    hideAuthDropdown();
    serverAutoRefreshDropdownOpen = true;
    const picker = serverAutoRefreshDropdownButton.closest('#serverAutoRefreshPicker');
    if (picker) picker.classList.add('open');
    serverAutoRefreshDropdownButton.setAttribute('aria-expanded', 'true');
    updateServerAutoRefreshDropdown();
  }

  function hideServerAutoRefreshDropdown() {
    if (!serverAutoRefreshDropdownButton) return;
    serverAutoRefreshDropdownOpen = false;
    const picker = serverAutoRefreshDropdownButton.closest('#serverAutoRefreshPicker');
    if (picker) picker.classList.remove('open');
    serverAutoRefreshDropdownButton.setAttribute('aria-expanded', 'false');
  }

  function toggleServerAutoRefreshDropdown() {
    if (serverAutoRefreshDropdownOpen) {
      hideServerAutoRefreshDropdown();
    } else {
      showServerAutoRefreshDropdown();
    }
  }

  function selectServerAutoRefresh(value) {
    const nextValue = ['15', '30', '60', '300'].includes(value) ? value : 'off';
    serverAutoRefreshValue = nextValue;
    updateServerAutoRefreshDropdown();
    resetServerAutoRefreshCountdown();
    updateServerAutoRefreshTimer();
  }

  function renderConnectionViewSwitchMarkup(extraClass) {
    const className = 'connection-view-switch' + (extraClass ? ' ' + extraClass : '');
    return '<div class="' + className + '" role="tablist" aria-label="Connection View"><button class="connection-view-switch-button" type="button" role="tab" aria-selected="false" aria-controls="filesView" data-connection-view="files">Files</button><button class="connection-view-switch-button" type="button" role="tab" aria-selected="false" aria-controls="serverView" data-connection-view="server">Server</button></div>';
  }

  function renderServerViewIfActiveRemoteCommandConnection(connectionId) {
    if (getActiveConnectionView() !== 'server') return;
    if (String(connectionId || activeConnectionId || '') !== String(activeConnectionId || '')) return;
    renderServerView();
  }

  function renderServerView() {
    if (!serverViewContent) return;
    const previousScrollState = captureServerViewScrollState();
    const active = getActiveSession();
    if (!active) {
      serverViewContent.removeAttribute('data-server-view-connection-id');
      serverViewContent.innerHTML = '<div class="server-disabled-state"><div><div class="server-disabled-title">No active connection.</div><div>Connect to a host to use the Server view.</div></div></div>';
      return;
    }

    const connectionId = String(active.id || activeConnectionId || '');
    serverViewContent.setAttribute('data-server-view-connection-id', connectionId);

    if (!isServerViewSupported(active)) {
      serverViewContent.innerHTML = renderServerUnsupported(active);
      return;
    }

    serverViewContent.innerHTML = '<div class="server-overview-grid">' + renderServerOverviewCards() + '</div>'
      + '<div class="server-grid">' + renderServerQuickTasks() + renderServerLogs(active) + renderServerServices() + renderServerProcesses() + renderServerCron() + renderServerPortForwarding() + renderServerSystemInfo(active) + '</div>';
    restoreServerViewScrollState(previousScrollState, connectionId);
  }

  function updateConnectionViewUi() {
    const active = getActiveSession();
    const hasActive = Boolean(active);
    pruneConnectionViewState();

    const activeView = getActiveConnectionView();
    const serverSupported = isServerViewSupported(active);

    if (filesView) filesView.classList.toggle('hidden', activeView !== 'files');
    if (serverView) serverView.classList.toggle('hidden', activeView !== 'server');
    if (pathbar) pathbar.classList.toggle('server-toolbar-mode', activeView === 'server');
    if (serverToolbarStatus) {
      serverToolbarStatus.hidden = activeView !== 'server';
      if (activeView !== 'server') serverToolbarStatus.classList.remove('visible');
    }
    updateServerAutoRefreshCountdownDisplay();
    const showServerRefreshControls = activeView === 'server' && hasActive && serverSupported;
    if (serverRefreshActions) serverRefreshActions.hidden = !showServerRefreshControls;
    if (serverRefreshActionsSeparator) serverRefreshActionsSeparator.hidden = !showServerRefreshControls;
    if (serverRefreshButton) serverRefreshButton.disabled = !showServerRefreshControls;
    if (serverAutoRefreshDropdownButton) serverAutoRefreshDropdownButton.disabled = !showServerRefreshControls;
    if (!showServerRefreshControls) hideServerAutoRefreshDropdown();
    renderServerView();
    updateServerRefreshBusyState();
    maybeRequestServerDashboardForActiveView();
    updateServerAutoRefreshTimer();

    const showConnectionViewSwitch = !hasActive || serverSupported;
    if (pathbar) pathbar.classList.toggle('hide-view-switch-actions', !showConnectionViewSwitch);
    document.querySelectorAll('.connection-view-switch').forEach(switchEl => {
      switchEl.hidden = !showConnectionViewSwitch;
    });
    document.querySelectorAll('.view-switch-separator').forEach(separator => {
      separator.hidden = !showConnectionViewSwitch;
    });
    document.querySelectorAll('[data-connection-view]').forEach(button => {
      const view = button.getAttribute('data-connection-view') || 'files';
      const isActive = view === activeView;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.disabled = !hasActive || (view === 'server' && !serverSupported);
      if (hasActive && view === 'server' && !serverSupported) { button.setAttribute('data-tooltip', 'Server management requires SSH/SFTP.'); } else { button.removeAttribute('data-tooltip'); }
    });
  }

  function handleServerViewAction(action) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;
    if (action === 'open-files') {
      setActiveConnectionView('files');
      return;
    }
    if (action === 'open-terminal') {
      vscode.postMessage({ type: 'requestOpenSshTerminal', payload: { connectionId: activeConnectionId, workingDirectory: normalizeUiRemotePath(currentPath.value || active.currentPath || '/') } });
      return;
    }
    if (action === 'run-command') {
      showRemoteCommandDialog(normalizeUiRemotePath(currentPath.value || active.currentPath || '/'));
      return;
    }
    if (action === 'open-log-viewer') {
      vscode.postMessage({ type: 'requestOpenLogViewer', payload: { connectionId: activeConnectionId } });
      return;
    }
    if (action === 'refresh') {
      requestServerDashboardRefresh(true);
`;}
