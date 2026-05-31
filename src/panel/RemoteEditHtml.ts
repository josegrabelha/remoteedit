import * as vscode from 'vscode';

export function renderRemoteEditHtml(webview: vscode.Webview, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RemoteEdit</title>
  <style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); overflow: hidden; user-select: none; -webkit-user-select: none; }
  input, textarea { user-select: text; -webkit-user-select: text; }
  .page { height: 100vh; padding: 16px 6px; display: flex; min-width: 0; }
  .shell { width: 100%; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .hero { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; padding-bottom: 13px; border-bottom: 1px solid var(--vscode-panel-border); flex: 0 0 auto; min-width: 0; }
  .eyebrow { color: var(--vscode-descriptionForeground); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 7px; }
  h1 { margin: 0; font-size: 26px; line-height: 1.2; font-weight: 650; }
  .description { margin: 8px 0 0; color: var(--vscode-descriptionForeground); max-width: 920px; line-height: 1.45; }
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
  .layout { position: relative; display: grid; grid-template-columns: minmax(300px, 390px) minmax(0, 1fr); gap: 16px; margin-top: 12px; align-items: stretch; flex: 1 1 auto; min-height: 0; min-width: 0; }
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
    .layout.connection-transition-ready { transition: grid-template-columns 180ms ease-out, gap 180ms ease-out; }
    .layout.connection-transition-ready .connection-card { transition: opacity 140ms ease-out, transform 180ms ease-out, border-color 140ms ease-out; }
    .layout.connection-transition-ready .connection-panel-handle { transition: opacity 140ms ease-out, transform 180ms ease-out; }
    .layout.connection-transition-ready .connection-panel-handle .panel-toggle-button { transition: opacity 140ms ease-out, background-color 140ms ease-out, color 140ms ease-out; }
  }
  .browser-column { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .browser-card { flex: 1 1 auto; }
  .browser-open-section { display: grid; grid-template-columns: minmax(150px, auto) minmax(0, 1fr); column-gap: 14px; align-items: center; min-height: 63px; padding: 13px 14px; background: var(--vscode-editor-background); }
  .browser-open-text { min-width: 0; }
  .browser-open-section .card-subtitle { margin-top: 4px; }
  .browser-title-section { padding: 13px 14px; background: var(--vscode-editor-background); }
  .open-connections-row { display: flex; align-items: center; min-width: 0; min-height: 32px; }
  .browser-session-strip { margin-top: 0; min-height: 32px; padding-bottom: 0; flex: 1 1 auto; min-width: 0; justify-content: flex-start; }
  .browser-section-divider { height: 1px; background: var(--vscode-panel-border); flex: 0 0 auto; }
  .card { border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .connection-card { position: relative; opacity: 1; transform: translateX(0); }
  .card-header { padding: 13px 14px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
  .connection-card-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; min-height: 63px; padding-right: 36px; }
  .connection-card-title-text { min-width: 0; }
  .panel-toggle-button { width: 28px; min-width: 28px; height: 28px; min-height: 28px; padding: 4px; border-radius: 3px; flex: 0 0 auto; }
  .panel-toggle-button svg { width: 16px; height: 16px; }
  .browser-open-text-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .card-title { font-weight: 650; margin: 0; }
  .card-subtitle { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
  .card-body { padding: 14px; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden; }
  .browser-card .card-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .form-grid { display: grid; grid-template-columns: minmax(0, 1fr) 70px; gap: 10px; min-width: 0; }
  .full { grid-column: 1 / -1; }
  .keepalive-row { margin-top: 8px; margin-bottom: 0; }
  label { display: block; font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 5px; }
  input, select { width: 100%; height: 31px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 5px 8px; border-radius: 3px; outline: none; }
  input:focus, select:focus { border-color: var(--vscode-focusBorder); }
  input:disabled, select:disabled { opacity: 0.68; }
  .input-with-button { position: relative; display: flex; align-items: center; }
  .input-with-button input { padding-right: 34px; }
  .input-icon-button { position: absolute; top: 2px; right: 2px; width: 27px; min-width: 27px; height: 27px; min-height: 27px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 0; border-left: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 0 2px 2px 0; background: transparent; color: var(--vscode-input-foreground); opacity: 0.8; }
  .input-icon-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .input-icon-button svg { width: 15px; height: 15px; display: block; fill: currentColor; }
  .button-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  .connection-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-items: center; width: 100%; min-width: 0; }
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
  .profile-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 8px; align-items: end; margin-bottom: 12px; min-width: 0; }
  .profile-row .tooltip-anchor, .profile-row .has-tooltip { align-self: end; }
  .connection-name-row { grid-column: 1 / -1; }
  .connection-config-divider { grid-column: 1 / -1; height: 1px; background: var(--vscode-panel-border); margin: 2px 0 4px; }
  .divider { height: 1px; background: var(--vscode-panel-border); margin: 14px 0; }
  .hint-list { margin: 14px 0 0; padding-left: 17px; color: var(--vscode-descriptionForeground); line-height: 1.5; font-size: 12px; }
  .auth-block { display: none; }
  .auth-block.visible { display: block; }
  .checkbox-row { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; color: var(--vscode-foreground); font-size: 12px; }
  .checkbox-row input { width: auto; height: auto; margin: 0; }
  .credential-state { margin-top: 6px; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.35; }
  .credential-state.saved { color: var(--vscode-testing-iconPassed, var(--vscode-descriptionForeground)); }
  .credential-state.not-saved { color: var(--vscode-descriptionForeground); }
  .browser-header { display: block; }
  .browser-title-row { display: flex; justify-content: space-between; gap: 12px; align-items: flex-end; min-width: 0; }
  .browser-title-text { min-width: 0; }
  .sudo-toggle { display: inline-flex; align-items: center; align-self: flex-end; gap: 5px; margin: 0; padding-bottom: 1px; font-size: 11px; line-height: 16px; color: var(--vscode-descriptionForeground); cursor: pointer; user-select: none; white-space: nowrap; }
  .sudo-toggle input { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; }
  .sudo-toggle-track { position: relative; width: 30px; height: 16px; border-radius: 999px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease; }
  .sudo-toggle-thumb { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--vscode-descriptionForeground); transition: transform 120ms ease, background 120ms ease; }
  .sudo-toggle input:checked + .sudo-toggle-track { background: var(--vscode-button-background); border-color: var(--vscode-button-background); }
  .sudo-toggle input:checked + .sudo-toggle-track .sudo-toggle-thumb { transform: translateX(14px); background: var(--vscode-button-foreground); }
  .sudo-toggle input:disabled + .sudo-toggle-track { opacity: 0.55; }
  .sudo-toggle.enabled .sudo-toggle-state { color: var(--vscode-foreground); }
  .sudo-toggle-state { min-width: 46px; text-align: right; color: var(--vscode-descriptionForeground); }
  .pathbar { display: grid; grid-template-columns: auto minmax(220px, 1fr) auto 180px; gap: 8px; align-items: center; margin-bottom: 10px; flex: 0 0 auto; }
  .pathbar label { margin: 0; }
  .remote-path-box { position: relative; min-width: 0; }
  .remote-path-box input { padding-right: 66px; }
  .remote-path-favorite-buttons { position: absolute; top: 2px; right: 2px; display: inline-flex; align-items: center; gap: 1px; height: 27px; }
  .remote-path-favorite-button { width: 30px; min-width: 30px; height: 27px; min-height: 27px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 2px; border: 0; border-left: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); background: transparent; color: var(--vscode-input-foreground); opacity: 0.82; line-height: 1; }
  .remote-path-favorite-button svg { width: 25px; height: 25px; display: block; fill: currentColor; stroke: none; pointer-events: none; }
  .remote-path-favorite-button .filled-star-icon { display: none; }
  .remote-path-favorite-button.active .star-icon { display: none; }
  .remote-path-favorite-button.active .filled-star-icon { display: block; }
  .remote-path-favorite-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .remote-path-favorite-button.active { opacity: 1; }
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
  .path-actions { display: inline-flex; gap: 8px; align-items: center; }
  .toolbar-separator { width: 1px; height: 24px; background: var(--vscode-panel-border); margin: 0 2px; flex: 0 0 auto; }
  .transfer-queue-button { position: relative; }
  .transfer-queue-count { position: absolute; top: -5px; right: -5px; display: none; align-items: center; justify-content: center; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; background: var(--vscode-badge-background, var(--vscode-button-background)); color: var(--vscode-badge-foreground, var(--vscode-button-foreground)); font-size: 10px; font-weight: 650; line-height: 15px; box-shadow: 0 0 0 1px var(--vscode-editor-background); }
  .transfer-queue-button.has-pending .transfer-queue-count { display: inline-flex; }
  .filter-box { position: relative; width: 180px; min-width: 140px; }
  .filter-input { width: 100%; padding-right: 28px; }
  .filter-clear-button { position: absolute; top: 50%; right: 4px; transform: translateY(-50%); width: 22px; min-width: 22px; height: 22px; min-height: 22px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: var(--vscode-input-foreground); opacity: 0; visibility: hidden; cursor: pointer; font-size: 16px; line-height: 20px; }
  .filter-box.has-value .filter-clear-button { opacity: 0.7; visibility: visible; }
  .filter-box.has-value .filter-clear-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .filter-clear-button:disabled { cursor: default; }
  .table-wrap { border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); flex: 1 1 0; min-height: 0; max-height: none; overflow: auto; scrollbar-gutter: stable; border-radius: 6px; user-select: none; -webkit-user-select: none; transition: border-color 120ms ease, box-shadow 120ms ease; }
  .table-wrap.privileged-session { border-color: color-mix(in srgb, #7a2f2f 62%, var(--vscode-panel-border)); box-shadow: 0 0 0 1px color-mix(in srgb, #7a2f2f 18%, transparent); }
  table { width: 100%; min-width: 984px; border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 6px 10px; line-height: 1.25; border-bottom: 1px solid var(--vscode-panel-border); text-align: left; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  th { position: sticky; top: 0; background: var(--vscode-sideBar-background); font-weight: 600; z-index: 1; user-select: none; }
  th.sortable { cursor: pointer; }
  th.sortable:hover { background: var(--vscode-list-hoverBackground); }
  th.size, td.size { text-align: right; }
  th.permissions, td.permissions { font-family: var(--vscode-editor-font-family); }
  .header-content { display: flex; align-items: center; min-width: 0; }
  .header-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sort-indicator { margin-left: 5px; width: 10px; flex: 0 0 10px; color: var(--vscode-descriptionForeground); }
  .column-resizer { position: absolute; top: 0; right: 0; width: 7px; height: 100%; cursor: col-resize; z-index: 2; }
  .column-resizer:hover { background: var(--vscode-focusBorder); opacity: 0.55; }
  body.resizing-columns { cursor: col-resize; user-select: none; }
  button.compact { min-height: 26px; padding: 4px 8px; font-size: 12px; }
  tr.entry-row { cursor: pointer; user-select: none; -webkit-user-select: none; }
  tr.entry-row:hover { background: var(--vscode-list-hoverBackground); }
  tr.entry-row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  tr.entry-row.selected:hover { background: var(--vscode-list-activeSelectionBackground); }
  .entry-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .entry-icon { width: 20px; min-width: 20px; display: inline-flex; align-items: center; justify-content: center; color: var(--vscode-icon-foreground, var(--vscode-foreground)); opacity: 0.9; line-height: 0; }
  .entry-icon svg { width: 20px; height: 20px; display: block; fill: currentColor; }
  .entry-icon svg path { fill: currentColor; }
  .entry-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty-state { padding: 34px 16px; text-align: center; color: var(--vscode-descriptionForeground); }
  .context-menu { position: fixed; z-index: 100; min-width: 178px; padding: 4px; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, var(--vscode-editorWidget-foreground)); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); display: none; }
  .context-menu.visible { display: block; }
  .context-menu button { width: 100%; min-height: 28px; padding: 5px 9px; text-align: left; background: transparent; color: inherit; border-radius: 3px; }
  .context-menu button:hover:not(:disabled) { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-menu-selectionForeground, inherit); }
  .context-menu button.danger-text { color: var(--vscode-errorForeground); }
  .context-menu-separator { height: 1px; margin: 4px 3px; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); opacity: 0.9; }

  .file-properties-backdrop { position: fixed; inset: 0; z-index: 210; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.45); }
  .file-properties-backdrop.visible { display: flex; }
  .file-properties-dialog { width: min(640px, 100%); max-height: min(760px, calc(100vh - 48px)); overflow: hidden; display: flex; flex-direction: column; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .file-properties-header { padding: 16px 18px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .file-properties-title { margin: 0 0 5px; font-size: 18px; font-weight: 650; }
  .file-properties-path { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; font-size: 12px; }
  .file-properties-body { padding: 16px 18px; overflow: auto; }
  .file-properties-grid { display: grid; grid-template-columns: 150px minmax(0, 1fr); border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; background: var(--vscode-editor-background); }
  .file-properties-label, .file-properties-value { min-width: 0; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); line-height: 1.35; }
  .file-properties-label { color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background); font-weight: 600; }
  .file-properties-value { overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
  .file-properties-label:last-of-type, .file-properties-value:last-of-type { border-bottom: 0; }
  .file-properties-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 16px; }

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
  .transfer-queue-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .transfer-queue-actions button { min-height: 27px; padding: 4px 9px; }
  .transfer-queue-footer { display: flex; justify-content: flex-end; padding: 0 16px 16px; }

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
  .permission-table th, .permission-table td { padding: 8px 10px; text-align: center; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  .permission-table th:first-child, .permission-table td:first-child { text-align: left; width: 34%; }
  .permission-table tbody tr:last-child td { border-bottom: 0; }
  .permission-table th { position: static; z-index: auto; cursor: default; background: var(--vscode-sideBar-background); }
  .permission-check { width: 16px; height: 16px; accent-color: var(--vscode-button-background); }
  .permission-special-list { display: grid; gap: 10px; padding: 12px; }
  .permission-special-item { display: flex; align-items: flex-start; gap: 10px; line-height: 1.35; user-select: none; }
  .permission-mode-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px; }
  .permission-mode-row label { margin: 0; font-weight: 600; color: var(--vscode-foreground); }
  #permissionModeInput { width: 90px; font-family: var(--vscode-editor-font-family, monospace); }
  #permissionModeInput.invalid { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); outline-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); }
  .permission-current { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .permission-validation { min-height: 18px; padding: 0 12px 12px; color: var(--vscode-errorForeground); }
  .permission-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 16px; }
  .statusbar { margin-top: 12px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: center; flex: 0 0 auto; padding: 10px 12px; background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; min-height: 40px; color: var(--vscode-descriptionForeground); }
  .statusbar.error { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
  .statusbar.busy { color: var(--vscode-progressBar-background, var(--vscode-foreground)); }
  .status-main { display: inline-flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden; }
  .status-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status-action-button { align-self: center; min-height: 26px; height: 26px; padding: 0 8px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; border-radius: 3px; border: 1px solid var(--vscode-panel-border); background: transparent; color: inherit; opacity: 0.9; line-height: 1; }
  .status-action-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); border-color: var(--vscode-focusBorder, var(--vscode-button-border, var(--vscode-panel-border))); }
  .status-action-button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .status-cancel-button { display: none; padding: 0 9px; }
  .statusbar.cancelable .status-cancel-button { display: inline-flex; }
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
  @media (max-width: 980px) { html, body { overflow: auto; } .page { height: auto; min-height: 100vh; } .layout, .layout.connection-collapsed { grid-template-columns: 1fr; flex: 0 0 auto; } .connection-rail { left: 0; } .browser-column { min-height: 0; } .browser-card { min-height: 520px; } .pathbar, .profile-row, .connection-name-row { grid-template-columns: 1fr; } .path-actions { justify-content: flex-start; } .filter-box { width: 100%; } .browser-header { align-items: flex-start; flex-direction: column; } }
  @media (max-height: 720px) and (min-width: 981px) { h1 { font-size: 22px; } .description, .hint-list { display: none; } .card-header, .card-body, .browser-open-section, .browser-title-section { padding: 11px 12px; } }
  @media (max-width: 760px) { .open-connections-row { align-items: flex-start; flex-direction: column; gap: 6px; } .browser-session-strip { width: 100%; } }
  </style>
