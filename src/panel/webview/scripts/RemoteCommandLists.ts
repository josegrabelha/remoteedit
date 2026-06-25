export function renderRemoteCommandLists(): string {
  return `
  function scrollRemoteCommandOutputToBottom() {
    remoteCommandOutputWrap.scrollTop = remoteCommandOutputWrap.scrollHeight;
  }

  function renderLogViewerBadge() {
    if (!logViewerBadge) return;
    if (logViewerActiveSessionCount > 0) {
      logViewerBadge.textContent = String(Math.min(99, logViewerActiveSessionCount));
      logViewerBadge.style.display = 'block';
    } else {
      logViewerBadge.style.display = 'none';
    }
  }

  function renderRemoteCommandBadge() {
    if (!remoteCommandBadge) return;
    const state = getRemoteCommandSession(activeConnectionId);
    if (state.status === 'running') {
      remoteCommandBadge.textContent = '●';
      remoteCommandBadge.style.display = 'block';
    } else if (state.finishedBadgeVisible) {
      remoteCommandBadge.textContent = state.error || (typeof state.exitCode === 'number' && state.exitCode !== 0) || state.failedCommandCount > 0 ? '!' : '✓';
      remoteCommandBadge.style.display = 'block';
    } else {
      remoteCommandBadge.style.display = 'none';
    }
  }

  function createRemoteCommandId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function firstRemoteCommandLine(command) {
    const lines = String(command || '').split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
    return lines[0] || '';
  }

  function truncateRemoteCommandText(text, maxLength) {
    const value = String(text || '').replace(/\\s+/g, ' ').trim();
    return value.length > maxLength ? value.slice(0, Math.max(0, maxLength - 1)) + '…' : value;
  }

  function formatRemoteCommandRelativeTime(timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' min ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' h ago';
    const days = Math.floor(hours / 24);
    return days + ' d ago';
  }

  function getRemoteCommandItemRemotePath(item) {
    const raw = String(item && (item.remotePath || item.workingDirectory || '') || '').trim();
    return raw ? normalizeUiRemotePath(raw) : '';
  }

  function loadRemoteCommandIntoEditor(item, append) {
    if (!item || getCurrentRemoteCommandSession().status === 'running') return;
    const command = String(item.command || '').trim();
    if (!command) return;
    const current = String(remoteCommandInput.value || '').trimEnd();
    remoteCommandInput.value = append && current ? current + '\\n' + command : command;
    const state = getCurrentRemoteCommandSession();
    state.command = remoteCommandInput.value;
    const itemRemotePath = getRemoteCommandItemRemotePath(item);
    if (!append && itemRemotePath) {
      remoteCommandWorkingDirectory.value = itemRemotePath;
      state.workingDirectory = itemRemotePath;
    } else {
      state.workingDirectory = normalizeUiRemotePath(remoteCommandWorkingDirectory.value || state.workingDirectory || '/');
    }
    state.useSudo = collectRemoteCommandUseSudo();
    updateRemoteCommandControls();
    remoteCommandInput.focus();
  }

  function renderRemoteCommandSavedList() {
    if (!remoteCommandSavedList) return;
    const list = getRemoteCommandSavedList(remoteCommandDialogConnectionId || activeConnectionId);
    if (remoteCommandEditingSavedId === '__new__') {
      remoteCommandSavedList.innerHTML = renderRemoteCommandEditForm({
        id: '__new__',
        name: '',
        details: '',
        command: String(remoteCommandInput.value || '').trim(),
        remotePath: normalizeUiRemotePath(remoteCommandWorkingDirectory.value || currentPath.value || '/')
      }, true);
      wireRemoteCommandEditForm();
      return;
    }
    if (!list.length) {
      remoteCommandSavedList.innerHTML = '<div class="remote-command-empty">No saved commands for this connection.</div>';
      return;
    }
    remoteCommandSavedList.innerHTML = list.map(item => {
      if (remoteCommandEditingSavedId === item.id) return renderRemoteCommandEditForm(item, false);
      const remotePath = getRemoteCommandItemRemotePath(item);
      return '<div class="remote-command-card" data-remote-command-saved-id="' + escapeHtml(item.id) + '" data-tooltip="Load command">'
        + '<div class="remote-command-card-header">'
        + '<div class="remote-command-card-name">' + escapeHtml(item.name || firstRemoteCommandLine(item.command) || 'Saved command') + '</div>'
        + '<button class="secondary remote-command-icon-button" type="button" data-remote-command-action="append" data-tooltip="Add to editor">+</button>'
        + '<button class="secondary remote-command-icon-button" type="button" data-remote-command-action="edit" data-tooltip="Edit saved command">✎</button>'
        + '<button class="secondary remote-command-icon-button" type="button" data-remote-command-action="delete" data-tooltip="Delete saved command">×</button>'
        + '</div>'
        + (item.details ? '<div class="remote-command-card-details">' + escapeHtml(item.details) + '</div>' : '')
        + (remotePath ? '<div class="remote-command-card-meta tooltip-above" data-tooltip="' + escapeHtml(remotePath) + '">Remote path: ' + escapeHtml(truncateRemoteCommandText(remotePath, 90)) + '</div>' : '')
        + '<div class="remote-command-card-command">' + escapeHtml(truncateRemoteCommandText(item.command, 120)) + '</div>'
        + (remoteCommandDeletingSavedId === item.id ? '<div class="remote-command-delete-confirm" role="alert"><span>Delete saved command?</span><span class="remote-command-delete-confirm-actions"><button class="secondary" type="button" data-remote-command-action="cancel-delete">Cancel</button><button type="button" data-remote-command-action="confirm-delete">Delete</button></span></div>' : '')
        + '</div>';
    }).join('');
    wireRemoteCommandEditForm();
  }

  function renderRemoteCommandEditForm(item, isNew) {
    const remotePath = getRemoteCommandItemRemotePath(item);
    return '<form class="remote-command-edit-form" data-remote-command-edit-id="' + escapeHtml(item.id || '') + '">'
      + '<label>Name<input type="text" name="name" value="' + escapeHtml(item.name || '') + '" autocomplete="off" spellcheck="false" placeholder="Restart nginx"></label>'
      + '<label>Details<input type="text" name="details" value="' + escapeHtml(item.details || '') + '" autocomplete="off" spellcheck="false" placeholder="Explain what this command does"></label>'
      + '<label>Remote path<input type="text" name="remotePath" value="' + escapeHtml(remotePath) + '" autocomplete="off" spellcheck="false" placeholder="/var/www/app"></label>'
      + '<label>Command<textarea name="command" spellcheck="false">' + escapeHtml(item.command || '') + '</textarea></label>'
      + '<div class="remote-command-edit-actions">'
      + '<button class="secondary" type="button" data-remote-command-edit-action="cancel">Cancel</button>'
      + '<button type="submit">Save</button>'
      + '</div>'
      + '</form>';
  }

  function wireRemoteCommandEditForm() {
    const form = remoteCommandSavedList ? remoteCommandSavedList.querySelector('.remote-command-edit-form') : null;
    if (!form) return;
    const nameInput = form.querySelector('input[name="name"]');
    if (nameInput) setTimeout(() => nameInput.focus(), 0);
  }

  function saveRemoteCommandEditForm(form) {
    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const list = getRemoteCommandSavedList(connectionId);
    const id = String(form.getAttribute('data-remote-command-edit-id') || '').trim();
    const name = String((form.querySelector('input[name="name"]') || {}).value || '').trim();
    const details = String((form.querySelector('input[name="details"]') || {}).value || '').trim();
    const command = String((form.querySelector('textarea[name="command"]') || {}).value || '').trim();
    const remotePathInput = form.querySelector('input[name="remotePath"]');
    const remotePathRaw = String((remotePathInput || {}).value || '').trim();
    const remotePath = remotePathRaw ? normalizeUiRemotePath(remotePathRaw) : '';
    if (!command) return;
    const now = Date.now();
    const existingIndex = list.findIndex(item => item.id === id && id !== '__new__');
    const item = {
      id: existingIndex >= 0 ? list[existingIndex].id : createRemoteCommandId(),
      name: name || firstRemoteCommandLine(command) || 'Saved command',
      details,
      command,
      createdAt: existingIndex >= 0 ? list[existingIndex].createdAt || now : now,
      updatedAt: now
    };
    if (remotePath) item.remotePath = remotePath;
    if (existingIndex >= 0) list[existingIndex] = item;
    else list.unshift(item);
    remoteCommandSavedByConnectionId.set(connectionId, list);
    persistRemoteCommandSaved();
    remoteCommandEditingSavedId = '';
    remoteCommandDeletingSavedId = '';
    renderRemoteCommandSavedList();
    renderServerViewIfActiveRemoteCommandConnection(connectionId);
  }

  function deleteRemoteCommandSaved(id) {
    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const list = getRemoteCommandSavedList(connectionId).filter(item => item.id !== id);
    remoteCommandSavedByConnectionId.set(connectionId, list);
    persistRemoteCommandSaved();
    remoteCommandEditingSavedId = '';
    remoteCommandDeletingSavedId = '';
    renderRemoteCommandSavedList();
    renderServerViewIfActiveRemoteCommandConnection(connectionId);
  }

  function addRemoteCommandHistoryItem(state) {
    if (!state || !state.connectionId || !state.command) return;
    const list = getRemoteCommandHistoryList(state.connectionId);
    const command = String(state.command || '').trim();
    const previous = list[0];
    if (previous && String(previous.command || '').trim() === command) {
      previous.ranAt = Date.now();
      previous.workingDirectory = normalizeUiRemotePath(state.workingDirectory || '/');
      previous.exitCode = typeof state.exitCode === 'number' ? state.exitCode : undefined;
      previous.error = state.error || '';
      previous.usedSudo = Boolean(state.useSudo);
    } else {
      list.unshift({
        id: createRemoteCommandId(),
        command,
        workingDirectory: normalizeUiRemotePath(state.workingDirectory || '/'),
        usedSudo: Boolean(state.useSudo),
        exitCode: typeof state.exitCode === 'number' ? state.exitCode : undefined,
        error: state.error || '',
        ranAt: Date.now()
      });
    }
    if (list.length > REMOTE_COMMAND_MAX_HISTORY_PER_CONNECTION) list.length = REMOTE_COMMAND_MAX_HISTORY_PER_CONNECTION;
    remoteCommandHistoryByConnectionId.set(state.connectionId, list);
    persistRemoteCommandHistory();
  }

  function renderRemoteCommandHistoryList() {
    if (!remoteCommandHistoryList) return;
    const list = getRemoteCommandHistoryList(remoteCommandDialogConnectionId || activeConnectionId);
    if (!list.length) {
      remoteCommandHistoryList.innerHTML = '<div class="remote-command-empty">No command history yet.</div>';
      return;
    }
    remoteCommandHistoryList.innerHTML = list.map(item => {
      const exitLabel = item.error ? 'failed' : (typeof item.exitCode === 'number' ? 'exit ' + item.exitCode : 'finished');
      return '<div class="remote-command-card" data-remote-command-history-id="' + escapeHtml(item.id) + '" data-tooltip="Load command">'
        + '<div class="remote-command-card-header remote-command-card-header-compact">'
        + '<div class="remote-command-card-name">' + escapeHtml(truncateRemoteCommandText(firstRemoteCommandLine(item.command) || item.command, 90)) + '</div>'
        + '<button class="secondary remote-command-icon-button" type="button" data-remote-command-action="save-history" data-tooltip="Save as command">☆</button>'
        + '</div>'
        + '<div class="remote-command-card-meta">' + escapeHtml(formatRemoteCommandRelativeTime(item.ranAt) + ' · ' + exitLabel) + '</div>'
        + '</div>';
    }).join('');
  }

  function saveHistoryItemAsSavedCommand(item) {
    if (!item) return;
    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const list = getRemoteCommandSavedList(connectionId);
    const command = String(item.command || '').trim();
    if (!command) return;
    const remotePath = getRemoteCommandItemRemotePath(item);
    const savedItem = {
      id: createRemoteCommandId(),
      name: firstRemoteCommandLine(command) || 'Saved command',
      details: '',
      command,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    if (remotePath) savedItem.remotePath = remotePath;
    list.unshift(savedItem);
    remoteCommandSavedByConnectionId.set(connectionId, list);
    persistRemoteCommandSaved();
    renderRemoteCommandSavedList();
    renderServerViewIfActiveRemoteCommandConnection(connectionId);
  }

  function browseRemoteCommandWorkingDirectory() {
    const state = getCurrentRemoteCommandSession();
    if (!activeConnectionId || state.status === 'running') return;
    const path = normalizeUiRemotePath(remoteCommandWorkingDirectory.value || currentPath.value || '/');
    showRemoteCommandWorkingDirectoryPicker(path);
    requestRemoteCommandWorkingDirectoryEntries(path);
  }

  function showRemoteCommandWorkingDirectoryPicker(path) {
    remoteCommandWorkingDirectoryPickerOpen = true;
    remoteCommandWorkingDirectoryPickerPathValue = normalizeUiRemotePath(path || '/');
    if (remoteCommandWorkingDirectoryPicker) {
      remoteCommandWorkingDirectoryPicker.classList.remove('hidden');
      remoteCommandWorkingDirectoryPicker.setAttribute('aria-hidden', 'false');
    }
    if (remoteCommandWorkingDirectoryPickerPath) remoteCommandWorkingDirectoryPickerPath.textContent = remoteCommandWorkingDirectoryPickerPathValue;
    if (remoteCommandWorkingDirectoryPickerList) remoteCommandWorkingDirectoryPickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
  }

  function hideRemoteCommandWorkingDirectoryPicker() {
    remoteCommandWorkingDirectoryPickerOpen = false;
    if (remoteCommandWorkingDirectoryPicker) {
      remoteCommandWorkingDirectoryPicker.classList.add('hidden');
      remoteCommandWorkingDirectoryPicker.setAttribute('aria-hidden', 'true');
    }
  }

  function selectRemoteCommandWorkingDirectoryPickerPath() {
    const state = getCurrentRemoteCommandSession();
    if (state.status === 'running') return;
    remoteCommandWorkingDirectory.value = normalizeUiRemotePath(remoteCommandWorkingDirectoryPickerPathValue || '/');
    state.workingDirectory = normalizeUiRemotePath(remoteCommandWorkingDirectory.value || '/');
    hideRemoteCommandWorkingDirectoryPicker();
    updateRemoteCommandControls();
  }

  function requestRemoteCommandWorkingDirectoryEntries(path) {
    const state = getCurrentRemoteCommandSession();
    if (!activeConnectionId || state.status === 'running') return;
    const scopePath = normalizeUiRemotePath(path || '/');
    remoteCommandWorkingDirectoryPickerPathValue = scopePath;
    if (remoteCommandWorkingDirectoryPickerPath) remoteCommandWorkingDirectoryPickerPath.textContent = scopePath;
    if (remoteCommandWorkingDirectoryPickerList) remoteCommandWorkingDirectoryPickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
    vscode.postMessage({ type: 'browseRemoteSearchScope', payload: { scopePath } });
  }

  function handleRemoteCommandWorkingDirectoryEntriesListed(payload) {
    if (!remoteCommandWorkingDirectoryPickerOpen) return false;
    if (payload.connectionId && activeConnectionId && payload.connectionId !== activeConnectionId) return true;
`;}
