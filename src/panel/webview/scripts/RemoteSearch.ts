export function renderRemoteSearch(): string {
  return `  function getActiveProfile() {
    return profiles.find(profile => profile.id === activeConnectionId) || null;
  }

  function getFavoriteRemotePaths() {
    const activeProfile = getActiveProfile();
    return activeProfile && Array.isArray(activeProfile.favoriteRemotePaths) ? activeProfile.favoriteRemotePaths : [];
  }

  function normalizeUiRemotePath(value) {
    let trimmed = String(value || '').trim().split('\\\\').join('/');
    while (trimmed.indexOf('//') !== -1) trimmed = trimmed.split('//').join('/');
    if (!trimmed) return '/';
    return trimmed.charAt(0) === '/' ? trimmed : '/' + trimmed;
  }

  function isCurrentPathFavorite() {
    const current = normalizeUiRemotePath(currentPath.value || '/');
    return getFavoriteRemotePaths().includes(current);
  }

  function isRemotePathEdited() {
    const active = getActiveSession();
    if (!active || !active.currentPath) return false;
    return normalizeUiRemotePath(currentPath.value || '/') !== normalizeUiRemotePath(active.currentPath || '/');
  }

  function updateRemotePathActionButton() {
    if (!goButton) return;
    const goMode = Boolean(activeConnectionId) && isRemotePathEdited();
    goButton.innerHTML = goMode ? REMOTE_PATH_GO_ICON : REMOTE_PATH_REFRESH_ICON;
    goButton.classList.toggle('go-mode', goMode);
    goButton.classList.toggle('refresh-mode', !goMode);
    goButton.setAttribute('aria-label', goMode ? 'Go to Remote Path' : 'Refresh Current Directory');
    goButton.dataset.tooltip = goMode ? 'Go to Remote Path' : 'Refresh Current Directory';
  }

  function runRemotePathAction() {
    if (goButton.disabled || !activeConnectionId || busy) return;
    const path = normalizeUiRemotePath(currentPath.value || '/');
    if (isRemotePathEdited()) {
      exitRemotePathEditMode({ reset: true });
      openPath(path);
      return;
    }
    listDirectory(path, { forceRefresh: true });
  }

  function updatePathFavoriteControls() {
    if (!togglePathFavoriteButton || !pathFavoritesButton) return;

    const hasActiveSession = Boolean(activeConnectionId);
    const hasSavedConnection = Boolean(getActiveProfile());
    const current = normalizeUiRemotePath(currentPath.value || '/');
    const isFavorite = hasSavedConnection && getFavoriteRemotePaths().includes(current);
    const disabled = busy || !hasActiveSession || !hasSavedConnection;
    const unavailableMessage = !hasActiveSession
      ? 'Connect to a Saved Connection to Use Remote Path Favorites'
      : 'Save This Connection to Use Remote Path Favorites';

    togglePathFavoriteButton.disabled = disabled;
    togglePathFavoriteButton.classList.toggle('active', isFavorite);
    togglePathFavoriteButton.setAttribute('aria-label', isFavorite ? 'Remove Remote Path Favorite' : 'Add Remote Path Favorite');
    togglePathFavoriteButton.dataset.tooltip = disabled
      ? unavailableMessage
      : (isFavorite ? 'Remove from Favorite Remote Paths' : 'Add to Favorite Remote Paths');

    pathFavoritesButton.disabled = disabled;
    pathFavoritesButton.classList.toggle('has-favorites', hasSavedConnection && getFavoriteRemotePaths().length > 0);
    pathFavoritesButton.dataset.tooltip = disabled ? unavailableMessage : 'Show Favorite Remote Paths';

    if (disabled) {
      hidePathFavoritesPopover();
    }
  }

  function showPathFavoritesPopover() {
    pathFavoritesOpen = true;
    renderPathFavoritesPopover();
    pathFavoritesPopover.classList.add('visible');
    pathFavoritesPopover.setAttribute('aria-hidden', 'false');
    hideWebviewTooltip();
  }

  function hidePathFavoritesPopover() {
    pathFavoritesOpen = false;
    if (!pathFavoritesPopover) return;
    pathFavoritesPopover.classList.remove('visible');
    pathFavoritesPopover.setAttribute('aria-hidden', 'true');
  }

  function renderPathFavoritesPopover() {
    if (!pathFavoritesList) return;

    const activeProfile = getActiveProfile();

    if (!activeProfile) {
      pathFavoritesList.innerHTML = '<div class="remote-path-favorites-empty">Save This Connection to Use Remote Path Favorites.</div>';
      return;
    }

    const favoriteRemotePaths = getFavoriteRemotePaths();

    if (!favoriteRemotePaths.length) {
      pathFavoritesList.innerHTML = '<div class="remote-path-favorites-empty">No favorite remote paths for this connection.</div>';
      return;
    }

    pathFavoritesList.innerHTML = favoriteRemotePaths.map(path => {
      const escapedPath = escapeHtml(path);
      return '<div class="remote-path-favorite-item">' +
        '<button type="button" class="remote-path-favorite-path" data-favorite-path="' + escapedPath + '" data-tooltip="' + escapedPath + '">' + escapedPath + '</button>' +
        '<button type="button" class="remote-path-favorite-remove" data-favorite-action="remove" data-favorite-path="' + escapedPath + '" aria-label="Remove ' + escapedPath + '">×</button>' +
        '</div>';
    }).join('');
  }

  function setConnectionFieldInvalid(field, invalid) {
    if (!field) return;
    field.classList.toggle('connection-input-invalid', Boolean(invalid));
    if (invalid) {
      field.setAttribute('aria-invalid', 'true');
    } else {
      field.removeAttribute('aria-invalid');
    }
  }

  function clearConnectionFieldInvalid(field) {
    setConnectionFieldInvalid(field, false);
  }

  function clearConnectionValidationErrors() {
    for (const field of [host, port, username, password, privateKeyPath, ftpsCaCertificatePath]) {
      clearConnectionFieldInvalid(field);
    }
  }

  function hasPasswordForConnection() {
    const value = String(password.value || '');
    return value === SAVED_SECRET_MASK || value.length > 0;
  }

  function isValidConnectionPort(value) {
    const numeric = Number(String(value || '').trim());
    return Number.isFinite(numeric) && numeric > 0 && numeric <= 65535;
  }

  function getConnectionValidationErrors(action) {
    const mode = action === 'save' ? 'save' : 'connect';
    const normalizedConnectionType = normalizeConnectionTypeValue(connectionType.value);
    const normalizedAuthType = normalizedConnectionType === 'sftp' ? String(authType.value || 'password') : 'password';
    const isPrivateKeyAuth = normalizedConnectionType === 'sftp' && normalizedAuthType === 'privateKey';
    const requiresFtpsCaCertificate = normalizedConnectionType === 'ftps' && !Boolean(ftpsAllowSelfSignedCertificate.checked);
    const errors = [];

    if (!String(host.value || '').trim()) {
      errors.push({ field: host, label: 'Host', kind: 'required', message: 'Host is required.' });
    }

    if (!isValidConnectionPort(port.value)) {
      errors.push({ field: port, label: 'Port', kind: 'invalid', message: 'Port must be a number between 1 and 65535.' });
    }

    if (mode === 'connect' && !String(username.value || '').trim()) {
      errors.push({ field: username, label: 'Username', kind: 'required', message: 'Username is required to connect.' });
    }

    if (mode === 'connect' && !isPrivateKeyAuth && !hasPasswordForConnection()) {
      errors.push({ field: password, label: 'Password', kind: 'required', message: 'Password is required for password authentication.' });
    }

    if (mode === 'connect' && isPrivateKeyAuth && !String(privateKeyPath.value || '').trim()) {
      errors.push({ field: privateKeyPath, label: 'Private key path', kind: 'required', message: 'Private key path is required for private key authentication.' });
    }

    if (mode === 'connect' && requiresFtpsCaCertificate && !String(ftpsCaCertificatePath.value || '').trim()) {
      errors.push({ field: ftpsCaCertificatePath, label: 'CA certificate path', kind: 'required', message: 'CA certificate path is required for FTPS unless self-signed/untrusted certificates are allowed.' });
    }

    return errors;
  }

  function formatConnectionValidationSummary(errors) {
    if (!errors.length) return '';
    if (errors.length === 1) return errors[0].message;

    const requiredFields = errors.filter(error => error.kind === 'required').map(error => error.label);
    const invalidFields = errors.filter(error => error.kind === 'invalid').map(error => error.label);
    const parts = [];

    if (requiredFields.length) {
      parts.push('Required fields: ' + requiredFields.join(', ') + '.');
    }

    if (invalidFields.length) {
      parts.push('Invalid fields: ' + invalidFields.join(', ') + '.');
    }

    return parts.join(' ');
  }

  function normalizeConnectionNameForComparison(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getConnectionNameError(value, excludeProfileId) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return 'Connection name is required.';

    const duplicate = profiles.find(profile => {
      if (!profile || profile.id === excludeProfileId) return false;
      return normalizeConnectionNameForComparison(profile.name) === normalizeConnectionNameForComparison(trimmed);
    });

    return duplicate ? 'A connection named "' + trimmed + '" already exists.' : '';
  }

  function getConnectionNameNewGroupError(value) {
    if (!connectionNameGroupNewMode) return '';
    const trimmed = String(value || '').trim();
    if (!trimmed) return 'Group name is required.';

    const duplicate = connectionGroups.find(group => {
      if (!group) return false;
      return normalizeConnectionNameForComparison(group.name) === normalizeConnectionNameForComparison(trimmed);
    });

    return duplicate ? 'A connection group named "' + trimmed + '" already exists. Select it from the dropdown.' : '';
  }

  function validateConnectionNameInput(showFeedback) {
    const nameMessage = getConnectionNameError(connectionNameInput.value, selectedProfileId || '');
    const groupMessage = getConnectionNameNewGroupError(connectionNameGroupNewInput ? connectionNameGroupNewInput.value : '');
    const message = nameMessage || groupMessage;
    connectionNameFeedback.textContent = (showFeedback || message) ? message : '';
    connectionNameInput.classList.toggle('connection-input-invalid', Boolean(nameMessage));
    if (connectionNameGroupNewInput) {
      connectionNameGroupNewInput.classList.toggle('connection-input-invalid', Boolean(groupMessage));
    }
    return !message;
  }

  function showConnectionNameDialog(initialName, initialGroupId) {
    return new Promise(resolve => {
      pendingConnectionNameResolver = resolve;
      pendingConnectionNameGroupId = '';
      pendingConnectionNameNewGroupName = '';
      connectionNameInput.value = String(initialName || '').trim();
      renderConnectionNameGroupOptions(initialGroupId || '');
      connectionNameFeedback.textContent = '';
      connectionNameInput.classList.remove('connection-input-invalid');
      connectionNameDialogOpen = true;
      connectionNameBackdrop.classList.add('visible');
      connectionNameBackdrop.setAttribute('aria-hidden', 'false');
      window.setTimeout(() => {
        connectionNameInput.focus();
        connectionNameInput.select();
      }, 0);
    });
  }

  function closeConnectionNameDialog(value) {
    hideConnectionNameGroupDropdown();
    connectionNameDialogOpen = false;
    connectionNameBackdrop.classList.remove('visible');
    connectionNameBackdrop.setAttribute('aria-hidden', 'true');
    connectionNameInput.classList.remove('connection-input-invalid');
    if (connectionNameGroupNewInput) connectionNameGroupNewInput.classList.remove('connection-input-invalid');
    connectionNameFeedback.textContent = '';
    if (!value) {
      pendingConnectionNameGroupId = '';
      pendingConnectionNameNewGroupName = '';
    }
    const resolver = pendingConnectionNameResolver;
    pendingConnectionNameResolver = null;
    if (resolver) resolver(value);
  }

  function handleConnectionNameDialogEscape(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (connectionNameGroupDropdownOpen) {
      hideConnectionNameGroupDropdown();
      if (connectionNameGroupDropdownButton) connectionNameGroupDropdownButton.focus();
      return;
    }
    if (connectionNameGroupNewMode) {
      exitConnectionNameNewGroupMode(true);
      if (connectionNameGroupDropdownButton) connectionNameGroupDropdownButton.focus();
      return;
    }
    closeConnectionNameDialog(null);
  }

  function confirmConnectionNameDialog() {
    if (!validateConnectionNameInput(true)) return;
    pendingConnectionNameGroupId = connectionNameGroupNewMode ? '' : (connectionNameGroup ? String(connectionNameGroup.value || '').trim() : '');
    pendingConnectionNameNewGroupName = connectionNameGroupNewMode && connectionNameGroupNewInput ? String(connectionNameGroupNewInput.value || '').trim() : '';
    closeConnectionNameDialog({
      name: String(connectionNameInput.value || '').trim(),
      groupId: pendingConnectionNameGroupId,
      newGroupName: pendingConnectionNameNewGroupName
    });
  }

  function getSelectedSavedProfile() {
    if (!selectedProfileId) return null;
    return profiles.find(item => item && item.id === selectedProfileId) || null;
  }

  function normalizeConnectionComparableString(value) {
    return String(value === undefined || value === null ? '' : value).trim();
  }

  function normalizeConnectionComparableNumber(value, fallback) {
    const raw = String(value === undefined || value === null ? '' : value).trim();
    const numeric = Number(raw || fallback || 0);
    return Number.isFinite(numeric) ? String(numeric) : raw;
  }

  function normalizeConnectionComparableType(value) {
    return normalizeConnectionTypeValue(value || 'sftp');
  }

  function normalizeConnectionComparableAuthType(value, connectionTypeValue) {
    return connectionTypeValue === 'sftp' && value === 'privateKey' ? 'privateKey' : 'password';
  }

  function getComparableSavedCredentialState(hasSaved, inputValue, rememberValue) {
    const value = String(inputValue || '');
    const hasTypedValue = Boolean(value && value !== SAVED_SECRET_MASK);
    const remember = Boolean(rememberValue);
    if (hasTypedValue) return remember ? 'saved:new:' + value : 'none';
    if (remember && hasSaved) return 'saved:existing';
    return 'none';
  }

  function getComparableProfileSnapshot(profile) {
    const typeValue = normalizeConnectionComparableType(profile.connectionType);
    const authValue = normalizeConnectionComparableAuthType(profile.authType || 'password', typeValue);
    return {
      name: normalizeConnectionComparableString(profile.name),
      host: normalizeConnectionComparableString(profile.host),
      connectionType: typeValue,
      port: normalizeConnectionComparableNumber(profile.port, getDefaultPortForConnectionType(typeValue)),
      username: normalizeConnectionComparableString(profile.username),
      authType: authValue,
      privateKeyPath: authValue === 'privateKey' ? normalizeConnectionComparableString(profile.privateKeyPath) : '',
      startPath: normalizeConnectionComparableString(profile.startPath),
      keepAlive: profile.keepAlive !== false,
      passwordState: authValue === 'password' && profile.hasSavedPassword ? 'saved:existing' : 'none',
      passphraseState: authValue === 'privateKey' && profile.hasSavedPassphrase ? 'saved:existing' : 'none',
      ftpsAllowSelfSignedCertificate: typeValue === 'ftps' ? Boolean(profile.ftpsAllowSelfSignedCertificate) : false,
      ftpsCaCertificatePath: typeValue === 'ftps' && !Boolean(profile.ftpsAllowSelfSignedCertificate) ? normalizeConnectionComparableString(profile.ftpsCaCertificatePath) : ''
    };
  }

  function getComparableFormSnapshot(profile) {
    const typeValue = normalizeConnectionComparableType(connectionType.value);
    const authValue = normalizeConnectionComparableAuthType(authType.value || 'password', typeValue);
    const allowSelfSigned = Boolean(ftpsAllowSelfSignedCertificate.checked);
    return {
      name: normalizeConnectionComparableString(profileName.value),
      host: normalizeConnectionComparableString(host.value),
      connectionType: typeValue,
      port: normalizeConnectionComparableNumber(port.value, getDefaultPortForConnectionType(typeValue)),
      username: normalizeConnectionComparableString(username.value),
      authType: authValue,
      privateKeyPath: authValue === 'privateKey' ? normalizeConnectionComparableString(privateKeyPath.value) : '',
      startPath: normalizeConnectionComparableString(startPath.value),
      keepAlive: Boolean(keepAlive.checked),
      passwordState: authValue === 'password'
        ? getComparableSavedCredentialState(Boolean(profile && profile.hasSavedPassword), password.value, rememberPassword.checked)
        : 'none',
      passphraseState: authValue === 'privateKey'
        ? getComparableSavedCredentialState(Boolean(profile && profile.hasSavedPassphrase), passphrase.value, rememberPassphrase.checked)
        : 'none',
      ftpsAllowSelfSignedCertificate: typeValue === 'ftps' ? allowSelfSigned : false,
      ftpsCaCertificatePath: typeValue === 'ftps' && !allowSelfSigned ? normalizeConnectionComparableString(ftpsCaCertificatePath.value) : ''
    };
  }

  function snapshotsEqual(left, right) {
    const keys = Object.keys(left || {});
    if (keys.length !== Object.keys(right || {}).length) return false;
    return keys.every(key => left[key] === right[key]);
  }

  function isSelectedSavedConnectionDirty() {
    const profile = getSelectedSavedProfile();
    if (!profile) return false;
    return !snapshotsEqual(getComparableProfileSnapshot(profile), getComparableFormSnapshot(profile));
  }

  function updateConnectionProfileDirtyState() {
    const dirty = isSelectedSavedConnectionDirty();
    if (profileDropdownButton) profileDropdownButton.classList.toggle('dirty', dirty);
    if (profileDropdownLabel) profileDropdownLabel.classList.toggle('dirty', dirty);
    return dirty;
  }

  function showUnsavedConnectionProfileSwitchDialog(targetProfileId) {
    return new Promise(resolve => {
      const currentName = normalizeConnectionComparableString(profileName.value) || 'this connection';
      pendingDirtyProfileSwitchRequestId = 'client:profileDirtySwitch:' + Date.now() + ':' + String(targetProfileId || '');
      pendingDirtyProfileSwitchResolver = resolve;
      showConfirmDialog({
        requestId: pendingDirtyProfileSwitchRequestId,
        title: 'Save connection changes?',
        message: 'You have unsaved changes to "' + currentName + '". Save them before switching profiles?',
        cancelLabel: 'Discard',
        confirmLabel: 'Save'
      });
    });
  }

  async function requestSelectProfile(profileId, options = {}) {
    const nextId = String(profileId || '');
    if (nextId === selectedProfileId) {
      selectProfile(nextId, options);
      return;
    }

    if (isSelectedSavedConnectionDirty()) {
      if (profileSelect) profileSelect.value = selectedProfileId;
      const decision = await showUnsavedConnectionProfileSwitchDialog(nextId);
      if (decision === 'save') {
        pendingProfileSelectionAfterSaveId = nextId;
        const saveStarted = await saveCurrentConnection();
        if (!saveStarted) pendingProfileSelectionAfterSaveId = '';
        return;
      }
      if (decision === 'cancel') {
        return;
      }
    }

    selectProfile(nextId, options);
  }

  async function saveCurrentConnection() {
    if (!validateConnectionForm('save')) return false;

    const savedProfile = selectedProfileId ? profiles.find(item => item.id === selectedProfileId) : null;
    const isExistingProfile = Boolean(savedProfile);

    if (isExistingProfile && !isSelectedSavedConnectionDirty()) {
      return false;
    }

    if (isExistingProfile) {
      profileName.value = String(profileName.value || savedProfile.name || '').trim();
      pendingConnectionNameGroupId = String(savedProfile.groupId || '').trim();
      pendingConnectionNameNewGroupName = '';
    } else {
      const connectionNameResult = await showConnectionNameDialog(profileName.value || '', '');
      if (!connectionNameResult) return false;

      profileName.value = connectionNameResult.name;
      pendingConnectionNameGroupId = connectionNameResult.groupId || '';
      pendingConnectionNameNewGroupName = connectionNameResult.newGroupName || '';
    }

    const nameError = getConnectionNameError(profileName.value, isExistingProfile ? selectedProfileId : '');
    if (nameError) {
      setStatus(nameError, true);
      return false;
    }

    const statusConnectionId = activeConnectionId || FILES_STATUS_GLOBAL_KEY;
    const connectionPayload = collectConnectionPayload();
    if (!isExistingProfile) {
      delete connectionPayload.id;
      connectionPayload.groupId = pendingConnectionNameGroupId;
    }
    if (pendingConnectionNameNewGroupName) {
      connectionPayload.newGroupName = pendingConnectionNameNewGroupName;
    }
    saveProfileButtonFeedbackProfileId = isExistingProfile ? selectedProfileId : '';
    setBusy(true, 'Saving connection...', '', 'Cancel', statusConnectionId);
    vscode.postMessage({
      type: 'saveConnection',
      payload: {
        ...connectionPayload,
        statusConnectionId
      }
    });
    return true;
  }

  function validateConnectionForm(action) {
    clearConnectionValidationErrors();

    const errors = getConnectionValidationErrors(action);
    if (!errors.length) return true;

    for (const error of errors) {
      setConnectionFieldInvalid(error.field, true);
    }

    const firstError = errors[0];
    setStatus(formatConnectionValidationSummary(errors), true);

    if (firstError.field && typeof firstError.field.focus === 'function') {
      firstError.field.focus();
      if (typeof firstError.field.select === 'function') {
        try { firstError.field.select(); } catch (error) { /* ignore */ }
      }
      if (typeof firstError.field.scrollIntoView === 'function') {
        try { firstError.field.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (error) { /* ignore */ }
      }
    }

    return false;
  }

  function collectConnectionPayload() {
    return {
      id: selectedProfileId || undefined,
      name: profileName.value,
      host: host.value,
      connectionType: normalizeConnectionTypeValue(connectionType.value),
      port: port.value,
      username: username.value,
      authType: authType.value,
      password: password.value === SAVED_SECRET_MASK ? '' : password.value,
      rememberPassword: rememberPassword.checked,
      privateKeyPath: privateKeyPath.value,
      passphrase: passphrase.value === SAVED_SECRET_MASK ? '' : passphrase.value,
      rememberPassphrase: rememberPassphrase.checked,
      startPath: startPath.value,
      keepAlive: keepAlive.checked,
      groupId: selectedProfileId
        ? ((profiles.find(item => item.id === selectedProfileId) || {}).groupId || '')
        : (pendingConnectionNameGroupId || ''),
      ftpsAllowSelfSignedCertificate: Boolean(ftpsAllowSelfSignedCertificate.checked),
      ftpsCaCertificatePath: ftpsCaCertificatePath.value
    };
  }

  function updateAuthFields() {
    const isSftp = isSftpFormConnection();
    if (!isSftp) {
      authType.value = 'password';
      hideAuthDropdown();
    }
    if (authMethodBlock) {
      authMethodBlock.classList.toggle('hidden', !isSftp);
    }
    const isPrivateKey = isSftp && authType.value === 'privateKey';
    hideTemporaryPassword(password);
    hideTemporaryPassword(passphrase);
    updateConnectionCredentialRevealControls();
    passwordBlock.classList.toggle('visible', !isPrivateKey);
    privateKeyBlock.classList.toggle('visible', isPrivateKey);
    passphraseBlock.classList.toggle('visible', isPrivateKey);
    updateConnectionTypeDropdown();
    updateAuthDropdown();
    updateFtpsCertificateFields();
  }


  function normalizeSearchScopePath(path) {
    const trimmed = String(path || '/').trim() || '/';
    return trimmed.startsWith('/') ? trimmed.replace(new RegExp('/+', 'g'), '/') : '/' + trimmed.replace(new RegExp('/+', 'g'), '/');
  }

  function getActiveConnectionType() {
    const session = getActiveSession();
    return String((session && session.connectionType) || 'sftp').toLowerCase();
  }

  function createEmptyRemoteSearchState(connectionId, connectionType) {
    return {
      status: 'idle',
      connectionId: connectionId || '',
      connectionType: connectionType || getActiveConnectionType(),
      results: [],
      totalResults: 0,
      options: {
        connectionId: connectionId || '',
        connectionType: connectionType || getActiveConnectionType(),
        scopePath: currentPath.value || '/',
        includeSubdirectories: true,
        includeHiddenFiles: false,
        caseSensitive: false,
        fileName: '*',
        searchInsideFiles: false,
        textToFind: '',
        useSudo: false
      }
    };
  }

  function getRemoteSearchStateForActiveConnection() {
    if (!activeConnectionId) return createEmptyRemoteSearchState('', 'sftp');
    return remoteSearchStatesByConnectionId.get(activeConnectionId) || createEmptyRemoteSearchState(activeConnectionId, getActiveConnectionType());
  }

  function storeRemoteSearchSnapshot(snapshot) {
    const normalized = snapshot || createEmptyRemoteSearchState(activeConnectionId, getActiveConnectionType());
    const connectionId = normalized.connectionId || activeConnectionId || '';
    normalized.connectionId = connectionId;
    if (!normalized.connectionType) normalized.connectionType = getActiveConnectionType();
    if (!Array.isArray(normalized.results)) normalized.results = [];
    if (!normalized.options) normalized.options = {};
    if (connectionId) remoteSearchStatesByConnectionId.set(connectionId, normalized);
    return normalized;
  }

  function isRemoteSearchSftp() {
    return getActiveConnectionType() === 'sftp';
  }

  function updateRemoteSearchConnectedTo() {
    if (!remoteSearchConnectedTo) return;

    const active = getActiveSession();
    const hostValue = active ? String(active.host || '').trim() : String(host.value || '').trim();
    remoteSearchConnectedTo.textContent = hostValue || '-';
    if (hostValue) remoteSearchConnectedTo.setAttribute('data-tooltip', hostValue); else remoteSearchConnectedTo.removeAttribute('data-tooltip');
  }

  function getRemoteSearchSudoContext(connectionId) {
    const key = connectionId || activeConnectionId;
    const active = (key ? sessions.find(item => item.id === key) : null) || getActiveSession();
    const capabilities = getRemoteCapabilitiesForSession(active);
    const canUseSudo = Boolean(capabilities.canUseSudo);
    const username = active ? String(active.username || '').trim() : '';
    const connectionType = String((active && active.connectionType) || getActiveConnectionType() || 'sftp').toLowerCase();
    const isRootConnection = canUseSudo && username.toLowerCase() === 'root';
    const isSftp = connectionType === 'sftp';
    const connectionSudoEnabled = Boolean(canUseSudo && active && active.sudoModeEnabled && !isRootConnection && isSftp);
    return { active, username, isRootConnection, isSftp, canUseSudo, connectionSudoEnabled };
  }

  function collectRemoteSearchEffectiveUseSudo(connectionId) {
    const context = getRemoteSearchSudoContext(connectionId);
    if (!context.canUseSudo || !context.isSftp || context.isRootConnection) return false;
    if (context.connectionSudoEnabled) return true;
    return Boolean(remoteSearchUseSudo && remoteSearchUseSudo.checked);
  }

  function collectRemoteSearchFormUseSudo(connectionId) {
    const key = String(connectionId || activeConnectionId || '');
    const context = getRemoteSearchSudoContext(key);
    if (!context.canUseSudo || !context.isSftp || context.isRootConnection) return false;
    if (context.connectionSudoEnabled) {
      const saved = key ? remoteSearchFormsByConnectionId.get(key) : null;
      return Boolean(saved && saved.useSudo);
    }
    return Boolean(remoteSearchUseSudo && remoteSearchUseSudo.checked);
  }

  function updateRemoteSearchRunAs() {
    if (!remoteSearchRunAs) return;

    const context = getRemoteSearchSudoContext(activeConnectionId);
    const useSudo = collectRemoteSearchEffectiveUseSudo(activeConnectionId);

    remoteSearchRunAs.textContent = useSudo
      ? 'root via sudo'
      : context.isRootConnection
        ? 'root'
        : (context.username || (context.isSftp ? 'SSH user' : 'FTP user'));
    remoteSearchRunAs.classList.toggle('sudo', useSudo);

    if (remoteSearchUseSudo) {
      remoteSearchUseSudo.checked = useSudo;
      remoteSearchUseSudo.disabled = context.connectionSudoEnabled || remoteSearchState.status === 'running';
    }
    if (remoteSearchSudoNote) {
      remoteSearchSudoNote.textContent = context.connectionSudoEnabled ? 'Enabled by connection Sudo Mode' : '';
    }
  }

  function updateRemoteSearchMeta() {
    updateRemoteSearchConnectedTo();
    updateRemoteSearchRunAs();
  }

  function updateRemoteSearchProtocolFields() {
    const isSftp = isRemoteSearchSftp();
    const canUseSudo = Boolean(getActiveRemoteCapabilities().canUseSudo);
    if (remoteSearchSudoRow) remoteSearchSudoRow.classList.toggle('hidden', !canUseSudo);
    if (remoteSearchInsideRow) remoteSearchInsideRow.classList.toggle('hidden', !isSftp);
    if (!canUseSudo) {
      if (remoteSearchUseSudo) remoteSearchUseSudo.checked = false;
    }
    if (!isSftp) {
      if (remoteSearchInsideFiles) remoteSearchInsideFiles.checked = false;
    }
    updateRemoteSearchTextField();
    updateRemoteSearchMeta();
  }

  function updateRemoteSearchTextField() {
    const visible = isRemoteSearchSftp() && Boolean(remoteSearchInsideFiles.checked);
    if (remoteSearchTextField) remoteSearchTextField.classList.toggle('hidden', !visible);
    if (remoteSearchTextToFind) remoteSearchTextToFind.disabled = !visible || remoteSearchState.status === 'running';
  }

  function setRemoteSearchValidation(message, field) {
    for (const control of [remoteSearchScopePath, remoteSearchFileName, remoteSearchTextToFind]) {
      if (!control) continue;
      control.classList.remove('remote-search-input-invalid');
      control.removeAttribute('aria-invalid');
    }

    const text = String(message || '');
    if (remoteSearchValidation) {
      remoteSearchValidation.textContent = text;
      remoteSearchValidation.style.visibility = text ? 'visible' : 'hidden';
    }

    if (field) {
      field.classList.add('remote-search-input-invalid');
      field.setAttribute('aria-invalid', 'true');
      window.setTimeout(() => field.focus(), 0);
    }
  }

  function clearRemoteSearchValidation(field) {
    if (field) {
      field.classList.remove('remote-search-input-invalid');
      field.removeAttribute('aria-invalid');
    } else {
      for (const control of [remoteSearchScopePath, remoteSearchFileName, remoteSearchTextToFind]) {
        if (!control) continue;
        control.classList.remove('remote-search-input-invalid');
        control.removeAttribute('aria-invalid');
      }
    }
    if (remoteSearchValidation) {
      remoteSearchValidation.textContent = '';
      remoteSearchValidation.style.visibility = 'hidden';
    }
  }

  function getDefaultRemoteSearchFormForConnection(connectionId) {
    const session = sessions.find(item => item.id === connectionId);
    const scopePath = normalizeSearchScopePath((session && session.currentPath) || currentPath.value || '/');
    return {
      scopePath,
      includeSubdirectories: true,
      includeHiddenFiles: false,
      caseSensitive: false,
      fileName: '*',
      searchInsideFiles: false,
      textToFind: '',
      useSudo: false
    };
  }

  function getRemoteSearchFormForConnection(connectionId) {
    const key = String(connectionId || '');
    if (!key) return getDefaultRemoteSearchFormForConnection('');
    const saved = remoteSearchFormsByConnectionId.get(key);
    if (saved) return Object.assign(getDefaultRemoteSearchFormForConnection(key), saved);
    const snapshot = remoteSearchStatesByConnectionId.get(key);
    if (snapshot && snapshot.status !== 'idle' && snapshot.options) {
      return Object.assign(getDefaultRemoteSearchFormForConnection(key), snapshot.options);
    }
    return getDefaultRemoteSearchFormForConnection(key);
  }

  function normalizeRemoteSearchFormForStorage(connectionId, form) {
    const key = String(connectionId || activeConnectionId || '');
    const normalized = Object.assign(getDefaultRemoteSearchFormForConnection(key), form || {});
    const context = getRemoteSearchSudoContext(key);
    if (!context.canUseSudo || !context.isSftp || context.isRootConnection) {
      normalized.useSudo = false;
    } else if (context.connectionSudoEnabled) {
      const existing = key ? remoteSearchFormsByConnectionId.get(key) : null;
      normalized.useSudo = Boolean(existing && existing.useSudo);
    }
    return normalized;
  }

  function applyRemoteSearchForm(form) {
    const options = form || getDefaultRemoteSearchFormForConnection(activeConnectionId);
    if (remoteSearchScopePath) remoteSearchScopePath.value = normalizeSearchScopePath(options.scopePath || currentPath.value || '/');
    if (remoteSearchSubdirectories) remoteSearchSubdirectories.checked = Boolean(options.includeSubdirectories);
    if (remoteSearchHiddenFiles) remoteSearchHiddenFiles.checked = Boolean(options.includeHiddenFiles);
    if (remoteSearchCaseSensitive) remoteSearchCaseSensitive.checked = Boolean(options.caseSensitive);
    if (remoteSearchFileName) remoteSearchFileName.value = String(options.fileName || '*');
    if (remoteSearchUseSudo) remoteSearchUseSudo.checked = Boolean(options.useSudo);
    if (remoteSearchInsideFiles) remoteSearchInsideFiles.checked = Boolean(options.searchInsideFiles);
    if (remoteSearchTextToFind) remoteSearchTextToFind.value = String(options.textToFind || '');
    updateRemoteSearchProtocolFields();
  }

  function applyRemoteSearchFormForActiveConnection() {
    applyRemoteSearchForm(getRemoteSearchFormForConnection(activeConnectionId));
  }

  function saveRemoteSearchFormForConnection(connectionId) {
    const key = String(connectionId || '');
    if (!key) return;
    remoteSearchFormsByConnectionId.set(key, normalizeRemoteSearchFormForStorage(key, collectRemoteSearchPayload()));
  }

  function saveRemoteSearchFormForActiveConnection() {
    saveRemoteSearchFormForConnection(activeConnectionId);
  }

  function showRemoteSearchDialog() {
    if (!activeConnectionId || !getActiveRemoteCapabilities().canRunCommand) return;
    remoteSearchDialogOpen = true;
    remoteSearchState = getRemoteSearchStateForActiveConnection();
    if (remoteSearchState.status !== 'running') {
      const key = String(activeConnectionId || '');
      const currentForm = getRemoteSearchFormForConnection(key);
      remoteSearchFormsByConnectionId.set(key, normalizeRemoteSearchFormForStorage(key, Object.assign({}, currentForm, { scopePath: normalizeSearchScopePath(currentPath.value || '/') })));
    }
    applyRemoteSearchFormForActiveConnection();
    clearRemoteSearchValidation();
    updateRemoteSearchMeta();
    renderRemoteSearchState();
    remoteSearchBackdrop.classList.add('visible');
    remoteSearchBackdrop.setAttribute('aria-hidden', 'false');
    window.setTimeout(() => remoteSearchFileName.focus(), 0);
    vscode.postMessage({ type: 'requestRemoteSearchState' });
  }

  function hideRemoteSearchDialog() {
    saveRemoteSearchFormForActiveConnection();
    remoteSearchDialogOpen = false;
    hideRemoteSearchScopePicker();
    remoteSearchBackdrop.classList.remove('visible');
    remoteSearchBackdrop.setAttribute('aria-hidden', 'true');
  }

  function collectRemoteSearchPayload(options) {
    const useEffectiveSudo = Boolean(options && options.effectiveSudo);
    return {
      scopePath: normalizeSearchScopePath(remoteSearchScopePath.value || currentPath.value || '/'),
      includeSubdirectories: Boolean(remoteSearchSubdirectories.checked),
      includeHiddenFiles: Boolean(remoteSearchHiddenFiles.checked),
      caseSensitive: Boolean(remoteSearchCaseSensitive.checked),
      fileName: String(remoteSearchFileName.value || '*').trim() || '*',
      searchInsideFiles: isRemoteSearchSftp() && Boolean(remoteSearchInsideFiles.checked),
      textToFind: String(remoteSearchTextToFind.value || ''),
      useSudo: useEffectiveSudo ? collectRemoteSearchEffectiveUseSudo(activeConnectionId) : collectRemoteSearchFormUseSudo(activeConnectionId)
    };
  }

  function startOrCancelRemoteSearch() {
    if (remoteSearchState.status === 'running') {
      remoteSearchState = Object.assign({}, remoteSearchState, { status: 'cancelled', finishedAt: Date.now() });
      storeRemoteSearchSnapshot(remoteSearchState);
      renderRemoteSearchState();
      vscode.postMessage({ type: 'cancelRemoteSearch' });
      return;
    }

    const payload = collectRemoteSearchPayload({ effectiveSudo: true });
    if (!String(remoteSearchScopePath.value || '').trim()) {
      setRemoteSearchValidation('Remote path is required.', remoteSearchScopePath);
      return;
    }
    if (payload.searchInsideFiles && !payload.textToFind.trim()) {
      setRemoteSearchValidation('Text to find is required when searching inside files.', remoteSearchTextToFind);
      return;
    }

    clearRemoteSearchValidation();
    saveRemoteSearchFormForActiveConnection();
    remoteSearchExpandedResultPaths.clear();
    remoteSearchSelectedResultKeys.clear();
    remoteSearchSelectionAnchorKey = '';
    vscode.postMessage({ type: 'startRemoteSearch', payload });
  }

  function clearRemoteSearch() {
    if (remoteSearchState.status === 'running') return;
    clearRemoteSearchValidation();
    remoteSearchExpandedResultPaths.clear();
    remoteSearchSelectedResultKeys.clear();
    remoteSearchSelectionAnchorKey = '';
    vscode.postMessage({ type: 'clearRemoteSearch' });
  }

  function browseRemoteSearchScope() {
    if (!activeConnectionId || remoteSearchState.status === 'running') return;
    const path = normalizeSearchScopePath(remoteSearchScopePath.value || currentPath.value || '/');
    showRemoteSearchScopePicker(path);
    requestRemoteSearchScopeEntries(path);
  }

  function showRemoteSearchScopePicker(path) {
    remoteSearchScopePickerOpen = true;
    remoteSearchScopePickerPathValue = normalizeSearchScopePath(path || '/');
    if (remoteSearchScopePicker) {
      remoteSearchScopePicker.classList.remove('hidden');
      remoteSearchScopePicker.setAttribute('aria-hidden', 'false');
    }
    if (remoteSearchScopePickerPath) remoteSearchScopePickerPath.textContent = remoteSearchScopePickerPathValue;
    if (remoteSearchScopePickerList) remoteSearchScopePickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
  }

  function hideRemoteSearchScopePicker() {
    remoteSearchScopePickerOpen = false;
    if (remoteSearchScopePicker) {
      remoteSearchScopePicker.classList.add('hidden');
      remoteSearchScopePicker.setAttribute('aria-hidden', 'true');
    }
  }

  function selectRemoteSearchScopePickerPath() {
    if (remoteSearchState.status === 'running') return;
    remoteSearchScopePath.value = normalizeSearchScopePath(remoteSearchScopePickerPathValue || '/');
    saveRemoteSearchFormForActiveConnection();
    clearRemoteSearchValidation(remoteSearchScopePath);
    hideRemoteSearchScopePicker();
  }

  function requestRemoteSearchScopeEntries(path) {
    if (!activeConnectionId || remoteSearchState.status === 'running') return;
    const scopePath = normalizeSearchScopePath(path || '/');
    remoteSearchScopePickerPathValue = scopePath;
    if (remoteSearchScopePickerPath) remoteSearchScopePickerPath.textContent = scopePath;
    if (remoteSearchScopePickerList) remoteSearchScopePickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
    vscode.postMessage({ type: 'browseRemoteSearchScope', payload: { scopePath } });
  }

  function handleRemoteSearchScopeEntriesListed(payload) {
    if (!remoteSearchScopePickerOpen) return;
    if (payload.connectionId && activeConnectionId && payload.connectionId !== activeConnectionId) return;
    const path = normalizeSearchScopePath(payload.path || '/');
    const parentPath = normalizeSearchScopePath(payload.parentPath || '/');
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    remoteSearchScopePickerPathValue = path;
    if (remoteSearchScopePickerPath) remoteSearchScopePickerPath.textContent = path;
    if (!remoteSearchScopePickerList) return;
    const parentItem = '<button class="remote-search-scope-picker-item" type="button" data-remote-search-scope-path="' + escapeHtml(parentPath) + '"><span>..</span></button>';
    if (payload.error) {
      remoteSearchScopePickerList.innerHTML = parentItem + '<div class="remote-search-scope-picker-empty error">' + escapeHtml(payload.error || 'Unable to list this directory.') + '</div>';
      return;
    }
    const directoryItems = entries.map(entry => {
      const entryPath = normalizeSearchScopePath(entry.path || '/');
      const name = entry.name || entryPath;
      return '<button class="remote-search-scope-picker-item" type="button" data-remote-search-scope-path="' + escapeHtml(entryPath) + '"><span aria-hidden="true">▸</span><span>' + escapeHtml(name) + '</span><span class="remote-search-scope-picker-item-path">' + escapeHtml(entryPath) + '</span></button>';
    }).join('');
    remoteSearchScopePickerList.innerHTML = parentItem + (directoryItems || '<div class="remote-search-scope-picker-empty">No subdirectories.</div>');
  }

  function applyRemoteSearchSnapshot(snapshot) {
    const normalized = storeRemoteSearchSnapshot(snapshot);
    if (normalized.status === 'running' || normalized.status === 'idle') {
      resetRemoteSearchVisibleLimit(normalized.connectionId || activeConnectionId || '');
    }
    if (normalized.connectionId && activeConnectionId && normalized.connectionId !== activeConnectionId) {
      renderRemoteSearchBadge();
      return;
    }

    remoteSearchState = normalized;
    const options = remoteSearchState.options || {};
    if (remoteSearchState.status !== 'idle') {
      remoteSearchFormsByConnectionId.set(remoteSearchState.connectionId || activeConnectionId || '', normalizeRemoteSearchFormForStorage(remoteSearchState.connectionId || activeConnectionId || '', options));
      applyRemoteSearchForm(options);
      clearRemoteSearchValidation();
    } else if (remoteSearchDialogOpen) {
      applyRemoteSearchFormForActiveConnection();
    }
    updateRemoteSearchProtocolFields();
    renderRemoteSearchStateNow();
    setControls();
  }

  function appendRemoteSearchResult(payload) {
    appendRemoteSearchResultsBatch(Object.assign({}, payload, { results: payload && payload.result ? [payload.result] : [] }));
  }

  function appendRemoteSearchResultsBatch(payload) {
    const connectionId = payload.connectionId || activeConnectionId || '';
    const snapshot = remoteSearchStatesByConnectionId.get(connectionId) || createEmptyRemoteSearchState(connectionId, getActiveConnectionType());
    const incomingResults = Array.isArray(payload.results) ? payload.results : [];
    if (!snapshot.results) snapshot.results = [];
    if (snapshot.status === 'cancelled' && payload.status === 'running') {
      return;
    }
    if (payload.searchId && snapshot.id && payload.searchId !== snapshot.id) {
      return;
    }
    snapshot.status = payload.status || snapshot.status || 'running';
    if (incomingResults.length) {
      snapshot.results.push.apply(snapshot.results, incomingResults);
    }
    snapshot.totalResults = payload.totalResults || snapshot.results.length;
    remoteSearchStatesByConnectionId.set(connectionId, snapshot);

    if (!activeConnectionId || connectionId === activeConnectionId) {
      remoteSearchState = snapshot;
      scheduleRemoteSearchRender();
    } else {
      renderRemoteSearchBadge();
    }
  }

  function scheduleRemoteSearchRender() {
    if (remoteSearchRenderTimer) return;
    remoteSearchRenderTimer = setTimeout(() => {
      remoteSearchRenderTimer = 0;
      renderRemoteSearchStateNow();
      setControls();
    }, 100);
  }

  function renderRemoteSearchStateNow() {
    if (remoteSearchRenderTimer) {
      clearTimeout(remoteSearchRenderTimer);
      remoteSearchRenderTimer = 0;
    }
    const statusText = remoteSearchState.status === 'running'
      ? 'Running... ' + (remoteSearchState.totalResults || 0) + ' found'
      : remoteSearchState.status === 'completed'
        ? 'Completed - ' + (remoteSearchState.totalResults || 0) + ' found'
        : remoteSearchState.status === 'cancelled'
          ? 'Cancelled - ' + (remoteSearchState.totalResults || 0) + ' found'
          : remoteSearchState.status === 'failed'
            ? 'Failed - ' + (remoteSearchState.error || 'Search failed.')
            : 'Idle';

    if (remoteSearchResultsStatus) {
      remoteSearchResultsStatus.textContent = statusText;
      remoteSearchResultsStatus.classList.toggle('error', remoteSearchState.status === 'failed');
    }
    if (remoteSearchState.status === 'failed' && remoteSearchState.error) {
      setRemoteSearchValidation(remoteSearchState.error, null);
    } else if (remoteSearchState.status !== 'failed') {
      clearRemoteSearchValidation();
    }

    if (remoteSearchPrimaryButton) remoteSearchPrimaryButton.textContent = remoteSearchState.status === 'running' ? 'Stop' : 'Search';
    if (remoteSearchCopyButton) remoteSearchCopyButton.disabled = !Array.isArray(remoteSearchState.results) || remoteSearchState.results.length === 0;
    if (remoteSearchClearButton) remoteSearchClearButton.disabled = remoteSearchState.status === 'running';

    const running = remoteSearchState.status === 'running';
    if (running) hideRemoteSearchScopePicker();
    for (const control of [remoteSearchScopePath, remoteSearchBrowseButton, remoteSearchSubdirectories, remoteSearchHiddenFiles, remoteSearchCaseSensitive, remoteSearchUseSudo, remoteSearchInsideFiles, remoteSearchFileName]) {
      if (control) control.disabled = running;
    }
    updateRemoteSearchTextField();
    updateRemoteSearchMeta();
    renderRemoteSearchBadge();
    renderRemoteSearchResults();
  }

  function renderRemoteSearchState() {
    renderRemoteSearchStateNow();
  }

  function getRemoteSearchVisibleLimit(connectionId) {
    const key = connectionId || activeConnectionId || '';
    return remoteSearchVisibleLimitsByConnectionId.get(key) || REMOTE_SEARCH_INITIAL_VISIBLE_RESULTS;
  }

  function resetRemoteSearchVisibleLimit(connectionId) {
    const key = connectionId || activeConnectionId || '';
    if (key) remoteSearchVisibleLimitsByConnectionId.set(key, REMOTE_SEARCH_INITIAL_VISIBLE_RESULTS);
  }

  function showMoreRemoteSearchResults() {
    const key = remoteSearchState.connectionId || activeConnectionId || '';
    const current = getRemoteSearchVisibleLimit(key);
    remoteSearchVisibleLimitsByConnectionId.set(key, current + REMOTE_SEARCH_SHOW_MORE_STEP);
    renderRemoteSearchResults();
  }

  function renderRemoteSearchBadge() {
    if (!remoteSearchBadge) return;
    const activeState = getRemoteSearchStateForActiveConnection();
    const status = activeState.status;
    if (status === 'running') {
      remoteSearchBadge.textContent = '●';
      remoteSearchBadge.style.display = 'block';
    } else if (status === 'completed') {
      remoteSearchBadge.textContent = String(Math.min(99, activeState.totalResults || 0));
      remoteSearchBadge.style.display = 'block';
    } else if (status === 'failed') {
      remoteSearchBadge.textContent = '!';
      remoteSearchBadge.style.display = 'block';
    } else {
      remoteSearchBadge.style.display = 'none';
    }
  }

  function findRemoteSearchTextMatches(text, needle, caseSensitive) {
    const source = String(text || '');
    const query = String(needle || '');
    if (!query) return [];
    const haystack = caseSensitive ? source : source.toLowerCase();
    const target = caseSensitive ? query : query.toLowerCase();
    const matches = [];
    let index = 0;
    while (index <= haystack.length) {
      const found = haystack.indexOf(target, index);
      if (found < 0) break;
      matches.push({ start: found, end: found + target.length });
      index = Math.max(found + target.length, found + 1);
      if (matches.length >= 50) break;
    }
    return matches;
  }

  function buildRemoteSearchSnippetRanges(text, matches) {
    const source = String(text || '');
    const maxFullLength = 220;
    const before = 70;
    const after = 90;
    const maxRanges = 3;
    if (source.length <= maxFullLength || !matches.length) {
      return [{ start: 0, end: Math.min(source.length, maxFullLength), leading: false, trailing: source.length > maxFullLength }];
    }

    const ranges = [];
    for (const match of matches.slice(0, maxRanges)) {
      const start = Math.max(0, match.start - before);
      const end = Math.min(source.length, match.end + after);
      const previous = ranges[ranges.length - 1];
      if (previous && start <= previous.end + 12) {
        previous.end = Math.max(previous.end, end);
      } else {
        ranges.push({ start, end, leading: start > 0, trailing: false });
      }
    }
    ranges.forEach((range, index) => {
      range.leading = range.start > 0;
      range.trailing = range.end < source.length || index < ranges.length - 1;
    });
    return ranges;
  }

  function renderRemoteSearchMatchSnippet(text, query, caseSensitive) {
    const source = String(text || '');
    const matches = findRemoteSearchTextMatches(source, query, caseSensitive);
    const ranges = buildRemoteSearchSnippetRanges(source, matches);
    if (!matches.length) {
      const plain = source.length > 220 ? source.slice(0, 220) + '…' : source;
      return escapeHtml(plain);
    }

    let html = '';
    for (const range of ranges) {
      if (range.leading) html += '<span class="remote-search-ellipsis">…</span>';
      let cursor = range.start;
      for (const match of matches) {
        if (match.end <= range.start || match.start >= range.end) continue;
        const highlightStart = Math.max(match.start, range.start);
        const highlightEnd = Math.min(match.end, range.end);
        if (highlightStart > cursor) {
          html += escapeHtml(source.slice(cursor, highlightStart));
        }
        html += '<span class="remote-search-hit">' + escapeHtml(source.slice(highlightStart, highlightEnd)) + '</span>';
        cursor = highlightEnd;
      }
      if (cursor < range.end) {
        html += escapeHtml(source.slice(cursor, range.end));
      }
      if (range.trailing) html += '<span class="remote-search-ellipsis">…</span>';
    }
    return html;
  }

  function getRemoteSearchSelectedRows() {
    const rows = getRemoteSearchResultRows();
    if (!remoteSearchSelectedResultKeys.size) return [];
    return rows.filter(row => remoteSearchSelectedResultKeys.has(row.key));
  }

  function getRemoteSearchSelectedOrContextPaths() {
    const selectedRows = getRemoteSearchSelectedRows();
    const rawPaths = selectedRows.length
      ? selectedRows.map(row => row.path)
      : [remoteSearchContextPath];
    const paths = [];
    const seen = new Set();
    for (const rawPath of rawPaths) {
      const path = normalizeUiRemotePath(rawPath || '');
      if (!path || seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
    return paths;
  }

  function formatRemoteSearchSelectedPathsForCopy(mode) {
    const paths = getRemoteSearchSelectedOrContextPaths();
    if (!paths.length) return '';
    return paths.map(path => mode === 'name' ? getRemotePathBasename(path) : path).join('\\n');
  }

  function formatRemoteSearchResultsForCopy() {
    const results = Array.isArray(remoteSearchState.results) ? remoteSearchState.results : [];
    if (!results.length) return '';

    const contentSearch = results.some(result => result && typeof result.line !== 'undefined');
    if (!contentSearch) {
      return results.map(result => String(result.path || '').trim()).filter(Boolean).join('\\n');
    }

    const grouped = new Map();
    for (const result of results) {
      const path = result.path || '';
      if (!grouped.has(path)) grouped.set(path, []);
      grouped.get(path).push(result);
    }

    return Array.from(grouped.entries()).map(([path, matches]) => {
      const matchLabel = matches.length === 1 ? '1 match' : matches.length + ' matches';
      const lines = matches.map(match => '  ' + String(match.line || '') + ': ' + String(match.text || '')).join('\\n');
      return path + ' (' + matchLabel + ')' + (lines ? '\\n' + lines : '');
    }).join('\\n\\n');
  }

  function copyRemoteSearchResults() {
    const text = formatRemoteSearchResultsForCopy();
    if (!text) return;
    vscode.postMessage({ type: 'copyStatus', payload: { text, message: 'Copied search results' } });
  }

  function getRemoteSearchRenderableResults() {
    const results = Array.isArray(remoteSearchState.results) ? remoteSearchState.results : [];
    const visibleLimit = getRemoteSearchVisibleLimit(remoteSearchState.connectionId || activeConnectionId || '');
    return results.length > visibleLimit ? results.slice(0, visibleLimit) : results;
  }

  function renderRemoteSearchShowMore(totalResults, renderedResults) {
    if (totalResults <= renderedResults) return '';
    return '<div class="remote-search-show-more"><span>Showing ' + escapeHtml(String(renderedResults)) + ' of ' + escapeHtml(String(totalResults)) + ' results. Copy Results includes all results.</span><button class="secondary" type="button" data-remote-search-show-more="true">Show more</button></div>';
  }

  function getRemoteSearchResultRows() {
    const rows = [];
    const results = getRemoteSearchRenderableResults();
    const contentSearch = results.some(result => result && typeof result.line !== 'undefined');

    if (!contentSearch) {
      results.forEach((result, index) => {
        const path = result && result.path ? String(result.path) : '';
        if (!path) return;
        rows.push({
          key: 'file:' + path + ':' + index,
          path,
          kind: result && result.type === 'directory' ? 'directory' : 'file'
        });
      });
      return rows;
    }

    const grouped = new Map();
    for (const result of results) {
      const path = result && result.path ? String(result.path) : '';
      if (!path) continue;
      if (!grouped.has(path)) grouped.set(path, []);
      grouped.get(path).push(result);
    }

    for (const [path, matches] of grouped.entries()) {
      rows.push({ key: 'group:' + path, path, kind: 'file' });
      if (remoteSearchExpandedResultPaths.has(path)) {
        matches.forEach((match, index) => rows.push({
          key: 'match:' + path + ':' + String(match.line || '') + ':' + index,
          path,
          kind: 'file'
        }));
      }
    }

    return rows;
  }

  function getVisibleRemoteSearchResultKeys() {
    return getRemoteSearchResultRows().map(row => row.key);
  }

  function syncRemoteSearchSelectedRows() {
    if (!remoteSearchResults) return;
    for (const row of remoteSearchResults.querySelectorAll('.remote-search-result-row[data-remote-search-result-key]')) {
      row.classList.toggle('selected', remoteSearchSelectedResultKeys.has(row.getAttribute('data-remote-search-result-key') || ''));
    }
  }

  function normalizeRemoteSearchSelection() {
    const visibleKeys = new Set(getVisibleRemoteSearchResultKeys());
    remoteSearchSelectedResultKeys = new Set(Array.from(remoteSearchSelectedResultKeys).filter(key => visibleKeys.has(key)));
    if (remoteSearchSelectionAnchorKey && !visibleKeys.has(remoteSearchSelectionAnchorKey)) {
      remoteSearchSelectionAnchorKey = Array.from(remoteSearchSelectedResultKeys).pop() || '';
    }
  }

  function selectRemoteSearchResult(key) {
    remoteSearchSelectedResultKeys = new Set([key]);
    remoteSearchSelectionAnchorKey = key;
    syncRemoteSearchSelectedRows();
  }

  function toggleRemoteSearchResultSelection(key) {
    if (remoteSearchSelectedResultKeys.has(key)) {
      remoteSearchSelectedResultKeys.delete(key);
    } else {
      remoteSearchSelectedResultKeys.add(key);
      remoteSearchSelectionAnchorKey = key;
    }
    if (!remoteSearchSelectedResultKeys.size) remoteSearchSelectionAnchorKey = '';
    syncRemoteSearchSelectedRows();
  }

  function selectRemoteSearchResultRange(anchorKey, targetKey) {
    const visibleKeys = getVisibleRemoteSearchResultKeys();
    const anchorIndex = visibleKeys.indexOf(anchorKey);
    const targetIndex = visibleKeys.indexOf(targetKey);
    if (anchorIndex === -1 || targetIndex === -1) {
      selectRemoteSearchResult(targetKey);
      return;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    remoteSearchSelectedResultKeys = new Set(visibleKeys.slice(start, end + 1));
    remoteSearchSelectionAnchorKey = targetKey;
    syncRemoteSearchSelectedRows();
  }

  function renderRemoteSearchResults() {
    if (!remoteSearchResults) return;
    const allResults = Array.isArray(remoteSearchState.results) ? remoteSearchState.results : [];
    const results = getRemoteSearchRenderableResults();
    const showMoreHtml = renderRemoteSearchShowMore(allResults.length, results.length);
    if (!allResults.length) {
      remoteSearchSelectedResultKeys.clear();
      remoteSearchSelectionAnchorKey = '';
      remoteSearchResults.innerHTML = '<div class="remote-search-empty">' + escapeHtml(remoteSearchState.status === 'running' ? 'Searching...' : 'No results.') + '</div>';
      return;
    }

    const contentSearch = results.some(result => result && typeof result.line !== 'undefined');
    if (!contentSearch) {
      remoteSearchResults.innerHTML = results.map((result, index) => {
        const path = result.path || '';
        const kind = result.type === 'directory' ? 'directory' : 'file';
        const key = 'file:' + path + ':' + index;
        const selected = remoteSearchSelectedResultKeys.has(key) ? ' selected' : '';
        return '<div class="remote-search-result-row remote-search-file-result' + selected + '" data-remote-search-result-key="' + escapeHtml(key) + '" data-remote-search-result-path="' + escapeHtml(path) + '" data-remote-search-result-kind="' + escapeHtml(kind) + '">' + escapeHtml(path) + '</div>';
      }).join('') + showMoreHtml;
      normalizeRemoteSearchSelection();
      syncRemoteSearchSelectedRows();
      return;
    }

    const grouped = new Map();
    for (const result of results) {
      const path = result.path || '';
      if (!grouped.has(path)) grouped.set(path, []);
      grouped.get(path).push(result);
    }

    const options = remoteSearchState.options || {};
    const query = String(options.textToFind || '');
    const caseSensitive = Boolean(options.caseSensitive);
    remoteSearchResults.innerHTML = Array.from(grouped.entries()).map(([path, matches]) => {
      const expanded = remoteSearchExpandedResultPaths.has(path);
      const matchLabel = matches.length === 1 ? '1 match' : matches.length + ' matches';
      const groupKey = 'group:' + path;
      const groupSelected = remoteSearchSelectedResultKeys.has(groupKey) ? ' selected' : '';
      const lines = expanded
        ? matches.map((match, index) => {
          const matchKey = 'match:' + path + ':' + String(match.line || '') + ':' + index;
          const matchSelected = remoteSearchSelectedResultKeys.has(matchKey) ? ' selected' : '';
          return '<div class="remote-search-result-row remote-search-match' + matchSelected + '" data-remote-search-result-key="' + escapeHtml(matchKey) + '" data-remote-search-result-path="' + escapeHtml(path) + '" data-remote-search-result-kind="file"><span class="remote-search-line-number">' + escapeHtml(String(match.line || '')) + '</span><span class="remote-search-line-text">' + renderRemoteSearchMatchSnippet(match.text || '', query, caseSensitive) + '</span></div>';
        }).join('')
        : '';
      return '<div class="remote-search-result-group"><div class="remote-search-result-row remote-search-result-path' + groupSelected + '" data-remote-search-result-key="' + escapeHtml(groupKey) + '" data-remote-search-result-path="' + escapeHtml(path) + '" data-remote-search-result-kind="file">' + (expanded ? '▾ ' : '▸ ') + escapeHtml(path) + ' <span class="remote-search-match-count">(' + matchLabel + ')</span></div>' + lines + '</div>';
    }).join('') + showMoreHtml;
    normalizeRemoteSearchSelection();
    syncRemoteSearchSelectedRows();
  }



  function handleDirectoryMetadataUpdated(payload) {
    if (!payload || payload.connectionId !== activeConnectionId) return;
`;
}
