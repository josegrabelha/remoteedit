export function renderRemoteCommandActions(): string {
  return `    }
  }


  function getRemoteCommandConnectionSudoDefault(connectionId) {
    const active = sessions.find(item => item.id === connectionId) || getActiveSession();
    const username = active ? String(active.username || '').trim() : '';
    const isRootConnection = username.toLowerCase() === 'root';
    return Boolean(active && active.sudoModeEnabled && !isRootConnection);
  }

  function resetRemoteCommandSessionForQuickTask(state, workingDirectory) {
    if (!state || state.status === 'running') return;
    state.status = 'idle';
    state.commandId = '';
    state.command = '';
    state.workingDirectory = normalizeUiRemotePath(workingDirectory || state.workingDirectory || currentPath.value || '/');
    state.useSudo = getRemoteCommandConnectionSudoDefault(state.connectionId || activeConnectionId);
    state.outputText = '';
    state.finalMessage = '';
    state.outputViewLimited = false;
    state.stopping = false;
    state.forceKilling = false;
    state.exitCode = undefined;
    state.error = '';
    state.startedAt = 0;
    state.finishedAt = 0;
    state.finishedBadgeVisible = false;
    state.commandCount = 0;
    state.failedCommandCount = 0;
    clearRemoteCommandStopEscalationTimer();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');
  }

  function handleServerQuickTaskAction(commandId, autoRun) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active) || !activeConnectionId) return;

    const state = getRemoteCommandSession(activeConnectionId);
    const workingDirectory = normalizeUiRemotePath(currentPath.value || active.currentPath || '/');
    if (state.status === 'running') {
      showRemoteCommandDialog(workingDirectory);
      return;
    }

    const id = String(commandId || '').trim();
    const item = getRemoteCommandSavedList(activeConnectionId).find(command => command.id === id);
    if (!item) {
      resetRemoteCommandSessionForQuickTask(state, workingDirectory);
      showRemoteCommandDialog(workingDirectory);
      renderRemoteCommandSession();
      return;
    }

    resetRemoteCommandSessionForQuickTask(state, workingDirectory);
    showRemoteCommandDialog(workingDirectory);
    renderRemoteCommandSession();
    loadRemoteCommandIntoEditor(item, false);

    if (autoRun) {
      runRemoteCommandFromDialog();
    }
  }

  function handleServerQuickTaskAddAction() {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active) || !activeConnectionId) return;

    const state = getRemoteCommandSession(activeConnectionId);
    const workingDirectory = normalizeUiRemotePath(currentPath.value || active.currentPath || '/');
    if (state.status === 'running') {
      showRemoteCommandDialog(workingDirectory);
      return;
    }

    resetRemoteCommandSessionForQuickTask(state, workingDirectory);
    showRemoteCommandDialog(workingDirectory);
    renderRemoteCommandSession();
  }

  function readServerScheduledJobDataset(element) {
    return {
      id: element.getAttribute('data-server-scheduled-id') || '',
      name: element.getAttribute('data-server-scheduled-name') || '',
      countLabel: element.getAttribute('data-server-scheduled-count') || '',
      typeLabel: element.getAttribute('data-server-scheduled-type-label') || '',
      source: element.getAttribute('data-server-scheduled-source') || '',
      sourceType: element.getAttribute('data-server-scheduled-source-type') || '',
      user: element.getAttribute('data-server-scheduled-user') || '',
      path: element.getAttribute('data-server-scheduled-path') || '',
      copyValue: element.getAttribute('data-server-scheduled-copy') || ''
    };
  }

  function handleServerScheduledJobAction(action, item, feedbackTarget = null) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active) || !activeConnectionId) return;

    const payload = Object.assign({}, item || {}, { connectionId: activeConnectionId, action: action || 'open' });
    if (action === 'copy') {
      const value = String(payload.copyValue || payload.path || payload.source || payload.name || '').trim();
      if (!value) return;
      void copyTextFromEditableMenu(value);
      showTransientActionTooltip(feedbackTarget, 'Copied');
      return;
    }
    vscode.postMessage({ type: 'requestServerScheduledJobAction', payload: payload });
  }

  function readServerProcessDataset(element) {
    return {
      pid: element.getAttribute('data-server-process-pid') || '',
      user: element.getAttribute('data-server-process-user') || '',
      state: element.getAttribute('data-server-process-state') || '',
      isZombie: element.getAttribute('data-server-process-is-zombie') === 'true',
      cpu: element.getAttribute('data-server-process-cpu') || '',
      memory: element.getAttribute('data-server-process-memory') || '',
      command: element.getAttribute('data-server-process-command') || '',
      args: element.getAttribute('data-server-process-args') || '',
      adapter: element.getAttribute('data-server-process-adapter') || ''
    };
  }

  function handleServerProcessAction(action, process) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active) || !activeConnectionId) return;

    const pid = String(process && process.pid || '').trim();
    if (!pid) return;

    const payload = Object.assign({}, process || {}, { connectionId: activeConnectionId, pid: pid });
    if (action === 'details') {
      vscode.postMessage({ type: 'requestServerProcessDetails', payload: payload });
      return;
    }

    if (action === 'kill') {
      vscode.postMessage({ type: 'requestServerProcessAction', payload: payload });
    }
  }

  function handleServerServiceAction(action, serviceName, adapter) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active) || !activeConnectionId) return;

    const normalizedName = String(serviceName || '').trim();
    const normalizedAdapter = String(adapter || '').trim();
    if (!normalizedName) return;

    if (action === 'details') {
      vscode.postMessage({ type: 'requestServerServiceDetails', payload: { connectionId: activeConnectionId, name: normalizedName, adapter: normalizedAdapter } });
      return;
    }

    if (action === 'start' || action === 'stop' || action === 'restart') {
      vscode.postMessage({ type: 'requestServerServiceAction', payload: { connectionId: activeConnectionId, name: normalizedName, adapter: normalizedAdapter, action: action } });
    }
  }

  function handleServerLogAction(action, shortcutId, path, feedbackTarget = null) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;

    if (action === 'add') {
      showServerLogShortcutDialog('add', '');
      return;
    }

    const shortcut = shortcutId ? getServerLogShortcutById(active, shortcutId) : null;
    const normalizedPath = normalizeUiRemotePath((shortcut && shortcut.path) || path || '');
    if (!activeConnectionId || !normalizedPath || normalizedPath === '/') return;

    if (action === 'edit') {
      if (shortcut) showServerLogShortcutDialog('edit', shortcut.id);
      return;
    }

    if (action === 'remove') {
      if (shortcut) showServerLogShortcutRemoveDialog(shortcut.id);
      return;
    }

    if (action === 'copy') {
      void copyTextFromEditableMenu(normalizedPath);
      showTransientActionTooltip(feedbackTarget, 'Copied');
      return;
    }

    const entry = {
      path: normalizedPath,
      name: (shortcut && shortcut.name) || getRemotePathBasename(normalizedPath),
      type: 'file',
      effectiveType: 'file',
      linkTarget: '',
      permissions: ''
    };

    if (action === 'open') {
      vscode.postMessage({ type: 'openEntries', payload: { entries: [entry] } });
      return;
    }

    if (action === 'follow') {
      vscode.postMessage({ type: 'requestOpenLogViewer', payload: { connectionId: activeConnectionId, path: normalizedPath } });
      return;
    }

    vscode.postMessage({ type: 'openEntriesReadOnly', payload: { entries: [entry] } });
  }

  function updateSudoToggle() {
    const active = getActiveSession();
    const capabilities = getActiveRemoteCapabilities();
    const enabled = Boolean(capabilities.canUseSudo && active && active.sudoModeEnabled);
    const isRootConnection = Boolean(capabilities.canUseSudo && active && String(active.username || '').trim().toLowerCase() === 'root');
    const isPrivilegedSession = enabled || isRootConnection;

    sudoToggle.checked = enabled;
    sudoToggleLabel.classList.toggle('enabled', enabled);
    sudoToggleLabel.classList.toggle('disabled', Boolean(sudoToggle.disabled));
    sudoToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    entriesTableWrap.classList.toggle('privileged-session', isPrivilegedSession);
    sudoToggleLabel.dataset.tooltip = !active
      ? 'Enable Sudo Mode'
      : enabled
        ? 'Disable Sudo Mode'
        : 'Enable Sudo Mode';
  }

  function updateActiveSessionUi() {
    const active = getActiveSession();
    if (!active) {
      browserSubtitle.textContent = sessions.length ? 'Select an open connection tab to browse remote files.' : 'Connect to a host to list remote files.';
      currentPath.value = '';
      updateRemotePathBreadcrumb();
      updateRemotePathActionButton();
      updateSudoToggle();
      return;
    }

    browserSubtitle.textContent = formatConnectionLabel(active.name, formatSessionTarget(active));
    if (active.currentPath) {
      currentPath.value = active.currentPath;
    }
    updateRemotePathBreadcrumb();
    updateRemotePathActionButton();
    updateSudoToggle();
  }

  function updateActiveSessionPath(path) {
    const active = getActiveSession();
    if (!active) return;
    active.currentPath = normalizeUiRemotePath(path || '/');
    updateRemotePathActionButton();
    renderSessionTabs();
  }

  function enterRemotePathEditMode(options = {}) {
    if (!activeConnectionId || busy || currentPath.disabled) return;
    hideRemotePathDropdown();
    remotePathEditing = true;
    remotePathBox.classList.remove('path-breadcrumb-mode');
    remotePathBox.classList.add('path-edit-mode');
    if (document.activeElement !== currentPath) currentPath.focus();
    if (options.select) currentPath.select();
  }

  function exitRemotePathEditMode(options = {}) {
    if (options.reset) {
      const active = getActiveSession();
      currentPath.value = active && active.currentPath ? active.currentPath : (activeConnectionId ? '/' : '');
    }

    remotePathEditing = false;
    remotePathBox.classList.remove('path-edit-mode');
    updateRemotePathBreadcrumb();
    updateRemotePathActionButton();

    if (!options.keepFocus && document.activeElement === currentPath) {
      currentPath.blur();
    }
  }

  function updateRemotePathBreadcrumbOverflow() {
    if (!remotePathBreadcrumb) return;

    remotePathBreadcrumb.classList.remove('is-truncated');
    remotePathBreadcrumb.scrollLeft = 0;

    requestAnimationFrame(() => {
      if (!remotePathBreadcrumb || !remotePathBox.classList.contains('path-breadcrumb-mode')) return;

      const isOverflowing = remotePathBreadcrumb.scrollWidth > remotePathBreadcrumb.clientWidth + 1;
      remotePathBreadcrumb.classList.toggle('is-truncated', isOverflowing);

      if (isOverflowing) {
        requestAnimationFrame(() => {
          if (!remotePathBreadcrumb) return;
          remotePathBreadcrumb.scrollLeft = remotePathBreadcrumb.scrollWidth;
        });
      }
    });
  }

  function updateRemotePathBreadcrumb() {
    if (!remotePathBreadcrumb) return;

    const hasActiveSession = Boolean(activeConnectionId);
    const normalizedPath = normalizeUiRemotePath(currentPath.value || '/');
    remotePathBreadcrumb.innerHTML = '';
    remotePathBreadcrumb.classList.remove('is-truncated');
    remotePathBox.classList.toggle('path-breadcrumb-mode', hasActiveSession && !remotePathEditing);
    remotePathBox.classList.toggle('path-edit-mode', hasActiveSession && remotePathEditing);

    if (!hasActiveSession) {
      return;
    }

    const parts = getBreadcrumbParts(normalizedPath);

    parts.forEach((part, index) => {
      if (index > 0) {
        const parentPart = parts[index - 1];
        const separator = document.createElement('button');
        separator.type = 'button';
        separator.className = 'remote-path-breadcrumb-separator' + (breadcrumbDropdownState.open && breadcrumbDropdownState.path === parentPart.path ? ' open' : '');
        const separatorIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        separatorIcon.classList.add('remote-path-breadcrumb-separator-icon');
        separatorIcon.setAttribute('viewBox', '0 0 16 16');
        separatorIcon.setAttribute('aria-hidden', 'true');
        separatorIcon.setAttribute('focusable', 'false');
        const separatorPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        separatorPath.setAttribute('d', 'M6 4l4 4-4 4');
        separatorIcon.appendChild(separatorPath);
        separator.appendChild(separatorIcon);
        separator.dataset.breadcrumbToggle = parentPart.path;
        separator.setAttribute('data-tooltip', 'Show folders under ' + parentPart.path);
        separator.setAttribute('aria-label', 'Show folders under ' + parentPart.path);
        remotePathBreadcrumb.appendChild(separator);
      }

      const segment = document.createElement('span');
      segment.className = 'remote-path-breadcrumb-segment';
      segment.dataset.breadcrumbSegmentPath = part.path;

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = part.label;
      button.dataset.breadcrumbPath = part.path;
      button.setAttribute('data-tooltip', part.path);
      button.className = 'breadcrumb-part-button' + (part.path === normalizedPath ? ' current' : '');
      button.setAttribute('aria-current', part.path === normalizedPath ? 'page' : 'false');
      segment.appendChild(button);

      remotePathBreadcrumb.appendChild(segment);
    });

    updateRemotePathBreadcrumbOverflow();
  }

  function openRemotePathDropdown(path, anchor) {
    if (!remotePathDropdown || !activeConnectionId) return;

    const normalizedPath = normalizeUiRemotePath(path || '/');
    if (breadcrumbDropdownState.open && breadcrumbDropdownState.path === normalizedPath) {
      hideRemotePathDropdown();
      return;
    }

    const requestId = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    breadcrumbDropdownState = { open: true, path: normalizedPath, requestId, anchorPath: normalizedPath };
    updateRemotePathBreadcrumb();
    positionRemotePathDropdown(anchor);
    renderRemotePathDropdown('loading', normalizedPath);

    vscode.postMessage({
      type: 'requestBreadcrumbDirectories',
      payload: { path: normalizedPath, requestId }
    });
  }

  function hideRemotePathDropdown() {
    if (!remotePathDropdown) return;
    if (!breadcrumbDropdownState.open && !remotePathDropdown.classList.contains('visible')) return;
    breadcrumbDropdownState = { open: false, path: '', requestId: '', anchorPath: '' };
    remotePathDropdown.classList.remove('visible');
    remotePathDropdown.setAttribute('aria-hidden', 'true');
    remotePathDropdown.innerHTML = '';
    updateRemotePathBreadcrumb();
  }

  function findRemotePathBreadcrumbToggle(path) {
    if (!remotePathBreadcrumb) return null;
    const normalizedPath = normalizeUiRemotePath(path || '/');
    return Array.from(remotePathBreadcrumb.querySelectorAll('[data-breadcrumb-toggle]'))
      .find(item => normalizeUiRemotePath(item.dataset.breadcrumbToggle || '/') === normalizedPath) || null;
  }

  function refreshOpenRemotePathDropdown() {
    if (!breadcrumbDropdownState.open || !activeConnectionId) return;
    const normalizedPath = normalizeUiRemotePath(breadcrumbDropdownState.path || '/');
    const requestId = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    const anchor = findRemotePathBreadcrumbToggle(normalizedPath);
    breadcrumbDropdownState = { open: true, path: normalizedPath, requestId, anchorPath: normalizedPath };
    updateRemotePathBreadcrumb();
    if (anchor) positionRemotePathDropdown(anchor);
    renderRemotePathDropdown('loading', normalizedPath);

    vscode.postMessage({
      type: 'requestBreadcrumbDirectories',
      payload: { path: normalizedPath, requestId }
    });
  }

  function positionRemotePathDropdown(anchor) {
    if (!remotePathDropdown || !remotePathBox || !anchor) return;
    const boxRect = remotePathBox.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const dropdownWidth = Math.min(540, Math.max(320, window.innerWidth - 56));
    let left = Math.round(anchorRect.left - boxRect.left);
    left = Math.max(0, Math.min(left, Math.max(0, boxRect.width - dropdownWidth)));
    remotePathDropdown.style.width = dropdownWidth + 'px';
    remotePathDropdown.style.left = left + 'px';
  }

  function renderRemotePathDropdown(state, path, directories, errorMessage) {
    if (!remotePathDropdown) return;

    remotePathDropdown.innerHTML = '';
    remotePathDropdown.classList.add('visible');
    remotePathDropdown.setAttribute('aria-hidden', 'false');

    const title = document.createElement('div');
    title.className = 'remote-path-dropdown-title';
    title.textContent = path || '/';
    title.setAttribute('data-tooltip', path || '/');
    remotePathDropdown.appendChild(title);

    if (state === 'loading') {
      const loading = document.createElement('div');
      loading.className = 'remote-path-dropdown-state';
      loading.textContent = 'Loading directories...';
      remotePathDropdown.appendChild(loading);
      return;
    }

    if (state === 'error') {
      const error = document.createElement('div');
      error.className = 'remote-path-dropdown-state error';
      error.textContent = errorMessage || 'Could not list directories.';
      remotePathDropdown.appendChild(error);
      return;
    }

    const items = Array.isArray(directories) ? directories : [];
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'remote-path-dropdown-state';
      empty.textContent = 'No directories found.';
      remotePathDropdown.appendChild(empty);
      return;
    }

    items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'remote-path-dropdown-item';
      button.dataset.dropdownDirectoryPath = item.path || '';
      const ownerGroupText = [item.owner, item.group].filter(Boolean).join(':');
      const permissionsText = formatPermissionsForDisplay(item.permissions);
      button.setAttribute('data-tooltip', item.path || item.name || '');

      const name = document.createElement('span');
      name.className = 'remote-path-dropdown-name';
      name.textContent = item.name || item.path || '';
      button.appendChild(name);

      if (showRemotePathBreadcrumbDirectoryDetails) {
        const meta = document.createElement('span');
        meta.className = 'remote-path-dropdown-meta';

        const ownerGroup = document.createElement('span');
        ownerGroup.className = 'remote-path-dropdown-meta-owner';
        ownerGroup.textContent = ownerGroupText;
        meta.appendChild(ownerGroup);

        const permissions = document.createElement('span');
        permissions.className = 'remote-path-dropdown-meta-permissions';
        permissions.textContent = permissionsText;
        meta.appendChild(permissions);

        button.appendChild(meta);
      }

      remotePathDropdown.appendChild(button);
    });
  }

  function handleBreadcrumbDirectoriesListed(payload) {
    if (!payload || payload.connectionId !== activeConnectionId) return;
    if (!breadcrumbDropdownState.open || payload.requestId !== breadcrumbDropdownState.requestId) return;

    const path = normalizeUiRemotePath(payload.path || '/');
    if (path !== breadcrumbDropdownState.path) return;

    if (payload.error) {
      renderRemotePathDropdown('error', path, [], payload.error);
      return;
    }

    renderRemotePathDropdown('ready', path, payload.directories || []);
  }

  function getBreadcrumbParts(path) {
    const normalizedPath = normalizeUiRemotePath(path || '/');
    if (normalizedPath === '/') {
      return [{ label: '/', path: '/' }];
    }

    const segments = normalizedPath.split('/').filter(Boolean);
    const parts = [{ label: '/', path: '/' }];
    let current = '';

    for (const segment of segments) {
      current += '/' + segment;
      parts.push({ label: segment, path: current });
    }

    return parts;
  }

  function isSessionConnected(session) {
    return Boolean(session) && (!session.connectionState || session.connectionState === 'connected');
  }

  function isSessionConnecting(session) {
    return Boolean(session && session.connectionState === 'connecting');
  }

  function isSessionFailed(session) {
    return Boolean(session && session.connectionState === 'failed');
  }

  function mergeIncomingSessionsWithClientPending(incomingSessions) {
    const incomingIds = new Set((incomingSessions || []).map(session => session.id));
    const pendingSessions = Array.from(clientPendingSessionsByConnectionId.values())
      .filter(session => session && session.id && !incomingIds.has(session.id));
    return [...(incomingSessions || []), ...pendingSessions];
  }

  function createClientConnectionId(payload) {
    const profileId = String(payload && payload.id || '').trim();
    if (profileId) return profileId;
    return 'quick-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function createClientPendingSession(payload, connectionId) {
    const id = String(connectionId || '').trim();
    if (!id) return;

    const session = {
      id,
      connectionType: normalizeConnectionTypeValue(payload.connectionType),
      name: String(payload.name || '').trim() || (String(payload.username || '').trim() + '@' + String(payload.host || '').trim()),
      host: String(payload.host || '').trim(),
      port: Number(payload.port || getDefaultPortForConnectionType(payload.connectionType)),
      username: String(payload.username || '').trim(),
      authType: String(payload.authType || 'password'),
      privateKeyPath: String(payload.privateKeyPath || '').trim(),
      startPath: normalizeUiRemotePath(payload.startPath || '/'),
      currentPath: normalizeUiRemotePath(payload.startPath || '/'),
      keepAlive: payload.keepAlive !== false,
      isQuickConnect: !payload.id,
      sudoModeEnabled: false,
      connectionState: 'connecting'
    };

    clientPendingSessionsByConnectionId.set(id, session);
    sessions = mergeIncomingSessionsWithClientPending(sessions.filter(item => item.id !== id));
    activeConnectionId = id;
    currentEntries = [];
    selectedEntryPath = '';
    selectedEntryPaths.clear();
    clearFilterText();
    currentSort = { key: '', direction: '' };
    entriesRenderGeneration += 1;
    entriesBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Connecting...</div></td></tr>';
    currentPath.value = session.currentPath || '/';
    setBusy(true, 'Connecting to ' + (session.name || session.host) + '...', 'connection', 'Cancel', id);
    renderSessionTabs();
    updateActiveSessionUi();
    updateConnectionViewUi();
    setControls();
  }

  function markClientPendingSessionFailed(connectionId, message) {
    const id = String(connectionId || '').trim();
    if (!id) return;
    const existing = clientPendingSessionsByConnectionId.get(id) || sessions.find(session => session.id === id);
    if (!existing || isSessionConnected(existing)) return;
    const failed = Object.assign({}, existing, { connectionState: 'failed', error: String(message || 'Connection failed.') });
    clientPendingSessionsByConnectionId.set(id, failed);
    sessions = sessions.map(session => session.id === id ? failed : session);
    renderSessionTabs();
    if (activeConnectionId === id) updateActiveSessionUi();
    setControls();
  }

  function removeClientPendingSession(connectionId) {
    const id = String(connectionId || '').trim();
    if (!id) return;
    const session = clientPendingSessionsByConnectionId.get(id) || sessions.find(item => item.id === id);
    clientPendingSessionsByConnectionId.delete(id);
    filesStatusByConnectionId.delete(id);
    filesStableStatusByConnectionId.delete(id);
    sessions = sessions.filter(item => item.id !== id);
    if (activeConnectionId === id) {
      const fallback = sessions.find(isSessionConnected) || sessions[0];
      activeConnectionId = fallback ? fallback.id : '';
      if (fallback && isSessionConnected(fallback)) {
        vscode.postMessage({ type: 'switchSession', payload: { connectionId: fallback.id } });
      } else {
        currentEntries = [];
        entriesRenderGeneration += 1;
        entriesBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Connect to a host to list remote files.</div></td></tr>';
        currentPath.value = '';
        setStatus('No active connection.');
      }
    }
    renderSessionTabs();
    updateActiveSessionUi();
    updateConnectionViewUi();
    setControls();
    if (session && isSessionConnecting(session)) vscode.postMessage({ type: 'cancelConnection', payload: { connectionId: id } });
  }

  function findSessionForCurrentForm(predicate) {
    const matchesForm = session => {
      if (!session) return false;
      if (selectedProfileId) return session.id === selectedProfileId;
      const hostValue = String(host.value || '').trim();
      const portValue = Number(port.value || 22);
      const usernameValue = String(username.value || '').trim();
      const authTypeValue = String(authType.value || 'password');
      const connectionTypeValue = normalizeConnectionTypeValue(connectionType.value);
      return String(session.host || '').trim() === hostValue
        && normalizeConnectionTypeValue(session.connectionType) === connectionTypeValue
        && Number(session.port || getDefaultPortForConnectionType(session.connectionType)) === portValue
        && String(session.username || '').trim() === usernameValue
        && String(session.authType || 'password') === authTypeValue;
    };
    return sessions.find(session => matchesForm(session) && predicate(session));
  }

  function getPendingSessionForCurrentForm() {
    return findSessionForCurrentForm(session => isSessionConnecting(session));
  }

  function hasAnyConnectingSession() {
    return sessions.some(isSessionConnecting) || Array.from(clientPendingSessionsByConnectionId.values()).some(isSessionConnecting);
  }

  function getConnectedSessionForCurrentForm() {
    return findSessionForCurrentForm(session => isSessionConnected(session));
  }

  function getSessionForProfileId(profileId, predicate) {
    const id = String(profileId || '').trim();
    if (!id) return null;
    return sessions.find(session => session && session.id === id && predicate(session)) || null;
  }

  function getPendingSessionForProfileId(profileId) {
    return getSessionForProfileId(profileId, session => isSessionConnecting(session));
  }

  function getConnectedSessionForProfileId(profileId) {
    return getSessionForProfileId(profileId, session => isSessionConnected(session));
  }

  function collectConnectionPayloadFromProfile(profile) {
    if (!profile) return null;
    const connectionTypeValue = normalizeConnectionTypeValue(profile.connectionType);
    return {
      id: profile.id,
      name: profile.name,
      host: profile.host,
      connectionType: connectionTypeValue,
      port: profile.port || getDefaultPortForConnectionType(connectionTypeValue),
      username: profile.username,
      authType: connectionTypeValue === 'sftp' ? (profile.authType || 'password') : 'password',
      password: '',
      rememberPassword: Boolean(profile.hasSavedPassword),
      privateKeyPath: profile.privateKeyPath || '',
      passphrase: '',
      rememberPassphrase: Boolean(profile.hasSavedPassphrase),
      startPath: profile.startPath || '',
      keepAlive: profile.keepAlive !== false,
      groupId: profile.groupId || '',
      ftpsAllowSelfSignedCertificate: Boolean(profile.ftpsAllowSelfSignedCertificate),
      ftpsCaCertificatePath: profile.ftpsCaCertificatePath || ''
    };
  }

  function handleProfileDropdownAction(profileId) {
    const id = String(profileId || '').trim();
    if (!id) return;

    const connectedSession = getConnectedSessionForProfileId(id);
    if (connectedSession) {
      profileDisconnectingIds.add(id);
      renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
      setBusy(true, 'Disconnecting...', '', 'Cancel', connectedSession.id);
      vscode.postMessage({ type: 'disconnect', payload: { connectionId: connectedSession.id } });
      return;
    }

    const pendingSession = getPendingSessionForProfileId(id);
    if (pendingSession) {
      activateClientSession(pendingSession.id);
      renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
      return;
    }

    const profile = profiles.find(item => item && item.id === id);
    if (!profile) return;
    const payload = collectConnectionPayloadFromProfile(profile);
    if (!payload) return;
    const clientConnectionId = createClientConnectionId(payload);
    payload.clientConnectionId = clientConnectionId;
    createClientPendingSession(payload, clientConnectionId);
    renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
    vscode.postMessage({ type: 'connect', payload });
  }

  function getActiveSession() {
    return sessions.find(item => item.id === activeConnectionId);
  }

  function syncConnectionFormWithActiveSession(options = {}) {
    const active = getActiveSession();
    if (!active || connectionButtonState === 'connecting' || connectionButtonState === 'disconnecting') return;

    const profile = profiles.find(item => item.id === active.id);
    if (profile) {
      if (selectedProfileId !== profile.id || lastSyncedActiveConnectionId !== active.id) {
        selectProfile(profile.id, { preserveStatus: true, keepDropdownOpen: profileDropdownOpen });
      }
      lastSyncedActiveConnectionId = active.id;
      return;
    }

    selectedProfileId = '';
    profileSelect.value = '';
    if (!profileDropdownOpen) hideProfileDropdown();
    fillFormFromSession(active);
    updateProfileDropdownLabel();
    renderProfileDropdown({ preserveFilter: profileDropdownOpen, preserveScroll: profileDropdownOpen });
    lastSyncedActiveConnectionId = active.id;
    if (!options.preserveStatus) setStatus('Active connection loaded.');
    setControls();
  }

  function fillFormFromSession(session) {
    clearConnectionValidationErrors();
    profileName.value = session.name || '';
    host.value = session.host || '';
    connectionType.value = normalizeConnectionTypeValue(session.connectionType);
    port.value = String(session.port || getDefaultPortForConnectionType(connectionType.value));
    username.value = session.username || '';
    authType.value = isSftpFormConnection() ? (session.authType || 'password') : 'password';
    password.value = '';
    rememberPassword.checked = false;
    password.placeholder = '';
    privateKeyPath.value = session.privateKeyPath || '';
    passphrase.value = '';
    rememberPassphrase.checked = false;
    passphrase.placeholder = '';
    startPath.value = session.startPath || '';
    keepAlive.checked = session.keepAlive !== false;
    ftpsAllowSelfSignedCertificate.checked = Boolean(session.ftpsAllowSelfSignedCertificate);
    ftpsCaCertificatePath.value = session.ftpsCaCertificatePath || '';
    updateCredentialState();
    updateConnectionTypeDropdown();
    updateAuthFields();
  }

  function getConnectionDetailControls() {
    return [
      host,
      port,
      connectionType,
      connectionTypeDropdownButton,
      ftpsAllowSelfSignedCertificate,
      ftpsCaCertificatePath,
      ftpsCaCertificateBrowseButton,
      username,
      authType,
      authDropdownButton,
      password,
      passwordRevealButton,
      rememberPassword,
      privateKeyPath,
      privateKeyBrowseButton,
      passphrase,
      passphraseRevealButton,
      rememberPassphrase,
      startPath,
      keepAlive
    ].filter(Boolean);
  }

  function isConnectionTransitionBusy() {
    return connectionButtonState === 'connecting' || connectionButtonState === 'disconnecting';
  }


  function normalizeConnectionTypeValue(value) {
    const normalized = String(value || 'sftp').trim().toLowerCase();
    return normalized === 'ftp' || normalized === 'ftps' ? normalized : 'sftp';
  }

  function getDefaultPortForConnectionType(value) {
    return normalizeConnectionTypeValue(value) === 'sftp' ? 22 : 21;
  }

  function getConnectionTypeLabel(value) {
    const normalized = normalizeConnectionTypeValue(value);
    if (normalized === 'ftps') return 'FTPS';
    if (normalized === 'ftp') return 'FTP';
    return 'SFTP';
  }

  function isSftpFormConnection() {
    return normalizeConnectionTypeValue(connectionType.value) === 'sftp';
  }

  function getBrowserConnectionType() {
    const active = getActiveSession();
    return normalizeConnectionTypeValue(active ? active.connectionType : connectionType.value);
  }

  function getActiveRemoteCapabilities() {
    const isSftp = getBrowserConnectionType() === 'sftp';
    return {
      canUseSudo: isSftp,
      canRunCommand: isSftp,
      canOpenSshTerminal: isSftp,
      canChangeOwnerGroup: isSftp,
      canChangePermissions: isSftp,
      canChangePermissionsRecursively: isSftp,
      canCalculateServerChecksums: isSftp,
      canCreateArchive: isSftp
    };
  }

  function updateConnectionTypeDropdown() {
    const value = normalizeConnectionTypeValue(connectionType.value);
    connectionType.value = value;
    if (connectionTypeDropdownLabel) connectionTypeDropdownLabel.textContent = getConnectionTypeLabel(value);
    updateFtpsCertificateFields();
    if (!connectionTypeDropdownMenu) return;

    const items = Array.from(connectionTypeDropdownMenu.querySelectorAll('[data-connection-type]'));
    items.forEach(item => {
      const selected = item.dataset.connectionType === value;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function showConnectionTypeDropdown() {
    if (!connectionTypeDropdownButton || !connectionTypeDropdownMenu || connectionTypeDropdownButton.disabled) return;
    hideProfileDropdown();
    hideAuthDropdown();
    connectionTypeDropdownOpen = true;
    const picker = connectionTypeDropdownButton.closest('.connection-type-picker');
    if (picker) picker.classList.add('open');
    connectionTypeDropdownButton.setAttribute('aria-expanded', 'true');
    updateConnectionTypeDropdown();
  }

  function hideConnectionTypeDropdown() {
    if (!connectionTypeDropdownButton) return;
    connectionTypeDropdownOpen = false;
    const picker = connectionTypeDropdownButton.closest('.connection-type-picker');
    if (picker) picker.classList.remove('open');
    connectionTypeDropdownButton.setAttribute('aria-expanded', 'false');
  }

  function toggleConnectionTypeDropdown() {
    if (connectionTypeDropdownOpen) {
      hideConnectionTypeDropdown();
    } else {
      showConnectionTypeDropdown();
    }
  }

  function selectConnectionType(value) {
    clearConnectionValidationErrors();
    const previous = normalizeConnectionTypeValue(connectionType.value);
    const next = normalizeConnectionTypeValue(value);
    connectionType.value = next;

    const currentPort = String(port.value || '').trim();
    if (!currentPort || currentPort === String(getDefaultPortForConnectionType(previous))) {
      port.value = String(getDefaultPortForConnectionType(next));
    }

    if (next !== 'sftp') {
      authType.value = 'password';
    }

    updateConnectionTypeDropdown();
    updateAuthFields();
    setControls();
  }


  function updateFtpsCertificateFields(locked) {
    const isFtps = normalizeConnectionTypeValue(connectionType.value) === 'ftps';
    const isLocked = Boolean(locked);
    const allowSelfSigned = Boolean(ftpsAllowSelfSignedCertificate && ftpsAllowSelfSignedCertificate.checked);

    if (ftpsCertificateBlock) {
      ftpsCertificateBlock.classList.toggle('visible', isFtps);
    }

    if (ftpsCaCertificateBlock) {
      ftpsCaCertificateBlock.style.display = isFtps && !allowSelfSigned ? '' : 'none';
    }

    if (ftpsAllowSelfSignedCertificate) {
      ftpsAllowSelfSignedCertificate.disabled = isLocked || !isFtps;
    }

    if (ftpsCaCertificatePath) {
      ftpsCaCertificatePath.disabled = isLocked || !isFtps || allowSelfSigned;
    }

    if (ftpsCaCertificateBrowseButton) {
      ftpsCaCertificateBrowseButton.disabled = isLocked || !isFtps || allowSelfSigned;
    }
  }


  function getAuthTypeLabel(value) {
    return value === 'privateKey' ? 'Private key' : 'Password';
  }

  function updateAuthDropdown() {
    const value = String(authType.value || 'password');
    if (authDropdownLabel) authDropdownLabel.textContent = getAuthTypeLabel(value);
    if (!authDropdownMenu) return;

    const items = Array.from(authDropdownMenu.querySelectorAll('[data-auth-type]'));
    items.forEach(item => {
      const selected = item.dataset.authType === value;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function showAuthDropdown() {
    if (!authDropdownButton || !authDropdownMenu || authDropdownButton.disabled) return;
    hideProfileDropdown();
    hideConnectionTypeDropdown();
    authDropdownOpen = true;
    const picker = authDropdownButton.closest('.auth-picker');
    if (picker) picker.classList.add('open');
    authDropdownButton.setAttribute('aria-expanded', 'true');
    updateAuthDropdown();
  }

  function hideAuthDropdown() {
    if (!authDropdownButton) return;
    authDropdownOpen = false;
    const picker = authDropdownButton.closest('.auth-picker');
    if (picker) picker.classList.remove('open');
    authDropdownButton.setAttribute('aria-expanded', 'false');
  }

  function toggleAuthDropdown() {
    if (authDropdownOpen) {
      hideAuthDropdown();
    } else {
      showAuthDropdown();
    }
  }

  function selectAuthType(value) {
    clearConnectionValidationErrors();
    authType.value = value === 'privateKey' ? 'privateKey' : 'password';
    updateAuthFields();
    updateAuthDropdown();
    setControls();
  }

  function formatProfileTarget(profile) {
    const userPart = profile.username ? profile.username + '@' : '';
    return getConnectionTypeLabel(profile.connectionType) + ' ' + userPart + profile.host + ':' + profile.port;
  }

  function formatSessionTarget(session) {
    const userPart = session.username ? session.username + '@' : '';
    return userPart + session.host + ':' + session.port;
  }

  function formatSessionTooltipTarget(session) {
    const userPart = session.username ? session.username + '@' : '';
    return getConnectionTypeLabel(session.connectionType) + ' ' + userPart + session.host;
  }

  function formatConnectionLabel(name, target) {
    return '[' + name + '] ' + target;
  }

  function formatCredentialState(profile) {
    if (profile.authType === 'privateKey') {
      return profile.hasSavedPassphrase ? 'passphrase saved' : 'passphrase not saved';
    }

    return profile.hasSavedPassword ? 'password saved' : 'password not saved';
  }

  function updateCredentialState(profile) {
    const hasPassword = Boolean(profile && profile.hasSavedPassword);
    const hasPassphrase = Boolean(profile && profile.hasSavedPassphrase);

    passwordSecretState.textContent = hasPassword
      ? 'Password saved in VS Code SecretStorage.'
      : 'Password not saved.';
    passwordSecretState.className = 'credential-state ' + (hasPassword ? 'saved' : 'not-saved');

    passphraseSecretState.textContent = hasPassphrase
      ? 'Passphrase saved in VS Code SecretStorage.'
      : 'Passphrase not saved.';
    passphraseSecretState.className = 'credential-state ' + (hasPassphrase ? 'saved' : 'not-saved');
    updateConnectionCredentialRevealControls();
  }

  function fillForm(profile) {
    clearConnectionValidationErrors();
    profileName.value = profile.name || '';
    host.value = profile.host || '';
    connectionType.value = normalizeConnectionTypeValue(profile.connectionType);
    port.value = String(profile.port || getDefaultPortForConnectionType(connectionType.value));
    username.value = profile.username || '';
    renderConnectionNameGroupOptions(profile.groupId || '');
    authType.value = isSftpFormConnection() ? (profile.authType || 'password') : 'password';
    password.value = profile.hasSavedPassword ? SAVED_SECRET_MASK : '';
    rememberPassword.checked = Boolean(profile.hasSavedPassword);
    privateKeyPath.value = profile.privateKeyPath || '';
    passphrase.value = profile.hasSavedPassphrase ? SAVED_SECRET_MASK : '';
    rememberPassphrase.checked = Boolean(profile.hasSavedPassphrase);
    startPath.value = profile.startPath || '';
    keepAlive.checked = profile.keepAlive !== false;
    ftpsAllowSelfSignedCertificate.checked = Boolean(profile.ftpsAllowSelfSignedCertificate);
    ftpsCaCertificatePath.value = profile.ftpsCaCertificatePath || '';
    password.placeholder = profile.hasSavedPassword ? 'Saved password' : '';
    passphrase.placeholder = profile.hasSavedPassphrase ? 'Saved passphrase' : '';
    updateCredentialState(profile);
    updateConnectionTypeDropdown();
    updateAuthFields();
    setControls();
  }

  function clearForm() {
    clearConnectionValidationErrors();
    profileName.value = '';
    host.value = '';
    connectionType.value = 'sftp';
    port.value = '22';
    username.value = '';
    renderConnectionNameGroupOptions('');
    authType.value = 'password';
    password.value = '';
    rememberPassword.checked = false;
    password.placeholder = '';
    privateKeyPath.value = '';
    passphrase.value = '';
    rememberPassphrase.checked = false;
    passphrase.placeholder = '';
    startPath.value = '';
    keepAlive.checked = true;
    ftpsAllowSelfSignedCertificate.checked = false;
    ftpsCaCertificatePath.value = '';
    updateCredentialState();
    updateConnectionTypeDropdown();
    updateAuthFields();
    setControls();
  }





  function setTemporaryPasswordVisible(input, visible) {
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

  function hasUserTypedCredentialValue(input) {
    return Boolean(input && input.value && input.value !== SAVED_SECRET_MASK);
  }

  function updateConnectionCredentialRevealButton(button, input) {
    if (!button || !input) return;

    const canReveal = hasUserTypedCredentialValue(input) && !input.disabled;
    button.disabled = !canReveal;
    button.style.display = canReveal ? '' : 'none';

    const wrapper = input.closest ? input.closest('.input-with-button') : input.parentElement;
    if (wrapper) {
      wrapper.classList.toggle('reveal-hidden', !canReveal);
    }

    if (!canReveal) {
      hideTemporaryPassword(input);
    }
  }

  function updateConnectionCredentialRevealControls() {
    updateConnectionCredentialRevealButton(passwordRevealButton, password);
    updateConnectionCredentialRevealButton(passphraseRevealButton, passphrase);
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

  function setBackupFieldError(input, element, message) {
    if (!input) return;
    const hasError = Boolean(String(message || '').trim());
    if (element) {
      element.textContent = '';
      element.classList.remove('visible');
    }
    input.classList.toggle('backup-input-invalid', hasError);
    if (hasError) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  function clearBackupFieldError(input, element) {
    setBackupFieldError(input, element, '');
  }

  function clearExportBackupFieldErrors() {
    clearBackupFieldError(exportCredentialPassword, exportCredentialPasswordError);
    clearBackupFieldError(exportCredentialConfirmPassword, exportCredentialConfirmPasswordError);
  }

  function clearImportBackupFieldErrors() {
    clearBackupFieldError(importCredentialPassword, importCredentialPasswordError);
  }

  function showBackupResult(element, message, isError) {
    if (!element) return;
    const text = String(message || '').trim();
    element.textContent = text;
    element.classList.toggle('visible', Boolean(text));
    element.classList.toggle('error', Boolean(isError));
    element.classList.toggle('success', Boolean(text) && !isError);
  }

  function clearBackupResult(element) {
    showBackupResult(element, '', false);
  }

  function showExportBackupDialog() {
    exportBackupDialogOpen = true;
    exportIncludeSettings.checked = true;
    exportIncludeConnections.checked = true;
    exportIncludeFavorites.checked = true;
    exportIncludeUsernames.checked = true;
    exportIncludeCredentials.checked = false;
    exportCredentialPassword.value = '';
    exportCredentialConfirmPassword.value = '';
    exportBackupValidation.textContent = '';
    clearExportBackupFieldErrors();
    clearBackupResult(exportBackupResult);
    updateExportBackupDialogState();
    exportBackupBackdrop.classList.add('visible');
    exportBackupBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => exportIncludeSettings.focus(), 0);
  }

  function hideExportBackupDialog() {
    exportBackupDialogOpen = false;
    exportBackupBackdrop.classList.remove('visible');
    exportBackupBackdrop.setAttribute('aria-hidden', 'true');
    exportCredentialPassword.value = '';
    exportCredentialConfirmPassword.value = '';
    hideTemporaryPassword(exportCredentialPassword);
    hideTemporaryPassword(exportCredentialConfirmPassword);
    exportBackupValidation.textContent = '';
    clearExportBackupFieldErrors();
    clearBackupResult(exportBackupResult);
  }

  function updateExportBackupDialogState() {
    const includeConnections = Boolean(exportIncludeConnections.checked);
    exportIncludeFavorites.disabled = !includeConnections;
    exportIncludeUsernames.disabled = !includeConnections;

    if (!includeConnections) {
      exportIncludeFavorites.checked = false;
      exportIncludeUsernames.checked = false;
      exportIncludeCredentials.checked = false;
    }

    const canIncludeCredentials = includeConnections && Boolean(exportIncludeUsernames.checked);
    exportIncludeCredentials.disabled = !canIncludeCredentials;

    if (!canIncludeCredentials) {
      exportIncludeCredentials.checked = false;
    }

    const showCredentials = canIncludeCredentials && Boolean(exportIncludeCredentials.checked);
    exportCredentialsBlock.classList.toggle('visible', showCredentials);
    exportCredentialPassword.disabled = !showCredentials;
    exportCredentialConfirmPassword.disabled = !showCredentials;
    exportCredentialPasswordRevealButton.disabled = !showCredentials;
    exportCredentialConfirmPasswordRevealButton.disabled = !showCredentials;
    hideTemporaryPassword(exportCredentialPassword);
    hideTemporaryPassword(exportCredentialConfirmPassword);
    exportCredentialsDisabledHelp.textContent = includeConnections && !exportIncludeUsernames.checked
      ? 'Enable usernames to include encrypted passwords/passphrases.'
      : '';

    if (!showCredentials) {
      exportCredentialPassword.value = '';
      exportCredentialConfirmPassword.value = '';
    }

    exportBackupValidation.textContent = '';
    clearExportBackupFieldErrors();
    clearBackupResult(exportBackupResult);
  }

  function applyExportBackupDialog() {
    exportBackupValidation.textContent = '';
    clearExportBackupFieldErrors();
    clearBackupResult(exportBackupResult);
    const includeCredentials = Boolean(exportIncludeCredentials.checked) && !exportIncludeCredentials.disabled;
    const credentialPassword = String(exportCredentialPassword.value || '');
    const credentialConfirmPassword = String(exportCredentialConfirmPassword.value || '');

    if (!exportIncludeSettings.checked && !exportIncludeConnections.checked) {
      showBackupResult(exportBackupResult, 'Select at least one export option.', true);
      return;
    }

    if (includeCredentials) {
      if (!credentialPassword) {
        setBackupFieldError(exportCredentialPassword, exportCredentialPasswordError, 'Export password is required.');
        showBackupResult(exportBackupResult, 'Export password is required.', true);
        exportCredentialPassword.focus();
        return;
      }

      if (!credentialConfirmPassword) {
        setBackupFieldError(exportCredentialConfirmPassword, exportCredentialConfirmPasswordError, 'Confirm password is required.');
        showBackupResult(exportBackupResult, 'Confirm password is required.', true);
        exportCredentialConfirmPassword.focus();
        return;
      }

      if (credentialPassword !== credentialConfirmPassword) {
        setBackupFieldError(exportCredentialPassword, exportCredentialPasswordError, 'Passwords do not match.');
        setBackupFieldError(exportCredentialConfirmPassword, exportCredentialConfirmPasswordError, 'Passwords do not match.');
        showBackupResult(exportBackupResult, 'Passwords do not match.', true);
        exportCredentialConfirmPassword.focus();
        return;
      }
    }

    vscode.postMessage({
      type: 'exportConnectionsSettings',
      payload: {
        includeSettings: Boolean(exportIncludeSettings.checked),
        includeConnections: Boolean(exportIncludeConnections.checked),
        includeFavorites: Boolean(exportIncludeFavorites.checked) && !exportIncludeFavorites.disabled,
        includeUsernames: Boolean(exportIncludeUsernames.checked) && !exportIncludeUsernames.disabled,
        includeCredentials,
        credentialPassword
      }
    });

  }

  function showImportBackupDialog(summary) {
    importBackupDialogOpen = true;
    importBackupSummaryState = Object.assign({
      hasSettings: false,
      connectionCount: 0,
      connectionGroupCount: 0,
      supportedConnectionCount: 0,
      unsupportedConnectionCount: 0,
      remotePathFavoriteCount: 0,
      usernamesIncluded: false,
      hasEncryptedCredentials: false,
      importError: ''
    }, summary || {});

    renderImportBackupSummary(importBackupSummaryState);
    importIncludeSettings.checked = Boolean(importBackupSummaryState.hasSettings);
    importIncludeConnections.checked = Number(importBackupSummaryState.supportedConnectionCount || 0) > 0;
    importIncludeFavorites.checked = Number(importBackupSummaryState.remotePathFavoriteCount || 0) > 0;
    importIncludeUsernames.checked = Boolean(importBackupSummaryState.usernamesIncluded);
    importRestoreCredentials.checked = false;
    importCredentialPassword.value = '';
    importModeMerge.checked = true;
    importModeReplace.checked = false;
    importBackupValidation.textContent = '';
    clearImportBackupFieldErrors();
    clearBackupResult(importBackupResult);
    updateImportBackupDialogState();
    if (importBackupSummaryState.importError) {
`;
}
