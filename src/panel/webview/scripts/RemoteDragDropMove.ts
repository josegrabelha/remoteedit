export function renderRemoteDragDropMove(): string {
  return `  const REMOTE_MOVE_DRAG_MIME = 'application/x-remoteedit-remote-move';
  let remoteMoveDragPayload = null;

  function getDataTransferTypes(event) {
    return event && event.dataTransfer ? Array.from(event.dataTransfer.types || []).map(type => String(type || '').toLowerCase()) : [];
  }

  function isRemoteMoveDrag(event) {
    return getDataTransferTypes(event).includes(REMOTE_MOVE_DRAG_MIME);
  }

  function canStartRemoteMoveDrag() {
    return canAcceptFileListDragTarget();
  }

  function canAcceptRemoteMoveDrop() {
    return Boolean(remoteMoveDragPayload && remoteMoveDragPayload.connectionId === activeConnectionId && canAcceptFileListDragTarget());
  }

  function buildRemoteMoveDragPayload(entries) {
    const items = (Array.isArray(entries) ? entries : [])
      .filter(entry => entry && !isParentEntry(entry))
      .map(actionPayload)
      .filter(entry => entry && entry.path && entry.name && entry.name !== '..');

    if (!items.length) {
      return null;
    }

    return {
      connectionId: activeConnectionId,
      items: items
    };
  }

  function handleRemoteMoveDragStart(event) {
    if (!canStartRemoteMoveDrag()) return;

    const row = getEntryRowFromEvent(event);
    if (!row) return;

    const entryKey = row.dataset.entryPath || '';
    const entry = findCurrentEntryByPath(entryKey);

    if (!entry || isParentEntry(entry)) {
      event.preventDefault();
      return;
    }

    if (!selectedEntryPaths.has(entryKey)) {
      selectEntry(entryKey);
    }

    const payload = buildRemoteMoveDragPayload(getSelectedActionEntries());

    if (!payload) {
      event.preventDefault();
      return;
    }

    remoteMoveDragPayload = payload;
    row.classList.add('drag-source');

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(REMOTE_MOVE_DRAG_MIME, JSON.stringify(payload));
      event.dataTransfer.setData('text/plain', payload.items.map(item => item.name || item.path).join('\\n'));
    }
  }

  function clearRemoteMoveDragSourceState() {
    if (entriesBody) {
      entriesBody.querySelectorAll('tr.entry-row.drag-source').forEach(row => row.classList.remove('drag-source'));
    }
  }

  function clearRemoteMoveDragState() {
    clearRemoteMoveDragSourceState();
    clearFileListDragTargetState();
    remoteMoveDragPayload = null;
  }

  function handleRemoteMoveDragEnter(event) {
    if (!isRemoteMoveDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    markFileListDragTargetActivity();

    if (!canAcceptRemoteMoveDrop() || !isFileListDragTarget(event)) {
      clearFileListDragTargetAutoOpenTimer();
      setFileListDragTargetState(false, null);
      return;
    }

    const target = getFileListDragTargetDirectory(event);
    setFileListDragTargetState(true, target.row);
    scheduleFileListDragTargetAutoOpen(target, canAcceptRemoteMoveDrop);
  }

  function handleRemoteMoveDragOver(event) {
    if (!isRemoteMoveDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    markFileListDragTargetActivity();

    if (!canAcceptRemoteMoveDrop() || !isFileListDragTarget(event)) {
      event.dataTransfer.dropEffect = 'none';
      clearFileListDragTargetAutoOpenTimer();
      setFileListDragTargetState(false, null);
      return;
    }

    event.dataTransfer.dropEffect = 'move';
    const target = getFileListDragTargetDirectory(event);
    setFileListDragTargetState(true, target.row);
    scheduleFileListDragTargetAutoOpen(target, canAcceptRemoteMoveDrop);
  }

  function handleRemoteMoveDragLeave(event) {
    if (!isRemoteMoveDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && filesView && filesView.contains(nextTarget)) {
      return;
    }

    clearFileListDragTargetState();
  }

  function readRemoteMoveDropPayload(event) {
    if (remoteMoveDragPayload) {
      return remoteMoveDragPayload;
    }

    try {
      const raw = event && event.dataTransfer ? event.dataTransfer.getData(REMOTE_MOVE_DRAG_MIME) : '';
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function handleRemoteMoveDrop(event) {
    if (!isRemoteMoveDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const insideFileList = isFileListDragTarget(event);
    const target = insideFileList ? getFileListDragTargetDirectory(event) : null;
    const payload = readRemoteMoveDropPayload(event);
    clearRemoteMoveDragState();

    if (!canAcceptFileListDragTarget()) {
      setStatus('Connect to a remote folder before moving items.', true);
      return;
    }

    if (!payload || payload.connectionId !== activeConnectionId || !Array.isArray(payload.items) || !payload.items.length) {
      setStatus('Remote drag-and-drop move is only available in the original connection.', true);
      return;
    }

    if (!insideFileList || !target) {
      setStatus('Drop remote items into the file list or onto a folder to move them.', true);
      return;
    }

    invalidateActiveFileListSnapshotForMutation();
    vscode.postMessage({
      type: 'requestMoveRemoteEntries',
      payload: {
        connectionId: activeConnectionId,
        targetDirectory: target.path,
        entries: payload.items
      }
    });
  }

  if (entriesBody) {
    entriesBody.addEventListener('dragstart', handleRemoteMoveDragStart);
  }

  if (filesView && entriesTableWrap) {
    filesView.addEventListener('dragenter', handleRemoteMoveDragEnter);
    filesView.addEventListener('dragover', handleRemoteMoveDragOver);
    filesView.addEventListener('dragleave', handleRemoteMoveDragLeave);
    filesView.addEventListener('drop', handleRemoteMoveDrop);
  }

  window.addEventListener('blur', clearRemoteMoveDragState);
  window.addEventListener('dragend', clearRemoteMoveDragState);
`;
}
