export function renderTransfersStatus(): string {
  return `  function showStatusCopyFeedback(message) {
    if (!statusCopyFeedback) return;
    statusCopyFeedback.textContent = message || 'Copied';
    statusCopyFeedback.classList.add('visible');
    if (statusCopyFeedbackTimer) window.clearTimeout(statusCopyFeedbackTimer);
    statusCopyFeedbackTimer = window.setTimeout(() => {
      statusCopyFeedback.classList.remove('visible');
      statusCopyFeedbackTimer = 0;
    }, TOOLTIP_TRANSIENT_DURATION_MS);
  }

  function getFilesStatusTimerKey(connectionId = '') {
    return getStatusConnectionKey(connectionId);
  }

  function clearFilesStatusResetTimer(connectionId = '') {
    if (!connectionId) {
      Array.from(filesStatusResetTimersByConnectionId.keys()).forEach(key => clearFilesStatusResetTimer(key));
      return;
    }
    const key = getFilesStatusTimerKey(connectionId);
    filesStatusResetTokensByConnectionId.set(key, (filesStatusResetTokensByConnectionId.get(key) || 0) + 1);
    const timer = filesStatusResetTimersByConnectionId.get(key);
    if (timer) {
      window.clearTimeout(timer);
      filesStatusResetTimersByConnectionId.delete(key);
    }
  }

  function clearFilesStatusResetTimerForMissingSessions(activeSessionIds) {
    Array.from(filesStatusResetTimersByConnectionId.keys()).forEach(key => {
      if (key !== FILES_STATUS_GLOBAL_KEY && !activeSessionIds.has(key)) clearFilesStatusResetTimer(key);
    });
  }

  function formatFilesLoadedStatusMessage(count) {
    const value = Math.max(0, Number(count || 0));
    return 'Loaded ' + value + ' ' + (value === 1 ? 'item' : 'items') + '.';
  }

  function getFilesLoadedCountFromEntries(entries) {
    return (Array.isArray(entries) ? entries : []).filter(entry => String(entry && entry.name || '') !== '..').length;
  }

  function getActiveFilesLoadedStatusMessage() {
    if (!activeConnectionId || !Array.isArray(currentEntries) || !currentEntries.length) return '';
    return formatFilesLoadedStatusMessage(getFilesLoadedCountFromEntries(currentEntries));
  }

  function getFilesStatusBaseMessage(connectionId = '') {
    const targetConnectionId = String(connectionId || '').trim();
    const key = targetConnectionId || (activeConnectionId || FILES_STATUS_GLOBAL_KEY);
    if (key === activeConnectionId) {
      const loadedMessage = getActiveFilesLoadedStatusMessage();
      if (loadedMessage) return loadedMessage;
    }
    if (key && key !== FILES_STATUS_GLOBAL_KEY) return 'Ready.';
    return activeConnectionId ? (getActiveFilesLoadedStatusMessage() || 'Ready.') : 'No active connection.';
  }

  function sanitizeFilesStatusMessage(message) {
    return String(message || '').replace(/\s*·\s*/g, ' - ').trim();
  }

  function normalizeFilesStatusMessage(message) {
    return sanitizeFilesStatusMessage(message).replace(/\s+/g, ' ');
  }

  function isSilentFilesStatusMessage(message) {
    const text = normalizeFilesStatusMessage(message);
    if (!text) return false;
    return [
      'New quick connection.',
      'Active connection loaded.',
      'Connection saved.',
      'Connection renamed.',
      'Connection removed.',
      'Connection group created.',
      'Connection group renamed.',
      'Connection group deleted.',
      'Connection group and connections deleted.',
      'Favorite added.',
      'Favorite removed.',
      'Remote path copied.',
      'Remove canceled.',
      'Create file canceled.',
      'Create directory canceled.',
      'Rename canceled.',
      'Delete canceled.',
      'Make a copy canceled.',
      'Compress to archive canceled.',
      'Set permissions canceled.'
    ].includes(text);
  }

  function isStableFilesStatusMessage(message) {
    const text = normalizeFilesStatusMessage(message);
    if (!text) return false;
    if (text === 'Ready.' || text === 'No active connection.' || text === 'Disconnected.' || text === 'Connection closed.') return true;
    if (/^Loaded [0-9][0-9,.]* items?\.$/i.test(text)) return true;
    return false;
  }

  function shouldAutoResetFilesStatusMessage(message, isError, showOutputLink) {
    const text = normalizeFilesStatusMessage(message);
    if (isError || showOutputLink || !text) return false;
    if (isStableFilesStatusMessage(text)) return false;
    if (/\b(failed|failure|error|canceled|cancelled|canceling|requires|required|cannot|can't|could not|not found|no active|no file transfer|already|skipped)\b/i.test(text)) return false;
    if (/\b(connecting|disconnecting|loading|opening|preparing|uploading|downloading|calculating|creating|copying|renaming|deleting|comparing|setting|changing|switching|saving|removing|waiting)\b/i.test(text)) return false;
    return true;
  }

  function createFilesStableStatusStateForKey(key) {
    const stored = filesStableStatusByConnectionId.get(key);
    if (stored && stored.message) return stored;
    return createFilesStatusState(false, getFilesStatusBaseMessage(key));
  }

  function createFilesStableStatusState(connectionId = '') {
    return createFilesStableStatusStateForKey(getStatusConnectionKey(connectionId));
  }

  function storeFilesStableStatusState(connectionId, state) {
    const key = getStatusConnectionKey(connectionId);
    const stableState = state || createFilesStatusState(false, getFilesStatusBaseMessage(key));
    filesStableStatusByConnectionId.set(key, stableState);
    return stableState;
  }

  function scheduleFilesStatusReset(connectionId, state, durationMs) {
    const duration = Number(durationMs || 0);
    if (!duration) return;
    const key = getStatusConnectionKey(connectionId);
    clearFilesStatusResetTimer(key);
    const token = (filesStatusResetTokensByConnectionId.get(key) || 0) + 1;
    filesStatusResetTokensByConnectionId.set(key, token);
    const timer = window.setTimeout(() => {
      if (token !== filesStatusResetTokensByConnectionId.get(key)) return;
      const currentState = filesStatusByConnectionId.get(key);
      if (currentState !== state || currentState.busy || currentState.isError) return;
      const resetState = createFilesStableStatusStateForKey(key);
      filesStatusByConnectionId.set(key, resetState);
      if (key === (activeConnectionId || FILES_STATUS_GLOBAL_KEY)) {
        applyFilesStatusState(resetState);
      }
      filesStatusResetTimersByConnectionId.delete(key);
    }, duration);
    filesStatusResetTimersByConnectionId.set(key, timer);
  }

  function updateTransferQueueState(payload) {
    transferQueueState = {
      current: payload && payload.current ? payload.current : null,
      currentTransfers: Array.isArray(payload && payload.currentTransfers) ? payload.currentTransfers : (payload && payload.current ? [payload.current] : []),
      pending: Array.isArray(payload && payload.pending) ? payload.pending : [],
      completed: Array.isArray(payload && payload.completed) ? payload.completed : []
    };
    pruneTransferQueuePendingActions();
    renderTransferQueueButton();
    renderRemoteSearchBadge();
    if (transferQueueModalOpen) renderTransferQueueModal();
  }


  function pruneTransferQueuePendingActions() {
    const activeIds = new Set((transferQueueState.currentTransfers || []).map(item => item && item.id).filter(Boolean));
    const pendingIds = new Set((transferQueueState.pending || []).map(item => item && item.id).filter(Boolean));

    Array.from(transferQueueCancelingIds).forEach(id => {
      if (!activeIds.has(id)) transferQueueCancelingIds.delete(id);
    });

    Array.from(transferQueueRemovingIds).forEach(id => {
      if (!pendingIds.has(id)) transferQueueRemovingIds.delete(id);
    });
  }

  function renderTransferQueueButton() {
    const pendingCount = transferQueueState.pending.length;
    const runningCount = (transferQueueState.currentTransfers || []).length;
    const completedCount = transferQueueState.completed.length;
    const transferCount = runningCount + pendingCount;
    const hasTransfers = transferCount > 0 || completedCount > 0;
    const hasActiveSession = Boolean(activeConnectionId);

    if (transferQueueCount) {
      transferQueueCount.textContent = String(transferCount);
    }

    if (transferQueueButton) {
      transferQueueButton.classList.toggle('has-pending', transferCount > 0);
      transferQueueButton.disabled = !hasActiveSession;
      transferQueueButton.setAttribute(
        'aria-label',
        !hasActiveSession
          ? 'Transfer Queue, connect to a host first'
          : hasTransfers
            ? ('Transfer Queue, ' + formatTransferQueueTooltip(transferCount, completedCount, pendingCount))
            : 'Transfer Queue, No Transfers'
      );
    }

    if (transferQueueTooltip) {
      transferQueueTooltip.dataset.tooltip = !hasActiveSession
        ? 'Connect to a Host to View Transfer Queue'
        : hasTransfers
          ? ('Transfer Queue - ' + formatTransferQueueTooltip(transferCount, completedCount, pendingCount))
          : 'Transfer Queue - No Transfers';
    }
  }

  function formatTransferCount(count) {
    return count + ' ' + (count === 1 ? 'transfer' : 'transfers');
  }

  function formatCompletedTransferCount(count) {
    return count + ' completed ' + (count === 1 ? 'transfer' : 'transfers');
  }

  function formatTransferQueueTooltip(activeCount, completedCount, pendingCount) {
    const parts = [];
    if (activeCount > 0) parts.push(formatTransferCount(activeCount));
    if (pendingCount > 0) parts.push(pendingCount + ' queued');
    if (completedCount > 0) parts.push(formatCompletedTransferCount(completedCount));
    return parts.length ? parts.join(', ') : '0 transfers';
  }

  function showTransferQueueModal() {
    transferQueueModalOpen = true;
    renderTransferQueueModal();
    transferQueueModal.classList.add('visible');
    transferQueueModal.setAttribute('aria-hidden', 'false');
    hideWebviewTooltip();
  }

  function hideTransferQueueModal() {
    transferQueueModalOpen = false;
    transferQueueModal.classList.remove('visible');
    transferQueueModal.setAttribute('aria-hidden', 'true');
  }

  function renderTransferQueueModal() {
    renderCurrentTransferQueueItem();
    renderPendingTransferQueueItems();
    renderCompletedTransferQueueItems();
  }

  function renderCurrentTransferQueueItem() {
    if (!transferQueueCurrent) return;

    const currentTransfers = transferQueueState.currentTransfers || [];

    if (!currentTransfers.length) {
      transferQueueCurrent.innerHTML = '<div class="transfer-queue-empty">No active transfer.</div>';
      return;
    }

    transferQueueCurrent.innerHTML = currentTransfers.map(current => {
      const isCanceling = transferQueueCancelingIds.has(current.id) || current.status === 'Canceling';
      return renderTransferQueueItem(current, {
        action: current.canCancel || isCanceling ? 'cancel-current' : '',
        actionLabel: isCanceling ? 'Canceling...' : 'Cancel',
        disabled: isCanceling || !current.canCancel
      });
    }).join('');
  }

  function renderPendingTransferQueueItems() {
    if (!transferQueuePending) return;

    const pending = transferQueueState.pending || [];

    if (!pending.length) {
      transferQueuePending.innerHTML = '<div class="transfer-queue-empty">No pending transfers.</div>';
      return;
    }

    transferQueuePending.innerHTML = pending.map(item => {
      const isRemoving = transferQueueRemovingIds.has(item.id);
      return renderTransferQueueItem(item, {
        action: 'remove-pending',
        actionLabel: isRemoving ? 'Removing...' : 'Remove',
        disabled: isRemoving
      });
    }).join('');
  }

  function renderCompletedTransferQueueItems() {
    if (!transferQueueCompleted) return;

    const completed = transferQueueState.completed || [];

    if (!completed.length) {
      transferQueueCompleted.innerHTML = '<div class="transfer-queue-empty">No completed transfers.</div>';
      return;
    }

    transferQueueCompleted.innerHTML = completed.slice().reverse().map(item => renderTransferQueueItem(item, {
      action: '',
      actionLabel: '',
      disabled: false
    })).join('');
  }

  function renderTransferQueueItem(item, actionOptions) {
    const operation = item.operation === 'Upload' ? 'Upload' : 'Download';
    const icon = item.operation === 'Upload' ? '↑' : '↓';
    const status = item.status === 'Waiting' && !item.canCancel ? 'Queued' : (item.status || 'Waiting');
    const progress = item.progress || (status === 'Queued' ? '--' : '');
    const timestamp = getTransferQueueTimestampLine(item, status);
    const timestampHtml = timestamp ? '<div class="transfer-queue-detail">' + escapeHtml(timestamp) + '</div>' : '';
    const from = item.from || '';
    const to = item.to || '';
    const action = actionOptions && actionOptions.action ? actionOptions.action : '';
    const actionLabel = actionOptions && actionOptions.actionLabel ? actionOptions.actionLabel : '';
    const disabled = actionOptions && actionOptions.disabled;
    const actionHtml = action
      ? '<button class="secondary" type="button" data-transfer-action="' + escapeHtml(action) + '" data-transfer-id="' + escapeHtml(item.id || '') + '"' + (disabled ? ' disabled' : '') + '>' + escapeHtml(actionLabel) + '</button>'
      : '';
    const failedItemsHtml = renderTransferQueueFailedItems(item);
    const canceledItemsHtml = renderTransferQueueCanceledItems(item);

    return '<div class="transfer-queue-item">' +
      '<div class="transfer-queue-item-main">' +
      '<div class="transfer-queue-item-title"><span class="transfer-queue-icon" aria-hidden="true">' + icon + '</span><span class="transfer-queue-name">' + escapeHtml(operation) + '</span></div>' +
      '<div class="transfer-queue-detail">Connection: ' + escapeHtml(item.connection || '') + '</div>' +
      '<div class="transfer-queue-detail">From: ' + escapeHtml(from) + '</div>' +
      '<div class="transfer-queue-detail">To: ' + escapeHtml(to) + '</div>' +
      timestampHtml +
      '<div class="transfer-queue-status">Status: ' + escapeHtml(formatTransferQueueSentence(status)) + '</div>' +
      '<div class="transfer-queue-progress">Progress: ' + escapeHtml(formatTransferQueueSentence(progress)) + '</div>' +
      failedItemsHtml +
      canceledItemsHtml +
      '</div>' +
      '<div class="transfer-queue-actions">' + actionHtml + '</div>' +
      '</div>';
  }

  function renderTransferQueueFailedItems(item) {
    const failedItems = Array.isArray(item && item.failedItems) ? item.failedItems : [];
    if (!failedItems.length) return '';

    const visibleItems = failedItems.slice(0, 5);
    const remainingCount = failedItems.length - visibleItems.length;
    const failedRows = visibleItems.map(failedItem => {
      const parsed = parseTransferFailedItem(failedItem);
      const detailHtml = parsed.detail
        ? '<div class="transfer-queue-failed-error">' + escapeHtml(parsed.detail) + '</div>'
        : '';

      return '<div class="transfer-queue-failed-item tooltip-above" data-tooltip="' + escapeHtml(parsed.raw) + '">' +
        '<div class="transfer-queue-failed-path">- ' + escapeHtml(parsed.path) + '</div>' +
        detailHtml +
        '</div>';
    }).join('');
    const moreRow = remainingCount > 0
      ? '<div class="transfer-queue-failed-more">...and ' + remainingCount + ' more</div>'
      : '';

    return '<div class="transfer-queue-failed-items">' +
      '<div class="transfer-queue-failed-title">Failed items</div>' +
      failedRows +
      moreRow +
      '</div>';
  }


  function renderTransferQueueCanceledItems(item) {
    const canceledItems = Array.isArray(item && item.canceledItems) ? item.canceledItems : [];
    if (!canceledItems.length) return '';

    const visibleItems = canceledItems.slice(0, 5);
    const remainingCount = canceledItems.length - visibleItems.length;
    const canceledRows = visibleItems.map(canceledItem => {
      const parsed = parseTransferFailedItem(canceledItem);
      const detailHtml = parsed.detail
        ? '<div class="transfer-queue-canceled-error">' + escapeHtml(parsed.detail) + '</div>'
        : '';

      return '<div class="transfer-queue-canceled-item tooltip-above" data-tooltip="' + escapeHtml(parsed.raw) + '">' +
        '<div class="transfer-queue-canceled-path">- ' + escapeHtml(parsed.path) + '</div>' +
        detailHtml +
        '</div>';
    }).join('');
    const moreRow = remainingCount > 0
      ? '<div class="transfer-queue-canceled-more">...and ' + remainingCount + ' more</div>'
      : '';

    return '<div class="transfer-queue-canceled-items">' +
      '<div class="transfer-queue-canceled-title">Canceled items</div>' +
      canceledRows +
      moreRow +
      '</div>';
  }

  function parseTransferFailedItem(failedItem) {
    const raw = String(failedItem || '');
    const separatorIndex = raw.indexOf(': ');

    if (separatorIndex <= 0) {
      return { raw, path: raw, detail: '' };
    }

    return {
      raw,
      path: raw.slice(0, separatorIndex),
      detail: raw.slice(separatorIndex + 2)
    };
  }

  function getTransferQueueTimestampLine(item, status) {
    if (item.finishedAt) {
      if (status === 'Failed') return 'Failed at: ' + item.finishedAt;
      if (status === 'Canceled') return 'Canceled at: ' + item.finishedAt;
      return 'Completed at: ' + item.finishedAt;
    }

    if (item.startedAt) {
      return 'Started at: ' + item.startedAt;
    }

    if (item.queuedAt) {
      return 'Queued at: ' + item.queuedAt;
    }

    return '';
  }

  function formatTransferQueueSentence(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text === '--') return text;
    return /[.!?…]$/.test(text) ? text : text + '.';
  }

  function getStatusCopyText() {
    const text = String(statusText && statusText.textContent ? statusText.textContent : '').trim();
    const outputText = statusOutputLink && !statusOutputLink.hidden ? String(statusOutputLink.textContent || '').trim() : '';
    return [text, outputText].filter(Boolean).join(' ');
  }

  function getStatusConnectionKey(connectionId) {
    const key = String(connectionId || '').trim();
    if (key === FILES_STATUS_GLOBAL_KEY) return FILES_STATUS_GLOBAL_KEY;
    return key || (activeConnectionId || FILES_STATUS_GLOBAL_KEY);
  }

  function shouldApplyFilesStatusForTarget(connectionId) {
    const targetConnectionId = String(connectionId || '').trim();
    if (!targetConnectionId) return true;
    if (targetConnectionId === FILES_STATUS_GLOBAL_KEY) return !activeConnectionId;
    return targetConnectionId === activeConnectionId;
  }

  function createFilesStatusState(isBusy, message, options = {}) {
    return {
      busy: Boolean(isBusy),
      message: sanitizeFilesStatusMessage(message),
      isError: Boolean(options.isError),
      showOutputLink: Boolean(options.showOutputLink),
      outputLinkText: String(options.outputLinkText || 'See details in Output.'),
      cancelAction: Boolean(isBusy) ? String(options.cancelAction || '') : '',
      cancelLabel: String(options.cancelLabel || 'Cancel')
    };
  }

  function applyFilesStatusState(state) {
    const nextState = state || createFilesStableStatusState();
    busy = Boolean(nextState.busy);
    statusCancelAction = busy ? String(nextState.cancelAction || '') : '';
    statusCancelLabel = String(nextState.cancelLabel || 'Cancel');
    if (!busy && isConnectionTransitionBusy()) {
      connectionButtonState = '';
    }
    setControls();
    statusText.textContent = nextState.message || getFilesStatusBaseMessage();
    setStatusOutputLink(Boolean(nextState.showOutputLink), nextState.outputLinkText || 'See details in Output.');
    status.className = busy ? 'statusbar busy' : (nextState.isError ? 'statusbar error' : 'statusbar');
  }

  function storeFilesStatusState(connectionId, state) {
    const key = getStatusConnectionKey(connectionId);
    filesStatusByConnectionId.set(key, state);
  }

  function restoreFilesStatusForActiveConnection() {
    const key = activeConnectionId || FILES_STATUS_GLOBAL_KEY;
    const stored = filesStatusByConnectionId.get(key);
    applyFilesStatusState(stored || createFilesStableStatusStateForKey(key));
  }

  function setFilesLoadedStatusForConnection(connectionId, entries) {
    const targetConnectionId = String(connectionId || '').trim();
    const state = createFilesStatusState(false, formatFilesLoadedStatusMessage(getFilesLoadedCountFromEntries(entries)));
    storeFilesStableStatusState(targetConnectionId, state);
    storeFilesStatusState(targetConnectionId, state);
    clearFilesStatusResetTimer(getStatusConnectionKey(targetConnectionId));
    if (shouldApplyFilesStatusForTarget(targetConnectionId)) applyFilesStatusState(state);
  }

  function setBusy(isBusy, message, cancelAction = '', cancelLabel = 'Cancel', connectionId = '') {
    const targetConnectionId = String(connectionId || '').trim();
    const busyState = Boolean(isBusy);
    const statusMessage = !busyState && isSilentFilesStatusMessage(message) ? '' : message;
    const state = statusMessage
      ? createFilesStatusState(busyState, statusMessage, { cancelAction, cancelLabel })
      : createFilesStableStatusState(targetConnectionId);
    if (!busyState && statusMessage && isStableFilesStatusMessage(state.message)) {
      storeFilesStableStatusState(targetConnectionId, state);
    }
    storeFilesStatusState(targetConnectionId, state);
    const autoReset = !busyState && statusMessage && shouldAutoResetFilesStatusMessage(state.message, false, false);
    if (busyState || !autoReset) {
      clearFilesStatusResetTimer(getStatusConnectionKey(targetConnectionId));
    } else {
      scheduleFilesStatusReset(targetConnectionId, state, FILES_STATUS_TRANSIENT_DURATION_MS);
    }
    if (!shouldApplyFilesStatusForTarget(targetConnectionId)) return;
    if (busyState) {
      hideContextMenu();
    }
    applyFilesStatusState(state);
  }

  function setStatus(message, isError = false, showOutputLink = false, outputLinkText = 'See details in Output.', connectionId = '') {
    const targetConnectionId = String(connectionId || '').trim();
    const statusMessage = !isError && !showOutputLink && isSilentFilesStatusMessage(message) ? '' : message;
    const state = statusMessage
      ? createFilesStatusState(false, statusMessage, { isError, showOutputLink, outputLinkText })
      : createFilesStableStatusState(targetConnectionId);
    if (!isError && !showOutputLink && statusMessage && isStableFilesStatusMessage(state.message)) {
      storeFilesStableStatusState(targetConnectionId, state);
    }
    storeFilesStatusState(targetConnectionId, state);
    const autoReset = statusMessage && shouldAutoResetFilesStatusMessage(state.message, isError, showOutputLink);
    if (isError || showOutputLink || !autoReset) {
      clearFilesStatusResetTimer(getStatusConnectionKey(targetConnectionId));
    } else {
      scheduleFilesStatusReset(targetConnectionId, state, FILES_STATUS_TRANSIENT_DURATION_MS);
    }
    if (!shouldApplyFilesStatusForTarget(targetConnectionId)) return;
    applyFilesStatusState(state);
  }

  function setStatusOutputLink(show, text = 'See details in Output.') {
    if (!statusOutputLink) return;
    statusOutputLink.hidden = !show;
    statusOutputLink.textContent = text || 'See details in Output.';
    statusOutputLink.setAttribute('aria-label', text || 'See details in Output.');
  }

  function canStartTransferAction() {
    return !busy || statusCancelAction === 'transfer';
  }

  function setControls(options) {
    options = options || {};
    const animateToolbarLayout = options.animateToolbarLayout !== false;
    const activeSession = getActiveSession();
    const hasActiveSession = Boolean(activeConnectionId && isSessionConnected(activeSession));
    const connectedSession = getConnectedSessionForCurrentForm();
    const isConnectedForm = Boolean(connectedSession);
    const pendingFormSession = getPendingSessionForCurrentForm();
    const hasConnectingSession = hasAnyConnectingSession();
    const shouldLockConnectionPicker = false;
    const shouldLockConnectionDetails = isConnectedForm || Boolean(pendingFormSession) || hasConnectingSession || connectionButtonState === 'disconnecting';
    const isSftpConnectionMethod = isSftpFormConnection();
    const capabilities = getActiveRemoteCapabilities();
    const activeView = getActiveConnectionView();
    const showServerRefreshControls = activeView === 'server' && hasActiveSession && isServerViewSupported(activeSession);
    const showRunRemoteCommand = capabilities.canRunCommand;
    const showSshTerminal = capabilities.canOpenSshTerminal;
    const showLogViewer = showSshTerminal;
    const showSudoMode = capabilities.canUseSudo;
    const showConnectionViewSwitch = !activeSession || isSessionConnected(activeSession) && isServerViewSupported(activeSession);
    const nextToolbarCapabilityState = (showServerRefreshControls ? '1' : '0') + ':' + (showRunRemoteCommand ? '1' : '0') + ':' + (showSshTerminal ? '1' : '0') + ':' + (showSudoMode ? '1' : '0') + ':' + (showConnectionViewSwitch ? '1' : '0');
    const shouldAnimateToolbarLayout = animateToolbarLayout && Boolean(toolbarCapabilityState && toolbarCapabilityState !== nextToolbarCapabilityState);
    const toolbarLayoutSnapshot = shouldAnimateToolbarLayout ? prepareToolbarLayoutTransition() : null;

    if (pathbar) {
      pathbar.classList.toggle('hide-command-actions', false);
      pathbar.classList.toggle('hide-sudo-actions', !showSudoMode);
      pathbar.classList.toggle('hide-view-switch-actions', !showConnectionViewSwitch);
    }
    if (serverRefreshActions) serverRefreshActions.hidden = !showServerRefreshControls;
    if (serverRefreshActionsSeparator) serverRefreshActionsSeparator.hidden = !showServerRefreshControls;
    if (serverRefreshButton) serverRefreshButton.disabled = !showServerRefreshControls;
    if (serverAutoRefreshDropdownButton) serverAutoRefreshDropdownButton.disabled = !showServerRefreshControls;
    if (!showServerRefreshControls) hideServerAutoRefreshDropdown();
    if (commandActions) commandActions.style.display = '';
    if (commandActionsSeparator) commandActionsSeparator.style.display = '';
    if (runRemoteCommandAction) runRemoteCommandAction.style.display = showRunRemoteCommand ? '' : 'none';
    if (openSshTerminalAction) openSshTerminalAction.style.display = showSshTerminal ? '' : 'none';
    if (openLogViewerAction) openLogViewerAction.style.display = showLogViewer ? '' : 'none';
    if (transferActionsSeparator) transferActionsSeparator.style.display = '';
    if (sudoToggleLabel) sudoToggleLabel.style.display = showSudoMode ? '' : 'none';
    if (sudoToggleSeparator) sudoToggleSeparator.style.display = showSudoMode ? '' : 'none';
    toolbarCapabilityState = nextToolbarCapabilityState;
    if (shouldAnimateToolbarLayout) finishToolbarLayoutTransition(toolbarLayoutSnapshot);

    connectButton.disabled = Boolean(pendingFormSession) || connectionButtonState === 'disconnecting';
    connectButton.textContent = pendingFormSession
      ? 'Connecting...'
      : connectionButtonState === 'disconnecting'
        ? 'Disconnecting...'
        : (isConnectedForm ? 'Disconnect' : 'Connect');
    connectButton.classList.toggle('secondary', isConnectedForm || connectionButtonState === 'disconnecting');

    const selectedSavedConnectionDirty = updateConnectionProfileDirtyState();
    saveProfileButton.disabled = isConnectedForm || Boolean(pendingFormSession) || hasConnectingSession || (Boolean(getSelectedSavedProfile()) && !selectedSavedConnectionDirty);
    profileSelect.disabled = shouldLockConnectionPicker;
    profileDropdownButton.disabled = shouldLockConnectionPicker && !profileDropdownOpen;
    manageProfilesButton.disabled = false;
    showSettingsButton.disabled = false;
    showOutputButton.disabled = false;

    const hasStatusCancelAction = Boolean(statusCancelAction);
    statusCancelButton.hidden = !hasStatusCancelAction;
    statusCancelButton.disabled = !hasStatusCancelAction;
    statusCancelButton.textContent = statusCancelLabel || 'Cancel';
    statusCancelButton.setAttribute('aria-label', statusCancelLabel || 'Cancel Current Operation');
    statusCancelButton.setAttribute('data-tooltip', statusCancelLabel || 'Cancel Current Operation');

    for (const control of getConnectionDetailControls()) {
      control.disabled = shouldLockConnectionDetails;
    }

    if (authDropdownButton) authDropdownButton.disabled = shouldLockConnectionDetails || !isSftpConnectionMethod;
    if (authType) authType.disabled = shouldLockConnectionDetails || !isSftpConnectionMethod;
    if (shouldLockConnectionDetails) {
      hideTemporaryPassword(password);
      hideTemporaryPassword(passphrase);
    }
    updateConnectionCredentialRevealControls();
    if (connectButton) connectButton.removeAttribute('data-tooltip');
    updateFtpsCertificateFields(shouldLockConnectionDetails);

    if (shouldLockConnectionDetails || !connectionTypeDropdownButton || connectionTypeDropdownButton.disabled) hideConnectionTypeDropdown();
    if (shouldLockConnectionDetails || !authDropdownButton || authDropdownButton.disabled) hideAuthDropdown();
    currentPath.disabled = busy || !hasActiveSession;
    if (currentPath.disabled && remotePathEditing) {
      exitRemotePathEditMode({ reset: true, keepFocus: true });
    }
    updateRemotePathBreadcrumb();
    filterInput.disabled = busy || !hasActiveSession;
    if (runRemoteCommandButton) runRemoteCommandButton.disabled = busy || !hasActiveSession || !capabilities.canRunCommand;
    if (openLogViewerButton) openLogViewerButton.disabled = busy || !hasActiveSession || !capabilities.canOpenSshTerminal;
    if (openSshTerminalButton) openSshTerminalButton.disabled = busy || !hasActiveSession || !capabilities.canOpenSshTerminal;
    if (remoteSearchButton) remoteSearchButton.disabled = !hasActiveSession;
    updateFilterClearButton();
    updateTransferButtons();
    renderTransferQueueButton();
    renderRemoteSearchBadge();
    renderRemoteCommandBadge();
    renderLogViewerBadge();
    updatePathFavoriteControls();
    updateRemotePathBreadcrumb();
    uploadButton.disabled = !canStartTransferAction() || !hasActiveSession;
    goButton.disabled = busy || !hasActiveSession;
    updateRemotePathActionButton();
    updateRemotePathNavigationControls();
    sudoToggle.disabled = busy || !hasActiveSession || !capabilities.canUseSudo;
    updateSudoToggle();
    updateConnectionViewUi();
    scheduleRemotePathLayoutUpdate();
  }


  function updateTransferButtons() {
    const hasActiveSession = Boolean(activeConnectionId);
    if (uploadButton) uploadButton.disabled = !canStartTransferAction() || !hasActiveSession;
    if (downloadButton) downloadButton.disabled = !canStartTransferAction() || !hasActiveSession || getSelectedActionEntries().length === 0;
    renderTransferQueueButton();
    renderRemoteSearchBadge();
    renderRemoteCommandBadge();
    renderLogViewerBadge();
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
`;}
