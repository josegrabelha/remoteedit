import * as vscode from 'vscode';

export function renderRemoteEditHtml(webview: vscode.Webview, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Remote Edit</title>
  <style>
  :root { color-scheme: light dark; --remoteedit-validation-error: #b94a48; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); overflow: hidden; user-select: none; -webkit-user-select: none; }
  input, textarea { user-select: text; -webkit-user-select: text; }
  input.connection-input-invalid, select.connection-input-invalid, .profile-dropdown-button.connection-input-invalid { border-color: var(--remoteedit-validation-error); }
  input.connection-input-invalid:focus, input.connection-input-invalid:focus-visible, select.connection-input-invalid:focus, select.connection-input-invalid:focus-visible, .profile-dropdown-button.connection-input-invalid:focus, .profile-dropdown-button.connection-input-invalid:focus-visible { border-color: var(--remoteedit-validation-error); outline: none; box-shadow: none; }
  .page { height: 100vh; padding: 16px 6px; display: flex; min-width: 0; }
  .shell { width: 100%; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .session-strip { display: flex; gap: 6px; align-items: center; min-height: 30px; margin-top: 10px; overflow-x: auto; padding: 1px 0; flex: 0 0 auto; }
  .session-label { color: var(--vscode-descriptionForeground); font-size: 12px; margin-right: 2px; white-space: nowrap; }
  .session-tabs { display: flex; gap: 6px; align-items: center; min-width: 0; }
  .session-tab { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 28px; min-height: 28px; max-width: 220px; border: 1px solid var(--vscode-tab-border, var(--vscode-panel-border)); background: var(--vscode-tab-inactiveBackground, var(--vscode-sideBar-background)); color: var(--vscode-tab-inactiveForeground, var(--vscode-foreground)); border-radius: 999px; padding: 0 6px 0 10px; cursor: pointer; white-space: nowrap; line-height: 1; font-size: 12px; }
  .session-tab:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
  .session-tab.active { border-color: var(--vscode-panel-border); border-color: color-mix(in srgb, var(--vscode-focusBorder) 45%, var(--vscode-panel-border)); background: var(--vscode-tab-activeBackground, var(--vscode-list-activeSelectionBackground)); color: var(--vscode-tab-activeForeground, var(--vscode-list-activeSelectionForeground)); }
  .session-tab.active:hover:not(:disabled) { background: var(--vscode-tab-activeBackground, var(--vscode-list-activeSelectionBackground)); color: var(--vscode-tab-activeForeground, var(--vscode-list-activeSelectionForeground)); }
  .session-name { display: block; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .session-close { width: 18px; min-width: 18px; height: 18px; min-height: 18px; display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0 -2px 0 0; border-radius: 50%; background: transparent; color: inherit; opacity: 0.82; line-height: 18px; font-size: 14px; flex: 0 0 auto; }
  .session-close:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); opacity: 1; }
  .session-empty { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 28px; }
  .layout { position: relative; display: grid; grid-template-columns: var(--connection-panel-width, 320px) minmax(0, 1fr); gap: 16px; margin-top: 0; align-items: stretch; flex: 1 1 auto; min-height: 0; min-width: 0; }
  .layout.connection-collapsed { grid-template-columns: 0px minmax(0, 1fr); gap: 0; }
  .layout.connection-collapsed .connection-card { opacity: 0; transform: translateX(-12px); pointer-events: none; border-color: transparent; }
  .connection-panel-handle { width: 20px; min-width: 20px; height: 48px; min-height: 48px; pointer-events: none; }
  .connection-panel-handle .tooltip-anchor { display: block; width: 20px; height: 48px; pointer-events: auto; }
  .connection-panel-handle .panel-toggle-button { width: 20px; min-width: 20px; height: 48px; min-height: 48px; padding: 0; background: var(--vscode-sideBar-background); color: var(--vscode-descriptionForeground); opacity: 0.68; box-shadow: 0 1px 3px rgb(0 0 0 / 14%); }
  .connection-panel-handle .panel-toggle-button:hover:not(:disabled) { color: var(--vscode-foreground); opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .connection-panel-handle .panel-toggle-button svg { width: 14px; height: 14px; }
  .connection-rail { position: fixed; left: 0; top: var(--connection-rail-top, 150px); z-index: 50; opacity: 0; transform: translateX(-6px); }
  .connection-rail .tooltip-anchor { pointer-events: none; }
  .layout.connection-collapsed .connection-rail { opacity: 1; transform: translateX(0); }
  .layout.connection-collapsed .connection-rail .tooltip-anchor { pointer-events: auto; }
  .connection-rail .panel-toggle-button { border-left: 0; border-radius: 0 5px 5px 0; }
  .connection-collapse-handle { position: absolute; right: 0; top: 8px; z-index: 30; }
  .connection-collapse-handle .panel-toggle-button { border-right: 0; border-radius: 5px 0 0 5px; }
  @media (prefers-reduced-motion: no-preference) {
    .layout.connection-transition-ready { transition: grid-template-columns 150ms ease-out, gap 150ms ease-out; }
    .layout.connection-transition-ready .connection-card { transition: opacity 150ms ease-out, transform 150ms ease-out, border-color 150ms ease-out; }
    .layout.connection-transition-ready .connection-panel-handle { transition: opacity 150ms ease-out, transform 150ms ease-out; }
    .layout.connection-transition-ready .connection-panel-handle .panel-toggle-button { transition: opacity 150ms ease-out, background-color 150ms ease-out, color 150ms ease-out; }
  }
  .browser-column { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .browser-card { flex: 1 1 auto; }
  .browser-open-section { display: grid; grid-template-columns: minmax(150px, auto) minmax(0, 1fr); column-gap: 14px; align-items: center; min-height: 63px; padding: 13px 14px; background: var(--vscode-editor-background); }
  .browser-open-text { min-width: 0; }
  .browser-open-section .card-subtitle { margin-top: 3px; }
  .browser-title-section { padding: 13px 14px; background: var(--vscode-editor-background); }
  .open-connections-row { display: flex; align-items: center; min-width: 0; min-height: 32px; }
  .browser-session-strip { margin-top: 0; min-height: 32px; padding-bottom: 0; flex: 1 1 auto; min-width: 0; justify-content: flex-start; }
  .browser-section-divider { height: 1px; background: var(--vscode-panel-border); flex: 0 0 auto; }
  .card { border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .connection-card { position: relative; opacity: 1; transform: translateX(0); }
  .connection-resize-handle { position: absolute; top: 0; right: 0; bottom: 0; width: 8px; z-index: 20; cursor: col-resize; background: transparent; }
  .layout.connection-collapsed .connection-resize-handle { display: none; }
  body.resizing-connection-panel, body.resizing-connection-panel * { cursor: col-resize !important; user-select: none !important; -webkit-user-select: none !important; }
  body.resizing-connection-panel .layout.connection-transition-ready,
  body.resizing-connection-panel .layout.connection-transition-ready .connection-card,
  body.resizing-connection-panel .layout.connection-transition-ready .connection-panel-handle { transition: none; }
  @media (prefers-reduced-motion: no-preference) {
    body.resizing-connection-panel .layout.connection-transition-ready.connection-collapse-animating { transition: grid-template-columns 150ms ease-out, gap 150ms ease-out; }
    body.resizing-connection-panel .layout.connection-transition-ready.connection-collapse-animating .connection-card { transition: opacity 150ms ease-out, transform 150ms ease-out, border-color 150ms ease-out; }
    body.resizing-connection-panel .layout.connection-transition-ready.connection-collapse-animating .connection-panel-handle { transition: opacity 150ms ease-out, transform 150ms ease-out; }
  }
  .card-header { padding: 13px 14px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
  .connection-card-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; min-height: 63px; padding-right: 36px; }
  .connection-card-title-text { min-width: 0; }
  .panel-toggle-button { width: 28px; min-width: 28px; height: 28px; min-height: 28px; padding: 4px; border-radius: 3px; flex: 0 0 auto; }
  .panel-toggle-button svg { width: 16px; height: 16px; }
  .browser-open-text-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .card-title { font-weight: 650; margin: 0; }
  .card-subtitle { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; line-height: 1.3; margin-top: 3px; opacity: 0.85; }
  .card-body { padding: 14px; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden; }
  .browser-card .card-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .connection-card .connection-card-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; padding: 0; overflow: hidden; }
  .connection-profile-section { flex: 0 0 auto; padding: 14px; min-width: 0; }
  .connection-card .profile-row { margin-bottom: 0; }
  .connection-details-scroll { flex: 1 1 auto; min-height: 0; min-width: 0; padding: 12px 14px 14px; overflow-y: auto; overflow-x: hidden; }
  .connection-panel-divider { height: 1px; background: var(--vscode-panel-border); flex: 0 0 auto; }
  .connection-actions-section { flex: 0 0 auto; padding: 12px 14px 14px; background: var(--vscode-sideBar-background); }
  .form-grid { display: grid; grid-template-columns: minmax(0, 1fr) 70px; gap: 9px; min-width: 0; }
  .full { grid-column: 1 / -1; }
  .keepalive-row { margin-top: 8px; margin-bottom: 0; }
  label { display: block; font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 5px; }
  input, select { width: 100%; height: 31px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 5px 8px; border-radius: 3px; outline: none; }
  input:focus, select:focus { border-color: var(--vscode-focusBorder); }
  input:disabled, select:disabled { opacity: 0.68; }
  .input-with-button { position: relative; display: flex; align-items: center; }
  .input-with-button input { padding-right: 34px; }
  .input-with-button.reveal-hidden input { padding-right: 8px; }
  .input-with-button.reveal-hidden .password-reveal-button { display: none; }
  .input-icon-button { position: absolute; top: 2px; right: 2px; width: 27px; min-width: 27px; height: 27px; min-height: 27px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 0; border-left: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 0 2px 2px 0; background: transparent; color: var(--vscode-input-foreground); opacity: 0.8; }
  .input-icon-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .input-icon-button svg { width: 15px; height: 15px; display: block; fill: currentColor; }
  .button-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  .connection-actions { display: grid; grid-template-columns: 1fr; gap: 8px; align-items: center; width: 100%; min-width: 0; margin-top: 0; }
  .connection-actions button { width: 100%; height: 32px; min-height: 32px; display: inline-flex; align-items: center; justify-content: center; padding: 0 10px; }
  button { min-height: 31px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 6px 12px; border-radius: 3px; cursor: pointer; white-space: nowrap; }
  button.icon-only { min-width: 32px; width: 32px; height: 32px; min-height: 32px; padding: 4px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
  button.icon-only svg { width: 16px; height: 16px; display: block; flex: 0 0 auto; fill: currentColor; }
  button.profile-icon-button svg, .path-actions button.icon-only svg { width: 24px; height: 24px; }
  button.profile-icon-button svg, button.profile-icon-button svg path { fill: currentColor; color: inherit; }
  .tooltip-anchor { position: relative; display: inline-flex; }
  .has-tooltip { position: relative; }
  .input-with-button .input-icon-button.has-tooltip { position: absolute; top: 2px; right: 2px; }
  .webview-tooltip { position: fixed; z-index: 10000; max-width: min(360px, calc(100vw - 24px)); padding: 4px 7px; border-radius: 3px; background: var(--vscode-editorWidget-background); color: var(--vscode-editorWidget-foreground); border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28); font-size: 12px; line-height: 1.25; white-space: nowrap; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(2px); transition: opacity 80ms ease, transform 80ms ease; }
  .webview-tooltip.visible { opacity: 1; visibility: visible; transform: translateY(0); }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button:disabled { cursor: default; opacity: 0.55; }
  button.secondary { background: var(--vscode-button-secondaryBackground, var(--vscode-input-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-button-border, var(--vscode-input-border, var(--vscode-panel-border))); }
  button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  button.secondary:disabled { background: var(--vscode-button-secondaryBackground, var(--vscode-input-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border-color: var(--vscode-button-border, var(--vscode-input-border, var(--vscode-panel-border))); }
  button.danger { background: var(--vscode-inputValidation-errorBackground, var(--vscode-button-secondaryBackground)); color: var(--vscode-inputValidation-errorForeground, var(--vscode-button-secondaryForeground)); }
  button.danger:hover:not(:disabled) { background: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); color: var(--vscode-inputValidation-errorForeground, var(--vscode-button-foreground)); }
  .profile-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: end; margin-bottom: 12px; min-width: 0; }
  .profile-picker-field { min-width: 0; }
  .profile-select-native { display: none; }
  .profile-picker { position: relative; min-width: 0; }
  .profile-dropdown-button { width: 100%; height: 31px; min-height: 31px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 5px 7px 5px 8px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); text-align: left; }
  .profile-dropdown-button:hover:not(:disabled) { background: var(--vscode-input-background); border-color: var(--vscode-focusBorder); }
  .profile-dropdown-button:focus { outline: none; border-color: var(--vscode-focusBorder); }
  .profile-dropdown-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .profile-dropdown-chevron { width: 15px; height: 15px; display: block; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; fill: none; opacity: 0.78; transition: transform 120ms ease; }
  .profile-picker.open .profile-dropdown-chevron, .auth-picker.open .profile-dropdown-chevron, .connection-type-picker.open .profile-dropdown-chevron { transform: rotate(180deg); }
  .profile-dropdown-menu { position: absolute; z-index: 130; top: calc(100% + 4px); left: 0; right: 0; display: none; width: 100%; max-width: 100%; box-sizing: border-box; max-height: 300px; overflow-y: auto; overflow-x: hidden; padding: 5px; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); }
  .profile-dropdown-filter { padding: 2px 2px 5px; position: sticky; top: -5px; z-index: 1; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); }
  .profile-dropdown-filter input { width: 100%; height: 28px; box-sizing: border-box; padding: 4px 7px; }
  .profile-dropdown-empty { color: var(--vscode-descriptionForeground); padding: 10px 7px; font-size: 12px; }
  .profile-picker.open .profile-dropdown-menu, .auth-picker.open .profile-dropdown-menu, .connection-type-picker.open .profile-dropdown-menu { display: block; }
  .auth-select-native, .connection-type-select-native { display: none; }
  .auth-picker, .connection-type-picker { position: relative; min-width: 0; }
  .auth-method-block.hidden { display: none; }
  .connection-type-note { display: none; margin-top: 5px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.25; opacity: 0.78; }
  .connection-type-note.visible { display: block; }
  .ftps-certificate-block { display: none; }
  .ftps-certificate-block.visible { display: block; margin-top: 8px; }
  .ftps-self-signed-row { margin-top: 8px; margin-bottom: 0; line-height: 1.35; }
  #ftpsCaCertificateBlock { margin-top: 10px; }
  .profile-dropdown-item { width: 100%; min-height: 34px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; align-items: center; padding: 6px 7px; border: 0; border-radius: 3px; background: transparent; color: inherit; text-align: left; }
  .profile-dropdown-item:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  .profile-dropdown-item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .profile-dropdown-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .profile-dropdown-meta { color: var(--vscode-descriptionForeground); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .profile-dropdown-item.selected .profile-dropdown-meta { color: inherit; opacity: 0.78; }
  .profile-dropdown-separator { height: 1px; margin: 5px 3px; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); }
  .manage-profiles-button { width: 32px; min-width: 32px; height: 32px; min-height: 32px; padding: 4px; display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
  .manage-profiles-button svg { width: 24px; height: 24px; display: block; fill: currentColor; flex: 0 0 auto; }
  .connection-details-title { margin: 0 0 10px; color: var(--vscode-foreground); font-size: 12px; font-weight: 650; }
  .connection-section-title { grid-column: 1 / -1; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 650; letter-spacing: 0.03em; text-transform: uppercase; margin: 4px 0 -2px; }
  .connection-section-title.actions-title { margin-top: 14px; }
  .divider { height: 1px; background: var(--vscode-panel-border); margin: 14px 0; }
  .hint-list { margin: 14px 0 0; padding-left: 17px; color: var(--vscode-descriptionForeground); line-height: 1.5; font-size: 12px; }
  .auth-block { display: none; }
  .auth-block.visible { display: block; }
  .checkbox-row { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; color: var(--vscode-foreground); font-size: 12px; }
  .dialog-checkbox,
  .checkbox-row input[type="checkbox"],
  .modal-checkbox-line input[type="checkbox"] { appearance: none; -webkit-appearance: none; position: relative; flex: 0 0 auto; width: 14px; min-width: 14px; height: 14px; min-height: 14px; margin: 0; padding: 0; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; background: var(--vscode-input-background); color: var(--vscode-button-foreground); cursor: pointer; }
  .dialog-checkbox:checked,
  .checkbox-row input[type="checkbox"]:checked,
  .modal-checkbox-line input[type="checkbox"]:checked { background: var(--vscode-button-background); border-color: var(--vscode-button-background); }
  .dialog-checkbox:checked::after,
  .checkbox-row input[type="checkbox"]:checked::after,
  .modal-checkbox-line input[type="checkbox"]:checked::after { content: ''; position: absolute; left: 50%; top: 40%; width: 3.5px; height: 7px; border: solid var(--vscode-button-foreground); border-width: 0 1.5px 1.5px 0; transform: translate(-50%, -50%) rotate(45deg); transform-origin: center; }
  .dialog-checkbox:focus-visible,
  .checkbox-row input[type="checkbox"]:focus-visible,
  .modal-checkbox-line input[type="checkbox"]:focus-visible { border-color: var(--vscode-focusBorder); outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .dialog-checkbox:disabled,
  .checkbox-row input[type="checkbox"]:disabled,
  .modal-checkbox-line input[type="checkbox"]:disabled { opacity: 0.68; cursor: default; }
  .credential-state { margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.3; opacity: 0.72; }
  .credential-state.saved { color: var(--vscode-testing-iconPassed, var(--vscode-descriptionForeground)); }
  .credential-state.not-saved { color: var(--vscode-descriptionForeground); }
  .browser-header { display: block; }
  .browser-title-row { display: flex; justify-content: space-between; gap: 12px; align-items: flex-end; min-width: 0; }
  .browser-title-text { min-width: 0; }
  .sudo-toggle { display: inline-flex; flex-direction: row; align-items: center; justify-content: center; justify-self: start; gap: 6px; width: 64px; min-width: 64px; height: 28px; min-height: 28px; box-sizing: border-box; margin: 0; padding: 0; font-size: 12px; line-height: 16px; color: var(--vscode-descriptionForeground); cursor: pointer; user-select: none; white-space: nowrap; }
  .sudo-toggle input { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; }
  .sudo-toggle-track { position: relative; width: 26px; height: 14px; border-radius: 999px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease; }
  .sudo-toggle-thumb { position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-descriptionForeground); transition: transform 120ms ease, background 120ms ease; }
  .sudo-toggle input:checked + .sudo-toggle-track { background: var(--vscode-button-background); border-color: var(--vscode-button-background); }
  .sudo-toggle input:checked + .sudo-toggle-track .sudo-toggle-thumb { transform: translateX(12px); background: var(--vscode-button-foreground); }
  .sudo-toggle input:disabled + .sudo-toggle-track { opacity: 0.55; }
  .sudo-toggle.enabled .sudo-toggle-state { color: var(--vscode-foreground); }
  .sudo-toggle-state { min-width: 0; text-align: center; color: var(--vscode-descriptionForeground); font-weight: 500; }
  .pathbar { position: relative; display: grid; grid-template-columns: minmax(0, var(--remote-path-width, 1fr)) minmax(0, var(--remote-path-filter-width, 150px)) auto auto auto auto auto 64px; gap: 6px; align-items: center; margin-bottom: 8px; flex: 0 0 auto; }
  .pathbar.hide-command-actions { grid-template-columns: minmax(0, var(--remote-path-width, 1fr)) minmax(0, var(--remote-path-filter-width, 150px)) auto auto auto 64px; }
  .pathbar.hide-sudo-actions { grid-template-columns: minmax(0, var(--remote-path-width, 1fr)) minmax(0, var(--remote-path-filter-width, 150px)) auto auto auto auto; }
  .pathbar.hide-command-actions.hide-sudo-actions { grid-template-columns: minmax(0, var(--remote-path-width, 1fr)) minmax(0, var(--remote-path-filter-width, 150px)) auto auto; }
  .pathbar.remote-path-reset-animating, .pathbar.toolbar-layout-animating { transition: grid-template-columns 150ms ease-out; }
  .pathbar.remote-path-reset-animating .remote-path-resize-handle, .pathbar.toolbar-layout-animating .remote-path-resize-handle { transition: left 150ms ease-out; }
  .pathbar.toolbar-layout-animating > * { will-change: transform, opacity; }
  .pathbar label { margin: 0; }
  .remote-path-box { position: relative; min-width: 0; }
  .remote-path-box input { padding-left: 92px; padding-right: 97px; }
  .remote-path-navigation-buttons { position: absolute; z-index: 3; top: 2px; left: 2px; display: inline-flex; align-items: center; gap: 1px; height: 27px; }
  .remote-path-navigation-button { width: 28px; min-width: 28px; height: 27px; min-height: 27px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 2px; border: 0; border-right: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); background: transparent; color: var(--vscode-input-foreground); opacity: 0.82; line-height: 1; }
  .remote-path-navigation-button svg { width: 23px; height: 23px; display: block; fill: currentColor; stroke: none; pointer-events: none; }
  .remote-path-navigation-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .remote-path-navigation-button:disabled { cursor: default; opacity: 0.42; }
  .remote-path-leading-icon { position: absolute; z-index: 2; top: 50%; left: 68px; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--vscode-foreground); opacity: 0.72; cursor: default; pointer-events: auto; transform: translateY(-50%); }
  .remote-path-leading-icon svg { width: 16px; height: 16px; display: block; fill: currentColor; }
  .remote-path-resize-handle { position: absolute; z-index: 8; top: 50%; left: var(--remote-path-resize-left, 0px); width: 10px; height: 28px; cursor: col-resize; border-radius: 3px; outline: none; transform: translate(-50%, -50%); background: transparent; }
  .remote-path-resize-handle:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  body.resizing-remote-path { cursor: col-resize; user-select: none; -webkit-user-select: none; }
  .remote-path-box.path-breadcrumb-mode input, .remote-path-box.path-breadcrumb-mode input:disabled { color: transparent !important; caret-color: transparent; }
  .remote-path-box.path-breadcrumb-mode input::selection { background: transparent; color: transparent; }
  .remote-path-inline-breadcrumb { position: absolute; z-index: 1; top: 1px; bottom: 1px; left: 92px; right: 97px; display: none; align-items: center; gap: 1px; padding: 0 2px; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 28px; overflow-x: hidden; overflow-y: hidden; white-space: nowrap; scrollbar-width: none; cursor: text; }
  .remote-path-inline-breadcrumb::-webkit-scrollbar { display: none; }
  .remote-path-inline-breadcrumb.is-truncated { padding-left: 0; }
  .remote-path-inline-breadcrumb.is-truncated::before { content: '...'; position: sticky; left: 0; z-index: 3; flex: 0 0 26px; width: 26px; height: 100%; display: inline-flex; align-items: center; justify-content: flex-start; padding-left: 0; color: var(--vscode-descriptionForeground); background: var(--vscode-input-background); pointer-events: none; }
  .remote-path-box.path-breadcrumb-mode .remote-path-inline-breadcrumb { display: flex; }
  .remote-path-inline-breadcrumb button { min-height: 22px; padding: 0 4px; border: 0; border-radius: 3px; background: transparent; color: var(--vscode-foreground); font-size: 12px; line-height: 22px; white-space: nowrap; cursor: pointer; }
  .remote-path-inline-breadcrumb button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .remote-path-inline-breadcrumb button.current { font-weight: 600; cursor: default; }
  .remote-path-breadcrumb-separator { flex: 0 0 16px; width: 16px; height: 24px; min-width: 16px; min-height: 24px; padding: 0; margin: 0; border: 0; border-radius: 3px; background: transparent; color: var(--vscode-descriptionForeground); opacity: 0.82; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; vertical-align: middle; }
  .remote-path-breadcrumb-separator:hover:not(:disabled), .remote-path-breadcrumb-separator.open { opacity: 1; color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .remote-path-breadcrumb-separator-icon { width: 14px; height: 14px; display: block; flex: 0 0 14px; transform-origin: 50% 50%; transition: transform 120ms ease-out; pointer-events: none; }
  .remote-path-breadcrumb-separator-icon path { fill: none; stroke: currentColor; stroke-width: 1.45; stroke-linecap: round; stroke-linejoin: round; }
  .remote-path-breadcrumb-separator.open .remote-path-breadcrumb-separator-icon { transform: rotate(90deg); }
  .remote-path-breadcrumb-segment { display: inline-flex; align-items: center; flex: 0 0 auto; min-width: 0; max-width: 140px; border-radius: 3px; }
  .remote-path-breadcrumb-segment:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .remote-path-breadcrumb-segment .breadcrumb-part-button { max-width: 100%; overflow: hidden; text-overflow: ellipsis; border-radius: 3px; }
  .remote-path-breadcrumb-segment:last-child { max-width: 180px; }
  .remote-path-dropdown { position: absolute; z-index: 120; top: calc(100% + 4px); left: 0; display: none; width: min(380px, calc(100vw - 56px)); max-height: 300px; overflow-y: auto; overflow-x: hidden; padding: 6px; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); }
  .remote-path-dropdown.visible { display: block; }
  .remote-path-dropdown-title { padding: 4px 7px 6px; font-size: 12px; font-weight: 650; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-path-dropdown-state { padding: 8px 7px; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.35; }
  .remote-path-dropdown-state.error { color: var(--vscode-errorForeground, var(--vscode-inputValidation-errorForeground)); }
  .remote-path-dropdown-item { width: 100%; min-height: 30px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 5px 7px; border: 0; border-radius: 3px; background: transparent; color: inherit; text-align: left; }
  .remote-path-dropdown-item:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  .remote-path-dropdown-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-path-dropdown-meta { color: var(--vscode-descriptionForeground); opacity: 0.72; font-size: 11px; white-space: nowrap; }
  .remote-path-favorite-buttons { position: absolute; top: 2px; right: 2px; display: inline-flex; align-items: center; gap: 1px; height: 27px; }
  .remote-path-favorite-button { width: 30px; min-width: 30px; height: 27px; min-height: 27px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 2px; border: 0; border-left: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); background: transparent; color: var(--vscode-input-foreground); opacity: 0.82; line-height: 1; }
  .remote-path-favorite-button svg { width: 25px; height: 25px; display: block; fill: currentColor; stroke: none; pointer-events: none; }
  .remote-path-favorite-button .filled-star-icon,
  .remote-path-favorite-button .filled-hotel-class-icon { display: none; }
  .remote-path-favorite-button.active .star-icon { display: none; }
  .remote-path-favorite-button.active .filled-star-icon { display: block; }
  .remote-path-favorite-button.has-favorites .hotel-class-icon { display: none; }
  .remote-path-favorite-button.has-favorites .filled-hotel-class-icon { display: block; }
  .remote-path-favorite-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .remote-path-favorite-button.active,
  .remote-path-favorite-button.has-favorites { opacity: 1; }
  .remote-path-favorite-button:disabled { cursor: default; opacity: 0.42; }
  .remote-path-favorites-popover { position: absolute; top: calc(100% + 4px); right: 0; z-index: 90; display: none; width: min(520px, 100%); max-height: 240px; overflow-y: auto; overflow-x: hidden; padding: 6px; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); }
  .remote-path-favorites-popover.visible { display: block; }
  .remote-path-favorites-title { padding: 4px 7px 6px; font-size: 12px; font-weight: 650; color: var(--vscode-descriptionForeground); }
  .remote-path-favorites-empty { padding: 8px 7px; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.35; }
  .remote-path-favorite-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px; align-items: center; }
  .remote-path-favorite-path { min-height: 28px; padding: 5px 7px; border: 0; border-radius: 3px; background: transparent; color: inherit; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-path-favorite-path:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  .remote-path-favorite-remove { width: 26px; min-width: 26px; height: 26px; min-height: 26px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: var(--vscode-descriptionForeground); font-size: 16px; line-height: 1; }
  .remote-path-favorite-remove:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); color: var(--vscode-errorForeground, var(--vscode-foreground)); }
  .path-actions { display: inline-flex; gap: 6px; align-items: center; }
  .toolbar-separator { width: 1px; height: 24px; background: var(--vscode-panel-border); margin: 0 2px; flex: 0 0 auto; }
  .filter-sudo-separator { justify-self: center; margin: 0; }
  .transfer-queue-button { position: relative; }
  .transfer-queue-count { position: absolute; top: -5px; right: -5px; display: none; align-items: center; justify-content: center; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; background: var(--vscode-badge-background, var(--vscode-button-background)); color: var(--vscode-badge-foreground, var(--vscode-button-foreground)); font-size: 10px; font-weight: 650; line-height: 15px; box-shadow: 0 0 0 1px var(--vscode-editor-background); }
  .transfer-queue-button.has-pending .transfer-queue-count { display: inline-flex; }
  .filter-box { position: relative; width: 100%; min-width: 100px; }
  .filter-input { width: 100%; padding-right: 28px; }
  .filter-clear-button { position: absolute; top: 50%; right: 4px; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: 22px; min-width: 22px; height: 22px; min-height: 22px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: var(--vscode-input-foreground); opacity: 0; visibility: hidden; cursor: pointer; line-height: 0; }
  .filter-clear-button svg { display: block; width: 11px; height: 11px; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; pointer-events: none; }
  .filter-box.has-value .filter-clear-button { opacity: 0.7; visibility: visible; }
  .filter-box.has-value .filter-clear-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .filter-clear-button:disabled { cursor: default; }
  .table-wrap { border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); flex: 1 1 0; min-height: 0; max-height: none; overflow: auto; scrollbar-gutter: stable; border-radius: 6px; user-select: none; -webkit-user-select: none; transition: border-color 120ms ease, box-shadow 120ms ease; }
  .table-wrap.privileged-session { border-color: color-mix(in srgb, #7a2f2f 62%, var(--vscode-panel-border)); box-shadow: 0 0 0 1px color-mix(in srgb, #7a2f2f 18%, transparent); }
  table { width: 100%; min-width: 984px; border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 6px 10px; line-height: 1.25; border-bottom: 1px solid var(--vscode-panel-border); text-align: left; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  th { position: sticky; top: 0; background: var(--vscode-sideBar-background); font-weight: 500; z-index: 1; user-select: none; overflow: visible; }
  th.sortable { cursor: pointer; }
  th.sortable:hover { background: var(--vscode-list-hoverBackground); }
  th.size, td.size { text-align: right; }
  th.permissions, td.permissions { font-family: var(--vscode-editor-font-family); }
  .header-content { display: flex; align-items: center; min-width: 0; overflow: hidden; }
  .header-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sort-indicator { margin-left: 5px; width: 10px; flex: 0 0 10px; color: var(--vscode-descriptionForeground); }
  .column-resizer { position: absolute; top: 0; right: -1px; width: 3px; height: 100%; cursor: col-resize; z-index: 3; background: transparent; }
  .column-resizer::after { content: ""; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; transform: translateX(-50%) scaleX(0.65); transform-origin: center; background: transparent; pointer-events: none; }
  .column-resizer:hover::after, .column-resizer.resizing::after { background: var(--vscode-focusBorder); opacity: 0.75; }
  body.resizing-columns { cursor: col-resize; user-select: none; }
  button.compact { min-height: 26px; padding: 4px 8px; font-size: 12px; }
  tr.entry-row { cursor: pointer; user-select: none; -webkit-user-select: none; }
  .entry-row td { font-weight: 300; }
  tr.entry-row:hover { background: var(--vscode-list-hoverBackground); }
  tr.entry-row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  tr.entry-row.selected:hover { background: var(--vscode-list-activeSelectionBackground); }
  .entry-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .entry-icon { width: 20px; min-width: 20px; display: inline-flex; align-items: center; justify-content: center; color: var(--vscode-icon-foreground, var(--vscode-foreground)); opacity: 0.9; line-height: 0; }
  .entry-icon svg { width: 20px; height: 20px; display: block; fill: currentColor; }
  .entry-icon svg path { fill: currentColor; }
  .entry-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty-state { padding: 34px 16px; text-align: center; color: var(--vscode-descriptionForeground); }
  .context-menu { position: fixed; z-index: 100; width: 196px; padding: 4px; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, var(--vscode-editorWidget-foreground)); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); display: none; }
  .context-menu.visible { display: block; }
  .context-menu button { width: 100%; box-sizing: border-box; min-height: 28px; padding: 5px 9px; text-align: left; white-space: nowrap; background: transparent; color: inherit; border-radius: 3px; }
  .context-menu button:hover:not(:disabled) { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-menu-selectionForeground, inherit); }
  .context-submenu { position: relative; }
  .context-submenu-trigger { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
  .context-submenu-trigger::after { content: '›'; opacity: 0.8; }
  .context-submenu-content { position: absolute; left: calc(100% + 3px); top: -4px; width: 120px; padding: 4px; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, var(--vscode-editorWidget-foreground)); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); display: none; }
  .context-submenu:hover .context-submenu-content, .context-submenu:focus-within .context-submenu-content { display: block; }
  .context-menu-separator { height: 1px; margin: 4px 3px; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); opacity: 0.9; }

  .file-properties-backdrop { position: fixed; inset: 0; z-index: 210; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.45); }
  .file-properties-backdrop.visible { display: flex; }
  .file-properties-dialog { width: min(640px, 100%); max-height: min(760px, calc(100vh - 48px)); overflow: hidden; display: flex; flex-direction: column; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .file-properties-header { padding: 16px 18px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .file-properties-title { margin: 0 0 5px; font-size: 18px; font-weight: 650; }
  .file-properties-path { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; font-size: 12px; }
  .file-properties-body { padding: 16px 18px; overflow: auto; }
  .file-properties-grid { display: grid; grid-template-columns: 150px minmax(0, 1fr); border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; background: var(--vscode-editor-background); }
  .manage-profiles-dialog { width: min(640px, calc(100vw - 48px)); height: min(560px, calc(100vh - 48px)); max-height: calc(100vh - 48px); }
  .manage-profiles-dialog .file-properties-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .manage-profiles-filter { flex: 0 0 auto; margin-bottom: 10px; }
  .manage-profiles-filter input { width: 100%; box-sizing: border-box; }
  .manage-profiles-list { flex: 1 1 auto; min-height: 0; display: grid; align-content: start; gap: 6px; overflow: auto; padding-right: 0; }
  .manage-profiles-empty { color: var(--vscode-descriptionForeground); padding: 14px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
  .manage-profiles-header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
  .manage-profiles-header-actions { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
  .manage-profiles-header-actions button { min-height: 28px; height: 28px; padding: 3px 10px; font-size: 12px; }
  .backup-dialog { width: min(620px, calc(100vw - 48px)); max-height: calc(100vh - 48px); }
  .backup-dialog.export-backup-dialog { height: min(500px, calc(100vh - 48px)); }
  .backup-dialog.import-backup-dialog { height: min(660px, calc(100vh - 48px)); }
  .backup-dialog .file-properties-path { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; line-height: 1.3; margin-top: 3px; opacity: 0.85; }
  .backup-dialog .file-properties-body { flex: 1 1 auto; min-height: 0; display: grid; align-content: start; gap: 10px; overflow: hidden; }
  .connection-name-dialog { width: min(460px, calc(100vw - 48px)); }
  .connection-name-dialog .file-properties-body { display: grid; gap: 8px; }
  .connection-name-feedback { min-height: 16px; color: var(--remoteedit-validation-error); font-size: 12px; line-height: 1.35; }
  .backup-section { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
  .backup-summary-section { gap: 4px; padding: 7px 9px; }
  .backup-section-title { margin: 0; font-size: 11px; font-weight: 650; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.03em; }
  .backup-checkbox-list { display: grid; gap: 8px; }
  .backup-child-options { display: grid; gap: 7px; margin-left: 22px; }
  .backup-credential-block { display: none; gap: 8px; margin-left: 22px; padding: 10px 11px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
  .backup-credential-block.visible { display: grid; }
  .backup-credential-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .backup-credential-fields label { display: grid; gap: 5px; min-width: 0; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 600; }
  .backup-credential-fields input { width: 100%; box-sizing: border-box; }
  .backup-credential-fields .input-with-button { width: 100%; }
  .backup-field-error { display: none; min-height: 13px; color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground)); font-size: 10.5px; font-weight: 400; line-height: 1.25; }
  .backup-field-error.visible { display: block; }
  .backup-credential-fields input.backup-input-invalid { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); }
  .password-reveal-button svg { width: 16px; height: 16px; }
  .backup-summary-line { min-width: 0; color: var(--vscode-foreground); font-size: 11px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .backup-result { display: none; padding: 8px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-size: 12px; line-height: 1.35; }
  .backup-result.visible { display: block; }
  .backup-result.success { border-color: color-mix(in srgb, var(--vscode-button-background) 45%, var(--vscode-panel-border)); }
  .backup-result.error { color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground)); border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); background: transparent; }
  .backup-import-mode { display: grid; gap: 7px; padding: 10px 11px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
  .backup-import-mode-title { margin: 0; font-size: 11px; font-weight: 650; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.03em; }
  .backup-import-mode .modal-checkbox-line { align-items: center; }
  .backup-import-mode input[type="radio"] { appearance: none; -webkit-appearance: none; position: relative; flex: 0 0 auto; width: 14px; min-width: 14px; height: 14px; min-height: 14px; margin: 0; padding: 0; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 50%; background: var(--vscode-input-background); cursor: pointer; }
  .backup-import-mode input[type="radio"]:checked { border-color: var(--vscode-button-background); }
  .backup-import-mode input[type="radio"]:checked::after { content: ''; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-button-background); transform: translate(-50%, -50%); }
  .backup-import-mode input[type="radio"]:focus-visible { border-color: var(--vscode-focusBorder); outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .backup-import-mode input[type="radio"]:disabled { opacity: 0.68; cursor: default; }
  .backup-mode-help { margin: 0; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.35; opacity: 0.78; }
  .backup-validation { min-height: 16px; color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground)); font-size: 12px; line-height: 1.35; }
  @media (max-width: 560px) { .manage-profiles-header-row { flex-direction: column; } .backup-credential-fields { grid-template-columns: 1fr; } .backup-summary-line { white-space: normal; } }
  .manage-profile-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 9px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
  .manage-profile-main { min-width: 0; }
  .manage-profile-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .manage-profile-meta { color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.3; opacity: 0.72; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .manage-profile-rename-form { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; align-items: center; grid-column: 1 / -1; }
  .manage-profile-rename-form input { height: 29px; }
  .manage-profile-row button { min-height: 32px; padding: 4px 8px; }
  .manage-profile-icon-button { width: 32px; min-width: 32px; height: 32px; min-height: 32px; padding: 4px; display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
  .manage-profile-icon-button svg { width: 22px; height: 22px; display: block; fill: currentColor; stroke: none; flex: 0 0 auto; }
  .file-properties-label, .file-properties-value { min-width: 0; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); line-height: 1.35; }
  .file-properties-label { color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background); font-weight: 600; }
  .file-properties-value { overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
  .file-properties-label:last-of-type, .file-properties-value:last-of-type { border-bottom: 0; }
  .file-properties-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 16px; }
  .owner-group-form { display: grid; gap: 12px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
  .owner-group-input-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .modal-checkbox-block { display: grid; gap: 2px; }
  .modal-checkbox-line { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--vscode-foreground); font-size: 12px; line-height: 1.35; user-select: none; }
  .modal-helper-text { color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.25; opacity: 0.72; }
  .modal-checkbox-helper { margin-left: 22px; }
  .modal-checkbox-block.no-recursive .modal-checkbox-helper { margin-left: 0; }
  .modal-checkbox-helper:empty { display: none; }
  .owner-group-validation { color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground)); font-size: 12px; min-height: 16px; }

  .remote-command-backdrop { position: fixed; inset: 0; z-index: 230; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.45); }
  .remote-command-backdrop.visible { display: flex; }
  .remote-command-dialog { width: min(860px, calc(100vw - 48px)); height: min(660px, calc(100vh - 48px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .remote-command-header { padding: 16px 18px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .remote-command-title { margin: 0 0 5px; font-size: 18px; font-weight: 650; }
  .remote-command-subtitle { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; line-height: 1.3; margin-top: 3px; opacity: 0.85; }
  .remote-command-body { flex: 1 1 auto; min-height: 0; padding: 12px 18px 16px; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 8px; overflow: hidden; }
  .remote-command-field-grid { display: grid; gap: 14px; }
  .remote-command-meta-block { display: grid; gap: 1px; }
  .remote-command-meta { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px; align-items: baseline; font-size: 11px; line-height: 1.22; min-width: 0; }
  .remote-command-meta-label { color: var(--vscode-descriptionForeground); font-weight: 500; white-space: nowrap; }
  .remote-command-connected-to, .remote-command-working-directory { min-width: 0; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-command-run-as { min-width: 0; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-command-run-as.sudo { color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground)); }
  .remote-command-field label { margin-bottom: 5px; font-size: 12px; font-weight: 650; color: var(--vscode-descriptionForeground); }
  .remote-command-input-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; align-items: start; }
  .remote-command-input-row textarea { width: 100%; min-height: 54px; max-height: 96px; box-sizing: border-box; resize: vertical; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: 5px 8px; outline: none; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-font-size); line-height: 1.4; }
  .remote-command-input-row textarea:focus { border-color: var(--vscode-focusBorder); }
  .remote-command-input-row textarea:disabled { opacity: 0.68; }
  .remote-command-run-row { display: flex; justify-content: flex-end; }
  .remote-command-run-row button { min-width: var(--remote-command-close-button-width, auto); }
  .remote-command-helper { color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.3; opacity: 0.78; }
  .remote-command-output-section { min-height: 0; display: flex; flex-direction: column; gap: 6px; }
  .remote-command-output-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .remote-command-output-title { font-size: 12px; font-weight: 650; color: var(--vscode-descriptionForeground); }
  .remote-command-output-notice { flex: 1 1 auto; min-height: 16px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.3; text-align: right; opacity: 0.85; }
  .remote-command-status { min-height: 16px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.3; text-align: right; opacity: 0.9; }
  .remote-command-status.error { color: var(--vscode-errorForeground, var(--vscode-inputValidation-errorForeground)); }
  .remote-command-output-wrap { flex: 1 1 auto; min-height: 0; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); overflow: auto; }
  .remote-command-output { min-height: 100%; margin: 0; padding: 10px 12px; color: var(--vscode-editor-foreground, var(--vscode-foreground)); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
  .remote-command-output-command { color: var(--vscode-terminal-ansiGreen, #89d185); }
  .remote-command-output-system { color: var(--vscode-descriptionForeground); opacity: 0.82; }
  .remote-command-close-warning, .remote-command-stop-warning { display: none; align-items: center; justify-content: space-between; gap: 12px; margin: 0 18px 12px; padding: 10px 12px; border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border)); border-radius: 6px; background: var(--vscode-inputValidation-warningBackground, var(--vscode-editor-background)); color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground)); }
  .remote-command-close-warning.visible, .remote-command-stop-warning.visible { display: flex; }
  .remote-command-close-warning-text { min-width: 0; font-size: 12px; line-height: 1.35; }
  .remote-command-close-warning-actions, .remote-command-stop-warning-actions { display: inline-flex; gap: 8px; flex: 0 0 auto; }
  .remote-command-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 16px; }

  .transfer-queue-backdrop { position: fixed; inset: 0; z-index: 220; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.45); }
  .transfer-queue-backdrop.visible { display: flex; }
  .transfer-queue-dialog { width: min(620px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  @media (min-height: 900px) { .transfer-queue-dialog { max-height: 720px; } }
  .transfer-queue-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .transfer-queue-title { margin: 0; font-size: 17px; font-weight: 650; }
  .transfer-queue-close { width: 28px; min-width: 28px; height: 28px; min-height: 28px; padding: 0; border-radius: 50%; background: transparent; color: inherit; border: 0; font-size: 18px; line-height: 28px; }
  .transfer-queue-close:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .transfer-queue-body { flex: 1 1 auto; min-height: 0; max-height: calc(100vh - 154px); overflow-x: hidden; overflow-y: scroll; padding: 14px 16px 16px; display: grid; gap: 14px; scrollbar-gutter: stable; }
  @media (min-height: 900px) { .transfer-queue-body { max-height: 566px; } }
  .transfer-queue-section { border: 1px solid var(--vscode-panel-border); border-radius: 7px; overflow: hidden; background: var(--vscode-editor-background); }
  .transfer-queue-section-title { margin: 0; padding: 9px 11px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); font-weight: 600; }
  .transfer-queue-items { display: grid; gap: 0; }
  .transfer-queue-empty { padding: 18px 12px; color: var(--vscode-descriptionForeground); text-align: center; }
  .transfer-queue-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 11px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .transfer-queue-item:last-child { border-bottom: 0; }
  .transfer-queue-item-main { display: grid; gap: 4px; min-width: 0; }
  .transfer-queue-item-title { display: flex; align-items: center; gap: 7px; min-width: 0; font-weight: 600; }
  .transfer-queue-icon { width: 18px; min-width: 18px; text-align: center; color: var(--vscode-icon-foreground, var(--vscode-foreground)); }
  .transfer-queue-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .transfer-queue-detail, .transfer-queue-status, .transfer-queue-progress { color: var(--vscode-descriptionForeground); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .transfer-queue-failed-items { margin-top: 6px; padding: 7px 9px; display: grid; gap: 4px; min-width: 0; border: 1px solid var(--vscode-panel-border); border-left: 2px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border)); border-radius: 6px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.35; }
  .transfer-queue-failed-title { color: var(--vscode-descriptionForeground); font-weight: 500; opacity: 0.92; }
  .transfer-queue-failed-item { display: grid; gap: 1px; min-width: 0; padding: 1px 0; }
  .transfer-queue-failed-path { color: var(--vscode-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .transfer-queue-failed-error { color: var(--vscode-descriptionForeground); opacity: 0.82; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 10px; }
  .transfer-queue-failed-more { color: var(--vscode-descriptionForeground); opacity: 0.78; }
  .transfer-queue-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .transfer-queue-actions button { min-height: 27px; padding: 4px 9px; }
  .transfer-queue-footer { display: flex; justify-content: flex-end; padding: 0 16px 16px; }

  .confirm-dialog-backdrop { position: fixed; inset: 0; z-index: 240; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.45); }
  .confirm-dialog-backdrop.visible { display: flex; }
  .confirm-dialog { width: min(520px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .confirm-dialog-header { padding: 16px 18px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  .confirm-dialog-title { margin: 0; font-size: 18px; font-weight: 650; }
  .confirm-dialog-body { padding: 15px 18px; display: grid; gap: 12px; overflow: auto; }
  .confirm-dialog-message { margin: 0; line-height: 1.45; }
  .confirm-dialog-details { margin: 0; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
  .confirm-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 16px; }
  .transfer-conflict-backdrop { position: fixed; inset: 0; z-index: 250; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.45); }
  .transfer-conflict-backdrop.visible { display: flex; }
  .transfer-conflict-dialog { width: min(620px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .transfer-conflict-header { padding: 16px 18px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  .transfer-conflict-title { margin: 0; font-size: 18px; font-weight: 650; }
  .transfer-conflict-body { padding: 15px 18px; display: grid; gap: 12px; overflow: auto; }
  .transfer-conflict-message { margin: 0; line-height: 1.45; }
  .transfer-conflict-file { display: grid; gap: 3px; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-input-background); }
  .transfer-conflict-name { font-weight: 650; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
  .transfer-conflict-path { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
  .transfer-conflict-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .transfer-conflict-card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; background: var(--vscode-editor-background); }
  .transfer-conflict-card-title { margin: 0; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); font-size: 12px; font-weight: 650; }
  .transfer-conflict-card-body { padding: 9px 10px; display: grid; gap: 5px; min-width: 0; }
  .transfer-conflict-meta { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
  .transfer-conflict-note { margin: 0; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.35; opacity: 0.78; }
  .transfer-conflict-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding: 0 18px 16px; }
  .transfer-conflict-actions button { min-height: 29px; }
  @media (max-width: 560px) { .transfer-conflict-grid { grid-template-columns: 1fr; } }

  .permission-backdrop { position: fixed; inset: 0; z-index: 200; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.45); }
  .permission-backdrop.visible { display: flex; }
  .permission-dialog { width: min(620px, 100%); max-height: min(760px, calc(100vh - 48px)); overflow: auto; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .permission-dialog-header { padding: 16px 18px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .permission-dialog-title { margin: 0 0 5px; font-size: 18px; font-weight: 650; }
  .permission-dialog-path { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; font-size: 12px; }
  .permission-dialog-body { padding: 16px 18px; display: grid; gap: 16px; }
  .permission-section { border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; background: var(--vscode-editor-background); }
  .permission-section-title { margin: 0; padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; background: var(--vscode-sideBar-background); }
  .permission-table { width: 100%; min-width: 0; border-collapse: collapse; table-layout: fixed; }
  .permission-table th, .permission-table td { padding: 8px 10px; text-align: center; vertical-align: middle; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  .permission-table th:first-child, .permission-table td:first-child { text-align: left; width: 34%; }
  .permission-table .dialog-checkbox { display: block; margin: 0 auto; }
  .permission-table tbody tr:last-child td { border-bottom: 0; }
  .permission-table th { position: static; z-index: auto; cursor: default; background: var(--vscode-sideBar-background); }
  .permission-special-list { display: grid; gap: 10px; padding: 12px; }
  .permission-special-item { display: flex; align-items: center; gap: 10px; line-height: 1.35; user-select: none; }
  .permission-special-item .permission-check { margin-top: 0; }
  .permission-mode-row { display: grid; grid-template-columns: max-content 90px minmax(0, max-content); justify-content: start; align-items: center; gap: 10px; padding: 12px; }
  .permission-mode-row label { margin: 0; font-weight: 600; color: var(--vscode-foreground); }
  .permission-checkbox-block { padding: 0 12px 0; }
  #permissionModeInput { width: 90px; font-family: var(--vscode-editor-font-family, monospace); }
  #permissionModeInput.invalid { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); outline-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); }
  .permission-current { justify-self: start; text-align: left; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.25; min-width: 0; }
  .permission-preview-stack { display: flex; flex-direction: column; justify-content: center; gap: 2px; white-space: nowrap; }
  .permission-preview-line { display: block; }
  @media (max-width: 640px) { .permission-mode-row { grid-template-columns: max-content 90px; justify-content: start; } .permission-preview-stack { grid-column: 2 / -1; } }
  .permission-validation { min-height: 18px; padding: 0 12px 12px; color: var(--vscode-errorForeground); }
  .permission-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 16px; }
  .statusbar { margin-top: 12px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; flex: 0 0 auto; padding: 10px 12px; background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; min-height: 40px; color: var(--vscode-descriptionForeground); }
  .statusbar.error { color: var(--remoteedit-validation-error); border-color: var(--remoteedit-validation-error); }
  .statusbar.busy { color: var(--vscode-progressBar-background, var(--vscode-foreground)); }
  .status-main { display: inline-flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden; }
  .status-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status-output-link { flex: 0 0 auto; min-height: auto; height: auto; padding: 0; border: 0; background: transparent; color: inherit; text-decoration: underline; text-underline-offset: 2px; line-height: 1.2; cursor: pointer; white-space: nowrap; }
  .statusbar .status-output-link:hover, .statusbar .status-output-link:active, .statusbar .status-output-link:focus { background: transparent; color: inherit; }
  .statusbar .status-output-link:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; background: transparent; }
  .status-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
  .status-action-button { align-self: center; min-height: 26px; height: 26px; padding: 0 8px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; border-radius: 3px; border: 1px solid var(--vscode-panel-border); background: transparent; color: inherit; opacity: 0.9; line-height: 1; white-space: nowrap; }
  .status-action-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); border-color: var(--vscode-focusBorder, var(--vscode-button-border, var(--vscode-panel-border))); }
  .status-action-button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .statusbar.error .status-copy-button:hover:not(:disabled) { border-color: var(--remoteedit-validation-error); }
  .statusbar.error .status-copy-button:focus-visible { outline-color: var(--remoteedit-validation-error); }
  .status-cancel-button[hidden] { display: none; }
  .status-copy-wrap { position: relative; display: inline-flex; align-items: center; justify-content: center; align-self: center; height: 26px; min-height: 26px; }
  .status-copy-button { width: 28px; min-width: 28px; padding: 0; }
  .status-copy-button svg { width: 15px; height: 15px; display: block; fill: currentColor; }
  .status-copy-feedback { position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 60; padding: 4px 8px; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-editorWidget-background, var(--vscode-notifications-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-notifications-foreground)); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28); font-size: 12px; line-height: 1.2; white-space: nowrap; opacity: 0; transform: translateY(4px); pointer-events: none; transition: opacity 120ms ease, transform 120ms ease; }
  .status-copy-feedback.visible { opacity: 1; transform: translateY(0); }
  .spinner { width: 14px; min-width: 14px; height: 14px; border: 2px solid var(--vscode-panel-border); border-top-color: var(--vscode-progressBar-background, var(--vscode-foreground)); border-radius: 50%; animation: spin 0.9s linear infinite; display: none; flex: 0 0 auto; }
  .statusbar.busy .spinner { display: block; }
  .muted { color: var(--vscode-descriptionForeground); }
  .small { font-size: 12px; }
  code { font-family: var(--vscode-editor-font-family); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 980px) { html, body { overflow: auto; } .page { height: auto; min-height: 100vh; } .layout, .layout.connection-collapsed { grid-template-columns: 1fr; flex: 0 0 auto; } .connection-resize-handle { display: none; } .connection-rail { left: 0; } .browser-column { min-height: 0; } .browser-card { min-height: 520px; } .pathbar, .profile-row, .connection-name-row { grid-template-columns: 1fr; } .remote-path-resize-handle { display: none; } .path-actions { justify-content: flex-start; } .filter-box { width: 100%; } .filter-sudo-separator { display: none; } .sudo-toggle { justify-self: flex-start; } .browser-header { align-items: flex-start; flex-direction: column; } }
  @media (max-height: 720px) and (min-width: 981px) { .hint-list { display: none; } .card-header, .card-body, .browser-open-section, .browser-title-section { padding: 11px 12px; } }
  @media (max-width: 760px) { .open-connections-row { align-items: flex-start; flex-direction: column; gap: 6px; } .browser-session-strip { width: 100%; } }
  </style>
</head>
<body>
  <main class="page">
  <div class="shell">
    <section id="mainLayout" class="layout">
      <aside class="card connection-card">
        <div class="card-header connection-card-header">
          <div class="connection-card-title-text">
            <div class="card-title">Connections</div>
            <div class="card-subtitle">Quick connect or saved profile</div>
          </div>
        </div>
        <div class="connection-panel-handle connection-collapse-handle" aria-label="Connection Panel Expanded">
          <span class="tooltip-anchor tooltip-above" data-tooltip="Hide Connection Panel">
            <button id="hideConnectionPanelButton" type="button" class="secondary icon-only panel-toggle-button" aria-label="Hide Connection Panel">
              <svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M560-240 320-480l240-240 28 28-212 212 212 212-28 28Z" /></svg>
            </button>
          </span>
        </div>
        <div id="connectionResizeHandle" class="connection-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize Connection Panel" aria-valuemin="240" aria-valuemax="390" aria-valuenow="320" title="Resize Connection Panel"></div>
        <div class="card-body connection-card-body">
          <div class="connection-profile-section">
            <div class="profile-row">
            <div class="profile-picker-field">
              <label for="profileDropdownButton">Connection profile</label>
              <div class="profile-picker">
                <button id="profileDropdownButton" type="button" class="profile-dropdown-button" aria-haspopup="listbox" aria-expanded="false">
                  <span id="profileDropdownLabel" class="profile-dropdown-label">New unsaved connection</span>
                  <svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg>
                </button>
                <div id="profileDropdownMenu" class="profile-dropdown-menu" role="listbox" aria-label="Connection Profiles"></div>
              </div>
              <select id="profileSelect" class="profile-select-native" aria-hidden="true" tabindex="-1"><option value="">New unsaved connection</option></select>
              <input id="profileName" type="hidden" autocomplete="off" />
            </div>
            <button id="manageProfilesButton" type="button" class="secondary manage-profiles-button has-tooltip" aria-label="Manage Saved Connections" data-tooltip="Manage Saved Connections">
              <svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M200-280v-40h560v40H200Zm0-180v-40h560v40H200Zm0-180v-40h560v40H200Z" /></svg>
            </button>
            </div>
          </div>

          <div class="connection-panel-divider" aria-hidden="true"></div>
          <div class="connection-details-scroll">
            <div class="connection-details-title">Connection details</div>
            <div class="form-grid">
            <div>
              <label for="host">Host</label>
              <input id="host" autocomplete="off" />
              <label class="checkbox-row keepalive-row has-tooltip" data-tooltip="Send periodic keepalive messages to reduce idle disconnects."><input id="keepAlive" class="dialog-checkbox" type="checkbox" checked /> Keep connection alive</label>
            </div>
            <div><label for="port">Port</label><input id="port" value="22" inputmode="numeric" /></div>

            <div class="full">
              <label for="connectionTypeDropdownButton">Connection Method</label>
              <div class="connection-type-picker">
                <button id="connectionTypeDropdownButton" type="button" class="profile-dropdown-button" aria-haspopup="listbox" aria-expanded="false">
                  <span id="connectionTypeDropdownLabel" class="profile-dropdown-label">SFTP</span>
                  <svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg>
                </button>
                <div id="connectionTypeDropdownMenu" class="profile-dropdown-menu connection-type-dropdown-menu" role="listbox" aria-label="Connection Method">
                  <button type="button" class="profile-dropdown-item" role="option" data-connection-type="sftp">
                    <span class="profile-dropdown-name">SFTP</span>
                    <span class="profile-dropdown-meta">SSH File Transfer Protocol</span>
                  </button>
                  <button type="button" class="profile-dropdown-item" role="option" data-connection-type="ftps">
                    <span class="profile-dropdown-name">FTPS</span>
                    <span class="profile-dropdown-meta">FTP over TLS</span>
                  </button>
                  <button type="button" class="profile-dropdown-item" role="option" data-connection-type="ftp">
                    <span class="profile-dropdown-name">FTP</span>
                    <span class="profile-dropdown-meta">Legacy FTP</span>
                  </button>
                </div>
              </div>
              <select id="connectionType" class="connection-type-select-native" aria-hidden="true" tabindex="-1"><option value="sftp">SFTP</option><option value="ftps">FTPS</option><option value="ftp">FTP</option></select>
              <div id="ftpsCertificateBlock" class="ftps-certificate-block">
                <label class="checkbox-row ftps-self-signed-row has-tooltip" data-tooltip="Accept self-signed or untrusted FTPS certificates for this connection."><input id="ftpsAllowSelfSignedCertificate" class="dialog-checkbox" type="checkbox" /> Allow self-signed/untrusted certificate</label>
                <div id="ftpsCaCertificateBlock">
                  <label for="ftpsCaCertificatePath">CA certificate path</label>
                  <div class="input-with-button">
                    <input id="ftpsCaCertificatePath" autocomplete="off" />
                    <button id="ftpsCaCertificateBrowseButton" class="input-icon-button has-tooltip" type="button" aria-label="Select CA Certificate File" data-tooltip="Select CA Certificate File">
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg>
                    </button>
                  </div>
                  <div class="connection-type-note visible">PEM or CA file for FTPS validation.</div>
                </div>
              </div>
            </div>

            <div class="full"><label for="username">Username</label><input id="username" autocomplete="username" /></div>
            <div id="authMethodBlock" class="full auth-method-block">
              <label for="authDropdownButton">Authentication</label>
              <div class="auth-picker">
                <button id="authDropdownButton" type="button" class="profile-dropdown-button" aria-haspopup="listbox" aria-expanded="false">
                  <span id="authDropdownLabel" class="profile-dropdown-label">Password</span>
                  <svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg>
                </button>
                <div id="authDropdownMenu" class="profile-dropdown-menu auth-dropdown-menu" role="listbox" aria-label="Authentication method">
                  <button type="button" class="profile-dropdown-item" role="option" data-auth-type="password">
                    <span class="profile-dropdown-name">Password</span>
                  </button>
                  <button type="button" class="profile-dropdown-item" role="option" data-auth-type="privateKey">
                    <span class="profile-dropdown-name">Private key</span>
                  </button>
                </div>
              </div>
              <select id="authType" class="auth-select-native" aria-hidden="true" tabindex="-1"><option value="password">Password</option><option value="privateKey">Private key</option></select>
            </div>
            <div id="passwordBlock" class="full auth-block visible">
              <label for="password">Password</label>
              <div class="input-with-button">
                <input id="password" type="password" autocomplete="current-password" />
                <button id="passwordRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Password" data-tooltip="Hold to Show Password">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
                </button>
              </div>
              <label class="checkbox-row"><input id="rememberPassword" class="dialog-checkbox" type="checkbox" /> Remember password securely</label>
              <div id="passwordSecretState" class="credential-state not-saved">Password not saved.</div>
            </div>
            <div id="privateKeyBlock" class="full auth-block">
              <label for="privateKeyPath">Private key path</label>
              <div class="input-with-button">
                <input id="privateKeyPath" placeholder="~/.ssh/id_rsa" autocomplete="off" />
                <button id="privateKeyBrowseButton" class="input-icon-button has-tooltip" type="button" aria-label="Select Private Key File" data-tooltip="Select Private Key File">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg>
                </button>
              </div>
            </div>
            <div id="passphraseBlock" class="full auth-block">
              <label for="passphrase">Passphrase</label>
              <div class="input-with-button">
                <input id="passphrase" type="password" autocomplete="off" />
                <button id="passphraseRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Passphrase" data-tooltip="Hold to Show Passphrase">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
                </button>
              </div>
              <label class="checkbox-row"><input id="rememberPassphrase" class="dialog-checkbox" type="checkbox" /> Remember passphrase securely</label>
              <div id="passphraseSecretState" class="credential-state not-saved">Passphrase not saved.</div>
            </div>

            <div class="full"><label for="startPath">Start path</label><input id="startPath" autocomplete="off" /></div>
            </div>
          </div>

          <div class="connection-panel-divider" aria-hidden="true"></div>
          <div class="connection-actions-section">
            <div class="button-row connection-actions">
              <button id="connectButton">Connect</button>
              <button id="saveProfileButton" class="secondary">Save</button>
              <button id="showOutputButton" class="secondary">Output</button>
            </div>
          </div>
        </div>
      </aside>

      <aside class="connection-panel-handle connection-rail" aria-label="Connection Panel Collapsed">
        <span class="tooltip-anchor" data-tooltip="Show Connection Panel">
          <button id="showConnectionPanelButton" type="button" class="secondary icon-only panel-toggle-button" aria-label="Show Connection Panel">
            <svg viewBox="0 -960 960 960" aria-hidden="true"><path d="m400-240-28-28 212-212-212-212 28-28 240 240-240 240Z" /></svg>
          </button>
        </span>
      </aside>

      <section class="browser-column">
        <section class="card browser-card">
          <div class="browser-open-section" aria-label="Active Remote Connections">
            <div class="browser-open-text-row">
              <div class="browser-open-text">
                <div class="card-title">Open connections</div>
                <div class="card-subtitle">Active sessions</div>
              </div>
            </div>
            <div class="open-connections-row">
              <div class="session-strip browser-session-strip">
                <div id="sessionTabs" class="session-tabs"><span class="session-empty">No active connections.</span></div>
              </div>
            </div>
          </div>
          <div class="browser-section-divider"></div>
          <div id="browserSubtitle" hidden>Connect to a host to list remote files.</div>

          <div class="card-body">
          <div class="pathbar">
            <div id="remotePathBox" class="remote-path-box">
              <input id="currentPath" value="" disabled aria-label="Remote Path" title="Remote Path" />
              <div class="remote-path-navigation-buttons" aria-hidden="false">
                <button id="remotePathBackButton" class="remote-path-navigation-button" type="button" aria-label="Go Back" data-tooltip="Go Back" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M313.15-460H760v-40H313.15l211.69-211.69L496-740 236-480l260 260 28.84-28.31L313.15-460Z" /></svg></button>
                <button id="remotePathForwardButton" class="remote-path-navigation-button" type="button" aria-label="Go Forward" data-tooltip="Go Forward" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M646.85-460H200v-40h446.85L435.16-711.69 464-740l260 260-260 260-28.84-28.31L646.85-460Z" /></svg></button>
              </div>
              <span class="remote-path-leading-icon" aria-hidden="true"><svg focusable="false" width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M12 11.5C12 11.5989 11.9707 11.6956 11.9157 11.7778C11.8608 11.86 11.7827 11.9241 11.6913 11.9619C11.6 11.9998 11.4994 12.0097 11.4025 11.9904C11.3055 11.9711 11.2164 11.9235 11.1464 11.8536C11.0765 11.7836 11.0289 11.6945 11.0096 11.5975C10.9903 11.5006 11.0002 11.4 11.0381 11.3087C11.0759 11.2173 11.14 11.1392 11.2222 11.0843C11.3044 11.0293 11.4011 11 11.5 11C11.6326 11 11.7598 11.0527 11.8536 11.1464C11.9473 11.2402 12 11.3674 12 11.5ZM11.5 8C11.5989 8 11.6956 7.97068 11.7778 7.91573C11.86 7.86079 11.9241 7.7827 11.9619 7.69134C11.9998 7.59998 12.0097 7.49945 11.9904 7.40245C11.9711 7.30546 11.9235 7.21637 11.8536 7.14645C11.7836 7.07652 11.6945 7.0289 11.5975 7.00961C11.5006 6.99031 11.4 7.00022 11.3087 7.03806C11.2173 7.0759 11.1392 7.13999 11.0843 7.22221C11.0293 7.30444 11 7.40111 11 7.5C11 7.63261 11.0527 7.75979 11.1464 7.85355C11.2402 7.94732 11.3674 8 11.5 8ZM14 4.5C13.999 4.87026 13.86 5.22685 13.61 5.5C13.86 5.77315 13.999 6.12974 14 6.5V8.5C13.999 8.87026 13.86 9.22685 13.61 9.5C13.86 9.77315 13.999 10.1297 14 10.5V12.5C14 12.8978 13.842 13.2794 13.5607 13.5607C13.2794 13.842 12.8978 14 12.5 14H3.5C3.10218 14 2.72064 13.842 2.43934 13.5607C2.15804 13.2794 2 12.8978 2 12.5V10.5C2.00097 10.1297 2.14003 9.77315 2.39 9.5C2.14003 9.22685 2.00097 8.87026 2 8.5V6.5C2.00097 6.12974 2.14003 5.77315 2.39 5.5C2.14003 5.22685 2.00097 4.87026 2 4.5V2.5C2 2.10218 2.15804 1.72064 2.43934 1.43934C2.72064 1.15804 3.10218 1 3.5 1H12.5C12.8978 1 13.2794 1.15804 13.5607 1.43934C13.842 1.72064 14 2.10218 14 2.5V4.5ZM3 4.5C3 4.63261 3.05268 4.75979 3.14645 4.85355C3.24021 4.94732 3.36739 5 3.5 5H12.5C12.6326 5 12.7598 4.94732 12.8536 4.85355C12.9473 4.75979 13 4.63261 13 4.5V2.5C13 2.36739 12.9473 2.24021 12.8536 2.14645C12.7598 2.05268 12.6326 2 12.5 2H3.5C3.36739 2 3.24021 2.05268 3.14645 2.14645C3.05268 2.24021 3 2.36739 3 2.5V4.5ZM12.5 6H3.5C3.36739 6 3.24021 6.05268 3.14645 6.14645C3.05268 6.24021 3 6.36739 3 6.5V8.5C3 8.63261 3.05268 8.75979 3.14645 8.85355C3.24021 8.94732 3.36739 9 3.5 9H12.5C12.6326 9 12.7598 8.94732 12.8536 8.85355C12.9473 8.75979 13 8.63261 13 8.5V6.5C13 6.36739 12.9473 6.24021 12.8536 6.14645C12.7598 6.05268 12.6326 6 12.5 6ZM13 10.5C13 10.3674 12.9473 10.2402 12.8536 10.1464C12.7598 10.0527 12.6326 10 12.5 10H3.5C3.36739 10 3.24021 10.0527 3.14645 10.1464C3.05268 10.2402 3 10.3674 3 10.5V12.5C3 12.6326 3.05268 12.7598 3.14645 12.8536C3.24021 12.9473 3.36739 13 3.5 13H12.5C12.6326 13 12.7598 12.9473 12.8536 12.8536C12.9473 12.7598 13 12.6326 13 12.5V10.5ZM11.5 4C11.5989 4 11.6956 3.97068 11.7778 3.91573C11.86 3.86079 11.9241 3.7827 11.9619 3.69134C11.9998 3.59998 12.0097 3.49945 11.9904 3.40245C11.9711 3.30546 11.9235 3.21637 11.8536 3.14645C11.7836 3.07652 11.6945 3.0289 11.5975 3.00961C11.5006 2.99031 11.4 3.00022 11.3087 3.03806C11.2173 3.0759 11.1392 3.13999 11.0843 3.22221C11.0293 3.30444 11 3.40111 11 3.5C11 3.63261 11.0527 3.75979 11.1464 3.85355C11.2402 3.94732 11.3674 4 11.5 4Z"/></svg></span>
              <div id="remotePathBreadcrumb" class="remote-path-inline-breadcrumb" aria-label="Remote Path Breadcrumb"></div>
              <div id="remotePathDropdown" class="remote-path-dropdown" aria-hidden="true"></div>
              <div class="remote-path-favorite-buttons" aria-hidden="false">
                <button id="goButton" class="remote-path-favorite-button remote-path-action-button refresh-mode" type="button" aria-label="Refresh Current Directory" data-tooltip="Refresh Current Directory" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M483.08-200q-117.25 0-198.63-81.34-81.37-81.34-81.37-198.54 0-117.2 81.37-198.66Q365.83-760 483.08-760q71.3 0 133.54 33.88 62.23 33.89 100.3 94.58V-760h40v209.23H547.69v-40h148q-31.23-59.85-87.88-94.54Q551.15-720 483.08-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h42.46Q725.08-310.15 651-255.08 576.92-200 483.08-200Z" /></svg></button>
                <button id="togglePathFavoriteButton" class="remote-path-favorite-button" type="button" aria-label="Add Remote Path Favorite" data-tooltip="Save This Connection to Use Remote Path Favorites" disabled>
                  <svg class="star-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143Zm-61 83.92 49.62-212.54-164.93-142.84 217.23-18.85L480-777.69l85.08 200.38 217.23 18.85-164.93 142.84L667-203.08 480-315.92 293-203.08ZM480-470Z" /></svg>
                  <svg class="filled-star-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m293-203.08 49.62-212.54-164.93-142.84 217.23-18.85L480-777.69l85.08 200.38 217.23 18.85-164.93 142.84L667-203.08 480-315.92 293-203.08Z" /></svg>
                </button>
                <button id="pathFavoritesButton" class="remote-path-favorite-button" type="button" aria-label="Show Remote Path Favorites" data-tooltip="Save This Connection to Use Remote Path Favorites" disabled>
                  <svg class="hotel-class-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m620.31-395.38 138.92-120 57.69 5.38-149.84 129.15 44.31 195.47-48.93-29.7-42.15-180.3ZM544-631.23l-38.92-91.85 22.15-54.61 63.54 150.84-46.77-4.38ZM294-287l126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143Zm-61 83.92 49.62-212.54-164.93-142.84 217.23-18.85L420-777.69l85.08 200.38 217.23 18.85-164.93 142.84L607-203.08 420-315.92 233-203.08Zm187-257.69Z" /></svg>
                  <svg class="filled-hotel-class-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m620.31-395.38 138.92-120 57.69 5.38-149.84 129.15 44.31 195.47-48.93-29.7-42.15-180.3ZM544-631.23l-38.92-91.85 22.15-54.61 63.54 150.84-46.77-4.38ZM233-203.08l49.62-212.54-164.93-142.84 217.23-18.85L420-777.69l85.08 200.38 217.23 18.85-164.93 142.84L607-203.08 420-315.92 233-203.08Z" /></svg>
                </button>
              </div>
              <div id="pathFavoritesPopover" class="remote-path-favorites-popover" aria-hidden="true">
                <div class="remote-path-favorites-title">Favorite remote paths</div>
                <div id="pathFavoritesList"></div>
              </div>
            </div>
            <div id="remotePathResizeHandle" class="remote-path-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize Remote Path" aria-valuemin="400" tabindex="0"></div>
            <div id="filterBox" class="filter-box">
              <input id="filterInput" class="filter-input" placeholder="Filter Files..." aria-label="Filter Files" disabled />
              <button id="clearFilterButton" class="filter-clear-button has-tooltip" aria-label="Clear Filter" data-tooltip="Clear Filter" disabled><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button>
            </div>
            <span id="commandActionsSeparator" class="toolbar-separator filter-sudo-separator" aria-hidden="true"></span>
            <div id="commandActions" class="path-actions command-actions">
              <span class="tooltip-anchor" data-tooltip="Run Remote Command">
                <button id="runRemoteCommandButton" class="secondary icon-only" type="button" aria-label="Run Remote Command" disabled><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.5 13.8845 9.6923 9.6923 5.5 5.5l-.7078.7078 3.4848 3.4845-3.4848 3.4845L5.5 13.8845ZM12 18v-1h8v1h-8Z" /></svg></button>
              </span>
              <span class="tooltip-anchor" data-tooltip="Open SSH Terminal">
                <button id="openSshTerminalButton" class="secondary icon-only" type="button" aria-label="Open SSH Terminal" disabled><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 5.5C4 4.6716 4.6716 4 5.5 4h13c.8284 0 1.5.6716 1.5 1.5v13c0 .8284-.6716 1.5-1.5 1.5h-13C4.6716 20 4 19.3284 4 18.5v-13ZM5.5 5C5.2239 5 5 5.2239 5 5.5v13c0 .2761.2239.5.5.5h13c.2761 0 .5-.2239.5-.5v-13c0-.2761-.2239-.5-.5-.5h-13Zm2.8536 4.1464L11.2071 12l-2.8535 2.8536-.7072-.7072L9.7929 12 7.6464 9.8536l.7072-.7072ZM12 15h5v1h-5v-1Z" /></svg></button>
              </span>
            </div>
            <span id="transferActionsSeparator" class="toolbar-separator filter-sudo-separator" aria-hidden="true"></span>
            <div class="path-actions transfer-actions">
              <span class="tooltip-anchor" data-tooltip="Upload Files or Folders">
                <button id="uploadButton" class="secondary icon-only" aria-label="Upload Files or Folders" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M260-160q-41.92 0-70.96-29.04Q160-218.08 160-260v-80h40v80q0 25 17.5 42.5T260-200h440q25 0 42.5-17.5T760-260v-80h40v80q0 41.92-29.04 70.96Q741.92-160 700-160H260Zm200-160v-370L342-572l-28-28 166-166 166 166-28 28-118-118v370h-40Z" /></svg></button>
              </span>
              <span class="tooltip-anchor" data-tooltip="Download Selected Files or Folders">
                <button id="downloadButton" class="secondary icon-only" aria-label="Download Selected Files or Folders" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M260-160q-41.92 0-70.96-29.04Q160-218.08 160-260v-80h40v80q0 25 17.5 42.5T260-200h440q25 0 42.5-17.5T760-260v-80h40v80q0 41.92-29.04 70.96Q741.92-160 700-160H260Zm220-146L314-472l28-28 118 118v-370h40v370l118-118 28 28-166 166Z" /></svg></button>
              </span>
              <span id="transferQueueTooltip" class="tooltip-anchor" data-tooltip="Transfer Queue">
                <button id="transferQueueButton" class="secondary icon-only transfer-queue-button" type="button" aria-label="Transfer Queue"><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M340-596.38h40v359.3l83.54-83.54 28.77 28.31L360-160 227.69-292.31l28.77-28.31L340-237.08v-359.3ZM620-421h-40v-302.38l-84 84-28.31-28.31L600-800l132.31 132.31L704-639.38l-84-84V-421Z" /></svg><span id="transferQueueCount" class="transfer-queue-count" aria-hidden="true">0</span></button>
              </span>
            </div>
            <span id="sudoToggleSeparator" class="toolbar-separator filter-sudo-separator" aria-hidden="true"></span>
            <label id="sudoToggleLabel" class="sudo-toggle has-tooltip" data-tooltip="Connect to a Host to Enable Sudo Mode">
              <span id="sudoToggleState" class="sudo-toggle-state">Sudo</span>
              <input id="sudoToggle" type="checkbox" disabled aria-label="Enable Sudo Mode for This Connection" />
              <span class="sudo-toggle-track" aria-hidden="true"><span class="sudo-toggle-thumb"></span></span>
            </label>
          </div>

          <div id="entriesTableWrap" class="table-wrap">
            <table id="entriesTable">
              <colgroup>
                <col data-column="name" />
                <col data-column="type" />
                <col data-column="size" />
                <col data-column="owner" />
                <col data-column="group" />
                <col data-column="permissions" />
                <col data-column="modified" />
              </colgroup>
              <thead><tr>
                <th class="sortable" data-sort-key="name" data-column="name"><span class="header-content"><span class="header-label">Name</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="name"></span></th>
                <th class="sortable type" data-sort-key="type" data-column="type"><span class="header-content"><span class="header-label">Type</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="type"></span></th>
                <th class="sortable size" data-sort-key="size" data-column="size"><span class="header-content"><span class="header-label">Size</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="size"></span></th>
                <th class="sortable owner" data-sort-key="owner" data-column="owner"><span class="header-content"><span class="header-label">Owner</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="owner"></span></th>
                <th class="sortable group" data-sort-key="group" data-column="group"><span class="header-content"><span class="header-label">Group</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="group"></span></th>
                <th class="sortable permissions" data-sort-key="permissions" data-column="permissions"><span class="header-content"><span class="header-label">Permissions</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="permissions"></span></th>
                <th class="sortable modified" data-sort-key="modified" data-column="modified"><span class="header-content"><span class="header-label">Modified</span><span class="sort-indicator"></span></span><span class="column-resizer" data-column="modified"></span></th>
              </tr></thead>
              <tbody id="entriesBody"><tr><td colspan="7"><div class="empty-state">Connect to a host to list remote files.</div></td></tr></tbody>
            </table>
          </div>

          <div id="status" class="statusbar"><div class="status-main"><div id="statusText" class="status-text">Ready.</div><button id="statusOutputLink" class="status-output-link" type="button" hidden>See details in Output.</button><div class="spinner" aria-hidden="true"></div></div><div class="status-actions"><button id="statusCancelButton" class="status-action-button status-cancel-button has-tooltip tooltip-above" type="button" aria-label="Cancel Current Operation" data-tooltip="Cancel Current Operation" hidden>Cancel</button><div class="status-copy-wrap"><button id="statusCopyButton" class="status-action-button status-copy-button has-tooltip tooltip-above" type="button" aria-label="Copy Status" data-tooltip="Copy Status"><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" /></svg></button><div id="statusCopyFeedback" class="status-copy-feedback" role="status" aria-live="polite">Copied</div></div></div></div>
          </div>
        </section>
      </section>
    </section>
  </div>
  </main>

  <div id="webviewTooltip" class="webview-tooltip" role="tooltip" aria-hidden="true"></div>

  <div id="connectionNameBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="connectionNameTitle" aria-hidden="true">
    <section class="file-properties-dialog connection-name-dialog">
      <div class="file-properties-header">
        <h2 id="connectionNameTitle" class="file-properties-title">New Connection</h2>
        <div class="file-properties-path">Choose a unique name for this saved connection.</div>
      </div>
      <div class="file-properties-body">
        <label for="connectionNameInput">Connection name</label>
        <input id="connectionNameInput" autocomplete="off" placeholder="Production Server" />
        <div id="connectionNameFeedback" class="connection-name-feedback" role="status" aria-live="polite"></div>
      </div>
      <div class="file-properties-actions">
        <button id="connectionNameCreateButton" type="button">Create</button>
        <button id="connectionNameCancelButton" type="button" class="secondary">Cancel</button>
      </div>
    </section>
  </div>

  <div id="manageProfilesBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="manageProfilesTitle" aria-hidden="true">
    <section class="file-properties-dialog manage-profiles-dialog">
      <div class="file-properties-header manage-profiles-header-row">
        <div>
          <h2 id="manageProfilesTitle" class="file-properties-title">Manage Saved Connections</h2>
          <div class="file-properties-path">Rename or remove saved connection profiles.</div>
        </div>
        <div class="manage-profiles-header-actions">
          <button id="manageProfilesImportButton" class="secondary" type="button">Import</button>
          <button id="manageProfilesExportButton" class="secondary" type="button">Export</button>
        </div>
      </div>
      <div class="file-properties-body">
        <div id="manageProfilesFeedback" class="manage-profiles-feedback" role="status" aria-live="polite"></div>
        <div class="manage-profiles-filter">
          <input id="manageProfilesFilterInput" type="text" placeholder="Filter connections..." aria-label="Filter Saved Connections" autocomplete="off" />
        </div>
        <div id="manageProfilesList" class="manage-profiles-list"></div>
      </div>
      <div class="file-properties-actions">
        <button id="manageProfilesCloseButton" type="button">Close</button>
      </div>
    </section>
  </div>


  <div id="exportBackupBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="exportBackupTitle" aria-hidden="true">
    <section class="file-properties-dialog backup-dialog export-backup-dialog">
      <div class="file-properties-header">
        <h2 id="exportBackupTitle" class="file-properties-title">Export Connections and Settings</h2>
        <div class="file-properties-path">Export Remote Edit data to a JSON backup file.</div>
      </div>
      <div class="file-properties-body">
        <section class="backup-section">
          <p class="backup-section-title">Export content</p>
          <div class="backup-checkbox-list">
            <label class="modal-checkbox-line"><input id="exportIncludeSettings" class="dialog-checkbox" type="checkbox" checked> Remote Edit settings</label>
            <div class="modal-checkbox-block">
              <label class="modal-checkbox-line"><input id="exportIncludeConnections" class="dialog-checkbox" type="checkbox" checked> Saved connections</label>
              <div class="backup-child-options">
                <label class="modal-checkbox-line"><input id="exportIncludeFavorites" class="dialog-checkbox" type="checkbox" checked> Remote Path favorites</label>
                <label class="modal-checkbox-line"><input id="exportIncludeUsernames" class="dialog-checkbox" type="checkbox" checked> Include usernames</label>
                <label class="modal-checkbox-line"><input id="exportIncludeCredentials" class="dialog-checkbox" type="checkbox"> Include encrypted passwords/passphrases</label>
                <div id="exportCredentialsBlock" class="backup-credential-block">
                  <div class="modal-helper-text">Encrypt saved passwords and key passphrases. Private key files are not exported.</div>
                  <div class="backup-credential-fields">
                    <label>Export password
                      <div class="input-with-button">
                        <input id="exportCredentialPassword" type="password" autocomplete="new-password">
                        <button id="exportCredentialPasswordRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Export Password" data-tooltip="Hold to Show Password">
                          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
                        </button>
                      </div>
                      <span id="exportCredentialPasswordError" class="backup-field-error" role="alert"></span>
                    </label>
                    <label>Confirm password
                      <div class="input-with-button">
                        <input id="exportCredentialConfirmPassword" type="password" autocomplete="new-password">
                        <button id="exportCredentialConfirmPasswordRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Password Confirmation" data-tooltip="Hold to Show Password">
                          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
                        </button>
                      </div>
                      <span id="exportCredentialConfirmPasswordError" class="backup-field-error" role="alert"></span>
                    </label>
                  </div>
                </div>
                <div id="exportCredentialsDisabledHelp" class="modal-helper-text modal-checkbox-helper"></div>
              </div>
            </div>
          </div>
        </section>
        <div id="exportBackupResult" class="backup-result" role="status" aria-live="polite"></div>
        <div id="exportBackupValidation" class="backup-validation" role="alert"></div>
      </div>
      <div class="file-properties-actions">
        <button id="exportBackupCancelButton" class="secondary" type="button">Close</button>
        <button id="exportBackupApplyButton" type="button">Export</button>
      </div>
    </section>
  </div>

  <div id="importBackupBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="importBackupTitle" aria-hidden="true">
    <section class="file-properties-dialog backup-dialog import-backup-dialog">
      <div class="file-properties-header">
        <h2 id="importBackupTitle" class="file-properties-title">Import Connections and Settings</h2>
        <div class="file-properties-path">Review the backup content before importing.</div>
      </div>
      <div class="file-properties-body">
        <section class="backup-section backup-summary-section">
          <p class="backup-section-title">Backup summary</p>
          <div id="importBackupSummary" class="backup-summary-line"></div>
        </section>
        <section class="backup-section">
          <p class="backup-section-title">Import content</p>
          <div class="backup-checkbox-list">
            <label class="modal-checkbox-line"><input id="importIncludeSettings" class="dialog-checkbox" type="checkbox" checked> Remote Edit settings</label>
            <div class="modal-checkbox-block">
              <label class="modal-checkbox-line"><input id="importIncludeConnections" class="dialog-checkbox" type="checkbox" checked> Saved connections</label>
              <div class="backup-child-options">
                <label class="modal-checkbox-line"><input id="importIncludeFavorites" class="dialog-checkbox" type="checkbox" checked> Remote Path favorites</label>
                <label class="modal-checkbox-line"><input id="importIncludeUsernames" class="dialog-checkbox" type="checkbox" checked> Include usernames</label>
                <label class="modal-checkbox-line"><input id="importRestoreCredentials" class="dialog-checkbox" type="checkbox"> Restore encrypted passwords/passphrases</label>
                <div id="importCredentialsBlock" class="backup-credential-block">
                  <div class="modal-helper-text">Restore saved passwords and key passphrases. Private key files are not included.</div>
                  <div class="backup-credential-fields">
                    <label>Export password
                      <div class="input-with-button">
                        <input id="importCredentialPassword" type="password" autocomplete="current-password">
                        <button id="importCredentialPasswordRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Export Password" data-tooltip="Hold to Show Password">
                          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
                        </button>
                      </div>
                      <span id="importCredentialPasswordError" class="backup-field-error" role="alert"></span>
                    </label>
                  </div>
                </div>
                <div id="importCredentialsDisabledHelp" class="modal-helper-text modal-checkbox-helper"></div>
              </div>
            </div>
            <div id="importModeBlock" class="backup-import-mode">
              <p class="backup-import-mode-title">Import mode</p>
              <label class="modal-checkbox-line"><input id="importModeMerge" name="importMode" type="radio" value="merge" checked> Merge with existing connections</label>
              <label class="modal-checkbox-line"><input id="importModeReplace" name="importMode" type="radio" value="replace"> Replace existing connections</label>
              <p id="importModeHelp" class="backup-mode-help">Matching connections are updated. New connections are added.</p>
            </div>
          </div>
        </section>
        <div id="importBackupResult" class="backup-result" role="status" aria-live="polite"></div>
        <div id="importBackupValidation" class="backup-validation" role="alert"></div>
      </div>
      <div class="file-properties-actions">
        <button id="importBackupCancelButton" class="secondary" type="button">Close</button>
        <button id="importBackupApplyButton" type="button">Import</button>
      </div>
    </section>
  </div>

  <div id="transferQueueModal" class="transfer-queue-backdrop" role="dialog" aria-modal="true" aria-labelledby="transferQueueTitle" aria-hidden="true">
    <div class="transfer-queue-dialog">
      <div class="transfer-queue-header">
        <h2 id="transferQueueTitle" class="transfer-queue-title">Transfer Queue</h2>
        <button id="transferQueueCloseButton" class="transfer-queue-close has-tooltip" type="button" aria-label="Close Transfer Queue" data-tooltip="Close">×</button>
      </div>
      <div class="transfer-queue-body">
        <section class="transfer-queue-section" aria-labelledby="transferQueueCurrentTitle">
          <h3 id="transferQueueCurrentTitle" class="transfer-queue-section-title">Current transfer</h3>
          <div id="transferQueueCurrent" class="transfer-queue-items"></div>
        </section>
        <section class="transfer-queue-section" aria-labelledby="transferQueuePendingTitle">
          <h3 id="transferQueuePendingTitle" class="transfer-queue-section-title">Pending transfers</h3>
          <div id="transferQueuePending" class="transfer-queue-items"></div>
        </section>
        <section class="transfer-queue-section" aria-labelledby="transferQueueCompletedTitle">
          <h3 id="transferQueueCompletedTitle" class="transfer-queue-section-title">Completed transfers</h3>
          <div id="transferQueueCompleted" class="transfer-queue-items"></div>
        </section>
      </div>
      <div class="transfer-queue-footer">
        <button id="transferQueueFooterCloseButton" class="secondary" type="button">Close</button>
      </div>
    </div>
  </div>

  <div id="confirmDialogBackdrop" class="confirm-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirmDialogTitle" aria-hidden="true">
    <section class="confirm-dialog">
      <div class="confirm-dialog-header">
        <h2 id="confirmDialogTitle" class="confirm-dialog-title">Confirm action</h2>
      </div>
      <div class="confirm-dialog-body">
        <p id="confirmDialogMessage" class="confirm-dialog-message"></p>
        <pre id="confirmDialogDetails" class="confirm-dialog-details" hidden></pre>
      </div>
      <div class="confirm-dialog-actions">
        <button id="confirmDialogCancelButton" class="secondary" type="button">Cancel</button>
        <button id="confirmDialogConfirmButton" type="button">Confirm</button>
      </div>
    </section>
  </div>

  <div id="transferConflictBackdrop" class="transfer-conflict-backdrop" role="dialog" aria-modal="true" aria-labelledby="transferConflictTitle" aria-hidden="true">
    <section class="transfer-conflict-dialog" tabindex="-1">
      <div class="transfer-conflict-header">
        <h2 id="transferConflictTitle" class="transfer-conflict-title">Transfer conflict</h2>
      </div>
      <div class="transfer-conflict-body">
        <p id="transferConflictMessage" class="transfer-conflict-message"></p>
        <div class="transfer-conflict-file">
          <span id="transferConflictName" class="transfer-conflict-name"></span>
          <span id="transferConflictPath" class="transfer-conflict-path"></span>
        </div>
        <div class="transfer-conflict-grid">
          <section class="transfer-conflict-card" aria-labelledby="transferConflictSourceTitle">
            <h3 id="transferConflictSourceTitle" class="transfer-conflict-card-title">Source</h3>
            <div class="transfer-conflict-card-body">
              <div id="transferConflictSourceType" class="transfer-conflict-meta"></div>
              <div id="transferConflictSourcePath" class="transfer-conflict-meta"></div>
              <div id="transferConflictSourceSize" class="transfer-conflict-meta"></div>
              <div id="transferConflictSourceModified" class="transfer-conflict-meta"></div>
            </div>
          </section>
          <section class="transfer-conflict-card" aria-labelledby="transferConflictDestinationTitle">
            <h3 id="transferConflictDestinationTitle" class="transfer-conflict-card-title">Destination</h3>
            <div class="transfer-conflict-card-body">
              <div id="transferConflictDestinationType" class="transfer-conflict-meta"></div>
              <div id="transferConflictDestinationPath" class="transfer-conflict-meta"></div>
              <div id="transferConflictDestinationSize" class="transfer-conflict-meta"></div>
              <div id="transferConflictDestinationModified" class="transfer-conflict-meta"></div>
            </div>
          </section>
        </div>
        <p id="transferConflictNote" class="transfer-conflict-note"></p>
      </div>
      <div id="transferConflictActions" class="transfer-conflict-actions"></div>
    </section>
  </div>

  <div id="filePropertiesBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="filePropertiesTitle" aria-hidden="true">
    <section class="file-properties-dialog">
      <div class="file-properties-header">
        <h2 id="filePropertiesTitle" class="file-properties-title">File Properties</h2>
        <div id="filePropertiesPath" class="file-properties-path"></div>
      </div>
      <div class="file-properties-body">
        <div id="filePropertiesGrid" class="file-properties-grid"></div>
      </div>
      <div class="file-properties-actions">
        <button id="filePropertiesCopyPathButton" type="button" class="secondary">Copy Path</button>
        <button id="filePropertiesCloseButton" type="button">Close</button>
      </div>
    </section>
  </div>

  <div id="checksumsBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="checksumsTitle" aria-hidden="true">
    <section class="file-properties-dialog">
      <div class="file-properties-header">
        <h2 id="checksumsTitle" class="file-properties-title">Checksums</h2>
        <div id="checksumsPath" class="file-properties-path"></div>
      </div>
      <div class="file-properties-body">
        <div id="checksumsGrid" class="file-properties-grid"></div>
      </div>
      <div class="file-properties-actions">
        <button id="checksumsCopySha256Button" type="button" class="secondary">Copy SHA-256</button>
        <button id="checksumsCopyMd5Button" type="button" class="secondary">Copy MD5</button>
        <button id="checksumsCopyAllButton" type="button" class="secondary">Copy All</button>
        <button id="checksumsCloseButton" type="button">Close</button>
      </div>
    </section>
  </div>


  <div id="ownerGroupBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="ownerGroupTitle" aria-hidden="true">
    <section class="file-properties-dialog">
      <div class="file-properties-header">
        <h2 id="ownerGroupTitle" class="file-properties-title">Change Owner/Group</h2>
        <div id="ownerGroupPath" class="file-properties-path"></div>
      </div>
      <div class="file-properties-body">
        <div class="owner-group-form">
          <div class="owner-group-input-grid">
            <div>
              <label for="ownerGroupOwnerInput">Owner</label>
              <input id="ownerGroupOwnerInput" type="text" autocomplete="off" spellcheck="false" placeholder="owner">
            </div>
            <div>
              <label for="ownerGroupGroupInput">Group</label>
              <input id="ownerGroupGroupInput" type="text" autocomplete="off" spellcheck="false" placeholder="group">
            </div>
          </div>
          <div id="ownerGroupHelperBlock" class="modal-checkbox-block">
            <label id="ownerGroupRecursiveRow" class="modal-checkbox-line">
              <input id="ownerGroupRecursiveInput" class="dialog-checkbox" type="checkbox">
              <span>Apply recursively to selected directories</span>
            </label>
            <div id="ownerGroupNote" class="modal-helper-text modal-checkbox-helper"></div>
            <div class="modal-helper-text modal-checkbox-helper">May fail without enough permissions. Enable Sudo Mode if needed.</div>
          </div>
          <div id="ownerGroupValidation" class="owner-group-validation" role="alert"></div>
        </div>
      </div>
      <div class="file-properties-actions">
        <button id="ownerGroupCancelButton" class="secondary" type="button">Cancel</button>
        <button id="ownerGroupApplyButton" type="button">Apply</button>
      </div>
    </section>
  </div>

  <div id="remoteCommandBackdrop" class="remote-command-backdrop" role="dialog" aria-modal="true" aria-labelledby="remoteCommandTitle" aria-hidden="true">
    <section class="remote-command-dialog">
      <div class="remote-command-header">
        <h2 id="remoteCommandTitle" class="remote-command-title">Run Remote Command</h2>
        <div class="remote-command-subtitle">Run non-interactive remote commands with streaming output.</div>
      </div>
      <div class="remote-command-body">
        <div class="remote-command-field-grid">
          <div class="remote-command-meta-block">
            <div class="remote-command-meta">
              <span class="remote-command-meta-label">Connected to:</span>
              <span id="remoteCommandConnectedTo" class="remote-command-connected-to">-</span>
            </div>
            <div class="remote-command-meta">
              <span class="remote-command-meta-label">Working directory:</span>
              <span id="remoteCommandWorkingDirectory" class="remote-command-working-directory">/</span>
            </div>
            <div class="remote-command-meta">
              <span class="remote-command-meta-label">Run as:</span>
              <span id="remoteCommandRunAs" class="remote-command-run-as">SSH user</span>
            </div>
          </div>
          <div class="remote-command-field">
            <label for="remoteCommandInput">Command</label>
            <div class="remote-command-input-row">
              <textarea id="remoteCommandInput" spellcheck="false" autocomplete="off"></textarea>
              <div class="remote-command-run-row">
                <button id="remoteCommandRunButton" type="button">Run</button>
              </div>
            </div>
          </div>
        </div>
        <div class="remote-command-output-section">
          <div class="remote-command-output-header">
            <div class="remote-command-output-title">Output</div>
            <div id="remoteCommandOutputNotice" class="remote-command-output-notice"></div>
          </div>
          <div id="remoteCommandOutputWrap" class="remote-command-output-wrap" tabindex="0" aria-label="Command Output">
            <pre id="remoteCommandOutput" class="remote-command-output"></pre>
          </div>
          <div id="remoteCommandStatus" class="remote-command-status"></div>
        </div>
      </div>
      <div id="remoteCommandCloseWarning" class="remote-command-close-warning" role="alert">
        <div class="remote-command-close-warning-text">Command is still running. Closing this window will stop it.</div>
        <div class="remote-command-close-warning-actions">
          <button id="remoteCommandKeepRunningButton" class="secondary" type="button">Keep running</button>
          <button id="remoteCommandStopAndCloseButton" type="button">Stop command and close</button>
        </div>
      </div>
      <div id="remoteCommandStopWarning" class="remote-command-stop-warning" role="alert">
        <div class="remote-command-close-warning-text">Command is still stopping. Force kill it?</div>
        <div class="remote-command-stop-warning-actions">
          <button id="remoteCommandKeepStoppingButton" class="secondary" type="button">Keep waiting</button>
          <button id="remoteCommandForceKillButton" type="button">Force kill</button>
        </div>
      </div>
      <div class="remote-command-actions">
        <button id="remoteCommandCopyButton" class="secondary" type="button">Copy</button>
        <button id="remoteCommandClearButton" class="secondary" type="button">Clear</button>
        <button id="remoteCommandCloseButton" type="button">Close</button>
      </div>
    </section>
  </div>

  <div id="entryContextMenu" class="context-menu" role="menu" aria-label="Entry Actions">
  <button id="contextOpen" type="button" role="menuitem">View/Edit</button>
  <button id="contextOpenReadOnly" type="button" role="menuitem">View Read-Only</button>
  <button id="contextCompare" type="button" role="menuitem">Compare Selected</button>
  <div id="contextOpenSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextMakeCopy" type="button" role="menuitem">Make a Copy...</button>
  <button id="contextRename" type="button" role="menuitem">Rename...</button>
  <div id="contextCopySeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextCopyPath" type="button" role="menuitem">Copy Path</button>
  <button id="contextCopyName" type="button" role="menuitem">Copy Filename</button>
  <div id="contextCompressSubmenu" class="context-submenu" role="none">
    <button id="contextCompressTrigger" class="context-submenu-trigger" type="button" role="menuitem" aria-haspopup="true">Compress to Archive</button>
    <div class="context-submenu-content" role="menu" aria-label="Archive Formats">
      <button id="contextCompressTarGz" type="button" role="menuitem" data-archive-format="tar.gz">tar.gz...</button>
      <button id="contextCompressTarBz2" type="button" role="menuitem" data-archive-format="tar.bz2">tar.bz2...</button>
      <button id="contextCompressTarXz" type="button" role="menuitem" data-archive-format="tar.xz">tar.xz...</button>
      <button id="contextCompressTarZ" type="button" role="menuitem" data-archive-format="tar.Z">tar.Z...</button>
    </div>
  </div>
  <div id="contextItemSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextDownload" type="button" role="menuitem">Download...</button>
  <button id="contextUploadEntry" type="button" role="menuitem">Upload...</button>
  <button id="contextCalculateChecksums" type="button" role="menuitem">Calculate Checksums</button>
  <button id="contextFileProperties" type="button" role="menuitem">File Properties</button>
  <button id="contextSetPermissions" type="button" role="menuitem">Set Permissions...</button>
  <button id="contextChangeOwnerGroup" type="button" role="menuitem">Change Owner/Group...</button>
  <div id="contextRefreshSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextCreateFile" type="button" role="menuitem">Create New File...</button>
  <button id="contextCreateDirectory" type="button" role="menuitem">Create New Directory...</button>
  <button id="contextUpload" type="button" role="menuitem">Upload...</button>
  <div id="contextEmptyCopySeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextCopyCurrentPath" type="button" role="menuitem">Copy Current Path</button>
  <div id="contextEmptyRefreshSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextRefresh" type="button" role="menuitem">Refresh</button>
  <button id="contextRunRemoteCommand" type="button" role="menuitem">Run Remote Command...</button>
  <button id="contextOpenSshTerminal" type="button" role="menuitem">Open SSH Terminal</button>
  <div id="contextDeleteSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextDelete" type="button" role="menuitem">Delete</button>
  </div>


  <div id="permissionBackdrop" class="permission-backdrop" aria-hidden="true">
  <section class="permission-dialog" role="dialog" aria-modal="true" aria-labelledby="permissionDialogTitle">
    <div class="permission-dialog-header">
      <h2 id="permissionDialogTitle" class="permission-dialog-title">Set Permissions</h2>
      <div id="permissionDialogPath" class="permission-dialog-path"></div>
    </div>
    <div class="permission-dialog-body">
      <section class="permission-section">
        <p class="permission-section-title">Basic permissions</p>
        <table class="permission-table" aria-label="Basic permissions">
          <thead>
            <tr><th></th><th>Read</th><th>Write</th><th>Execute</th></tr>
          </thead>
          <tbody>
            <tr><td>Owner</td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="ownerRead" aria-label="Owner read"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="ownerWrite" aria-label="Owner write"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="ownerExecute" aria-label="Owner execute"></td></tr>
            <tr><td>Group</td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="groupRead" aria-label="Group read"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="groupWrite" aria-label="Group write"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="groupExecute" aria-label="Group execute"></td></tr>
            <tr><td>Others</td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="othersRead" aria-label="Others read"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="othersWrite" aria-label="Others write"></td><td><input class="permission-check dialog-checkbox" type="checkbox" data-permission="othersExecute" aria-label="Others execute"></td></tr>
          </tbody>
        </table>
      </section>
      <section class="permission-section">
        <p class="permission-section-title">Special permissions</p>
        <div class="permission-special-list">
          <label class="permission-special-item"><input class="permission-check dialog-checkbox" type="checkbox" data-permission="setuid"> <span id="permissionSetuidLabel">Run as owner / setuid</span></label>
          <label class="permission-special-item"><input class="permission-check dialog-checkbox" type="checkbox" data-permission="setgid"> <span id="permissionSetgidLabel">Run as group / setgid</span></label>
          <label class="permission-special-item"><input class="permission-check dialog-checkbox" type="checkbox" data-permission="sticky"> <span id="permissionStickyLabel">Sticky bit</span></label>
        </div>
      </section>
      <section class="permission-section">
        <div class="permission-mode-row">
          <label for="permissionModeInput">Octal</label>
          <input id="permissionModeInput" type="text" maxlength="4" inputmode="numeric" autocomplete="off">
          <span id="permissionCurrentText" class="permission-current permission-preview-stack" aria-live="polite"></span>
        </div>
        <div id="permissionHelperBlock" class="permission-checkbox-block modal-checkbox-block">
          <label id="permissionRecursiveRow" class="modal-checkbox-line">
            <input id="permissionRecursiveInput" class="dialog-checkbox" type="checkbox">
            <span>Apply recursively to selected directories</span>
          </label>
          <div id="permissionNote" class="modal-helper-text modal-checkbox-helper"></div>
          <div class="modal-helper-text modal-checkbox-helper">May fail without enough permissions. Enable Sudo Mode if needed.</div>
        </div>
        <div id="permissionValidation" class="permission-validation" role="alert"></div>
      </section>
    </div>
    <div class="permission-dialog-actions">
      <button id="permissionCancelButton" class="secondary" type="button">Cancel</button>
      <button id="permissionApplyButton" type="button">Apply</button>
    </div>
  </section>
  </div>

  <script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  const mainLayout = document.getElementById('mainLayout');
  const connectionResizeHandle = document.getElementById('connectionResizeHandle');
  const hideConnectionPanelButton = document.getElementById('hideConnectionPanelButton');
  const showConnectionPanelButton = document.getElementById('showConnectionPanelButton');
  const connectionRail = document.querySelector('.connection-rail');
  const connectionCard = document.querySelector('.connection-card');
  const browserCard = document.querySelector('.browser-card');
  const profileSelect = document.getElementById('profileSelect');
  const profileDropdownButton = document.getElementById('profileDropdownButton');
  const profileDropdownLabel = document.getElementById('profileDropdownLabel');
  const profileDropdownMenu = document.getElementById('profileDropdownMenu');
  const manageProfilesButton = document.getElementById('manageProfilesButton');
  const connectionNameBackdrop = document.getElementById('connectionNameBackdrop');
  const connectionNameInput = document.getElementById('connectionNameInput');
  const connectionNameFeedback = document.getElementById('connectionNameFeedback');
  const connectionNameCreateButton = document.getElementById('connectionNameCreateButton');
  const connectionNameCancelButton = document.getElementById('connectionNameCancelButton');
  const profileName = document.getElementById('profileName');
  const host = document.getElementById('host');
  const port = document.getElementById('port');
  const username = document.getElementById('username');
  const connectionType = document.getElementById('connectionType');
  const connectionTypeDropdownButton = document.getElementById('connectionTypeDropdownButton');
  const connectionTypeDropdownLabel = document.getElementById('connectionTypeDropdownLabel');
  const connectionTypeDropdownMenu = document.getElementById('connectionTypeDropdownMenu');
  const ftpsCertificateBlock = document.getElementById('ftpsCertificateBlock');
  const ftpsAllowSelfSignedCertificate = document.getElementById('ftpsAllowSelfSignedCertificate');
  const ftpsCaCertificateBlock = document.getElementById('ftpsCaCertificateBlock');
  const ftpsCaCertificatePath = document.getElementById('ftpsCaCertificatePath');
  const ftpsCaCertificateBrowseButton = document.getElementById('ftpsCaCertificateBrowseButton');
  const authType = document.getElementById('authType');
  const authMethodBlock = document.getElementById('authMethodBlock');
  const authDropdownButton = document.getElementById('authDropdownButton');
  const authDropdownLabel = document.getElementById('authDropdownLabel');
  const authDropdownMenu = document.getElementById('authDropdownMenu');
  const password = document.getElementById('password');
  const passwordRevealButton = document.getElementById('passwordRevealButton');
  const rememberPassword = document.getElementById('rememberPassword');
  const passwordSecretState = document.getElementById('passwordSecretState');
  const privateKeyPath = document.getElementById('privateKeyPath');
  const privateKeyBrowseButton = document.getElementById('privateKeyBrowseButton');
  const passphrase = document.getElementById('passphrase');
  const passphraseRevealButton = document.getElementById('passphraseRevealButton');
  const rememberPassphrase = document.getElementById('rememberPassphrase');
  const passphraseSecretState = document.getElementById('passphraseSecretState');
  const startPath = document.getElementById('startPath');
  const keepAlive = document.getElementById('keepAlive');
  const passwordBlock = document.getElementById('passwordBlock');
  const privateKeyBlock = document.getElementById('privateKeyBlock');
  const passphraseBlock = document.getElementById('passphraseBlock');
  const sessionTabs = document.getElementById('sessionTabs');
  const pathbar = document.querySelector('.pathbar');
  const currentPath = document.getElementById('currentPath');
  const remotePathLeadingIcon = document.querySelector('.remote-path-leading-icon');
  const remotePathBox = document.getElementById('remotePathBox');
  const remotePathResizeHandle = document.getElementById('remotePathResizeHandle');
  const remotePathBreadcrumb = document.getElementById('remotePathBreadcrumb');
  const remotePathDropdown = document.getElementById('remotePathDropdown');
  const remotePathBackButton = document.getElementById('remotePathBackButton');
  const remotePathForwardButton = document.getElementById('remotePathForwardButton');
  const togglePathFavoriteButton = document.getElementById('togglePathFavoriteButton');
  const pathFavoritesButton = document.getElementById('pathFavoritesButton');
  const pathFavoritesPopover = document.getElementById('pathFavoritesPopover');
  const pathFavoritesList = document.getElementById('pathFavoritesList');
  const filterBox = document.getElementById('filterBox');
  const filterInput = document.getElementById('filterInput');
  const clearFilterButton = document.getElementById('clearFilterButton');
  const entriesTableWrap = document.getElementById('entriesTableWrap');
  const entriesTable = document.getElementById('entriesTable');
  const entriesBody = document.getElementById('entriesBody');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const statusOutputLink = document.getElementById('statusOutputLink');
  const statusCancelButton = document.getElementById('statusCancelButton');
  const statusCopyButton = document.getElementById('statusCopyButton');
  const statusCopyFeedback = document.getElementById('statusCopyFeedback');
  const webviewTooltip = document.getElementById('webviewTooltip');
  const browserSubtitle = document.getElementById('browserSubtitle');
  const commandActionsSeparator = document.getElementById('commandActionsSeparator');
  const commandActions = document.getElementById('commandActions');
  const transferActionsSeparator = document.getElementById('transferActionsSeparator');
  const transferActions = document.querySelector('.transfer-actions');
  const sudoToggleSeparator = document.getElementById('sudoToggleSeparator');
  const sudoToggleLabel = document.getElementById('sudoToggleLabel');
  const sudoToggle = document.getElementById('sudoToggle');
  const sudoToggleState = document.getElementById('sudoToggleState');

  const saveProfileButton = document.getElementById('saveProfileButton');
  const connectButton = document.getElementById('connectButton');
  const showOutputButton = document.getElementById('showOutputButton');
  const runRemoteCommandButton = document.getElementById('runRemoteCommandButton');
  const openSshTerminalButton = document.getElementById('openSshTerminalButton');
  const uploadButton = document.getElementById('uploadButton');
  const downloadButton = document.getElementById('downloadButton');
  const transferQueueButton = document.getElementById('transferQueueButton');
  const transferQueueTooltip = document.getElementById('transferQueueTooltip');
  const transferQueueCount = document.getElementById('transferQueueCount');
  const transferQueueModal = document.getElementById('transferQueueModal');
  const transferQueueCloseButton = document.getElementById('transferQueueCloseButton');
  const transferQueueFooterCloseButton = document.getElementById('transferQueueFooterCloseButton');
  const transferQueueCurrent = document.getElementById('transferQueueCurrent');
  const transferQueuePending = document.getElementById('transferQueuePending');
  const transferQueueCompleted = document.getElementById('transferQueueCompleted');
  const confirmDialogBackdrop = document.getElementById('confirmDialogBackdrop');
  const confirmDialogTitle = document.getElementById('confirmDialogTitle');
  const confirmDialogMessage = document.getElementById('confirmDialogMessage');
  const confirmDialogDetails = document.getElementById('confirmDialogDetails');
  const confirmDialogCancelButton = document.getElementById('confirmDialogCancelButton');
  const confirmDialogConfirmButton = document.getElementById('confirmDialogConfirmButton');
  const transferConflictBackdrop = document.getElementById('transferConflictBackdrop');
  const transferConflictDialog = transferConflictBackdrop ? transferConflictBackdrop.querySelector('.transfer-conflict-dialog') : null;
  const transferConflictTitle = document.getElementById('transferConflictTitle');
  const transferConflictMessage = document.getElementById('transferConflictMessage');
  const transferConflictName = document.getElementById('transferConflictName');
  const transferConflictPath = document.getElementById('transferConflictPath');
  const transferConflictSourceType = document.getElementById('transferConflictSourceType');
  const transferConflictSourcePath = document.getElementById('transferConflictSourcePath');
  const transferConflictSourceSize = document.getElementById('transferConflictSourceSize');
  const transferConflictSourceModified = document.getElementById('transferConflictSourceModified');
  const transferConflictDestinationType = document.getElementById('transferConflictDestinationType');
  const transferConflictDestinationPath = document.getElementById('transferConflictDestinationPath');
  const transferConflictDestinationSize = document.getElementById('transferConflictDestinationSize');
  const transferConflictDestinationModified = document.getElementById('transferConflictDestinationModified');
  const transferConflictNote = document.getElementById('transferConflictNote');
  const transferConflictActions = document.getElementById('transferConflictActions');
  const goButton = document.getElementById('goButton');
  const entryContextMenu = document.getElementById('entryContextMenu');
  const contextOpen = document.getElementById('contextOpen');
  const contextOpenReadOnly = document.getElementById('contextOpenReadOnly');
  const contextCompare = document.getElementById('contextCompare');
  const contextOpenSeparator = document.getElementById('contextOpenSeparator');
  const contextCreateFile = document.getElementById('contextCreateFile');
  const contextCreateDirectory = document.getElementById('contextCreateDirectory');
  const contextUpload = document.getElementById('contextUpload');
  const contextEmptyCopySeparator = document.getElementById('contextEmptyCopySeparator');
  const contextCopyCurrentPath = document.getElementById('contextCopyCurrentPath');
  const contextEmptyRefreshSeparator = document.getElementById('contextEmptyRefreshSeparator');
  const contextDownload = document.getElementById('contextDownload');
  const contextUploadEntry = document.getElementById('contextUploadEntry');
  const contextItemSeparator = document.getElementById('contextItemSeparator');
  const contextCopySeparator = document.getElementById('contextCopySeparator');
  const contextCopyPath = document.getElementById('contextCopyPath');
  const contextCopyName = document.getElementById('contextCopyName');
  const contextCompressSubmenu = document.getElementById('contextCompressSubmenu');
  const contextMakeCopy = document.getElementById('contextMakeCopy');
  const contextSetPermissions = document.getElementById('contextSetPermissions');
  const contextChangeOwnerGroup = document.getElementById('contextChangeOwnerGroup');
  const contextFileProperties = document.getElementById('contextFileProperties');
  const contextCalculateChecksums = document.getElementById('contextCalculateChecksums');
  const contextRename = document.getElementById('contextRename');
  const contextDeleteSeparator = document.getElementById('contextDeleteSeparator');
  const contextDelete = document.getElementById('contextDelete');
  const contextRefreshSeparator = document.getElementById('contextRefreshSeparator');
  const contextRefresh = document.getElementById('contextRefresh');
  const contextRunRemoteCommand = document.getElementById('contextRunRemoteCommand');
  const contextOpenSshTerminal = document.getElementById('contextOpenSshTerminal');

  const remoteCommandBackdrop = document.getElementById('remoteCommandBackdrop');
  const remoteCommandConnectedTo = document.getElementById('remoteCommandConnectedTo');
  const remoteCommandWorkingDirectory = document.getElementById('remoteCommandWorkingDirectory');
  const remoteCommandRunAs = document.getElementById('remoteCommandRunAs');
  const remoteCommandInput = document.getElementById('remoteCommandInput');
  const remoteCommandRunButton = document.getElementById('remoteCommandRunButton');
  const remoteCommandCopyButton = document.getElementById('remoteCommandCopyButton');
  const remoteCommandClearButton = document.getElementById('remoteCommandClearButton');
  const remoteCommandCloseButton = document.getElementById('remoteCommandCloseButton');
  const remoteCommandOutputWrap = document.getElementById('remoteCommandOutputWrap');
  const remoteCommandOutput = document.getElementById('remoteCommandOutput');
  const remoteCommandStatus = document.getElementById('remoteCommandStatus');
  const remoteCommandOutputNotice = document.getElementById('remoteCommandOutputNotice');
  const remoteCommandCloseWarning = document.getElementById('remoteCommandCloseWarning');
  const remoteCommandKeepRunningButton = document.getElementById('remoteCommandKeepRunningButton');
  const remoteCommandStopAndCloseButton = document.getElementById('remoteCommandStopAndCloseButton');
  const remoteCommandStopWarning = document.getElementById('remoteCommandStopWarning');
  const remoteCommandKeepStoppingButton = document.getElementById('remoteCommandKeepStoppingButton');
  const remoteCommandForceKillButton = document.getElementById('remoteCommandForceKillButton');

  const filePropertiesBackdrop = document.getElementById('filePropertiesBackdrop');
  const filePropertiesTitle = document.getElementById('filePropertiesTitle');
  const filePropertiesPath = document.getElementById('filePropertiesPath');
  const filePropertiesGrid = document.getElementById('filePropertiesGrid');
  const filePropertiesCopyPathButton = document.getElementById('filePropertiesCopyPathButton');
  const filePropertiesCloseButton = document.getElementById('filePropertiesCloseButton');
  const checksumsBackdrop = document.getElementById('checksumsBackdrop');
  const checksumsPath = document.getElementById('checksumsPath');
  const checksumsGrid = document.getElementById('checksumsGrid');
  const checksumsCopySha256Button = document.getElementById('checksumsCopySha256Button');
  const checksumsCopyMd5Button = document.getElementById('checksumsCopyMd5Button');
  const checksumsCopyAllButton = document.getElementById('checksumsCopyAllButton');
  const checksumsCloseButton = document.getElementById('checksumsCloseButton');
  const ownerGroupBackdrop = document.getElementById('ownerGroupBackdrop');
  const ownerGroupTitle = document.getElementById('ownerGroupTitle');
  const ownerGroupPath = document.getElementById('ownerGroupPath');
  const ownerGroupOwnerInput = document.getElementById('ownerGroupOwnerInput');
  const ownerGroupGroupInput = document.getElementById('ownerGroupGroupInput');
  const ownerGroupHelperBlock = document.getElementById('ownerGroupHelperBlock');
  const ownerGroupRecursiveRow = document.getElementById('ownerGroupRecursiveRow');
  const ownerGroupRecursiveInput = document.getElementById('ownerGroupRecursiveInput');
  const ownerGroupNote = document.getElementById('ownerGroupNote');
  const ownerGroupValidation = document.getElementById('ownerGroupValidation');
  const ownerGroupCancelButton = document.getElementById('ownerGroupCancelButton');
  const ownerGroupApplyButton = document.getElementById('ownerGroupApplyButton');
  const manageProfilesBackdrop = document.getElementById('manageProfilesBackdrop');
  const manageProfilesFilterInput = document.getElementById('manageProfilesFilterInput');
  const manageProfilesFeedback = document.getElementById('manageProfilesFeedback');
  const manageProfilesList = document.getElementById('manageProfilesList');
  const manageProfilesCloseButton = document.getElementById('manageProfilesCloseButton');
  const manageProfilesImportButton = document.getElementById('manageProfilesImportButton');
  const manageProfilesExportButton = document.getElementById('manageProfilesExportButton');
  const exportBackupBackdrop = document.getElementById('exportBackupBackdrop');
  const exportIncludeSettings = document.getElementById('exportIncludeSettings');
  const exportIncludeConnections = document.getElementById('exportIncludeConnections');
  const exportIncludeFavorites = document.getElementById('exportIncludeFavorites');
  const exportIncludeUsernames = document.getElementById('exportIncludeUsernames');
  const exportIncludeCredentials = document.getElementById('exportIncludeCredentials');
  const exportCredentialsBlock = document.getElementById('exportCredentialsBlock');
  const exportCredentialsDisabledHelp = document.getElementById('exportCredentialsDisabledHelp');
  const exportCredentialPassword = document.getElementById('exportCredentialPassword');
  const exportCredentialPasswordError = document.getElementById('exportCredentialPasswordError');
  const exportCredentialPasswordRevealButton = document.getElementById('exportCredentialPasswordRevealButton');
  const exportCredentialConfirmPassword = document.getElementById('exportCredentialConfirmPassword');
  const exportCredentialConfirmPasswordError = document.getElementById('exportCredentialConfirmPasswordError');
  const exportCredentialConfirmPasswordRevealButton = document.getElementById('exportCredentialConfirmPasswordRevealButton');
  const exportBackupResult = document.getElementById('exportBackupResult');
  const exportBackupValidation = document.getElementById('exportBackupValidation');
  const exportBackupCancelButton = document.getElementById('exportBackupCancelButton');
  const exportBackupApplyButton = document.getElementById('exportBackupApplyButton');
  const importBackupBackdrop = document.getElementById('importBackupBackdrop');
  const importBackupSummary = document.getElementById('importBackupSummary');
  const importIncludeSettings = document.getElementById('importIncludeSettings');
  const importIncludeConnections = document.getElementById('importIncludeConnections');
  const importIncludeFavorites = document.getElementById('importIncludeFavorites');
  const importIncludeUsernames = document.getElementById('importIncludeUsernames');
  const importRestoreCredentials = document.getElementById('importRestoreCredentials');
  const importCredentialsBlock = document.getElementById('importCredentialsBlock');
  const importCredentialsDisabledHelp = document.getElementById('importCredentialsDisabledHelp');
  const importCredentialPassword = document.getElementById('importCredentialPassword');
  const importCredentialPasswordError = document.getElementById('importCredentialPasswordError');
  const importCredentialPasswordRevealButton = document.getElementById('importCredentialPasswordRevealButton');
  const importModeBlock = document.getElementById('importModeBlock');
  const importModeMerge = document.getElementById('importModeMerge');
  const importModeReplace = document.getElementById('importModeReplace');
  const importModeHelp = document.getElementById('importModeHelp');
  const importBackupResult = document.getElementById('importBackupResult');
  const importBackupValidation = document.getElementById('importBackupValidation');
  const importBackupCancelButton = document.getElementById('importBackupCancelButton');
  const importBackupApplyButton = document.getElementById('importBackupApplyButton');

  const permissionBackdrop = document.getElementById('permissionBackdrop');
  const permissionDialogTitle = document.getElementById('permissionDialogTitle');
  const permissionDialogPath = document.getElementById('permissionDialogPath');
  const permissionModeInput = document.getElementById('permissionModeInput');
  const permissionCurrentText = document.getElementById('permissionCurrentText');
  const permissionValidation = document.getElementById('permissionValidation');
  const permissionApplyButton = document.getElementById('permissionApplyButton');
  const permissionCancelButton = document.getElementById('permissionCancelButton');
  const permissionHelperBlock = document.getElementById('permissionHelperBlock');
  const permissionRecursiveRow = document.getElementById('permissionRecursiveRow');
  const permissionRecursiveInput = document.getElementById('permissionRecursiveInput');
  const permissionNote = document.getElementById('permissionNote');
  const permissionSetuidLabel = document.getElementById('permissionSetuidLabel');
  const permissionSetgidLabel = document.getElementById('permissionSetgidLabel');
  const permissionStickyLabel = document.getElementById('permissionStickyLabel');
  const permissionCheckboxes = Array.from(document.querySelectorAll('#permissionBackdrop input[data-permission]'));

  const SAVED_SECRET_MASK = '••••••••';
  const CONNECTION_PANEL_MIN_WIDTH = 240;
  const CONNECTION_PANEL_COLLAPSE_THRESHOLD = 40;
  const CONNECTION_PANEL_EXPAND_THRESHOLD = 80;
  const CONNECTION_PANEL_MAX_WIDTH = 390;
  const CONNECTION_PANEL_DEFAULT_WIDTH = 320;
  const CONNECTION_PANEL_STORAGE_KEY = 'remoteedit.connectionPanelLayout';
  const REMOTE_PATH_MIN_WIDTH = 400;
  const REMOTE_PATH_FILTER_MIN_WIDTH = 110;
  const REMOTE_PATH_FILTER_DEFAULT_WIDTH = 150;
  const REMOTE_PATH_STORAGE_KEY = 'remoteedit.remotePathLayout';
  const NAVIGATION_HISTORY_STORAGE_KEY = 'remoteedit.remotePathNavigationHistory';
  const REMOTE_PATH_GO_ICON = '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M683.15-460H200v-40h483.15L451.46-731.69 480-760l280 280-280 280-28.54-28.31L683.15-460Z" /></svg>';
  const REMOTE_PATH_REFRESH_ICON = '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M483.08-200q-117.25 0-198.63-81.34-81.37-81.34-81.37-198.54 0-117.2 81.37-198.66Q365.83-760 483.08-760q71.3 0 133.54 33.88 62.23 33.89 100.3 94.58V-760h40v209.23H547.69v-40h148q-31.23-59.85-87.88-94.54Q551.15-720 483.08-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h42.46Q725.08-310.15 651-255.08 576.92-200 483.08-200Z" /></svg>';

  const columnOrder = ['name', 'type', 'size', 'owner', 'group', 'permissions', 'modified'];
  const columnWidths = { name: 300, type: 86, size: 92, owner: 84, group: 84, permissions: 120, modified: 170 };
  const minColumnWidths = { name: 150, type: 62, size: 72, owner: 64, group: 64, permissions: 90, modified: 130 };

  let profiles = [];
  let sessions = [];
  let selectedProfileId = '';
  let pendingConnectionNameResolver = null;
  let profileDropdownOpen = false;
  let profileDropdownFilterText = '';
  let connectionTypeDropdownOpen = false;
  let authDropdownOpen = false;
  let manageProfilesDialogOpen = false;
  let exportBackupDialogOpen = false;
  let importBackupDialogOpen = false;
  let importBackupSummaryState = null;
  let manageProfilesFilterText = '';
  let renameProfileId = '';
  let activeConnectionId = '';
  let currentEntries = [];
  let selectedEntryPath = '';
  let selectedEntryPaths = new Set();
  let selectionAnchorPath = '';
  let remotePathEditing = false;
  let breadcrumbDropdownState = { open: false, path: '', requestId: '', anchorPath: '' };
  let filterText = '';
  let currentSort = { key: '', direction: '' };
  let busy = false;
  let statusCancelAction = '';
  let statusCancelLabel = 'Cancel';
  let connectionButtonState = '';
  let lastSyncedActiveConnectionId = '';
  let statusCopyFeedbackTimer = 0;
  let filePropertiesDialogOpen = false;
  let filePropertiesRemotePath = '';
  let checksumsDialogOpen = false;
  let ownerGroupDialogOpen = false;
  let ownerGroupEntries = [];
  let checksumsCopyState = { sha256: '', md5: '', all: '' };
  let permissionsDialogOpen = false;
  let permissionPreviewKind = 'file';
  let transferQueueState = { current: null, currentTransfers: [], pending: [], completed: [] };
  let transferQueueModalOpen = false;
  let remoteCommandDialogOpen = false;
  let remoteCommandRunning = false;
  let remoteCommandStopping = false;
  let remoteCommandForceKilling = false;
  let remoteCommandId = '';
  let remoteCommandClosingAfterStop = false;
  let remoteCommandStopEscalationTimer = null;
  let remoteCommandOutputText = '';
  let remoteCommandFinalMessage = '';
  let remoteCommandOutputViewLimited = false;
  const REMOTE_COMMAND_STOP_ESCALATION_MS = 10000;
  const REMOTE_COMMAND_MAX_OUTPUT_CHARS = 500000;
  let confirmDialogOpen = false;
  let confirmDialogRequestId = '';
  let transferConflictDialogOpen = false;
  let transferConflictRequestId = '';
  let pathFavoritesOpen = false;
  const navigationHistoryByConnectionId = new Map();
  let pendingNavigationHistoryMode = '';
  function readPersistentConnectionPanelState() {
    try {
      const rawState = localStorage.getItem(CONNECTION_PANEL_STORAGE_KEY);
      return rawState ? JSON.parse(rawState) || {} : {};
    } catch (_) {
      return {};
    }
  }

  function readPersistentRemotePathState() {
    try {
      const rawState = localStorage.getItem(REMOTE_PATH_STORAGE_KEY);
      return rawState ? JSON.parse(rawState) || {} : {};
    } catch (_) {
      return {};
    }
  }

  function readPersistentNavigationHistoryState() {
    try {
      const rawState = localStorage.getItem(NAVIGATION_HISTORY_STORAGE_KEY);
      return rawState ? JSON.parse(rawState) || {} : {};
    } catch (_) {
      return {};
    }
  }

  const initialWebviewState = Object.assign({}, readPersistentConnectionPanelState(), readPersistentRemotePathState(), readPersistentNavigationHistoryState(), vscode.getState() || {});
  let connectionPanelCollapsed = Boolean(initialWebviewState.connectionPanelCollapsed);
  let connectionPanelWidth = normalizeConnectionPanelWidth(initialWebviewState.connectionPanelWidth);
  let connectionPanelResizeState = null;
  let remotePathLayoutPreference = normalizeRemotePathLayoutPreference(initialWebviewState);
  let remotePathResizeState = null;
  let remotePathResetTransitionTimer = 0;
  let toolbarLayoutTransitionTimer = 0;
  let toolbarCapabilityState = '';
  let connectionPanelTransitionTimer = 0;

  restoreNavigationHistoryFromState(initialWebviewState.navigationHistoryByConnectionId);

  let activeTooltipTarget = null;
  let tooltipTimer = 0;

  function hideWebviewTooltip() {
    if (tooltipTimer) {
      clearTimeout(tooltipTimer);
      tooltipTimer = 0;
    }
    activeTooltipTarget = null;
    if (!webviewTooltip) return;
    webviewTooltip.classList.remove('visible');
    webviewTooltip.setAttribute('aria-hidden', 'true');
  }

  function positionWebviewTooltip(target, preferAbove = false) {
    if (!webviewTooltip || !target) return;

    const gap = 7;
    const margin = 8;
    const rect = target.getBoundingClientRect();
    const tooltipRect = webviewTooltip.getBoundingClientRect();
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));

    let top = preferAbove ? (rect.top - tooltipRect.height - gap) : (rect.bottom + gap);
    if (top < margin) top = rect.bottom + gap;
    if (top + tooltipRect.height > window.innerHeight - margin) top = rect.top - tooltipRect.height - gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

    webviewTooltip.style.left = Math.round(left) + 'px';
    webviewTooltip.style.top = Math.round(top) + 'px';
  }

  function showWebviewTooltip(target) {
    if (!webviewTooltip || !target) return;
    const text = String(target.getAttribute('data-tooltip') || '').trim();
    if (!text) return;

    if (tooltipTimer) clearTimeout(tooltipTimer);
    activeTooltipTarget = target;
    webviewTooltip.textContent = text;
    webviewTooltip.setAttribute('aria-hidden', 'false');
    webviewTooltip.classList.remove('visible');
    webviewTooltip.style.left = '0px';
    webviewTooltip.style.top = '0px';

    tooltipTimer = window.setTimeout(() => {
      if (activeTooltipTarget !== target) return;
      const preferAbove = target.classList.contains('tooltip-above') || target.getAttribute('data-tooltip-position') === 'above';
      positionWebviewTooltip(target, preferAbove);
      webviewTooltip.classList.add('visible');
    }, 500);
  }

  function getTooltipTarget(eventTarget) {
    return eventTarget && eventTarget.closest ? eventTarget.closest('[data-tooltip]') : null;
  }

  document.addEventListener('mouseover', event => {
    const target = getTooltipTarget(event.target);
    if (!target || target === activeTooltipTarget) return;
    showWebviewTooltip(target);
  });

  document.addEventListener('mouseout', event => {
    const target = getTooltipTarget(event.target);
    if (!target || target !== activeTooltipTarget) return;
    const related = event.relatedTarget;
    if (related && target.contains(related)) return;
    hideWebviewTooltip();
  });

  document.addEventListener('focusin', event => {
    const target = getTooltipTarget(event.target);
    if (target) showWebviewTooltip(target);
  });

  document.addEventListener('focusout', event => {
    const target = getTooltipTarget(event.target);
    if (target && target === activeTooltipTarget) hideWebviewTooltip();
  });

  window.addEventListener('scroll', hideWebviewTooltip, true);
  window.addEventListener('resize', () => {
    hideWebviewTooltip();
    hideRemotePathDropdown();
  });

  function showConfirmDialog(payload) {
    confirmDialogRequestId = String(payload.requestId || '');
    confirmDialogOpen = Boolean(confirmDialogRequestId);

    confirmDialogTitle.textContent = String(payload.title || 'Confirm action');
    confirmDialogMessage.textContent = String(payload.message || 'Confirm this action?');

    const details = String(payload.details || '').trim();
    confirmDialogDetails.textContent = details;
    confirmDialogDetails.hidden = !details;

    confirmDialogCancelButton.textContent = String(payload.cancelLabel || 'Cancel');
    confirmDialogConfirmButton.textContent = String(payload.confirmLabel || 'Confirm');
    confirmDialogConfirmButton.classList.toggle('danger', Boolean(payload.danger));

    hideWebviewTooltip();
    hideContextMenu();
    hideProfileDropdown();
    hideAuthDropdown();
    hideRemotePathDropdown();
    hidePathFavoritesPopover();

    confirmDialogBackdrop.classList.add('visible');
    confirmDialogBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => confirmDialogCancelButton.focus(), 0);
  }

  function closeConfirmDialog(confirmed) {
    if (!confirmDialogOpen) return;

    const requestId = confirmDialogRequestId;
    confirmDialogOpen = false;
    confirmDialogRequestId = '';
    confirmDialogBackdrop.classList.remove('visible');
    confirmDialogBackdrop.setAttribute('aria-hidden', 'true');
    confirmDialogConfirmButton.classList.remove('danger');

    vscode.postMessage({ type: 'confirmDialogResponse', payload: { requestId, confirmed: Boolean(confirmed) } });
  }

  function setTransferConflictMeta(element, label, value) {
    if (!element) return;
    const text = value === undefined || value === null || value === '' || value === 'unknown'
      ? ''
      : label + ': ' + String(value);
    element.textContent = text;
    element.hidden = !text;
  }

  function showTransferConflictDialog(payload) {
    transferConflictRequestId = String(payload.requestId || '');
    transferConflictDialogOpen = Boolean(transferConflictRequestId);

    if (!transferConflictDialogOpen) return;

    transferConflictTitle.textContent = String(payload.title || 'Transfer conflict');
    transferConflictMessage.textContent = String(payload.message || 'A conflict decision is required to continue.');
    transferConflictName.textContent = String(payload.itemName || payload.relativePath || '');
    transferConflictPath.textContent = String(payload.relativePath || '');

    setTransferConflictMeta(transferConflictSourceType, 'Type', payload.sourceType || 'Source');
    setTransferConflictMeta(transferConflictSourcePath, 'Path', payload.sourcePath || '');
    setTransferConflictMeta(transferConflictSourceSize, 'Size', payload.sourceSize || '');
    setTransferConflictMeta(transferConflictSourceModified, 'Modified', payload.sourceModified || '');
    setTransferConflictMeta(transferConflictDestinationType, 'Type', payload.destinationType || 'Destination');
    setTransferConflictMeta(transferConflictDestinationPath, 'Path', payload.destinationPath || '');
    setTransferConflictMeta(transferConflictDestinationSize, 'Size', payload.destinationSize || '');
    setTransferConflictMeta(transferConflictDestinationModified, 'Modified', payload.destinationModified || '');

    const note = String(payload.note || '');
    transferConflictNote.textContent = note;
    transferConflictNote.hidden = !note;

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    transferConflictActions.innerHTML = choices.map(choice => {
      const label = String(choice && choice.label || 'Cancel');
      const decision = String(choice && choice.decision || 'cancel');
      const classes = [];
      if (!choice || !choice.primary) classes.push('secondary');
      if (choice && choice.danger) classes.push('danger');
      return '<button class="' + classes.join(' ') + '" type="button" data-transfer-conflict-decision="' + escapeHtml(decision) + '">' + escapeHtml(label) + '</button>';
    }).join('');

    transferConflictBackdrop.classList.add('visible');
    transferConflictBackdrop.setAttribute('aria-hidden', 'false');

    const cancelButton = transferConflictActions.querySelector('button[data-transfer-conflict-decision="cancel"]');
    const firstButton = transferConflictActions.querySelector('button');
    setTimeout(() => (cancelButton || firstButton || transferConflictDialog).focus(), 0);
  }

  function hideTransferConflictDialog() {
    transferConflictDialogOpen = false;
    transferConflictRequestId = '';
    transferConflictBackdrop.classList.remove('visible');
    transferConflictBackdrop.setAttribute('aria-hidden', 'true');
    transferConflictActions.innerHTML = '';
  }

  function closeTransferConflictDialog(decision) {
    if (!transferConflictDialogOpen) return;

    const requestId = transferConflictRequestId;
    hideTransferConflictDialog();
    vscode.postMessage({ type: 'transferConflictResponse', payload: { requestId, decision: decision || 'cancel' } });
  }

  function trapTransferConflictFocus(event) {
    if (!transferConflictDialogOpen || event.key !== 'Tab') return;

    const focusable = Array.from(transferConflictBackdrop.querySelectorAll('button, [tabindex]:not([tabindex="-1"])')).filter(element => !element.disabled);
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

  function trapConfirmDialogFocus(event) {
    if (!confirmDialogOpen || event.key !== 'Tab') return;

    const focusable = [confirmDialogCancelButton, confirmDialogConfirmButton].filter(Boolean);
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

  window.addEventListener('message', event => {
    const message = event.data;
    const payload = message.payload || {};

    switch (message.type) {
      case 'profilesLoaded':
        profiles = payload.profiles || [];
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
        }
        break;
      case 'caCertificatePathSelected':
        if (payload.path) {
          ftpsCaCertificatePath.value = payload.path;
          clearConnectionFieldInvalid(ftpsCaCertificatePath);
        }
        break;
      case 'sessionsChanged': {
        sessions = payload.sessions || [];
        pruneNavigationHistoryForSessions();
        const previousActiveConnectionId = activeConnectionId;
        activeConnectionId = payload.activeConnectionId || '';
        connectionButtonState = '';
        renderSessionTabs();
        updateActiveSessionUi();
        initializeNavigationHistoryForActiveSession();
        if (activeConnectionId && activeConnectionId !== previousActiveConnectionId) {
          syncConnectionFormWithActiveSession({ preserveStatus: true });
        }
        updateRemotePathNavigationControls();
        setControls();
        if (remoteCommandDialogOpen) updateRemoteCommandRunAs();
        if (pathFavoritesOpen) renderPathFavoritesPopover();
        break;
      }
      case 'sudoModeChanged': {
        const targetConnectionId = payload.connectionId || activeConnectionId;
        const session = sessions.find(item => item.id === targetConnectionId);
        if (session) {
          session.sudoModeEnabled = Boolean(payload.enabled);
        }
        updateSudoToggle();
        if (remoteCommandDialogOpen) updateRemoteCommandRunAs();
        setControls();
        break;
      }
      case 'disconnected':
        sessions = [];
        navigationHistoryByConnectionId.clear();
        persistNavigationHistory();
        pendingNavigationHistoryMode = '';
        activeConnectionId = '';
        connectionButtonState = '';
        lastSyncedActiveConnectionId = '';
        currentEntries = [];
        selectedEntryPath = '';
        filterText = '';
        filterInput.value = '';
        updateFilterClearButton();
        currentSort = { key: '', direction: '' };
        hideContextMenu();
        hideFilePropertiesDialog();
        hideChecksumsDialog();
        if (remoteCommandDialogOpen) {
          remoteCommandRunning = false;
          remoteCommandStopping = false;
          remoteCommandForceKilling = false;
          clearRemoteCommandStopEscalationTimer();
          hideRemoteCommandDialog();
        }
        hidePathFavoritesPopover();
        hideRemotePathDropdown();
        renderSessionTabs();
        updateActiveSessionUi();
        initializeNavigationHistoryForActiveSession();
        updateSortIndicators();
        entriesBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Connect to a host to list remote files.</div></td></tr>';
        currentPath.value = '';
        exitRemotePathEditMode({ reset: false, keepFocus: true });
        setControls();
        setStatus('No active connection.');
        break;
      case 'directoryListed': {
        if (payload.connectionId && payload.connectionId !== activeConnectionId) return;
        const activeSession = getActiveSession();
        const previousPath = normalizeUiRemotePath((activeSession && activeSession.currentPath) || currentPath.value || '/');
        const nextPath = normalizeUiRemotePath(payload.path || '/');
        const directoryChanged = previousPath !== nextPath;

        currentPath.value = nextPath;
        exitRemotePathEditMode({ reset: false, keepFocus: true });
        hideRemotePathDropdown();
        currentEntries = payload.entries || [];
        selectedEntryPath = '';
        selectedEntryPaths.clear();
        selectionAnchorPath = '';
        if (directoryChanged) clearFilterText();
        hideContextMenu();
        renderEntries(getVisibleEntries());
        if (directoryChanged) scrollEntriesToTop();
        updateActiveSessionPath(nextPath);
        recordNavigationHistory(nextPath, pendingNavigationHistoryMode);
        pendingNavigationHistoryMode = '';
        updatePathFavoriteControls();
        if (pathFavoritesOpen) renderPathFavoritesPopover();
        break;
      }
      case 'breadcrumbDirectoriesListed':
        handleBreadcrumbDirectoriesListed(payload);
        break;
      case 'status':
        setStatus(payload.message || '', false, Boolean(payload.showOutputLink), payload.outputLinkText || 'See details in Output.');
        break;
      case 'statusCopyFeedback':
        showStatusCopyFeedback(payload.message || 'Copied');
        break;
      case 'busy':
        setBusy(Boolean(payload.isBusy), payload.message || '', payload.cancelAction || (payload.canCancelTransfer ? 'transfer' : ''), payload.cancelLabel || 'Cancel');
        break;
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
      case 'error':
        connectionButtonState = '';
        setBusy(false);
        if (importBackupDialogOpen && importBackupResult) {
          showBackupResult(importBackupResult, payload.message || 'Unknown error.', true);
          break;
        } else if (exportBackupDialogOpen && exportBackupResult) {
          showBackupResult(exportBackupResult, payload.message || 'Unknown error.', true);
          break;
        }
        setStatus(payload.message || 'Unknown error.', true, Boolean(payload.showOutputLink), payload.outputLinkText || 'See details in Output.');
        break;
      case 'showConfirmDialog':
        showConfirmDialog(payload);
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
      case 'hidePermissionsDialog':
        hidePermissionsDialog();
        break;
      case 'permissionsValidationError':
        setPermissionValidation(payload.message || 'Invalid permission mode.', false);
        break;
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
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
    selectProfile(profileSelect.value || '');
  });

  profileDropdownButton.addEventListener('click', event => {
    event.stopPropagation();
    toggleProfileDropdown();
  });

  profileDropdownMenu.addEventListener('click', event => {
    const item = event.target && event.target.closest ? event.target.closest('[data-profile-id]') : null;
    if (!item) return;
    selectProfile(item.dataset.profileId || '');
    hideProfileDropdown();
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
  connectionNameBackdrop.addEventListener('click', event => {
    if (event.target === connectionNameBackdrop) closeConnectionNameDialog(null);
  });
  connectionNameInput.addEventListener('input', () => validateConnectionNameInput(false));
  connectionNameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmConnectionNameDialog();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeConnectionNameDialog(null);
    }
  });

  saveProfileButton.addEventListener('click', () => {
    void saveCurrentConnection();
  });

  connectButton.addEventListener('click', () => {
    const connectedSession = getConnectedSessionForCurrentForm();
    if (connectedSession) {
      connectionButtonState = 'disconnecting';
      setBusy(true, 'Disconnecting...');
      vscode.postMessage({ type: 'disconnect', payload: { connectionId: connectedSession.id } });
      return;
    }

    if (!validateConnectionForm('connect')) return;
    connectionButtonState = 'connecting';
    setBusy(true, 'Connecting...');
    vscode.postMessage({ type: 'connect', payload: collectConnectionPayload() });
  });

  showOutputButton.addEventListener('click', () => vscode.postMessage({ type: 'showOutput' }));
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
      setStatus('Connect to a host before enabling sudo mode.', true);
      return;
    }

    if (sudoToggle.checked) {
      sudoToggle.checked = false;
      setBusy(true, 'Enabling sudo mode...');
      vscode.postMessage({ type: 'enableSudoMode', payload: { connectionId: activeConnectionId } });
      return;
    }

    setBusy(true, 'Disabling sudo mode...');
    vscode.postMessage({ type: 'disableSudoMode', payload: { connectionId: activeConnectionId } });
  });
  uploadButton.addEventListener('click', () => { if (activeConnectionId && canStartTransferAction()) vscode.postMessage({ type: 'requestUploadEntries', payload: { path: currentPath.value || '/' } }); });
  downloadButton.addEventListener('click', () => { const entries = getSelectedActionEntries(); if (entries.length && canStartTransferAction()) vscode.postMessage({ type: 'requestDownloadEntries', payload: { entries: entries.map(actionPayload) } }); });
  transferQueueButton.addEventListener('click', showTransferQueueModal);
  transferQueueCloseButton.addEventListener('click', hideTransferQueueModal);
  transferQueueFooterCloseButton.addEventListener('click', hideTransferQueueModal);
  transferQueueModal.addEventListener('click', event => { if (event.target === transferQueueModal) hideTransferQueueModal(); });
  confirmDialogCancelButton.addEventListener('click', () => closeConfirmDialog(false));
  confirmDialogConfirmButton.addEventListener('click', () => closeConfirmDialog(true));
  transferConflictActions.addEventListener('click', event => {
    const button = event.target && event.target.closest ? event.target.closest('button[data-transfer-conflict-decision]') : null;
    if (!button) return;
    closeTransferConflictDialog(button.dataset.transferConflictDecision || 'cancel');
  });
  transferConflictBackdrop.addEventListener('mousedown', event => {
    if (event.target === transferConflictBackdrop) {
      event.preventDefault();
      const cancelButton = transferConflictActions.querySelector('button[data-transfer-conflict-decision="cancel"]');
      const firstButton = transferConflictActions.querySelector('button');
      (cancelButton || firstButton || transferConflictDialog).focus();
    }
  });
  transferConflictBackdrop.addEventListener('keydown', trapTransferConflictFocus);
  confirmDialogBackdrop.addEventListener('mousedown', event => {
    if (event.target === confirmDialogBackdrop) {
      event.preventDefault();
      confirmDialogCancelButton.focus();
    }
  });
  confirmDialogBackdrop.addEventListener('keydown', trapConfirmDialogFocus);
  transferQueueCurrent.addEventListener('click', event => {
    const button = event.target && event.target.closest ? event.target.closest('[data-transfer-action]') : null;
    if (!button || button.dataset.transferAction !== 'cancel-current') return;
    vscode.postMessage({ type: 'cancelTransfer', payload: { transferId: button.dataset.transferId || '' } });
  });
  transferQueuePending.addEventListener('click', event => {
    const button = event.target && event.target.closest ? event.target.closest('[data-transfer-action]') : null;
    if (!button || button.dataset.transferAction !== 'remove-pending') return;
    vscode.postMessage({ type: 'removeQueuedTransfer', payload: { transferId: button.dataset.transferId || '' } });
  });
  statusCancelButton.addEventListener('click', () => {
    if (!statusCancelAction) return;
    const action = statusCancelAction;
    statusCancelButton.disabled = true;
    if (action === 'connection') {
      vscode.postMessage({ type: 'cancelConnection' });
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

  privateKeyBrowseButton.addEventListener('click', () => vscode.postMessage({ type: 'pickPrivateKeyPath' }));
  ftpsCaCertificateBrowseButton.addEventListener('click', () => vscode.postMessage({ type: 'pickCaCertificatePath' }));
  ftpsAllowSelfSignedCertificate.addEventListener('change', () => { clearConnectionValidationErrors(); updateFtpsCertificateFields(); });
  password.addEventListener('input', updateConnectionCredentialRevealControls);
  passphrase.addEventListener('input', updateConnectionCredentialRevealControls);
  rememberPassword.addEventListener('change', () => { if (!rememberPassword.checked) { password.placeholder = ''; if (password.value === SAVED_SECRET_MASK) password.value = ''; } updateConnectionCredentialRevealControls(); });
  rememberPassphrase.addEventListener('change', () => { if (!rememberPassphrase.checked) { passphrase.placeholder = ''; if (passphrase.value === SAVED_SECRET_MASK) passphrase.value = ''; } updateConnectionCredentialRevealControls(); });

  currentPath.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const path = currentPath.value;
      exitRemotePathEditMode({ reset: false });
      openPath(path);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      exitRemotePathEditMode({ reset: true });
    }
  });
  document.addEventListener('keydown', event => {
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
    if (event.key === 'Escape' && confirmDialogOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeConfirmDialog(false);
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
    if (event.key === 'Escape' && manageProfilesDialogOpen) {
      if (renameProfileId) {
        event.preventDefault();
        renameProfileId = '';
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
      hideOwnerGroupDialog();
      return;
    }
    if (event.key === 'Escape' && filePropertiesDialogOpen) {
      hideFilePropertiesDialog();
      return;
    }
    if (event.key === 'Escape' && remoteCommandDialogOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key === 'Escape' && transferQueueModalOpen) {
      hideTransferQueueModal();
    }
  });
  filterInput.addEventListener('input', () => {
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
    if (activeConnectionId) vscode.postMessage({ type: 'requestCreateFile', payload: { path: currentPath.value || '/' } });
  });

  contextCreateDirectory.addEventListener('click', () => {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestCreateDirectory', payload: { path: currentPath.value || '/' } });
  });

  function requestContextUpload() {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestUploadEntries', payload: { path: currentPath.value || '/' } });
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
    listDirectory(currentPath.value || '/');
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
    if (!activeConnectionId || !capabilities.canOpenSshTerminal || !capabilities.canRunCommand) return;

    vscode.postMessage({
      type: 'requestOpenSshTerminal',
      payload: {
        connectionId: activeConnectionId,
        workingDirectory
      }
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
    if (remoteCommandRunning) {
      stopRemoteCommandFromDialog(false);
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
  remoteCommandStopAndCloseButton.addEventListener('click', () => stopRemoteCommandFromDialog(true));
  remoteCommandKeepStoppingButton.addEventListener('click', () => {
    remoteCommandStopWarning.classList.remove('visible');
    remoteCommandRunButton.focus();
  });
  remoteCommandForceKillButton.addEventListener('click', () => forceKillRemoteCommandFromDialog());
  remoteCommandBackdrop.addEventListener('mousedown', event => {
    if (event.target === remoteCommandBackdrop) {
      attemptCloseRemoteCommandDialog();
    }
  });
  remoteCommandInput.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      runRemoteCommandFromDialog();
    }
  });
  remoteCommandInput.addEventListener('input', () => {
    if (!remoteCommandRunning) updateRemoteCommandControls();
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

  filePropertiesCloseButton.addEventListener('click', () => {
    hideFilePropertiesDialog();
  });

  filePropertiesCopyPathButton.addEventListener('click', () => {
    if (filePropertiesRemotePath) copyRemotePath(filePropertiesRemotePath);
  });

  filePropertiesBackdrop.addEventListener('mousedown', event => {
    if (event.target === filePropertiesBackdrop) {
      hideFilePropertiesDialog();
    }
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

  checksumsBackdrop.addEventListener('mousedown', event => {
    if (event.target === checksumsBackdrop) {
      hideChecksumsDialog();
    }
  });

  ownerGroupOwnerInput.addEventListener('input', updateOwnerGroupApplyState);
  ownerGroupGroupInput.addEventListener('input', updateOwnerGroupApplyState);
  ownerGroupRecursiveInput.addEventListener('change', updateOwnerGroupApplyState);
  ownerGroupCancelButton.addEventListener('click', hideOwnerGroupDialog);
  ownerGroupApplyButton.addEventListener('click', applyOwnerGroupDialog);
  ownerGroupBackdrop.addEventListener('mousedown', event => {
    if (event.target === ownerGroupBackdrop) {
      hideOwnerGroupDialog();
    }
  });

  manageProfilesCloseButton.addEventListener('click', () => {
    hideManageProfilesDialog();
  });

  manageProfilesImportButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'requestImportConnectionsSettings' });
  });

  manageProfilesExportButton.addEventListener('click', () => {
    showExportBackupDialog();
  });

  exportBackupCancelButton.addEventListener('click', hideExportBackupDialog);
  exportBackupApplyButton.addEventListener('click', applyExportBackupDialog);
  exportBackupBackdrop.addEventListener('mousedown', event => {
    if (event.target === exportBackupBackdrop) {
      hideExportBackupDialog();
    }
  });

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

  importBackupCancelButton.addEventListener('click', hideImportBackupDialog);
  importBackupApplyButton.addEventListener('click', applyImportBackupDialog);
  importBackupBackdrop.addEventListener('mousedown', event => {
    if (event.target === importBackupBackdrop) {
      hideImportBackupDialog();
    }
  });

  for (const input of [importIncludeSettings, importIncludeConnections, importIncludeFavorites, importIncludeUsernames, importRestoreCredentials, importModeMerge, importModeReplace]) {
    input.addEventListener('change', updateImportBackupDialogState);
  }

  importCredentialPassword.addEventListener('input', () => {
    importBackupValidation.textContent = '';
    clearBackupFieldError(importCredentialPassword, importCredentialPasswordError);
  });
  bindTemporaryPasswordReveal(importCredentialPasswordRevealButton, importCredentialPassword);

  manageProfilesBackdrop.addEventListener('mousedown', event => {
    if (event.target === manageProfilesBackdrop) {
      hideManageProfilesDialog();
    }
  });

  manageProfilesFilterInput.addEventListener('input', () => {
    manageProfilesFilterText = String(manageProfilesFilterInput.value || '');
    renderManageProfilesList();
  });

  manageProfilesList.addEventListener('click', handleManageProfilesClick);

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

  permissionBackdrop.addEventListener('click', event => {
    if (event.target === permissionBackdrop) {
      vscode.postMessage({ type: 'cancelPermissions' });
    }
  });

  function isEditableContextTarget(target) {
    return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  document.addEventListener('contextmenu', event => {
    if (isEditableContextTarget(event.target)) return;
    if (event.target instanceof Element && event.target.closest('#entriesTableWrap')) return;
    event.preventDefault();
    hideContextMenu();
  }, true);

  document.addEventListener('click', event => {
    if (!entryContextMenu.contains(event.target)) hideContextMenu();
    if (remotePathBox && !remotePathBox.contains(event.target)) hidePathFavoritesPopover();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (remoteCommandDialogOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (permissionsDialogOpen) {
        vscode.postMessage({ type: 'cancelPermissions' });
        return;
      }
      hideContextMenu();
      hidePathFavoritesPopover();
    }
  });

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

  applyColumnWidths();
  updateSortIndicators();

  for (const input of [profileName, host, port, username, password, privateKeyPath, passphrase, startPath]) {
    input.addEventListener('keydown', event => { if (event.key === 'Enter') connectButton.click(); });
  }

  for (const input of [host, port, username, password, privateKeyPath, ftpsCaCertificatePath]) {
    if (!input) continue;
    input.addEventListener('input', () => clearConnectionFieldInvalid(input));
    input.addEventListener('change', () => clearConnectionFieldInvalid(input));
  }


  function normalizeRemotePathWidth(width) {
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth) || numericWidth <= 0) return null;
    return Math.round(numericWidth);
  }

  function normalizeRemotePathFilterWidth(width) {
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth) || numericWidth <= 0) return null;
    return Math.round(numericWidth);
  }

  function normalizeRemotePathLayoutPreference(state) {
    if (!state || typeof state !== 'object') return null;
    const pathWidth = normalizeRemotePathWidth(state.remotePathWidth);
    if (pathWidth === null) return null;
    const filterWidth = normalizeRemotePathFilterWidth(state.remotePathFilterWidth) || REMOTE_PATH_FILTER_DEFAULT_WIDTH;
    return { pathWidth, filterWidth };
  }

  function getVisiblePathbarChildren() {
    if (!pathbar) return [];
    return Array.from(pathbar.children).filter(child => {
      if (!(child instanceof HTMLElement)) return false;
      if (child === remotePathResizeHandle) return false;
      return window.getComputedStyle(child).display !== 'none';
    });
  }

  function getRemotePathAvailableWidth() {
    if (!pathbar || !remotePathBox || !filterBox) return 0;
    const pathbarRect = pathbar.getBoundingClientRect();
    if (!pathbarRect.width) return 0;

    const visibleChildren = getVisiblePathbarChildren();
    const pathbarStyle = window.getComputedStyle(pathbar);
    const gap = parseFloat(pathbarStyle.columnGap || pathbarStyle.gap || '0') || 0;
    const gapWidth = Math.max(0, visibleChildren.length - 1) * gap;

    let fixedWidth = 0;
    for (const child of visibleChildren) {
      if (child === remotePathBox || child === filterBox) continue;
      fixedWidth += child.getBoundingClientRect().width;
    }

    return Math.max(0, Math.floor(pathbarRect.width - fixedWidth - gapWidth));
  }

  function getRemotePathLayoutLimits(availableWidth = getRemotePathAvailableWidth()) {
    const available = Math.max(0, Math.floor(Number(availableWidth) || 0));
    const pathMin = Math.min(REMOTE_PATH_MIN_WIDTH, Math.max(0, available - REMOTE_PATH_FILTER_MIN_WIDTH));
    const filterMin = Math.min(REMOTE_PATH_FILTER_MIN_WIDTH, Math.max(0, available - pathMin));
    const pathMax = Math.max(pathMin, available - filterMin);
    return { available, pathMin, filterMin, pathMax };
  }


  function createRemotePathLayoutPreference(pathWidth, availableWidth = getRemotePathAvailableWidth()) {
    const limits = getRemotePathLayoutLimits(availableWidth);
    if (!limits.available) return remotePathLayoutPreference;

    const numericWidth = Number(pathWidth);
    const currentPathWidth = remotePathBox ? Math.round(remotePathBox.getBoundingClientRect().width) : limits.pathMin;
    const requestedPathWidth = Number.isFinite(numericWidth) ? Math.round(numericWidth) : currentPathWidth;
    const nextPathWidth = Math.max(limits.pathMin, Math.min(limits.pathMax, requestedPathWidth));
    const nextFilterWidth = Math.max(0, limits.available - nextPathWidth);

    return {
      pathWidth: Math.round(nextPathWidth),
      filterWidth: Math.round(nextFilterWidth)
    };
  }

  function getRemotePathLayoutForAvailableWidth(availableWidth = getRemotePathAvailableWidth()) {
    const limits = getRemotePathLayoutLimits(availableWidth);
    if (!limits.available) return { pathWidth: 0, filterWidth: 0, limits };

    let pathWidth;
    let filterWidth;

    if (remotePathLayoutPreference === null) {
      filterWidth = Math.min(
        REMOTE_PATH_FILTER_DEFAULT_WIDTH,
        Math.max(limits.filterMin, limits.available - limits.pathMin)
      );
      pathWidth = Math.max(0, limits.available - filterWidth);
    } else {
      const preferredPathWidth = Math.max(0, Number(remotePathLayoutPreference.pathWidth) || 0);
      const preferredFilterWidth = Math.max(0, Number(remotePathLayoutPreference.filterWidth) || 0);
      const preferredTotalWidth = Math.max(1, preferredPathWidth + preferredFilterWidth);
      const scaledPathWidth = preferredPathWidth * (limits.available / preferredTotalWidth);
      pathWidth = Math.max(limits.pathMin, Math.min(limits.pathMax, Math.round(scaledPathWidth)));
      filterWidth = Math.max(0, limits.available - pathWidth);
    }

    return {
      pathWidth: Math.round(pathWidth),
      filterWidth: Math.round(filterWidth),
      limits
    };
  }

  function updateRemotePathResizeHandlePosition() {
    if (!pathbar || !remotePathBox || !filterBox || !remotePathResizeHandle) return;
    if (window.getComputedStyle(remotePathResizeHandle).display === 'none') return;

    const pathbarRect = pathbar.getBoundingClientRect();
    const pathRect = remotePathBox.getBoundingClientRect();
    const filterRect = filterBox.getBoundingClientRect();
    if (!pathbarRect.width || !pathRect.width || !filterRect.width) return;

    const midpoint = ((pathRect.right + filterRect.left) / 2) - pathbarRect.left;
    pathbar.style.setProperty('--remote-path-resize-left', Math.round(midpoint) + 'px');
  }

  function applyRemotePathLayout() {
    if (!pathbar) return;

    const availableWidth = getRemotePathAvailableWidth();
    if (!availableWidth) {
      updateRemotePathResizeHandlePosition();
      return;
    }

    const layout = getRemotePathLayoutForAvailableWidth(availableWidth);
    const pathWidth = layout.pathWidth;
    const filterWidth = layout.filterWidth;
    const limits = layout.limits;

    pathbar.style.setProperty('--remote-path-width', pathWidth + 'px');
    pathbar.style.setProperty('--remote-path-filter-width', filterWidth + 'px');

    if (remotePathResizeHandle) {
      remotePathResizeHandle.setAttribute('aria-valuemin', String(REMOTE_PATH_MIN_WIDTH));
      remotePathResizeHandle.setAttribute('aria-valuenow', String(pathWidth));
      remotePathResizeHandle.setAttribute('aria-valuemax', String(Math.max(REMOTE_PATH_MIN_WIDTH, limits.pathMax)));
    }

    updateRemotePathResizeHandlePosition();
    updateRemotePathBreadcrumbOverflow();
  }

  function scheduleRemotePathLayoutUpdate() {
    if (!pathbar) return;
    requestAnimationFrame(() => {
      applyRemotePathLayout();
      updateRemotePathBreadcrumbOverflow();
    });
  }

  function persistRemotePathLayout() {
    const pathState = remotePathLayoutPreference === null
      ? { remotePathWidth: null, remotePathFilterWidth: null }
      : {
        remotePathWidth: remotePathLayoutPreference.pathWidth,
        remotePathFilterWidth: remotePathLayoutPreference.filterWidth
      };
    vscode.setState(Object.assign({}, vscode.getState() || {}, pathState));
    try {
      if (remotePathLayoutPreference === null) {
        localStorage.removeItem(REMOTE_PATH_STORAGE_KEY);
      } else {
        localStorage.setItem(REMOTE_PATH_STORAGE_KEY, JSON.stringify(pathState));
      }
    } catch (_) {
      // Ignore storage failures. vscode.setState still preserves the layout while this webview is alive.
    }
  }

  function resizeRemotePathByStep(delta) {
    if (!remotePathBox) return;
    const availableWidth = getRemotePathAvailableWidth();
    const currentWidth = Math.round(remotePathBox.getBoundingClientRect().width);
    remotePathLayoutPreference = createRemotePathLayoutPreference(currentWidth + delta, availableWidth);
    applyRemotePathLayout();
    persistRemotePathLayout();
  }

  function handleRemotePathResizeKeydown(event) {
    const key = event.key;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      resizeRemotePathByStep(key === 'ArrowRight' ? 20 : -20);
      return;
    }
    if (key === 'Home') {
      event.preventDefault();
      const limits = getRemotePathLayoutLimits();
      remotePathLayoutPreference = createRemotePathLayoutPreference(limits.pathMin, limits.available);
      applyRemotePathLayout();
      persistRemotePathLayout();
      return;
    }
    if (key === 'End') {
      event.preventDefault();
      const limits = getRemotePathLayoutLimits();
      remotePathLayoutPreference = createRemotePathLayoutPreference(limits.pathMax, limits.available);
      applyRemotePathLayout();
      persistRemotePathLayout();
    }
  }

  function startRemotePathResize(event) {
    if (!pathbar || !remotePathBox || !filterBox || !remotePathResizeHandle) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    hideWebviewTooltip();

    const availableWidth = getRemotePathAvailableWidth();
    remotePathResizeState = {
      startX: event.clientX,
      startWidth: Math.round(remotePathBox.getBoundingClientRect().width),
      availableWidth: availableWidth
    };

    document.body.classList.add('resizing-remote-path');
    if (remotePathResizeHandle.setPointerCapture && event.pointerId !== undefined) {
      remotePathResizeHandle.setPointerCapture(event.pointerId);
    }
    window.addEventListener('pointermove', moveRemotePathResize);
    window.addEventListener('pointerup', stopRemotePathResize);
    window.addEventListener('pointercancel', stopRemotePathResize);
  }

  function moveRemotePathResize(event) {
    if (!remotePathResizeState) return;
    const nextWidth = remotePathResizeState.startWidth + event.clientX - remotePathResizeState.startX;
    remotePathLayoutPreference = createRemotePathLayoutPreference(nextWidth, remotePathResizeState.availableWidth);
    applyRemotePathLayout();
  }

  function stopRemotePathResize() {
    if (!remotePathResizeState) return;
    remotePathResizeState = null;
    document.body.classList.remove('resizing-remote-path');
    window.removeEventListener('pointermove', moveRemotePathResize);
    window.removeEventListener('pointerup', stopRemotePathResize);
    window.removeEventListener('pointercancel', stopRemotePathResize);
    persistRemotePathLayout();
  }

  function startRemotePathResetTransition() {
    if (!pathbar) return;
    pathbar.classList.add('remote-path-reset-animating');
    // Force the current layout to be committed before applying the default sizes.
    void pathbar.offsetWidth;
    if (remotePathResetTransitionTimer) clearTimeout(remotePathResetTransitionTimer);
    remotePathResetTransitionTimer = window.setTimeout(() => {
      if (pathbar) pathbar.classList.remove('remote-path-reset-animating');
      remotePathResetTransitionTimer = 0;
    }, 170);
  }

  function resetRemotePathLayout() {
    startRemotePathResetTransition();
    remotePathLayoutPreference = null;
    applyRemotePathLayout();
    persistRemotePathLayout();
  }

  function getToolbarLayoutItems() {
    return [
      remotePathBox,
      filterBox,
      commandActionsSeparator,
      commandActions,
      transferActionsSeparator,
      transferActions,
      sudoToggleSeparator,
      sudoToggleLabel
    ].filter(Boolean);
  }

  function isToolbarLayoutItemVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function prepareToolbarLayoutTransition() {
    if (!pathbar || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

    pathbar.classList.add('toolbar-layout-animating');
    // Commit the current toolbar layout before changing protocol-specific actions.
    void pathbar.offsetWidth;

    const snapshot = new Map();
    for (const element of getToolbarLayoutItems()) {
      if (!isToolbarLayoutItemVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      snapshot.set(element, { left: rect.left, top: rect.top });
    }
    return snapshot;
  }

  function finishToolbarLayoutTransition(snapshot) {
    if (!pathbar || !snapshot) return;

    const animatedElements = [];
    const appearingElements = [];

    for (const element of getToolbarLayoutItems()) {
      if (!isToolbarLayoutItemVisible(element)) continue;

      const start = snapshot.get(element);
      if (!start) {
        appearingElements.push(element);
        continue;
      }

      const rect = element.getBoundingClientRect();
      const dx = start.left - rect.left;
      const dy = start.top - rect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      element.style.transition = 'none';
      element.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
      animatedElements.push(element);
    }

    for (const element of appearingElements) {
      element.style.transition = 'none';
      element.style.opacity = '0';
    }

    void pathbar.offsetWidth;

    for (const element of animatedElements) {
      element.style.transition = 'transform 150ms ease-out';
      element.style.transform = '';
    }

    for (const element of appearingElements) {
      element.style.transition = 'opacity 150ms ease-out';
      element.style.opacity = '';
    }

    if (toolbarLayoutTransitionTimer) clearTimeout(toolbarLayoutTransitionTimer);
    toolbarLayoutTransitionTimer = window.setTimeout(() => {
      for (const element of animatedElements.concat(appearingElements)) {
        element.style.transition = '';
        element.style.transform = '';
        element.style.opacity = '';
      }
      if (pathbar) pathbar.classList.remove('toolbar-layout-animating');
      toolbarLayoutTransitionTimer = 0;
    }, 170);
  }


  function clampConnectionPanelWidth(width) {
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth)) return CONNECTION_PANEL_DEFAULT_WIDTH;
    return Math.max(CONNECTION_PANEL_MIN_WIDTH, Math.min(CONNECTION_PANEL_MAX_WIDTH, Math.round(numericWidth)));
  }

  function normalizeConnectionPanelWidth(width) {
    return clampConnectionPanelWidth(width || CONNECTION_PANEL_DEFAULT_WIDTH);
  }

  function applyConnectionPanelWidth() {
    if (!mainLayout) return;
    mainLayout.style.setProperty('--connection-panel-width', connectionPanelWidth + 'px');
    if (connectionResizeHandle) connectionResizeHandle.setAttribute('aria-valuenow', String(connectionPanelWidth));
  }

  function persistConnectionPanelState() {
    const panelState = {
      connectionPanelCollapsed: connectionPanelCollapsed,
      connectionPanelWidth: connectionPanelWidth
    };

    vscode.setState(Object.assign({}, vscode.getState() || {}, panelState));

    try {
      localStorage.setItem(CONNECTION_PANEL_STORAGE_KEY, JSON.stringify(panelState));
    } catch (_) {
      // Ignore storage failures. vscode.setState still preserves the layout while this webview is alive.
    }
  }

  function startConnectionPanelResize(event) {
    if (!mainLayout || !connectionCard || connectionPanelCollapsed) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    hideWebviewTooltip();

    const rect = connectionCard.getBoundingClientRect();
    connectionPanelResizeState = {
      startX: event.clientX,
      startWidth: clampConnectionPanelWidth(rect.width)
    };

    connectionCard.classList.add('resizing');
    document.body.classList.add('resizing-connection-panel');
    if (connectionResizeHandle && connectionResizeHandle.setPointerCapture && event.pointerId !== undefined) {
      connectionResizeHandle.setPointerCapture(event.pointerId);
    }
    window.addEventListener('pointermove', moveConnectionPanelResize);
    window.addEventListener('pointerup', stopConnectionPanelResize);
    window.addEventListener('pointercancel', stopConnectionPanelResize);
  }

  function moveConnectionPanelResize(event) {
    if (!connectionPanelResizeState) return;
    const rawWidth = connectionPanelResizeState.startWidth + event.clientX - connectionPanelResizeState.startX;

    if (rawWidth <= CONNECTION_PANEL_COLLAPSE_THRESHOLD) {
      if (!connectionPanelCollapsed) {
        connectionPanelCollapsed = true;
        connectionPanelWidth = CONNECTION_PANEL_MIN_WIDTH;
        updateConnectionPanelLayout({ animateCollapse: true });
      }
      return;
    }

    if (connectionPanelCollapsed && rawWidth < CONNECTION_PANEL_EXPAND_THRESHOLD) {
      return;
    }

    const nextWidth = clampConnectionPanelWidth(rawWidth);
    let changed = false;
    let animateCollapse = false;

    if (connectionPanelCollapsed) {
      connectionPanelCollapsed = false;
      changed = true;
      animateCollapse = true;
    }

    if (nextWidth !== connectionPanelWidth) {
      connectionPanelWidth = nextWidth;
      changed = true;
    }

    if (changed) {
      updateConnectionPanelLayout({ animateCollapse: animateCollapse });
    }
  }

  function stopConnectionPanelResize() {
    if (!connectionPanelResizeState) return;
    connectionPanelResizeState = null;
    if (connectionCard) connectionCard.classList.remove('resizing');
    document.body.classList.remove('resizing-connection-panel');
    window.removeEventListener('pointermove', moveConnectionPanelResize);
    window.removeEventListener('pointerup', stopConnectionPanelResize);
    window.removeEventListener('pointercancel', stopConnectionPanelResize);
    persistConnectionPanelState();
  }

  function resetConnectionPanelWidth() {
    if (connectionPanelCollapsed) return;
    connectionPanelWidth = CONNECTION_PANEL_DEFAULT_WIDTH;
    applyConnectionPanelWidth();
    persistConnectionPanelState();
  }

  if (connectionResizeHandle) {
    connectionResizeHandle.addEventListener('pointerdown', startConnectionPanelResize);
    connectionResizeHandle.addEventListener('dblclick', resetConnectionPanelWidth);
  }

  if (remotePathResizeHandle) {
    remotePathResizeHandle.addEventListener('pointerdown', startRemotePathResize);
    remotePathResizeHandle.addEventListener('dblclick', resetRemotePathLayout);
    remotePathResizeHandle.addEventListener('keydown', handleRemotePathResizeKeydown);
  }

  window.addEventListener('resize', () => {
    applyRemotePathLayout();
    updateRemotePathBreadcrumbOverflow();
  });

  if (typeof ResizeObserver !== 'undefined' && pathbar && remotePathBox && filterBox) {
    const remotePathResizeObserver = new ResizeObserver(() => {
      scheduleRemotePathLayoutUpdate();
    });
    remotePathResizeObserver.observe(pathbar);
    remotePathResizeObserver.observe(remotePathBox);
    remotePathResizeObserver.observe(filterBox);
  }

  function updateConnectionRailPosition() {
    if (!mainLayout || !connectionRail || !connectionPanelCollapsed) return;
    const layoutRect = mainLayout.getBoundingClientRect();
    connectionRail.style.top = Math.max(8, Math.round(layoutRect.top + 8)) + 'px';
  }

  function updateConnectionPanelLayout(options = {}) {
    if (!mainLayout) return;
    const animateCollapse = Boolean(options && options.animateCollapse);
    if (animateCollapse) {
      mainLayout.classList.add('connection-collapse-animating');
      if (connectionPanelTransitionTimer) clearTimeout(connectionPanelTransitionTimer);
      connectionPanelTransitionTimer = window.setTimeout(() => {
        if (mainLayout) mainLayout.classList.remove('connection-collapse-animating');
        connectionPanelTransitionTimer = 0;
      }, 170);
    }
    applyConnectionPanelWidth();
    mainLayout.classList.toggle('connection-collapsed', connectionPanelCollapsed);
    if (connectionCard) {
      connectionCard.toggleAttribute('inert', connectionPanelCollapsed);
      connectionCard.setAttribute('aria-hidden', String(connectionPanelCollapsed));
    }
    if (connectionRail) {
      connectionRail.toggleAttribute('inert', !connectionPanelCollapsed);
      connectionRail.setAttribute('aria-hidden', String(!connectionPanelCollapsed));
    }
    if (hideConnectionPanelButton) {
      hideConnectionPanelButton.setAttribute('aria-expanded', String(!connectionPanelCollapsed));
      hideConnectionPanelButton.tabIndex = connectionPanelCollapsed ? -1 : 0;
    }
    if (showConnectionPanelButton) {
      showConnectionPanelButton.setAttribute('aria-expanded', String(!connectionPanelCollapsed));
      showConnectionPanelButton.tabIndex = connectionPanelCollapsed ? 0 : -1;
    }
    updateConnectionRailPosition();
  }

  function setConnectionPanelCollapsed(collapsed) {
    connectionPanelCollapsed = Boolean(collapsed);
    updateConnectionPanelLayout();
    hideWebviewTooltip();
    persistConnectionPanelState();
  }

  function renderProfiles(preferredId) {
    const previousId = preferredId || selectedProfileId || '';
    profileSelect.innerHTML = '<option value="">New unsaved connection</option>';

    for (const profile of profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      profileSelect.appendChild(option);
    }

    const exists = profiles.some(profile => profile.id === previousId);
    const nextId = exists ? previousId : '';
    selectProfile(nextId, { preserveStatus: true });
    renderProfileDropdown();
    renderManageProfilesList();
    setControls();
  }

  function selectProfile(profileId, options = {}) {
    selectedProfileId = profileId || '';
    profileSelect.value = selectedProfileId;
    hideProfileDropdown();

    const profile = selectedProfileId ? profiles.find(item => item.id === selectedProfileId) : undefined;
    if (profile) {
      fillForm(profile);
    } else {
      clearForm();
      if (!options.preserveStatus) setStatus('New quick connection.');
    }

    updateProfileDropdownLabel();
    renderProfileDropdown();
    setControls();
  }

  function updateProfileDropdownLabel() {
    const profile = selectedProfileId ? profiles.find(item => item.id === selectedProfileId) : undefined;
    profileDropdownLabel.textContent = profile ? profile.name : 'New unsaved connection';
    profileDropdownButton.title = profile ? formatProfileTarget(profile) : 'Use the form below without saving first';
  }

  function normalizeConnectionFilter(value) {
    return String(value || '').trim().toLowerCase();
  }

  function profileMatchesFilter(profile, filter) {
    const normalized = normalizeConnectionFilter(filter);
    if (!normalized) return true;

    const haystack = [
      profile && profile.name,
      profile && profile.host,
      profile && profile.port,
      profile && profile.username,
      profile && getConnectionTypeLabel(profile.connectionType),
      profile ? formatProfileTarget(profile) : ''
    ].map(value => String(value || '').toLowerCase()).join(' ');

    return haystack.includes(normalized);
  }

  function renderProfileDropdown(options = {}) {
    if (!profileDropdownMenu) return;
    const filterTextBeforeRender = profileDropdownFilterText;
    profileDropdownMenu.innerHTML = '';

    const filterWrap = document.createElement('div');
    filterWrap.className = 'profile-dropdown-filter';
    const filterInput = document.createElement('input');
    filterInput.id = 'profileDropdownFilterInput';
    filterInput.type = 'text';
    filterInput.placeholder = 'Filter connections...';
    filterInput.setAttribute('aria-label', 'Filter Saved Connections');
    filterInput.setAttribute('autocomplete', 'off');
    filterInput.value = filterTextBeforeRender;
    filterWrap.appendChild(filterInput);
    profileDropdownMenu.appendChild(filterWrap);

    const quick = buildProfileDropdownItem('', 'New unsaved connection', 'Use the form below without saving first');
    profileDropdownMenu.appendChild(quick);

    if (profiles.length) {
      const separator = document.createElement('div');
      separator.className = 'profile-dropdown-separator';
      profileDropdownMenu.appendChild(separator);
    }

    const filteredProfiles = profiles.filter(profile => profileMatchesFilter(profile, filterTextBeforeRender));
    if (profiles.length && !filteredProfiles.length) {
      const empty = document.createElement('div');
      empty.className = 'profile-dropdown-empty';
      empty.textContent = 'No saved connections found.';
      profileDropdownMenu.appendChild(empty);
    } else {
      for (const profile of filteredProfiles) {
        profileDropdownMenu.appendChild(buildProfileDropdownItem(profile.id, profile.name, formatProfileTarget(profile)));
      }
    }

    updateProfileDropdownLabel();

    if (options.focusFilter) {
      setTimeout(() => {
        const nextFilterInput = document.getElementById('profileDropdownFilterInput');
        if (!nextFilterInput) return;
        nextFilterInput.focus();
        const valueLength = String(nextFilterInput.value || '').length;
        try { nextFilterInput.setSelectionRange(valueLength, valueLength); } catch (error) { /* ignore */ }
      }, 0);
    }
  }

  function buildProfileDropdownItem(id, name, meta) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-dropdown-item' + (String(id || '') === selectedProfileId ? ' selected' : '');
    button.dataset.profileId = id || '';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(String(id || '') === selectedProfileId));

    const nameElement = document.createElement('span');
    nameElement.className = 'profile-dropdown-name';
    nameElement.textContent = name || 'Unnamed connection';
    button.appendChild(nameElement);

    if (meta) {
      const metaElement = document.createElement('span');
      metaElement.className = 'profile-dropdown-meta';
      metaElement.textContent = meta;
      button.appendChild(metaElement);
    }

    return button;
  }

  function toggleProfileDropdown() {
    if (busy || !profileDropdownButton) return;
    if (profileDropdownOpen) {
      hideProfileDropdown();
      return;
    }

    hideConnectionTypeDropdown();
    hideAuthDropdown();
    profileDropdownOpen = true;
    profileDropdownFilterText = '';
    profileDropdownButton.setAttribute('aria-expanded', 'true');
    profileDropdownButton.closest('.profile-picker').classList.add('open');
    renderProfileDropdown({ focusFilter: true });
  }

  function hideProfileDropdown() {
    profileDropdownOpen = false;
    profileDropdownFilterText = '';
    if (profileDropdownButton) profileDropdownButton.setAttribute('aria-expanded', 'false');
    const picker = profileDropdownButton ? profileDropdownButton.closest('.profile-picker') : null;
    if (picker) picker.classList.remove('open');
  }

  function renderSessionTabs() {
    if (!sessions.length) {
      sessionTabs.innerHTML = '<span class="session-empty">No active connections.</span>';
      return;
    }

    sessionTabs.innerHTML = '';

    for (const session of sessions) {
      const tab = document.createElement('button');
      tab.className = 'session-tab has-tooltip tooltip-above' + (session.id === activeConnectionId ? ' active' : '');
      tab.dataset.tooltip = formatSessionTooltipTarget(session);
      tab.innerHTML = '<span class="session-name">' + escapeHtml(session.name) + '</span><span class="session-close has-tooltip tooltip-above" data-tooltip="Disconnect">×</span>';
      tab.addEventListener('click', () => {
        if (session.id === activeConnectionId) {
          syncConnectionFormWithActiveSession({ preserveStatus: true });
          return;
        }
        setBusy(true, 'Switching to ' + session.name + '...');
        vscode.postMessage({ type: 'switchSession', payload: { connectionId: session.id } });
      });

      const close = tab.querySelector('.session-close');
      close.addEventListener('click', event => {
        event.stopPropagation();
        connectionButtonState = 'disconnecting';
        setBusy(true, 'Disconnecting...');
        vscode.postMessage({ type: 'disconnect', payload: { connectionId: session.id } });
      });

      sessionTabs.appendChild(tab);
    }
  }

  function updateSudoToggle() {
    const active = getActiveSession();
    const capabilities = getActiveRemoteCapabilities();
    const enabled = Boolean(capabilities.canUseSudo && active && active.sudoModeEnabled);
    const isRootConnection = Boolean(capabilities.canUseSudo && active && String(active.username || '').trim().toLowerCase() === 'root');
    const isPrivilegedSession = enabled || isRootConnection;

    sudoToggle.checked = enabled;
    sudoToggleState.textContent = 'Sudo';
    sudoToggleLabel.classList.toggle('enabled', enabled);
    entriesTableWrap.classList.toggle('privileged-session', isPrivilegedSession);
    sudoToggleLabel.dataset.tooltip = !active
      ? 'Connect to a Host to Enable Sudo Mode'
      : enabled
        ? 'Disable Sudo Mode and Forget the Sudo Password'
        : 'Enable Sudo Mode for This Connection';
  }

  function updateActiveSessionUi() {
    const active = getActiveSession();
    if (!active) {
      browserSubtitle.textContent = sessions.length ? 'Select an open connection tab to browse remote files.' : 'Connect to a host to list remote files.';
      currentPath.value = '';
      updateRemotePathBreadcrumb();
      updateRemotePathActionButton();
      updateSudoToggle();
      return;
    }

    browserSubtitle.textContent = formatConnectionLabel(active.name, formatSessionTarget(active));
    if (active.currentPath) {
      currentPath.value = active.currentPath;
    }
    updateRemotePathBreadcrumb();
    updateRemotePathActionButton();
    updateSudoToggle();
  }

  function updateActiveSessionPath(path) {
    const active = getActiveSession();
    if (!active) return;
    active.currentPath = normalizeUiRemotePath(path || '/');
    updateRemotePathActionButton();
    renderSessionTabs();
  }

  function enterRemotePathEditMode(options = {}) {
    if (!activeConnectionId || busy || currentPath.disabled) return;
    hideRemotePathDropdown();
    remotePathEditing = true;
    remotePathBox.classList.remove('path-breadcrumb-mode');
    remotePathBox.classList.add('path-edit-mode');
    if (document.activeElement !== currentPath) currentPath.focus();
    if (options.select) currentPath.select();
  }

  function exitRemotePathEditMode(options = {}) {
    if (options.reset) {
      const active = getActiveSession();
      currentPath.value = active && active.currentPath ? active.currentPath : (activeConnectionId ? '/' : '');
    }

    remotePathEditing = false;
    remotePathBox.classList.remove('path-edit-mode');
    updateRemotePathBreadcrumb();
    updateRemotePathActionButton();

    if (!options.keepFocus && document.activeElement === currentPath) {
      currentPath.blur();
    }
  }

  function updateRemotePathBreadcrumbOverflow() {
    if (!remotePathBreadcrumb) return;

    remotePathBreadcrumb.classList.remove('is-truncated');
    remotePathBreadcrumb.scrollLeft = 0;

    requestAnimationFrame(() => {
      if (!remotePathBreadcrumb || !remotePathBox.classList.contains('path-breadcrumb-mode')) return;

      const isOverflowing = remotePathBreadcrumb.scrollWidth > remotePathBreadcrumb.clientWidth + 1;
      remotePathBreadcrumb.classList.toggle('is-truncated', isOverflowing);

      if (isOverflowing) {
        requestAnimationFrame(() => {
          if (!remotePathBreadcrumb) return;
          remotePathBreadcrumb.scrollLeft = remotePathBreadcrumb.scrollWidth;
        });
      }
    });
  }

  function updateRemotePathBreadcrumb() {
    if (!remotePathBreadcrumb) return;

    const hasActiveSession = Boolean(activeConnectionId);
    const normalizedPath = normalizeUiRemotePath(currentPath.value || '/');
    remotePathBreadcrumb.innerHTML = '';
    remotePathBreadcrumb.classList.remove('is-truncated');
    remotePathBox.classList.toggle('path-breadcrumb-mode', hasActiveSession && !remotePathEditing);
    remotePathBox.classList.toggle('path-edit-mode', hasActiveSession && remotePathEditing);

    if (!hasActiveSession) {
      return;
    }

    const parts = getBreadcrumbParts(normalizedPath);

    parts.forEach((part, index) => {
      if (index > 0) {
        const parentPart = parts[index - 1];
        const separator = document.createElement('button');
        separator.type = 'button';
        separator.className = 'remote-path-breadcrumb-separator' + (breadcrumbDropdownState.open && breadcrumbDropdownState.path === parentPart.path ? ' open' : '');
        const separatorIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        separatorIcon.classList.add('remote-path-breadcrumb-separator-icon');
        separatorIcon.setAttribute('viewBox', '0 0 16 16');
        separatorIcon.setAttribute('aria-hidden', 'true');
        separatorIcon.setAttribute('focusable', 'false');
        const separatorPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        separatorPath.setAttribute('d', 'M6 4l4 4-4 4');
        separatorIcon.appendChild(separatorPath);
        separator.appendChild(separatorIcon);
        separator.dataset.breadcrumbToggle = parentPart.path;
        separator.title = 'Show folders under ' + parentPart.path;
        separator.setAttribute('aria-label', 'Show folders under ' + parentPart.path);
        remotePathBreadcrumb.appendChild(separator);
      }

      const segment = document.createElement('span');
      segment.className = 'remote-path-breadcrumb-segment';
      segment.dataset.breadcrumbSegmentPath = part.path;

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = part.label;
      button.dataset.breadcrumbPath = part.path;
      button.title = part.path;
      button.className = 'breadcrumb-part-button' + (part.path === normalizedPath ? ' current' : '');
      button.setAttribute('aria-current', part.path === normalizedPath ? 'page' : 'false');
      segment.appendChild(button);

      remotePathBreadcrumb.appendChild(segment);
    });

    updateRemotePathBreadcrumbOverflow();
  }

  function openRemotePathDropdown(path, anchor) {
    if (!remotePathDropdown || !activeConnectionId) return;

    const normalizedPath = normalizeUiRemotePath(path || '/');
    if (breadcrumbDropdownState.open && breadcrumbDropdownState.path === normalizedPath) {
      hideRemotePathDropdown();
      return;
    }

    const requestId = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    breadcrumbDropdownState = { open: true, path: normalizedPath, requestId, anchorPath: normalizedPath };
    updateRemotePathBreadcrumb();
    positionRemotePathDropdown(anchor);
    renderRemotePathDropdown('loading', normalizedPath);

    vscode.postMessage({
      type: 'requestBreadcrumbDirectories',
      payload: { path: normalizedPath, requestId }
    });
  }

  function hideRemotePathDropdown() {
    if (!remotePathDropdown) return;
    if (!breadcrumbDropdownState.open && !remotePathDropdown.classList.contains('visible')) return;
    breadcrumbDropdownState = { open: false, path: '', requestId: '', anchorPath: '' };
    remotePathDropdown.classList.remove('visible');
    remotePathDropdown.setAttribute('aria-hidden', 'true');
    remotePathDropdown.innerHTML = '';
    updateRemotePathBreadcrumb();
  }

  function positionRemotePathDropdown(anchor) {
    if (!remotePathDropdown || !remotePathBox || !anchor) return;
    const boxRect = remotePathBox.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const dropdownWidth = Math.min(380, Math.max(260, window.innerWidth - 56));
    let left = Math.round(anchorRect.left - boxRect.left);
    left = Math.max(0, Math.min(left, Math.max(0, boxRect.width - dropdownWidth)));
    remotePathDropdown.style.width = dropdownWidth + 'px';
    remotePathDropdown.style.left = left + 'px';
  }

  function renderRemotePathDropdown(state, path, directories, errorMessage) {
    if (!remotePathDropdown) return;

    remotePathDropdown.innerHTML = '';
    remotePathDropdown.classList.add('visible');
    remotePathDropdown.setAttribute('aria-hidden', 'false');

    const title = document.createElement('div');
    title.className = 'remote-path-dropdown-title';
    title.textContent = path || '/';
    title.title = path || '/';
    remotePathDropdown.appendChild(title);

    if (state === 'loading') {
      const loading = document.createElement('div');
      loading.className = 'remote-path-dropdown-state';
      loading.textContent = 'Loading directories...';
      remotePathDropdown.appendChild(loading);
      return;
    }

    if (state === 'error') {
      const error = document.createElement('div');
      error.className = 'remote-path-dropdown-state error';
      error.textContent = errorMessage || 'Could not list directories.';
      remotePathDropdown.appendChild(error);
      return;
    }

    const items = Array.isArray(directories) ? directories : [];
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'remote-path-dropdown-state';
      empty.textContent = 'No directories found.';
      remotePathDropdown.appendChild(empty);
      return;
    }

    items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'remote-path-dropdown-item';
      button.dataset.dropdownDirectoryPath = item.path || '';
      button.title = item.path || item.name || '';

      const name = document.createElement('span');
      name.className = 'remote-path-dropdown-name';
      name.textContent = item.name || item.path || '';
      button.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'remote-path-dropdown-meta';
      const ownerGroup = [item.owner, item.group].filter(Boolean).join(':');
      meta.textContent = [item.permissions, ownerGroup].filter(Boolean).join(' · ');
      button.appendChild(meta);

      remotePathDropdown.appendChild(button);
    });
  }

  function handleBreadcrumbDirectoriesListed(payload) {
    if (!payload || payload.connectionId !== activeConnectionId) return;
    if (!breadcrumbDropdownState.open || payload.requestId !== breadcrumbDropdownState.requestId) return;

    const path = normalizeUiRemotePath(payload.path || '/');
    if (path !== breadcrumbDropdownState.path) return;

    if (payload.error) {
      renderRemotePathDropdown('error', path, [], payload.error);
      return;
    }

    renderRemotePathDropdown('ready', path, payload.directories || []);
  }

  function getBreadcrumbParts(path) {
    const normalizedPath = normalizeUiRemotePath(path || '/');
    if (normalizedPath === '/') {
      return [{ label: '/', path: '/' }];
    }

    const segments = normalizedPath.split('/').filter(Boolean);
    const parts = [{ label: '/', path: '/' }];
    let current = '';

    for (const segment of segments) {
      current += '/' + segment;
      parts.push({ label: segment, path: current });
    }

    return parts;
  }

  function getConnectedSessionForCurrentForm() {
    if (selectedProfileId) {
      return sessions.find(item => item.id === selectedProfileId);
    }

    const hostValue = String(host.value || '').trim();
    const portValue = Number(port.value || 22);
    const usernameValue = String(username.value || '').trim();
    const authTypeValue = String(authType.value || 'password');
    const connectionTypeValue = normalizeConnectionTypeValue(connectionType.value);

    if (!hostValue || !usernameValue || !Number.isFinite(portValue)) {
      return undefined;
    }

    return sessions.find(item =>
      String(item.host || '').trim() === hostValue &&
      normalizeConnectionTypeValue(item.connectionType) === connectionTypeValue &&
      Number(item.port || getDefaultPortForConnectionType(item.connectionType)) === portValue &&
      String(item.username || '').trim() === usernameValue &&
      String(item.authType || 'password') === authTypeValue
    );
  }

  function getActiveSession() {
    return sessions.find(item => item.id === activeConnectionId);
  }

  function syncConnectionFormWithActiveSession(options = {}) {
    const active = getActiveSession();
    if (!active || connectionButtonState === 'connecting' || connectionButtonState === 'disconnecting') return;

    const profile = profiles.find(item => item.id === active.id);
    if (profile) {
      if (selectedProfileId !== profile.id || lastSyncedActiveConnectionId !== active.id) {
        selectProfile(profile.id, { preserveStatus: true });
      }
      lastSyncedActiveConnectionId = active.id;
      return;
    }

    selectedProfileId = '';
    profileSelect.value = '';
    hideProfileDropdown();
    fillFormFromSession(active);
    updateProfileDropdownLabel();
    renderProfileDropdown();
    lastSyncedActiveConnectionId = active.id;
    if (!options.preserveStatus) setStatus('Active connection loaded.');
    setControls();
  }

  function fillFormFromSession(session) {
    clearConnectionValidationErrors();
    profileName.value = session.name || '';
    host.value = session.host || '';
    connectionType.value = normalizeConnectionTypeValue(session.connectionType);
    port.value = String(session.port || getDefaultPortForConnectionType(connectionType.value));
    username.value = session.username || '';
    authType.value = isSftpFormConnection() ? (session.authType || 'password') : 'password';
    password.value = '';
    rememberPassword.checked = false;
    password.placeholder = '';
    privateKeyPath.value = session.privateKeyPath || '';
    passphrase.value = '';
    rememberPassphrase.checked = false;
    passphrase.placeholder = '';
    startPath.value = session.startPath || '';
    keepAlive.checked = session.keepAlive !== false;
    ftpsAllowSelfSignedCertificate.checked = Boolean(session.ftpsAllowSelfSignedCertificate);
    ftpsCaCertificatePath.value = session.ftpsCaCertificatePath || '';
    updateCredentialState();
    updateConnectionTypeDropdown();
    updateAuthFields();
  }

  function getConnectionDetailControls() {
    return [
      host,
      port,
      connectionType,
      connectionTypeDropdownButton,
      ftpsAllowSelfSignedCertificate,
      ftpsCaCertificatePath,
      ftpsCaCertificateBrowseButton,
      username,
      authType,
      authDropdownButton,
      password,
      passwordRevealButton,
      rememberPassword,
      privateKeyPath,
      privateKeyBrowseButton,
      passphrase,
      passphraseRevealButton,
      rememberPassphrase,
      startPath,
      keepAlive
    ].filter(Boolean);
  }

  function isConnectionTransitionBusy() {
    return connectionButtonState === 'connecting' || connectionButtonState === 'disconnecting';
  }


  function normalizeConnectionTypeValue(value) {
    const normalized = String(value || 'sftp').trim().toLowerCase();
    return normalized === 'ftp' || normalized === 'ftps' ? normalized : 'sftp';
  }

  function getDefaultPortForConnectionType(value) {
    return normalizeConnectionTypeValue(value) === 'sftp' ? 22 : 21;
  }

  function getConnectionTypeLabel(value) {
    const normalized = normalizeConnectionTypeValue(value);
    if (normalized === 'ftps') return 'FTPS';
    if (normalized === 'ftp') return 'FTP';
    return 'SFTP';
  }

  function isSftpFormConnection() {
    return normalizeConnectionTypeValue(connectionType.value) === 'sftp';
  }

  function getBrowserConnectionType() {
    const active = getActiveSession();
    return normalizeConnectionTypeValue(active ? active.connectionType : connectionType.value);
  }

  function getActiveRemoteCapabilities() {
    const isSftp = getBrowserConnectionType() === 'sftp';
    return {
      canUseSudo: isSftp,
      canRunCommand: isSftp,
      canOpenSshTerminal: isSftp,
      canChangeOwnerGroup: isSftp,
      canChangePermissions: isSftp,
      canChangePermissionsRecursively: isSftp,
      canCalculateServerChecksums: isSftp,
      canCreateArchive: isSftp
    };
  }

  function updateConnectionTypeDropdown() {
    const value = normalizeConnectionTypeValue(connectionType.value);
    connectionType.value = value;
    if (connectionTypeDropdownLabel) connectionTypeDropdownLabel.textContent = getConnectionTypeLabel(value);
    updateFtpsCertificateFields();
    if (!connectionTypeDropdownMenu) return;

    const items = Array.from(connectionTypeDropdownMenu.querySelectorAll('[data-connection-type]'));
    items.forEach(item => {
      const selected = item.dataset.connectionType === value;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function showConnectionTypeDropdown() {
    if (!connectionTypeDropdownButton || !connectionTypeDropdownMenu || connectionTypeDropdownButton.disabled) return;
    hideProfileDropdown();
    hideAuthDropdown();
    connectionTypeDropdownOpen = true;
    const picker = connectionTypeDropdownButton.closest('.connection-type-picker');
    if (picker) picker.classList.add('open');
    connectionTypeDropdownButton.setAttribute('aria-expanded', 'true');
    updateConnectionTypeDropdown();
  }

  function hideConnectionTypeDropdown() {
    if (!connectionTypeDropdownButton) return;
    connectionTypeDropdownOpen = false;
    const picker = connectionTypeDropdownButton.closest('.connection-type-picker');
    if (picker) picker.classList.remove('open');
    connectionTypeDropdownButton.setAttribute('aria-expanded', 'false');
  }

  function toggleConnectionTypeDropdown() {
    if (connectionTypeDropdownOpen) {
      hideConnectionTypeDropdown();
    } else {
      showConnectionTypeDropdown();
    }
  }

  function selectConnectionType(value) {
    clearConnectionValidationErrors();
    const previous = normalizeConnectionTypeValue(connectionType.value);
    const next = normalizeConnectionTypeValue(value);
    connectionType.value = next;

    const currentPort = String(port.value || '').trim();
    if (!currentPort || currentPort === String(getDefaultPortForConnectionType(previous))) {
      port.value = String(getDefaultPortForConnectionType(next));
    }

    if (next !== 'sftp') {
      authType.value = 'password';
    }

    updateConnectionTypeDropdown();
    updateAuthFields();
    setControls();
  }


  function updateFtpsCertificateFields(locked) {
    const isFtps = normalizeConnectionTypeValue(connectionType.value) === 'ftps';
    const isLocked = Boolean(locked);
    const allowSelfSigned = Boolean(ftpsAllowSelfSignedCertificate && ftpsAllowSelfSignedCertificate.checked);

    if (ftpsCertificateBlock) {
      ftpsCertificateBlock.classList.toggle('visible', isFtps);
    }

    if (ftpsCaCertificateBlock) {
      ftpsCaCertificateBlock.style.display = isFtps && !allowSelfSigned ? '' : 'none';
    }

    if (ftpsAllowSelfSignedCertificate) {
      ftpsAllowSelfSignedCertificate.disabled = isLocked || !isFtps;
    }

    if (ftpsCaCertificatePath) {
      ftpsCaCertificatePath.disabled = isLocked || !isFtps || allowSelfSigned;
    }

    if (ftpsCaCertificateBrowseButton) {
      ftpsCaCertificateBrowseButton.disabled = isLocked || !isFtps || allowSelfSigned;
    }
  }


  function getAuthTypeLabel(value) {
    return value === 'privateKey' ? 'Private key' : 'Password';
  }

  function updateAuthDropdown() {
    const value = String(authType.value || 'password');
    if (authDropdownLabel) authDropdownLabel.textContent = getAuthTypeLabel(value);
    if (!authDropdownMenu) return;

    const items = Array.from(authDropdownMenu.querySelectorAll('[data-auth-type]'));
    items.forEach(item => {
      const selected = item.dataset.authType === value;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function showAuthDropdown() {
    if (!authDropdownButton || !authDropdownMenu || authDropdownButton.disabled) return;
    hideProfileDropdown();
    hideConnectionTypeDropdown();
    authDropdownOpen = true;
    const picker = authDropdownButton.closest('.auth-picker');
    if (picker) picker.classList.add('open');
    authDropdownButton.setAttribute('aria-expanded', 'true');
    updateAuthDropdown();
  }

  function hideAuthDropdown() {
    if (!authDropdownButton) return;
    authDropdownOpen = false;
    const picker = authDropdownButton.closest('.auth-picker');
    if (picker) picker.classList.remove('open');
    authDropdownButton.setAttribute('aria-expanded', 'false');
  }

  function toggleAuthDropdown() {
    if (authDropdownOpen) {
      hideAuthDropdown();
    } else {
      showAuthDropdown();
    }
  }

  function selectAuthType(value) {
    clearConnectionValidationErrors();
    authType.value = value === 'privateKey' ? 'privateKey' : 'password';
    updateAuthFields();
    updateAuthDropdown();
    setControls();
  }

  function formatProfileTarget(profile) {
    const userPart = profile.username ? profile.username + '@' : '';
    return getConnectionTypeLabel(profile.connectionType) + ' ' + userPart + profile.host + ':' + profile.port;
  }

  function formatSessionTarget(session) {
    const userPart = session.username ? session.username + '@' : '';
    return userPart + session.host + ':' + session.port;
  }

  function formatSessionTooltipTarget(session) {
    const userPart = session.username ? session.username + '@' : '';
    return getConnectionTypeLabel(session.connectionType) + ' ' + userPart + session.host;
  }

  function formatConnectionLabel(name, target) {
    return '[' + name + '] ' + target;
  }

  function formatCredentialState(profile) {
    if (profile.authType === 'privateKey') {
      return profile.hasSavedPassphrase ? 'passphrase saved' : 'passphrase not saved';
    }

    return profile.hasSavedPassword ? 'password saved' : 'password not saved';
  }

  function updateCredentialState(profile) {
    const hasPassword = Boolean(profile && profile.hasSavedPassword);
    const hasPassphrase = Boolean(profile && profile.hasSavedPassphrase);

    passwordSecretState.textContent = hasPassword
      ? 'Password saved in VS Code SecretStorage.'
      : 'Password not saved.';
    passwordSecretState.className = 'credential-state ' + (hasPassword ? 'saved' : 'not-saved');

    passphraseSecretState.textContent = hasPassphrase
      ? 'Passphrase saved in VS Code SecretStorage.'
      : 'Passphrase not saved.';
    passphraseSecretState.className = 'credential-state ' + (hasPassphrase ? 'saved' : 'not-saved');
    updateConnectionCredentialRevealControls();
  }

  function fillForm(profile) {
    clearConnectionValidationErrors();
    profileName.value = profile.name || '';
    host.value = profile.host || '';
    connectionType.value = normalizeConnectionTypeValue(profile.connectionType);
    port.value = String(profile.port || getDefaultPortForConnectionType(connectionType.value));
    username.value = profile.username || '';
    authType.value = isSftpFormConnection() ? (profile.authType || 'password') : 'password';
    password.value = profile.hasSavedPassword ? SAVED_SECRET_MASK : '';
    rememberPassword.checked = Boolean(profile.hasSavedPassword);
    privateKeyPath.value = profile.privateKeyPath || '';
    passphrase.value = profile.hasSavedPassphrase ? SAVED_SECRET_MASK : '';
    rememberPassphrase.checked = Boolean(profile.hasSavedPassphrase);
    startPath.value = profile.startPath || '';
    keepAlive.checked = profile.keepAlive !== false;
    ftpsAllowSelfSignedCertificate.checked = Boolean(profile.ftpsAllowSelfSignedCertificate);
    ftpsCaCertificatePath.value = profile.ftpsCaCertificatePath || '';
    password.placeholder = profile.hasSavedPassword ? 'Saved password' : '';
    passphrase.placeholder = profile.hasSavedPassphrase ? 'Saved passphrase' : '';
    updateCredentialState(profile);
    updateConnectionTypeDropdown();
    updateAuthFields();
    setControls();
  }

  function clearForm() {
    clearConnectionValidationErrors();
    profileName.value = '';
    host.value = '';
    connectionType.value = 'sftp';
    port.value = '22';
    username.value = '';
    authType.value = 'password';
    password.value = '';
    rememberPassword.checked = false;
    password.placeholder = '';
    privateKeyPath.value = '';
    passphrase.value = '';
    rememberPassphrase.checked = false;
    passphrase.placeholder = '';
    startPath.value = '';
    keepAlive.checked = true;
    ftpsAllowSelfSignedCertificate.checked = false;
    ftpsCaCertificatePath.value = '';
    updateCredentialState();
    updateConnectionTypeDropdown();
    updateAuthFields();
    setControls();
  }





  function setTemporaryPasswordVisible(input, visible) {
    if (!input || input.disabled) return;
    input.type = visible ? 'text' : 'password';
  }

  function hideTemporaryPassword(input) {
    if (!input) return;
    input.type = 'password';
  }

  function bindTemporaryPasswordReveal(button, input) {
    if (!button || !input) return;

    const show = event => {
      if (button.disabled || input.disabled) return;
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      setTemporaryPasswordVisible(input, true);
    };

    const hide = event => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      hideTemporaryPassword(input);
    };

    bindHoldButton(button, show, hide);
  }

  function hasUserTypedCredentialValue(input) {
    return Boolean(input && input.value && input.value !== SAVED_SECRET_MASK);
  }

  function updateConnectionCredentialRevealButton(button, input) {
    if (!button || !input) return;

    const canReveal = hasUserTypedCredentialValue(input) && !input.disabled;
    button.disabled = !canReveal;
    button.style.display = canReveal ? '' : 'none';

    const wrapper = input.closest ? input.closest('.input-with-button') : input.parentElement;
    if (wrapper) {
      wrapper.classList.toggle('reveal-hidden', !canReveal);
    }

    if (!canReveal) {
      hideTemporaryPassword(input);
    }
  }

  function updateConnectionCredentialRevealControls() {
    updateConnectionCredentialRevealButton(passwordRevealButton, password);
    updateConnectionCredentialRevealButton(passphraseRevealButton, passphrase);
  }

  function bindHoldButton(button, show, hide) {
    button.addEventListener('mousedown', show);
    button.addEventListener('mouseup', hide);
    button.addEventListener('mouseleave', hide);
    button.addEventListener('blur', hide);
    button.addEventListener('touchstart', show, { passive: false });
    button.addEventListener('touchend', hide);
    button.addEventListener('touchcancel', hide);
    button.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') show(event);
    });
    button.addEventListener('keyup', event => {
      if (event.key === ' ' || event.key === 'Enter') hide(event);
    });
    button.addEventListener('click', event => event.preventDefault());
  }

  function setBackupFieldError(input, element, message) {
    if (!input) return;
    const hasError = Boolean(String(message || '').trim());
    if (element) {
      element.textContent = '';
      element.classList.remove('visible');
    }
    input.classList.toggle('backup-input-invalid', hasError);
    if (hasError) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  function clearBackupFieldError(input, element) {
    setBackupFieldError(input, element, '');
  }

  function clearExportBackupFieldErrors() {
    clearBackupFieldError(exportCredentialPassword, exportCredentialPasswordError);
    clearBackupFieldError(exportCredentialConfirmPassword, exportCredentialConfirmPasswordError);
  }

  function clearImportBackupFieldErrors() {
    clearBackupFieldError(importCredentialPassword, importCredentialPasswordError);
  }

  function showBackupResult(element, message, isError) {
    if (!element) return;
    const text = String(message || '').trim();
    element.textContent = text;
    element.classList.toggle('visible', Boolean(text));
    element.classList.toggle('error', Boolean(isError));
    element.classList.toggle('success', Boolean(text) && !isError);
  }

  function clearBackupResult(element) {
    showBackupResult(element, '', false);
  }

  function showExportBackupDialog() {
    exportBackupDialogOpen = true;
    exportIncludeSettings.checked = true;
    exportIncludeConnections.checked = true;
    exportIncludeFavorites.checked = true;
    exportIncludeUsernames.checked = true;
    exportIncludeCredentials.checked = false;
    exportCredentialPassword.value = '';
    exportCredentialConfirmPassword.value = '';
    exportBackupValidation.textContent = '';
    clearExportBackupFieldErrors();
    clearBackupResult(exportBackupResult);
    updateExportBackupDialogState();
    exportBackupBackdrop.classList.add('visible');
    exportBackupBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => exportIncludeSettings.focus(), 0);
  }

  function hideExportBackupDialog() {
    exportBackupDialogOpen = false;
    exportBackupBackdrop.classList.remove('visible');
    exportBackupBackdrop.setAttribute('aria-hidden', 'true');
    exportCredentialPassword.value = '';
    exportCredentialConfirmPassword.value = '';
    hideTemporaryPassword(exportCredentialPassword);
    hideTemporaryPassword(exportCredentialConfirmPassword);
    exportBackupValidation.textContent = '';
    clearExportBackupFieldErrors();
    clearBackupResult(exportBackupResult);
  }

  function updateExportBackupDialogState() {
    const includeConnections = Boolean(exportIncludeConnections.checked);
    exportIncludeFavorites.disabled = !includeConnections;
    exportIncludeUsernames.disabled = !includeConnections;

    if (!includeConnections) {
      exportIncludeFavorites.checked = false;
      exportIncludeUsernames.checked = false;
      exportIncludeCredentials.checked = false;
    }

    const canIncludeCredentials = includeConnections && Boolean(exportIncludeUsernames.checked);
    exportIncludeCredentials.disabled = !canIncludeCredentials;

    if (!canIncludeCredentials) {
      exportIncludeCredentials.checked = false;
    }

    const showCredentials = canIncludeCredentials && Boolean(exportIncludeCredentials.checked);
    exportCredentialsBlock.classList.toggle('visible', showCredentials);
    exportCredentialPassword.disabled = !showCredentials;
    exportCredentialConfirmPassword.disabled = !showCredentials;
    exportCredentialPasswordRevealButton.disabled = !showCredentials;
    exportCredentialConfirmPasswordRevealButton.disabled = !showCredentials;
    hideTemporaryPassword(exportCredentialPassword);
    hideTemporaryPassword(exportCredentialConfirmPassword);
    exportCredentialsDisabledHelp.textContent = includeConnections && !exportIncludeUsernames.checked
      ? 'Enable usernames to include encrypted passwords/passphrases.'
      : '';

    if (!showCredentials) {
      exportCredentialPassword.value = '';
      exportCredentialConfirmPassword.value = '';
    }

    exportBackupValidation.textContent = '';
    clearExportBackupFieldErrors();
    clearBackupResult(exportBackupResult);
  }

  function applyExportBackupDialog() {
    exportBackupValidation.textContent = '';
    clearExportBackupFieldErrors();
    clearBackupResult(exportBackupResult);
    const includeCredentials = Boolean(exportIncludeCredentials.checked) && !exportIncludeCredentials.disabled;
    const credentialPassword = String(exportCredentialPassword.value || '');
    const credentialConfirmPassword = String(exportCredentialConfirmPassword.value || '');

    if (!exportIncludeSettings.checked && !exportIncludeConnections.checked) {
      showBackupResult(exportBackupResult, 'Select at least one export option.', true);
      return;
    }

    if (includeCredentials) {
      if (!credentialPassword) {
        setBackupFieldError(exportCredentialPassword, exportCredentialPasswordError, 'Export password is required.');
        showBackupResult(exportBackupResult, 'Export password is required.', true);
        exportCredentialPassword.focus();
        return;
      }

      if (!credentialConfirmPassword) {
        setBackupFieldError(exportCredentialConfirmPassword, exportCredentialConfirmPasswordError, 'Confirm password is required.');
        showBackupResult(exportBackupResult, 'Confirm password is required.', true);
        exportCredentialConfirmPassword.focus();
        return;
      }

      if (credentialPassword !== credentialConfirmPassword) {
        setBackupFieldError(exportCredentialPassword, exportCredentialPasswordError, 'Passwords do not match.');
        setBackupFieldError(exportCredentialConfirmPassword, exportCredentialConfirmPasswordError, 'Passwords do not match.');
        showBackupResult(exportBackupResult, 'Passwords do not match.', true);
        exportCredentialConfirmPassword.focus();
        return;
      }
    }

    vscode.postMessage({
      type: 'exportConnectionsSettings',
      payload: {
        includeSettings: Boolean(exportIncludeSettings.checked),
        includeConnections: Boolean(exportIncludeConnections.checked),
        includeFavorites: Boolean(exportIncludeFavorites.checked) && !exportIncludeFavorites.disabled,
        includeUsernames: Boolean(exportIncludeUsernames.checked) && !exportIncludeUsernames.disabled,
        includeCredentials,
        credentialPassword
      }
    });

  }

  function showImportBackupDialog(summary) {
    importBackupDialogOpen = true;
    importBackupSummaryState = Object.assign({
      hasSettings: false,
      connectionCount: 0,
      supportedConnectionCount: 0,
      unsupportedConnectionCount: 0,
      remotePathFavoriteCount: 0,
      usernamesIncluded: false,
      hasEncryptedCredentials: false,
      importError: ''
    }, summary || {});

    renderImportBackupSummary(importBackupSummaryState);
    importIncludeSettings.checked = Boolean(importBackupSummaryState.hasSettings);
    importIncludeConnections.checked = Number(importBackupSummaryState.supportedConnectionCount || 0) > 0;
    importIncludeFavorites.checked = Number(importBackupSummaryState.remotePathFavoriteCount || 0) > 0;
    importIncludeUsernames.checked = Boolean(importBackupSummaryState.usernamesIncluded);
    importRestoreCredentials.checked = false;
    importCredentialPassword.value = '';
    importModeMerge.checked = true;
    importModeReplace.checked = false;
    importBackupValidation.textContent = '';
    clearImportBackupFieldErrors();
    clearBackupResult(importBackupResult);
    updateImportBackupDialogState();
    if (importBackupSummaryState.importError) {
      showBackupResult(importBackupResult, String(importBackupSummaryState.importError), true);
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
    const unsupportedCount = Number(summary.unsupportedConnectionCount || 0);
    const parts = [
      summary.hasSettings ? 'Settings included' : 'Settings not included',
      connectionCount === 1 ? '1 connection' : connectionCount + ' connections',
      favoriteCount === 1 ? '1 favorite' : favoriteCount + ' favorites',
      summary.usernamesIncluded ? 'usernames included' : 'usernames not included',
      summary.hasEncryptedCredentials ? 'passwords/passphrases encrypted' : 'passwords/passphrases not included'
    ];

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

  function showManageProfilesDialog() {
    manageProfilesDialogOpen = true;
    renameProfileId = '';
    manageProfilesFilterText = '';
    if (manageProfilesFilterInput) manageProfilesFilterInput.value = '';
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
    renameProfileId = '';
    manageProfilesBackdrop.classList.remove('visible');
    manageProfilesBackdrop.setAttribute('aria-hidden', 'true');
  }

  const MANAGE_ICON_RENAME = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="M200-200h57.46l391.77-391.77-57.46-57.46L200-257.46V-200Zm-40 40v-114.15l489.23-489.23q5.85-5.85 13.08-8.54 7.23-2.69 14.69-2.69 7.46 0 14.88 2.69 7.43 2.69 13.27 8.54l57.23 57.23q5.85 5.84 8.54 13.27 2.69 7.42 2.69 14.88 0 7.46-2.69 14.69-2.69 7.23-8.54 13.08L274.15-160H160Zm432-489.23 57.23 57.46L592-649.23Z"></path></svg>';
  const MANAGE_ICON_SAVE = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="M382-267.69 194.69-455l28.31-28.31 159 159 355-355L765.31-651 382-267.69Z"></path></svg>';
  const MANAGE_ICON_CANCEL = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="m256-227.69-28.31-28.31 224-224-224-224L256-732.31l224 224 224-224 28.31 28.31-224 224 224 224L704-227.69l-224-224-224 224Z"></path></svg>';
  const MANAGE_ICON_DELETE = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="M292.31-140q-29.83 0-51.07-21.24Q220-182.48 220-212.31V-720h-40v-40h180v-40h240v40h180v40h-40v507.69q0 29.83-21.24 51.07Q697.52-140 667.69-140H292.31ZM700-720H260v507.69q0 13.85 9.23 23.08 9.23 9.23 23.08 9.23h375.38q13.85 0 23.08-9.23 9.23-9.23 9.23-23.08V-720ZM376.92-266.15h40v-367.7h-40v367.7Zm166.16 0h40v-367.7h-40v367.7ZM260-720v540-540Z"></path></svg>';

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

  function renderManageProfilesList() {
    if (!manageProfilesList) return;

    manageProfilesList.innerHTML = '';

    if (!profiles.length) {
      const empty = document.createElement('div');
      empty.className = 'manage-profiles-empty';
      empty.textContent = 'No saved connections.';
      manageProfilesList.appendChild(empty);
      return;
    }

    const filteredProfiles = profiles.filter(profile => profileMatchesFilter(profile, manageProfilesFilterText) || profile.id === renameProfileId);
    if (!filteredProfiles.length) {
      const empty = document.createElement('div');
      empty.className = 'manage-profiles-empty';
      empty.textContent = 'No saved connections found.';
      manageProfilesList.appendChild(empty);
      return;
    }

    for (const profile of filteredProfiles) {
      const row = document.createElement('div');
      row.className = 'manage-profile-row';
      row.dataset.profileId = profile.id;

      if (renameProfileId === profile.id) {
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
        manageProfilesList.appendChild(row);
        setTimeout(() => { input.focus(); input.select(); }, 0);
        continue;
      }

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

      manageProfilesList.appendChild(row);
    }
  }

  function handleManageProfilesClick(event) {
    const actionTarget = event.target && event.target.closest ? event.target.closest('[data-manage-action]') : null;
    if (!actionTarget) return;

    const row = actionTarget.closest('[data-profile-id]');
    const profileId = row ? row.dataset.profileId || '' : '';
    const profile = profiles.find(item => item.id === profileId);

    if (!profileId || !profile) return;

    const action = actionTarget.dataset.manageAction;
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



  function updateRemoteCommandConnectedTo() {
    if (!remoteCommandConnectedTo) return;

    const active = getActiveSession();
    const hostValue = active ? String(active.host || '').trim() : String(host.value || '').trim();
    remoteCommandConnectedTo.textContent = hostValue || '-';
    remoteCommandConnectedTo.title = hostValue || '';
  }

  function updateRemoteCommandRunAs() {
    if (!remoteCommandRunAs) return;

    const active = getActiveSession();
    const username = active ? String(active.username || '').trim() : '';
    const isRootConnection = username.toLowerCase() === 'root';
    const useSudo = Boolean(active && active.sudoModeEnabled && !isRootConnection);

    remoteCommandRunAs.textContent = useSudo
      ? 'root via sudo'
      : isRootConnection
        ? 'root'
        : (username || 'SSH user');
    remoteCommandRunAs.classList.toggle('sudo', useSudo);
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
    remoteCommandClosingAfterStop = false;
    remoteCommandStopping = false;
    remoteCommandForceKilling = false;
    clearRemoteCommandStopEscalationTimer();
    remoteCommandStopWarning.classList.remove('visible');
    updateRemoteCommandConnectedTo();
    remoteCommandWorkingDirectory.textContent = normalizeUiRemotePath(workingDirectory || currentPath.value || '/');
    updateRemoteCommandRunAs();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandBackdrop.classList.add('visible');
    remoteCommandBackdrop.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(syncRemoteCommandRunButtonMinWidth);
    updateRemoteCommandControls();
    setTimeout(() => remoteCommandInput.focus(), 0);
  }

  function attemptCloseRemoteCommandDialog() {
    if (!remoteCommandDialogOpen) return;

    if (remoteCommandRunning) {
      remoteCommandCloseWarning.classList.add('visible');
      setTimeout(() => remoteCommandKeepRunningButton.focus(), 0);
      return;
    }

    hideRemoteCommandDialog();
  }

  function hideRemoteCommandDialog() {
    remoteCommandDialogOpen = false;
    remoteCommandClosingAfterStop = false;
    remoteCommandStopping = false;
    remoteCommandForceKilling = false;
    clearRemoteCommandStopEscalationTimer();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');
    remoteCommandBackdrop.classList.remove('visible');
    remoteCommandBackdrop.setAttribute('aria-hidden', 'true');
    remoteCommandInput.value = '';
    remoteCommandFinalMessage = '';
    setRemoteCommandOutputText('');
    setRemoteCommandStatus('');
    updateRemoteCommandControls();
  }

  function runRemoteCommandFromDialog() {
    if (remoteCommandRunning) return;

    if (!getActiveRemoteCapabilities().canRunCommand) {
      setRemoteCommandStatus('Run Remote Command is available only for SFTP connections.', true);
      return;
    }

    const command = String(remoteCommandInput.value || '').trim();
    const workingDirectory = normalizeUiRemotePath(remoteCommandWorkingDirectory.textContent || currentPath.value || '/');

    if (!command) {
      setRemoteCommandStatus('Enter a command to run.', true);
      remoteCommandInput.focus();
      return;
    }

    remoteCommandId = Date.now() + '-' + Math.random().toString(36).slice(2);
    remoteCommandRunning = true;
    remoteCommandClosingAfterStop = false;
    remoteCommandStopping = false;
    remoteCommandForceKilling = false;
    clearRemoteCommandStopEscalationTimer();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');
    remoteCommandFinalMessage = '';
    setRemoteCommandOutputText('');
    setRemoteCommandStatus('Starting...');
    updateRemoteCommandControls();
    scrollRemoteCommandOutputToBottom();

    vscode.postMessage({
      type: 'requestRunRemoteCommand',
      payload: {
        commandId: remoteCommandId,
        workingDirectory,
        command
      }
    });
  }

  function stopRemoteCommandFromDialog(closeAfterStop) {
    if (!remoteCommandRunning || !remoteCommandId) return;

    remoteCommandClosingAfterStop = Boolean(closeAfterStop);
    remoteCommandStopping = true;
    remoteCommandForceKilling = false;
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');
    setRemoteCommandStatus('Stopping...');
    updateRemoteCommandControls();
    vscode.postMessage({ type: 'stopRemoteCommand', payload: { commandId: remoteCommandId } });
    startRemoteCommandStopEscalationTimer();
  }

  function forceKillRemoteCommandFromDialog() {
    if (!remoteCommandRunning || !remoteCommandId) return;

    remoteCommandForceKilling = true;
    remoteCommandStopWarning.classList.remove('visible');
    setRemoteCommandStatus('Force killing...');
    updateRemoteCommandControls();
    vscode.postMessage({ type: 'stopRemoteCommand', payload: { commandId: remoteCommandId, force: true } });
  }

  function startRemoteCommandStopEscalationTimer() {
    clearRemoteCommandStopEscalationTimer();
    remoteCommandStopEscalationTimer = setTimeout(() => {
      remoteCommandStopEscalationTimer = null;
      if (!remoteCommandRunning || !remoteCommandStopping) return;
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
    if (remoteCommandRunning) return;
    remoteCommandFinalMessage = '';
    setRemoteCommandOutputText('');
    setRemoteCommandStatus('');
  }

  function handleRemoteCommandStarted(payload) {
    if (!payload || payload.commandId !== remoteCommandId) return;
    remoteCommandRunning = true;
    remoteCommandStopping = false;
    remoteCommandForceKilling = false;
    clearRemoteCommandStopEscalationTimer();
    remoteCommandStopWarning.classList.remove('visible');
    setRemoteCommandStatus('Running...');
    updateRemoteCommandControls();
  }

  function handleRemoteCommandOutput(payload) {
    if (!payload || payload.commandId !== remoteCommandId) return;

    if (payload.kind === 'command') {
      appendRemoteCommandCommand(String(payload.text || ''));
      return;
    }

    if (payload.kind === 'commandStatus') {
      appendRemoteCommandCommandStatus(Number(payload.code || 0));
      return;
    }

    appendRemoteCommandOutput(String(payload.text || ''));
  }

  function handleRemoteCommandFinished(payload) {
    if (!payload || payload.commandId !== remoteCommandId) return;

    remoteCommandRunning = false;
    remoteCommandStopping = false;
    remoteCommandForceKilling = false;
    clearRemoteCommandStopEscalationTimer();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');

    if (payload.stopped) {
      remoteCommandFinalMessage = payload.forceKilled ? 'Force killed by user.' : 'Stopped by user.';
      renderRemoteCommandOutputText();
      setRemoteCommandStatus(remoteCommandFinalMessage);
    } else if (payload.error) {
      setRemoteCommandStatus('Error: ' + payload.error, true);
    } else {
      const exitCode = typeof payload.code === 'number' ? payload.code : 0;
      const signal = payload.signal ? ' · signal ' + payload.signal : '';
      const failedCommandCount = Number(payload.failedCommandCount || 0);
      if (failedCommandCount > 0) {
        const label = failedCommandCount === 1 ? '1 command failed' : failedCommandCount + ' commands failed';
        setRemoteCommandStatus('Finished with errors. ' + label + '. Last exit code: ' + exitCode + signal, true);
      } else {
        setRemoteCommandStatus('Exit code: ' + exitCode + signal, exitCode !== 0);
      }
    }

    updateRemoteCommandControls();

    if (remoteCommandClosingAfterStop) {
      hideRemoteCommandDialog();
    } else if (remoteCommandDialogOpen) {
      setTimeout(() => {
        remoteCommandInput.focus();
        remoteCommandInput.select();
      }, 0);
    }
  }

  function formatRemoteCommandPrompt(command) {
    const lines = String(command || '').replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n').split('\\n');
    return lines.map((line, index) => (index === 0 ? '$ ' : '> ') + line).join('\\n') + '\\n';
  }

  function appendRemoteCommandCommand(command) {
    const current = remoteCommandOutputText || '';
    const prefix = current && !current.endsWith('\\n') ? '\\n' : '';
    setRemoteCommandOutputText(current + prefix + formatRemoteCommandPrompt(command));
    scrollRemoteCommandOutputToBottom();
  }

  function appendRemoteCommandCommandStatus(code) {
    const current = remoteCommandOutputText || '';
    const prefix = current && !current.endsWith('\\n') ? '\\n' : '';
    setRemoteCommandOutputText(current + prefix + '[Command exited with code ' + code + ']\\n');
    scrollRemoteCommandOutputToBottom();
  }

  function appendRemoteCommandOutput(text) {
    if (!text) return;

    const shouldStickToBottom = isRemoteCommandOutputNearBottom();
    setRemoteCommandOutputText(remoteCommandOutputText + text);

    if (shouldStickToBottom) {
      scrollRemoteCommandOutputToBottom();
    }
  }

  function setRemoteCommandOutputText(text) {
    remoteCommandOutputText = String(text || '');
    remoteCommandOutputViewLimited = remoteCommandOutputText.length > REMOTE_COMMAND_MAX_OUTPUT_CHARS;

    if (remoteCommandOutputViewLimited) {
      remoteCommandOutputText = remoteCommandOutputText.slice(-REMOTE_COMMAND_MAX_OUTPUT_CHARS);
    }

    renderRemoteCommandOutputText();
    updateRemoteCommandOutputNotice();
    updateRemoteCommandCopyButton();
  }

  function getRemoteCommandOutputTextForDisplay() {
    const output = String(remoteCommandOutputText || '');
    const finalMessage = String(remoteCommandFinalMessage || '').trim();
    if (!finalMessage) return output;
    const prefix = output && !output.endsWith('\\n') ? '\\n' : '';
    return output + prefix + finalMessage + '\\n';
  }

  function renderRemoteCommandOutputText() {
    remoteCommandOutput.innerHTML = renderRemoteCommandOutput(getRemoteCommandOutputTextForDisplay());
  }

  function renderRemoteCommandOutput(text) {
    const source = String(text || '');
    const lines = source.match(/[^\\n]*\\n|[^\\n]+$/g) || [];

    return lines.map((line, index) => {
      const hasNewline = line.endsWith('\\n');
      const value = hasNewline ? line.slice(0, -1) : line;
      const newline = hasNewline ? '\\n' : '';
      const escaped = escapeHtml(value) + newline;

      if (value.startsWith('$ ') || value.startsWith('> ')) {
        return '<span class="remote-command-output-command">' + escaped + '</span>';
      }

      if (/^(Stopped by user\\.|Force killed by user\\.|\\[(Command stopped by user\\.|Command finished with exit code |Command exited with code |Error: ))/.test(value)) {
        return '<span class="remote-command-output-system">' + escaped + '</span>';
      }

      return escaped;
    }).join('');
  }



  function selectRemoteCommandOutputText() {
    if (!remoteCommandOutput) return;
    const selection = window.getSelection ? window.getSelection() : null;
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(remoteCommandOutput);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function getRemoteCommandOutputCopyText() {
    const output = getRemoteCommandOutputTextForDisplay().replace(/\\s+$/g, '');
    const statusText = remoteCommandStatus ? String(remoteCommandStatus.textContent || '').trim() : '';
    const finalMessage = String(remoteCommandFinalMessage || '').trim();
    if (output && statusText && statusText !== finalMessage) return output + '\\n\\n' + statusText;
    return output || statusText;
  }

  function copyRemoteCommandOutput() {
    const text = getRemoteCommandOutputCopyText();
    if (!text) return;
    vscode.postMessage({ type: 'copyStatus', payload: { text, message: 'Copied output' } });
  }

  function updateRemoteCommandCopyButton() {
    if (!remoteCommandCopyButton) return;
    remoteCommandCopyButton.disabled = !getRemoteCommandOutputCopyText();
  }

  function updateRemoteCommandOutputNotice() {
    remoteCommandOutputNotice.textContent = remoteCommandOutputViewLimited ? 'Showing latest output only.' : '';
  }


  function setRemoteCommandStatus(message, isError) {
    remoteCommandStatus.textContent = message || '';
    remoteCommandStatus.classList.toggle('error', Boolean(isError));
    updateRemoteCommandCopyButton();
  }

  function updateRemoteCommandControls() {
    remoteCommandInput.disabled = remoteCommandRunning;

    if (remoteCommandRunning) {
      remoteCommandRunButton.textContent = remoteCommandStopping ? 'Stopping…' : 'Stop';
      remoteCommandRunButton.classList.add('secondary');
      remoteCommandRunButton.disabled = remoteCommandStopping;
    } else {
      remoteCommandRunButton.textContent = 'Run';
      remoteCommandRunButton.classList.remove('secondary');
      remoteCommandRunButton.disabled = !activeConnectionId || !getActiveRemoteCapabilities().canRunCommand;
    }

    remoteCommandForceKillButton.disabled = !remoteCommandRunning || !remoteCommandStopping || remoteCommandForceKilling;
    remoteCommandClearButton.disabled = remoteCommandRunning || !(remoteCommandOutputText || remoteCommandFinalMessage || '');
    updateRemoteCommandCopyButton();
  }

  function isRemoteCommandOutputNearBottom() {
    return remoteCommandOutputWrap.scrollTop + remoteCommandOutputWrap.clientHeight >= remoteCommandOutputWrap.scrollHeight - 24;
  }

  function scrollRemoteCommandOutputToBottom() {
    remoteCommandOutputWrap.scrollTop = remoteCommandOutputWrap.scrollHeight;
  }

  function showOwnerGroupDialog(entries) {
    const selectedEntries = Array.isArray(entries) ? entries.filter(entry => entry && !isParentEntry(entry)) : [];
    if (!selectedEntries.length) return;

    ownerGroupEntries = selectedEntries.map(actionPayload);
    ownerGroupDialogOpen = true;
    ownerGroupOwnerInput.value = '';
    ownerGroupGroupInput.value = '';
    ownerGroupRecursiveInput.checked = false;
    ownerGroupValidation.textContent = '';

    const hasDirectory = selectedEntries.some(entry => getEffectiveEntryType(entry) === 'directory');
    ownerGroupTitle.textContent = selectedEntries.length === 1 ? 'Change Owner/Group' : 'Change Owner/Group for Selected Items';
    ownerGroupPath.textContent = selectedEntries.length === 1
      ? (selectedEntries[0].path || selectedEntries[0].name || '')
      : selectedEntries.length + ' selected items';
    ownerGroupRecursiveRow.style.display = hasDirectory ? '' : 'none';
    ownerGroupHelperBlock.classList.toggle('no-recursive', !hasDirectory);
    ownerGroupNote.textContent = hasDirectory
      ? 'Recursive changes may take a long time on large directory trees.'
      : '';

    updateOwnerGroupApplyState();
    ownerGroupBackdrop.classList.add('visible');
    ownerGroupBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => ownerGroupOwnerInput.focus(), 0);
  }

  function hideOwnerGroupDialog() {
    ownerGroupDialogOpen = false;
    ownerGroupEntries = [];
    ownerGroupBackdrop.classList.remove('visible');
    ownerGroupBackdrop.setAttribute('aria-hidden', 'true');
  }

  function updateOwnerGroupApplyState() {
    const owner = String(ownerGroupOwnerInput.value || '').trim();
    const group = String(ownerGroupGroupInput.value || '').trim();
    const validationMessage = getOwnerGroupValidationMessage(owner, group, false);
    ownerGroupApplyButton.disabled = Boolean(validationMessage) || (!owner && !group);
    ownerGroupValidation.textContent = validationMessage || '';
  }

  function applyOwnerGroupDialog() {
    if (!getActiveRemoteCapabilities().canChangeOwnerGroup) {
      hideOwnerGroupDialog();
      setStatus('Change Owner/Group is available only for SFTP connections.', true);
      return;
    }

    const owner = String(ownerGroupOwnerInput.value || '').trim();
    const group = String(ownerGroupGroupInput.value || '').trim();
    const validationMessage = getOwnerGroupValidationMessage(owner, group, true);

    if (validationMessage) {
      ownerGroupValidation.textContent = validationMessage;
      ownerGroupApplyButton.disabled = true;
      return;
    }

    const entries = ownerGroupEntries.slice();
    hideOwnerGroupDialog();
    vscode.postMessage({
      type: 'requestChangeOwnerGroup',
      payload: {
        entries,
        owner,
        group,
        recursive: Boolean(ownerGroupRecursiveInput.checked)
      }
    });
  }

  function getOwnerGroupValidationMessage(owner, group, requireValue) {
    if (requireValue && !owner && !group) {
      return 'Enter an owner, a group, or both.';
    }

    const ownerMessage = validateOwnerGroupInput(owner, 'Owner');
    if (ownerMessage) return ownerMessage;

    const groupMessage = validateOwnerGroupInput(group, 'Group');
    if (groupMessage) return groupMessage;

    return '';
  }

  function validateOwnerGroupInput(value, label) {
    const text = String(value || '').trim();
    if (!text) return '';

    if (!/^[A-Za-z0-9_][A-Za-z0-9._@+-]*$/.test(text)) {
      return label + ' can contain letters, numbers, underscore, dot, dash, plus, and at sign, and must not start with a dash.';
    }

    return '';
  }

  function showFilePropertiesDialog(entry) {
    if (!entry) return;

    filePropertiesDialogOpen = true;
    filePropertiesRemotePath = entry.path || '';
    const active = getActiveSession();
    const entryType = getEffectiveEntryType(entry);
    const isDirectory = entryType === 'directory';
    const isFile = entryType === 'file';
    const isLink = entry.type === 'link';
    const title = isDirectory
      ? 'Directory Properties'
      : isLink
        ? 'Link Properties'
        : isFile
          ? 'File Properties'
          : 'Item Properties';
    const pathLabel = isDirectory
      ? 'Remote directory'
      : isLink
        ? 'Remote link'
        : isFile
          ? 'Remote file'
          : 'Remote Path';

    filePropertiesTitle.textContent = title;
    filePropertiesPath.textContent = entry.path || '';

    const rows = [
      ['Name', entry.name || '—'],
      [pathLabel, entry.path || '—'],
      ['Type', formatPropertyType(entry)]
    ];

    if (!isDirectory) {
      rows.push(['Size', formatSize(entry.size)]);
    }

    rows.push(
      ['Modified', formatDate(entry.modifyTime) || '—'],
      ['Permissions', formatPermissionsValue(entry.permissions)],
      ['Owner', formatMetadata(entry.owner) || '—'],
      ['Group', formatMetadata(entry.group) || '—']
    );

    if (isLink && entry.linkTarget) {
      rows.push(['Symlink target', entry.linkTarget]);
    }

    if (isLink && entry.effectiveType) {
      rows.push(['Resolved type', capitalizeText(entry.effectiveType)]);
    }

    rows.push(
      ['Connection', active ? active.name : '—'],
      ['Host', active ? formatSessionTarget(active) : '—']
    );

    filePropertiesGrid.innerHTML = rows.map(row => {
      return '<div class="file-properties-label">' + escapeHtml(row[0]) + '</div>'
        + '<div class="file-properties-value">' + escapeHtml(row[1] || '—') + '</div>';
    }).join('');

    filePropertiesCopyPathButton.disabled = !filePropertiesRemotePath;
    filePropertiesBackdrop.classList.add('visible');
    filePropertiesBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => filePropertiesCloseButton.focus(), 0);
  }

  function hideFilePropertiesDialog() {
    if (!filePropertiesBackdrop) return;
    filePropertiesDialogOpen = false;
    filePropertiesRemotePath = '';
    filePropertiesBackdrop.classList.remove('visible');
    filePropertiesBackdrop.setAttribute('aria-hidden', 'true');
  }

  function showChecksumsDialog(payload) {
    checksumsDialogOpen = true;
    const remotePath = payload.remotePath || '';
    checksumsCopyState = {
      sha256: payload.sha256Value || '',
      md5: payload.md5Value || '',
      all: payload.copyAllText || ''
    };

    checksumsPath.textContent = remotePath;

    const rows = [
      ['Remote file', remotePath || '—'],
      ['Size', payload.size || '—'],
      ['Modified', payload.modified || '—'],
      ['SHA-256', payload.sha256 || 'Not available'],
      ['MD5', payload.md5 || 'Not available']
    ];

    checksumsGrid.innerHTML = rows.map(row => {
      return '<div class="file-properties-label">' + escapeHtml(row[0]) + '</div>'
        + '<div class="file-properties-value">' + escapeHtml(row[1] || '—') + '</div>';
    }).join('');

    checksumsCopySha256Button.disabled = !checksumsCopyState.sha256;
    checksumsCopyMd5Button.disabled = !checksumsCopyState.md5;
    checksumsCopyAllButton.disabled = !checksumsCopyState.all;
    checksumsBackdrop.classList.add('visible');
    checksumsBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => checksumsCloseButton.focus(), 0);
  }

  function hideChecksumsDialog() {
    if (!checksumsBackdrop) return;
    checksumsDialogOpen = false;
    checksumsCopyState = { sha256: '', md5: '', all: '' };
    checksumsBackdrop.classList.remove('visible');
    checksumsBackdrop.setAttribute('aria-hidden', 'true');
  }

  function copyChecksumValue(text, message) {
    const value = String(text || '').trim();
    if (!value) return;
    vscode.postMessage({ type: 'copyStatus', payload: { text: value, message } });
  }

  function formatPropertyType(entry) {
    if (!entry) return 'Unknown';
    if (entry.type === 'link') {
      const resolvedType = entry.effectiveType ? ' (' + capitalizeText(entry.effectiveType) + ')' : '';
      return 'Symbolic link' + resolvedType;
    }
    return capitalizeText(entry.type || 'unknown');
  }

  function formatPermissionsValue(permissions) {
    const text = String(permissions || '').trim();
    if (!text) return '—';
    const mode = permissionModeFromSymbolic(text);
    return mode ? text + ' (' + mode + ')' : text;
  }

  function permissionModeFromSymbolic(permissions) {
    const text = String(permissions || '').trim();
    if (text.length < 10) return '';

    const chars = text.slice(-9);
    let special = 0;
    let owner = 0;
    let group = 0;
    let other = 0;

    if (chars[0] === 'r') owner += 4;
    if (chars[1] === 'w') owner += 2;
    if (chars[2] === 'x' || chars[2] === 's') owner += 1;
    if (chars[2] === 's' || chars[2] === 'S') special += 4;

    if (chars[3] === 'r') group += 4;
    if (chars[4] === 'w') group += 2;
    if (chars[5] === 'x' || chars[5] === 's') group += 1;
    if (chars[5] === 's' || chars[5] === 'S') special += 2;

    if (chars[6] === 'r') other += 4;
    if (chars[7] === 'w') other += 2;
    if (chars[8] === 'x' || chars[8] === 't') other += 1;
    if (chars[8] === 't' || chars[8] === 'T') special += 1;

    return (special ? String(special) : '') + String(owner) + String(group) + String(other);
  }

  function capitalizeText(value) {
    const text = String(value || 'unknown');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function showPermissionsDialog(options) {
    permissionsDialogOpen = true;
    hideContextMenu();

    const state = options.permissionState || {};
    const selectedCount = Number(options.selectedCount || 1);
    const hasDirectory = Boolean(options.hasDirectory);
    const hasFile = Boolean(options.hasFile);
    const isMixed = Boolean(options.isMixed);
    permissionPreviewKind = isMixed ? 'mixed' : (hasDirectory && !hasFile ? 'directory' : 'file');

    permissionDialogTitle.textContent = selectedCount > 1
      ? 'Set Permissions for selected items'
      : 'Set Permissions: ' + (options.entryName || 'selected item');
    permissionDialogPath.textContent = selectedCount > 1
      ? selectedCount + ' selected items'
      : (options.remotePath || '');

    if (isMixed) {
      permissionSetuidLabel.textContent = 'Set user ID / setuid';
      permissionSetgidLabel.textContent = 'Set group ID / setgid';
      permissionStickyLabel.textContent = 'Sticky bit';
    } else if (hasDirectory) {
      permissionSetuidLabel.textContent = 'Set user ID / usually ignored on directories';
      permissionSetgidLabel.textContent = 'Inherit group for new files and folders / setgid';
      permissionStickyLabel.textContent = 'Restrict delete/rename to item owners / sticky';
    } else {
      permissionSetuidLabel.textContent = 'Run as owner / setuid';
      permissionSetgidLabel.textContent = 'Run as group / setgid';
      permissionStickyLabel.textContent = 'Sticky bit / rarely used on files';
    }

    permissionRecursiveInput.checked = false;
    permissionRecursiveRow.style.display = hasDirectory ? '' : 'none';
    permissionHelperBlock.classList.toggle('no-recursive', !hasDirectory);
    permissionNote.textContent = hasDirectory
      ? 'Recursive changes may take a long time on large directory trees.'
      : '';

    for (const checkbox of permissionCheckboxes) {
      checkbox.checked = Boolean(state[checkbox.dataset.permission]);
    }

    permissionModeInput.value = normalizePermissionMode(String(options.initialMode || '').trim()) || calculateModeFromPermissionCheckboxes();
    updatePermissionPreview(permissionModeInput.value);
    setPermissionValidation('', true);
    permissionBackdrop.classList.add('visible');
    permissionBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => permissionModeInput.focus(), 0);
  }

  function hidePermissionsDialog() {
    permissionsDialogOpen = false;
    permissionBackdrop.classList.remove('visible');
    permissionBackdrop.setAttribute('aria-hidden', 'true');
    permissionRecursiveInput.checked = false;
    setPermissionValidation('', true);
  }

  function calculateModeFromPermissionCheckboxes() {
    const selected = new Set(permissionCheckboxes.filter(item => item.checked).map(item => item.dataset.permission));
    const special = (selected.has('setuid') ? 4 : 0) + (selected.has('setgid') ? 2 : 0) + (selected.has('sticky') ? 1 : 0);
    const owner = permissionDigit(selected, ['ownerRead', 'ownerWrite', 'ownerExecute']);
    const group = permissionDigit(selected, ['groupRead', 'groupWrite', 'groupExecute']);
    const others = permissionDigit(selected, ['othersRead', 'othersWrite', 'othersExecute']);
    return String(special) + String(owner) + String(group) + String(others);
  }

  function permissionDigit(selected, keys) {
    return (selected.has(keys[0]) ? 4 : 0) + (selected.has(keys[1]) ? 2 : 0) + (selected.has(keys[2]) ? 1 : 0);
  }

  function normalizePermissionMode(value) {
    if (/^[0-7]{3}$/.test(value)) return '0' + value;
    if (/^[0-7]{4}$/.test(value)) return value;
    return '';
  }

  function updatePermissionCheckboxesFromMode(mode) {
    const digits = mode.split('').map(item => Number(item));
    const special = digits[0];
    setPermissionChecked('setuid', (special & 4) !== 0);
    setPermissionChecked('setgid', (special & 2) !== 0);
    setPermissionChecked('sticky', (special & 1) !== 0);
    updatePermissionGroup(['ownerRead', 'ownerWrite', 'ownerExecute'], digits[1]);
    updatePermissionGroup(['groupRead', 'groupWrite', 'groupExecute'], digits[2]);
    updatePermissionGroup(['othersRead', 'othersWrite', 'othersExecute'], digits[3]);
  }

  function updatePermissionGroup(keys, digit) {
    setPermissionChecked(keys[0], (digit & 4) !== 0);
    setPermissionChecked(keys[1], (digit & 2) !== 0);
    setPermissionChecked(keys[2], (digit & 1) !== 0);
  }

  function setPermissionChecked(permission, checked) {
    const checkbox = permissionCheckboxes.find(item => item.dataset.permission === permission);
    if (checkbox) checkbox.checked = checked;
  }


  function updatePermissionPreview(mode) {
    const normalized = normalizePermissionMode(String(mode || '').trim());
    if (!normalized) {
      setPermissionPreviewLines(['Preview: —']);
      return;
    }

    if (permissionPreviewKind === 'mixed') {
      setPermissionPreviewLines([
        'File preview: ' + permissionSymbolicFromMode(normalized, '-'),
        'Directory preview: ' + permissionSymbolicFromMode(normalized, 'd')
      ]);
      return;
    }

    const typeChar = permissionPreviewKind === 'directory' ? 'd' : '-';
    setPermissionPreviewLines(['Preview: ' + permissionSymbolicFromMode(normalized, typeChar)]);
  }

  function setPermissionPreviewLines(lines) {
    permissionCurrentText.replaceChildren();
    for (const text of lines) {
      const line = document.createElement('span');
      line.className = 'permission-preview-line';
      line.textContent = text;
      permissionCurrentText.appendChild(line);
    }
  }

  function permissionSymbolicFromMode(mode, typeChar) {
    const digits = normalizePermissionMode(mode).split('').map(item => Number(item));
    const special = digits[0];
    const owner = digits[1];
    const group = digits[2];
    const others = digits[3];

    return typeChar +
      permissionTriplet(owner, (special & 4) !== 0, 's') +
      permissionTriplet(group, (special & 2) !== 0, 's') +
      permissionTriplet(others, (special & 1) !== 0, 't');
  }

  function permissionTriplet(digit, special, specialExecuteChar) {
    return ((digit & 4) ? 'r' : '-') +
      ((digit & 2) ? 'w' : '-') +
      ((digit & 1) ? (special ? specialExecuteChar : 'x') : (special ? specialExecuteChar.toUpperCase() : '-'));
  }

  function setPermissionValidation(message, isValid) {
    permissionValidation.textContent = message;
    permissionModeInput.classList.toggle('invalid', !isValid);
    permissionApplyButton.disabled = !isValid;
  }

  function getActiveProfile() {
    return profiles.find(profile => profile.id === activeConnectionId) || null;
  }

  function getFavoriteRemotePaths() {
    const activeProfile = getActiveProfile();
    return activeProfile && Array.isArray(activeProfile.favoriteRemotePaths) ? activeProfile.favoriteRemotePaths : [];
  }

  function normalizeUiRemotePath(value) {
    let trimmed = String(value || '').trim().split('\\\\').join('/');
    while (trimmed.indexOf('//') !== -1) trimmed = trimmed.split('//').join('/');
    if (!trimmed) return '/';
    return trimmed.charAt(0) === '/' ? trimmed : '/' + trimmed;
  }

  function isCurrentPathFavorite() {
    const current = normalizeUiRemotePath(currentPath.value || '/');
    return getFavoriteRemotePaths().includes(current);
  }

  function isRemotePathEdited() {
    const active = getActiveSession();
    if (!active || !active.currentPath) return false;
    return normalizeUiRemotePath(currentPath.value || '/') !== normalizeUiRemotePath(active.currentPath || '/');
  }

  function updateRemotePathActionButton() {
    if (!goButton) return;
    const goMode = Boolean(activeConnectionId) && isRemotePathEdited();
    goButton.innerHTML = goMode ? REMOTE_PATH_GO_ICON : REMOTE_PATH_REFRESH_ICON;
    goButton.classList.toggle('go-mode', goMode);
    goButton.classList.toggle('refresh-mode', !goMode);
    goButton.setAttribute('aria-label', goMode ? 'Go to Remote Path' : 'Refresh Current Directory');
    goButton.dataset.tooltip = goMode ? 'Go to Remote Path' : 'Refresh Current Directory';
  }

  function runRemotePathAction() {
    if (goButton.disabled || !activeConnectionId || busy) return;
    const path = normalizeUiRemotePath(currentPath.value || '/');
    if (isRemotePathEdited()) {
      exitRemotePathEditMode({ reset: false });
      openPath(path);
      return;
    }
    listDirectory(path);
  }

  function updatePathFavoriteControls() {
    if (!togglePathFavoriteButton || !pathFavoritesButton) return;

    const hasActiveSession = Boolean(activeConnectionId);
    const hasSavedConnection = Boolean(getActiveProfile());
    const current = normalizeUiRemotePath(currentPath.value || '/');
    const isFavorite = hasSavedConnection && getFavoriteRemotePaths().includes(current);
    const disabled = busy || !hasActiveSession || !hasSavedConnection;
    const unavailableMessage = !hasActiveSession
      ? 'Connect to a Saved Connection to Use Remote Path Favorites'
      : 'Save This Connection to Use Remote Path Favorites';

    togglePathFavoriteButton.disabled = disabled;
    togglePathFavoriteButton.classList.toggle('active', isFavorite);
    togglePathFavoriteButton.setAttribute('aria-label', isFavorite ? 'Remove Remote Path Favorite' : 'Add Remote Path Favorite');
    togglePathFavoriteButton.dataset.tooltip = disabled
      ? unavailableMessage
      : (isFavorite ? 'Remove from Favorite Remote Paths' : 'Add to Favorite Remote Paths');

    pathFavoritesButton.disabled = disabled;
    pathFavoritesButton.classList.toggle('has-favorites', hasSavedConnection && getFavoriteRemotePaths().length > 0);
    pathFavoritesButton.dataset.tooltip = disabled ? unavailableMessage : 'Show Favorite Remote Paths';

    if (disabled) {
      hidePathFavoritesPopover();
    }
  }

  function showPathFavoritesPopover() {
    pathFavoritesOpen = true;
    renderPathFavoritesPopover();
    pathFavoritesPopover.classList.add('visible');
    pathFavoritesPopover.setAttribute('aria-hidden', 'false');
    hideWebviewTooltip();
  }

  function hidePathFavoritesPopover() {
    pathFavoritesOpen = false;
    if (!pathFavoritesPopover) return;
    pathFavoritesPopover.classList.remove('visible');
    pathFavoritesPopover.setAttribute('aria-hidden', 'true');
  }

  function renderPathFavoritesPopover() {
    if (!pathFavoritesList) return;

    const activeProfile = getActiveProfile();

    if (!activeProfile) {
      pathFavoritesList.innerHTML = '<div class="remote-path-favorites-empty">Save This Connection to Use Remote Path Favorites.</div>';
      return;
    }

    const favoriteRemotePaths = getFavoriteRemotePaths();

    if (!favoriteRemotePaths.length) {
      pathFavoritesList.innerHTML = '<div class="remote-path-favorites-empty">No favorite remote paths for this connection.</div>';
      return;
    }

    pathFavoritesList.innerHTML = favoriteRemotePaths.map(path => {
      const escapedPath = escapeHtml(path);
      return '<div class="remote-path-favorite-item">' +
        '<button type="button" class="remote-path-favorite-path" data-favorite-path="' + escapedPath + '" title="' + escapedPath + '">' + escapedPath + '</button>' +
        '<button type="button" class="remote-path-favorite-remove" data-favorite-action="remove" data-favorite-path="' + escapedPath + '" aria-label="Remove ' + escapedPath + '">×</button>' +
        '</div>';
    }).join('');
  }

  function setConnectionFieldInvalid(field, invalid) {
    if (!field) return;
    field.classList.toggle('connection-input-invalid', Boolean(invalid));
    if (invalid) {
      field.setAttribute('aria-invalid', 'true');
    } else {
      field.removeAttribute('aria-invalid');
    }
  }

  function clearConnectionFieldInvalid(field) {
    setConnectionFieldInvalid(field, false);
  }

  function clearConnectionValidationErrors() {
    for (const field of [host, port, username, password, privateKeyPath, ftpsCaCertificatePath]) {
      clearConnectionFieldInvalid(field);
    }
  }

  function hasPasswordForConnection() {
    const value = String(password.value || '');
    return value === SAVED_SECRET_MASK || value.length > 0;
  }

  function isValidConnectionPort(value) {
    const numeric = Number(String(value || '').trim());
    return Number.isFinite(numeric) && numeric > 0 && numeric <= 65535;
  }

  function getConnectionValidationErrors(action) {
    const mode = action === 'save' ? 'save' : 'connect';
    const normalizedConnectionType = normalizeConnectionTypeValue(connectionType.value);
    const normalizedAuthType = normalizedConnectionType === 'sftp' ? String(authType.value || 'password') : 'password';
    const isPrivateKeyAuth = normalizedConnectionType === 'sftp' && normalizedAuthType === 'privateKey';
    const requiresFtpsCaCertificate = normalizedConnectionType === 'ftps' && !Boolean(ftpsAllowSelfSignedCertificate.checked);
    const errors = [];

    if (!String(host.value || '').trim()) {
      errors.push({ field: host, label: 'Host', kind: 'required', message: 'Host is required.' });
    }

    if (!isValidConnectionPort(port.value)) {
      errors.push({ field: port, label: 'Port', kind: 'invalid', message: 'Port must be a number between 1 and 65535.' });
    }

    if (mode === 'connect' && !String(username.value || '').trim()) {
      errors.push({ field: username, label: 'Username', kind: 'required', message: 'Username is required to connect.' });
    }

    if (mode === 'connect' && !isPrivateKeyAuth && !hasPasswordForConnection()) {
      errors.push({ field: password, label: 'Password', kind: 'required', message: 'Password is required for password authentication.' });
    }

    if (mode === 'connect' && isPrivateKeyAuth && !String(privateKeyPath.value || '').trim()) {
      errors.push({ field: privateKeyPath, label: 'Private key path', kind: 'required', message: 'Private key path is required for private key authentication.' });
    }

    if (mode === 'connect' && requiresFtpsCaCertificate && !String(ftpsCaCertificatePath.value || '').trim()) {
      errors.push({ field: ftpsCaCertificatePath, label: 'CA certificate path', kind: 'required', message: 'CA certificate path is required for FTPS unless self-signed/untrusted certificates are allowed.' });
    }

    return errors;
  }

  function formatConnectionValidationSummary(errors) {
    if (!errors.length) return '';
    if (errors.length === 1) return errors[0].message;

    const requiredFields = errors.filter(error => error.kind === 'required').map(error => error.label);
    const invalidFields = errors.filter(error => error.kind === 'invalid').map(error => error.label);
    const parts = [];

    if (requiredFields.length) {
      parts.push('Required fields: ' + requiredFields.join(', ') + '.');
    }

    if (invalidFields.length) {
      parts.push('Invalid fields: ' + invalidFields.join(', ') + '.');
    }

    return parts.join(' ');
  }

  function normalizeConnectionNameForComparison(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getConnectionNameError(value, excludeProfileId) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return 'Connection name is required.';

    const duplicate = profiles.find(profile => {
      if (!profile || profile.id === excludeProfileId) return false;
      return normalizeConnectionNameForComparison(profile.name) === normalizeConnectionNameForComparison(trimmed);
    });

    return duplicate ? 'A connection named "' + trimmed + '" already exists.' : '';
  }

  function validateConnectionNameInput(showFeedback) {
    const message = getConnectionNameError(connectionNameInput.value, selectedProfileId || '');
    connectionNameFeedback.textContent = (showFeedback || message) ? message : '';
    connectionNameInput.classList.toggle('connection-input-invalid', Boolean(message));
    return !message;
  }

  function showConnectionNameDialog(initialName) {
    return new Promise(resolve => {
      pendingConnectionNameResolver = resolve;
      connectionNameInput.value = String(initialName || '').trim();
      connectionNameFeedback.textContent = '';
      connectionNameInput.classList.remove('connection-input-invalid');
      connectionNameBackdrop.classList.add('visible');
      connectionNameBackdrop.setAttribute('aria-hidden', 'false');
      window.setTimeout(() => {
        connectionNameInput.focus();
        connectionNameInput.select();
      }, 0);
    });
  }

  function closeConnectionNameDialog(value) {
    connectionNameBackdrop.classList.remove('visible');
    connectionNameBackdrop.setAttribute('aria-hidden', 'true');
    connectionNameInput.classList.remove('connection-input-invalid');
    connectionNameFeedback.textContent = '';
    const resolver = pendingConnectionNameResolver;
    pendingConnectionNameResolver = null;
    if (resolver) resolver(value);
  }

  function confirmConnectionNameDialog() {
    if (!validateConnectionNameInput(true)) return;
    closeConnectionNameDialog(String(connectionNameInput.value || '').trim());
  }

  async function saveCurrentConnection() {
    if (!validateConnectionForm('save')) return;

    if (!selectedProfileId) {
      const name = await showConnectionNameDialog(profileName.value || '');
      if (!name) return;
      profileName.value = name;
    } else {
      const nameError = getConnectionNameError(profileName.value, selectedProfileId);
      if (nameError) {
        setStatus(nameError, true);
        return;
      }
    }

    setBusy(true, 'Saving connection...');
    vscode.postMessage({ type: 'saveConnection', payload: collectConnectionPayload() });
  }

  function validateConnectionForm(action) {
    clearConnectionValidationErrors();

    const errors = getConnectionValidationErrors(action);
    if (!errors.length) return true;

    for (const error of errors) {
      setConnectionFieldInvalid(error.field, true);
    }

    const firstError = errors[0];
    setStatus(formatConnectionValidationSummary(errors), true);

    if (firstError.field && typeof firstError.field.focus === 'function') {
      firstError.field.focus();
      if (typeof firstError.field.select === 'function') {
        try { firstError.field.select(); } catch (error) { /* ignore */ }
      }
      if (typeof firstError.field.scrollIntoView === 'function') {
        try { firstError.field.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (error) { /* ignore */ }
      }
    }

    return false;
  }

  function collectConnectionPayload() {
    return {
      id: selectedProfileId || undefined,
      name: profileName.value,
      host: host.value,
      connectionType: normalizeConnectionTypeValue(connectionType.value),
      port: port.value,
      username: username.value,
      authType: authType.value,
      password: password.value === SAVED_SECRET_MASK ? '' : password.value,
      rememberPassword: rememberPassword.checked,
      privateKeyPath: privateKeyPath.value,
      passphrase: passphrase.value === SAVED_SECRET_MASK ? '' : passphrase.value,
      rememberPassphrase: rememberPassphrase.checked,
      startPath: startPath.value,
      keepAlive: keepAlive.checked,
      ftpsAllowSelfSignedCertificate: Boolean(ftpsAllowSelfSignedCertificate.checked),
      ftpsCaCertificatePath: ftpsCaCertificatePath.value
    };
  }

  function updateAuthFields() {
    const isSftp = isSftpFormConnection();
    if (!isSftp) {
      authType.value = 'password';
      hideAuthDropdown();
    }
    if (authMethodBlock) {
      authMethodBlock.classList.toggle('hidden', !isSftp);
    }
    const isPrivateKey = isSftp && authType.value === 'privateKey';
    hideTemporaryPassword(password);
    hideTemporaryPassword(passphrase);
    updateConnectionCredentialRevealControls();
    passwordBlock.classList.toggle('visible', !isPrivateKey);
    privateKeyBlock.classList.toggle('visible', isPrivateKey);
    passphraseBlock.classList.toggle('visible', isPrivateKey);
    updateConnectionTypeDropdown();
    updateAuthDropdown();
    updateFtpsCertificateFields();
  }

  function listDirectory(path) {
    if (!activeConnectionId || busy) return;
    setBusy(true, 'Loading ' + path + '...');
    vscode.postMessage({ type: 'listDirectory', payload: { path } });
  }

  function openPath(path) {
    if (!activeConnectionId || busy) return;
    setBusy(true, 'Opening ' + path + '...');
    vscode.postMessage({ type: 'openPath', payload: { path } });
  }



  function normalizeNavigationHistoryState(value) {
    const entries = Array.isArray(value && value.entries)
      ? value.entries.map(entry => normalizeUiRemotePath(entry || '/')).filter(Boolean)
      : [];
    if (!entries.length) return { entries: [], index: -1 };
    const index = Math.max(0, Math.min(entries.length - 1, Number.isFinite(Number(value.index)) ? Number(value.index) : entries.length - 1));
    return { entries, index };
  }

  function restoreNavigationHistoryFromState(value) {
    if (!value || typeof value !== 'object') return;
    const source = value.navigationHistoryByConnectionId && typeof value.navigationHistoryByConnectionId === 'object'
      ? value.navigationHistoryByConnectionId
      : value;
    for (const [connectionId, rawState] of Object.entries(source)) {
      if (!connectionId) continue;
      const normalizedState = normalizeNavigationHistoryState(rawState);
      if (normalizedState.index >= 0) {
        navigationHistoryByConnectionId.set(connectionId, normalizedState);
      }
    }
  }

  function serializeNavigationHistory() {
    const serialized = {};
    for (const [connectionId, state] of navigationHistoryByConnectionId.entries()) {
      const normalizedState = normalizeNavigationHistoryState(state);
      if (normalizedState.index >= 0) {
        serialized[connectionId] = normalizedState;
      }
    }
    return serialized;
  }

  function persistNavigationHistory() {
    const historyState = { navigationHistoryByConnectionId: serializeNavigationHistory() };
    vscode.setState(Object.assign({}, vscode.getState() || {}, historyState));
    try {
      localStorage.setItem(NAVIGATION_HISTORY_STORAGE_KEY, JSON.stringify(historyState));
    } catch (_) {
      // Ignore storage failures. vscode.setState still preserves the history while this webview is alive.
    }
  }

  function getNavigationHistoryState(connectionId) {
    const id = connectionId || activeConnectionId;
    if (!id) return { entries: [], index: -1 };
    let state = navigationHistoryByConnectionId.get(id);
    if (!state) {
      state = { entries: [], index: -1 };
      navigationHistoryByConnectionId.set(id, state);
    }
    return state;
  }



  function initializeNavigationHistoryForActiveSession() {
    const active = getActiveSession();
    if (!active || !active.currentPath) return;
    const state = getNavigationHistoryState(active.id || activeConnectionId);
    if (state.index >= 0) return;
    state.entries = [normalizeUiRemotePath(active.currentPath || '/')];
    state.index = 0;
    persistNavigationHistory();
  }

  function pruneNavigationHistoryForSessions() {
    const activeIds = new Set(sessions.map(session => session.id).filter(Boolean));
    let changed = false;
    for (const id of Array.from(navigationHistoryByConnectionId.keys())) {
      if (!activeIds.has(id)) {
        navigationHistoryByConnectionId.delete(id);
        changed = true;
      }
    }
    if (changed) persistNavigationHistory();
  }

  function recordNavigationHistory(path, mode) {
    if (!activeConnectionId) return;
    const normalizedPath = normalizeUiRemotePath(path || '/');
    const state = getNavigationHistoryState(activeConnectionId);

    if (mode === 'back' || mode === 'forward') {
      persistNavigationHistory();
      updateRemotePathNavigationControls();
      return;
    }

    if (state.entries[state.index] === normalizedPath) {
      updateRemotePathNavigationControls();
      return;
    }

    if (state.index < state.entries.length - 1) {
      state.entries = state.entries.slice(0, state.index + 1);
    }

    state.entries.push(normalizedPath);
    state.index = state.entries.length - 1;
    persistNavigationHistory();
    updateRemotePathNavigationControls();
  }

  function updateRemotePathNavigationControls() {
    const hasActiveSession = Boolean(activeConnectionId);
    const state = hasActiveSession ? getNavigationHistoryState(activeConnectionId) : { entries: [], index: -1 };
    if (remotePathBackButton) {
      remotePathBackButton.disabled = busy || !hasActiveSession || state.index <= 0;
    }
    if (remotePathForwardButton) {
      remotePathForwardButton.disabled = busy || !hasActiveSession || state.index < 0 || state.index >= state.entries.length - 1;
    }
  }

  function navigateRemotePathHistory(direction) {
    if (!activeConnectionId || busy) return;
    const state = getNavigationHistoryState(activeConnectionId);
    const nextIndex = direction === 'back' ? state.index - 1 : state.index + 1;
    if (nextIndex < 0 || nextIndex >= state.entries.length) return;

    state.index = nextIndex;
    persistNavigationHistory();
    pendingNavigationHistoryMode = direction;
    listDirectory(state.entries[nextIndex]);
    updateRemotePathNavigationControls();
  }

  function copyRemotePath(path) {
    if (!activeConnectionId || busy) return;
    vscode.postMessage({ type: 'copyRemotePath', payload: { path } });
  }

  function clearFilterText() {
    filterText = '';
    filterInput.value = '';
    updateFilterClearButton();
  }

  function applyFilterInput() {
    filterText = filterInput.value.trim().toLowerCase();
    updateFilterClearButton();
    const visibleEntries = getVisibleEntries();
    const visibleEntryPaths = new Set(visibleEntries.map(entry => entry.path || entry.name));
    selectedEntryPaths = new Set(Array.from(selectedEntryPaths).filter(entryPath => visibleEntryPaths.has(entryPath)));
    if (selectedEntryPath && !selectedEntryPaths.has(selectedEntryPath)) {
      selectedEntryPath = Array.from(selectedEntryPaths).pop() || '';
    }
    renderEntries(visibleEntries);
  }

  function updateFilterClearButton() {
    const hasValue = Boolean(filterInput.value);
    filterBox.classList.toggle('has-value', hasValue);
    clearFilterButton.disabled = filterInput.disabled || !hasValue;
  }

  function scrollEntriesToTop() {
    entriesTableWrap.scrollTop = 0;
    entriesTableWrap.scrollLeft = 0;
  }

  function renderEntries(entries) {
    entriesBody.innerHTML = '';

    if (!entries.length) {
      const message = filterText ? 'No items match the current filter.' : 'This folder is empty.';
      entriesBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">' + message + '</div></td></tr>';
      return;
    }

    for (const entry of entries) {
      const row = document.createElement('tr');
      const isParentEntry = entry.name === '..' && entry.type === 'directory';
      const entryKey = entry.path || entry.name;
      row.className = 'entry-row' + (selectedEntryPaths.has(entryKey) ? ' selected' : '');
      row.dataset.entryPath = entryKey;
      row.innerHTML = '<td><div class="entry-name"><span class="entry-icon">' + iconFor(entry) + '</span><span class="entry-text">' + escapeHtml(formatEntryName(entry)) + '</span></div></td>' +
        '<td class="type">' + escapeHtml(formatEntryType(entry)) + '</td>' +
        '<td class="size">' + (isDirectoryLike(entry) ? '' : formatSize(entry.size)) + '</td>' +
        '<td class="owner">' + escapeHtml(formatMetadata(entry.owner)) + '</td>' +
        '<td class="group">' + escapeHtml(formatMetadata(entry.group)) + '</td>' +
        '<td class="permissions">' + escapeHtml(entry.permissions || '') + '</td>' +
        '<td class="modified">' + formatDate(entry.modifyTime) + '</td>';

      row.addEventListener('click', event => {
        hideContextMenu();

        if (isParentEntry) {
          selectEntry(entryKey);
          return;
        }

        if (event.shiftKey && selectionAnchorPath) {
          selectEntryRange(selectionAnchorPath, entryKey);
        } else if (event.metaKey || event.ctrlKey) {
          toggleEntrySelection(entryKey);
        } else {
          selectEntry(entryKey);
        }
      });

      row.addEventListener('dblclick', () => {
        hideContextMenu();
        vscode.postMessage({ type: 'openEntry', payload: entry });
      });

      row.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
        hideContextMenu();
        if (!selectedEntryPaths.has(entryKey)) {
          selectEntry(entryKey);
        } else {
          selectedEntryPath = entryKey;
        }
        if (!isParentEntry) {
          showContextMenu(entry, event.clientX, event.clientY);
        }
      });

      entriesBody.appendChild(row);
    }
  }

  function selectEntry(entryPath) {
    selectedEntryPaths = new Set([entryPath]);
    selectedEntryPath = entryPath;
    selectionAnchorPath = entryPath;
    syncSelectedRows();
  }

  function toggleEntrySelection(entryPath) {
    if (selectedEntryPaths.has(entryPath)) {
      selectedEntryPaths.delete(entryPath);
      if (selectedEntryPath === entryPath) {
        selectedEntryPath = Array.from(selectedEntryPaths).pop() || '';
      }
    } else {
      selectedEntryPaths.add(entryPath);
      selectedEntryPath = entryPath;
      selectionAnchorPath = entryPath;
    }

    syncSelectedRows();
  }

  function selectEntryRange(anchorPath, targetPath) {
    const visibleEntries = getVisibleEntries().filter(entry => !isParentEntry(entry));
    const visiblePaths = visibleEntries.map(entry => entry.path || entry.name);
    const anchorIndex = visiblePaths.indexOf(anchorPath);
    const targetIndex = visiblePaths.indexOf(targetPath);

    if (anchorIndex === -1 || targetIndex === -1) {
      selectEntry(targetPath);
      return;
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    selectedEntryPaths = new Set(visiblePaths.slice(start, end + 1));
    selectedEntryPath = targetPath;
    syncSelectedRows();
  }

  function syncSelectedRows() {
    for (const row of entriesBody.querySelectorAll('tr.entry-row')) {
      const entryPath = row.dataset.entryPath || '';
      row.classList.toggle('selected', selectedEntryPaths.has(entryPath));
    }
    updateTransferButtons();
  }

  function clearEntrySelection() {
    selectedEntryPath = '';
    selectedEntryPaths.clear();
    selectionAnchorPath = '';
    syncSelectedRows();
  }

  function showContextMenu(entry, clientX, clientY) {
    if (busy || !activeConnectionId) return;

    const selectedEntries = getSelectedActionEntries();
    setEntryContextActionsVisible(selectedEntries);
    entryContextMenu.classList.add('visible');
    entryContextMenu.style.left = '0px';
    entryContextMenu.style.top = '0px';

    const menuRect = entryContextMenu.getBoundingClientRect();
    const left = Math.min(clientX, Math.max(0, window.innerWidth - menuRect.width - 8));
    const top = Math.min(clientY, Math.max(0, window.innerHeight - menuRect.height - 8));
    entryContextMenu.style.left = left + 'px';
    entryContextMenu.style.top = top + 'px';
  }

  function setEntryContextActionsVisible(entries) {
    const selectedEntries = Array.isArray(entries) ? entries : [];
    const hasEntryActions = selectedEntries.length > 0;
    const isSingleEntry = selectedEntries.length === 1;
    const selectedTypes = selectedEntries.map(entry => getEffectiveEntryType(entry));
    const hasDirectory = selectedTypes.includes('directory');
    const allDirectories = hasEntryActions && selectedTypes.every(type => type === 'directory');
    const allFiles = hasEntryActions && selectedEntries.every(entry => getEffectiveEntryType(entry) === 'file' || entry.type === 'link');
    const isSingleDirectory = isSingleEntry && allDirectories;
    const isSingleFile = isSingleEntry && allFiles;
    const isMixedSelection = hasEntryActions && !allDirectories && !allFiles;
    const capabilities = getActiveRemoteCapabilities();
    const canOpen = isSingleDirectory || allFiles;
    const canOpenReadOnly = allFiles;
    const canCompare = selectedEntries.length === 2 && allFiles;
    const canMakeCopy = isSingleFile && selectedEntries[0].type === 'file';
    const canRename = isSingleEntry;
    const canCopy = hasEntryActions;
    const canCompress = hasEntryActions && capabilities.canCreateArchive;
    const canCalculateChecksums = canMakeCopy && capabilities.canCalculateServerChecksums;
    const canShowProperties = isSingleEntry;
    const canChangePermissions = hasEntryActions && capabilities.canChangePermissions;
    const canChangeOwnerGroup = hasEntryActions && capabilities.canChangeOwnerGroup;
    const hasCurrentDirectoryActions = Boolean(activeConnectionId) && !hasEntryActions;
    const canRefresh = Boolean(activeConnectionId);
    const canRunRemoteCommand = Boolean(activeConnectionId) && capabilities.canRunCommand;
    const canOpenSshTerminal = canRunRemoteCommand && capabilities.canOpenSshTerminal;
    const canUpload = Boolean(activeConnectionId) && !hasEntryActions;
    const canCopyCurrentPath = Boolean(activeConnectionId) && !hasEntryActions;
    const canDownload = hasEntryActions;
    const canUploadWithEntryActions = Boolean(activeConnectionId) && canDownload;
    const canDelete = hasEntryActions;

    contextOpen.style.display = canOpen ? '' : 'none';
    contextOpen.textContent = isSingleDirectory
      ? 'Enter Directory'
      : (isSingleEntry && selectedEntries[0].type === 'link' ? 'Open Link' : 'View/Edit');
    contextOpenReadOnly.style.display = canOpenReadOnly ? '' : 'none';
    contextCompare.style.display = canCompare ? '' : 'none';

    contextOpenSeparator.style.display = (canOpen || canOpenReadOnly || canCompare) && (canMakeCopy || canRename || canCopy || canCompress || canDownload || canRefresh || canDelete) ? '' : 'none';

    contextMakeCopy.style.display = canMakeCopy ? '' : 'none';
    contextRename.style.display = canRename ? '' : 'none';

    contextCopySeparator.style.display = (canCopy || canCompress) && (canMakeCopy || canRename || canOpen || canOpenReadOnly || canCompare) ? '' : 'none';
    contextCopyPath.style.display = canCopy ? '' : 'none';
    contextCopyName.style.display = canCopy ? '' : 'none';
    contextCompressSubmenu.style.display = canCompress ? '' : 'none';

    contextCopyPath.textContent = selectedEntries.length > 1 ? 'Copy Paths' : 'Copy Path';
    if (selectedEntries.length > 1) {
      contextCopyName.textContent = isMixedSelection ? 'Copy Names' : allDirectories ? 'Copy Directory Names' : 'Copy Filenames';
    } else {
      contextCopyName.textContent = isSingleDirectory ? 'Copy Directory Name' : 'Copy Filename';
    }

    contextItemSeparator.style.display = (canDownload || canCalculateChecksums || canShowProperties || canChangePermissions || canChangeOwnerGroup) && (canCopy || canCompress || canMakeCopy || canRename || canOpen || canOpenReadOnly || canCompare) ? '' : 'none';
    contextDownload.style.display = canDownload ? '' : 'none';
    contextDownload.textContent = selectedEntries.length > 1 ? 'Download Selected...' : 'Download...';
    contextUploadEntry.style.display = canUploadWithEntryActions ? '' : 'none';
    contextUploadEntry.textContent = 'Upload...';
    contextCalculateChecksums.style.display = canCalculateChecksums ? '' : 'none';
    contextFileProperties.style.display = canShowProperties ? '' : 'none';
    contextSetPermissions.style.display = canChangePermissions ? '' : 'none';
    contextChangeOwnerGroup.style.display = canChangeOwnerGroup ? '' : 'none';

    contextRefreshSeparator.style.display = (hasCurrentDirectoryActions || canRefresh || canRunRemoteCommand || canUpload) && (hasEntryActions || canOpen || canOpenReadOnly || canCompare) ? '' : 'none';
    contextCreateFile.style.display = hasCurrentDirectoryActions ? '' : 'none';
    contextCreateDirectory.style.display = hasCurrentDirectoryActions ? '' : 'none';
    contextUpload.style.display = canUpload ? '' : 'none';
    contextUpload.textContent = 'Upload...';
    contextEmptyCopySeparator.style.display = canCopyCurrentPath && canUpload ? '' : 'none';
    contextCopyCurrentPath.style.display = canCopyCurrentPath ? '' : 'none';
    contextEmptyRefreshSeparator.style.display = canCopyCurrentPath && (canRefresh || canRunRemoteCommand || canOpenSshTerminal) ? '' : 'none';
    contextRefresh.style.display = canRefresh ? '' : 'none';
    contextRunRemoteCommand.style.display = canRunRemoteCommand ? '' : 'none';
    contextOpenSshTerminal.style.display = canOpenSshTerminal ? '' : 'none';

    contextDeleteSeparator.style.display = canDelete ? '' : 'none';
    contextDelete.style.display = canDelete ? '' : 'none';
    contextDelete.textContent = selectedEntries.length > 1 ? 'Delete Selected' : 'Delete';

    normalizeContextMenuSeparators();
  }

  function isContextMenuNodeVisible(node) {
    return node && node.style && node.style.display !== 'none';
  }

  function normalizeContextMenuSeparators() {
    const nodes = Array.from(entryContextMenu.children);
    const isSeparator = node => node.classList && node.classList.contains('context-menu-separator');

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!isSeparator(node) || !isContextMenuNodeVisible(node)) continue;

      let previousVisible = null;
      for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
        if (isContextMenuNodeVisible(nodes[previousIndex])) {
          previousVisible = nodes[previousIndex];
          break;
        }
      }

      let nextVisible = null;
      for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
        if (isContextMenuNodeVisible(nodes[nextIndex])) {
          nextVisible = nodes[nextIndex];
          break;
        }
      }

      const shouldHide = !previousVisible || !nextVisible || isSeparator(previousVisible) || isSeparator(nextVisible);
      if (shouldHide) node.style.display = 'none';
    }
  }

  function copyCurrentRemotePathText() {
    const path = normalizeUiRemotePath(currentPath.value || '/');
    vscode.postMessage({ type: 'copyStatus', payload: { text: path, message: 'Copied current path' } });
  }

  function copySelectedEntryText(entries, field) {
    const selectedEntries = Array.isArray(entries) ? entries.filter(entry => entry && !isParentEntry(entry)) : [];
    if (!selectedEntries.length) return;

    const values = selectedEntries.map(entry => String(field === 'name' ? entry.name || '' : entry.path || '').trim()).filter(Boolean);
    if (!values.length) return;

    const plural = values.length > 1;
    const message = field === 'name'
      ? (plural ? 'Copied names' : 'Copied name')
      : (plural ? 'Copied paths' : 'Copied path');

    vscode.postMessage({ type: 'copyStatus', payload: { text: values.join('\\n'), message } });
  }

  function hideContextMenu() {
    if (entryContextMenu) entryContextMenu.classList.remove('visible');
  }

  function getRemoteParentPath(path) {
    const normalized = normalizeUiRemotePath(path || '/');
    if (normalized === '/') return '/';
    const trimmed = normalized.replace(/\\/+$/, '');
    const index = trimmed.lastIndexOf('/');
    return index <= 0 ? '/' : trimmed.slice(0, index);
  }

  function getContextWorkingDirectory() {
    const entries = getSelectedActionEntries();
    if (entries.length !== 1) return normalizeUiRemotePath(currentPath.value || '/');

    const entry = entries[0];
    const entryType = getEffectiveEntryType(entry);
    if (entryType === 'directory') {
      return normalizeUiRemotePath(entry.path || currentPath.value || '/');
    }

    return getRemoteParentPath(entry.path || currentPath.value || '/');
  }

  function getSelectedActionEntries() {
    if (!canStartTransferAction() || selectedEntryPaths.size === 0) return [];
    return currentEntries.filter(item => selectedEntryPaths.has(item.path || item.name) && !isParentEntry(item));
  }

  function getSelectedActionEntry() {
    const entries = getSelectedActionEntries();
    return entries.length === 1 ? entries[0] : null;
  }

  function actionPayload(entry) {
    return {
      path: entry.path,
      name: entry.name,
      type: entry.type,
      effectiveType: entry.effectiveType || '',
      linkTarget: entry.linkTarget || '',
      permissions: entry.permissions || ''
    };
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/"/g, '\\"');
  }

  function getVisibleEntries() {
    const parentEntries = currentEntries.filter(isParentEntry);
    let visibleEntries = currentEntries.filter(entry => !isParentEntry(entry));

    if (filterText) {
      visibleEntries = visibleEntries.filter(entry => String(entry.name || '').toLowerCase().includes(filterText));
    }

    if (currentSort.key && currentSort.direction) {
      const directionMultiplier = currentSort.direction === 'asc' ? 1 : -1;
      visibleEntries.sort((left, right) => compareEntries(left, right, currentSort.key) * directionMultiplier);
    }

    return parentEntries.concat(visibleEntries);
  }

  function isParentEntry(entry) {
    return entry && entry.name === '..' && entry.type === 'directory';
  }

  function cycleSort(key) {
    if (!key) return;

    if (currentSort.key !== key) {
      currentSort = { key, direction: 'asc' };
    } else if (currentSort.direction === 'asc') {
      currentSort = { key, direction: 'desc' };
    } else {
      currentSort = { key: '', direction: '' };
    }

    updateSortIndicators();
    renderEntries(getVisibleEntries());
  }

  function updateSortIndicators() {
    for (const header of entriesTable.querySelectorAll('th.sortable')) {
      const indicator = header.querySelector('.sort-indicator');
      const isActive = header.dataset.sortKey === currentSort.key && currentSort.direction;
      header.setAttribute('aria-sort', isActive ? (currentSort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      if (indicator) indicator.textContent = isActive ? (currentSort.direction === 'asc' ? '↑' : '↓') : '';
    }
  }

  function compareEntries(left, right, key) {
    if (key === 'size' || key === 'modified') {
      return compareNumbers(sortValue(left, key), sortValue(right, key));
    }

    return compareText(sortValue(left, key), sortValue(right, key));
  }

  function sortValue(entry, key) {
    if (key === 'modified') return Number(entry.modifyTime || 0);
    if (key === 'size') return isDirectoryLike(entry) ? -1 : Number(entry.size || 0);
    if (key === 'type') return formatEntryType(entry);
    if (key === 'name') return formatEntryName(entry);
    if (key === 'owner') return formatMetadata(entry.owner);
    if (key === 'group') return formatMetadata(entry.group);
    if (key === 'permissions') return entry.permissions || '';
    return entry[key] || '';
  }

  function compareNumbers(left, right) {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  function compareText(left, right) {
    return String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' });
  }

  function applyColumnWidths() {
    let totalWidth = 0;
    for (const column of columnOrder) {
      const width = columnWidths[column];
      totalWidth += width;
      const col = entriesTable.querySelector('col[data-column="' + column + '"]');
      if (col) col.style.width = width + 'px';
    }
    entriesTable.style.minWidth = totalWidth + 'px';
  }

  function startColumnResize(event) {
    event.preventDefault();
    event.stopPropagation();

    const resizer = event.currentTarget;
    const column = resizer.dataset.column;
    if (!column) return;

    const startX = event.clientX;
    const startWidth = columnWidths[column] || minColumnWidths[column] || 72;
    resizer.classList.add('resizing');
    document.body.classList.add('resizing-columns');

    const onMouseMove = moveEvent => {
      const minWidth = minColumnWidths[column] || 72;
      columnWidths[column] = Math.max(minWidth, startWidth + moveEvent.clientX - startX);
      applyColumnWidths();
    };

    const onMouseUp = () => {
      resizer.classList.remove('resizing');
      document.body.classList.remove('resizing-columns');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  const entryIcons = {
    file: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M252.31-100Q222-100 201-121q-21-21-21-51.31v-615.38Q180-818 201-839q21-21 51.31-21H570l210 210v477.69Q780-142 759-121q-21 21-51.31 21H252.31ZM540-620v-180H252.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v615.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85h455.38q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46V-620H540ZM240-800v180-180V-160v-640Z"/></svg>',
    folder: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M172.31-180Q142-180 121-201q-21-21-21-51.31v-455.38Q100-738 121-759q21-21 51.31-21h219.61l80 80h315.77Q818-700 839-679q21 21 21 51.31v375.38Q860-222 839-201q-21 21-51.31 21H172.31Z"/></svg>',
    link: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M323-140q-75.85 0-129.42-53.58Q140-247.15 140-323q0-36.92 13.66-70.23 13.65-33.31 39.73-59.38l127.46-126.47L363-536.92 235.54-409.85q-17.77 17.77-26.85 40.23-9.07 22.47-9.07 46.62 0 51.31 36.03 87.15Q271.69-200 323-200q24.15 0 46.92-9.08 22.77-9.07 40.54-26.84L537.31-363l42.77 42.77-127.47 126.46q-26.07 26.08-59.38 39.92Q359.92-140 323-140Zm76.31-216.92-42.39-42.77 203.77-203.77 42.77 42.77-204.15 203.77Zm239.84-23.39L597-422.69l127.46-126.85q17.39-17.38 26.16-39.34 8.76-21.97 8.76-46.12 0-51.92-35.73-88.46Q687.92-760 636-760q-24.15 0-46.62 9.08-22.46 9.07-39.84 26.46L422.69-597l-42.38-42.15 127.08-127.08q26.07-26.08 59.38-39.92Q600.08-820 637-820q75.85 0 129.11 53.77 53.27 53.77 53.27 130.23 0 36.31-13.34 69.42-13.35 33.12-39.43 59.19L639.15-380.31Z"/></svg>',
    unknown: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M438.62-329.23q0-67.92 15.65-104t65.35-80q38.69-34.46 58.65-62.5t19.96-63.58q0-47.15-32.11-78.38-32.12-31.23-88.43-31.23-51.38 0-80 27.53-28.61 27.54-43.46 61.47l-73-32.08q23.31-57.46 72.77-95.81 49.46-38.34 123.69-38.34 96.92 0 149.19 54.65 52.27 54.65 52.27 129.73 0 46.92-20.34 82.81-20.35 35.88-61.73 74.73-52.08 47.77-64.5 75.34-12.43 27.58-12.43 79.66h-81.53ZM477.69-100q-24.54 0-42.27-17.73-17.73-17.73-17.73-42.27 0-24.54 17.73-42.27Q453.15-220 477.69-220q24.54 0 42.27 17.73 17.73 17.73 17.73 42.27 0 24.54-17.73 42.27Q502.23-100 477.69-100Z"/></svg>'
  };

  function iconFor(entryOrType) {
    const originalType = typeof entryOrType === 'string' ? entryOrType : entryOrType.type;
    const type = typeof entryOrType === 'string' ? entryOrType : getEffectiveEntryType(entryOrType);
    if (originalType === 'link') return entryIcons.link;
    if (type === 'directory') return entryIcons.folder;
    if (type === 'unknown') return entryIcons.unknown;
    return entryIcons.file;
  }

  function getEffectiveEntryType(entry) {
    if (!entry) return 'unknown';
    if (entry.effectiveType === 'file' || entry.effectiveType === 'directory') return entry.effectiveType;
    return entry.type || 'unknown';
  }

  function isDirectoryLike(entry) {
    return getEffectiveEntryType(entry) === 'directory';
  }

  function formatEntryName(entry) {
    if (entry && entry.type === 'link' && entry.linkTarget) {
      return String(entry.name || '') + ' -> ' + String(entry.linkTarget || '');
    }

    return String(entry && entry.name ? entry.name : '');
  }

  function formatEntryType(entry) {
    if (entry && entry.type === 'link') {
      return 'link';
    }

    return String(entry && entry.type ? entry.type : 'unknown');
  }

  function formatSize(size) {
    const value = Number(size || 0);
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB';
    return (value / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  }

  function formatDate(value) {
    const timestamp = Number(value || 0);
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString();
  }

  function formatMetadata(value) {
    if (value === undefined || value === null || value === '') return '';
    return String(value);
  }

  function showStatusCopyFeedback(message) {
    if (!statusCopyFeedback) return;
    statusCopyFeedback.textContent = message || 'Copied';
    statusCopyFeedback.classList.add('visible');
    if (statusCopyFeedbackTimer) window.clearTimeout(statusCopyFeedbackTimer);
    statusCopyFeedbackTimer = window.setTimeout(() => {
      statusCopyFeedback.classList.remove('visible');
      statusCopyFeedbackTimer = 0;
    }, 1400);
  }

  function updateTransferQueueState(payload) {
    transferQueueState = {
      current: payload && payload.current ? payload.current : null,
      currentTransfers: Array.isArray(payload && payload.currentTransfers) ? payload.currentTransfers : (payload && payload.current ? [payload.current] : []),
      pending: Array.isArray(payload && payload.pending) ? payload.pending : [],
      completed: Array.isArray(payload && payload.completed) ? payload.completed : []
    };
    renderTransferQueueButton();
    if (transferQueueModalOpen) renderTransferQueueModal();
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

    transferQueueCurrent.innerHTML = currentTransfers.map(current => renderTransferQueueItem(current, {
      action: current.canCancel ? 'cancel-current' : '',
      actionLabel: current.status === 'Canceling' ? 'Canceling...' : 'Cancel',
      disabled: !current.canCancel
    })).join('');
  }

  function renderPendingTransferQueueItems() {
    if (!transferQueuePending) return;

    const pending = transferQueueState.pending || [];

    if (!pending.length) {
      transferQueuePending.innerHTML = '<div class="transfer-queue-empty">No pending transfers.</div>';
      return;
    }

    transferQueuePending.innerHTML = pending.map(item => renderTransferQueueItem(item, {
      action: 'remove-pending',
      actionLabel: 'Remove',
      disabled: false
    })).join('');
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

      return '<div class="transfer-queue-failed-item" title="' + escapeHtml(parsed.raw) + '">' +
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

  function setBusy(isBusy, message, cancelAction = '', cancelLabel = 'Cancel') {
    busy = isBusy;
    statusCancelAction = isBusy ? String(cancelAction || '') : '';
    statusCancelLabel = String(cancelLabel || 'Cancel');
    if (!busy && isConnectionTransitionBusy()) {
      connectionButtonState = '';
    }
    if (busy) {
      hideContextMenu();
      hideProfileDropdown();
    }
    setControls();
    if (message) statusText.textContent = message;
    setStatusOutputLink(false);
    status.className = isBusy ? 'statusbar busy' : 'statusbar';
  }

  function setStatus(message, isError = false, showOutputLink = false, outputLinkText = 'See details in Output.') {
    busy = false;
    statusCancelAction = '';
    statusCancelLabel = 'Cancel';
    setControls();
    statusText.textContent = message;
    setStatusOutputLink(showOutputLink, outputLinkText);
    status.className = isError ? 'statusbar error' : 'statusbar';
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

  function setControls() {
    const hasActiveSession = Boolean(activeConnectionId);
    const connectedSession = getConnectedSessionForCurrentForm();
    const isConnectedForm = Boolean(connectedSession);
    const shouldLockConnectionPicker = busy;
    const shouldLockConnectionDetails = busy || isConnectedForm;
    const isSftpConnectionMethod = isSftpFormConnection();
    const capabilities = getActiveRemoteCapabilities();
    const showRunRemoteCommand = capabilities.canRunCommand;
    const showSudoMode = capabilities.canUseSudo;
    const nextToolbarCapabilityState = (showRunRemoteCommand ? '1' : '0') + ':' + (showSudoMode ? '1' : '0');
    const shouldAnimateToolbarLayout = Boolean(toolbarCapabilityState && toolbarCapabilityState !== nextToolbarCapabilityState);
    const toolbarLayoutSnapshot = shouldAnimateToolbarLayout ? prepareToolbarLayoutTransition() : null;

    if (pathbar) {
      pathbar.classList.toggle('hide-command-actions', !showRunRemoteCommand);
      pathbar.classList.toggle('hide-sudo-actions', !showSudoMode);
    }
    if (commandActions) commandActions.style.display = showRunRemoteCommand ? '' : 'none';
    if (commandActionsSeparator) commandActionsSeparator.style.display = showRunRemoteCommand ? '' : 'none';
    if (transferActionsSeparator) transferActionsSeparator.style.display = '';
    if (sudoToggleLabel) sudoToggleLabel.style.display = showSudoMode ? '' : 'none';
    if (sudoToggleSeparator) sudoToggleSeparator.style.display = showSudoMode ? '' : 'none';
    toolbarCapabilityState = nextToolbarCapabilityState;
    if (shouldAnimateToolbarLayout) finishToolbarLayoutTransition(toolbarLayoutSnapshot);

    connectButton.disabled = busy;
    connectButton.textContent = connectionButtonState === 'connecting'
      ? 'Connecting...'
      : connectionButtonState === 'disconnecting'
        ? 'Disconnecting...'
        : (isConnectedForm ? 'Disconnect' : 'Connect');
    connectButton.classList.toggle('secondary', isConnectedForm || connectionButtonState === 'disconnecting');

    saveProfileButton.disabled = busy || isConnectedForm;
    profileSelect.disabled = shouldLockConnectionPicker;
    profileDropdownButton.disabled = shouldLockConnectionPicker;
    manageProfilesButton.disabled = busy;
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
    if (connectButton) connectButton.title = '';
    updateFtpsCertificateFields(shouldLockConnectionDetails);

    if (shouldLockConnectionDetails || !connectionTypeDropdownButton || connectionTypeDropdownButton.disabled) hideConnectionTypeDropdown();
    if (shouldLockConnectionDetails || !authDropdownButton || authDropdownButton.disabled) hideAuthDropdown();
    if (busy) hideProfileDropdown();

    currentPath.disabled = busy || !hasActiveSession;
    if (currentPath.disabled && remotePathEditing) {
      exitRemotePathEditMode({ reset: true, keepFocus: true });
    }
    updateRemotePathBreadcrumb();
    filterInput.disabled = busy || !hasActiveSession;
    if (runRemoteCommandButton) runRemoteCommandButton.disabled = busy || !hasActiveSession || !capabilities.canRunCommand;
    if (openSshTerminalButton) openSshTerminalButton.disabled = busy || !hasActiveSession || !capabilities.canOpenSshTerminal;
    updateFilterClearButton();
    updateTransferButtons();
    renderTransferQueueButton();
    updatePathFavoriteControls();
    updateRemotePathBreadcrumb();
    uploadButton.disabled = !canStartTransferAction() || !hasActiveSession;
    goButton.disabled = busy || !hasActiveSession;
    updateRemotePathActionButton();
    updateRemotePathNavigationControls();
    sudoToggle.disabled = busy || !hasActiveSession || !capabilities.canUseSudo;
    updateSudoToggle();
    scheduleRemotePathLayoutUpdate();
  }


  function updateTransferButtons() {
    const hasActiveSession = Boolean(activeConnectionId);
    if (uploadButton) uploadButton.disabled = !canStartTransferAction() || !hasActiveSession;
    if (downloadButton) downloadButton.disabled = !canStartTransferAction() || !hasActiveSession || getSelectedActionEntries().length === 0;
    renderTransferQueueButton();
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  </script>
</body>
</html>`;
}
