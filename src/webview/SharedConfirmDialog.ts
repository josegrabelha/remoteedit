/** Confirmation markup extracted from the Advanced View. */
export function renderSharedConfirmDialogMarkup(prefix = 'confirmDialog'): string {
  return `<div id="${prefix}Backdrop" class="confirm-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="${prefix}Title" aria-hidden="true">
    <section class="confirm-dialog">
      <div class="confirm-dialog-header">
        <h2 id="${prefix}Title" class="confirm-dialog-title">Confirm action</h2>
        <div id="${prefix}Message" class="confirm-dialog-subtitle"></div>
      </div>
      <div id="${prefix}Body" class="confirm-dialog-body">
        <pre id="${prefix}Details" class="confirm-dialog-details" hidden></pre>
      </div>
      <div class="confirm-dialog-actions">
        <button id="${prefix}CopyButton" class="secondary" type="button" hidden>Copy</button>
        <button id="${prefix}CancelButton" class="secondary" type="button">Cancel</button>
        <button id="${prefix}ConfirmButton" type="button">Confirm</button>
      </div>
    </section>
  </div>`;
}

/** SSH uses the RE markup, with isolated selectors in every host Webview. */
export function renderSshHostKeyDialogMarkup(): string {
  return renderSharedConfirmDialogMarkup('sshHostKeyDialog').replace(/confirm-dialog/g, 'ssh-confirm-dialog');
}
export function renderSharedConfirmDialogStyles(): string {
  return `  .confirm-dialog-backdrop { position: fixed; inset: 0; z-index: 240; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.45); }
  .confirm-dialog-backdrop.visible { display: flex; }
  .confirm-dialog { width: min(520px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .confirm-dialog-header { padding: 16px 18px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .confirm-dialog-title { margin: 0 0 5px; font-size: 18px; font-weight: 650; }
  .confirm-dialog-body { padding: 15px 18px; display: grid; gap: 12px; overflow: auto; }
  .confirm-dialog-message { margin: 0; line-height: 1.45; }
  .confirm-dialog-details { margin: 0; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
  .confirm-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 16px; }
`;
}

export function renderSshHostKeyDialogStyles(): string {
  return renderSharedConfirmDialogStyles().replace(/confirm-dialog/g, 'ssh-confirm-dialog') + `
.ssh-confirm-dialog-backdrop, .ssh-confirm-dialog-backdrop * { box-sizing: border-box; }
.ssh-confirm-dialog-backdrop { z-index: 11000; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); user-select: none; }
.ssh-confirm-dialog-title { letter-spacing: normal; }
.ssh-confirm-dialog-actions { flex-wrap: wrap; flex-shrink: 0; }
.ssh-confirm-dialog-subtitle { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; line-height: 1.3; margin-top: 3px; opacity: 0.85; overflow-wrap: anywhere; }
.ssh-confirm-dialog-actions button { width: auto; height: auto; min-height: 31px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 6px 12px; border-radius: 3px; cursor: pointer; white-space: nowrap; font-family: Arial, sans-serif; font-size: 13.3333px; font-weight: 400; line-height: normal; letter-spacing: normal; }
.ssh-confirm-dialog-actions button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.ssh-confirm-dialog-actions button.secondary { background: var(--vscode-button-secondaryBackground, var(--vscode-input-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-button-border, var(--vscode-input-border, var(--vscode-panel-border))); }
.ssh-confirm-dialog-actions button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
.ssh-confirm-dialog-actions button.danger { background: var(--vscode-inputValidation-errorBackground, var(--vscode-button-secondaryBackground)); color: var(--vscode-inputValidation-errorForeground, var(--vscode-button-secondaryForeground)); }
.ssh-confirm-dialog-actions button.danger:hover:not(:disabled) { background: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); color: var(--vscode-inputValidation-errorForeground, var(--vscode-button-foreground)); }
.ssh-confirm-dialog-actions button:focus { outline: none !important; box-shadow: none !important; }
.ssh-confirm-dialog-actions button[hidden], .ssh-confirm-dialog-body[hidden] { display: none !important; }
#sshHostKeyDialogCopyButton { width: 58px; min-width: 58px; display: inline-flex; align-items: center; justify-content: center; text-align: center; padding-left: 0; padding-right: 0; }
`;
}
export function renderSshHostKeyDialogScript(): string {
  return `(() => {
    const backdrop = document.getElementById('sshHostKeyDialogBackdrop');
    const get = suffix => document.getElementById('sshHostKeyDialog' + suffix);
    const title = get('Title'), message = get('Message'), body = get('Body'), details = get('Details');
    const copy = get('CopyButton'), cancel = get('CancelButton'), confirm = get('ConfirmButton');
    let active = null, previousFocus = null, copyTimer = null;
    const post = data => window.dispatchEvent(new CustomEvent('sshHostKeyDialogPost', { detail: data }));
    function close(confirmed, dismissed) {
      if (!active) return;
      const requestId = active.requestId;
      active = null;
      clearTimeout(copyTimer);
      backdrop.classList.remove('visible'); backdrop.setAttribute('aria-hidden', 'true');
      if (previousFocus && previousFocus.isConnected) previousFocus.focus();
      post({ type: 'sshHostKeyDialogResponse', payload: { requestId, confirmed, dismissed } });
    }
    window.addEventListener('message', event => {
      const data = event.data || {}, payload = data.payload || {};
      if (data.type === 'closeSshHostKeyDialog') {
        if (active && active.requestId === payload.requestId) close(false, true);
        return;
      }
      if (data.type === 'sshHostKeyDialogCopied') {
        if (!active || active.requestId !== payload.requestId) return;
        copy.textContent = 'Copied'; clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
        return;
      }
      if (data.type !== 'showSshHostKeyDialog') return;
      previousFocus = document.activeElement; active = payload;
      title.textContent = payload.title;
      message.textContent = payload.message;
      details.textContent = String(payload.details || '').trim();
      body.hidden = details.hidden = !details.textContent;
      copy.hidden = !details.textContent; copy.textContent = 'Copy';
      cancel.textContent = 'Cancel'; cancel.hidden = Boolean(payload.hideCancel);
      confirm.textContent = payload.confirmLabel; confirm.classList.toggle('danger', Boolean(payload.danger));
      backdrop.classList.add('visible'); backdrop.setAttribute('aria-hidden', 'false');
      setTimeout(() => { if (active === payload) (cancel.hidden ? confirm : cancel).focus(); }, 0);
    });
    copy.addEventListener('click', () => {
      if (active) post({ type: 'sshHostKeyDialogCopy', payload: { requestId: active.requestId } });
    });
    cancel.addEventListener('click', () => close(false, false));
    confirm.addEventListener('click', () => close(true, false));
    document.addEventListener('keydown', event => {
      if (!active) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(false, true); }
      else if (event.key === 'Tab') {
        const buttons = [copy, cancel, confirm].filter(button => !button.hidden);
        const index = buttons.indexOf(document.activeElement);
        event.preventDefault(); event.stopImmediatePropagation();
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    }, true);
    document.addEventListener('focusin', event => {
      if (active && !backdrop.contains(event.target)) (cancel.hidden ? confirm : cancel).focus();
    });
    window.addEventListener('pagehide', () => close(false, true));
  })();`;
}
