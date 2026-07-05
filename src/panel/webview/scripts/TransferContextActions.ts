export function renderTransferContextActions(): string {
  return `  function handleTransferQueueActionPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const button = event.target && event.target.closest ? event.target.closest('[data-transfer-action]') : null;
    if (!button || button.disabled) return;
    const action = button.dataset.transferAction || '';
    const transferId = button.dataset.transferId || '';
    if (!action || !transferId) return;
    event.preventDefault();
    event.stopPropagation();

    if (action === 'cancel-current') {
      requestTransferCancel(transferId);
      return;
    }

    if (action === 'remove-pending') {
      requestQueuedTransferRemoval(transferId);
    }
  }

  function requestTransferCancel(transferId) {
    if (!transferId || transferQueueCancelingIds.has(transferId)) return;
    transferQueueCancelingIds.add(transferId);
    renderTransferQueueModal();
    vscode.postMessage({ type: 'cancelTransfer', payload: { transferId } });
  }

  function requestQueuedTransferRemoval(transferId) {
    if (!transferId || transferQueueRemovingIds.has(transferId)) return;
    transferQueueRemovingIds.add(transferId);
    renderTransferQueueModal();
    vscode.postMessage({ type: 'removeQueuedTransfer', payload: { transferId } });
  }

  statusCancelButton.addEventListener('click', () => {
    if (!statusCancelAction) return;
    const action = statusCancelAction;
    statusCancelButton.disabled = true;
    if (action === 'connection') {
      vscode.postMessage({ type: 'cancelConnection', payload: { connectionId: activeConnectionId } });
      return;
    }
    if (action === 'transfer') {
      vscode.postMessage({ type: 'cancelTransfer' });
    }
  });

  statusOutputLink.addEventListener('click', () => {
    vscode.postMessage({ type: 'showOutput' });
  });

  statusCopyButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyStatus', payload: { text: getStatusCopyText() } });
  });
  goButton.addEventListener('mousedown', event => event.preventDefault());
  goButton.addEventListener('click', runRemotePathAction);
  remotePathBackButton.addEventListener('mousedown', event => event.preventDefault());
  remotePathBackButton.addEventListener('click', () => navigateRemotePathHistory('back'));
  remotePathForwardButton.addEventListener('mousedown', event => event.preventDefault());
  remotePathForwardButton.addEventListener('click', () => navigateRemotePathHistory('forward'));
  togglePathFavoriteButton.addEventListener('click', () => {
    if (togglePathFavoriteButton.disabled) return;
    const path = normalizeUiRemotePath(currentPath.value || '/');
    vscode.postMessage({
      type: isCurrentPathFavorite() ? 'removeRemotePathFavorite' : 'addRemotePathFavorite',
      payload: { connectionId: activeConnectionId, path }
    });
  });
  pathFavoritesButton.addEventListener('click', event => {
    event.stopPropagation();
    if (pathFavoritesButton.disabled) return;
    if (pathFavoritesOpen) {
      hidePathFavoritesPopover();
    } else {
      showPathFavoritesPopover();
    }
  });
  pathFavoritesList.addEventListener('click', event => {
    const target = event.target && event.target.closest ? event.target.closest('[data-favorite-path]') : null;
    if (!target) return;

    const path = target.dataset.favoritePath || '';
    if (!path) return;

    if (target.dataset.favoriteAction === 'remove') {
      vscode.postMessage({ type: 'removeRemotePathFavorite', payload: { connectionId: activeConnectionId, path } });
      return;
    }

    hidePathFavoritesPopover();
    openPath(path);
  });
  remotePathBox.addEventListener('click', event => {
    if (!activeConnectionId || busy || currentPath.disabled) return;
    if (event.target && event.target.closest && event.target.closest('.remote-path-navigation-buttons, .remote-path-favorite-buttons, .remote-path-favorites-popover, .remote-path-dropdown, [data-breadcrumb-path], [data-breadcrumb-toggle]')) return;
    if (!remotePathEditing) enterRemotePathEditMode({ select: true });
  });

  remotePathBreadcrumb.addEventListener('click', event => {
    const toggle = event.target && event.target.closest ? event.target.closest('[data-breadcrumb-toggle]') : null;
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      openRemotePathDropdown(toggle.dataset.breadcrumbToggle || '/', toggle);
      return;
    }

    const target = event.target && event.target.closest ? event.target.closest('[data-breadcrumb-path]') : null;
    if (!target) {
      enterRemotePathEditMode({ select: true });
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (busy) return;

    const path = target.dataset.breadcrumbPath || '/';
    if (path === normalizeUiRemotePath(currentPath.value || '/')) return;
    listDirectory(path);
  });

  remotePathDropdown.addEventListener('click', event => {
    const target = event.target && event.target.closest ? event.target.closest('[data-dropdown-directory-path]') : null;
    if (!target) return;

    event.preventDefault();
    event.stopPropagation();
    const path = target.dataset.dropdownDirectoryPath || '';
    if (!path || busy) return;

    hideRemotePathDropdown();
    listDirectory(path);
  });

  document.addEventListener('click', event => {
    if (profileDropdownOpen && event.target && event.target.closest && !event.target.closest('.profile-picker')) {
      hideProfileDropdown();
    }
    if (connectionTypeDropdownOpen && event.target && event.target.closest && !event.target.closest('.connection-type-picker')) {
      hideConnectionTypeDropdown();
    }
    if (authDropdownOpen && event.target && event.target.closest && !event.target.closest('.auth-picker')) {
      hideAuthDropdown();
    }
    if (connectionNameGroupDropdownOpen && event.target && event.target.closest && !event.target.closest('.connection-name-group-picker, .connection-name-group-dropdown-menu')) {
      hideConnectionNameGroupDropdown();
    }
    if (serverAutoRefreshDropdownOpen && event.target && event.target.closest && !event.target.closest('#serverAutoRefreshPicker')) {
      hideServerAutoRefreshDropdown();
    }
    if (!breadcrumbDropdownState.open) return;
    if (event.target && event.target.closest && event.target.closest('#remotePathBox')) return;
    hideRemotePathDropdown();
  });

  remotePathLeadingIcon?.addEventListener('mousedown', event => {
    event.preventDefault();
    if (!currentPath.disabled) currentPath.focus();
  });

  currentPath.addEventListener('focus', () => {
    if (!currentPath.disabled && !remotePathEditing) enterRemotePathEditMode({ select: false });
  });

  currentPath.addEventListener('blur', () => {
    if (remotePathEditing) exitRemotePathEditMode({ reset: true });
  });

  currentPath.addEventListener('input', () => {
    updateRemotePathActionButton();
    updatePathFavoriteControls();
    updateRemotePathBreadcrumb();
  });
  connectionType.addEventListener('change', () => {
    clearConnectionValidationErrors();
    selectConnectionType(connectionType.value);
  });

  connectionTypeDropdownButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleConnectionTypeDropdown();
  });

  connectionTypeDropdownMenu.addEventListener('click', event => {
    const item = event.target && event.target.closest ? event.target.closest('[data-connection-type]') : null;
    if (!item || connectionTypeDropdownButton.disabled) return;
    selectConnectionType(item.dataset.connectionType || 'sftp');
    hideConnectionTypeDropdown();
  });

  authType.addEventListener('change', () => {
    clearConnectionValidationErrors();
    updateAuthFields();
    updateAuthDropdown();
    setControls();
  });

  authDropdownButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleAuthDropdown();
  });

  authDropdownMenu.addEventListener('click', event => {
    const item = event.target && event.target.closest ? event.target.closest('[data-auth-type]') : null;
    if (!item || authDropdownButton.disabled) return;
    selectAuthType(item.dataset.authType || 'password');
    hideAuthDropdown();
  });

  if (connectionNameGroupDropdownButton) {
    connectionNameGroupDropdownButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggleConnectionNameGroupDropdown();
    });
  }

  if (connectionNameGroupDropdownMenu) {
    connectionNameGroupDropdownMenu.addEventListener('click', event => {
      const item = event.target && event.target.closest ? event.target.closest('[data-connection-name-group-option]') : null;
      if (!item) return;
      selectConnectionNameGroupOption(item.dataset.connectionNameGroupOption || '');
    });
  }

  if (connectionNameGroupNewInput) {
    connectionNameGroupNewInput.addEventListener('input', () => {
      connectionNameGroupNewInput.classList.remove('connection-input-invalid');
      validateConnectionNameInput(false);
    });
    connectionNameGroupNewInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        confirmConnectionNameDialog();
      }
      if (event.key === 'Escape') {
        handleConnectionNameDialogEscape(event);
      }
    });
  }

  privateKeyBrowseButton.addEventListener('click', () => vscode.postMessage({ type: 'pickPrivateKeyPath' }));
  ftpsCaCertificateBrowseButton.addEventListener('click', () => vscode.postMessage({ type: 'pickCaCertificatePath' }));
  ftpsAllowSelfSignedCertificate.addEventListener('change', () => { clearConnectionValidationErrors(); updateFtpsCertificateFields(); setControls(); });
  password.addEventListener('input', () => { updateConnectionCredentialRevealControls(); setControls(); });
  passphrase.addEventListener('input', () => { updateConnectionCredentialRevealControls(); setControls(); });
  rememberPassword.addEventListener('change', () => { if (!rememberPassword.checked) { password.placeholder = ''; if (password.value === SAVED_SECRET_MASK) password.value = ''; } updateConnectionCredentialRevealControls(); setControls(); });
  rememberPassphrase.addEventListener('change', () => { if (!rememberPassphrase.checked) { passphrase.placeholder = ''; if (passphrase.value === SAVED_SECRET_MASK) passphrase.value = ''; } updateConnectionCredentialRevealControls(); setControls(); });

  currentPath.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const path = currentPath.value;
      exitRemotePathEditMode({ reset: true });
      openPath(path);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      exitRemotePathEditMode({ reset: true });
    }
  });
  document.addEventListener('keydown', event => {
    const keyboardOverviewCard = event.target && event.target.closest ? event.target.closest('.server-overview-card[data-server-overview-index]') : null;
    if (keyboardOverviewCard && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopPropagation();
      showServerOverviewDetailsDialog(Number(keyboardOverviewCard.getAttribute('data-server-overview-index')));
      return;
    }

    if (event.key === 'Escape' && transferConflictDialogOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeTransferConflictDialog('cancel');
      return;
    }
    if (transferConflictDialogOpen) {
      trapTransferConflictFocus(event);
      return;
    }
    if (event.key === 'Escape' && inputPromptOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeInputPromptDialog(false);
      return;
    }
    if (inputPromptOpen) {
      trapInputPromptFocus(event);
      return;
    }
    if (event.key === 'Escape' && confirmDialogOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeConfirmDialog(String(confirmDialogRequestId || '').indexOf('client:profileDirtySwitch:') === 0 ? null : false);
      return;
    }
    if (confirmDialogOpen) {
      trapConfirmDialogFocus(event);
      return;
    }
    if (event.key === 'Escape' && profileDropdownOpen) {
      hideProfileDropdown();
      return;
    }
    if (event.key === 'Escape' && connectionTypeDropdownOpen) {
      hideConnectionTypeDropdown();
      return;
    }
    if (event.key === 'Escape' && authDropdownOpen) {
      hideAuthDropdown();
      return;
    }
    if (event.key === 'Escape' && connectionNameDialogOpen) {
      handleConnectionNameDialogEscape(event);
      return;
    }
    if (event.key === 'Escape' && connectionNameGroupDropdownOpen) {
      event.preventDefault();
      event.stopPropagation();
      hideConnectionNameGroupDropdown();
      return;
    }
    if (event.key === 'Escape' && serverAutoRefreshDropdownOpen) {
      hideServerAutoRefreshDropdown();
      return;
    }
    if (event.key === 'Escape' && exportBackupDialogOpen) {
      event.preventDefault();
      event.stopPropagation();
      hideExportBackupDialog();
      return;
    }
    if (event.key === 'Escape' && importBackupDialogOpen) {
      event.preventDefault();
      event.stopPropagation();
      hideImportBackupDialog();
      return;
    }
    if (event.key === 'Escape' && manageGroupRemoveDialogOpen) {
      event.preventDefault();
      event.stopPropagation();
      hideManageGroupRemoveDialog();
      return;
    }
    if (manageGroupRemoveDialogOpen) {
      trapManageGroupRemoveDialogFocus(event);
      return;
    }
    if (event.key === 'Escape' && manageGroupDialogOpen) {
      event.preventDefault();
      event.stopPropagation();
      hideManageGroupDialog();
      return;
    }
    if (manageGroupDialogOpen) {
      trapManageGroupDialogFocus(event);
      return;
    }
    if (event.key === 'Escape' && manageProfilesDialogOpen) {
      event.preventDefault();
      event.stopPropagation();
      if (manageProfilesFilterInput && document.activeElement === manageProfilesFilterInput && manageProfilesFilterInput.value) {
        clearManageProfilesFilter();
        return;
      }
      if (renameProfileId) {
        renameProfileId = '';
        renderManageProfilesList();
        return;
      }
      if (renameGroupId) {
        renameGroupId = '';
        renderManageProfilesList();
        return;
      }
      hideManageProfilesDialog();
      return;
    }
    if (event.key === 'Escape' && checksumsDialogOpen) {
      hideChecksumsDialog();
      return;
    }
    if (event.key === 'Escape' && ownerGroupDialogOpen) {
      if (isOwnerGroupSuggestionsOpen()) {
        event.preventDefault();
        event.stopPropagation();
        hideOwnerGroupSuggestions();
        return;
      }
      hideOwnerGroupDialog();
      return;
    }
    if (event.key === 'Escape' && serverOverviewDetailsDialogOpen) {
      hideServerOverviewDetailsDialog();
      return;
    }
    if (event.key === 'Escape' && filePropertiesDialogOpen) {
      hideFilePropertiesDialog();
      return;
    }
    if (event.key === 'Escape' && remoteCommandWorkingDirectoryPickerOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      hideRemoteCommandWorkingDirectoryPicker();
      return;
    }
    if (event.key === 'Escape' && remoteCommandDialogOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      attemptCloseRemoteCommandDialog();
      return;
    }
    if (event.key === 'Escape' && remoteSearchScopePickerOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      hideRemoteSearchScopePicker();
      return;
    }
    if (event.key === 'Escape' && remoteSearchDialogOpen) {
      event.preventDefault();
      event.stopPropagation();
      hideRemoteSearchDialog();
      return;
    }
    if (event.key === 'Escape' && transferQueueModalOpen) {
      hideTransferQueueModal();
    }
  });
  filterInput.addEventListener('input', () => {
    scheduleFilterInputApply();
  });

  filterInput.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || filterInput.disabled || !filterInput.value) return;
    event.preventDefault();
    event.stopPropagation();
    filterInput.value = '';
    applyFilterInput();
  });

  clearFilterButton.addEventListener('click', () => {
    if (filterInput.disabled) return;
    filterInput.value = '';
    applyFilterInput();
    filterInput.focus();
  });

  contextOpen.addEventListener('click', () => {
    const entries = getSelectedActionEntries();
    hideContextMenu();
    if (entries.length) vscode.postMessage({ type: 'openEntries', payload: { entries: entries.map(actionPayload) } });
  });

  contextOpenReadOnly.addEventListener('click', () => {
    const entries = getSelectedActionEntries();
    hideContextMenu();
    if (entries.length) vscode.postMessage({ type: 'openEntriesReadOnly', payload: { entries: entries.map(actionPayload) } });
  });

  contextCompare.addEventListener('click', () => {
    const entries = getSelectedActionEntries();
    hideContextMenu();
    if (entries.length === 2) vscode.postMessage({ type: 'compareSelectedEntries', payload: { entries: entries.map(actionPayload) } });
  });

  contextCreateFile.addEventListener('click', () => {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestCreateFile', payload: { path: getContextWorkingDirectory() } });
  });

  contextCreateDirectory.addEventListener('click', () => {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestCreateDirectory', payload: { path: getContextWorkingDirectory() } });
  });

  function requestContextUpload() {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestUploadEntries', payload: { path: getContextWorkingDirectory() } });
  }

  contextUpload.addEventListener('click', requestContextUpload);
  contextUploadEntry.addEventListener('click', requestContextUpload);

  contextCopyCurrentPath.addEventListener('click', () => {
    hideContextMenu();
    copyCurrentRemotePathText();
  });

  contextDownload.addEventListener('click', () => {
    const entries = getSelectedActionEntries();
    hideContextMenu();
    if (entries.length) vscode.postMessage({ type: 'requestDownloadEntries', payload: { entries: entries.map(actionPayload) } });
  });

  contextCopyPath.addEventListener('click', () => {
    const entries = getSelectedActionEntries();
    hideContextMenu();
    copySelectedEntryText(entries, 'path');
  });

  contextCopyName.addEventListener('click', () => {
    const entries = getSelectedActionEntries();
    hideContextMenu();
    copySelectedEntryText(entries, 'name');
  });

  if (contextCutRemote) contextCutRemote.addEventListener('click', () => {
    const entries = getSelectedActionEntries();
    hideContextMenu();
    if (entries.length) {
      setOptimisticRemoteClipboardCutState(entries);
      vscode.postMessage({ type: 'requestCutRemoteEntries', payload: { entries: entries.map(actionPayload) } });
    }
  });

  if (contextPasteRemoteHere) contextPasteRemoteHere.addEventListener('click', () => {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestPasteRemoteEntries', payload: { targetDirectory: getCurrentContextDirectory() } });
  });

  if (contextPasteRemote) contextPasteRemote.addEventListener('click', () => {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestPasteRemoteEntries', payload: { targetDirectory: getContextWorkingDirectory() } });
  });

  if (remoteSearchContextOpen) remoteSearchContextOpen.addEventListener('click', () => {
    const entry = getRemoteSearchContextEntry();
    hideRemoteSearchResultContextMenu();
    if (entry) vscode.postMessage({ type: 'openEntries', payload: { entries: [entry] } });
  });

  if (remoteSearchContextOpenReadOnly) remoteSearchContextOpenReadOnly.addEventListener('click', () => {
    const entry = getRemoteSearchContextEntry();
    hideRemoteSearchResultContextMenu();
    if (entry) vscode.postMessage({ type: 'openEntriesReadOnly', payload: { entries: [entry] } });
  });

  if (remoteSearchContextCopyPath) remoteSearchContextCopyPath.addEventListener('click', () => {
    const text = formatRemoteSearchSelectedPathsForCopy('path');
    hideRemoteSearchResultContextMenu();
    if (text) vscode.postMessage({ type: 'copyStatus', payload: { text, message: text.indexOf('\\n') >= 0 ? 'Copied paths' : 'Copied path' } });
  });

  if (remoteSearchContextCopyName) remoteSearchContextCopyName.addEventListener('click', () => {
    const text = formatRemoteSearchSelectedPathsForCopy('name');
    hideRemoteSearchResultContextMenu();
    if (text) vscode.postMessage({ type: 'copyStatus', payload: { text, message: text.indexOf('\\n') >= 0 ? 'Copied filenames' : 'Copied filename' } });
  });

  if (remoteSearchContextCopyResults) remoteSearchContextCopyResults.addEventListener('click', () => {
    hideRemoteSearchResultContextMenu();
    copyRemoteSearchResults();
  });

  for (const button of entryContextMenu.querySelectorAll('[data-archive-format]')) {
    button.addEventListener('click', () => {
      const entries = getSelectedActionEntries();
      const format = button.dataset.archiveFormat || '';
      hideContextMenu();
      if (entries.length && format && getActiveRemoteCapabilities().canCreateArchive) vscode.postMessage({ type: 'requestCompressArchive', payload: { format, entries: entries.map(actionPayload) } });
    });
  }

  contextRefresh.addEventListener('click', () => {
    hideContextMenu();
    listDirectory(currentPath.value || '/', { forceRefresh: true });
  });

  if (contextOpenLogViewer) contextOpenLogViewer.addEventListener('click', () => {
    const selectedEntries = getSelectedActionEntries();
    const entry = selectedEntries.length === 1 ? selectedEntries[0] : null;
    const path = entry && getEffectiveEntryType(entry) === 'file' ? entry.path : '';
    hideContextMenu();
    if (!activeConnectionId || !getActiveRemoteCapabilities().canRunCommand) return;
    vscode.postMessage({
      type: 'requestOpenLogViewer',
      payload: { connectionId: activeConnectionId, path }
    });
  });

  contextRunRemoteCommand.addEventListener('click', () => {
    const workingDirectory = getContextWorkingDirectory();
    hideContextMenu();
    if (getActiveRemoteCapabilities().canRunCommand) showRemoteCommandDialog(workingDirectory);
  });

  contextOpenSshTerminal.addEventListener('click', () => {
    const capabilities = getActiveRemoteCapabilities();
    const workingDirectory = getContextWorkingDirectory();
    hideContextMenu();
    if (!activeConnectionId || !capabilities.canOpenSshTerminal) return;

    vscode.postMessage({
      type: 'requestOpenSshTerminal',
      payload: {
        connectionId: activeConnectionId,
        workingDirectory
      }
    });
  });

  if (openLogViewerButton) openLogViewerButton.addEventListener('click', () => {
    const capabilities = getActiveRemoteCapabilities();
    if (!activeConnectionId || openLogViewerButton.disabled || !capabilities.canFollowLogFiles) return;
    vscode.postMessage({
      type: 'requestOpenLogViewer',
      payload: { connectionId: activeConnectionId }
    });
  });

  runRemoteCommandButton.addEventListener('click', () => {
    if (activeConnectionId && !runRemoteCommandButton.disabled && getActiveRemoteCapabilities().canRunCommand) showRemoteCommandDialog();
  });

  openSshTerminalButton.addEventListener('click', () => {
    const capabilities = getActiveRemoteCapabilities();
    if (!activeConnectionId || openSshTerminalButton.disabled || !capabilities.canOpenSshTerminal) return;

    vscode.postMessage({
      type: 'requestOpenSshTerminal',
      payload: {
        connectionId: activeConnectionId,
        workingDirectory: normalizeUiRemotePath(currentPath.value || '/')
      }
    });
  });

  remoteCommandRunButton.addEventListener('click', () => {
    if (getCurrentRemoteCommandSession().status === 'running') {
      stopRemoteCommandFromDialog();
      return;
    }
    runRemoteCommandFromDialog();
  });
  remoteCommandCopyButton.addEventListener('click', () => copyRemoteCommandOutput());
  remoteCommandClearButton.addEventListener('click', () => clearRemoteCommandOutput());
  remoteCommandCloseButton.addEventListener('click', () => attemptCloseRemoteCommandDialog());
  remoteCommandKeepRunningButton.addEventListener('click', () => {
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandRunButton.focus();
  });
  remoteCommandStopAndCloseButton.addEventListener('click', () => stopRemoteCommandFromDialog());
  remoteCommandKeepStoppingButton.addEventListener('click', () => {
    remoteCommandStopWarning.classList.remove('visible');
    remoteCommandRunButton.focus();
  });
  remoteCommandForceKillButton.addEventListener('click', () => forceKillRemoteCommandFromDialog());
  remoteCommandInput.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      runRemoteCommandFromDialog();
    }
  });
  remoteCommandInput.addEventListener('input', () => {
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running') {
      state.command = String(remoteCommandInput.value || '');
      updateRemoteCommandControls();
    }
  });

  remoteCommandWorkingDirectory.addEventListener('input', () => {
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running') {
      state.workingDirectory = normalizeUiRemotePath(remoteCommandWorkingDirectory.value || '/');
      updateRemoteCommandControls();
    }
  });
  remoteCommandUseSudo.addEventListener('change', () => {
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running') {
      state.useSudo = collectRemoteCommandUseSudo();
      updateRemoteCommandRunAs();
    }
  });
  remoteCommandBrowseWorkingDirectoryButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); browseRemoteCommandWorkingDirectory(); });
  if (remoteCommandWorkingDirectoryPicker) {
    remoteCommandWorkingDirectoryPicker.addEventListener('mousedown', event => event.stopPropagation());
    remoteCommandWorkingDirectoryPicker.addEventListener('click', event => event.stopPropagation());
  }
  remoteCommandWorkingDirectorySelectButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); selectRemoteCommandWorkingDirectoryPickerPath(); });
  remoteCommandWorkingDirectoryCancelButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); hideRemoteCommandWorkingDirectoryPicker(); });
  remoteCommandWorkingDirectoryPickerList.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const item = event.target.closest('[data-remote-command-working-directory-path]');
    if (!item) return;
    const path = item.getAttribute('data-remote-command-working-directory-path') || '/';
    requestRemoteCommandWorkingDirectoryEntries(path);
  });
  remoteCommandSaveCurrentButton.addEventListener('click', () => {
    if (getCurrentRemoteCommandSession().status === 'running') return;
    remoteCommandEditingSavedId = '__new__';
    remoteCommandDeletingSavedId = '';
    renderRemoteCommandSavedList();
  });
  remoteCommandSavedList.addEventListener('click', event => {
    const editButton = event.target.closest('[data-remote-command-edit-action]');
    if (editButton) {
      const form = editButton.closest('.remote-command-edit-form');
      const action = editButton.getAttribute('data-remote-command-edit-action');
      if (action === 'cancel') {
        remoteCommandEditingSavedId = '';
        remoteCommandDeletingSavedId = '';
        renderRemoteCommandSavedList();
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const actionButton = event.target.closest('[data-remote-command-action]');
    const card = event.target.closest('[data-remote-command-saved-id]');
    if (!card) return;
    const id = card.getAttribute('data-remote-command-saved-id') || '';
    const item = getRemoteCommandSavedList(remoteCommandDialogConnectionId || activeConnectionId).find(command => command.id === id);
    if (!item) return;
    if (actionButton) {
      const action = actionButton.getAttribute('data-remote-command-action');
      if (action === 'append') loadRemoteCommandIntoEditor(item, true);
      if (action === 'edit') {
        remoteCommandEditingSavedId = id;
        remoteCommandDeletingSavedId = '';
        renderRemoteCommandSavedList();
      }
      if (action === 'delete') {
        remoteCommandDeletingSavedId = id;
        remoteCommandEditingSavedId = '';
        renderRemoteCommandSavedList();
      }
      if (action === 'cancel-delete') {
        remoteCommandDeletingSavedId = '';
        renderRemoteCommandSavedList();
      }
      if (action === 'confirm-delete') deleteRemoteCommandSaved(id);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    loadRemoteCommandIntoEditor(item, false);
  });
  remoteCommandSavedList.addEventListener('submit', event => {
    const form = event.target.closest('.remote-command-edit-form');
    if (!form) return;
    event.preventDefault();
    saveRemoteCommandEditForm(form);
  });
  remoteCommandHistoryList.addEventListener('click', event => {
    const card = event.target.closest('[data-remote-command-history-id]');
    if (!card) return;
    const id = card.getAttribute('data-remote-command-history-id') || '';
    const item = getRemoteCommandHistoryList(remoteCommandDialogConnectionId || activeConnectionId).find(command => command.id === id);
    if (!item) return;
    const actionButton = event.target.closest('[data-remote-command-action]');
    if (actionButton && actionButton.getAttribute('data-remote-command-action') === 'save-history') {
      saveHistoryItemAsSavedCommand(item);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    loadRemoteCommandIntoEditor(item, false);
  });

  remoteCommandOutputWrap.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && String(event.key || '').toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      selectRemoteCommandOutputText();
    }
  });

  contextSetPermissions.addEventListener('click', () => {
    const entries = getSelectedActionEntries();
    hideContextMenu();
    if (entries.length && getActiveRemoteCapabilities().canChangePermissions) vscode.postMessage({ type: 'requestSetPermissions', payload: { entries: entries.map(actionPayload) } });
  });

  contextChangeOwnerGroup.addEventListener('click', () => {
    const entries = getSelectedActionEntries();
    hideContextMenu();
    if (entries.length && getActiveRemoteCapabilities().canChangeOwnerGroup) showOwnerGroupDialog(entries);
  });

  contextFileProperties.addEventListener('click', () => {
    const entry = getSelectedActionEntry();
    hideContextMenu();
    if (entry) showFilePropertiesDialog(entry);
  });

  contextCalculateChecksums.addEventListener('click', () => {
    const entry = getSelectedActionEntry();
    hideContextMenu();
    if (entry && getActiveRemoteCapabilities().canCalculateServerChecksums) vscode.postMessage({ type: 'requestCalculateChecksums', payload: actionPayload(entry) });
  });

  if (serverOverviewDetailsCloseButton) {
    serverOverviewDetailsCloseButton.addEventListener('click', () => {
      hideServerOverviewDetailsDialog();
    });
  }

  filePropertiesCloseButton.addEventListener('click', () => {
    hideFilePropertiesDialog();
  });

  filePropertiesCopyPathButton.addEventListener('click', () => {
    if (filePropertiesRemotePath) copyRemotePath(filePropertiesRemotePath);
  });

  checksumsCloseButton.addEventListener('click', () => {
    hideChecksumsDialog();
  });

  checksumsCopySha256Button.addEventListener('click', () => {
    copyChecksumValue(checksumsCopyState.sha256, 'Copied SHA-256');
  });

  checksumsCopyMd5Button.addEventListener('click', () => {
    copyChecksumValue(checksumsCopyState.md5, 'Copied MD5');
  });

  checksumsCopyAllButton.addEventListener('click', () => {
    copyChecksumValue(checksumsCopyState.all, 'Copied checksums');
  });

  ownerGroupOwnerInput.addEventListener('input', () => {
    updateOwnerGroupApplyState();
    renderOwnerGroupSuggestions('owner');
  });
  ownerGroupGroupInput.addEventListener('input', () => {
    updateOwnerGroupApplyState();
    renderOwnerGroupSuggestions('group');
  });
  ownerGroupOwnerInput.addEventListener('focus', () => showOwnerGroupSuggestions('owner'));
  ownerGroupGroupInput.addEventListener('focus', () => showOwnerGroupSuggestions('group'));
  ownerGroupOwnerSuggestions.addEventListener('mousedown', event => event.preventDefault());
  ownerGroupGroupSuggestions.addEventListener('mousedown', event => event.preventDefault());
  ownerGroupOwnerSuggestions.addEventListener('click', event => handleOwnerGroupSuggestionClick(event, 'owner'));
  ownerGroupGroupSuggestions.addEventListener('click', event => handleOwnerGroupSuggestionClick(event, 'group'));
  ownerGroupRecursiveInput.addEventListener('change', updateOwnerGroupApplyState);
  ownerGroupCancelButton.addEventListener('click', hideOwnerGroupDialog);
  ownerGroupApplyButton.addEventListener('click', applyOwnerGroupDialog);
  document.addEventListener('mousedown', event => {
    if (!ownerGroupDialogOpen || !isOwnerGroupSuggestionsOpen()) return;
    const target = event.target && event.target.closest ? event.target.closest('.owner-group-combo, .owner-group-suggestions') : null;
    if (!target) hideOwnerGroupSuggestions();
  });

  window.addEventListener('resize', scheduleOwnerGroupSuggestionsPosition);
  window.addEventListener('scroll', scheduleOwnerGroupSuggestionsPosition, true);
  window.addEventListener('resize', scheduleConnectionNameGroupDropdownPosition);
  window.addEventListener('scroll', scheduleConnectionNameGroupDropdownPosition, true);

  manageProfilesCloseButton.addEventListener('click', () => {
    hideManageProfilesDialog();
  });

  if (manageProfilesExpandAllButton) {
    manageProfilesExpandAllButton.addEventListener('click', () => {
      if (manageProfilesExpandAllButton.disabled || String(manageProfilesFilterText || '').trim()) return;
      collapsedConnectionGroupIds.clear();
      hideWebviewTooltip();
      renderManageProfilesList();
    });
  }

  if (manageProfilesCollapseAllButton) {
    manageProfilesCollapseAllButton.addEventListener('click', () => {
      if (manageProfilesCollapseAllButton.disabled || String(manageProfilesFilterText || '').trim()) return;
      collapsedConnectionGroupIds = new Set(getSortedConnectionGroups().map(group => String(group && group.id || '').trim()).filter(Boolean));
      hideWebviewTooltip();
      renderManageProfilesList();
    });
  }

  manageProfilesAddGroupButton.addEventListener('click', () => {
    showManageGroupDialog();
  });

  if (manageGroupCancelButton) manageGroupCancelButton.addEventListener('click', hideManageGroupDialog);
  if (manageGroupSaveButton) manageGroupSaveButton.addEventListener('click', confirmManageGroupDialog);
  if (manageGroupNameInput) {
    manageGroupNameInput.addEventListener('input', () => {
      manageGroupNameInput.classList.remove('connection-input-invalid');
      showManageGroupFeedback('', false);
    });
    manageGroupNameInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        confirmManageGroupDialog();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hideManageGroupDialog();
      }
    });
  }
  if (manageGroupRemoveOnlyRadio) manageGroupRemoveOnlyRadio.addEventListener('change', updateManageGroupRemoveDialogState);
  if (manageGroupRemoveConnectionsRadio) manageGroupRemoveConnectionsRadio.addEventListener('change', updateManageGroupRemoveDialogState);
  if (manageGroupRemoveCancelButton) manageGroupRemoveCancelButton.addEventListener('click', hideManageGroupRemoveDialog);
  if (manageGroupRemoveConfirmButton) manageGroupRemoveConfirmButton.addEventListener('click', confirmManageGroupRemoveDialog);
  manageProfilesImportButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'requestImportConnectionsSettings' });
  });

  manageProfilesExportButton.addEventListener('click', () => {
    showExportBackupDialog();
  });

  exportBackupCancelButton.addEventListener('click', hideExportBackupDialog);
  exportBackupApplyButton.addEventListener('click', applyExportBackupDialog);
  for (const input of [exportIncludeSettings, exportIncludeConnections, exportIncludeFavorites, exportIncludeUsernames, exportIncludeCredentials]) {
    input.addEventListener('change', updateExportBackupDialogState);
  }

  exportCredentialPassword.addEventListener('input', () => {
    exportBackupValidation.textContent = '';
    clearBackupFieldError(exportCredentialPassword, exportCredentialPasswordError);
  });
  exportCredentialConfirmPassword.addEventListener('input', () => {
    exportBackupValidation.textContent = '';
    clearBackupFieldError(exportCredentialConfirmPassword, exportCredentialConfirmPasswordError);
  });
  bindTemporaryPasswordReveal(exportCredentialPasswordRevealButton, exportCredentialPassword);
  bindTemporaryPasswordReveal(exportCredentialConfirmPasswordRevealButton, exportCredentialConfirmPassword);
  bindTemporaryPasswordReveal(passwordRevealButton, password);
  bindTemporaryPasswordReveal(passphraseRevealButton, passphrase);
  bindTemporaryPasswordReveal(inputPromptRevealButton, inputPromptInput);

  importBackupCancelButton.addEventListener('click', hideImportBackupDialog);
  importBackupApplyButton.addEventListener('click', applyImportBackupDialog);
  for (const input of [importIncludeSettings, importIncludeConnections, importIncludeFavorites, importIncludeUsernames, importRestoreCredentials, importModeMerge, importModeReplace]) {
    input.addEventListener('change', updateImportBackupDialogState);
  }

  importCredentialPassword.addEventListener('input', () => {
    importBackupValidation.textContent = '';
    clearBackupFieldError(importCredentialPassword, importCredentialPasswordError);
  });
  bindTemporaryPasswordReveal(importCredentialPasswordRevealButton, importCredentialPassword);

  manageProfilesFilterInput.addEventListener('input', () => {
    manageProfilesFilterText = String(manageProfilesFilterInput.value || '');
    updateManageProfilesFilterState();
    renderManageProfilesList();
  });

  manageProfilesFilterInput.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!manageProfilesFilterInput.value) return;
    event.preventDefault();
    event.stopPropagation();
    clearManageProfilesFilter();
  });

  manageProfilesFilterClearButton.addEventListener('click', () => {
    clearManageProfilesFilter();
  });

  manageProfilesList.addEventListener('click', handleManageProfilesClick);
  manageProfilesList.addEventListener('dragover', handleManageProfilesDragOver);
  manageProfilesList.addEventListener('drop', handleManageProfilesDrop);
  document.addEventListener('dragover', handleManageProfilesDragOver);
  document.addEventListener('drop', handleManageProfilesDrop);
  document.addEventListener('dragend', () => {
    if (manageProfileDragging) clearManageProfileDragState({ restoreAutoExpanded: true });
  });

  contextMakeCopy.addEventListener('click', () => {
    const entry = getSelectedActionEntry();
    hideContextMenu();
    if (entry) vscode.postMessage({ type: 'requestMakeCopy', payload: actionPayload(entry) });
  });

  contextRename.addEventListener('click', () => {
    const entry = getSelectedActionEntry();
    hideContextMenu();
    if (entry) vscode.postMessage({ type: 'requestRenameEntry', payload: actionPayload(entry) });
  });

  contextDelete.addEventListener('click', () => {
    const entries = getSelectedActionEntries();
    hideContextMenu();
    if (entries.length) vscode.postMessage({ type: 'requestDeleteEntries', payload: { entries: entries.map(actionPayload) } });
  });


  for (const checkbox of permissionCheckboxes) {
    checkbox.addEventListener('change', () => {
      if (!permissionsDialogOpen) return;
      permissionModeInput.value = calculateModeFromPermissionCheckboxes();
      updatePermissionPreview(permissionModeInput.value);
      setPermissionValidation('', true);
    });
  }

  permissionModeInput.addEventListener('input', () => {
    const value = permissionModeInput.value.trim();

    if (/^[0-7]{0,4}$/.test(value) === false) {
      updatePermissionPreview('');
      setPermissionValidation('Use only octal digits from 0 to 7.', false);
      return;
    }

    const normalized = normalizePermissionMode(value);
    if (!normalized) {
      updatePermissionPreview('');
      setPermissionValidation('Enter 3 or 4 octal digits, for example 644, 0755, 2775 or 1777.', false);
      return;
    }

    updatePermissionCheckboxesFromMode(normalized);
    updatePermissionPreview(normalized);
    setPermissionValidation('', true);
  });

  permissionModeInput.addEventListener('blur', () => {
    const normalized = normalizePermissionMode(permissionModeInput.value.trim());
    if (normalized) {
      permissionModeInput.value = normalized;
      updatePermissionPreview(normalized);
    }
  });

  permissionApplyButton.addEventListener('click', () => {
    if (!getActiveRemoteCapabilities().canChangePermissions) {
      setPermissionValidation('Set Permissions is available only for SFTP connections.', false);
      return;
    }

    const normalized = normalizePermissionMode(permissionModeInput.value.trim());
    if (!normalized) {
      setPermissionValidation('Enter a valid octal mode before applying.', false);
      return;
    }

    vscode.postMessage({ type: 'applyPermissions', payload: { mode: normalized, recursive: Boolean(permissionRecursiveInput.checked) } });
  });

  permissionCancelButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'cancelPermissions' });
  });

  let activeTextEditTarget = null;

`;}
