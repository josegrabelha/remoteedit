export function renderEventBindings(): string {
  return `    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  window.addEventListener('message', event => {
    const message = event.data;
    const payload = message.payload || {};

    switch (message.type) {
      case 'profilesLoaded':
        profiles = payload.profiles || [];
        connectionGroups = payload.connectionGroups || [];
        renderProfiles(Object.prototype.hasOwnProperty.call(payload, 'selectedId') ? payload.selectedId : selectedProfileId);
        updatePathFavoriteControls();
        if (pathFavoritesOpen) renderPathFavoritesPopover();
        break;
      case 'connectionFormCleared':
        selectProfile('', { preserveStatus: true });
        break;
      case 'showImportConnectionsSettingsDialog':
        showImportBackupDialog(payload.summary || {});
        break;
      case 'persistentStorageSnapshot':
        applyPersistentStorageSnapshot(payload || {});
        break;
      case 'remotePathBreadcrumbSettingsChanged':
        showRemotePathBreadcrumbDirectoryDetails = payload.showDirectoryDetails !== false;
        refreshOpenRemotePathDropdown();
        break;
      case 'fileListSettingsChanged':
        openFileListItemsOnNameClick = payload.openOnNameClick !== false;
        permissionsDisplayMode = normalizePermissionsDisplayMode(payload.permissionsDisplay);
        updateFileListNameClickOpenState();
        renderEntries(getVisibleEntries());
        break;
      case 'hideExportConnectionsSettingsDialog':
        hideExportBackupDialog();
        break;
      case 'hideImportConnectionsSettingsDialog':
        hideImportBackupDialog();
        break;
      case 'exportConnectionsSettingsValidationError':
        exportBackupValidation.textContent = '';
        showBackupResult(exportBackupResult, payload.message || 'Export failed.', true);
        break;
      case 'importConnectionsSettingsValidationError':
        importBackupValidation.textContent = '';
        showBackupResult(importBackupResult, payload.message || 'Import failed.', true);
        break;
      case 'backupOperationResult':
        if (payload.operation === 'export') {
          showBackupResult(exportBackupResult, payload.message || '', Boolean(payload.isError));
        } else if (payload.operation === 'import') {
          showBackupResult(importBackupResult, payload.message || '', Boolean(payload.isError));
        } else {
          showManageProfilesFeedback(payload.message || '', Boolean(payload.isError));
        }
        break;
      case 'privateKeyPathSelected':
        if (payload.path) {
          privateKeyPath.value = payload.path;
          clearConnectionFieldInvalid(privateKeyPath);
          setControls();
        }
        break;
      case 'caCertificatePathSelected':
        if (payload.path) {
          ftpsCaCertificatePath.value = payload.path;
          clearConnectionFieldInvalid(ftpsCaCertificatePath);
          setControls();
        }
        break;
      case 'remoteClipboardChanged':
        remoteClipboardState = {
          hasItems: Boolean(payload.hasItems),
          operation: payload.operation || '',
          connectionId: payload.connectionId || '',
          protocol: payload.protocol || '',
          connectionLabel: payload.connectionLabel || '',
          itemCount: Number(payload.itemCount || 0),
          itemNames: Array.isArray(payload.itemNames) ? payload.itemNames : [],
          sourceItems: Array.isArray(payload.sourceItems) ? payload.sourceItems : [],
          sourceParentDirectories: Array.isArray(payload.sourceParentDirectories) ? payload.sourceParentDirectories : [],
          canPaste: Boolean(payload.canPaste)
        };
        break;
      case 'sessionsChanged': {
        const previousSessionIds = new Set(sessions.map(session => session.id));
        const incomingSessions = payload.sessions || [];
        const incomingSessionIds = new Set(incomingSessions.map(session => session.id));
        for (const incomingSession of incomingSessions) {
          if (isSessionConnected(incomingSession)) {
            clientPendingSessionsByConnectionId.delete(incomingSession.id);
          }
        }
        sessions = mergeIncomingSessionsWithClientPending(incomingSessions);
        const activeSessionIds = new Set(sessions.map(session => session.id));
        Array.from(profileDisconnectingIds).forEach(connectionId => {
          if (!activeSessionIds.has(connectionId)) profileDisconnectingIds.delete(connectionId);
        });
        Array.from(filesStatusByConnectionId.keys()).forEach(connectionId => {
          if (connectionId !== '__global__' && !activeSessionIds.has(connectionId)) filesStatusByConnectionId.delete(connectionId);
        });
        Array.from(filesStableStatusByConnectionId.keys()).forEach(connectionId => {
          if (connectionId !== '__global__' && !activeSessionIds.has(connectionId)) filesStableStatusByConnectionId.delete(connectionId);
        });
        clearFilesStatusResetTimerForMissingSessions(activeSessionIds);
        Array.from(serverLogShortcutsSessionByConnectionId.keys()).forEach(connectionId => {
          if (!activeSessionIds.has(connectionId)) serverLogShortcutsSessionByConnectionId.delete(connectionId);
        });
        Array.from(serverPortForwardRuntimeByConnectionId.keys()).forEach(connectionId => {
          if (!activeSessionIds.has(connectionId)) serverPortForwardRuntimeByConnectionId.delete(connectionId);
        });
        Array.from(serverPortForwardAutoStartedConnectionIds).forEach(connectionId => {
          if (!activeSessionIds.has(connectionId)) serverPortForwardAutoStartedConnectionIds.delete(connectionId);
        });
        sessions.forEach(session => {
          requestServerPortForwardStatesForSession(session);
          maybeAutoStartServerPortForwardsForSession(session, !previousSessionIds.has(session.id));
        });
        pruneConnectionViewState();
        pruneNavigationHistoryForSessions();
        const previousActiveConnectionId = activeConnectionId;
        if (previousActiveConnectionId && activeSessionIds.has(previousActiveConnectionId)) saveActiveFileListSnapshot();
        pruneFileListSnapshotsForSessions();
        if (previousActiveConnectionId && remoteSearchDialogOpen) saveRemoteSearchFormForConnection(previousActiveConnectionId);
        activeConnectionId = payload.activeConnectionId || '';
        connectionButtonState = '';
        renderSessionTabs();
        if (profileDropdownOpen) renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
        updateActiveSessionUi();
        if (activeConnectionId !== previousActiveConnectionId) restoreFilesStatusForActiveConnection();
        updateConnectionViewUi();
        if (activeConnectionId && activeConnectionId !== previousActiveConnectionId) {
          const restoredFileList = restoreFileListSnapshotForConnection(activeConnectionId, { updateStatus: false });
          if (!restoredFileList) {
            currentEntries = [];
            selectedEntryPath = '';
            selectedEntryPaths.clear();
            selectionAnchorPath = '';
            hideContextMenu();
            entriesRenderGeneration += 1;
            renderEntriesEmptyMessage(isSessionConnected(getActiveSession()) ? 'Loading remote files...' : 'Connecting...');
          }
        }
        initializeNavigationHistoryForActiveSession();
        const keepProfileDropdownOpenAfterSessionChange = profileDropdownOpen;
        if (activeConnectionId && activeConnectionId !== previousActiveConnectionId) {
          syncConnectionFormWithActiveSession({ preserveStatus: true });
        }
        updateRemotePathNavigationControls();
        setControls();
        if (keepProfileDropdownOpenAfterSessionChange) {
          profileDropdownOpen = true;
          if (profileDropdownButton) profileDropdownButton.setAttribute('aria-expanded', 'true');
          const profilePicker = profileDropdownButton ? profileDropdownButton.closest('.profile-picker') : null;
          if (profilePicker) profilePicker.classList.add('open');
          renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
        }
        maybeRequestServerDashboardForActiveView();
        updateServerAutoRefreshTimer();
        if (activeConnectionId !== previousActiveConnectionId) {
          remoteSearchState = getRemoteSearchStateForActiveConnection();
          applyRemoteSearchFormForActiveConnection();
          renderRemoteSearchState();
          if (activeConnectionId) vscode.postMessage({ type: 'requestRemoteSearchState' });
        }
        if (remoteCommandDialogOpen) renderRemoteCommandSession();
        renderRemoteCommandBadge();
        if (remoteSearchDialogOpen) updateRemoteSearchProtocolFields();
        if (pathFavoritesOpen) renderPathFavoritesPopover();
        break;
      }
      case 'sudoModeChanged': {
        const targetConnectionId = payload.connectionId || activeConnectionId;
        const session = sessions.find(item => item.id === targetConnectionId);
        if (session) {
          session.sudoModeEnabled = Boolean(payload.enabled);
        }
        serverDashboardStatesByConnectionId.delete(targetConnectionId);
        serverProcessActionStatesByConnectionId.delete(targetConnectionId);
        updateSudoToggle();
        updateConnectionViewUi();
        if (remoteCommandDialogOpen) renderRemoteCommandSession();
        renderRemoteCommandBadge();
        if (remoteSearchDialogOpen) updateRemoteSearchProtocolFields();
        setControls();
        if (targetConnectionId === activeConnectionId && getActiveConnectionView() === 'server') {
          requestServerDashboardRefresh(true);
        }
        break;
      }
      case 'disconnected': {
        const disconnectedPreviousActiveConnectionId = activeConnectionId;
        sessions = [];
        clientPendingSessionsByConnectionId.clear();
        profileDisconnectingIds.clear();
        filesStatusByConnectionId.clear();
        filesStableStatusByConnectionId.clear();
        clearFilesStatusResetTimer();
        activeConnectionViewsByConnectionId.clear();
        serverDashboardStatesByConnectionId.clear();
        serverProcessActionStatesByConnectionId.clear();
        serverLogShortcutsSessionByConnectionId.clear();
        serverPortForwardRuntimeByConnectionId.clear();
        serverPortForwardAutoStartedConnectionIds.clear();
        updateServerAutoRefreshTimer();
        remoteSearchFormsByConnectionId.clear();
        remoteSearchStatesByConnectionId.clear();
        navigationHistoryByConnectionId.clear();
        persistNavigationHistory();
        pendingNavigationHistoryMode = '';
        activeConnectionId = '';
        connectionButtonState = '';
        lastSyncedActiveConnectionId = '';
        fileListSnapshotsByConnectionId.clear();
        currentEntries = [];
        selectedEntryPath = '';
        clearFilterText();
        currentSort = { key: '', direction: '' };
        hideContextMenu();
        hideFilePropertiesDialog();
        hideChecksumsDialog();
        if (remoteSearchDialogOpen) hideRemoteSearchDialog();
        remoteSearchState = createEmptyRemoteSearchState('', 'sftp');
        renderRemoteSearchState();
        remoteCommandSessionsByConnectionId.clear();
        if (remoteCommandDialogOpen) {
          clearRemoteCommandStopEscalationTimer();
          hideRemoteCommandDialog();
        }
        renderRemoteCommandBadge();
        hidePathFavoritesPopover();
        hideRemotePathDropdown();
        renderSessionTabs();
        updateActiveSessionUi();
        if (activeConnectionId !== disconnectedPreviousActiveConnectionId) restoreFilesStatusForActiveConnection();
        updateConnectionViewUi();
        initializeNavigationHistoryForActiveSession();
        updateSortIndicators();
        if (profileDropdownOpen) renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
        entriesRenderGeneration += 1;
        renderEntriesEmptyMessage('Connect to a host to list remote files.');
        currentPath.value = '';
        exitRemotePathEditMode({ reset: false, keepFocus: true });
        setControls();
        setStatus('No active connection.');
        break;
      }
      case 'directoryListed': {
        const listedConnectionId = String(payload.connectionId || activeConnectionId || '').trim();
        const listedEntries = Array.isArray(payload.entries) ? payload.entries : [];
        const nextPath = normalizeUiRemotePath(payload.path || '/');

        if (listedConnectionId && listedConnectionId !== activeConnectionId) {
          saveDirectoryPayloadSnapshot(listedConnectionId, nextPath, listedEntries, { stale: false });
          setFilesLoadedStatusForConnection(listedConnectionId, listedEntries);
          break;
        }

        const activeSession = getActiveSession();
        const previousPath = normalizeUiRemotePath((activeSession && activeSession.currentPath) || currentPath.value || '/');
        const directoryChanged = previousPath !== nextPath;

        currentPath.value = nextPath;
        exitRemotePathEditMode({ reset: false, keepFocus: true });
        hideRemotePathDropdown();
        currentEntries = listedEntries;
        selectedEntryPath = '';
        selectedEntryPaths.clear();
        selectionAnchorPath = '';
        if (directoryChanged) clearFilterText();
        hideContextMenu();
        renderEntries(getVisibleEntries());
        if (directoryChanged) scrollEntriesToTop();
        setFilesLoadedStatusForConnection(listedConnectionId || activeConnectionId, currentEntries);
        updateActiveSessionPath(nextPath);
        updateConnectionViewUi();
        recordNavigationHistory(nextPath, pendingNavigationHistoryMode);
        pendingNavigationHistoryMode = '';
        updatePathFavoriteControls();
        if (pathFavoritesOpen) renderPathFavoritesPopover();
        saveFileListSnapshot(listedConnectionId || activeConnectionId, { stale: false, loaded: true });
        break;
      }
      case 'directoryMetadataUpdated':
        handleDirectoryMetadataUpdated(payload);
        saveActiveFileListSnapshot({ stale: false });
        break;
      case 'breadcrumbDirectoriesListed':
        handleBreadcrumbDirectoriesListed(payload);
        break;
      case 'status':
        setStatus(payload.message || '', false, Boolean(payload.showOutputLink), payload.outputLinkText || 'See details in Output.', payload.connectionId || '');
        break;
      case 'serverStatus':
        showServerToolbarStatus(payload.message || '', payload.kind || (payload.isError ? 'error' : 'info'), Number(payload.durationMs || 0));
        break;
      case 'statusCopyFeedback':
        showStatusCopyFeedback(payload.message || 'Copied');
        break;
      case 'busy': {
        const saveFeedbackProfileId = saveProfileButtonFeedbackProfileId;
        setBusy(Boolean(payload.isBusy), payload.message || '', payload.cancelAction || (payload.canCancelTransfer ? 'transfer' : ''), payload.cancelLabel || 'Cancel', payload.connectionId || '');
        if (saveFeedbackProfileId && !Boolean(payload.isBusy)) {
          const pendingProfileSelectionId = pendingProfileSelectionAfterSaveId;
          const saveSucceeded = String(payload.message || '') === 'Connection saved.';
          saveProfileButtonFeedbackProfileId = '';
          pendingProfileSelectionAfterSaveId = '';
          if (saveSucceeded && selectedProfileId === saveFeedbackProfileId) {
            showTemporaryButtonText(saveProfileButton, 'Saved', 1500);
          }
          if (saveSucceeded && pendingProfileSelectionId && pendingProfileSelectionId !== selectedProfileId) {
            selectProfile(pendingProfileSelectionId);
          } else if (!saveSucceeded && pendingProfileSelectionId) {
            setControls();
          }
        }
        break;
      }
      case 'transferQueueChanged':
        updateTransferQueueState(payload);
        break;
      case 'showTransferQueue':
        showTransferQueueModal();
        break;
      case 'remoteCommandStarted':
        handleRemoteCommandStarted(payload);
        break;
      case 'remoteCommandOutput':
        handleRemoteCommandOutput(payload);
        break;
      case 'remoteCommandFinished':
        handleRemoteCommandFinished(payload);
        break;
      case 'remoteSearchState':
      case 'remoteSearchStarted':
        applyRemoteSearchSnapshot(payload);
        break;
      case 'remoteSearchResult':
        appendRemoteSearchResult(payload || {});
        break;
      case 'remoteSearchResultsBatch':
        appendRemoteSearchResultsBatch(payload || {});
        break;
      case 'remoteSearchFinished':
        applyRemoteSearchSnapshot(payload);
        break;
      case 'remoteSearchScopeEntriesListed':
        if (!handleServerLogShortcutPathEntriesListed(payload || {}) && !handleRemoteCommandWorkingDirectoryEntriesListed(payload || {})) {
          handleRemoteSearchScopeEntriesListed(payload || {});
        }
        break;
      case 'remoteSearchScopeSelected':
        if (!payload.connectionId || payload.connectionId === activeConnectionId) {
          remoteSearchScopePath.value = normalizeSearchScopePath(payload.path || '/');
        }
        break;
      case 'logViewerActiveSessionCount':
        logViewerActiveSessionCount = Math.max(0, Number(payload.count || 0));
        renderLogViewerBadge();
        break;
      case 'serverDashboard':
        handleServerDashboardSnapshot(payload || {});
        break;
      case 'serverProcessActionState':
        handleServerProcessActionState(payload || {});
        break;
      case 'portForwardStateChanged':
        handleServerPortForwardState(payload || {});
        break;
      case 'error':
        connectionButtonState = '';
        if (payload.connectionId) {
          profileDisconnectingIds.delete(String(payload.connectionId || ''));
          markClientPendingSessionFailed(payload.connectionId, payload.message || 'Connection failed.');
          if (profileDropdownOpen) renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
        }
        setBusy(false, '', '', 'Cancel', payload.connectionId || '');
        if (importBackupDialogOpen && importBackupResult) {
          showBackupResult(importBackupResult, payload.message || 'Unknown error.', true);
          break;
        } else if (exportBackupDialogOpen && exportBackupResult) {
          showBackupResult(exportBackupResult, payload.message || 'Unknown error.', true);
          break;
        }
        setStatus(payload.message || 'Unknown error.', true, Boolean(payload.showOutputLink), payload.outputLinkText || 'See details in Output.', payload.connectionId || '');
        break;
      case 'showConfirmDialog':
        showConfirmDialog(payload);
        break;
      case 'showInputDialog':
        showInputPromptDialog(payload);
        break;
      case 'showTransferConflictDialog':
        showTransferConflictDialog(payload);
        break;
      case 'hideTransferConflictDialog':
        hideTransferConflictDialog();
        break;
      case 'showChecksumsDialog':
        showChecksumsDialog(payload);
        break;
      case 'showPermissionsDialog':
        showPermissionsDialog(payload);
        break;
      case 'ownerGroupSuggestions':
        handleOwnerGroupSuggestions(payload || {});
        break;
      case 'hidePermissionsDialog':
        hidePermissionsDialog();
        break;
      case 'permissionsValidationError':
        setPermissionValidation(payload.message || 'Invalid permission mode.', false);
        break;
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    vscode.postMessage({ type: 'syncPersistentStorage', payload: { migrationOnly: true, snapshot: collectPersistentStorageSnapshot() } });
    vscode.postMessage({ type: 'ready' });
    updateConnectionPanelLayout();
    applyRemotePathLayout();
    requestAnimationFrame(() => {
      if (mainLayout) mainLayout.classList.add('connection-transition-ready');
    });
    updateAuthFields();
    setControls();
  });

  profileSelect.addEventListener('change', () => {
    void requestSelectProfile(profileSelect.value || '');
  });

  profileDropdownButton.addEventListener('click', event => {
    event.stopPropagation();
    toggleProfileDropdown();
  });

  profileDropdownMenu.addEventListener('mousedown', event => {
    const actionButton = event.target && event.target.closest ? event.target.closest('[data-profile-action]') : null;
    if (!actionButton) return;
    event.preventDefault();
    event.stopPropagation();
  });

  profileDropdownMenu.addEventListener('click', event => {
    const actionButton = event.target && event.target.closest ? event.target.closest('[data-profile-action]') : null;
    if (actionButton) {
      event.preventDefault();
      event.stopPropagation();
      handleProfileDropdownAction(actionButton.dataset.profileActionId || '');
      return;
    }

    const groupToggle = event.target && event.target.closest ? event.target.closest('[data-profile-group-toggle]') : null;
    if (groupToggle) {
      event.preventDefault();
      event.stopPropagation();
      toggleProfileDropdownGroup(groupToggle.dataset.profileGroupToggle || '');
      return;
    }

    const item = event.target && event.target.closest ? event.target.closest('[data-profile-id]') : null;
    if (!item) return;
    void requestSelectProfile(item.dataset.profileId || '');
  });

  profileDropdownMenu.addEventListener('input', event => {
    const target = event.target;
    if (!target || target.id !== 'profileDropdownFilterInput') return;
    profileDropdownFilterText = String(target.value || '');
    renderProfileDropdown({ focusFilter: true });
  });

  profileDropdownMenu.addEventListener('keydown', event => {
    const target = event.target;
    if (!target || target.id !== 'profileDropdownFilterInput') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      hideProfileDropdown();
    }
  });

  manageProfilesButton.addEventListener('click', () => showManageProfilesDialog());

  connectionNameCreateButton.addEventListener('click', () => confirmConnectionNameDialog());
  connectionNameCancelButton.addEventListener('click', () => closeConnectionNameDialog(null));
  connectionNameInput.addEventListener('input', () => validateConnectionNameInput(false));
  connectionNameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmConnectionNameDialog();
    } else if (event.key === 'Escape') {
      handleConnectionNameDialogEscape(event);
    }
  });

  if (connectionNameGroup) {
    connectionNameGroup.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        handleConnectionNameDialogEscape(event);
      }
    });
  }

  saveProfileButton.addEventListener('click', () => {
    void saveCurrentConnection();
  });

  connectButton.addEventListener('click', () => {
    const connectedSession = getConnectedSessionForCurrentForm();
    if (connectedSession) {
      connectionButtonState = 'disconnecting';
      setBusy(true, 'Disconnecting...', '', 'Cancel', connectedSession.id);
      vscode.postMessage({ type: 'disconnect', payload: { connectionId: connectedSession.id } });
      return;
    }

    const pendingSession = getPendingSessionForCurrentForm();
    if (pendingSession) {
      activateClientSession(pendingSession.id);
      return;
    }

    if (!validateConnectionForm('connect')) return;
    const payload = collectConnectionPayload();
    const clientConnectionId = createClientConnectionId(payload);
    payload.clientConnectionId = clientConnectionId;
    createClientPendingSession(payload, clientConnectionId);
    vscode.postMessage({ type: 'connect', payload });
  });

  showSettingsButton.addEventListener('click', () => vscode.postMessage({ type: 'showSettings' }));
  showOutputButton.addEventListener('click', () => vscode.postMessage({ type: 'showOutput' }));
  document.addEventListener('click', event => {
    const viewButton = event.target && event.target.closest ? event.target.closest('[data-connection-view]') : null;
    if (!viewButton) return;
    const nextView = viewButton.getAttribute('data-connection-view') || 'files';
    if (nextView !== 'files' && nextView !== 'server') return;
    event.preventDefault();
    event.stopPropagation();
    if (viewButton.disabled) return;
    setActiveConnectionView(nextView);
  });
  if (serverView) serverView.addEventListener('input', event => {
    const quickTasksFilterInput = event.target && event.target.closest ? event.target.closest('#serverQuickTasksFilterInput') : null;
    if (quickTasksFilterInput) {
      setServerQuickTaskFilterText(quickTasksFilterInput.value || '');
      renderServerViewAndFocusQuickTasksFilter();
      return;
    }

    const logsFilterInput = event.target && event.target.closest ? event.target.closest('#serverLogsFilterInput') : null;
    if (logsFilterInput) {
      setServerLogShortcutFilterText(logsFilterInput.value || '');
      renderServerViewAndFocusLogsFilter();
      return;
    }

    const portForwardsFilterInput = event.target && event.target.closest ? event.target.closest('#serverPortForwardsFilterInput') : null;
    if (portForwardsFilterInput) {
      setServerPortForwardFilterText(portForwardsFilterInput.value || '');
      renderServerViewAndFocusPortForwardsFilter();
      return;
    }

    const scheduledFilterInput = event.target && event.target.closest ? event.target.closest('#serverScheduledFilterInput') : null;
    if (scheduledFilterInput) {
      setServerScheduledJobFilterText(scheduledFilterInput.value || '');
      renderServerViewAndFocusScheduledFilter();
      return;
    }

    const processFilterInput = event.target && event.target.closest ? event.target.closest('#serverProcessesFilterInput') : null;
    if (processFilterInput) {
      setServerProcessFilterText(processFilterInput.value || '');
      renderServerViewAndFocusProcessesFilter();
      return;
    }

    const filterInput = event.target && event.target.closest ? event.target.closest('#serverServicesFilterInput') : null;
    if (!filterInput) return;
    setServerServiceFilterText(filterInput.value || '');
    renderServerViewAndFocusServicesFilter();
  });
  if (serverView) serverView.addEventListener('keydown', event => {
    const quickTasksFilterInput = event.target && event.target.closest ? event.target.closest('#serverQuickTasksFilterInput') : null;
    if (quickTasksFilterInput && event.key === 'Escape') {
      if (!String(quickTasksFilterInput.value || '')) return;
      event.preventDefault();
      event.stopPropagation();
      setServerQuickTaskFilterText('');
      renderServerViewAndFocusQuickTasksFilter();
      return;
    }

    const logsFilterInput = event.target && event.target.closest ? event.target.closest('#serverLogsFilterInput') : null;
    if (logsFilterInput && event.key === 'Escape') {
      if (!String(logsFilterInput.value || '')) return;
      event.preventDefault();
      event.stopPropagation();
      setServerLogShortcutFilterText('');
      renderServerViewAndFocusLogsFilter();
      return;
    }

    const portForwardsFilterInput = event.target && event.target.closest ? event.target.closest('#serverPortForwardsFilterInput') : null;
    if (portForwardsFilterInput && event.key === 'Escape') {
      if (!String(portForwardsFilterInput.value || '')) return;
      event.preventDefault();
      event.stopPropagation();
      setServerPortForwardFilterText('');
      renderServerViewAndFocusPortForwardsFilter();
      return;
    }

    const scheduledFilterInput = event.target && event.target.closest ? event.target.closest('#serverScheduledFilterInput') : null;
    if (scheduledFilterInput && event.key === 'Escape') {
      if (!String(scheduledFilterInput.value || '')) return;
      event.preventDefault();
      event.stopPropagation();
      setServerScheduledJobFilterText('');
      renderServerViewAndFocusScheduledFilter();
      return;
    }

    const processFilterInput = event.target && event.target.closest ? event.target.closest('#serverProcessesFilterInput') : null;
    if (processFilterInput && event.key === 'Escape') {
      if (!String(processFilterInput.value || '')) return;
      event.preventDefault();
      event.stopPropagation();
      setServerProcessFilterText('');
      renderServerViewAndFocusProcessesFilter();
      return;
    }

    const filterInput = event.target && event.target.closest ? event.target.closest('#serverServicesFilterInput') : null;
    if (!filterInput || event.key !== 'Escape') return;
    if (!String(filterInput.value || '')) return;
    event.preventDefault();
    event.stopPropagation();
    setServerServiceFilterText('');
    renderServerViewAndFocusServicesFilter();
  });
  if (serverView) serverView.addEventListener('click', event => {
    const serverSortButton = event.target && event.target.closest ? event.target.closest('[data-server-sort-card][data-server-sort-key]') : null;
    if (serverSortButton) {
      event.preventDefault();
      event.stopPropagation();
      handleServerCardSortClick(serverSortButton.getAttribute('data-server-sort-card') || '', serverSortButton.getAttribute('data-server-sort-key') || '');
      return;
    }

    const serverOverviewCard = event.target && event.target.closest ? event.target.closest('.server-overview-card[data-server-overview-index]') : null;
    if (serverOverviewCard) {
      event.preventDefault();
      event.stopPropagation();
      showServerOverviewDetailsDialog(Number(serverOverviewCard.getAttribute('data-server-overview-index')));
      return;
    }

    const quickTasksFilterClearButton = event.target && event.target.closest ? event.target.closest('[data-server-quick-tasks-filter-clear]') : null;
    if (quickTasksFilterClearButton) {
      event.preventDefault();
      event.stopPropagation();
      if (quickTasksFilterClearButton.disabled) return;
      setServerQuickTaskFilterText('');
      renderServerViewAndFocusQuickTasksFilter();
      return;
    }

    const logsFilterClearButton = event.target && event.target.closest ? event.target.closest('[data-server-logs-filter-clear]') : null;
    if (logsFilterClearButton) {
      event.preventDefault();
      event.stopPropagation();
      if (logsFilterClearButton.disabled) return;
      setServerLogShortcutFilterText('');
      renderServerViewAndFocusLogsFilter();
      return;
    }


    const portForwardsFilterClearButton = event.target && event.target.closest ? event.target.closest('[data-server-port-forwards-filter-clear]') : null;
    if (portForwardsFilterClearButton) {
      event.preventDefault();
      event.stopPropagation();
      if (portForwardsFilterClearButton.disabled) return;
      setServerPortForwardFilterText('');
      renderServerViewAndFocusPortForwardsFilter();
      return;
    }

    const servicesFilterClearButton = event.target && event.target.closest ? event.target.closest('[data-server-services-filter-clear]') : null;
    if (servicesFilterClearButton) {
      event.preventDefault();
      event.stopPropagation();
      if (servicesFilterClearButton.disabled) return;
      setServerServiceFilterText('');
      renderServerViewAndFocusServicesFilter();
      return;
    }

    const processesFilterClearButton = event.target && event.target.closest ? event.target.closest('[data-server-processes-filter-clear]') : null;
    if (processesFilterClearButton) {
      event.preventDefault();
      event.stopPropagation();
      if (processesFilterClearButton.disabled) return;
      setServerProcessFilterText('');
      renderServerViewAndFocusProcessesFilter();
      return;
    }

    const scheduledFilterClearButton = event.target && event.target.closest ? event.target.closest('[data-server-scheduled-filter-clear]') : null;
    if (scheduledFilterClearButton) {
      event.preventDefault();
      event.stopPropagation();
      if (scheduledFilterClearButton.disabled) return;
      setServerScheduledJobFilterText('');
      renderServerViewAndFocusScheduledFilter();
      return;
    }


    const portForwardButton = event.target && event.target.closest ? event.target.closest('[data-server-port-forward-action]') : null;
    if (portForwardButton) {
      event.preventDefault();
      event.stopPropagation();
      if (portForwardButton.disabled) return;
      handleServerPortForwardAction(portForwardButton.getAttribute('data-server-port-forward-action') || '', portForwardButton.getAttribute('data-server-port-forward-id') || '');
      return;
    }

    const portForwardRow = event.target && event.target.closest ? event.target.closest('.server-port-forward-row[data-server-port-forward-id]') : null;
    if (portForwardRow) {
      event.preventDefault();
      event.stopPropagation();
      showServerPortForwardDialog('edit', portForwardRow.getAttribute('data-server-port-forward-id') || '');
      return;
    }

    const scheduledButton = event.target && event.target.closest ? event.target.closest('[data-server-scheduled-action]') : null;
    if (scheduledButton) {
      event.preventDefault();
      event.stopPropagation();
      if (scheduledButton.disabled) return;
      handleServerScheduledJobAction(scheduledButton.getAttribute('data-server-scheduled-action') || 'open', readServerScheduledJobDataset(scheduledButton), scheduledButton);
      return;
    }

    const scheduledRow = event.target && event.target.closest ? event.target.closest('.server-scheduled-row[data-server-scheduled-id]') : null;
    if (scheduledRow) {
      event.preventDefault();
      event.stopPropagation();
      handleServerScheduledJobAction('open', readServerScheduledJobDataset(scheduledRow));
      return;
    }

    const processButton = event.target && event.target.closest ? event.target.closest('[data-server-process-action]') : null;
    if (processButton) {
      event.preventDefault();
      event.stopPropagation();
      if (processButton.disabled) return;
      handleServerProcessAction('kill', readServerProcessDataset(processButton));
      return;
    }

    const processRow = event.target && event.target.closest ? event.target.closest('.server-process-row[data-server-process-pid]') : null;
    if (processRow) {
      event.preventDefault();
      event.stopPropagation();
      handleServerProcessAction('details', readServerProcessDataset(processRow));
      return;
    }

    const serviceButton = event.target && event.target.closest ? event.target.closest('[data-server-service-action]') : null;
    if (serviceButton) {
      event.preventDefault();
      event.stopPropagation();
      if (serviceButton.disabled) return;
      handleServerServiceAction(
        serviceButton.getAttribute('data-server-service-action') || '',
        serviceButton.getAttribute('data-server-service-name') || '',
        serviceButton.getAttribute('data-server-service-adapter') || ''
      );
      return;
    }

    const serviceRow = event.target && event.target.closest ? event.target.closest('.server-service-row[data-server-service-name]') : null;
    if (serviceRow) {
      event.preventDefault();
      event.stopPropagation();
      handleServerServiceAction(
        'details',
        serviceRow.getAttribute('data-server-service-name') || '',
        serviceRow.getAttribute('data-server-service-adapter') || ''
      );
      return;
    }

    const logButton = event.target && event.target.closest ? event.target.closest('[data-server-log-action]') : null;
    if (logButton) {
      event.preventDefault();
      event.stopPropagation();
      if (logButton.disabled) return;
      handleServerLogAction(
        logButton.getAttribute('data-server-log-action') || 'readonly',
        logButton.getAttribute('data-server-log-id') || '',
        logButton.getAttribute('data-server-log-path') || '',
        logButton
      );
      return;
    }

    const logRow = event.target && event.target.closest ? event.target.closest('.server-log-shortcut-row[data-server-log-id]') : null;
    if (logRow) {
      event.preventDefault();
      event.stopPropagation();
      handleServerLogAction('edit', logRow.getAttribute('data-server-log-id') || '', '');
      return;
    }

    const quickTaskButton = event.target && event.target.closest ? event.target.closest('[data-server-quick-task-action]') : null;
    if (quickTaskButton) {
      event.preventDefault();
      event.stopPropagation();
      if (quickTaskButton.disabled) return;
      const quickTaskAction = quickTaskButton.getAttribute('data-server-quick-task-action') || 'run';
      if (quickTaskAction === 'add') {
        handleServerQuickTaskAddAction();
      } else {
        handleServerQuickTaskAction(quickTaskButton.getAttribute('data-server-quick-task-id') || '', true);
      }
      return;
    }

    const quickTaskRow = event.target && event.target.closest ? event.target.closest('.server-quick-task-row[data-server-quick-task-id]') : null;
    if (quickTaskRow) {
      event.preventDefault();
      event.stopPropagation();
      handleServerQuickTaskAction(quickTaskRow.getAttribute('data-server-quick-task-id') || '', false);
      return;
    }

    const actionButton = event.target && event.target.closest ? event.target.closest('[data-server-action]') : null;
    if (!actionButton || actionButton.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    handleServerViewAction(actionButton.getAttribute('data-server-action') || '');
  });

  if (serverLogShortcutSaveButton) serverLogShortcutSaveButton.addEventListener('click', () => {
    saveServerLogShortcutDialog();
  });
  if (serverLogShortcutRemoveButton) serverLogShortcutRemoveButton.addEventListener('click', () => {
    if (serverLogShortcutDialogMode !== 'edit' || !serverLogShortcutDialogShortcutId) return;
    showServerLogShortcutRemoveDialog(serverLogShortcutDialogShortcutId);
  });
  if (serverLogShortcutCancelButton) serverLogShortcutCancelButton.addEventListener('click', () => {
    hideServerLogShortcutDialog();
  });
  if (serverLogShortcutNameInput) serverLogShortcutNameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveServerLogShortcutDialog();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      hideServerLogShortcutDialog();
    }
  });
  if (serverLogShortcutPathInput) serverLogShortcutPathInput.addEventListener('input', () => {
    validateServerLogShortcutInputs(false);
    if (serverLogShortcutPathPickerOpen) positionServerLogShortcutPathPicker();
  });
  if (serverLogShortcutBrowseButton) serverLogShortcutBrowseButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); browseServerLogShortcutPath(); });
  if (serverLogShortcutPathPicker) {
    serverLogShortcutPathPicker.addEventListener('mousedown', event => event.stopPropagation());
    serverLogShortcutPathPicker.addEventListener('click', event => event.stopPropagation());
  }
  if (serverLogShortcutPathPickerCancelButton) serverLogShortcutPathPickerCancelButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); hideServerLogShortcutPathPicker(); });
  if (serverLogShortcutPathPickerList) serverLogShortcutPathPickerList.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target && event.target.closest ? event.target.closest('[data-server-log-picker-path]') : null;
    if (!target) return;
    const path = target.getAttribute('data-server-log-picker-path') || '/';
    const type = target.getAttribute('data-server-log-picker-type') || 'file';
    if (type === 'directory') {
      requestServerLogShortcutPathEntries(path);
    } else {
      selectServerLogShortcutPath(path);
    }
  });
  if (serverLogShortcutPathInput) serverLogShortcutPathInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveServerLogShortcutDialog();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      hideServerLogShortcutDialog();
    }
  });
  if (serverLogShortcutRemoveConfirmButton) serverLogShortcutRemoveConfirmButton.addEventListener('click', () => {
    confirmRemoveServerLogShortcut();
  });
  if (serverLogShortcutRemoveCancelButton) serverLogShortcutRemoveCancelButton.addEventListener('click', () => {
    hideServerLogShortcutRemoveDialog();
  });

  if (serverPortForwardSaveButton) serverPortForwardSaveButton.addEventListener('click', () => {
    saveServerPortForwardDialog(false);
  });
  if (serverPortForwardCancelButton) serverPortForwardCancelButton.addEventListener('click', () => {
    hideServerPortForwardDialog();
  });
  if (serverPortForwardDeleteButton) serverPortForwardDeleteButton.addEventListener('click', () => {
    showServerPortForwardRemoveDialog();
  });
  for (const input of [serverPortForwardNameInput, serverPortForwardLocalHostInput, serverPortForwardLocalPortInput, serverPortForwardRemoteHostInput, serverPortForwardRemotePortInput]) {
    if (!input) continue;
    input.addEventListener('input', () => readServerPortForwardDialogValues(false));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target !== serverPortForwardNameInput) {
        event.preventDefault();
        saveServerPortForwardDialog(false);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        hideServerPortForwardDialog();
      }
    });
  }
  if (serverPortForwardRemoveConfirmButton) serverPortForwardRemoveConfirmButton.addEventListener('click', () => {
    confirmRemoveServerPortForward();
  });
  if (serverPortForwardRemoveCancelButton) serverPortForwardRemoveCancelButton.addEventListener('click', () => {
    hideServerPortForwardRemoveDialog();
  });

  if (serverRefreshButton) {
    serverRefreshButton.addEventListener('click', () => handleServerViewAction('refresh'));
  }
  if (serverAutoRefreshDropdownButton) {
    serverAutoRefreshDropdownButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      toggleServerAutoRefreshDropdown();
    });
  }
  if (serverAutoRefreshDropdownMenu) {
    serverAutoRefreshDropdownMenu.addEventListener('click', event => {
      const item = event.target && event.target.closest ? event.target.closest('[data-server-auto-refresh]') : null;
      if (!item || !serverAutoRefreshDropdownButton || serverAutoRefreshDropdownButton.disabled) return;
      selectServerAutoRefresh(item.getAttribute('data-server-auto-refresh') || 'off');
      hideServerAutoRefreshDropdown();
    });
  }

  if (browserCard) {
    browserCard.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('.session-close')) return;
      syncConnectionFormWithActiveSession({ preserveStatus: true });
    });
    browserCard.addEventListener('focusin', () => syncConnectionFormWithActiveSession({ preserveStatus: true }));
  }
  hideConnectionPanelButton.addEventListener('click', () => setConnectionPanelCollapsed(true));
  showConnectionPanelButton.addEventListener('click', () => setConnectionPanelCollapsed(false));
  window.addEventListener('resize', updateConnectionRailPosition);
  sudoToggle.addEventListener('change', () => {
    if (!activeConnectionId) {
      updateSudoToggle();
      setStatus('Connect to a host before enabling Sudo Mode.', true);
      return;
    }

    if (sudoToggle.checked) {
      sudoToggle.checked = false;
      setBusy(true, 'Enabling Sudo Mode...');
      vscode.postMessage({ type: 'enableSudoMode', payload: { connectionId: activeConnectionId } });
      return;
    }

    setBusy(true, 'Disabling Sudo Mode...');
    vscode.postMessage({ type: 'disableSudoMode', payload: { connectionId: activeConnectionId } });
  });
  if (remoteSearchButton) remoteSearchButton.addEventListener('click', showRemoteSearchDialog);
  if (remoteSearchPrimaryButton) remoteSearchPrimaryButton.addEventListener('click', startOrCancelRemoteSearch);
  if (remoteSearchCopyButton) remoteSearchCopyButton.addEventListener('click', copyRemoteSearchResults);
  if (remoteSearchClearButton) remoteSearchClearButton.addEventListener('click', clearRemoteSearch);
  if (remoteSearchCloseButton) remoteSearchCloseButton.addEventListener('click', hideRemoteSearchDialog);
  if (remoteSearchBrowseButton) remoteSearchBrowseButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); browseRemoteSearchScope(); });
  if (remoteSearchScopePicker) {
    remoteSearchScopePicker.addEventListener('mousedown', event => event.stopPropagation());
    remoteSearchScopePicker.addEventListener('click', event => event.stopPropagation());
  }
  if (remoteSearchScopeSelectButton) remoteSearchScopeSelectButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); selectRemoteSearchScopePickerPath(); });
  if (remoteSearchScopeCancelButton) remoteSearchScopeCancelButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); hideRemoteSearchScopePicker(); });
  if (remoteSearchScopePickerList) remoteSearchScopePickerList.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target && event.target.closest ? event.target.closest('[data-remote-search-scope-path]') : null;
    if (!target) return;
    const path = target.getAttribute('data-remote-search-scope-path') || '/';
    requestRemoteSearchScopeEntries(path);
  });
  if (remoteSearchInsideFiles) remoteSearchInsideFiles.addEventListener('change', () => { updateRemoteSearchTextField(); saveRemoteSearchFormForActiveConnection(); clearRemoteSearchValidation(); });
  for (const control of [remoteSearchScopePath, remoteSearchFileName, remoteSearchTextToFind]) {
    if (control) control.addEventListener('input', () => { saveRemoteSearchFormForActiveConnection(); clearRemoteSearchValidation(control); });
  }
  for (const control of [remoteSearchSubdirectories, remoteSearchHiddenFiles, remoteSearchCaseSensitive, remoteSearchUseSudo]) {
    if (control) control.addEventListener('change', () => { saveRemoteSearchFormForActiveConnection(); clearRemoteSearchValidation(); updateRemoteSearchMeta(); });
  }
  if (remoteSearchResults) remoteSearchResults.addEventListener('click', event => {
    const showMoreTarget = event.target && event.target.closest ? event.target.closest('[data-remote-search-show-more]') : null;
    if (showMoreTarget) {
      showMoreRemoteSearchResults();
      return;
    }
    const target = event.target && event.target.closest ? event.target.closest('.remote-search-result-row[data-remote-search-result-key]') : null;
    if (!target) return;
    const key = target.getAttribute('data-remote-search-result-key') || '';
    const path = target.getAttribute('data-remote-search-result-path') || '';
    if (!key) return;

    if (event.shiftKey && remoteSearchSelectionAnchorKey) {
      selectRemoteSearchResultRange(remoteSearchSelectionAnchorKey, key);
    } else if (event.metaKey || event.ctrlKey) {
      toggleRemoteSearchResultSelection(key);
    } else {
      selectRemoteSearchResult(key);
    }

    if (!event.shiftKey && !event.metaKey && !event.ctrlKey && target.classList.contains('remote-search-result-path') && path) {
      if (remoteSearchExpandedResultPaths.has(path)) {
        remoteSearchExpandedResultPaths.delete(path);
      } else {
        remoteSearchExpandedResultPaths.add(path);
      }
      renderRemoteSearchResults();
    }
  });
  if (remoteSearchResults) remoteSearchResults.addEventListener('contextmenu', event => {
    const target = event.target && event.target.closest ? event.target.closest('.remote-search-result-row[data-remote-search-result-key]') : null;
    const key = target ? (target.getAttribute('data-remote-search-result-key') || '') : '';
    const path = target ? (target.getAttribute('data-remote-search-result-path') || '') : '';
    const kind = target ? (target.getAttribute('data-remote-search-result-kind') || '') : '';
    event.preventDefault();
    event.stopPropagation();
    if (key && !remoteSearchSelectedResultKeys.has(key)) {
      selectRemoteSearchResult(key);
    }
    showRemoteSearchResultContextMenu(path, kind, event.clientX, event.clientY);
  });
  uploadButton.addEventListener('click', () => { if (activeConnectionId && canStartTransferAction()) { invalidateActiveFileListSnapshotForMutation(); vscode.postMessage({ type: 'requestUploadEntries', payload: { path: currentPath.value || '/' } }); } });
  downloadButton.addEventListener('click', () => { const entries = getSelectedActionEntries(); if (entries.length && canStartTransferAction()) vscode.postMessage({ type: 'requestDownloadEntries', payload: { entries: entries.map(actionPayload) } }); });
  transferQueueButton.addEventListener('click', showTransferQueueModal);
  transferQueueFooterCloseButton.addEventListener('click', hideTransferQueueModal);
  if (serverOverviewDetailsGrid) serverOverviewDetailsGrid.addEventListener('click', event => {
    const serverSortButton = event.target && event.target.closest ? event.target.closest('[data-server-sort-card][data-server-sort-key]') : null;
    if (!serverSortButton) return;
    event.preventDefault();
    event.stopPropagation();
    handleServerOverviewDetailsSortClick(serverSortButton.getAttribute('data-server-sort-card') || '', serverSortButton.getAttribute('data-server-sort-key') || '');
  });
  if (serverOverviewDetailsCopyButton) serverOverviewDetailsCopyButton.addEventListener('click', () => { void copyServerOverviewDetails(); });
  if (confirmDialogCopyButton) confirmDialogCopyButton.addEventListener('click', () => { void copyConfirmDialogDetails(); });
  confirmDialogCancelButton.addEventListener('click', () => closeConfirmDialog(false));
  confirmDialogConfirmButton.addEventListener('click', () => closeConfirmDialog(true));
  if (inputPromptCancelButton) inputPromptCancelButton.addEventListener('click', () => closeInputPromptDialog(false));
  if (inputPromptConfirmButton) inputPromptConfirmButton.addEventListener('click', () => closeInputPromptDialog(true));
  if (inputPromptInput) {
    inputPromptInput.addEventListener('input', () => {
      if (inputPromptFeedback) inputPromptFeedback.textContent = '';
      inputPromptInput.classList.remove('backup-input-invalid');
    });
    inputPromptInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        closeInputPromptDialog(true);
      }
    });
  }
  transferConflictActions.addEventListener('click', event => {
    const button = event.target && event.target.closest ? event.target.closest('button[data-transfer-conflict-decision]') : null;
    if (!button) return;
    closeTransferConflictDialog(button.dataset.transferConflictDecision || 'cancel');
  });
  transferConflictBackdrop.addEventListener('keydown', trapTransferConflictFocus);
  confirmDialogBackdrop.addEventListener('keydown', trapConfirmDialogFocus);
  if (inputPromptBackdrop) {
    inputPromptBackdrop.addEventListener('keydown', trapInputPromptFocus);
  }
  transferQueueModal.addEventListener('pointerdown', handleTransferQueueActionPointerDown, true);

`;
}
