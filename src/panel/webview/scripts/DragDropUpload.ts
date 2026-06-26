export function renderDragDropUpload(): string {
  return `  const DROP_UPLOAD_CHUNK_SIZE = 512 * 1024;
  const DROP_UPLOAD_AUTO_OPEN_DELAY_MS = 1200;
  let dragDropUploadTargetRow = null;
  let dragDropUploadAutoOpenTimer = 0;
  let dragDropUploadAutoOpenPath = '';
  let dragDropUploadAutoOpenConnectionId = '';
  let dragDropUploadStaleCleanupTimer = 0;
  let dragDropUploadLastActivityAt = 0;
  let dragDropUploadWaiters = [];

  function isLocalFileDrag(event) {
    const types = event && event.dataTransfer ? Array.from(event.dataTransfer.types || []) : [];
    return types.includes('Files');
  }

  function canAcceptLocalFileDrop() {
    return Boolean(activeConnectionId) && canStartTransferAction() && getActiveConnectionView() === 'files';
  }

  function getDroppedFileLocalPath(file) {
    return String(file && (file.path || file.mozFullPath || file.msFullPath) || '').trim();
  }

  function normalizeDroppedRelativePath(value) {
    return String(value || '').split(String.fromCharCode(92)).join('/').split('/').filter(Boolean).join('/');
  }

  function getDropTargetDirectory(event) {
    const row = getEntryRowFromEvent(event);
    const entry = row ? findCurrentEntryByPath(row.dataset.entryPath || '') : null;

    if (entry && isDirectoryLike(entry) && entry.path) {
      return { path: normalizeUiRemotePath(entry.path), row: row, entry: entry };
    }

    return { path: normalizeUiRemotePath(currentPath.value || '/'), row: null, entry: null };
  }

  function clearDragDropUploadAutoOpenTimer() {
    if (dragDropUploadAutoOpenTimer) {
      window.clearTimeout(dragDropUploadAutoOpenTimer);
      dragDropUploadAutoOpenTimer = 0;
    }

    dragDropUploadAutoOpenPath = '';
    dragDropUploadAutoOpenConnectionId = '';
  }

  function scheduleDragDropUploadAutoOpen(target) {
    const targetPath = normalizeUiRemotePath(target && target.path || '');
    const currentDirectory = normalizeUiRemotePath(currentPath.value || '/');

    if (!target || !target.row || !targetPath || targetPath === currentDirectory || busy || !canAcceptLocalFileDrop()) {
      clearDragDropUploadAutoOpenTimer();
      return;
    }

    if (dragDropUploadAutoOpenTimer && dragDropUploadAutoOpenPath === targetPath && dragDropUploadAutoOpenConnectionId === activeConnectionId) {
      return;
    }

    clearDragDropUploadAutoOpenTimer();
    dragDropUploadAutoOpenPath = targetPath;
    dragDropUploadAutoOpenConnectionId = activeConnectionId || '';
    dragDropUploadAutoOpenTimer = window.setTimeout(() => {
      dragDropUploadAutoOpenTimer = 0;

      if (!dragDropUploadAutoOpenPath || dragDropUploadAutoOpenConnectionId !== activeConnectionId) {
        clearDragDropUploadAutoOpenTimer();
        return;
      }

      const pathToOpen = dragDropUploadAutoOpenPath;
      clearDragDropUploadAutoOpenTimer();

      if (!canAcceptLocalFileDrop() || busy || normalizeUiRemotePath(currentPath.value || '/') === pathToOpen) {
        return;
      }

      setDragDropUploadState(false, null);
      listDirectory(pathToOpen);
    }, DROP_UPLOAD_AUTO_OPEN_DELAY_MS);
  }

  function setDragDropUploadState(active, targetRow) {
    if (!entriesTableWrap) return;
    entriesTableWrap.classList.toggle('drag-drop-upload-active', Boolean(active));

    if (dragDropUploadTargetRow && dragDropUploadTargetRow !== targetRow) {
      dragDropUploadTargetRow.classList.remove('drop-target');
    }

    dragDropUploadTargetRow = targetRow || null;

    if (dragDropUploadTargetRow) {
      dragDropUploadTargetRow.classList.add('drop-target');
    }
  }

  function isDropInFileList(event) {
    return Boolean(event && event.target instanceof Element && entriesTableWrap && entriesTableWrap.contains(event.target));
  }

  function clearDragDropUploadStaleCleanupTimer() {
    if (dragDropUploadStaleCleanupTimer) {
      window.clearTimeout(dragDropUploadStaleCleanupTimer);
      dragDropUploadStaleCleanupTimer = 0;
    }
  }

  function scheduleDragDropUploadStaleCleanup() {
    if (dragDropUploadStaleCleanupTimer) return;

    dragDropUploadStaleCleanupTimer = window.setTimeout(() => {
      dragDropUploadStaleCleanupTimer = 0;

      if (!dragDropUploadLastActivityAt || Date.now() - dragDropUploadLastActivityAt > 1500) {
        clearDragDropUploadState();
        return;
      }

      scheduleDragDropUploadStaleCleanup();
    }, 500);
  }

  function markDragDropUploadActivity() {
    dragDropUploadLastActivityAt = Date.now();
    scheduleDragDropUploadStaleCleanup();
  }

  function clearDragDropUploadState() {
    dragDropUploadLastActivityAt = 0;
    clearDragDropUploadStaleCleanupTimer();
    clearDragDropUploadAutoOpenTimer();
    setDragDropUploadState(false, null);
  }

  function createDroppedUploadSessionId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function waitForDroppedUploadMessage(type, sessionId, predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = {
        type: type,
        sessionId: sessionId,
        predicate: predicate,
        resolve: resolve,
        reject: reject,
        timer: window.setTimeout(() => {
          dragDropUploadWaiters = dragDropUploadWaiters.filter(item => item !== waiter);
          reject(new Error('Timed out while preparing dropped upload.'));
        }, timeoutMs || 60000)
      };

      dragDropUploadWaiters.push(waiter);
    });
  }

  function handleDroppedUploadBackendMessage(message) {
    if (!message || !message.type) return;
    const payload = message.payload || {};

    for (const waiter of dragDropUploadWaiters.slice()) {
      if (waiter.type !== message.type) continue;
      if (waiter.sessionId && waiter.sessionId !== payload.sessionId) continue;
      if (waiter.predicate && !waiter.predicate(payload)) continue;

      window.clearTimeout(waiter.timer);
      dragDropUploadWaiters = dragDropUploadWaiters.filter(item => item !== waiter);
      waiter.resolve(payload);
      return;
    }
  }

  window.addEventListener('message', event => {
    handleDroppedUploadBackendMessage(event.data || {});
  });

  function readDroppedFileEntry(fileEntry) {
    return new Promise((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
  }

  function readDroppedDirectoryEntries(directoryEntry) {
    const reader = directoryEntry.createReader();
    const entries = [];

    return new Promise((resolve, reject) => {
      const readBatch = () => {
        reader.readEntries(batch => {
          if (!batch.length) {
            resolve(entries);
            return;
          }

          entries.push(...batch);
          readBatch();
        }, reject);
      };

      readBatch();
    });
  }

  async function collectDroppedEntry(entry, relativeRoot, result) {
    const relativePath = normalizeDroppedRelativePath(relativeRoot ? relativeRoot + '/' + entry.name : entry.name);

    if (entry.isDirectory) {
      result.items.push({ kind: 'directory', relativePath: relativePath });
      const children = await readDroppedDirectoryEntries(entry);

      for (const child of children) {
        await collectDroppedEntry(child, relativePath, result);
      }

      return;
    }

    if (!entry.isFile) {
      return;
    }

    const file = await readDroppedFileEntry(entry);
    const localPath = getDroppedFileLocalPath(file);

    result.items.push({
      kind: 'file',
      file: file,
      localPath: localPath || '',
      relativePath: relativePath,
      size: Number(file.size || 0)
    });
  }

  async function collectDroppedFiles(dataTransfer) {
    const result = { items: [] };
    const transferItems = Array.from(dataTransfer && dataTransfer.items || []);
    const supportsEntries = transferItems.some(item => typeof item.webkitGetAsEntry === 'function');

    if (supportsEntries) {
      for (const item of transferItems) {
        if (item.kind !== 'file' || typeof item.webkitGetAsEntry !== 'function') continue;
        const entry = item.webkitGetAsEntry();
        if (entry) {
          await collectDroppedEntry(entry, '', result);
        }
      }
      return result;
    }

    for (const file of Array.from(dataTransfer && dataTransfer.files || [])) {
      const localPath = getDroppedFileLocalPath(file);
      const localPathName = localPath.split(String.fromCharCode(92)).join('/').split('/').pop();
      const relativePath = normalizeDroppedRelativePath(file.webkitRelativePath || file.name || localPathName);

      if (relativePath) {
        result.items.push({
          kind: 'file',
          file: file,
          localPath: localPath || '',
          relativePath: relativePath,
          size: Number(file.size || 0)
        });
      }
    }

    return result;
  }

  function buildDroppedUploadMessageItems(items, includeLocalPath) {
    return items.map(item => ({
      kind: item.kind,
      localPath: includeLocalPath ? (item.localPath || '') : '',
      relativePath: item.relativePath,
      size: Number(item.size || 0)
    }));
  }

  function canUseDroppedUploadLocalPaths(items) {
    const fileItems = items.filter(item => item.kind === 'file');
    return fileItems.every(item => Boolean(item.localPath));
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return btoa(binary);
  }

  async function sendDroppedUploadFileChunks(sessionId, item, fileIndex, fileCount) {
    const file = item.file;

    if (!file) {
      throw new Error('Could not read dropped file content.');
    }

    let offset = 0;
    let chunkIndex = 0;

    if (file.size === 0) {
      setStatus('Preparing dropped upload: ' + fileIndex + '/' + fileCount + ' ' + item.relativePath);
      return;
    }

    while (offset < file.size) {
      const end = Math.min(offset + DROP_UPLOAD_CHUNK_SIZE, file.size);
      const buffer = await file.slice(offset, end).arrayBuffer();
      const data = arrayBufferToBase64(buffer);

      setStatus('Preparing dropped upload: ' + fileIndex + '/' + fileCount + ' ' + item.relativePath);
      vscode.postMessage({
        type: 'writeDroppedUploadChunk',
        payload: {
          sessionId: sessionId,
          relativePath: item.relativePath,
          chunkIndex: chunkIndex,
          data: data
        }
      });

      await waitForDroppedUploadMessage(
        'droppedUploadChunkWritten',
        sessionId,
        payload => payload.relativePath === item.relativePath && Number(payload.chunkIndex || 0) === chunkIndex,
        120000
      );

      offset = end;
      chunkIndex += 1;
    }
  }

  async function requestDroppedUploadFromContent(target, items) {
    const sessionId = createDroppedUploadSessionId();
    const messageItems = buildDroppedUploadMessageItems(items, false);
    const fileItems = items.filter(item => item.kind === 'file');

    vscode.postMessage({
      type: 'beginDroppedUploadEntries',
      payload: {
        sessionId: sessionId,
        connectionId: activeConnectionId,
        targetDirectory: target.path,
        source: 'webview',
        items: messageItems
      }
    });

    await waitForDroppedUploadMessage('droppedUploadSessionReady', sessionId, null, 60000);

    try {
      for (let index = 0; index < fileItems.length; index += 1) {
        await sendDroppedUploadFileChunks(sessionId, fileItems[index], index + 1, fileItems.length);
      }

      vscode.postMessage({ type: 'finishDroppedUploadEntries', payload: { sessionId: sessionId } });
      setStatus('Dropped upload added to the transfer queue.');
    } catch (error) {
      vscode.postMessage({ type: 'cancelDroppedUploadEntries', payload: { sessionId: sessionId } });
      throw error;
    }
  }

  function handleDragDropUploadDragEnter(event) {
    if (!isLocalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    markDragDropUploadActivity();

    if (!canAcceptLocalFileDrop() || !isDropInFileList(event)) {
      clearDragDropUploadAutoOpenTimer();
      setDragDropUploadState(false, null);
      return;
    }

    const target = getDropTargetDirectory(event);
    setDragDropUploadState(true, target.row);
    scheduleDragDropUploadAutoOpen(target);
  }

  function handleDragDropUploadDragOver(event) {
    if (!isLocalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    markDragDropUploadActivity();

    if (!canAcceptLocalFileDrop() || !isDropInFileList(event)) {
      event.dataTransfer.dropEffect = 'none';
      clearDragDropUploadAutoOpenTimer();
      setDragDropUploadState(false, null);
      return;
    }

    event.dataTransfer.dropEffect = 'copy';
    const target = getDropTargetDirectory(event);
    setDragDropUploadState(true, target.row);
    scheduleDragDropUploadAutoOpen(target);
  }

  function handleDragDropUploadDragLeave(event) {
    if (!isLocalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && filesView && filesView.contains(nextTarget)) {
      return;
    }

    clearDragDropUploadState();
  }

  async function handleDragDropUploadDrop(event) {
    if (!isLocalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const insideFileList = isDropInFileList(event);
    const target = insideFileList ? getDropTargetDirectory(event) : null;
    clearDragDropUploadState();

    if (!canAcceptLocalFileDrop()) {
      setStatus('Connect to a remote folder before dropping files.', true);
      return;
    }

    if (!insideFileList || !target) {
      setStatus('Drop files into the file list to upload.', true);
      return;
    }

    let dropped;

    try {
      dropped = await collectDroppedFiles(event.dataTransfer);
    } catch (error) {
      setStatus('Could not read dropped items. Use the Upload button instead.', true);
      vscode.postMessage({ type: 'log', payload: { message: String(error && error.message || error || 'Could not read dropped items.') } });
      return;
    }

    if (!dropped.items.length) {
      setStatus('Drop local files or folders to upload.', true);
      return;
    }

    try {
      if (canUseDroppedUploadLocalPaths(dropped.items)) {
        vscode.postMessage({
          type: 'requestDroppedUploadEntries',
          payload: {
            connectionId: activeConnectionId,
            targetDirectory: target.path,
            source: 'webview',
            items: buildDroppedUploadMessageItems(dropped.items, true)
          }
        });
        return;
      }

      await requestDroppedUploadFromContent(target, dropped.items);
    } catch (error) {
      const message = String(error && error.message || error || 'Could not prepare dropped upload.');
      setStatus(message, true);
      vscode.postMessage({ type: 'log', payload: { message: message } });
    }
  }

  if (filesView && entriesTableWrap) {
    filesView.addEventListener('dragenter', handleDragDropUploadDragEnter);
    filesView.addEventListener('dragover', handleDragDropUploadDragOver);
    filesView.addEventListener('dragleave', handleDragDropUploadDragLeave);
    filesView.addEventListener('drop', handleDragDropUploadDrop);
  }

  window.addEventListener('blur', clearDragDropUploadState);
  window.addEventListener('dragend', clearDragDropUploadState);
  document.addEventListener('drop', clearDragDropUploadState, true);
  document.addEventListener('keyup', event => {
    if (event.key === 'Escape') {
      clearDragDropUploadState();
    }
  });
`;
}
