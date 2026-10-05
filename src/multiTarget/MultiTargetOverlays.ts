export function renderMultiTargetOverlays(searchResults = false): string {
  return String.raw`  const TOOLTIP_SHOW_DELAY_MS = 500;
  function overlayHostForTarget(target) {
    return target instanceof Element ? (target.closest('dialog[open]') || document.body) : document.body;
  }
  function moveOverlayToTarget(overlay, target) {
    if (!overlay) return;
    const host = overlayHostForTarget(target);
    if (overlay.parentElement !== host) host.appendChild(overlay);
  }
  function hideWebviewTooltip() {
    if (tooltipTimer) { window.clearTimeout(tooltipTimer); tooltipTimer = 0; }
    activeTooltipTarget = null;
    const tooltip = $('webviewTooltip');
    if (!tooltip) return;
    tooltip.classList.remove('visible');
    tooltip.setAttribute('aria-hidden', 'true');
  }
  function positionWebviewTooltip(target, preferAbove = false) {
    const tooltip = $('webviewTooltip');
    if (!tooltip || !target) return;
    const gap = 7, margin = 8;
    const rect = target.getBoundingClientRect(), tooltipRect = tooltip.getBoundingClientRect();
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));
    let top = preferAbove ? rect.top - tooltipRect.height - gap : rect.bottom + gap;
    if (top < margin) top = rect.bottom + gap;
    if (top + tooltipRect.height > window.innerHeight - margin) top = rect.top - tooltipRect.height - gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));
    tooltip.style.left = Math.round(left) + 'px'; tooltip.style.top = Math.round(top) + 'px';
  }
  function showWebviewTooltip(target) {
    const tooltip = $('webviewTooltip');
    if (!tooltip || !target) return;
    const text = String(target.getAttribute('data-tooltip') || '').trim();
    if (!text) return;
    if (tooltipTimer) window.clearTimeout(tooltipTimer);
    activeTooltipTarget = target; moveOverlayToTarget(tooltip, target);
    tooltip.textContent = text; tooltip.setAttribute('aria-hidden', 'false'); tooltip.classList.remove('visible');
    tooltip.style.left = '0px'; tooltip.style.top = '0px';
    tooltipTimer = window.setTimeout(() => {
      if (activeTooltipTarget !== target) return;
      const preferAbove = target.classList.contains('tooltip-above') || target.getAttribute('data-tooltip-position') === 'above';
      positionWebviewTooltip(target, preferAbove); tooltip.classList.add('visible');
    }, TOOLTIP_SHOW_DELAY_MS);
  }
  function getTooltipTarget(eventTarget) { return eventTarget && eventTarget.closest ? eventTarget.closest('[data-tooltip]') : null; }
  function isTextEditableInput(element) {
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
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return String(element.value || '').length > 0;
    return String(element.textContent || '').length > 0;
  }
  function editableIsReadOnly(element) {
    if (!element) return true;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return Boolean(element.disabled || element.readOnly);
    return !(element instanceof HTMLElement) || !element.isContentEditable;
  }
  function editableHasSelection(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return typeof element.selectionStart === 'number' && typeof element.selectionEnd === 'number' && element.selectionEnd > element.selectionStart;
    const selection = window.getSelection ? window.getSelection() : null;
    return Boolean(selection && !selection.isCollapsed && element instanceof Node && element.contains(selection.anchorNode) && element.contains(selection.focusNode));
  }
  function editableSelectionText(element) {
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
      if (typeof element.setRangeText === 'function') element.setRangeText(text, start, end, 'end');
      else {
        const value = String(element.value || ''); element.value = value.slice(0, start) + text + value.slice(end);
        const position = start + text.length; element.selectionStart = position; element.selectionEnd = position;
      }
      element.dispatchEvent(new Event('input', { bubbles: true })); element.focus(); return;
    }
    element.focus(); document.execCommand('insertText', false, text);
  }
  function selectAllEditable(element) {
    if (!element) return;
    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) { if (typeof element.select === 'function') element.select(); return; }
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection ? window.getSelection() : null;
    if (selection) { selection.removeAllRanges(); selection.addRange(range); }
  }
  async function copyTextForContextMenu(text) {
    if (!text) return;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return; } } catch (error) {}
    post('copyText', { text });
  }
  async function readTextForContextPaste() {
    try { if (navigator.clipboard && navigator.clipboard.readText) return await navigator.clipboard.readText(); } catch (error) {}
    return '';
  }
  function positionContextMenu(menu, clientX, clientY, target) {
    if (!menu) return;
    moveOverlayToTarget(menu, target); menu.classList.add('visible'); menu.style.left = '0px'; menu.style.top = '0px';
    const margin = 6, rect = menu.getBoundingClientRect();
    const left = Math.max(margin, Math.min(clientX, window.innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(clientY, window.innerHeight - rect.height - margin));
    menu.style.left = Math.round(left) + 'px'; menu.style.top = Math.round(top) + 'px';
  }
  function hideTextEditContextMenu() { activeTextEditTarget = null; const menu = $('textEditContextMenu'); if (menu) menu.classList.remove('visible'); }
  function hideOutputContextMenu() { const menu = $('outputContextMenu'); if (menu) menu.classList.remove('visible'); }
  function hideCustomContextMenus() { hideTextEditContextMenu(); hideOutputContextMenu(); }
  function showTextEditContextMenu(element, clientX, clientY) {
    const menu = $('textEditContextMenu'); if (!menu) return; hideCustomContextMenus(); activeTextEditTarget = element;
    const readOnly = editableIsReadOnly(element), hasSelection = editableHasSelection(element), hasValue = editableHasValue(element);
    $('textContextUndo').disabled = readOnly; $('textContextRedo').disabled = readOnly; $('textContextCut').disabled = readOnly || !hasSelection;
    $('textContextCopy').disabled = !hasSelection; $('textContextPaste').disabled = readOnly; $('textContextSelectAll').disabled = !hasValue;
    positionContextMenu(menu, clientX, clientY, element);
  }
  async function handleTextEditContextAction(action) {
    const target = activeTextEditTarget; if (!target) return;
    if (action === 'undo' || action === 'redo') {
      if (!editableIsReadOnly(target)) { target.focus(); document.execCommand(action); target.dispatchEvent(new Event('input', { bubbles: true })); }
    } else if (action === 'cut') {
      const text = editableSelectionText(target); if (text && !editableIsReadOnly(target)) { await copyTextForContextMenu(text); replaceEditableSelection(target, ''); }
    } else if (action === 'copy') await copyTextForContextMenu(editableSelectionText(target));
    else if (action === 'paste') {
      if (!editableIsReadOnly(target)) { const text = await readTextForContextPaste(); if (text) replaceEditableSelection(target, text); else { target.focus(); try { document.execCommand('paste'); } catch (error) {} } }
    } else if (action === 'selectAll') selectAllEditable(target);
    hideTextEditContextMenu();
  }
  function selectedOutputText() {
    const selection = window.getSelection ? window.getSelection() : null, output = $('output-wrap');
    if (!selection || selection.isCollapsed || !output) return '';
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (output.contains(range.commonAncestorContainer) || output.contains(range.startContainer) || output.contains(range.endContainer)) return selection.toString();
    }
    return '';
  }
  function showOutputContextMenu(clientX, clientY) {
    const text = ${searchResults ? 'selectedOutputText() || selectedSearchResultText()' : 'selectedOutputText()'}; if (!text) { hideCustomContextMenus(); return; }
    hideCustomContextMenus(); positionContextMenu($('outputContextMenu'), clientX, clientY, $('output-wrap'));
  }
  function bindTextContextButton(id, action) {
    const button = $(id); if (!button) return;
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); handleTextEditContextAction(action); });
  }
  bindTextContextButton('textContextUndo', 'undo'); bindTextContextButton('textContextRedo', 'redo'); bindTextContextButton('textContextCut', 'cut');
  bindTextContextButton('textContextCopy', 'copy'); bindTextContextButton('textContextPaste', 'paste'); bindTextContextButton('textContextSelectAll', 'selectAll');
  $('outputContextCopy').addEventListener('click', async event => { event.preventDefault(); event.stopPropagation(); const text = ${searchResults ? 'selectedOutputText() || selectedSearchResultText()' : 'selectedOutputText()'}; if (text) await copyTextForContextMenu(text); hideCustomContextMenus(); });
  document.addEventListener('contextmenu', event => {
    hideWebviewTooltip();
    const target = event.target instanceof Element ? event.target : null;
    const editable = target ? getTextEditableTarget(target) : null;
    if (editable) { event.preventDefault(); event.stopPropagation(); showTextEditContextMenu(editable, event.clientX, event.clientY); return; }
    ${searchResults ? 'if (target && target.closest("[data-key]")) selectSearchContextRow(target.closest("[data-key]"));' : ''}
    if (target && target.closest('#output-wrap')) { event.preventDefault(); event.stopPropagation(); showOutputContextMenu(event.clientX, event.clientY); return; }
    event.preventDefault(); event.stopPropagation(); hideCustomContextMenus();
  }, true);
  document.addEventListener('selectionchange', () => { const menu = $('outputContextMenu'); if (menu && menu.classList.contains('visible') && !selectedOutputText()) hideOutputContextMenu(); });
  document.addEventListener('mouseover', event => { const target = getTooltipTarget(event.target); if (!target || target === activeTooltipTarget) return; showWebviewTooltip(target); });
  document.addEventListener('mouseout', event => {
    const target = getTooltipTarget(event.target); if (!target || target !== activeTooltipTarget) return;
    const related = event.relatedTarget; if (related && target.contains(related)) return; hideWebviewTooltip();
  });
  document.addEventListener('focusin', event => { const target = getTooltipTarget(event.target); if (target) showWebviewTooltip(target); });
  document.addEventListener('focusout', event => { const target = getTooltipTarget(event.target); if (target && target === activeTooltipTarget) hideWebviewTooltip(); });
  document.addEventListener('click', event => {
    hideWebviewTooltip();
    const textMenu = $('textEditContextMenu'), outputMenu = $('outputContextMenu');
    if (textMenu && !textMenu.contains(event.target)) hideTextEditContextMenu();
    if (outputMenu && !outputMenu.contains(event.target)) hideOutputContextMenu();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { hideWebviewTooltip(); hideCustomContextMenus(); } });
  window.addEventListener('scroll', () => { hideWebviewTooltip(); hideCustomContextMenus(); }, true);
  window.addEventListener('resize', () => { hideWebviewTooltip(); hideCustomContextMenus(); });
`;
}
