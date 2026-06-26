export function renderOwnerGroupProperties(): string {
  return `    const path = normalizeUiRemotePath(payload.path || '/');
    const parentPath = normalizeUiRemotePath(payload.parentPath || '/');
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    remoteCommandWorkingDirectoryPickerPathValue = path;
    if (remoteCommandWorkingDirectoryPickerPath) remoteCommandWorkingDirectoryPickerPath.textContent = path;
    if (!remoteCommandWorkingDirectoryPickerList) return true;
    const parentItem = '<button class="remote-search-scope-picker-item" type="button" data-remote-command-working-directory-path="' + escapeHtml(parentPath) + '"><span>..</span></button>';
    const directoryItems = entries
      .filter(entry => entry && getEffectiveEntryType(entry) === 'directory')
      .map(entry => {
        const entryPath = normalizeUiRemotePath(entry.path || entry.name || '/');
        return '<button class="remote-search-scope-picker-item" type="button" data-remote-command-working-directory-path="' + escapeHtml(entryPath) + '"><span>' + escapeHtml(entry.name || entryPath) + '</span></button>';
      })
      .join('');
    remoteCommandWorkingDirectoryPickerList.innerHTML = parentItem + (directoryItems || '<div class="remote-search-scope-picker-empty">No folders.</div>');
    return true;
  }

  function showOwnerGroupDialog(entries) {
    const selectedEntries = Array.isArray(entries) ? entries.filter(entry => entry && !isParentEntry(entry)) : [];
    if (!selectedEntries.length) return;

    const prefillOwner = getCommonOwnerGroupDialogValue(selectedEntries, 'owner');
    const prefillGroup = getCommonOwnerGroupDialogValue(selectedEntries, 'group');

    ownerGroupEntries = selectedEntries.map(actionPayload);
    ownerGroupDialogOpen = true;
    ownerGroupOwnerInput.value = prefillOwner;
    ownerGroupGroupInput.value = prefillGroup;
    ownerGroupRecursiveInput.checked = false;
    ownerGroupValidation.textContent = '';

    const hasDirectory = selectedEntries.some(entry => getEffectiveEntryType(entry) === 'directory');
    ownerGroupTitle.textContent = selectedEntries.length === 1 ? 'Change Owner/Group' : 'Change Owner/Group for Selected Items';
    ownerGroupPath.textContent = selectedEntries.length === 1
      ? (selectedEntries[0].path || selectedEntries[0].name || '')
      : selectedEntries.length + ' selected items';
    ownerGroupRecursiveRow.style.display = hasDirectory ? '' : 'none';
    ownerGroupHelperBlock.classList.toggle('no-recursive', !hasDirectory);
    ownerGroupNote.textContent = hasDirectory
      ? 'Recursive changes may take a long time on large directory trees.'
      : '';

    updateOwnerGroupApplyState();
    ensureOwnerGroupSuggestionsRequested();
    ownerGroupBackdrop.classList.add('visible');
    ownerGroupBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => ownerGroupOwnerInput.focus(), 0);
  }

  function hideOwnerGroupDialog() {
    ownerGroupDialogOpen = false;
    ownerGroupEntries = [];
    hideOwnerGroupSuggestions();
    ownerGroupBackdrop.classList.remove('visible');
    ownerGroupBackdrop.setAttribute('aria-hidden', 'true');
  }

  function getOwnerGroupSuggestionCache(connectionId) {
    const id = String(connectionId || activeConnectionId || '').trim();
    if (!id) return { owners: [], groups: [], loading: false, loaded: true, error: '' };
    let cache = ownerGroupSuggestionsByConnectionId.get(id);
    if (!cache) {
      cache = { owners: [], groups: [], loading: false, loaded: false, error: '' };
      ownerGroupSuggestionsByConnectionId.set(id, cache);
    }
    return cache;
  }

  function ensureOwnerGroupSuggestionsRequested() {
    if (!ownerGroupDialogOpen || !activeConnectionId) return;
    const cache = getOwnerGroupSuggestionCache(activeConnectionId);
    if (cache.loading || cache.loaded) return;
    cache.loading = true;
    cache.error = '';
    vscode.postMessage({ type: 'requestOwnerGroupSuggestions', payload: { connectionId: activeConnectionId } });
  }

  function handleOwnerGroupSuggestions(payload) {
    const connectionId = String(payload.connectionId || '').trim();
    if (!connectionId) return;
    const cache = getOwnerGroupSuggestionCache(connectionId);
    cache.owners = normalizeOwnerGroupSuggestions(payload.owners || []);
    cache.groups = normalizeOwnerGroupSuggestions(payload.groups || []);
    cache.loading = false;
    cache.loaded = true;
    cache.error = payload.error ? String(payload.error) : '';
    if (ownerGroupDialogOpen && connectionId === activeConnectionId && ownerGroupActiveSuggestionKind) {
      renderOwnerGroupSuggestions(ownerGroupActiveSuggestionKind);
    }
  }

  function normalizeOwnerGroupSuggestions(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    return values
      .map(value => ({
        name: String(value && value.name || '').trim(),
        id: String(value && value.id || '').trim(),
        detail: String(value && value.detail || '').trim()
      }))
      .filter(value => {
        if (!value.name || seen.has(value.name)) return false;
        seen.add(value.name);
        return true;
      })
      .slice(0, 500);
  }

  function showOwnerGroupSuggestions(kind) {
    ownerGroupActiveSuggestionKind = kind;
    ensureOwnerGroupSuggestionsRequested();
    renderOwnerGroupSuggestions(kind);
  }

  function isOwnerGroupSuggestionsOpen() {
    return Boolean(
      ownerGroupActiveSuggestionKind
      && (
        (ownerGroupOwnerSuggestions && ownerGroupOwnerSuggestions.classList.contains('visible'))
        || (ownerGroupGroupSuggestions && ownerGroupGroupSuggestions.classList.contains('visible'))
      )
    );
  }

  function hideOwnerGroupSuggestions() {
    ownerGroupActiveSuggestionKind = '';
    if (ownerGroupSuggestionRepositionFrame) {
      cancelAnimationFrame(ownerGroupSuggestionRepositionFrame);
      ownerGroupSuggestionRepositionFrame = 0;
    }
    if (ownerGroupOwnerSuggestions) ownerGroupOwnerSuggestions.classList.remove('visible');
    if (ownerGroupGroupSuggestions) ownerGroupGroupSuggestions.classList.remove('visible');
    if (ownerGroupOwnerInput) ownerGroupOwnerInput.setAttribute('aria-expanded', 'false');
    if (ownerGroupGroupInput) ownerGroupGroupInput.setAttribute('aria-expanded', 'false');
  }

  function ensureOwnerGroupSuggestionPortal() {
    if (ownerGroupOwnerSuggestions && ownerGroupOwnerSuggestions.parentElement !== document.body) {
      document.body.appendChild(ownerGroupOwnerSuggestions);
    }
    if (ownerGroupGroupSuggestions && ownerGroupGroupSuggestions.parentElement !== document.body) {
      document.body.appendChild(ownerGroupGroupSuggestions);
    }
  }

  function positionOwnerGroupSuggestions(kind) {
    const isOwner = kind === 'owner';
    const input = isOwner ? ownerGroupOwnerInput : ownerGroupGroupInput;
    const menu = isOwner ? ownerGroupOwnerSuggestions : ownerGroupGroupSuggestions;
    if (!ownerGroupDialogOpen || !input || !menu || !menu.classList.contains('visible')) return;

    ensureOwnerGroupSuggestionPortal();

    const rect = input.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const width = Math.max(180, Math.round(rect.width));
    const maxLeft = window.innerWidth - width - margin;
    const left = Math.max(margin, Math.min(Math.round(rect.left), maxLeft));
    const availableBelow = window.innerHeight - rect.bottom - margin - gap;
    const availableAbove = rect.top - margin - gap;
    const preferredHeight = Math.min(220, Math.max(120, menu.scrollHeight || 190));
    const placeBelow = availableBelow >= Math.min(preferredHeight, 160) || availableBelow >= availableAbove;
    const maxHeight = Math.max(72, Math.min(220, placeBelow ? availableBelow : availableAbove));
    const top = placeBelow
      ? Math.round(rect.bottom + gap)
      : Math.max(margin, Math.round(rect.top - gap - maxHeight));

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.width = width + 'px';
    menu.style.maxHeight = Math.round(maxHeight) + 'px';
  }

  function scheduleOwnerGroupSuggestionsPosition() {
    if (!ownerGroupDialogOpen || !ownerGroupActiveSuggestionKind) return;
    if (ownerGroupSuggestionRepositionFrame) cancelAnimationFrame(ownerGroupSuggestionRepositionFrame);
    ownerGroupSuggestionRepositionFrame = requestAnimationFrame(() => {
      ownerGroupSuggestionRepositionFrame = 0;
      positionOwnerGroupSuggestions(ownerGroupActiveSuggestionKind);
    });
  }

  function renderOwnerGroupSuggestions(kind) {
    const isOwner = kind === 'owner';
    const input = isOwner ? ownerGroupOwnerInput : ownerGroupGroupInput;
    const menu = isOwner ? ownerGroupOwnerSuggestions : ownerGroupGroupSuggestions;
    if (!ownerGroupDialogOpen || !input || !menu || ownerGroupActiveSuggestionKind !== kind) return;

    const cache = getOwnerGroupSuggestionCache(activeConnectionId);
    const source = isOwner ? cache.owners : cache.groups;
    const filter = String(input.value || '').trim().toLowerCase();
    const matches = source
      .filter(item => {
        if (!filter) return true;
        return item.name.toLowerCase().includes(filter)
          || item.id.toLowerCase().includes(filter)
          || item.detail.toLowerCase().includes(filter);
      })
      .slice(0, 80);

    if (cache.loading && !source.length) {
      menu.innerHTML = '<div class="owner-group-suggestion-empty">Loading suggestions...</div>';
    } else if (matches.length) {
      menu.innerHTML = matches.map(item => '<button type="button" class="owner-group-suggestion-item" role="option" data-owner-group-kind="' + escapeHtml(kind) + '" data-owner-group-value="' + escapeHtml(item.name) + '"><span class="owner-group-suggestion-name">' + escapeHtml(item.name) + '</span><span class="owner-group-suggestion-detail">' + escapeHtml(item.detail || item.id || '') + '</span></button>').join('');
    } else if (cache.loaded && source.length) {
      menu.innerHTML = '<div class="owner-group-suggestion-empty">No matching suggestions. You can type manually.</div>';
    } else if (cache.error) {
      menu.innerHTML = '<div class="owner-group-suggestion-empty error">Suggestions unavailable. You can type manually.</div>';
    } else {
      menu.innerHTML = '<div class="owner-group-suggestion-empty">No suggestions. You can type manually.</div>';
    }

    ensureOwnerGroupSuggestionPortal();
    menu.classList.add('visible');
    input.setAttribute('aria-expanded', 'true');
    positionOwnerGroupSuggestions(kind);
  }

  function handleOwnerGroupSuggestionClick(event, expectedKind) {
    const item = event.target && event.target.closest ? event.target.closest('[data-owner-group-value]') : null;
    if (!item) return;
    const kind = item.dataset.ownerGroupKind || expectedKind;
    const value = item.dataset.ownerGroupValue || '';
    if (kind === 'owner') ownerGroupOwnerInput.value = value;
    if (kind === 'group') ownerGroupGroupInput.value = value;
    hideOwnerGroupSuggestions();
    updateOwnerGroupApplyState();
    if (kind === 'owner') ownerGroupOwnerInput.focus();
    if (kind === 'group') ownerGroupGroupInput.focus();
  }

  function getCommonOwnerGroupDialogValue(entries, key) {
    const values = (Array.isArray(entries) ? entries : [])
      .map(entry => formatMetadata(entry && entry[key]).trim())
      .filter(Boolean);

    if (!values.length) return '';

    const first = values[0];
    return values.every(value => value === first) ? first : '';
  }

  function updateOwnerGroupApplyState() {
    const owner = String(ownerGroupOwnerInput.value || '').trim();
    const group = String(ownerGroupGroupInput.value || '').trim();
    const validationMessage = getOwnerGroupValidationMessage(owner, group, false);
    ownerGroupApplyButton.disabled = Boolean(validationMessage) || (!owner && !group);
    ownerGroupValidation.textContent = validationMessage || '';
  }

  function applyOwnerGroupDialog() {
    if (!getActiveRemoteCapabilities().canChangeOwnerGroup) {
      hideOwnerGroupDialog();
      setStatus('Change Owner/Group is available only for SFTP connections.', true);
      return;
    }

    const owner = String(ownerGroupOwnerInput.value || '').trim();
    const group = String(ownerGroupGroupInput.value || '').trim();
    const validationMessage = getOwnerGroupValidationMessage(owner, group, true);

    if (validationMessage) {
      ownerGroupValidation.textContent = validationMessage;
      ownerGroupApplyButton.disabled = true;
      return;
    }

    const entries = ownerGroupEntries.slice();
    hideOwnerGroupDialog();
    vscode.postMessage({
      type: 'requestChangeOwnerGroup',
      payload: {
        entries,
        owner,
        group,
        recursive: Boolean(ownerGroupRecursiveInput.checked)
      }
    });
  }

  function getOwnerGroupValidationMessage(owner, group, requireValue) {
    if (requireValue && !owner && !group) {
      return 'Enter an owner, a group, or both.';
    }

    const ownerMessage = validateOwnerGroupInput(owner, 'Owner');
    if (ownerMessage) return ownerMessage;

    const groupMessage = validateOwnerGroupInput(group, 'Group');
    if (groupMessage) return groupMessage;

    return '';
  }

  function validateOwnerGroupInput(value, label) {
    const text = String(value || '').trim();
    if (!text) return '';

    if (!/^[A-Za-z0-9_][A-Za-z0-9._@+-]*$/.test(text)) {
      return label + ' can contain letters, numbers, underscore, dot, dash, plus, and at sign, and must not start with a dash.';
    }

    return '';
  }

  function showFilePropertiesDialog(entry) {
    if (!entry) return;

    filePropertiesDialogOpen = true;
    filePropertiesRemotePath = entry.path || '';
    const active = getActiveSession();
    const entryType = getEffectiveEntryType(entry);
    const isDirectory = entryType === 'directory';
    const isFile = entryType === 'file';
    const isLink = entry.type === 'link';
    const title = isDirectory
      ? 'Directory Properties'
      : isLink
        ? 'Link Properties'
        : isFile
          ? 'File Properties'
          : 'Item Properties';
    const pathLabel = isDirectory
      ? 'Remote directory'
      : isLink
        ? 'Remote link'
        : isFile
          ? 'Remote file'
          : 'Remote Path';

    filePropertiesTitle.textContent = title;
    filePropertiesPath.textContent = entry.path || '';

    const rows = [
      ['Name', entry.name || '—'],
      [pathLabel, entry.path || '—'],
      ['Type', formatPropertyType(entry)]
    ];

    if (!isDirectory) {
      rows.push(['Size', formatSize(entry.size)]);
    }

    rows.push(
      ['Modified', formatDate(entry.modifyTime) || '—'],
      ['Permissions', formatPermissionsPropertyValue(entry.permissions)],
      ['Owner', formatMetadata(entry.owner) || '—'],
      ['Group', formatMetadata(entry.group) || '—']
    );

    if (isLink && entry.linkTarget) {
      rows.push(['Symlink target', entry.linkTarget]);
    }

    if (isLink && entry.effectiveType) {
      rows.push(['Resolved type', capitalizeText(entry.effectiveType)]);
    }

    rows.push(
      ['Connection', active ? active.name : '—'],
      ['Host', active ? formatSessionTarget(active) : '—']
    );

    filePropertiesGrid.innerHTML = rows.map(row => {
      return '<div class="file-properties-label">' + escapeHtml(row[0]) + '</div>'
        + '<div class="file-properties-value">' + escapeHtml(row[1] || '—') + '</div>';
    }).join('');

    filePropertiesCopyPathButton.disabled = !filePropertiesRemotePath;
    filePropertiesBackdrop.classList.add('visible');
    filePropertiesBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => filePropertiesCloseButton.focus(), 0);
  }

  function hideFilePropertiesDialog() {
    if (!filePropertiesBackdrop) return;
    filePropertiesDialogOpen = false;
    filePropertiesRemotePath = '';
    filePropertiesBackdrop.classList.remove('visible');
    filePropertiesBackdrop.setAttribute('aria-hidden', 'true');
  }

  function showChecksumsDialog(payload) {
    checksumsDialogOpen = true;
    const remotePath = payload.remotePath || '';
    checksumsCopyState = {
      sha256: payload.sha256Value || '',
      md5: payload.md5Value || '',
      all: payload.copyAllText || ''
    };

    checksumsPath.textContent = remotePath;

    const rows = [
      ['Remote file', remotePath || '—'],
      ['Size', payload.size || '—'],
      ['Modified', payload.modified || '—'],
      ['SHA-256', payload.sha256 || 'Not available'],
      ['MD5', payload.md5 || 'Not available']
    ];

    checksumsGrid.innerHTML = rows.map(row => {
      return '<div class="file-properties-label">' + escapeHtml(row[0]) + '</div>'
        + '<div class="file-properties-value">' + escapeHtml(row[1] || '—') + '</div>';
    }).join('');

    checksumsCopySha256Button.disabled = !checksumsCopyState.sha256;
    checksumsCopyMd5Button.disabled = !checksumsCopyState.md5;
    checksumsCopyAllButton.disabled = !checksumsCopyState.all;
    checksumsBackdrop.classList.add('visible');
    checksumsBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => checksumsCloseButton.focus(), 0);
  }

  function hideChecksumsDialog() {
    if (!checksumsBackdrop) return;
    checksumsDialogOpen = false;
    checksumsCopyState = { sha256: '', md5: '', all: '' };
    checksumsBackdrop.classList.remove('visible');
    checksumsBackdrop.setAttribute('aria-hidden', 'true');
  }

  function copyChecksumValue(text, message) {
    const value = String(text || '').trim();
    if (!value) return;
    vscode.postMessage({ type: 'copyStatus', payload: { text: value, message } });
  }

  function formatPropertyType(entry) {
    if (!entry) return 'Unknown';
    if (entry.type === 'link') {
      const resolvedType = entry.effectiveType ? ' (' + capitalizeText(entry.effectiveType) + ')' : '';
      return 'Symbolic link' + resolvedType;
    }
    return capitalizeText(entry.type || 'unknown');
  }

  function capitalizeText(value) {
    const text = String(value || 'unknown');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function showPermissionsDialog(options) {
    permissionsDialogOpen = true;
    hideContextMenu();

    const state = options.permissionState || {};
    const selectedCount = Number(options.selectedCount || 1);
    const hasDirectory = Boolean(options.hasDirectory);
    const hasFile = Boolean(options.hasFile);
    const isMixed = Boolean(options.isMixed);
    permissionPreviewKind = isMixed ? 'mixed' : (hasDirectory && !hasFile ? 'directory' : 'file');

    permissionDialogTitle.textContent = selectedCount > 1
      ? 'Set Permissions for selected items'
      : 'Set Permissions: ' + (options.entryName || 'selected item');
    permissionDialogPath.textContent = selectedCount > 1
      ? selectedCount + ' selected items'
      : (options.remotePath || '');

    if (isMixed) {
      permissionSetuidLabel.textContent = 'Set user ID / setuid';
      permissionSetgidLabel.textContent = 'Set group ID / setgid';
      permissionStickyLabel.textContent = 'Sticky bit';
    } else if (hasDirectory) {
      permissionSetuidLabel.textContent = 'Set user ID / usually ignored on directories';
      permissionSetgidLabel.textContent = 'Inherit group for new files and folders / setgid';
      permissionStickyLabel.textContent = 'Restrict delete/rename to item owners / sticky';
    } else {
      permissionSetuidLabel.textContent = 'Run as owner / setuid';
      permissionSetgidLabel.textContent = 'Run as group / setgid';
      permissionStickyLabel.textContent = 'Sticky bit / rarely used on files';
    }

    permissionRecursiveInput.checked = false;
    permissionRecursiveRow.style.display = hasDirectory ? '' : 'none';
    permissionHelperBlock.classList.toggle('no-recursive', !hasDirectory);
    permissionNote.textContent = hasDirectory
      ? 'Recursive changes may take a long time on large directory trees.'
      : '';

    for (const checkbox of permissionCheckboxes) {
      checkbox.checked = Boolean(state[checkbox.dataset.permission]);
    }

    permissionModeInput.value = normalizePermissionMode(String(options.initialMode || '').trim()) || calculateModeFromPermissionCheckboxes();
    updatePermissionPreview(permissionModeInput.value);
    setPermissionValidation('', true);
    permissionBackdrop.classList.add('visible');
    permissionBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => permissionModeInput.focus(), 0);
  }

  function hidePermissionsDialog() {
    permissionsDialogOpen = false;
    permissionBackdrop.classList.remove('visible');
    permissionBackdrop.setAttribute('aria-hidden', 'true');
    permissionRecursiveInput.checked = false;
    setPermissionValidation('', true);
  }

  function calculateModeFromPermissionCheckboxes() {
    const selected = new Set(permissionCheckboxes.filter(item => item.checked).map(item => item.dataset.permission));
    const special = (selected.has('setuid') ? 4 : 0) + (selected.has('setgid') ? 2 : 0) + (selected.has('sticky') ? 1 : 0);
    const owner = permissionDigit(selected, ['ownerRead', 'ownerWrite', 'ownerExecute']);
    const group = permissionDigit(selected, ['groupRead', 'groupWrite', 'groupExecute']);
    const others = permissionDigit(selected, ['othersRead', 'othersWrite', 'othersExecute']);
    return String(special) + String(owner) + String(group) + String(others);
  }

  function permissionDigit(selected, keys) {
    return (selected.has(keys[0]) ? 4 : 0) + (selected.has(keys[1]) ? 2 : 0) + (selected.has(keys[2]) ? 1 : 0);
  }

  function normalizePermissionMode(value) {
    if (/^[0-7]{3}$/.test(value)) return '0' + value;
    if (/^[0-7]{4}$/.test(value)) return value;
    return '';
  }

  function updatePermissionCheckboxesFromMode(mode) {
    const digits = mode.split('').map(item => Number(item));
    const special = digits[0];
    setPermissionChecked('setuid', (special & 4) !== 0);
    setPermissionChecked('setgid', (special & 2) !== 0);
    setPermissionChecked('sticky', (special & 1) !== 0);
    updatePermissionGroup(['ownerRead', 'ownerWrite', 'ownerExecute'], digits[1]);
    updatePermissionGroup(['groupRead', 'groupWrite', 'groupExecute'], digits[2]);
    updatePermissionGroup(['othersRead', 'othersWrite', 'othersExecute'], digits[3]);
  }

  function updatePermissionGroup(keys, digit) {
    setPermissionChecked(keys[0], (digit & 4) !== 0);
    setPermissionChecked(keys[1], (digit & 2) !== 0);
    setPermissionChecked(keys[2], (digit & 1) !== 0);
  }

  function setPermissionChecked(permission, checked) {
    const checkbox = permissionCheckboxes.find(item => item.dataset.permission === permission);
    if (checkbox) checkbox.checked = checked;
  }


  function updatePermissionPreview(mode) {
    const normalized = normalizePermissionMode(String(mode || '').trim());
    if (!normalized) {
      setPermissionPreviewLines(['Preview: —']);
      return;
    }

    if (permissionPreviewKind === 'mixed') {
      setPermissionPreviewLines([
        'File preview: ' + permissionSymbolicFromMode(normalized, '-') + ' (' + normalized + ')',
        'Directory preview: ' + permissionSymbolicFromMode(normalized, 'd') + ' (' + normalized + ')'
      ]);
      return;
    }

    const typeChar = permissionPreviewKind === 'directory' ? 'd' : '-';
    setPermissionPreviewLines(['Preview: ' + permissionSymbolicFromMode(normalized, typeChar) + ' (' + normalized + ')']);
  }

  function setPermissionPreviewLines(lines) {
    permissionCurrentText.replaceChildren();
    for (const text of lines) {
      const line = document.createElement('span');
      line.className = 'permission-preview-line';
      line.textContent = text;
      permissionCurrentText.appendChild(line);
    }
  }

  function permissionSymbolicFromMode(mode, typeChar) {
    const digits = normalizePermissionMode(mode).split('').map(item => Number(item));
    const special = digits[0];
    const owner = digits[1];
    const group = digits[2];
    const others = digits[3];

    return typeChar +
      permissionTriplet(owner, (special & 4) !== 0, 's') +
      permissionTriplet(group, (special & 2) !== 0, 's') +
      permissionTriplet(others, (special & 1) !== 0, 't');
  }

  function permissionTriplet(digit, special, specialExecuteChar) {
    return ((digit & 4) ? 'r' : '-') +
      ((digit & 2) ? 'w' : '-') +
      ((digit & 1) ? (special ? specialExecuteChar : 'x') : (special ? specialExecuteChar.toUpperCase() : '-'));
  }

  function setPermissionValidation(message, isValid) {
    permissionValidation.textContent = message;
    permissionModeInput.classList.toggle('invalid', !isValid);
    permissionApplyButton.disabled = !isValid;
  }

`;}
