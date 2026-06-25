export function renderTextEditContextMenu(): string {
  return `  function isTextEditableInput(element) {
    if (!(element instanceof HTMLInputElement)) return false;
    const type = String(element.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'password', 'email', 'number', 'url', 'tel'].includes(type);
  }

  function getTextEditableTarget(target) {
    if (!(target instanceof Element)) return null;
    const editable = target.closest('textarea, input, [contenteditable="true"]');
    if (!editable) return null;
    if (editable instanceof HTMLTextAreaElement) return editable;
    if (isTextEditableInput(editable)) return editable;
    if (editable instanceof HTMLElement && editable.isContentEditable) return editable;
    return null;
  }

  function editableHasValue(element) {
    if (!element) return false;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return String(element.value || '').length > 0;
    }
    return String(element.textContent || '').length > 0;
  }

  function editableIsReadOnly(element) {
    if (!element) return true;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return Boolean(element.disabled || element.readOnly);
    }
    return !(element instanceof HTMLElement) || !element.isContentEditable;
  }

  function editableHasSelection(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return typeof element.selectionStart === 'number' && typeof element.selectionEnd === 'number' && element.selectionEnd > element.selectionStart;
    }
    const selection = window.getSelection ? window.getSelection() : null;
    return Boolean(selection && !selection.isCollapsed && element instanceof Node && element.contains(selection.anchorNode) && element.contains(selection.focusNode));
  }

  function getEditableSelectionText(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (typeof element.selectionStart !== 'number' || typeof element.selectionEnd !== 'number') return '';
      return String(element.value || '').slice(element.selectionStart, element.selectionEnd);
    }
    const selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.isCollapsed || !(element instanceof Node) || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return '';
    return selection.toString();
  }

  function replaceEditableSelection(element, text) {
    if (!element || editableIsReadOnly(element)) return;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const start = typeof element.selectionStart === 'number' ? element.selectionStart : String(element.value || '').length;
      const end = typeof element.selectionEnd === 'number' ? element.selectionEnd : start;
      if (typeof element.setRangeText === 'function') {
        element.setRangeText(text, start, end, 'end');
      } else {
        const value = String(element.value || '');
        element.value = value.slice(0, start) + text + value.slice(end);
        const pos = start + text.length;
        element.selectionStart = pos;
        element.selectionEnd = pos;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.focus();
      return;
    }
    element.focus();
    document.execCommand('insertText', false, text);
  }

  function selectAllEditable(element) {
    if (!element) return;
    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (typeof element.select === 'function') element.select();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection ? window.getSelection() : null;
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  async function copyTextFromEditableMenu(text) {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (error) {
      // Fall back to the extension host clipboard helper.
    }
    vscode.postMessage({ type: 'copyStatus', payload: { text } });
  }

  async function readTextForEditablePaste() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        return await navigator.clipboard.readText();
      }
    } catch (error) {
      return '';
    }
    return '';
  }

  function positionTextEditContextMenu(clientX, clientY) {
    if (!textEditContextMenu) return;
    textEditContextMenu.classList.add('visible');
    textEditContextMenu.style.left = '0px';
    textEditContextMenu.style.top = '0px';
    const margin = 6;
    const rect = textEditContextMenu.getBoundingClientRect();
    const left = Math.max(margin, Math.min(clientX, window.innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(clientY, window.innerHeight - rect.height - margin));
    textEditContextMenu.style.left = left + 'px';
    textEditContextMenu.style.top = top + 'px';
  }

  function showTextEditContextMenu(element, clientX, clientY) {
    if (!textEditContextMenu) return;
    hideContextMenu();
    hideRemoteSearchResultContextMenu();
    activeTextEditTarget = element;
    const readOnly = editableIsReadOnly(element);
    const hasSelection = editableHasSelection(element);
    const hasValue = editableHasValue(element);
    if (textEditContextUndo) textEditContextUndo.disabled = readOnly;
    if (textEditContextRedo) textEditContextRedo.disabled = readOnly;
    if (textEditContextCut) textEditContextCut.disabled = readOnly || !hasSelection;
    if (textEditContextCopy) textEditContextCopy.disabled = !hasSelection;
    if (textEditContextPaste) textEditContextPaste.disabled = readOnly;
    if (textEditContextSelectAll) textEditContextSelectAll.disabled = !hasValue;
    positionTextEditContextMenu(clientX, clientY);
  }

  function hideTextEditContextMenu() {
    activeTextEditTarget = null;
    if (textEditContextMenu) textEditContextMenu.classList.remove('visible');
  }

  async function handleTextEditContextAction(action) {
    const target = activeTextEditTarget;
    if (!target) return;
    if (action === 'undo' || action === 'redo') {
      if (!editableIsReadOnly(target)) {
        target.focus();
        document.execCommand(action);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else if (action === 'cut') {
      const text = getEditableSelectionText(target);
      if (text && !editableIsReadOnly(target)) {
        await copyTextFromEditableMenu(text);
        replaceEditableSelection(target, '');
      }
    } else if (action === 'copy') {
      await copyTextFromEditableMenu(getEditableSelectionText(target));
    } else if (action === 'paste') {
      if (!editableIsReadOnly(target)) {
        const text = await readTextForEditablePaste();
        if (text) {
          replaceEditableSelection(target, text);
        } else {
          target.focus();
          try { document.execCommand('paste'); } catch (error) { /* ignore */ }
        }
      }
    } else if (action === 'selectAll') {
      selectAllEditable(target);
    }
    hideTextEditContextMenu();
  }

  function bindTextEditContextButton(button, action) {
    if (!button) return;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      handleTextEditContextAction(action);
    });
  }

  bindTextEditContextButton(textEditContextUndo, 'undo');
  bindTextEditContextButton(textEditContextRedo, 'redo');
  bindTextEditContextButton(textEditContextCut, 'cut');
  bindTextEditContextButton(textEditContextCopy, 'copy');
  bindTextEditContextButton(textEditContextPaste, 'paste');
  bindTextEditContextButton(textEditContextSelectAll, 'selectAll');

  document.addEventListener('contextmenu', event => {
    const editable = getTextEditableTarget(event.target);
    if (editable) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showTextEditContextMenu(editable, event.clientX, event.clientY);
      return;
    }
    hideTextEditContextMenu();
    if (event.target instanceof Element && event.target.closest('#entriesTableWrap')) return;
    event.preventDefault();
    hideContextMenu();
    hideRemoteSearchResultContextMenu();
  }, true);

  document.addEventListener('click', event => {
    if (!entryContextMenu.contains(event.target)) hideContextMenu();
    if (textEditContextMenu && !textEditContextMenu.contains(event.target)) hideTextEditContextMenu();
    if (remoteSearchResultContextMenu && !remoteSearchResultContextMenu.contains(event.target)) hideRemoteSearchResultContextMenu();
    if (remotePathBox && !remotePathBox.contains(event.target)) hidePathFavoritesPopover();
    const remoteSearchPickerWrap = remoteSearchScopePicker ? remoteSearchScopePicker.closest('.remote-search-scope-wrap') : null;
    if (remoteSearchScopePickerOpen && remoteSearchPickerWrap && event.target instanceof Node && !remoteSearchPickerWrap.contains(event.target)) {
      hideRemoteSearchScopePicker();
    }
    const remoteCommandPickerWrap = remoteCommandWorkingDirectoryPicker ? remoteCommandWorkingDirectoryPicker.closest('.remote-command-working-directory-wrap') : null;
    if (remoteCommandWorkingDirectoryPickerOpen && remoteCommandPickerWrap && event.target instanceof Node && !remoteCommandPickerWrap.contains(event.target)) {
      hideRemoteCommandWorkingDirectoryPicker();
    }
    const serverLogShortcutPickerWrap = serverLogShortcutPathPicker ? serverLogShortcutPathPicker.closest('.server-log-shortcut-path-wrap') : null;
    if (serverLogShortcutPathPickerOpen && serverLogShortcutPickerWrap && event.target instanceof Node && !serverLogShortcutPickerWrap.contains(event.target)) {
      hideServerLogShortcutPathPicker();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (serverLogShortcutPathPickerOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        hideServerLogShortcutPathPicker();
        return;
      }
      if (serverLogShortcutDialogOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        hideServerLogShortcutDialog();
        return;
      }
      if (serverLogShortcutRemoveDialogOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        hideServerLogShortcutRemoveDialog();
        return;
      }
      if (serverPortForwardRemoveDialogOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        hideServerPortForwardRemoveDialog();
        return;
      }
      if (serverPortForwardDialogOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        hideServerPortForwardDialog();
        return;
      }
      if (remoteCommandWorkingDirectoryPickerOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        hideRemoteCommandWorkingDirectoryPicker();
        return;
      }
      if (remoteCommandDialogOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        attemptCloseRemoteCommandDialog();
        return;
      }
      if (permissionsDialogOpen) {
        vscode.postMessage({ type: 'cancelPermissions' });
        return;
      }
      hideContextMenu();
      hideTextEditContextMenu();
      hideRemoteSearchResultContextMenu();
      hidePathFavoritesPopover();
    }
  });

  entriesBody.addEventListener('click', handleEntryRowClick);
  entriesBody.addEventListener('dblclick', handleEntryRowDoubleClick);
  entriesBody.addEventListener('contextmenu', handleEntryRowContextMenu);

  entriesTableWrap.addEventListener('click', event => {
    if (event.target === entriesTableWrap) {
      clearEntrySelection();
      hideContextMenu();
    }
  });

  entriesTableWrap.addEventListener('contextmenu', event => {
    if (event.target.closest('tr.entry-row')) return;
    event.preventDefault();
    hideContextMenu();
    if (event.target.closest('thead')) return;
    clearEntrySelection();
    showContextMenu(null, event.clientX, event.clientY);
  });

  for (const header of entriesTable.querySelectorAll('th.sortable')) {
    header.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('.column-resizer')) return;
      cycleSort(header.dataset.sortKey || '');
    });
  }

  for (const resizer of entriesTable.querySelectorAll('.column-resizer')) {
    resizer.addEventListener('mousedown', startColumnResize);
  }

`;}