</head>
<body>
  <main class="page">
  <div class="shell">
    <section class="hero">
      <div>
        <h1>Remote file browser</h1>
      </div>
    </section>

    <section id="mainLayout" class="layout">
      <aside class="card connection-card">
        <div class="card-header connection-card-header">
          <div class="connection-card-title-text">
            <div class="card-title">Connection</div>
            <div class="card-subtitle">Bookmarked and quick connections</div>
          </div>
        </div>
        <div class="connection-panel-handle connection-collapse-handle" aria-label="Connection panel expanded">
          <span class="tooltip-anchor tooltip-above" data-tooltip="Hide connection panel">
            <button id="hideConnectionPanelButton" type="button" class="secondary icon-only panel-toggle-button" aria-label="Hide connection panel">
              <svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M560-240 320-480l240-240 28 28-212 212 212 212-28 28Z" /></svg>
            </button>
          </span>
        </div>
        <div class="card-body">
          <div class="profile-row">
            <div>
              <label for="profileSelect">Bookmarked connections</label>
              <select id="profileSelect"><option value="">New unsaved connection</option></select>
            </div>
            <span class="tooltip-anchor tooltip-above" data-tooltip="New bookmark">
              <button id="newProfileButton" type="button" class="secondary icon-only profile-icon-button" aria-label="New bookmark"><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M240-180v-555.38q0-27.62 18.5-46.12Q277-800 304.62-800H520v40H304.62q-9.24 0-16.93 7.69-7.69 7.69-7.69 16.93V-242l200-86 200 86v-278h40v340L480-283.08 240-180Zm40-580h240-240Zm400 160v-80h-80v-40h80v-80h40v80h80v40h-80v80h-40Z" /></svg></button>
            </span>
            <span class="tooltip-anchor tooltip-above" data-tooltip="Save bookmark">
              <button id="saveProfileButton" type="button" class="secondary icon-only profile-icon-button" aria-label="Save bookmark"><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M684.54-600 600-684.54l27.54-28.54 57 57 141-142 28.54 28.54L684.54-600ZM240-180v-555.38q0-27.62 18.5-46.12Q277-800 304.62-800H520v40H304.62q-9.24 0-16.93 7.69-7.69 7.69-7.69 16.93V-242l200-86 200 86v-278h40v340L480-283.08 240-180Zm40-580h240-240Z" /></svg></button>
            </span>
            <span class="tooltip-anchor tooltip-above" data-tooltip="Remove bookmark">
              <button id="deleteProfileButton" type="button" class="secondary icon-only profile-icon-button" aria-label="Remove bookmark" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M800-680H600v-40h200v40ZM240-180v-555.38q0-27.62 18.5-46.12Q277-800 304.62-800H520v40H304.62q-9.24 0-16.93 7.69-7.69 7.69-7.69 16.93V-242l200-86 200 86v-278h40v340L480-283.08 240-180Zm40-580h240-240Z" /></svg></button>
            </span>
          </div>

          <div class="form-grid">
            <div class="connection-name-row">
              <label for="profileName">Connection name</label>
              <input id="profileName" placeholder="App Server PROD" autocomplete="off" />
            </div>
            <div class="connection-config-divider" aria-hidden="true"></div>
            <div>
              <label for="host">Host</label>
              <input id="host" placeholder="server.example.com" autocomplete="off" />
              <label class="checkbox-row keepalive-row has-tooltip" data-tooltip="Send periodic SSH keepalive messages to reduce idle disconnects."><input id="keepAlive" type="checkbox" checked /> Keep connection alive</label>
            </div>
            <div><label for="port">Port</label><input id="port" value="22" inputmode="numeric" /></div>
            <div class="full"><label for="username">Username</label><input id="username" placeholder="Enter now or leave blank in the bookmarked connection" autocomplete="username" /></div>
            <div class="full"><label for="authType">Authentication</label><select id="authType"><option value="password">Password</option><option value="privateKey">Private key</option></select></div>
            <div id="passwordBlock" class="full auth-block visible">
              <label for="password">Password</label>
              <input id="password" type="password" autocomplete="current-password" />
              <label class="checkbox-row"><input id="rememberPassword" type="checkbox" /> Remember password securely</label>
              <div id="passwordSecretState" class="credential-state not-saved">Password not saved.</div>
            </div>
            <div id="privateKeyBlock" class="full auth-block">
              <label for="privateKeyPath">Private key path</label>
              <div class="input-with-button">
                <input id="privateKeyPath" placeholder="~/.ssh/id_rsa" autocomplete="off" />
                <button id="privateKeyBrowseButton" class="input-icon-button has-tooltip" type="button" aria-label="Select private key file" data-tooltip="Select private key file">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg>
                </button>
              </div>
            </div>
            <div id="passphraseBlock" class="full auth-block">
              <label for="passphrase">Passphrase</label>
              <input id="passphrase" type="password" autocomplete="off" />
              <label class="checkbox-row"><input id="rememberPassphrase" type="checkbox" /> Remember passphrase securely</label>
              <div id="passphraseSecretState" class="credential-state not-saved">Passphrase not saved.</div>
            </div>
            <div class="full"><label for="startPath">Start path</label><input id="startPath" placeholder="/home/user" autocomplete="off" /></div>
          </div>

          <div class="button-row connection-actions">
            <button id="showOutputButton" class="secondary">Output</button>
            <button id="disconnectButton" class="secondary" disabled>Disconnect</button>
            <button id="connectButton">Connect</button>
          </div>
        </div>
      </aside>

      <aside class="connection-panel-handle connection-rail" aria-label="Connection panel collapsed">
        <span class="tooltip-anchor" data-tooltip="Show connection panel">
          <button id="showConnectionPanelButton" type="button" class="secondary icon-only panel-toggle-button" aria-label="Show connection panel">
            <svg viewBox="0 -960 960 960" aria-hidden="true"><path d="m400-240-28-28 212-212-212-212 28-28 240 240-240 240Z" /></svg>
          </button>
        </span>
      </aside>

      <section class="browser-column">
        <section class="card browser-card">
          <div class="browser-open-section" aria-label="Active remote connections">
            <div class="browser-open-text-row">
              <div class="browser-open-text">
                <div class="card-title">Open connections</div>
                <div class="card-subtitle">Active remote sessions</div>
              </div>
            </div>
            <div class="open-connections-row">
              <div class="session-strip browser-session-strip">
                <div id="sessionTabs" class="session-tabs"><span class="session-empty">No active connections.</span></div>
              </div>
            </div>
          </div>
          <div class="browser-section-divider"></div>

          <div class="browser-title-section">
            <div class="browser-title-row">
              <div class="browser-title-text">
                <div class="card-title">Remote browser</div>
                <div id="browserSubtitle" class="card-subtitle">Connect to a host to list remote files.</div>
              </div>
              <label id="sudoToggleLabel" class="sudo-toggle has-tooltip" data-tooltip="Connect to a host to enable sudo mode">
                <span id="sudoToggleState" class="sudo-toggle-state">Sudo Off</span>
                <input id="sudoToggle" type="checkbox" disabled aria-label="Enable sudo mode for this connection" />
                <span class="sudo-toggle-track" aria-hidden="true"><span class="sudo-toggle-thumb"></span></span>
              </label>
            </div>
          </div>
          <div class="browser-section-divider"></div>

          <div class="card-body">
          <div class="pathbar">
            <label class="small muted" for="currentPath">Remote Path</label>
            <div id="remotePathBox" class="remote-path-box">
              <input id="currentPath" value="" disabled />
              <div class="remote-path-favorite-buttons" aria-hidden="false">
                <button id="togglePathFavoriteButton" class="remote-path-favorite-button" type="button" aria-label="Add remote path favorite" data-tooltip="Save this connection to use remote path favorites" disabled>
                  <svg class="star-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143Zm-61 83.92 49.62-212.54-164.93-142.84 217.23-18.85L480-777.69l85.08 200.38 217.23 18.85-164.93 142.84L667-203.08 480-315.92 293-203.08ZM480-470Z" /></svg>
                  <svg class="filled-star-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m293-203.08 49.62-212.54-164.93-142.84 217.23-18.85L480-777.69l85.08 200.38 217.23 18.85-164.93 142.84L667-203.08 480-315.92 293-203.08Z" /></svg>
                </button>
                <button id="pathFavoritesButton" class="remote-path-favorite-button" type="button" aria-label="Show remote path favorites" data-tooltip="Save this connection to use remote path favorites" disabled>
                  <svg class="hotel-class-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="m620.31-395.38 138.92-120 57.69 5.38-149.84 129.15 44.31 195.47-48.93-29.7-42.15-180.3ZM544-631.23l-38.92-91.85 22.15-54.61 63.54 150.84-46.77-4.38ZM294-287l126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143Zm-61 83.92 49.62-212.54-164.93-142.84 217.23-18.85L420-777.69l85.08 200.38 217.23 18.85-164.93 142.84L607-203.08 420-315.92 233-203.08Zm187-257.69Z" /></svg>
                </button>
              </div>
              <div id="pathFavoritesPopover" class="remote-path-favorites-popover" aria-hidden="true">
                <div class="remote-path-favorites-title">Favorite remote paths</div>
                <div id="pathFavoritesList"></div>
              </div>
            </div>
            <div class="path-actions">
              <span class="tooltip-anchor" data-tooltip="Go">
                <button id="goButton" class="secondary icon-only" aria-label="Go" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M683.15-460H200v-40h483.15L451.46-731.69 480-760l280 280-280 280-28.54-28.31L683.15-460Z" /></svg></button>
              </span>
              <span class="tooltip-anchor" data-tooltip="Parent">
                <button id="parentButton" class="secondary icon-only" aria-label="Parent" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M460-200v-483.15L228.31-451.46 200-480l280-280 280 280-28.31 28.54L500-683.15V-200h-40Z" /></svg></button>
              </span>
              <span class="tooltip-anchor" data-tooltip="Refresh">
                <button id="refreshButton" class="secondary icon-only" aria-label="Refresh" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M483.08-200q-117.25 0-198.63-81.34-81.37-81.34-81.37-198.54 0-117.2 81.37-198.66Q365.83-760 483.08-760q71.3 0 133.54 33.88 62.23 33.89 100.3 94.58V-760h40v209.23H547.69v-40h148q-31.23-59.85-87.88-94.54Q551.15-720 483.08-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h42.46Q725.08-310.15 651-255.08 576.92-200 483.08-200Z" /></svg></button>
              </span>
              <span class="toolbar-separator" aria-hidden="true"></span>
              <span class="tooltip-anchor" data-tooltip="Upload files or folders">
                <button id="uploadButton" class="secondary icon-only" aria-label="Upload files or folders" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M260-160q-41.92 0-70.96-29.04Q160-218.08 160-260v-80h40v80q0 25 17.5 42.5T260-200h440q25 0 42.5-17.5T760-260v-80h40v80q0 41.92-29.04 70.96Q741.92-160 700-160H260Zm200-160v-370L342-572l-28-28 166-166 166 166-28 28-118-118v370h-40Z" /></svg></button>
              </span>
              <span class="tooltip-anchor" data-tooltip="Download selected files or folders">
                <button id="downloadButton" class="secondary icon-only" aria-label="Download selected files or folders" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M260-160q-41.92 0-70.96-29.04Q160-218.08 160-260v-80h40v80q0 25 17.5 42.5T260-200h440q25 0 42.5-17.5T760-260v-80h40v80q0 41.92-29.04 70.96Q741.92-160 700-160H260Zm220-146L314-472l28-28 118 118v-370h40v370l118-118 28 28-166 166Z" /></svg></button>
              </span>
              <span id="transferQueueTooltip" class="tooltip-anchor" data-tooltip="Transfer Queue">
                <button id="transferQueueButton" class="secondary icon-only transfer-queue-button" type="button" aria-label="Transfer Queue"><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M340-596.38h40v359.3l83.54-83.54 28.77 28.31L360-160 227.69-292.31l28.77-28.31L340-237.08v-359.3ZM620-421h-40v-302.38l-84 84-28.31-28.31L600-800l132.31 132.31L704-639.38l-84-84V-421Z" /></svg><span id="transferQueueCount" class="transfer-queue-count" aria-hidden="true">0</span></button>
              </span>
              <span class="toolbar-separator" aria-hidden="true"></span>
            </div>
            <div id="filterBox" class="filter-box">
              <input id="filterInput" class="filter-input" placeholder="Filter files..." aria-label="Filter files" disabled />
              <button id="clearFilterButton" class="filter-clear-button has-tooltip" aria-label="Clear filter" data-tooltip="Clear filter" disabled>×</button>
            </div>
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

          <div id="status" class="statusbar"><div class="status-main"><div id="statusText" class="status-text">Ready.</div><div class="spinner" aria-hidden="true"></div></div><button id="statusCancelButton" class="status-action-button status-cancel-button has-tooltip" type="button" data-tooltip="Cancel current operation">Cancel Transfer</button><div class="status-copy-wrap"><button id="statusCopyButton" class="status-action-button status-copy-button has-tooltip tooltip-above" type="button" aria-label="Copy status" data-tooltip="Copy status"><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" /></svg></button><div id="statusCopyFeedback" class="status-copy-feedback" role="status" aria-live="polite">Copied</div></div></div>
          </div>
        </section>
      </section>
    </section>
  </div>
  </main>

  <div id="webviewTooltip" class="webview-tooltip" role="tooltip" aria-hidden="true"></div>

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

  <div id="entryContextMenu" class="context-menu" role="menu" aria-label="Entry actions">
  <button id="contextOpen" type="button" role="menuitem">View/Edit</button>
  <div id="contextOpenSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextCreateFile" type="button" role="menuitem">Create new file</button>
  <button id="contextCreateDirectory" type="button" role="menuitem">Create new directory</button>
  <div id="contextRefreshSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextRefresh" type="button" role="menuitem">Refresh</button>
  <div id="contextTransferSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextUpload" type="button" role="menuitem">Upload...</button>
  <button id="contextDownload" type="button" role="menuitem">Download...</button>
  <div id="contextItemSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextMakeCopy" type="button" role="menuitem">Make a Copy...</button>
  <button id="contextRename" type="button" role="menuitem">Rename</button>
  <button id="contextSetPermissions" type="button" role="menuitem">Set permissions</button>
  <button id="contextFileProperties" type="button" role="menuitem">File Properties</button>
  <button id="contextCalculateChecksums" type="button" role="menuitem">Calculate Checksums...</button>
  <div id="contextDeleteSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextDelete" type="button" role="menuitem" class="danger-text">Delete</button>
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
            <tr><td>Owner</td><td><input class="permission-check" type="checkbox" data-permission="ownerRead" aria-label="Owner read"></td><td><input class="permission-check" type="checkbox" data-permission="ownerWrite" aria-label="Owner write"></td><td><input class="permission-check" type="checkbox" data-permission="ownerExecute" aria-label="Owner execute"></td></tr>
            <tr><td>Group</td><td><input class="permission-check" type="checkbox" data-permission="groupRead" aria-label="Group read"></td><td><input class="permission-check" type="checkbox" data-permission="groupWrite" aria-label="Group write"></td><td><input class="permission-check" type="checkbox" data-permission="groupExecute" aria-label="Group execute"></td></tr>
            <tr><td>Others</td><td><input class="permission-check" type="checkbox" data-permission="othersRead" aria-label="Others read"></td><td><input class="permission-check" type="checkbox" data-permission="othersWrite" aria-label="Others write"></td><td><input class="permission-check" type="checkbox" data-permission="othersExecute" aria-label="Others execute"></td></tr>
          </tbody>
        </table>
      </section>
      <section class="permission-section">
        <p class="permission-section-title">Special permissions</p>
        <div class="permission-special-list">
          <label class="permission-special-item"><input class="permission-check" type="checkbox" data-permission="setuid"> <span id="permissionSetuidLabel">Run as owner / setuid</span></label>
          <label class="permission-special-item"><input class="permission-check" type="checkbox" data-permission="setgid"> <span id="permissionSetgidLabel">Run as group / setgid</span></label>
          <label class="permission-special-item"><input class="permission-check" type="checkbox" data-permission="sticky"> <span id="permissionStickyLabel">Sticky bit</span></label>
        </div>
      </section>
      <section class="permission-section">
        <div class="permission-mode-row">
          <label for="permissionModeInput">Octal</label>
          <input id="permissionModeInput" type="text" maxlength="4" inputmode="numeric" autocomplete="off">
          <span id="permissionCurrentText" class="permission-current"></span>
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
  const hideConnectionPanelButton = document.getElementById('hideConnectionPanelButton');
  const showConnectionPanelButton = document.getElementById('showConnectionPanelButton');
  const connectionRail = document.querySelector('.connection-rail');
  const connectionCard = document.querySelector('.connection-card');
  const profileSelect = document.getElementById('profileSelect');
  const profileName = document.getElementById('profileName');
  const host = document.getElementById('host');
  const port = document.getElementById('port');
  const username = document.getElementById('username');
  const authType = document.getElementById('authType');
  const password = document.getElementById('password');
  const rememberPassword = document.getElementById('rememberPassword');
  const passwordSecretState = document.getElementById('passwordSecretState');
  const privateKeyPath = document.getElementById('privateKeyPath');
  const privateKeyBrowseButton = document.getElementById('privateKeyBrowseButton');
  const passphrase = document.getElementById('passphrase');
  const rememberPassphrase = document.getElementById('rememberPassphrase');
  const passphraseSecretState = document.getElementById('passphraseSecretState');
  const startPath = document.getElementById('startPath');
  const keepAlive = document.getElementById('keepAlive');
  const passwordBlock = document.getElementById('passwordBlock');
  const privateKeyBlock = document.getElementById('privateKeyBlock');
  const passphraseBlock = document.getElementById('passphraseBlock');
  const sessionTabs = document.getElementById('sessionTabs');
  const currentPath = document.getElementById('currentPath');
  const remotePathBox = document.getElementById('remotePathBox');
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
  const statusCancelButton = document.getElementById('statusCancelButton');
  const statusCopyButton = document.getElementById('statusCopyButton');
  const statusCopyFeedback = document.getElementById('statusCopyFeedback');
  const webviewTooltip = document.getElementById('webviewTooltip');
  const browserSubtitle = document.getElementById('browserSubtitle');
  const sudoToggleLabel = document.getElementById('sudoToggleLabel');
  const sudoToggle = document.getElementById('sudoToggle');
  const sudoToggleState = document.getElementById('sudoToggleState');

  const newProfileButton = document.getElementById('newProfileButton');
  const saveProfileButton = document.getElementById('saveProfileButton');
  const deleteProfileButton = document.getElementById('deleteProfileButton');
  const connectButton = document.getElementById('connectButton');
  const disconnectButton = document.getElementById('disconnectButton');
  const showOutputButton = document.getElementById('showOutputButton');
  const parentButton = document.getElementById('parentButton');
  const refreshButton = document.getElementById('refreshButton');
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
  const goButton = document.getElementById('goButton');
  const entryContextMenu = document.getElementById('entryContextMenu');
  const contextOpen = document.getElementById('contextOpen');
  const contextOpenSeparator = document.getElementById('contextOpenSeparator');
  const contextCreateFile = document.getElementById('contextCreateFile');
  const contextCreateDirectory = document.getElementById('contextCreateDirectory');
  const contextTransferSeparator = document.getElementById('contextTransferSeparator');
  const contextUpload = document.getElementById('contextUpload');
  const contextDownload = document.getElementById('contextDownload');
  const contextItemSeparator = document.getElementById('contextItemSeparator');
  const contextMakeCopy = document.getElementById('contextMakeCopy');
  const contextSetPermissions = document.getElementById('contextSetPermissions');
  const contextFileProperties = document.getElementById('contextFileProperties');
  const contextCalculateChecksums = document.getElementById('contextCalculateChecksums');
  const contextRename = document.getElementById('contextRename');
  const contextDeleteSeparator = document.getElementById('contextDeleteSeparator');
  const contextDelete = document.getElementById('contextDelete');
  const contextRefreshSeparator = document.getElementById('contextRefreshSeparator');
  const contextRefresh = document.getElementById('contextRefresh');

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

  const permissionBackdrop = document.getElementById('permissionBackdrop');
  const permissionDialogTitle = document.getElementById('permissionDialogTitle');
  const permissionDialogPath = document.getElementById('permissionDialogPath');
  const permissionModeInput = document.getElementById('permissionModeInput');
  const permissionCurrentText = document.getElementById('permissionCurrentText');
  const permissionValidation = document.getElementById('permissionValidation');
  const permissionApplyButton = document.getElementById('permissionApplyButton');
  const permissionCancelButton = document.getElementById('permissionCancelButton');
  const permissionSetuidLabel = document.getElementById('permissionSetuidLabel');
  const permissionSetgidLabel = document.getElementById('permissionSetgidLabel');
  const permissionStickyLabel = document.getElementById('permissionStickyLabel');
  const permissionCheckboxes = Array.from(document.querySelectorAll('#permissionBackdrop input[data-permission]'));

  const SAVED_SECRET_MASK = '••••••••';

  const columnOrder = ['name', 'type', 'size', 'owner', 'group', 'permissions', 'modified'];
  const columnWidths = { name: 300, type: 86, size: 92, owner: 84, group: 84, permissions: 120, modified: 170 };
  const minColumnWidths = { name: 150, type: 62, size: 72, owner: 64, group: 64, permissions: 90, modified: 130 };

  let profiles = [];
  let sessions = [];
  let selectedProfileId = '';
  let activeConnectionId = '';
  let currentEntries = [];
  let selectedEntryPath = '';
  let selectedEntryPaths = new Set();
  let selectionAnchorPath = '';
  let filterText = '';
  let currentSort = { key: '', direction: '' };
  let busy = false;
  let statusCancelAction = '';
  let statusCopyFeedbackTimer = 0;
  let filePropertiesDialogOpen = false;
  let filePropertiesRemotePath = '';
  let checksumsDialogOpen = false;
  let checksumsCopyState = { sha256: '', md5: '', all: '' };
  let permissionsDialogOpen = false;
  let transferQueueState = { current: null, pending: [], completed: [] };
  let transferQueueModalOpen = false;
  let pathFavoritesOpen = false;
  let connectionPanelCollapsed = Boolean((vscode.getState() || {}).connectionPanelCollapsed);

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
  window.addEventListener('resize', hideWebviewTooltip);

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
        selectedProfileId = '';
        profileSelect.value = '';
        clearForm();
        break;
      case 'privateKeyPathSelected':
        if (payload.path) {
          privateKeyPath.value = payload.path;
        }
        break;
      case 'sessionsChanged':
        sessions = payload.sessions || [];
        activeConnectionId = payload.activeConnectionId || '';
        renderSessionTabs();
        updateActiveSessionUi();
        setControls();
        if (pathFavoritesOpen) renderPathFavoritesPopover();
        break;
      case 'sudoModeChanged': {
        const targetConnectionId = payload.connectionId || activeConnectionId;
        const session = sessions.find(item => item.id === targetConnectionId);
        if (session) {
          session.sudoModeEnabled = Boolean(payload.enabled);
        }
        updateSudoToggle();
        setControls();
        break;
      }
      case 'disconnected':
        sessions = [];
        activeConnectionId = '';
        currentEntries = [];
        selectedEntryPath = '';
        filterText = '';
        filterInput.value = '';
        updateFilterClearButton();
        currentSort = { key: '', direction: '' };
        hideContextMenu();
        hideFilePropertiesDialog();
        hideChecksumsDialog();
        hidePathFavoritesPopover();
        renderSessionTabs();
        updateActiveSessionUi();
        updateSortIndicators();
        entriesBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Connect to a host to list remote files.</div></td></tr>';
        currentPath.value = '';
        setControls();
        setStatus('No active remote connections.');
        break;
      case 'directoryListed':
        if (payload.connectionId && payload.connectionId !== activeConnectionId) return;
        currentPath.value = payload.path || '/';
        currentEntries = payload.entries || [];
        selectedEntryPath = '';
        selectedEntryPaths.clear();
        selectionAnchorPath = '';
        hideContextMenu();
        renderEntries(getVisibleEntries());
        updateActiveSessionPath(payload.path || '/');
        updatePathFavoriteControls();
        if (pathFavoritesOpen) renderPathFavoritesPopover();
        break;
      case 'status':
        setStatus(payload.message || '');
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
      case 'error':
        setBusy(false);
        setStatus(payload.message || 'Unknown error.', true);
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
    requestAnimationFrame(() => {
      if (mainLayout) mainLayout.classList.add('connection-transition-ready');
    });
    updateAuthFields();
    setControls();
  });

  profileSelect.addEventListener('change', () => {
    selectedProfileId = profileSelect.value;
    if (!selectedProfileId) {
      clearForm();
      return;
    }

    const profile = profiles.find(item => item.id === selectedProfileId);
    if (profile) fillForm(profile);
  });

  newProfileButton.addEventListener('click', () => {
    selectedProfileId = '';
    profileSelect.value = '';
    clearForm();
    setStatus('New quick connection.');
  });

  saveProfileButton.addEventListener('click', () => {
    setBusy(true, 'Saving bookmarked connection...');
    vscode.postMessage({ type: 'saveConnection', payload: collectConnectionPayload() });
  });

  deleteProfileButton.addEventListener('click', () => {
    const profileId = profileSelect.value || selectedProfileId;
    const profile = profiles.find(item => item.id === profileId);

    if (!profileId || !profile) {
      setStatus('Select a bookmarked connection to remove.', true);
      return;
    }

    selectedProfileId = profileId;
    setBusy(true, 'Removing bookmarked connection...');
    vscode.postMessage({
      type: 'deleteConnection',
      payload: { id: profileId, name: profile.name || '' }
    });
  });

  connectButton.addEventListener('click', () => {
    setBusy(true, 'Connecting...');
    vscode.postMessage({ type: 'connect', payload: collectConnectionPayload() });
  });

  disconnectButton.addEventListener('click', () => {
    if (!activeConnectionId) return;
    setBusy(true, 'Disconnecting...');
    vscode.postMessage({ type: 'disconnect', payload: { connectionId: activeConnectionId } });
  });

  showOutputButton.addEventListener('click', () => vscode.postMessage({ type: 'showOutput' }));
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
  parentButton.addEventListener('click', () => vscode.postMessage({ type: 'openParent' }));
  refreshButton.addEventListener('click', () => listDirectory(currentPath.value));
  uploadButton.addEventListener('click', () => { if (activeConnectionId && canStartTransferAction()) vscode.postMessage({ type: 'requestUploadEntries', payload: { path: currentPath.value || '/' } }); });
  downloadButton.addEventListener('click', () => { const entries = getSelectedActionEntries(); if (entries.length && canStartTransferAction()) vscode.postMessage({ type: 'requestDownloadEntries', payload: { entries: entries.map(actionPayload) } }); });
  transferQueueButton.addEventListener('click', showTransferQueueModal);
  transferQueueCloseButton.addEventListener('click', hideTransferQueueModal);
  transferQueueFooterCloseButton.addEventListener('click', hideTransferQueueModal);
  transferQueueModal.addEventListener('click', event => { if (event.target === transferQueueModal) hideTransferQueueModal(); });
  transferQueueCurrent.addEventListener('click', event => {
    const button = event.target && event.target.closest ? event.target.closest('[data-transfer-action]') : null;
    if (!button || button.dataset.transferAction !== 'cancel-current') return;
    vscode.postMessage({ type: 'cancelTransfer' });
  });
  transferQueuePending.addEventListener('click', event => {
    const button = event.target && event.target.closest ? event.target.closest('[data-transfer-action]') : null;
    if (!button || button.dataset.transferAction !== 'remove-pending') return;
    vscode.postMessage({ type: 'removeQueuedTransfer', payload: { transferId: button.dataset.transferId || '' } });
  });
  statusCancelButton.addEventListener('click', () => {
    if (statusCancelAction === 'connection') {
      vscode.postMessage({ type: 'cancelConnection' });
      return;
    }

    if (statusCancelAction === 'transfer') {
      vscode.postMessage({ type: 'cancelTransfer' });
    }
  });
  statusCopyButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyStatus', payload: { text: getStatusCopyText() } });
  });
  goButton.addEventListener('click', () => openPath(currentPath.value));
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
  currentPath.addEventListener('input', updatePathFavoriteControls);
  authType.addEventListener('change', updateAuthFields);
  privateKeyBrowseButton.addEventListener('click', () => vscode.postMessage({ type: 'pickPrivateKeyPath' }));
  rememberPassword.addEventListener('change', () => { if (!rememberPassword.checked) { password.placeholder = ''; if (password.value === SAVED_SECRET_MASK) password.value = ''; } });
  rememberPassphrase.addEventListener('change', () => { if (!rememberPassphrase.checked) { passphrase.placeholder = ''; if (passphrase.value === SAVED_SECRET_MASK) passphrase.value = ''; } });

  currentPath.addEventListener('keydown', event => { if (event.key === 'Enter') openPath(currentPath.value); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && checksumsDialogOpen) {
      hideChecksumsDialog();
      return;
    }
    if (event.key === 'Escape' && filePropertiesDialogOpen) {
      hideFilePropertiesDialog();
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

  contextCreateFile.addEventListener('click', () => {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestCreateFile', payload: { path: currentPath.value || '/' } });
  });

  contextCreateDirectory.addEventListener('click', () => {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestCreateDirectory', payload: { path: currentPath.value || '/' } });
  });

  contextUpload.addEventListener('click', () => {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestUploadEntries', payload: { path: currentPath.value || '/' } });
  });

  contextDownload.addEventListener('click', () => {
    const entries = getSelectedActionEntries();
    hideContextMenu();
    if (entries.length) vscode.postMessage({ type: 'requestDownloadEntries', payload: { entries: entries.map(actionPayload) } });
  });

  contextRefresh.addEventListener('click', () => {
    hideContextMenu();
    listDirectory(currentPath.value || '/');
  });

  contextSetPermissions.addEventListener('click', () => {
    const entry = getSelectedActionEntry();
    hideContextMenu();
    if (entry) vscode.postMessage({ type: 'requestSetPermissions', payload: actionPayload(entry) });
  });

  contextFileProperties.addEventListener('click', () => {
    const entry = getSelectedActionEntry();
    hideContextMenu();
    if (entry) showFilePropertiesDialog(entry);
  });

  contextCalculateChecksums.addEventListener('click', () => {
    const entry = getSelectedActionEntry();
    hideContextMenu();
    if (entry) vscode.postMessage({ type: 'requestCalculateChecksums', payload: actionPayload(entry) });
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
      setPermissionValidation('', true);
    });
  }

  permissionModeInput.addEventListener('input', () => {
    const value = permissionModeInput.value.trim();

    if (/^[0-7]{0,4}$/.test(value) === false) {
      setPermissionValidation('Use only octal digits from 0 to 7.', false);
      return;
    }

    const normalized = normalizePermissionMode(value);
    if (!normalized) {
      setPermissionValidation('Enter 3 or 4 octal digits, for example 644, 0755, 2775 or 1777.', false);
      return;
    }

    updatePermissionCheckboxesFromMode(normalized);
    setPermissionValidation('', true);
  });

  permissionModeInput.addEventListener('blur', () => {
    const normalized = normalizePermissionMode(permissionModeInput.value.trim());
    if (normalized) permissionModeInput.value = normalized;
  });

  permissionApplyButton.addEventListener('click', () => {
    const normalized = normalizePermissionMode(permissionModeInput.value.trim());
    if (!normalized) {
      setPermissionValidation('Enter a valid octal mode before applying.', false);
      return;
    }

    vscode.postMessage({ type: 'applyPermissions', payload: { mode: normalized } });
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

  function updateConnectionRailPosition() {
    if (!mainLayout || !connectionRail || !connectionPanelCollapsed) return;
    const layoutRect = mainLayout.getBoundingClientRect();
    connectionRail.style.top = Math.max(8, Math.round(layoutRect.top + 8)) + 'px';
  }

  function updateConnectionPanelLayout() {
    if (!mainLayout) return;
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
    vscode.setState(Object.assign({}, vscode.getState() || {}, { connectionPanelCollapsed: connectionPanelCollapsed }));
  }

  function renderProfiles(preferredId) {
    const previousId = preferredId || selectedProfileId || '';
    profileSelect.innerHTML = '<option value="">New unsaved connection</option>';

    for (const profile of profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name + ' - ' + formatProfileTarget(profile) + ' - ' + formatCredentialState(profile);
      profileSelect.appendChild(option);
    }

    const exists = profiles.some(profile => profile.id === previousId);
    selectedProfileId = exists ? previousId : '';
    profileSelect.value = selectedProfileId;

    if (selectedProfileId) {
      const profile = profiles.find(item => item.id === selectedProfileId);
      if (profile) fillForm(profile);
    } else {
      clearForm();
    }

    setControls();
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
      tab.dataset.tooltip = formatConnectionLabel(session.name, formatSessionTarget(session)) + ' - ' + (session.currentPath || '/');
      tab.innerHTML = '<span class="session-name">' + escapeHtml(session.name) + '</span><span class="session-close has-tooltip tooltip-above" data-tooltip="Disconnect">×</span>';
      tab.addEventListener('click', () => {
        if (session.id === activeConnectionId) return;
        setBusy(true, 'Switching to ' + session.name + '...');
        vscode.postMessage({ type: 'switchSession', payload: { connectionId: session.id } });
      });

      const close = tab.querySelector('.session-close');
      close.addEventListener('click', event => {
        event.stopPropagation();
        setBusy(true, 'Disconnecting...');
        vscode.postMessage({ type: 'disconnect', payload: { connectionId: session.id } });
      });

      sessionTabs.appendChild(tab);
    }
  }

  function updateSudoToggle() {
    const active = getActiveSession();
    const enabled = Boolean(active && active.sudoModeEnabled);
    const isRootConnection = Boolean(active && String(active.username || '').trim().toLowerCase() === 'root');
    const isPrivilegedSession = enabled || isRootConnection;

    sudoToggle.checked = enabled;
    sudoToggleState.textContent = enabled ? 'Sudo On' : 'Sudo Off';
    sudoToggleLabel.classList.toggle('enabled', enabled);
    entriesTableWrap.classList.toggle('privileged-session', isPrivilegedSession);
    sudoToggleLabel.dataset.tooltip = !active
      ? 'Connect to a host to enable sudo mode'
      : enabled
        ? 'Disable sudo mode and forget the sudo password'
        : 'Enable sudo mode for this connection';
  }

  function updateActiveSessionUi() {
    const active = getActiveSession();
    if (!active) {
      browserSubtitle.textContent = sessions.length ? 'Select an open connection tab to browse remote files.' : 'Connect to a host to list remote files.';
      currentPath.value = '';
      updateSudoToggle();
      return;
    }

    browserSubtitle.textContent = formatConnectionLabel(active.name, formatSessionTarget(active));
    if (active.currentPath) {
      currentPath.value = active.currentPath;
    }
    updateSudoToggle();
  }

  function updateActiveSessionPath(path) {
    const active = getActiveSession();
    if (!active) return;
    active.currentPath = path;
    renderSessionTabs();
  }

  function getActiveSession() {
    return sessions.find(item => item.id === activeConnectionId);
  }

  function formatProfileTarget(profile) {
    const userPart = profile.username ? profile.username + '@' : '';
    return userPart + profile.host + ':' + profile.port;
  }

  function formatSessionTarget(session) {
    const userPart = session.username ? session.username + '@' : '';
    return userPart + session.host + ':' + session.port;
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
      ? 'Password saved in VS Code SecretStorage. Uncheck and save/connect to forget it.'
      : 'Password not saved. Check remember to store a new password securely.';
    passwordSecretState.className = 'credential-state ' + (hasPassword ? 'saved' : 'not-saved');

    passphraseSecretState.textContent = hasPassphrase
      ? 'Passphrase saved in VS Code SecretStorage. Uncheck and save/connect to forget it.'
      : 'Passphrase not saved. Check remember to store a new passphrase securely.';
    passphraseSecretState.className = 'credential-state ' + (hasPassphrase ? 'saved' : 'not-saved');
  }

  function fillForm(profile) {
    profileName.value = profile.name || '';
    host.value = profile.host || '';
    port.value = String(profile.port || 22);
    username.value = profile.username || '';
    authType.value = profile.authType || 'password';
    password.value = profile.hasSavedPassword ? SAVED_SECRET_MASK : '';
    rememberPassword.checked = Boolean(profile.hasSavedPassword);
    privateKeyPath.value = profile.privateKeyPath || '';
    passphrase.value = profile.hasSavedPassphrase ? SAVED_SECRET_MASK : '';
    rememberPassphrase.checked = Boolean(profile.hasSavedPassphrase);
    startPath.value = profile.startPath || '';
    keepAlive.checked = profile.keepAlive !== false;
    password.placeholder = profile.hasSavedPassword ? 'Saved password' : '';
    passphrase.placeholder = profile.hasSavedPassphrase ? 'Saved passphrase' : '';
    updateCredentialState(profile);
    updateAuthFields();
    setControls();
  }

  function clearForm() {
    profileName.value = '';
    host.value = '';
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
    updateCredentialState();
    updateAuthFields();
    setControls();
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
          : 'Remote path';

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
      ['Host', active ? formatSessionTarget(active) : '—'],
      ['Sudo mode', active && active.sudoModeEnabled ? 'On' : 'Off']
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
    const isDirectory = Boolean(options.isDirectory);
    permissionDialogTitle.textContent = 'Set Permissions: ' + (options.entryName || 'selected item');
    permissionDialogPath.textContent = options.remotePath || '';
    permissionCurrentText.textContent = 'Current: ' + (options.currentPermissions || 'unknown');
    permissionSetuidLabel.textContent = isDirectory ? 'Set user ID / usually ignored on directories' : 'Run as owner / setuid';
    permissionSetgidLabel.textContent = isDirectory ? 'Inherit group for new files and folders / setgid' : 'Run as group / setgid';
    permissionStickyLabel.textContent = isDirectory ? 'Restrict delete/rename to item owners / sticky' : 'Sticky bit / rarely used on files';

    for (const checkbox of permissionCheckboxes) {
      checkbox.checked = Boolean(state[checkbox.dataset.permission]);
    }

    permissionModeInput.value = normalizePermissionMode(String(options.initialMode || '').trim()) || calculateModeFromPermissionCheckboxes();
    setPermissionValidation('', true);
    permissionBackdrop.classList.add('visible');
    permissionBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => permissionModeInput.focus(), 0);
  }

  function hidePermissionsDialog() {
    permissionsDialogOpen = false;
    permissionBackdrop.classList.remove('visible');
    permissionBackdrop.setAttribute('aria-hidden', 'true');
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

  function updatePathFavoriteControls() {
    if (!togglePathFavoriteButton || !pathFavoritesButton) return;

    const hasActiveSession = Boolean(activeConnectionId);
    const hasSavedConnection = Boolean(getActiveProfile());
    const current = normalizeUiRemotePath(currentPath.value || '/');
    const isFavorite = hasSavedConnection && getFavoriteRemotePaths().includes(current);
    const disabled = busy || !hasActiveSession || !hasSavedConnection;
    const unavailableMessage = !hasActiveSession
      ? 'Connect to a saved connection to use remote path favorites'
      : 'Save this connection to use remote path favorites';

    togglePathFavoriteButton.disabled = disabled;
    togglePathFavoriteButton.classList.toggle('active', isFavorite);
    togglePathFavoriteButton.setAttribute('aria-label', isFavorite ? 'Remove remote path favorite' : 'Add remote path favorite');
    togglePathFavoriteButton.dataset.tooltip = disabled
      ? unavailableMessage
      : (isFavorite ? 'Remove from favorite remote paths' : 'Add to favorite remote paths');

    pathFavoritesButton.disabled = disabled;
    pathFavoritesButton.dataset.tooltip = disabled ? unavailableMessage : 'Show favorite remote paths';

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
      pathFavoritesList.innerHTML = '<div class="remote-path-favorites-empty">Save this connection to use remote path favorites.</div>';
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

  function collectConnectionPayload() {
    return {
      id: selectedProfileId || undefined,
      name: profileName.value,
      host: host.value,
      port: port.value,
      username: username.value,
      authType: authType.value,
      password: password.value === SAVED_SECRET_MASK ? '' : password.value,
      rememberPassword: rememberPassword.checked,
      privateKeyPath: privateKeyPath.value,
      passphrase: passphrase.value === SAVED_SECRET_MASK ? '' : passphrase.value,
      rememberPassphrase: rememberPassphrase.checked,
      startPath: startPath.value,
      keepAlive: keepAlive.checked
    };
  }

  function updateAuthFields() {
    const isPrivateKey = authType.value === 'privateKey';
    passwordBlock.classList.toggle('visible', !isPrivateKey);
    privateKeyBlock.classList.toggle('visible', isPrivateKey);
    passphraseBlock.classList.toggle('visible', isPrivateKey);
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

  function copyRemotePath(path) {
    if (!activeConnectionId || busy) return;
    vscode.postMessage({ type: 'copyRemotePath', payload: { path } });
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
      row.className = 'entry-row has-tooltip' + (selectedEntryPaths.has(entryKey) ? ' selected' : '');
      row.dataset.tooltip = entry.linkTarget ? ((entry.path || entry.name) + ' -> ' + entry.linkTarget) : (entry.path || entry.name);
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
    const isSingleDirectory = isSingleEntry && getEffectiveEntryType(selectedEntries[0]) === 'directory';
    const allFiles = hasEntryActions && selectedEntries.every(entry => getEffectiveEntryType(entry) === 'file' || entry.type === 'link');
    const canOpen = isSingleDirectory || allFiles;

    const hasItemGroup = isSingleEntry;
    const canMakeCopy = isSingleEntry && selectedEntries[0].type === 'file';
    const canCalculateChecksums = canMakeCopy;
    const hasDeleteGroup = hasEntryActions;

    contextTransferSeparator.style.display = activeConnectionId ? '' : 'none';
    contextUpload.style.display = activeConnectionId ? '' : 'none';
    contextDownload.style.display = hasEntryActions ? '' : 'none';

    contextOpen.style.display = canOpen ? '' : 'none';
    contextOpenSeparator.style.display = canOpen ? '' : 'none';
    contextOpen.textContent = isSingleDirectory
      ? 'Enter Directory'
      : (isSingleEntry && selectedEntries[0].type === 'link' ? 'Open Link' : 'View/Edit');

    contextItemSeparator.style.display = hasItemGroup ? '' : 'none';
    contextMakeCopy.style.display = canMakeCopy ? '' : 'none';
    contextRename.style.display = hasItemGroup ? '' : 'none';
    contextSetPermissions.style.display = hasItemGroup ? '' : 'none';
    contextFileProperties.style.display = hasItemGroup ? '' : 'none';
    contextCalculateChecksums.style.display = canCalculateChecksums ? '' : 'none';
    contextDeleteSeparator.style.display = hasDeleteGroup ? '' : 'none';
    contextDelete.style.display = hasDeleteGroup ? '' : 'none';
    contextRefreshSeparator.style.display = activeConnectionId ? '' : 'none';
    contextRefresh.style.display = activeConnectionId ? '' : 'none';
  }

  function hideContextMenu() {
    if (entryContextMenu) entryContextMenu.classList.remove('visible');
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

    const column = event.currentTarget.dataset.column;
    if (!column) return;

    const startX = event.clientX;
    const startWidth = columnWidths[column] || minColumnWidths[column] || 72;
    document.body.classList.add('resizing-columns');

    const onMouseMove = moveEvent => {
      const minWidth = minColumnWidths[column] || 72;
      columnWidths[column] = Math.max(minWidth, startWidth + moveEvent.clientX - startX);
      applyColumnWidths();
    };

    const onMouseUp = () => {
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
      pending: Array.isArray(payload && payload.pending) ? payload.pending : [],
      completed: Array.isArray(payload && payload.completed) ? payload.completed : []
    };
    renderTransferQueueButton();
    if (transferQueueModalOpen) renderTransferQueueModal();
  }

  function renderTransferQueueButton() {
    const pendingCount = transferQueueState.pending.length;
    const runningCount = transferQueueState.current ? 1 : 0;
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
            : 'Transfer Queue, no transfers'
      );
    }

    if (transferQueueTooltip) {
      transferQueueTooltip.dataset.tooltip = !hasActiveSession
        ? 'Connect to a host to view Transfer Queue'
        : hasTransfers
          ? ('Transfer Queue - ' + formatTransferQueueTooltip(transferCount, completedCount, pendingCount))
          : 'Transfer Queue - No transfers';
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

    const current = transferQueueState.current;

    if (!current) {
      transferQueueCurrent.innerHTML = '<div class="transfer-queue-empty">No active transfer.</div>';
      return;
    }

    transferQueueCurrent.innerHTML = renderTransferQueueItem(current, {
      action: current.canCancel ? 'cancel-current' : '',
      actionLabel: current.status === 'Cancelling' ? 'Cancelling...' : 'Cancel',
      disabled: !current.canCancel
    });
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
    const status = item.status === 'Waiting' ? 'Queued' : (item.status || 'Waiting');
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

    return '<div class="transfer-queue-item">' +
      '<div class="transfer-queue-item-main">' +
      '<div class="transfer-queue-item-title"><span class="transfer-queue-icon" aria-hidden="true">' + icon + '</span><span class="transfer-queue-name">' + escapeHtml(operation) + '</span></div>' +
      '<div class="transfer-queue-detail">Connection: ' + escapeHtml(item.connection || '') + '</div>' +
      '<div class="transfer-queue-detail">From: ' + escapeHtml(from) + '</div>' +
      '<div class="transfer-queue-detail">To: ' + escapeHtml(to) + '</div>' +
      timestampHtml +
      '<div class="transfer-queue-status">Status: ' + escapeHtml(formatTransferQueueSentence(status)) + '</div>' +
      '<div class="transfer-queue-progress">Progress: ' + escapeHtml(formatTransferQueueSentence(progress)) + '</div>' +
      '</div>' +
      '<div class="transfer-queue-actions">' + actionHtml + '</div>' +
      '</div>';
  }

  function getTransferQueueTimestampLine(item, status) {
    if (item.finishedAt) {
      if (status === 'Failed') return 'Failed at: ' + item.finishedAt;
      if (status === 'Cancelled') return 'Cancelled at: ' + item.finishedAt;
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
    return String(statusText && statusText.textContent ? statusText.textContent : '').trim();
  }

  function setBusy(isBusy, message, cancelAction = '', cancelLabel = 'Cancel') {
    busy = isBusy;
    statusCancelAction = isBusy ? String(cancelAction || '') : '';
    if (busy) hideContextMenu();
    setControls();
    if (message) statusText.textContent = message;
    if (statusCancelButton) {
      statusCancelButton.textContent = cancelLabel || 'Cancel';
      statusCancelButton.dataset.tooltip = cancelLabel || 'Cancel';
    }
    status.className = isBusy ? ('statusbar busy' + (statusCancelAction ? ' cancelable' : '')) : 'statusbar';
  }

  function setStatus(message, isError = false) {
    busy = false;
    statusCancelAction = '';
    setControls();
    statusText.textContent = message;
    if (statusCancelButton) {
      statusCancelButton.textContent = 'Cancel';
      statusCancelButton.dataset.tooltip = 'Cancel';
    }
    status.className = isError ? 'statusbar error' : 'statusbar';
  }

  function canStartTransferAction() {
    return !busy || statusCancelAction === 'transfer';
  }

  function setControls() {
    const hasProfile = Boolean(selectedProfileId || profileSelect.value);
    const hasActiveSession = Boolean(activeConnectionId);
    connectButton.disabled = busy;
    saveProfileButton.disabled = busy;
    deleteProfileButton.disabled = busy || !hasProfile;
    newProfileButton.disabled = busy;
    profileSelect.disabled = busy;
    disconnectButton.disabled = busy || !hasActiveSession;
    currentPath.disabled = busy || !hasActiveSession;
    filterInput.disabled = busy || !hasActiveSession;
    updateFilterClearButton();
    updateTransferButtons();
    renderTransferQueueButton();
    updatePathFavoriteControls();
    parentButton.disabled = busy || !hasActiveSession;
    refreshButton.disabled = busy || !hasActiveSession;
    uploadButton.disabled = !canStartTransferAction() || !hasActiveSession;
    goButton.disabled = busy || !hasActiveSession;
    sudoToggle.disabled = busy || !hasActiveSession;
    updateSudoToggle();
    privateKeyBrowseButton.disabled = busy;
  }

  function updateTransferButtons() {
    const hasActiveSession = Boolean(activeConnectionId);
    if (uploadButton) uploadButton.disabled = !canStartTransferAction() || !hasActiveSession;
    if (downloadButton) downloadButton.disabled = !canStartTransferAction() || !hasActiveSession || getSelectedActionEntries().length === 0;
    renderTransferQueueButton();
    if (statusCancelButton) statusCancelButton.disabled = !statusCancelAction;
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  </script>
</body>
</html>`;
}
