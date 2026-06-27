export function renderDragDropTargets(): string {
  return `  const DROP_TARGET_AUTO_OPEN_DELAY_MS = 1200;
  let fileListDragTargetRow = null;
  let fileListDragTargetAutoOpenTimer = 0;
  let fileListDragTargetAutoOpenPath = '';
  let fileListDragTargetAutoOpenConnectionId = '';
  let fileListDragTargetStaleCleanupTimer = 0;
  let fileListDragTargetLastActivityAt = 0;

  function canAcceptFileListDragTarget() {
    return Boolean(activeConnectionId) && canStartTransferAction() && getActiveConnectionView() === 'files';
  }

  function isFileListDragTarget(event) {
    return Boolean(event && event.target instanceof Element && entriesTableWrap && entriesTableWrap.contains(event.target));
  }

  function getFileListDragTargetDirectory(event) {
    const row = getEntryRowFromEvent(event);
    const entry = row ? findCurrentEntryByPath(row.dataset.entryPath || '') : null;

    if (entry && isDirectoryLike(entry) && entry.path) {
      return { path: normalizeUiRemotePath(entry.path), row: row, entry: entry };
    }

    return { path: normalizeUiRemotePath(currentPath.value || '/'), row: null, entry: null };
  }

  function clearFileListDragTargetAutoOpenTimer() {
    if (fileListDragTargetAutoOpenTimer) {
      window.clearTimeout(fileListDragTargetAutoOpenTimer);
      fileListDragTargetAutoOpenTimer = 0;
    }

    fileListDragTargetAutoOpenPath = '';
    fileListDragTargetAutoOpenConnectionId = '';
  }

  function scheduleFileListDragTargetAutoOpen(target, canAcceptTarget) {
    const canAccept = typeof canAcceptTarget === 'function' ? canAcceptTarget : canAcceptFileListDragTarget;
    const targetPath = normalizeUiRemotePath(target && target.path || '');
    const currentDirectory = normalizeUiRemotePath(currentPath.value || '/');

    if (!target || !target.row || !targetPath || targetPath === currentDirectory || busy || !canAccept()) {
      clearFileListDragTargetAutoOpenTimer();
      return;
    }

    if (fileListDragTargetAutoOpenTimer && fileListDragTargetAutoOpenPath === targetPath && fileListDragTargetAutoOpenConnectionId === activeConnectionId) {
      return;
    }

    clearFileListDragTargetAutoOpenTimer();
    fileListDragTargetAutoOpenPath = targetPath;
    fileListDragTargetAutoOpenConnectionId = activeConnectionId || '';
    fileListDragTargetAutoOpenTimer = window.setTimeout(() => {
      fileListDragTargetAutoOpenTimer = 0;

      if (!fileListDragTargetAutoOpenPath || fileListDragTargetAutoOpenConnectionId !== activeConnectionId) {
        clearFileListDragTargetAutoOpenTimer();
        return;
      }

      const pathToOpen = fileListDragTargetAutoOpenPath;
      clearFileListDragTargetAutoOpenTimer();

      if (!canAccept() || busy || normalizeUiRemotePath(currentPath.value || '/') === pathToOpen) {
        return;
      }

      setFileListDragTargetState(false, null);
      listDirectory(pathToOpen);
    }, DROP_TARGET_AUTO_OPEN_DELAY_MS);
  }

  function setFileListDragTargetState(active, targetRow) {
    if (!entriesTableWrap) return;
    entriesTableWrap.classList.toggle('drag-drop-target-active', Boolean(active));

    if (fileListDragTargetRow && fileListDragTargetRow !== targetRow) {
      fileListDragTargetRow.classList.remove('drop-target');
    }

    fileListDragTargetRow = targetRow || null;

    if (fileListDragTargetRow) {
      fileListDragTargetRow.classList.add('drop-target');
    }
  }

  function clearFileListDragTargetStaleCleanupTimer() {
    if (fileListDragTargetStaleCleanupTimer) {
      window.clearTimeout(fileListDragTargetStaleCleanupTimer);
      fileListDragTargetStaleCleanupTimer = 0;
    }
  }

  function scheduleFileListDragTargetStaleCleanup() {
    if (fileListDragTargetStaleCleanupTimer) return;

    fileListDragTargetStaleCleanupTimer = window.setTimeout(() => {
      fileListDragTargetStaleCleanupTimer = 0;

      if (!fileListDragTargetLastActivityAt || Date.now() - fileListDragTargetLastActivityAt > 1500) {
        clearFileListDragTargetState();
        return;
      }

      scheduleFileListDragTargetStaleCleanup();
    }, 500);
  }

  function markFileListDragTargetActivity() {
    fileListDragTargetLastActivityAt = Date.now();
    scheduleFileListDragTargetStaleCleanup();
  }

  function clearFileListDragTargetState() {
    fileListDragTargetLastActivityAt = 0;
    clearFileListDragTargetStaleCleanupTimer();
    clearFileListDragTargetAutoOpenTimer();
    setFileListDragTargetState(false, null);
  }

  window.addEventListener('blur', clearFileListDragTargetState);
  window.addEventListener('dragend', clearFileListDragTargetState);
  document.addEventListener('drop', clearFileListDragTargetState, true);
  document.addEventListener('keyup', event => {
    if (event.key === 'Escape') {
      clearFileListDragTargetState();
    }
  });
`;
}
