export function renderRemoteCommandOutput(): string {
  return `      showBackupResult(importBackupResult, String(importBackupSummaryState.importError), true);
    }
    importBackupBackdrop.classList.add('visible');
    importBackupBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => (importBackupSummaryState.importError ? importBackupCancelButton : (importIncludeSettings.disabled ? importIncludeConnections : importIncludeSettings)).focus(), 0);
  }

  function hideImportBackupDialog() {
    importBackupDialogOpen = false;
    importBackupBackdrop.classList.remove('visible');
    importBackupBackdrop.setAttribute('aria-hidden', 'true');
    importCredentialPassword.value = '';
    hideTemporaryPassword(importCredentialPassword);
    importBackupValidation.textContent = '';
    clearImportBackupFieldErrors();
    clearBackupResult(importBackupResult);
  }

  function renderImportBackupSummary(summary) {
    if (summary.importError) {
      importBackupSummary.textContent = 'Unable to read selected file.';
      return;
    }

    const connectionCount = Number(summary.connectionCount || 0);
    const favoriteCount = Number(summary.remotePathFavoriteCount || 0);
    const connectionGroupCount = Number(summary.connectionGroupCount || 0);
    const unsupportedCount = Number(summary.unsupportedConnectionCount || 0);
    const savedCommandCount = Number(summary.savedCommandCount || 0);
    const portForwardCount = Number(summary.portForwardCount || 0);
    const serverLogShortcutCount = Number(summary.serverLogShortcutCount || 0);
    const logViewerFavoriteCount = Number(summary.logViewerFavoriteCount || 0);
    const parts = [
      summary.hasSettings ? 'Settings included' : 'Settings not included',
      connectionCount === 1 ? '1 connection' : connectionCount + ' connections',
      favoriteCount === 1 ? '1 favorite' : favoriteCount + ' favorites',
      summary.usernamesIncluded ? 'usernames included' : 'usernames not included',
      summary.hasEncryptedCredentials ? 'passwords/passphrases encrypted' : 'passwords/passphrases not included'
    ];

    if (connectionGroupCount) parts.push(connectionGroupCount === 1 ? '1 group' : connectionGroupCount + ' groups');
    if (savedCommandCount) parts.push(savedCommandCount === 1 ? '1 saved command' : savedCommandCount + ' saved commands');
    if (portForwardCount) parts.push(portForwardCount === 1 ? '1 port forward' : portForwardCount + ' port forwards');
    if (serverLogShortcutCount) parts.push(serverLogShortcutCount === 1 ? '1 log shortcut' : serverLogShortcutCount + ' log shortcuts');
    if (logViewerFavoriteCount) parts.push(logViewerFavoriteCount === 1 ? '1 log favorite' : logViewerFavoriteCount + ' log favorites');

    if (unsupportedCount) {
      parts.splice(2, 0, unsupportedCount === 1 ? '1 unsupported' : unsupportedCount + ' unsupported');
    }

    importBackupSummary.textContent = parts.join(' · ');
  }

  function updateImportBackupDialogState() {
    const summary = importBackupSummaryState || {};
    const hasImportError = Boolean(summary.importError);
    const hasSettings = !hasImportError && Boolean(summary.hasSettings);
    const hasConnections = !hasImportError && Number(summary.supportedConnectionCount || 0) > 0;
    const hasFavorites = !hasImportError && Number(summary.remotePathFavoriteCount || 0) > 0;
    const hasUsernames = !hasImportError && Boolean(summary.usernamesIncluded);
    const hasCredentials = !hasImportError && Boolean(summary.hasEncryptedCredentials);

    importIncludeSettings.disabled = !hasSettings;
    if (!hasSettings) importIncludeSettings.checked = false;

    importIncludeConnections.disabled = !hasConnections;
    if (!hasConnections) importIncludeConnections.checked = false;

    const includeConnections = hasConnections && Boolean(importIncludeConnections.checked);
    importIncludeFavorites.disabled = !includeConnections || !hasFavorites;
    importIncludeUsernames.disabled = !includeConnections || !hasUsernames;

    if (!includeConnections || !hasFavorites) importIncludeFavorites.checked = false;
    if (!includeConnections || !hasUsernames) importIncludeUsernames.checked = false;

    const canRestoreCredentials = includeConnections && Boolean(importIncludeUsernames.checked) && hasCredentials;
    importRestoreCredentials.disabled = !canRestoreCredentials;
    if (!canRestoreCredentials) importRestoreCredentials.checked = false;

    const showCredentials = canRestoreCredentials && Boolean(importRestoreCredentials.checked);
    importCredentialsBlock.classList.toggle('visible', showCredentials);
    importCredentialPassword.disabled = !showCredentials;
    importCredentialPasswordRevealButton.disabled = !showCredentials;
    hideTemporaryPassword(importCredentialPassword);
    if (!showCredentials) importCredentialPassword.value = '';

    importCredentialsDisabledHelp.textContent = hasImportError
      ? ''
      : (!hasCredentials
        ? 'This backup does not contain encrypted passwords/passphrases.'
        : (includeConnections && !importIncludeUsernames.checked ? 'Enable usernames to restore encrypted passwords/passphrases.' : ''));

    const enableImportMode = includeConnections;
    importModeBlock.style.opacity = enableImportMode ? '1' : '0.6';
    importModeMerge.disabled = !enableImportMode;
    importModeReplace.disabled = !enableImportMode;

    importModeHelp.textContent = hasImportError
      ? ''
      : (importModeReplace.checked
        ? 'Existing connections will be replaced by this backup.'
        : 'Matching connections are updated. New connections are added.');

    importBackupApplyButton.disabled = hasImportError;
    importBackupValidation.textContent = '';
    clearImportBackupFieldErrors();
    if (!hasImportError) clearBackupResult(importBackupResult);
  }

  function applyImportBackupDialog() {
    importBackupValidation.textContent = '';
    clearImportBackupFieldErrors();
    clearBackupResult(importBackupResult);
    const restoreCredentials = Boolean(importRestoreCredentials.checked) && !importRestoreCredentials.disabled;
    const credentialPassword = String(importCredentialPassword.value || '');

    if (!importIncludeSettings.checked && !importIncludeConnections.checked) {
      showBackupResult(importBackupResult, 'Select at least one import option.', true);
      return;
    }

    if (restoreCredentials && !credentialPassword) {
      setBackupFieldError(importCredentialPassword, importCredentialPasswordError, 'Export password is required.');
      showBackupResult(importBackupResult, 'Export password is required.', true);
      importCredentialPassword.focus();
      return;
    }

    vscode.postMessage({
      type: 'importConnectionsSettings',
      payload: {
        includeSettings: Boolean(importIncludeSettings.checked) && !importIncludeSettings.disabled,
        includeConnections: Boolean(importIncludeConnections.checked) && !importIncludeConnections.disabled,
        includeFavorites: Boolean(importIncludeFavorites.checked) && !importIncludeFavorites.disabled,
        includeUsernames: Boolean(importIncludeUsernames.checked) && !importIncludeUsernames.disabled,
        restoreCredentials,
        credentialPassword,
        importMode: importModeReplace.checked ? 'replace' : 'merge'
      }
    });

  }


  function showManageProfilesFeedback(message, isError) {
    if (!manageProfilesFeedback) return;
    const text = String(message || '').trim();
    manageProfilesFeedback.textContent = text;
    manageProfilesFeedback.classList.toggle('visible', Boolean(text));
    manageProfilesFeedback.classList.toggle('error', Boolean(isError));
    manageProfilesFeedback.classList.toggle('success', Boolean(text) && !isError);
  }

  function updateManageProfileGroupActionState() {
    const groupIds = getSortedConnectionGroups().map(group => String(group && group.id || '').trim()).filter(Boolean);
    const hasGroups = groupIds.length > 0;
    const hasFilter = Boolean(String(manageProfilesFilterText || '').trim());
    const allExpanded = hasGroups && groupIds.every(groupId => !collapsedConnectionGroupIds.has(groupId));
    const allCollapsed = hasGroups && groupIds.every(groupId => collapsedConnectionGroupIds.has(groupId));

    if (manageProfilesExpandAllButton) {
      manageProfilesExpandAllButton.hidden = !hasGroups;
      manageProfilesExpandAllButton.disabled = !hasGroups || hasFilter || allExpanded;
      manageProfilesExpandAllButton.dataset.tooltip = hasFilter ? 'Clear filter to expand all groups' : 'Expand all groups';
      manageProfilesExpandAllButton.setAttribute('aria-label', hasFilter ? 'Clear filter to expand all groups' : 'Expand all groups');
    }

    if (manageProfilesCollapseAllButton) {
      manageProfilesCollapseAllButton.hidden = !hasGroups;
      manageProfilesCollapseAllButton.disabled = !hasGroups || hasFilter || allCollapsed;
      manageProfilesCollapseAllButton.dataset.tooltip = hasFilter ? 'Clear filter to collapse all groups' : 'Collapse all groups';
      manageProfilesCollapseAllButton.setAttribute('aria-label', hasFilter ? 'Clear filter to collapse all groups' : 'Collapse all groups');
    }
  }

  function updateManageProfilesFilterState() {
    const hasValue = Boolean(manageProfilesFilterInput && manageProfilesFilterInput.value);
    if (manageProfilesFilterBox) manageProfilesFilterBox.classList.toggle('has-value', hasValue);
    if (manageProfilesFilterClearButton) manageProfilesFilterClearButton.disabled = !hasValue;
    updateManageProfileGroupActionState();
  }

  function clearManageProfilesFilter(options) {
    if (!manageProfilesFilterInput) return false;
    if (!manageProfilesFilterInput.value) {
      updateManageProfilesFilterState();
      return false;
    }
    manageProfilesFilterInput.value = '';
    manageProfilesFilterText = '';
    updateManageProfilesFilterState();
    renderManageProfilesList();
    if (!options || options.focus !== false) manageProfilesFilterInput.focus();
    return true;
  }

  function showManageProfilesDialog() {
    manageProfilesDialogOpen = true;
    renameProfileId = '';
    renameGroupId = '';
    manageProfilesFilterText = '';
    if (manageProfilesFilterInput) manageProfilesFilterInput.value = '';
    updateManageProfilesFilterState();
    showManageProfilesFeedback('', false);
    renderManageProfilesList();
    manageProfilesBackdrop.classList.add('visible');
    manageProfilesBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => { if (manageProfilesFilterInput) manageProfilesFilterInput.focus(); else manageProfilesCloseButton.focus(); }, 0);
  }

  function hideManageProfilesDialog() {
    if (!manageProfilesBackdrop) return;
    manageProfilesDialogOpen = false;
    manageProfilesFilterText = '';
    if (manageProfilesFilterInput) manageProfilesFilterInput.value = '';
    updateManageProfilesFilterState();
    renameProfileId = '';
    renameGroupId = '';
    hideManageGroupDialog();
    hideManageGroupRemoveDialog();
    manageProfilesBackdrop.classList.remove('visible');
    manageProfilesBackdrop.setAttribute('aria-hidden', 'true');
  }

  function getConnectionGroupNameError(name, existingGroupId) {
    const value = String(name || '').trim();
    const id = String(existingGroupId || '').trim();
    if (!value) return 'Group name is required.';
    const duplicate = connectionGroups.find(group => group && group.id !== id && String(group.name || '').trim().toLowerCase() === value.toLowerCase());
    if (duplicate) return 'A connection group with this name already exists.';
    return '';
  }

  function showManageGroupFeedback(message, isError) {
    if (!manageGroupFeedback) return;
    const text = String(message || '').trim();
    manageGroupFeedback.textContent = text;
    manageGroupFeedback.classList.toggle('error', Boolean(isError));
    manageGroupFeedback.classList.toggle('success', Boolean(text) && !isError);
  }

  function showManageGroupDialog() {
    manageGroupDialogOpen = true;
    manageGroupDialogMode = 'add';
    manageGroupDialogGroupId = '';
    if (manageGroupTitle) manageGroupTitle.textContent = 'New Group';
    if (manageGroupSubtitle) manageGroupSubtitle.textContent = 'Create a saved connection group.';
    if (manageGroupNameInput) {
      manageGroupNameInput.value = '';
      manageGroupNameInput.classList.remove('connection-input-invalid');
    }
    if (manageGroupSaveButton) manageGroupSaveButton.textContent = 'Create';
    showManageGroupFeedback('', false);
    hideWebviewTooltip();
    hideProfileDropdown();
    if (manageGroupBackdrop) {
      manageGroupBackdrop.classList.add('visible');
      manageGroupBackdrop.setAttribute('aria-hidden', 'false');
    }
    setTimeout(() => { if (manageGroupNameInput) manageGroupNameInput.focus(); }, 0);
  }

  function hideManageGroupDialog() {
    if (!manageGroupBackdrop || !manageGroupDialogOpen) return;
    manageGroupDialogOpen = false;
    manageGroupDialogMode = 'add';
    manageGroupDialogGroupId = '';
    if (manageGroupNameInput) {
      manageGroupNameInput.value = '';
      manageGroupNameInput.classList.remove('connection-input-invalid');
    }
    showManageGroupFeedback('', false);
    manageGroupBackdrop.classList.remove('visible');
    manageGroupBackdrop.setAttribute('aria-hidden', 'true');
  }

  function confirmManageGroupDialog() {
    if (!manageGroupDialogOpen || !manageGroupNameInput) return;
    const name = String(manageGroupNameInput.value || '').trim();
    const nameError = getConnectionGroupNameError(name, '');
    if (nameError) {
      showManageGroupFeedback(nameError, true);
      manageGroupNameInput.classList.add('connection-input-invalid');
      manageGroupNameInput.focus();
      return;
    }

    hideManageGroupDialog();
    setBusy(true, 'Creating connection group...');
    vscode.postMessage({ type: 'createConnectionGroup', payload: { name, selectedId: selectedProfileId } });
  }

  function trapManageGroupDialogFocus(event) {
    if (!manageGroupDialogOpen || event.key !== 'Tab') return;
    const focusable = [manageGroupNameInput, manageGroupCancelButton, manageGroupSaveButton].filter(element => element && !element.hidden && element.style.display !== 'none' && !element.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function getConnectionGroupProfileCount(groupId) {
    const id = String(groupId || '').trim();
    if (!id) return 0;
    return profiles.filter(profile => profile && profile.groupId === id).length;
  }

  function showManageGroupRemoveFeedback(message, isError) {
    if (!manageGroupRemoveFeedback) return;
    const text = String(message || '').trim();
    manageGroupRemoveFeedback.textContent = text;
    manageGroupRemoveFeedback.classList.toggle('error', Boolean(isError));
    manageGroupRemoveFeedback.classList.toggle('success', Boolean(text) && !isError);
  }

  function updateManageGroupRemoveDialogState() {
    const deleteConnections = Boolean(manageGroupRemoveConnectionsRadio && manageGroupRemoveConnectionsRadio.checked);
    if (manageGroupRemoveConfirmButton) {
      manageGroupRemoveConfirmButton.textContent = deleteConnections ? 'Remove Group and Connections' : 'Remove';
      manageGroupRemoveConfirmButton.classList.toggle('danger', true);
    }
  }

  function showManageGroupRemoveDialog(group) {
    const groupId = String(group && group.id || '').trim();
    if (!groupId) return;
    const groupName = String(group && group.name || 'connection group');
    const count = getConnectionGroupProfileCount(groupId);
    manageGroupRemoveDialogOpen = true;
    manageGroupRemoveGroupId = groupId;
    if (manageGroupRemoveSubtitle) {
      manageGroupRemoveSubtitle.textContent = count === 1
        ? 'This group contains 1 saved connection.'
        : 'This group contains ' + count + ' saved connections.';
    }
    if (manageGroupRemoveName) manageGroupRemoveName.textContent = groupName;
    if (manageGroupRemoveOnlyRadio) manageGroupRemoveOnlyRadio.checked = true;
    if (manageGroupRemoveConnectionsRadio) manageGroupRemoveConnectionsRadio.checked = false;
    if (manageGroupRemoveConnectionsHelp) {
      manageGroupRemoveConnectionsHelp.textContent = count === 1
        ? 'The saved connection inside this group will also be removed.'
        : 'Saved connections inside this group will also be removed.';
    }
    showManageGroupRemoveFeedback('', false);
    updateManageGroupRemoveDialogState();
    hideWebviewTooltip();
    hideProfileDropdown();
    if (manageGroupRemoveBackdrop) {
      manageGroupRemoveBackdrop.classList.add('visible');
      manageGroupRemoveBackdrop.setAttribute('aria-hidden', 'false');
    }
    setTimeout(() => { if (manageGroupRemoveCancelButton) manageGroupRemoveCancelButton.focus(); }, 0);
  }

  function hideManageGroupRemoveDialog() {
    if (!manageGroupRemoveBackdrop || !manageGroupRemoveDialogOpen) return;
    manageGroupRemoveDialogOpen = false;
    manageGroupRemoveGroupId = '';
    showManageGroupRemoveFeedback('', false);
    manageGroupRemoveBackdrop.classList.remove('visible');
    manageGroupRemoveBackdrop.setAttribute('aria-hidden', 'true');
  }

  function confirmManageGroupRemoveDialog() {
    if (!manageGroupRemoveDialogOpen) return;
    const groupId = String(manageGroupRemoveGroupId || '').trim();
    const group = connectionGroups.find(item => item && item.id === groupId);
    if (!group) {
      showManageGroupRemoveFeedback('The selected connection group no longer exists.', true);
      return;
    }
    const deleteConnections = Boolean(manageGroupRemoveConnectionsRadio && manageGroupRemoveConnectionsRadio.checked);
    hideManageGroupRemoveDialog();
    setBusy(true, deleteConnections ? 'Deleting connection group and connections...' : 'Deleting connection group...');
    vscode.postMessage({ type: 'deleteConnectionGroup', payload: { id: groupId, name: group.name || '', selectedId: selectedProfileId, deleteConnections } });
  }

  function trapManageGroupRemoveDialogFocus(event) {
    if (!manageGroupRemoveDialogOpen || event.key !== 'Tab') return;
    const focusable = [manageGroupRemoveOnlyRadio, manageGroupRemoveConnectionsRadio, manageGroupRemoveCancelButton, manageGroupRemoveConfirmButton]
      .filter(element => element && !element.hidden && element.style.display !== 'none' && !element.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // SVGs copied from the same icons used by the Sidebar inline actions.
  const PROFILE_ACTION_CONNECT_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" focusable="false" aria-hidden="true"><path d="M10.723 4H10V1.5C10 1.224 9.776 1 9.5 1C9.224 1 9 1.224 9 1.5V4H7V1.5C7 1.224 6.776 1 6.5 1C6.224 1 6 1.224 6 1.5V4H5.277C4.573 4 4 4.573 4 5.278V8C4 10.036 5.529 11.722 7.5 11.969V14.5C7.5 14.776 7.724 15 8 15C8.276 15 8.5 14.776 8.5 14.5V11.969C10.471 11.722 12 10.037 12 8V5.278C12 4.573 11.427 4 10.723 4ZM11 8C11 9.654 9.654 11 8 11C6.346 11 5 9.654 5 8V5.278C5 5.125 5.124 5 5.277 5H10.722C10.875 5 10.999 5.125 10.999 5.278V8H11Z"/></svg>';
  const PROFILE_ACTION_DISCONNECT_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" focusable="false" aria-hidden="true"><path d="M15.3542 0.646006C15.1592 0.451006 14.8422 0.451006 14.6472 0.646006L12.5772 2.71601C11.2072 1.71701 9.20723 1.87301 7.93723 3.14401L7.80623 3.27501C7.31923 3.76201 7.31923 4.55501 7.80623 5.04301L10.9882 8.22501C11.2312 8.46901 11.5512 8.59101 11.8722 8.59101C12.1932 8.59101 12.5132 8.46901 12.7562 8.22501L12.9762 8.00501C13.6522 7.33001 14.0162 6.43101 14.0012 5.47601C13.9892 4.72001 13.7412 4.00601 13.2912 3.41701L15.3542 1.35401C15.5492 1.15901 15.5492 0.841006 15.3542 0.646006ZM12.2682 7.29701L12.0482 7.51701C11.9502 7.61501 11.7922 7.61501 11.6942 7.51701L8.51223 4.33501C8.41423 4.23701 8.41423 4.07901 8.51223 3.98101L8.64323 3.85001C9.16723 3.32601 9.86023 3.06001 10.5402 3.06001C11.1502 3.06001 11.7512 3.27401 12.2112 3.70801C12.7092 4.17601 12.9882 4.80901 12.9992 5.49101C13.0092 6.17301 12.7502 6.81501 12.2682 7.29701ZM8.14623 9.14601L7.26623 10.026L5.97323 8.73301L6.85323 7.85301C7.04823 7.65801 7.04823 7.34101 6.85323 7.14601C6.65823 6.95101 6.34123 6.95101 6.14623 7.14601L5.26623 8.02601L5.01323 7.77301C4.52723 7.28701 3.73223 7.28701 3.24523 7.77401L3.02523 7.99401C2.34923 8.66901 1.98523 9.56801 2.00023 10.523C2.01223 11.279 2.26023 11.993 2.71023 12.582L0.647227 14.645C0.452227 14.84 0.452227 15.157 0.647227 15.352C0.745227 15.45 0.873227 15.498 1.00123 15.498C1.12923 15.498 1.25723 15.449 1.35523 15.352L3.42523 13.282C4.02223 13.717 4.73723 13.934 5.46123 13.934C6.39923 13.934 7.34923 13.571 8.06523 12.854L8.19623 12.723C8.68323 12.236 8.68323 11.443 8.19623 10.955L7.97423 10.733L8.85423 9.85301C9.04923 9.65801 9.04923 9.34101 8.85423 9.14601C8.65923 8.95101 8.34223 8.95101 8.14723 9.14601H8.14623ZM7.48923 12.018L7.35723 12.149C6.36323 13.144 4.76123 13.208 3.78923 12.291C3.29123 11.823 3.01223 11.19 3.00123 10.508C2.99123 9.82601 3.25123 9.18401 3.73323 8.70201L3.95323 8.48201C4.00223 8.43301 4.06523 8.40901 4.13023 8.40901C4.19523 8.40901 4.25823 8.43301 4.30723 8.48201C5.37118 9.54596 6.42725 10.602 7.48723 11.662C7.58523 11.76 7.58523 11.918 7.48723 12.016L7.48923 12.018Z"/></svg>';
  const MANAGE_ICON_RENAME = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="M200-200h57.46l391.77-391.77-57.46-57.46L200-257.46V-200Zm-40 40v-114.15l489.23-489.23q5.85-5.85 13.08-8.54 7.23-2.69 14.69-2.69 7.46 0 14.88 2.69 7.43 2.69 13.27 8.54l57.23 57.23q5.85 5.84 8.54 13.27 2.69 7.42 2.69 14.88 0 7.46-2.69 14.69-2.69 7.23-8.54 13.08L274.15-160H160Zm432-489.23 57.23 57.46L592-649.23Z"></path></svg>';
  const MANAGE_ICON_SAVE = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="M382-267.69 194.69-455l28.31-28.31 159 159 355-355L765.31-651 382-267.69Z"></path></svg>';
  const MANAGE_ICON_CANCEL = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="m256-227.69-28.31-28.31 224-224-224-224L256-732.31l224 224 224-224 28.31 28.31-224 224 224 224L704-227.69l-224-224-224 224Z"></path></svg>';
  const MANAGE_ICON_DELETE = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="M292.31-140q-29.83 0-51.07-21.24Q220-182.48 220-212.31V-720h-40v-40h180v-40h240v40h180v40h-40v507.69q0 29.83-21.24 51.07Q697.52-140 667.69-140H292.31ZM700-720H260v507.69q0 13.85 9.23 23.08 9.23 9.23 23.08 9.23h375.38q13.85 0 23.08-9.23 9.23-9.23 9.23-23.08V-720ZM376.92-266.15h40v-367.7h-40v367.7Zm166.16 0h40v-367.7h-40v367.7ZM260-720v540-540Z"></path></svg>';
  const MANAGE_ICON_DRAG = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="M360-220q-24.75 0-42.37-17.63Q300-255.25 300-280q0-24.75 17.63-42.37Q335.25-340 360-340q24.75 0 42.38 17.63Q420-304.75 420-280q0 24.75-17.62 42.37Q384.75-220 360-220Zm240 0q-24.75 0-42.37-17.63Q540-255.25 540-280q0-24.75 17.63-42.37Q575.25-340 600-340q24.75 0 42.38 17.63Q660-304.75 660-280q0 24.75-17.62 42.37Q624.75-220 600-220ZM360-420q-24.75 0-42.37-17.63Q300-455.25 300-480q0-24.75 17.63-42.37Q335.25-540 360-540q24.75 0 42.38 17.63Q420-504.75 420-480q0 24.75-17.62 42.37Q384.75-420 360-420Zm240 0q-24.75 0-42.37-17.63Q540-455.25 540-480q0-24.75 17.63-42.37Q575.25-540 600-540q24.75 0 42.38 17.63Q660-504.75 660-480q0 24.75-17.62 42.37Q624.75-420 600-420ZM360-620q-24.75 0-42.37-17.63Q300-655.25 300-680q0-24.75 17.63-42.37Q335.25-740 360-740q24.75 0 42.38 17.63Q420-704.75 420-680q0 24.75-17.62 42.37Q384.75-620 360-620Zm240 0q-24.75 0-42.37-17.63Q540-655.25 540-680q0-24.75 17.63-42.37Q575.25-740 600-740q24.75 0 42.38 17.63Q660-704.75 660-680q0 24.75-17.62 42.37Q624.75-620 600-620Z"></path></svg>';

  function createManageProfileIconButton(action, label, iconMarkup, extraClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = ((extraClass || '') + ' manage-profile-icon-button has-tooltip').trim();
    button.dataset.manageAction = action;
    button.dataset.tooltip = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = iconMarkup;
    return button;
  }

  function getManageProfileOrder() {
    return profiles.map(profile => profile.id).filter(Boolean);
  }

  function getManageProfileBucketsForOrder() {
    const groups = getSortedConnectionGroups();
    const bucketByGroupId = new Map(groups.map(group => [String(group && group.id || ''), { group, profiles: [] }]));
    const loose = [];

    for (const profile of profiles || []) {
      const groupId = String(profile && profile.groupId || '').trim();
      const bucket = groupId ? bucketByGroupId.get(groupId) : null;
      if (bucket) {
        bucket.profiles.push(profile);
      } else {
        loose.push(profile);
      }
    }

    return { grouped: groups.map(group => bucketByGroupId.get(String(group && group.id || ''))).filter(Boolean), loose };
  }

  function ensureManageProfileDropLine() {
    if (!manageProfilesList) return null;
    let line = manageProfilesList.querySelector('.manage-profiles-drop-line');
    if (!line) {
      line = document.createElement('div');
      line.className = 'manage-profiles-drop-line';
      line.setAttribute('aria-hidden', 'true');
      manageProfilesList.appendChild(line);
    }
    return line;
  }

  function hideManageProfileDropLine() {
    if (!manageProfilesList) return;
    const line = manageProfilesList.querySelector('.manage-profiles-drop-line');
    if (line) {
      line.style.display = 'none';
      line.style.top = '';
      line.style.left = '';
      line.style.right = '';
    }
  }

  function clearManageProfileDropIndicators() {
    if (!manageProfilesList) return;
    for (const row of Array.from(manageProfilesList.querySelectorAll('.manage-profile-row'))) {
      row.classList.remove('drag-over-before', 'drag-over-after');
    }
    for (const groupTarget of Array.from(manageProfilesList.querySelectorAll('.manage-profile-group-header, .manage-profile-group-body'))) {
      groupTarget.classList.remove('drag-over-group');
    }
    manageProfilesList.classList.remove('drag-over-loose');
    hideManageProfileDropLine();
  }

  function cancelManageProfileAutoExpand(options) {
    const restore = Boolean(options && options.restore);
    if (manageProfileAutoExpandTimer) {
      clearTimeout(manageProfileAutoExpandTimer);
      manageProfileAutoExpandTimer = 0;
    }
    manageProfileAutoExpandGroupId = '';

    const autoExpandedGroupId = String(manageProfileAutoExpandedGroupId || '').trim();
    manageProfileAutoExpandedGroupId = '';
    if (restore && autoExpandedGroupId && !collapsedConnectionGroupIds.has(autoExpandedGroupId)) {
      collapsedConnectionGroupIds.add(autoExpandedGroupId);
      renderManageProfilesList();
    }
  }

  function scheduleManageProfileAutoExpand(groupId) {
    const id = String(groupId || '').trim();
    if (!id || !isManageProfileReorderDragActive() || !collapsedConnectionGroupIds.has(id)) {
      if (manageProfileAutoExpandGroupId && manageProfileAutoExpandGroupId !== id) {
        cancelManageProfileAutoExpand({ restore: false });
      }
      return;
    }

    if (manageProfileAutoExpandGroupId === id && manageProfileAutoExpandTimer) {
      return;
    }

    cancelManageProfileAutoExpand({ restore: false });
    manageProfileAutoExpandGroupId = id;
    manageProfileAutoExpandTimer = window.setTimeout(() => {
      manageProfileAutoExpandTimer = 0;
      if (!isManageProfileReorderDragActive() || manageProfileAutoExpandGroupId !== id || !collapsedConnectionGroupIds.has(id)) {
        manageProfileAutoExpandGroupId = '';
        return;
      }
      collapsedConnectionGroupIds.delete(id);
      manageProfileAutoExpandedGroupId = id;
      manageProfileAutoExpandGroupId = '';
      renderManageProfilesList();
    }, 500);
  }

  function clearManageProfileDragState(options) {
    const keepAutoExpandedGroupId = String(options && options.keepAutoExpandedGroupId || '').trim();
    const restoreAutoExpanded = Boolean(manageProfileAutoExpandedGroupId && manageProfileAutoExpandedGroupId !== keepAutoExpandedGroupId);
    draggedManageProfileId = '';
    manageProfileDragOverId = '';
    manageProfileDragOverPosition = '';
    manageProfileDragOverGroupId = '';
    manageProfileDragOverLoose = false;
    manageProfileDragging = false;
    cancelManageProfileAutoExpand({ restore: restoreAutoExpanded });
    hideManageProfileDropLine();
    if (!manageProfilesList) return;
    for (const row of Array.from(manageProfilesList.querySelectorAll('.manage-profile-row'))) {
      row.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
    }
    for (const groupTarget of Array.from(manageProfilesList.querySelectorAll('.manage-profile-group-header, .manage-profile-group-body'))) {
      groupTarget.classList.remove('drag-over-group');
    }
    manageProfilesList.classList.remove('drag-over-loose');
  }

  function getManageProfileRows() {
    if (!manageProfilesList) return [];
    return Array.from(manageProfilesList.querySelectorAll('.manage-profile-row[data-profile-id]'));
  }

  function getManageProfileRowsForDropLine(row) {
    if (!row || !manageProfilesList) return [];
    const groupBody = row.closest('.manage-profile-group-body[data-group-id]');
    const rows = groupBody && manageProfilesList.contains(groupBody)
      ? getManageProfileGroupRows(groupBody)
      : getManageProfileLooseRows();
    return Array.from(rows || [])
      .filter(item => item && String(item.dataset && item.dataset.profileId || '') && String(item.dataset.profileId || '') !== draggedManageProfileId)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  function showManageProfileDropLineForRow(row, position) {
    if (!manageProfilesList || !row) return;
    const line = ensureManageProfileDropLine();
    if (!line) return;
    const listRect = manageProfilesList.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const lineHeight = Math.max(1, line.offsetHeight || 1);
    const rows = getManageProfileRowsForDropLine(row);
    const rowIndex = rows.indexOf(row);
    let topEdge = position === 'after' ? rowRect.bottom : rowRect.top;
    if (rowIndex >= 0) {
      if (position === 'before' && rowIndex > 0) {
        const previousRect = rows[rowIndex - 1].getBoundingClientRect();
        topEdge = previousRect.bottom + ((rowRect.top - previousRect.bottom) / 2);
      } else if (position === 'after' && rowIndex < rows.length - 1) {
        const nextRect = rows[rowIndex + 1].getBoundingClientRect();
        topEdge = rowRect.bottom + ((nextRect.top - rowRect.bottom) / 2);
      }
    }
    const top = topEdge - listRect.top + manageProfilesList.scrollTop - (lineHeight / 2);
    const left = Math.max(0, rowRect.left - listRect.left + manageProfilesList.scrollLeft);
    const right = Math.max(0, listRect.right - rowRect.right - manageProfilesList.scrollLeft);
    line.style.top = Math.max(0, top) + 'px';
    line.style.left = left + 'px';
    line.style.right = right + 'px';
    line.style.display = 'block';
  }

  function showManageProfileDropLineForElement(element, position) {
    if (!manageProfilesList || !element) return;
    const line = ensureManageProfileDropLine();
    if (!line) return;
    const listRect = manageProfilesList.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const lineHeight = Math.max(1, line.offsetHeight || 1);
    const top = (position === 'after' ? elementRect.bottom : elementRect.top) - listRect.top + manageProfilesList.scrollTop - Math.ceil(lineHeight / 2);
    const left = Math.max(0, elementRect.left - listRect.left + manageProfilesList.scrollLeft);
    const right = Math.max(0, listRect.right - elementRect.right - manageProfilesList.scrollLeft);
    line.style.top = Math.max(0, top) + 'px';
    line.style.left = left + 'px';
    line.style.right = right + 'px';
    line.style.display = 'block';
  }

  function showManageProfileDropLineInsideElement(element) {
    if (!manageProfilesList || !element) return;
    const line = ensureManageProfileDropLine();
    if (!line) return;
    const listRect = manageProfilesList.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const lineHeight = Math.max(1, line.offsetHeight || 1);
    const styles = window.getComputedStyle ? window.getComputedStyle(element) : null;
    const paddingLeft = styles ? parseFloat(styles.paddingLeft || '0') || 0 : 0;
    const paddingRight = styles ? parseFloat(styles.paddingRight || '0') || 0 : 0;
    const top = elementRect.top + elementRect.height / 2 - listRect.top + manageProfilesList.scrollTop - Math.ceil(lineHeight / 2);
    const left = Math.max(0, elementRect.left - listRect.left + manageProfilesList.scrollLeft + paddingLeft);
    const right = Math.max(0, listRect.right - elementRect.right - manageProfilesList.scrollLeft + paddingRight);
    line.style.top = Math.max(0, top) + 'px';
    line.style.left = left + 'px';
    line.style.right = right + 'px';
    line.style.display = 'block';
  }

  function showManageProfileDropLineForGroup(groupId) {
    if (!manageProfilesList) return;
    const id = String(groupId || '').trim();
    if (!id) return;
    const selectorId = id.replace(/"/g, '\"');
    const body = manageProfilesList.querySelector('.manage-profile-group-body[data-group-id="' + selectorId + '"]');
    if (body) {
      const rows = Array.from(body.querySelectorAll('.manage-profile-row[data-profile-id]')).filter(row => String(row.dataset.profileId || '') !== draggedManageProfileId);
      if (rows.length) {
        showManageProfileDropLineForRow(rows[rows.length - 1], 'after');
        return;
      }
      showManageProfileDropLineInsideElement(body);
      return;
    }
    const header = manageProfilesList.querySelector('.manage-profile-group-header[data-group-id="' + selectorId + '"]');
    if (header) showManageProfileDropLineForElement(header, 'after');
  }

  function showManageProfileDropLineAtLooseEnd() {
    if (!manageProfilesList) return;
    const looseRows = Array.from(manageProfilesList.querySelectorAll('.manage-profile-row[data-profile-id]')).filter(row => !String(row.dataset.profileGroupId || '').trim() && String(row.dataset.profileId || '') !== draggedManageProfileId);
    if (looseRows.length) {
      showManageProfileDropLineForRow(looseRows[looseRows.length - 1], 'after');
      return;
    }
    const children = Array.from(manageProfilesList.children).filter(child => !child.classList.contains('manage-profiles-drop-line'));
    const lastChild = children.length ? children[children.length - 1] : null;
    if (lastChild) showManageProfileDropLineForElement(lastChild, 'after');
  }

  function setManageProfileRowDropIndicator(row, position) {
    const profileId = row ? String(row.dataset.profileId || '') : '';
    if (!profileId || !position) return;
    if (manageProfileDragOverId === profileId && manageProfileDragOverPosition === position) {
      showManageProfileDropLineForRow(row, position);
      return;
    }
    clearManageProfileDropIndicators();
    manageProfileDragOverId = profileId;
    manageProfileDragOverPosition = position;
    manageProfileDragOverGroupId = '';
    manageProfileDragOverLoose = false;
    row.classList.add(position === 'after' ? 'drag-over-after' : 'drag-over-before');
    showManageProfileDropLineForRow(row, position);
  }

  function setManageProfileGroupDropIndicator(groupId) {
    const id = String(groupId || '').trim();
    if (!id || !manageProfilesList) return;
    if (manageProfileDragOverGroupId === id && !manageProfileDragOverId && !manageProfileDragOverLoose) {
      return;
    }
    clearManageProfileDropIndicators();
    manageProfileDragOverId = '';
    manageProfileDragOverPosition = '';
    manageProfileDragOverGroupId = id;
    manageProfileDragOverLoose = false;
    showManageProfileDropLineForGroup(id);
  }

  function setManageProfileLooseDropIndicator() {
    if (!manageProfilesList) return;
    if (manageProfileDragOverLoose && !manageProfileDragOverId && !manageProfileDragOverGroupId) return;
    clearManageProfileDropIndicators();
    manageProfileDragOverId = '';
    manageProfileDragOverPosition = '';
    manageProfileDragOverGroupId = '';
    manageProfileDragOverLoose = true;
    showManageProfileDropLineAtLooseEnd();
  }

  function getManageProfileOrderedRowDropTarget(event, rows) {
    const availableRows = Array.from(rows || [])
      .filter(row => row && String(row.dataset && row.dataset.profileId || '') && String(row.dataset.profileId || '') !== draggedManageProfileId)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

    if (!availableRows.length) return null;

    for (const row of availableRows) {
      const rect = row.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        return {
          type: 'profile',
          profileId: String(row.dataset.profileId || ''),
          groupId: String(row.dataset.profileGroupId || ''),
          position: 'before',
          row
        };
      }
    }

    const lastRow = availableRows[availableRows.length - 1];
    return {
      type: 'profile',
      profileId: String(lastRow.dataset.profileId || ''),
      groupId: String(lastRow.dataset.profileGroupId || ''),
      position: 'after',
      row: lastRow
    };
  }

  function getManageProfileGroupRows(groupBody) {
    if (!groupBody) return [];
    return Array.from(groupBody.querySelectorAll('.manage-profile-row[data-profile-id]'));
  }

  function getManageProfileLooseRows() {
    if (!manageProfilesList) return [];
    return Array.from(manageProfilesList.querySelectorAll('.manage-profile-row[data-profile-id]'))
      .filter(row => !String(row.dataset.profileGroupId || '').trim());
  }

  function getManageProfileDropTargetFromRow(event, row) {
    if (!row || !manageProfilesList || !manageProfilesList.contains(row)) return null;
    const groupBody = row.closest('.manage-profile-group-body[data-group-id]');
    if (groupBody && manageProfilesList.contains(groupBody)) {
      const groupTarget = getManageProfileDropTargetFromGroupBody(event, groupBody);
      if (groupTarget) return groupTarget;
    }
    return getManageProfileLooseDropTarget(event);
  }

  function getManageProfileDropTargetFromGroupBody(event, groupBody) {
    if (!groupBody || !manageProfilesList || !manageProfilesList.contains(groupBody)) return null;
    const groupId = String(groupBody.dataset.groupId || '');
    if (!groupId) return null;

    const rowTarget = getManageProfileOrderedRowDropTarget(event, getManageProfileGroupRows(groupBody));
    if (rowTarget) return rowTarget;

    return { type: 'group', groupId, position: 'append', element: groupBody };
  }

  function findManageProfileGroupBodyAtPoint(event) {
    if (!manageProfilesList) return null;
    const bodies = Array.from(manageProfilesList.querySelectorAll('.manage-profile-group-body[data-group-id]'));
    for (const body of bodies) {
      const rect = body.getBoundingClientRect();
      if (event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX >= rect.left - 12 && event.clientX <= rect.right + 12) {
        return body;
      }
    }
    return null;
  }

  function findManageProfileGroupHeaderAtPoint(event) {
    if (!manageProfilesList) return null;
    const headers = Array.from(manageProfilesList.querySelectorAll('.manage-profile-group-header[data-group-id]'));
    for (const header of headers) {
      const rect = header.getBoundingClientRect();
      if (event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX >= rect.left - 12 && event.clientX <= rect.right + 12) {
        return header;
      }
    }
    return null;
  }

  function getManageProfileLooseDropTarget(event) {
    const rowTarget = getManageProfileOrderedRowDropTarget(event, getManageProfileLooseRows());
    if (rowTarget) return rowTarget;
    return { type: 'loose', groupId: '', position: 'append' };
  }

  function isManageProfilePointInLooseZone(event) {
    if (!manageProfilesList) return false;
    const listRect = manageProfilesList.getBoundingClientRect();
    if (event.clientX < listRect.left - 12 || event.clientX > listRect.right + 12) return false;

    const looseRows = getManageProfileLooseRows();
    if (looseRows.length) {
      const firstRect = looseRows[0].getBoundingClientRect();
      return event.clientY >= firstRect.top - 8;
    }

    const children = Array.from(manageProfilesList.children).filter(child => !child.classList.contains('manage-profiles-drop-line'));
    const lastChild = children.length ? children[children.length - 1] : null;
    if (!lastChild) return false;
    const lastRect = lastChild.getBoundingClientRect();
    return event.clientY >= lastRect.bottom - 8;
  }

  function isManageProfileReorderDragActive() {
    return Boolean(manageProfilesDialogOpen && draggedManageProfileId && !String(manageProfilesFilterText || '').trim());
  }

  function getManageProfilesDialogRect() {
    const dialog = manageProfilesBackdrop ? manageProfilesBackdrop.querySelector('.manage-profiles-dialog') : null;
    return dialog ? dialog.getBoundingClientRect() : null;
  }

  function getManageProfileDropTarget(event) {
    if (!manageProfilesList) return null;

    const dialogRect = getManageProfilesDialogRect();
    if (dialogRect) {
      const horizontalPadding = 24;
      const verticalPadding = 8;
      const insideDialog = event.clientX >= dialogRect.left - horizontalPadding && event.clientX <= dialogRect.right + horizontalPadding && event.clientY >= dialogRect.top - verticalPadding && event.clientY <= dialogRect.bottom + verticalPadding;
      if (!insideDialog) return null;
    }

    const target = event.target && event.target.closest ? event.target : null;
    const row = target ? target.closest('.manage-profile-row[data-profile-id]') : null;
    if (row && manageProfilesList.contains(row)) {
      const rowTarget = getManageProfileDropTargetFromRow(event, row);
      if (rowTarget) return rowTarget;
    }

    const groupHeader = target ? target.closest('.manage-profile-group-header[data-group-id]') : null;
    if (groupHeader && manageProfilesList.contains(groupHeader)) {
      const groupId = String(groupHeader.dataset.groupId || '');
      if (groupId) {
        return { type: 'group', groupId, position: 'append', element: groupHeader };
      }
    }

    const groupBody = target ? target.closest('.manage-profile-group-body[data-group-id]') : null;
    if (groupBody && manageProfilesList.contains(groupBody)) {
      const groupBodyTarget = getManageProfileDropTargetFromGroupBody(event, groupBody);
      if (groupBodyTarget) return groupBodyTarget;
    }

    const pointGroupBody = findManageProfileGroupBodyAtPoint(event);
    if (pointGroupBody) {
      const groupBodyTarget = getManageProfileDropTargetFromGroupBody(event, pointGroupBody);
      if (groupBodyTarget) return groupBodyTarget;
    }

    const pointGroupHeader = findManageProfileGroupHeaderAtPoint(event);
    if (pointGroupHeader) {
      const groupId = String(pointGroupHeader.dataset.groupId || '');
      if (groupId) return { type: 'group', groupId, position: 'append', element: pointGroupHeader };
    }

    if (target && (target === manageProfilesList || manageProfilesList.contains(target)) && isManageProfilePointInLooseZone(event)) {
      return getManageProfileLooseDropTarget(event);
    }

    return null;
  }

  function handleManageProfilesDragOver(event) {
    if (!isManageProfileReorderDragActive()) return;
    const dropTarget = getManageProfileDropTarget(event);
    if (!dropTarget) {
      clearManageProfileDropIndicators();
      cancelManageProfileAutoExpand({ restore: false });
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    if (dropTarget.type === 'profile') {
      cancelManageProfileAutoExpand({ restore: false });
      setManageProfileRowDropIndicator(dropTarget.row, dropTarget.position);
      return;
    }

    if (dropTarget.type === 'group') {
      scheduleManageProfileAutoExpand(dropTarget.groupId);
      setManageProfileGroupDropIndicator(dropTarget.groupId);
      return;
    }

    cancelManageProfileAutoExpand({ restore: false });
    setManageProfileLooseDropIndicator();
  }

  function handleManageProfilesDrop(event) {
    if (!isManageProfileReorderDragActive()) {
      clearManageProfileDragState();
      return;
    }
    const dropTarget = getManageProfileDropTarget(event);
    event.preventDefault();
    const droppedProfileId = draggedManageProfileId;
    const keepAutoExpandedGroupId = dropTarget && dropTarget.groupId ? String(dropTarget.groupId || '') : '';
    clearManageProfileDragState({ keepAutoExpandedGroupId });
    if (!dropTarget) return;
    reorderManageProfiles(droppedProfileId, dropTarget);
  }

  function removeProfileFromManageBuckets(buckets, profileId) {
    for (const bucket of buckets.grouped) {
      const index = bucket.profiles.findIndex(profile => String(profile && profile.id || '') === profileId);
      if (index >= 0) {
        return bucket.profiles.splice(index, 1)[0];
      }
    }
    const looseIndex = buckets.loose.findIndex(profile => String(profile && profile.id || '') === profileId);
    if (looseIndex >= 0) {
      return buckets.loose.splice(looseIndex, 1)[0];
    }
    return null;
  }

  function getManageBucketForGroupId(buckets, groupId) {
    const id = String(groupId || '').trim();
    if (!id) return { profiles: buckets.loose, groupId: '' };
    const bucket = buckets.grouped.find(item => String(item && item.group && item.group.id || '') === id);
    return bucket ? { profiles: bucket.profiles, groupId: id } : { profiles: buckets.loose, groupId: '' };
  }

  function applyManageProfileGroup(profile, groupId) {
    const nextProfile = Object.assign({}, profile);
    const id = String(groupId || '').trim();
    if (id) {
      nextProfile.groupId = id;
    } else {
      delete nextProfile.groupId;
    }
    return nextProfile;
  }

  function flattenManageProfileBuckets(buckets) {
    const ordered = [];
    for (const bucket of buckets.grouped) {
      const groupId = String(bucket && bucket.group && bucket.group.id || '').trim();
      for (const profile of bucket.profiles) {
        ordered.push(applyManageProfileGroup(profile, groupId));
      }
    }
    for (const profile of buckets.loose) {
      ordered.push(applyManageProfileGroup(profile, ''));
    }
    return ordered;
  }

  function reorderManageProfiles(draggedId, dropTarget) {
    const profileId = String(draggedId || '').trim();
    if (!profileId || !dropTarget) return;

    const buckets = getManageProfileBucketsForOrder();
    const draggedProfile = removeProfileFromManageBuckets(buckets, profileId);
    if (!draggedProfile) return;

    const targetGroupId = String(dropTarget.groupId || '').trim();
    const targetBucket = getManageBucketForGroupId(buckets, targetGroupId);
    let insertIndex = targetBucket.profiles.length;

    if (dropTarget.type === 'profile' && dropTarget.profileId) {
      const targetIndex = targetBucket.profiles.findIndex(profile => String(profile && profile.id || '') === String(dropTarget.profileId || ''));
      if (targetIndex >= 0) {
        insertIndex = targetIndex + (dropTarget.position === 'after' ? 1 : 0);
      }
    } else if (dropTarget.position === 'start') {
      insertIndex = 0;
    }

    targetBucket.profiles.splice(Math.max(0, Math.min(insertIndex, targetBucket.profiles.length)), 0, applyManageProfileGroup(draggedProfile, targetBucket.groupId));

    const nextProfiles = flattenManageProfileBuckets(buckets);
    const orderedIds = nextProfiles.map(profile => profile.id).filter(Boolean);
    const groupsByProfileId = {};
    nextProfiles.forEach(profile => {
      if (profile && profile.id) groupsByProfileId[profile.id] = String(profile.groupId || '');
    });

    const currentIds = getManageProfileOrder();
    const currentGroupsById = new Map((profiles || []).map(profile => [profile.id, String(profile.groupId || '')]));
    const orderChanged = orderedIds.length !== currentIds.length || orderedIds.some((id, index) => id !== currentIds[index]);
    const groupChanged = nextProfiles.some(profile => String(profile.groupId || '') !== String(currentGroupsById.get(profile.id) || ''));
    if (!orderChanged && !groupChanged) {
      return;
    }

    profiles = nextProfiles;
    renderProfiles(selectedProfileId);
    vscode.postMessage({ type: 'reorderConnections', payload: { profileIds: orderedIds, groupsByProfileId, selectedId: selectedProfileId } });
  }

  function renderManageConnectionGroupHeader(group, count, forceExpanded) {
    const header = document.createElement('div');
    const groupId = String(group && group.id || '');
    const isCollapsed = !forceExpanded && collapsedConnectionGroupIds.has(groupId);
    const isRenamingGroup = renameGroupId === groupId;
    header.className = 'manage-profile-group-header' + (isCollapsed ? ' collapsed' : '') + (isRenamingGroup ? ' renaming' : '');
    header.dataset.groupId = groupId;

    if (isRenamingGroup) {
      const form = document.createElement('div');
      form.className = 'manage-profile-group-rename-form';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(group && group.name || '');
      input.setAttribute('aria-label', 'Group name');
      form.appendChild(input);

      const saveButton = createManageProfileIconButton('save-rename-group', 'Save', MANAGE_ICON_SAVE, '');
      form.appendChild(saveButton);

      const cancelButton = createManageProfileIconButton('cancel-rename-group', 'Cancel', MANAGE_ICON_CANCEL, 'secondary');
      form.appendChild(cancelButton);

      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          saveButton.click();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          renameGroupId = '';
          renderManageProfilesList();
        }
      });

      header.appendChild(form);
      setTimeout(() => { input.focus(); input.select(); }, 0);
      return header;
    }

    header.dataset.manageAction = 'toggle-group';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'manage-profile-group-toggle has-tooltip';
    toggle.dataset.manageAction = 'toggle-group';
    toggle.dataset.tooltip = isCollapsed ? 'Expand group' : 'Collapse group';
    toggle.setAttribute('aria-label', isCollapsed ? 'Expand group' : 'Collapse group');
    toggle.textContent = isCollapsed ? '▸' : '▾';
    header.appendChild(toggle);

    const name = document.createElement('div');
    name.className = 'manage-profile-group-name';
    name.textContent = String(group && group.name || 'Connections');
    header.appendChild(name);

    const description = document.createElement('div');
    description.className = 'manage-profile-group-count';
    description.textContent = String(count || 0);
    header.appendChild(description);

    const renameButton = createManageProfileIconButton('rename-group', 'Rename Group', MANAGE_ICON_RENAME, 'secondary');
    header.appendChild(renameButton);

    const deleteButton = createManageProfileIconButton('delete-group', 'Delete Group', MANAGE_ICON_DELETE, 'secondary');
    header.appendChild(deleteButton);

    return header;
  }

  function appendManageProfileRow(profile, canReorderProfiles, parentElement, isGroupedProfile) {
    const row = document.createElement('div');
    const isRenamingProfile = renameProfileId === profile.id;
    row.className = 'manage-profile-row' + (isGroupedProfile ? ' grouped' : '') + (isRenamingProfile ? ' renaming' : '') + (canReorderProfiles && !isRenamingProfile ? ' can-reorder' : '');
    row.dataset.profileId = profile.id;
    row.dataset.profileGroupId = profile.groupId || '';
    row.draggable = canReorderProfiles && !isRenamingProfile;

    if (isRenamingProfile) {
      const form = document.createElement('div');
      form.className = 'manage-profile-rename-form';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = profile.name || '';
      input.setAttribute('aria-label', 'Connection name');
      form.appendChild(input);

      const saveButton = createManageProfileIconButton('save-rename', 'Save', MANAGE_ICON_SAVE, '');
      form.appendChild(saveButton);

      const cancelButton = createManageProfileIconButton('cancel-rename', 'Cancel', MANAGE_ICON_CANCEL, 'secondary');
      form.appendChild(cancelButton);

      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          saveButton.click();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          renameProfileId = '';
          renderManageProfilesList();
        }
      });

      row.appendChild(form);
      (parentElement || manageProfilesList).appendChild(row);
      setTimeout(() => { input.focus(); input.select(); }, 0);
      return;
    }

    const dragHandle = document.createElement('span');
    dragHandle.className = 'manage-profile-drag-handle' + (canReorderProfiles ? '' : ' disabled');
    dragHandle.innerHTML = MANAGE_ICON_DRAG;
    dragHandle.setAttribute('aria-hidden', 'true');
    if (!canReorderProfiles) {
      dragHandle.setAttribute('data-tooltip', 'Clear the filter to reorder saved connections.');
    }
    row.appendChild(dragHandle);

    const main = document.createElement('div');
    main.className = 'manage-profile-main';

    const name = document.createElement('div');
    name.className = 'manage-profile-name';
    name.textContent = profile.name || 'Unnamed connection';
    main.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'manage-profile-meta';
    meta.textContent = formatProfileTarget(profile);
    main.appendChild(meta);

    row.appendChild(main);

    const renameButton = createManageProfileIconButton('rename', 'Rename', MANAGE_ICON_RENAME, 'secondary');
    row.appendChild(renameButton);

    const deleteButton = createManageProfileIconButton('delete', 'Delete', MANAGE_ICON_DELETE, 'secondary');
    row.appendChild(deleteButton);

    row.addEventListener('dragstart', event => {
      if (!canReorderProfiles) {
        event.preventDefault();
        return;
      }
      if (event.target && event.target.closest && event.target.closest('[data-manage-action], input, button')) {
        event.preventDefault();
        return;
      }
      draggedManageProfileId = profile.id || '';
      manageProfileDragOverId = '';
      manageProfileDragOverPosition = '';
      manageProfileDragging = true;
      hideWebviewTooltip();
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedManageProfileId);
      }
      row.classList.add('dragging');
    });

    row.addEventListener('dragover', event => {
      if (!canReorderProfiles || !draggedManageProfileId) return;
      handleManageProfilesDragOver(event);
    });

    row.addEventListener('dragleave', event => {
      if (draggedManageProfileId) return;
      const relatedTarget = event.relatedTarget;
      if (relatedTarget && row.contains(relatedTarget)) return;
      row.classList.remove('drag-over-before', 'drag-over-after');
    });

    row.addEventListener('drop', event => {
      if (!canReorderProfiles || !draggedManageProfileId) return;
      handleManageProfilesDrop(event);
    });

    row.addEventListener('dragend', clearManageProfileDragState);

    (parentElement || manageProfilesList).appendChild(row);
  }

  function renderManageProfilesList() {
    if (!manageProfilesList) return;

    updateManageProfileGroupActionState();
    manageProfilesList.innerHTML = '';

    const filterText = String(manageProfilesFilterText || '').trim();
    const hasFilter = Boolean(filterText);

    if (!profiles.length && !connectionGroups.length) {
      const empty = document.createElement('div');
      empty.className = 'manage-profiles-empty';
      empty.textContent = 'No saved connections.';
      manageProfilesList.appendChild(empty);
      return;
    }

    const filteredProfiles = profiles.filter(profile => profileMatchesFilter(profile, manageProfilesFilterText) || profile.id === renameProfileId);
    const hasMatchingGroup = hasFilter && getSortedConnectionGroups().some(group => groupMatchesFilter(group, manageProfilesFilterText));
    if (hasFilter && !filteredProfiles.length && !hasMatchingGroup) {
      const empty = document.createElement('div');
      empty.className = 'manage-profiles-empty';
      empty.textContent = 'No saved connections found.';
      manageProfilesList.appendChild(empty);
      return;
    }

    const canReorderProfiles = !hasFilter;
    const displayGroups = groupProfilesForDisplay(filteredProfiles, {
      includeEmptyGroups: true,
      groupFilter: manageProfilesFilterText
    });

    for (const bucket of displayGroups.grouped) {
      const groupId = String(bucket.group && bucket.group.id || '');
      const isCollapsed = !hasFilter && collapsedConnectionGroupIds.has(groupId);
      manageProfilesList.appendChild(renderManageConnectionGroupHeader(bucket.group, bucket.profiles.length, hasFilter));
      if (!isCollapsed) {
        const groupBody = document.createElement('div');
        groupBody.className = 'manage-profile-group-body' + (!bucket.profiles.length ? ' empty' : '');
        groupBody.dataset.groupId = groupId;
        manageProfilesList.appendChild(groupBody);
        for (const profile of bucket.profiles) {
          appendManageProfileRow(profile, canReorderProfiles, groupBody, true);
        }
        if (!bucket.profiles.length && canReorderProfiles) {
          const placeholder = document.createElement('div');
          placeholder.className = 'manage-profile-group-drop-placeholder';
          placeholder.textContent = manageProfileDragging ? 'Drop connection here' : '';
          groupBody.appendChild(placeholder);
        }
      }
    }

    for (const profile of displayGroups.loose) {
      appendManageProfileRow(profile, canReorderProfiles, manageProfilesList, false);
    }

    if (canReorderProfiles) {
      ensureManageProfileDropLine();
    }
  }

  function handleManageProfilesClick(event) {
    const actionTarget = event.target && event.target.closest ? event.target.closest('[data-manage-action]') : null;
    if (!actionTarget) return;

    const action = actionTarget.dataset.manageAction;
    const groupRow = actionTarget.closest('[data-group-id]');
    const groupId = groupRow ? groupRow.dataset.groupId || '' : '';
    const group = groupId ? connectionGroups.find(item => item.id === groupId) : null;

    if (action === 'toggle-group' && groupId) {
      if (collapsedConnectionGroupIds.has(groupId)) {
        collapsedConnectionGroupIds.delete(groupId);
      } else {
        collapsedConnectionGroupIds.add(groupId);
      }
      renderManageProfilesList();
      return;
    }

    if (action === 'rename-group' && group) {
      renameGroupId = groupId;
      renameProfileId = '';
      renderManageProfilesList();
      return;
    }

    if (action === 'cancel-rename-group') {
      renameGroupId = '';
      renderManageProfilesList();
      return;
    }

    if (action === 'save-rename-group' && group) {
      const input = groupRow ? groupRow.querySelector('input') : null;
      const name = input ? String(input.value || '').trim() : '';
      const nameError = getConnectionGroupNameError(name, groupId);
      if (nameError) {
        setStatus(nameError, true);
        if (input) {
          input.classList.add('connection-input-invalid');
          input.focus();
        }
        return;
      }

      renameGroupId = '';
      renderManageProfilesList();
      setBusy(true, 'Renaming connection group...');
      vscode.postMessage({ type: 'renameConnectionGroup', payload: { id: groupId, name, selectedId: selectedProfileId } });
      return;
    }

    if (action === 'delete-group' && group) {
      showManageGroupRemoveDialog(group);
      return;
    }

    const row = actionTarget.closest('[data-profile-id]');
    const profileId = row ? row.dataset.profileId || '' : '';
    const profile = profiles.find(item => item.id === profileId);

    if (!profileId || !profile) return;
    if (action === 'rename') {
      renameProfileId = profileId;
      renderManageProfilesList();
      return;
    }

    if (action === 'cancel-rename') {
      renameProfileId = '';
      renderManageProfilesList();
      return;
    }

    if (action === 'save-rename') {
      const input = row.querySelector('input');
      const name = input ? String(input.value || '').trim() : '';
      const nameError = getConnectionNameError(name, profileId);
      if (nameError) {
        setStatus(nameError, true);
        if (input) {
          input.classList.add('connection-input-invalid');
          input.focus();
        }
        return;
      }

      renameProfileId = '';
      renderManageProfilesList();
      setBusy(true, 'Renaming saved connection...');
      vscode.postMessage({ type: 'renameConnection', payload: { id: profileId, name } });
      return;
    }

    if (action === 'delete') {
      vscode.postMessage({ type: 'deleteConnection', payload: { id: profileId, name: profile.name || '' } });
    }
  }



  function readRemoteCommandCollection(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const map = new Map();
      if (parsed && typeof parsed === 'object') {
        for (const key of Object.keys(parsed)) {
          map.set(key, Array.isArray(parsed[key]) ? parsed[key] : []);
        }
      }
      return map;
    } catch (_) {
      return new Map();
    }
  }

  function persistRemoteCommandCollection(storageKey, map) {
    try {
      const raw = {};
      for (const [key, value] of map.entries()) {
        raw[key] = Array.isArray(value) ? value : [];
      }
      localStorage.setItem(storageKey, JSON.stringify(raw));
    } catch (_) {
      // Ignore localStorage failures.
    }
  }

  function mapToStorageObject(map) {
    const raw = {};
    if (!map || typeof map.entries !== 'function') return raw;
    for (const [key, value] of map.entries()) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) continue;
      raw[normalizedKey] = Array.isArray(value) ? value : [];
    }
    return raw;
  }

  function normalizePersistentStorageObject(value) {
    const normalized = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return normalized;
    Object.keys(value).forEach(key => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey || !Array.isArray(value[key])) return;
      normalized[normalizedKey] = value[key].filter(item => item && typeof item === 'object');
    });
    return normalized;
  }

  function objectToMap(value) {
    const normalized = normalizePersistentStorageObject(value);
    const map = new Map();
    Object.keys(normalized).forEach(key => {
      map.set(key, normalized[key]);
    });
    return map;
  }

  function collectPersistentStorageSnapshot() {
    return {
      savedCommands: mapToStorageObject(remoteCommandSavedByConnectionId),
      serverLogShortcuts: readServerLogShortcutsStorage(),
      portForwards: loadAllServerPortForwardsFromStorage()
    };
  }

  function postPersistentStorageSnapshot() {
    if (persistentStorageApplyingSnapshot) return;
    vscode.postMessage({
      type: 'syncPersistentStorage',
      payload: { snapshot: collectPersistentStorageSnapshot() }
    });
  }

  function applyPersistentStorageSnapshot(snapshot) {
    persistentStorageApplyingSnapshot = true;
    try {
      const savedCommands = normalizePersistentStorageObject(snapshot && snapshot.savedCommands);
      remoteCommandSavedByConnectionId.clear();
      objectToMap(savedCommands).forEach((value, key) => remoteCommandSavedByConnectionId.set(key, value));
      persistRemoteCommandCollection(REMOTE_COMMAND_STORAGE_KEY, remoteCommandSavedByConnectionId);

      const serverLogShortcuts = normalizePersistentStorageObject(snapshot && snapshot.serverLogShortcuts);
      writeServerLogShortcutsStorage(serverLogShortcuts);
      serverLogShortcutsSessionByConnectionId.clear();

      const portForwards = normalizePersistentStorageObject(snapshot && snapshot.portForwards);
      saveAllServerPortForwardsToStorage(portForwards);
      serverPortForwardsSessionByConnectionId.clear();
    } finally {
      persistentStorageApplyingSnapshot = false;
    }

    renderRemoteCommandSavedList();
    renderServerView();
  }

  function hydrateRemoteCommandStorage() {
    if (!remoteCommandSavedByConnectionId.size) {
      for (const [key, value] of readRemoteCommandCollection(REMOTE_COMMAND_STORAGE_KEY).entries()) {
        remoteCommandSavedByConnectionId.set(key, value);
      }
    }
    if (!remoteCommandHistoryByConnectionId.size) {
      for (const [key, value] of readRemoteCommandCollection(REMOTE_COMMAND_HISTORY_STORAGE_KEY).entries()) {
        remoteCommandHistoryByConnectionId.set(key, value);
      }
    }
  }

  function persistRemoteCommandSaved() {
    persistRemoteCommandCollection(REMOTE_COMMAND_STORAGE_KEY, remoteCommandSavedByConnectionId);
    postPersistentStorageSnapshot();
  }

  function persistRemoteCommandHistory() {
    persistRemoteCommandCollection(REMOTE_COMMAND_HISTORY_STORAGE_KEY, remoteCommandHistoryByConnectionId);
  }

  hydrateRemoteCommandStorage();

  function createRemoteCommandSession(connectionId) {
    return {
      connectionId: String(connectionId || ''),
      status: 'idle',
      commandId: '',
      command: '',
      workingDirectory: normalizeUiRemotePath(currentPath.value || '/'),
      useSudo: false,
      outputText: '',
      finalMessage: '',
      outputViewLimited: false,
      stopping: false,
      forceKilling: false,
      exitCode: undefined,
      error: '',
      startedAt: 0,
      finishedAt: 0,
      finishedBadgeVisible: false,
      commandCount: 0,
      failedCommandCount: 0
    };
  }

  function getRemoteCommandSession(connectionId) {
    const key = String(connectionId || activeConnectionId || '');
    if (!key) return createRemoteCommandSession('');
    let session = remoteCommandSessionsByConnectionId.get(key);
    if (!session) {
      session = createRemoteCommandSession(key);
      remoteCommandSessionsByConnectionId.set(key, session);
    }
    return session;
  }

  function findRemoteCommandSessionByCommandId(commandId) {
    const id = String(commandId || '');
    if (!id) return null;
    for (const session of remoteCommandSessionsByConnectionId.values()) {
      if (session.commandId === id) return session;
    }
    return null;
  }

  function getCurrentRemoteCommandSession() {
    return getRemoteCommandSession(remoteCommandDialogConnectionId || activeConnectionId);
  }

  function getRemoteCommandSavedList(connectionId) {
    const key = String(connectionId || activeConnectionId || '');
    if (!key) return [];
    if (!remoteCommandSavedByConnectionId.has(key)) remoteCommandSavedByConnectionId.set(key, []);
    return remoteCommandSavedByConnectionId.get(key);
  }

  function getRemoteCommandHistoryList(connectionId) {
    const key = String(connectionId || activeConnectionId || '');
    if (!key) return [];
    if (!remoteCommandHistoryByConnectionId.has(key)) remoteCommandHistoryByConnectionId.set(key, []);
    return remoteCommandHistoryByConnectionId.get(key);
  }

  function updateRemoteCommandConnectedTo() {
    if (!remoteCommandConnectedTo) return;

    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const active = sessions.find(item => item.id === connectionId) || getActiveSession();
    const hostValue = active ? String(active.host || '').trim() : String(host.value || '').trim();
    remoteCommandConnectedTo.textContent = hostValue || '-';
    if (hostValue) remoteCommandConnectedTo.setAttribute('data-tooltip', hostValue); else remoteCommandConnectedTo.removeAttribute('data-tooltip');
  }

  function updateRemoteCommandRunAs() {
    if (!remoteCommandRunAs) return;

    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const active = sessions.find(item => item.id === connectionId) || getActiveSession();
    const capabilities = getRemoteCapabilitiesForSession(active);
    const canUseSudo = Boolean(capabilities.canUseSudo);
    const username = active ? String(active.username || '').trim() : '';
    const isRootConnection = canUseSudo && username.toLowerCase() === 'root';
    const connectionSudoEnabled = Boolean(canUseSudo && active && active.sudoModeEnabled && !isRootConnection);
    const state = getRemoteCommandSession(connectionId);
    const useSudo = Boolean(canUseSudo && (connectionSudoEnabled || (state.useSudo && !isRootConnection)));

    if (!canUseSudo) state.useSudo = false;

    remoteCommandRunAs.textContent = useSudo
      ? 'root via sudo'
      : isRootConnection
        ? 'root'
        : (username || 'SSH user');
    remoteCommandRunAs.classList.toggle('sudo', useSudo);

    if (remoteCommandSudoRow) {
      remoteCommandSudoRow.classList.toggle('hidden', !canUseSudo);
    }
    if (remoteCommandUseSudo) {
      remoteCommandUseSudo.checked = useSudo;
      remoteCommandUseSudo.disabled = !canUseSudo || connectionSudoEnabled || state.status === 'running';
    }
    if (remoteCommandSudoNote) {
      remoteCommandSudoNote.textContent = canUseSudo && connectionSudoEnabled ? 'Enabled by connection Sudo Mode' : '';
    }
  }

  function syncRemoteCommandRunButtonMinWidth() {
    if (!remoteCommandRunButton || !remoteCommandCloseButton || !remoteCommandBackdrop) return;
    const closeWidth = Math.ceil(remoteCommandCloseButton.getBoundingClientRect().width || 0);
    if (closeWidth > 0) {
      remoteCommandRunButton.style.setProperty('--remote-command-close-button-width', closeWidth + 'px');
    }
  }

  function showRemoteCommandDialog(workingDirectory) {
    if (!activeConnectionId || !getActiveRemoteCapabilities().canRunCommand) return;

    remoteCommandDialogOpen = true;
    remoteCommandDialogConnectionId = activeConnectionId;
    remoteCommandEditingSavedId = '';
    hideRemoteCommandWorkingDirectoryPicker();
    clearRemoteCommandStopEscalationTimer();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');

    const state = getCurrentRemoteCommandSession();
    if (state.status === 'idle') {
      state.workingDirectory = normalizeUiRemotePath(workingDirectory || currentPath.value || state.workingDirectory || '/');
    } else if (workingDirectory && state.status !== 'running') {
      state.workingDirectory = normalizeUiRemotePath(workingDirectory);
    }

    updateRemoteCommandConnectedTo();
    renderRemoteCommandSession();
    remoteCommandBackdrop.classList.add('visible');
    remoteCommandBackdrop.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(syncRemoteCommandRunButtonMinWidth);
    setTimeout(() => {
      if (state.status === 'running') {
        remoteCommandRunButton.focus();
      } else {
        remoteCommandInput.focus();
      }
    }, 0);
  }

  function attemptCloseRemoteCommandDialog() {
    if (!remoteCommandDialogOpen) return;
    hideRemoteCommandDialog();
  }

  function hideRemoteCommandDialog() {
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running' && state.finishedBadgeVisible) {
      state.finishedBadgeVisible = false;
    }
    remoteCommandDialogOpen = false;
    remoteCommandEditingSavedId = '';
    hideRemoteCommandWorkingDirectoryPicker();
    clearRemoteCommandStopEscalationTimer();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');
    remoteCommandBackdrop.classList.remove('visible');
    remoteCommandBackdrop.setAttribute('aria-hidden', 'true');
    renderRemoteCommandBadge();
  }

  function collectRemoteCommandUseSudo() {
    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const active = sessions.find(item => item.id === connectionId) || getActiveSession();
    const capabilities = getRemoteCapabilitiesForSession(active);
    if (!capabilities.canUseSudo) return false;
    const username = active ? String(active.username || '').trim() : '';
    const isRootConnection = username.toLowerCase() === 'root';
    if (isRootConnection) return false;
    if (active && active.sudoModeEnabled) return true;
    return Boolean(remoteCommandUseSudo && remoteCommandUseSudo.checked);
  }

  function runRemoteCommandFromDialog() {
    const state = getCurrentRemoteCommandSession();
    if (state.status === 'running') return;

    if (!getActiveRemoteCapabilities().canRunCommand) {
      setRemoteCommandStatus('Run Remote Command is available only for SFTP connections.', true);
      return;
    }

    const command = String(remoteCommandInput.value || '').trim();
    const workingDirectory = normalizeUiRemotePath(remoteCommandWorkingDirectory.value || currentPath.value || '/');

    if (!command) {
      setRemoteCommandStatus('Enter a command to run.', true);
      remoteCommandInput.focus();
      return;
    }

    state.commandId = Date.now() + '-' + Math.random().toString(36).slice(2);
    state.status = 'running';
    state.command = command;
    state.workingDirectory = workingDirectory;
    state.useSudo = collectRemoteCommandUseSudo();
    state.outputText = '';
    state.finalMessage = '';
    state.outputViewLimited = false;
    state.stopping = false;
    state.forceKilling = false;
    state.exitCode = undefined;
    state.error = '';
    state.startedAt = Date.now();
    state.finishedAt = 0;
    state.finishedBadgeVisible = false;
    state.commandCount = 0;
    state.failedCommandCount = 0;
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');
    renderRemoteCommandSession();
    renderServerViewIfActiveRemoteCommandConnection(state.connectionId);
    scrollRemoteCommandOutputToBottom();

    vscode.postMessage({
      type: 'requestRunRemoteCommand',
      payload: {
        commandId: state.commandId,
        connectionId: state.connectionId,
        workingDirectory,
        command,
        useSudo: state.useSudo
      }
    });
  }

  function stopRemoteCommandFromDialog() {
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running' || !state.commandId) return;

    state.stopping = true;
    state.forceKilling = false;
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');
    setRemoteCommandStatus('Stopping...');
    updateRemoteCommandControls();
    vscode.postMessage({ type: 'stopRemoteCommand', payload: { commandId: state.commandId, connectionId: state.connectionId } });
    startRemoteCommandStopEscalationTimer();
  }

  function forceKillRemoteCommandFromDialog() {
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running' || !state.commandId) return;

    state.forceKilling = true;
    remoteCommandStopWarning.classList.remove('visible');
    setRemoteCommandStatus('Force killing...');
    updateRemoteCommandControls();
    vscode.postMessage({ type: 'stopRemoteCommand', payload: { commandId: state.commandId, connectionId: state.connectionId, force: true } });
  }

  function startRemoteCommandStopEscalationTimer() {
    clearRemoteCommandStopEscalationTimer();
    remoteCommandStopEscalationTimer = setTimeout(() => {
      remoteCommandStopEscalationTimer = null;
      const state = getCurrentRemoteCommandSession();
      if (state.status !== 'running' || !state.stopping) return;
      remoteCommandStopWarning.classList.add('visible');
      setRemoteCommandStatus('Still stopping...');
      setTimeout(() => remoteCommandForceKillButton.focus(), 0);
    }, REMOTE_COMMAND_STOP_ESCALATION_MS);
  }

  function clearRemoteCommandStopEscalationTimer() {
    if (remoteCommandStopEscalationTimer) {
      clearTimeout(remoteCommandStopEscalationTimer);
      remoteCommandStopEscalationTimer = null;
    }
  }

  function clearRemoteCommandOutput() {
    const state = getCurrentRemoteCommandSession();
    if (state.status === 'running') return;
    state.outputText = '';
    state.finalMessage = '';
    state.error = '';
    state.status = 'idle';
    state.finishedBadgeVisible = false;
    setRemoteCommandOutputText('');
    setRemoteCommandStatus('');
    renderRemoteCommandBadge();
    updateRemoteCommandControls();
  }

  function handleRemoteCommandStarted(payload) {
    if (!payload) return;
    const state = findRemoteCommandSessionByCommandId(payload.commandId) || getRemoteCommandSession(payload.connectionId || activeConnectionId);
    state.commandId = payload.commandId || state.commandId;
    state.connectionId = payload.connectionId || state.connectionId;
    state.status = 'running';
    state.command = payload.command || state.command;
    state.workingDirectory = normalizeUiRemotePath(payload.workingDirectory || state.workingDirectory || '/');
    state.useSudo = Boolean(payload.useSudo);
    state.stopping = false;
    state.forceKilling = false;
    clearRemoteCommandStopEscalationTimer();
    remoteCommandStopWarning.classList.remove('visible');
    if (remoteCommandDialogOpen && state.connectionId === remoteCommandDialogConnectionId) {
      renderRemoteCommandSession();
      setRemoteCommandStatus('Running...');
    }
    renderRemoteCommandBadge();
    renderServerViewIfActiveRemoteCommandConnection(state.connectionId);
  }

  function handleRemoteCommandOutput(payload) {
    if (!payload) return;
    const state = findRemoteCommandSessionByCommandId(payload.commandId);
    if (!state) return;

    const wasNearBottom = remoteCommandDialogOpen && state.connectionId === remoteCommandDialogConnectionId && isRemoteCommandOutputNearBottom();
    if (payload.kind === 'command') {
      appendRemoteCommandCommand(String(payload.text || ''), state);
    } else if (payload.kind === 'commandStatus') {
      appendRemoteCommandCommandStatus(Number(payload.code || 0), state);
    } else {
      appendRemoteCommandOutput(String(payload.text || ''), state);
    }

    if (remoteCommandDialogOpen && state.connectionId === remoteCommandDialogConnectionId) {
      renderRemoteCommandOutputText(state);
      updateRemoteCommandOutputNotice(state);
      updateRemoteCommandCopyButton();
      if (wasNearBottom) scrollRemoteCommandOutputToBottom();
    }
  }

  function handleRemoteCommandFinished(payload) {
    if (!payload) return;
    const state = findRemoteCommandSessionByCommandId(payload.commandId) || getRemoteCommandSession(payload.connectionId || remoteCommandDialogConnectionId || activeConnectionId);
    if (payload.commandId && state.commandId !== payload.commandId) return;

    state.status = 'finished';
    state.stopping = false;
    state.forceKilling = false;
    state.finishedAt = Date.now();
    state.finishedBadgeVisible = true;
    state.exitCode = typeof payload.code === 'number' ? payload.code : undefined;
    state.commandCount = Number(payload.commandCount || 0);
    state.failedCommandCount = Number(payload.failedCommandCount || 0);
    state.error = String(payload.error || '');
    clearRemoteCommandStopEscalationTimer();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');

    if (payload.stopped) {
      state.finalMessage = payload.forceKilled ? 'Force killed by user.' : 'Stopped by user.';
      appendRemoteCommandSystemLine(state.finalMessage, state);
    } else if (payload.error) {
      state.finalMessage = 'Error: ' + String(payload.error || 'Remote command failed.');
      appendRemoteCommandSystemLine(state.finalMessage, state);
    } else if (typeof payload.code === 'number' && payload.signal) {
      state.finalMessage = 'Command exited with code ' + payload.code + ' and signal ' + payload.signal + '.';
      appendRemoteCommandSystemLine(state.finalMessage, state);
    } else {
      state.finalMessage = '';
    }

    addRemoteCommandHistoryItem(state);

    if (remoteCommandDialogOpen && state.connectionId === remoteCommandDialogConnectionId) {
      renderRemoteCommandSession();
      if (payload.stopped) {
        setRemoteCommandStatus(state.finalMessage);
      } else if (payload.error) {
        setRemoteCommandStatus(String(payload.error || 'Remote command failed.'), true);
      } else {
        const failedCount = Number(payload.failedCommandCount || 0);
        setRemoteCommandStatus(failedCount > 0 ? (failedCount + ' command' + (failedCount === 1 ? '' : 's') + ' failed.') : 'Finished.');
      }
      setTimeout(() => {
        remoteCommandInput.focus();
        remoteCommandInput.select();
      }, 0);
    }
    renderRemoteCommandBadge();
    renderRemoteCommandHistoryList();
    renderServerViewIfActiveRemoteCommandConnection(state.connectionId);
  }

  function formatRemoteCommandPrompt(command) {
    return '$ ' + String(command || '').trim() + '\\n';
  }

  function appendRemoteCommandCommand(command, state) {
    const target = state || getCurrentRemoteCommandSession();
    const current = target.outputText || '';
    const prefix = current && !current.endsWith('\\n') ? '\\n' : '';
    setRemoteCommandOutputText(current + prefix + formatRemoteCommandPrompt(command), target);
  }

  function appendRemoteCommandCommandStatus(code, state) {
    const target = state || getCurrentRemoteCommandSession();
    const current = target.outputText || '';
    const prefix = current && !current.endsWith('\\n') ? '\\n' : '';
    setRemoteCommandOutputText(current + prefix + '[Command finished with exit code ' + code + ']\\n', target);
  }

  function appendRemoteCommandSystemLine(message, state) {
    const target = state || getCurrentRemoteCommandSession();
    const current = target.outputText || '';
    const prefix = current && !current.endsWith('\\n') ? '\\n' : '';
    setRemoteCommandOutputText(current + prefix + '[' + String(message || '') + ']\\n', target);
  }

  function appendRemoteCommandOutput(text, state) {
    if (!text) return;
    const target = state || getCurrentRemoteCommandSession();
    setRemoteCommandOutputText((target.outputText || '') + text, target);
  }

  function setRemoteCommandOutputText(text, state) {
    const target = state || getCurrentRemoteCommandSession();
    target.outputText = String(text || '');
    target.outputViewLimited = target.outputText.length > REMOTE_COMMAND_MAX_OUTPUT_CHARS;

    if (target.outputViewLimited) {
      target.outputText = target.outputText.slice(-REMOTE_COMMAND_MAX_OUTPUT_CHARS);
    }

    if (remoteCommandDialogOpen && target.connectionId === remoteCommandDialogConnectionId) {
      renderRemoteCommandOutputText(target);
      updateRemoteCommandOutputNotice(target);
      updateRemoteCommandCopyButton();
    }
  }

  function getRemoteCommandOutputTextForDisplay(state) {
    const target = state || getCurrentRemoteCommandSession();
    const output = String(target.outputText || '');
    const finalMessage = String(target.finalMessage || '').trim();
    if (!finalMessage || output.includes(finalMessage)) return output;
    const separator = output && !output.endsWith('\\n') ? '\\n' : '';
    return output + separator + '[' + finalMessage + ']\\n';
  }

  function renderRemoteCommandOutputText(state) {
    const target = state || getCurrentRemoteCommandSession();
    remoteCommandOutput.innerHTML = renderRemoteCommandOutput(getRemoteCommandOutputTextForDisplay(target));
  }

  function renderRemoteCommandOutput(text) {
    const escaped = escapeHtml(String(text || ''));
    return escaped
      .split('\\n')
      .map(line => {
        if (!line) return '';
        const value = line.replace(/&amp;/g, '&');
        if (value.startsWith('$ ')) {
          return '<span class="remote-command-output-command">' + line + '</span>';
        }
        const remoteCommandSystemMessage = value === 'Stopped by user.'
          || value === 'Force killed by user.'
          || value.startsWith('[Command stopped by user.')
          || value.startsWith('[Command finished with exit code ')
          || value.startsWith('[Command exited with code ')
          || value.startsWith('[Error: ');
        if (remoteCommandSystemMessage) {
          return '<span class="remote-command-output-system">' + line + '</span>';
        }
        return line;
      })
      .join('\\n');
  }

  function selectRemoteCommandOutputText() {
    if (!remoteCommandOutput) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(remoteCommandOutput);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function getRemoteCommandOutputCopyText() {
    const state = getCurrentRemoteCommandSession();
    const output = getRemoteCommandOutputTextForDisplay(state).trim();
    const statusText = remoteCommandStatus ? String(remoteCommandStatus.textContent || '').trim() : '';
    if (!output) return statusText;
    return statusText ? output + '\\n' + statusText : output;
  }

  function copyRemoteCommandOutput() {
    const text = getRemoteCommandOutputCopyText();
    if (!text) return;
    vscode.postMessage({ type: 'copyStatus', payload: { text, message: 'Remote command output copied.' } });
  }

  function updateRemoteCommandCopyButton() {
    if (!remoteCommandCopyButton) return;
    remoteCommandCopyButton.disabled = !getRemoteCommandOutputCopyText();
  }

  function updateRemoteCommandOutputNotice(state) {
    const target = state || getCurrentRemoteCommandSession();
    remoteCommandOutputNotice.textContent = target.outputViewLimited ? 'Showing latest output only.' : '';
  }

  function setRemoteCommandStatus(message, isError) {
    remoteCommandStatus.textContent = message || '';
    remoteCommandStatus.classList.toggle('error', Boolean(isError));
    updateRemoteCommandCopyButton();
  }

  function renderRemoteCommandSession() {
    const state = getCurrentRemoteCommandSession();
    updateRemoteCommandConnectedTo();
    if (remoteCommandWorkingDirectory) remoteCommandWorkingDirectory.value = normalizeUiRemotePath(state.workingDirectory || currentPath.value || '/');
    if (remoteCommandInput) remoteCommandInput.value = state.command || '';
    renderRemoteCommandOutputText(state);
    updateRemoteCommandOutputNotice(state);
    updateRemoteCommandRunAs();
    renderRemoteCommandSavedList();
    renderRemoteCommandHistoryList();
    updateRemoteCommandControls();
    const status = state.status === 'running'
      ? (state.stopping ? 'Stopping...' : 'Running...')
      : state.status === 'finished'
        ? (state.error ? state.error : (typeof state.exitCode === 'number' ? 'Finished with exit code ' + state.exitCode : 'Finished.'))
        : 'Ready';
    setRemoteCommandStatus(status, state.status === 'finished' && Boolean(state.error));
    renderRemoteCommandBadge();
  }

  function updateRemoteCommandControls() {
    const state = getCurrentRemoteCommandSession();
    const running = state.status === 'running';
    if (remoteCommandInput) remoteCommandInput.disabled = running;
    if (remoteCommandWorkingDirectory) remoteCommandWorkingDirectory.disabled = running;
    if (remoteCommandBrowseWorkingDirectoryButton) remoteCommandBrowseWorkingDirectoryButton.disabled = running;

    if (running) {
      remoteCommandRunButton.textContent = state.stopping ? 'Stopping…' : 'Stop';
      remoteCommandRunButton.classList.add('secondary');
      remoteCommandRunButton.disabled = state.stopping;
    } else {
      remoteCommandRunButton.textContent = 'Run';
      remoteCommandRunButton.classList.remove('secondary');
      remoteCommandRunButton.disabled = !activeConnectionId || !getActiveRemoteCapabilities().canRunCommand;
    }

    if (remoteCommandSaveCurrentButton) {
      remoteCommandSaveCurrentButton.disabled = running || !String(remoteCommandInput.value || '').trim();
    }
    remoteCommandForceKillButton.disabled = !running || !state.stopping || state.forceKilling;
    remoteCommandClearButton.disabled = running || !(state.outputText || state.finalMessage || state.error || state.status === 'finished');
    updateRemoteCommandRunAs();
    updateRemoteCommandCopyButton();
  }

  function isRemoteCommandOutputNearBottom() {
    return remoteCommandOutputWrap.scrollTop + remoteCommandOutputWrap.clientHeight >= remoteCommandOutputWrap.scrollHeight - 24;
  }
`;
}
