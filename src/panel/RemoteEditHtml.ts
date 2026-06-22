import * as vscode from 'vscode';

export interface RemoteEditHtmlOptions {
  showRemotePathBreadcrumbDirectoryDetails: boolean;
  openFileListItemsOnNameClick: boolean;
}

export function renderRemoteEditHtml(webview: vscode.Webview, nonce: string, options: RemoteEditHtmlOptions): string {
  const showRemotePathBreadcrumbDirectoryDetails = options.showRemotePathBreadcrumbDirectoryDetails !== false;
  const openFileListItemsOnNameClick = options.openFileListItemsOnNameClick !== false;
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
  * { scrollbar-width: thin; scrollbar-color: var(--vscode-scrollbarSlider-background) transparent; }
  *::-webkit-scrollbar { width: 6px; height: 6px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb { background-color: var(--vscode-scrollbarSlider-background); border-radius: 6px; border: 2px solid transparent; background-clip: padding-box; }
  *::-webkit-scrollbar-thumb:hover { background-color: var(--vscode-scrollbarSlider-hoverBackground); }
  *::-webkit-scrollbar-thumb:active { background-color: var(--vscode-scrollbarSlider-activeBackground); }
  *::-webkit-scrollbar-corner { background: transparent; }
  html, body { margin: 0; height: 100%; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); overflow: hidden; user-select: none; -webkit-user-select: none; }
  input, textarea { user-select: text; -webkit-user-select: text; }
  input.connection-input-invalid, select.connection-input-invalid, .profile-dropdown-button.connection-input-invalid { border-color: var(--remoteedit-validation-error); }
  input.connection-input-invalid:focus, input.connection-input-invalid:focus-visible, select.connection-input-invalid:focus, select.connection-input-invalid:focus-visible, .profile-dropdown-button.connection-input-invalid:focus, .profile-dropdown-button.connection-input-invalid:focus-visible { border-color: var(--remoteedit-validation-error); outline: none; box-shadow: none; }
  .page { height: 100vh; padding: 10px 0; margin: 0 -9px; width: calc(100% + 18px); display: flex; min-width: 0; }
  .shell { width: 100%; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .session-strip { display: flex; gap: 6px; align-items: center; min-height: 30px; margin-top: 10px; overflow-x: auto; padding: 1px 0; flex: 0 0 auto; }
  .session-label { color: var(--vscode-descriptionForeground); font-size: 12px; margin-right: 2px; white-space: nowrap; }
  .session-tabs { position: relative; display: flex; gap: 0; align-items: flex-end; min-width: 0; overflow-y: hidden; }
  .session-tab { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 34px; min-height: 34px; max-width: 220px; border: 1px solid var(--vscode-panel-border); border-bottom: 0; background: var(--vscode-editor-background); color: var(--vscode-tab-inactiveForeground, var(--vscode-foreground)); border-radius: 0; padding: 0 8px 0 10px; cursor: pointer; white-space: nowrap; line-height: normal; font-size: 12px; }
  .session-tab:hover:not(:disabled) { background: var(--vscode-tab-hoverBackground, var(--vscode-list-hoverBackground)); border-color: var(--vscode-panel-border); color: var(--vscode-foreground); }
  .session-tab + .session-tab { margin-left: -1px; }
  .session-tab.active { position: relative; z-index: 4; border: 1px solid var(--vscode-panel-border); border-bottom: 0; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); color: var(--vscode-tab-activeForeground, var(--vscode-foreground)); box-shadow: none; }
  .session-tab.active::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: var(--vscode-tab-activeBorderTop, var(--vscode-focusBorder)); border-radius: 0; pointer-events: none; }
  .session-tab.active:hover:not(:disabled) { background: var(--vscode-sideBar-background, var(--vscode-editor-background)); border-color: var(--vscode-panel-border); color: var(--vscode-tab-activeForeground, var(--vscode-foreground)); }
  .session-tab.dragging { opacity: 0.58; }
  .session-tab-drop-line { position: absolute; bottom: 0; width: 1px; height: 33px; background: var(--vscode-focusBorder); display: none; pointer-events: none; z-index: 12; transform: none; }
  .session-icon { width: 16px; min-width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: inherit; opacity: 0.82; flex: 0 0 auto; font-size: 16px; line-height: 16px; }
  .session-icon svg { width: 16px; height: 16px; display: block; fill: currentColor; }
  .session-tab.connecting .session-icon .spinner { display: block; width: 14px; min-width: 14px; height: 14px; border-width: 2px; border-color: currentColor; border-right-color: transparent; opacity: 0.82; }
  .session-tab.failed .session-icon { color: inherit; opacity: 0.82; }
  .session-name { display: inline-flex; align-items: center; height: 100%; overflow: hidden; text-overflow: ellipsis; min-width: 0; line-height: 1; }
  .session-close { position: relative; width: 20px; min-width: 20px; height: 20px; min-height: 20px; display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0 -3px 0 0; border-radius: 3px; background: transparent; color: inherit; opacity: 0.72; line-height: 0; font-size: 0; font-weight: 400; transform: none; flex: 0 0 auto; }
  .session-close::before, .session-close::after { content: ''; position: absolute; left: 50%; top: 50%; width: 11px; height: 1px; background: currentColor; transform-origin: center; }
  .session-close::before { transform: translate(-50%, -50%) rotate(45deg); }
  .session-close::after { transform: translate(-50%, -50%) rotate(-45deg); }
  .session-close:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); opacity: 1; }
  .session-empty { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 34px; }
  .layout { position: relative; display: grid; grid-template-columns: var(--connection-panel-width, 320px) minmax(0, 1fr); gap: 10px; margin-top: 0; align-items: stretch; flex: 1 1 auto; min-height: 0; min-width: 0; }
  .layout.connection-collapsed { grid-template-columns: 0px minmax(0, 1fr); gap: 0; }
  .layout.connection-collapsed .connection-card { opacity: 0; transform: translateX(-12px); pointer-events: none; border-color: transparent; }
  .connection-panel-handle { width: 10px; min-width: 10px; height: 35px; min-height: 35px; pointer-events: none; }
  .connection-panel-handle .tooltip-anchor { display: flex; align-items: center; justify-content: center; width: 10px; height: 35px; line-height: 0; pointer-events: auto; }
  .connection-panel-handle .panel-toggle-button { width: 10px; min-width: 10px; height: 35px; min-height: 35px; padding: 0; background: var(--vscode-sideBar-background); color: var(--vscode-descriptionForeground); opacity: 0.68; box-shadow: 0 1px 3px rgb(0 0 0 / 14%); }
  .connection-panel-handle .panel-toggle-button:hover:not(:disabled) { color: var(--vscode-foreground); opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .connection-panel-handle .panel-toggle-button svg { width: 10px; height: 10px; }
  .connection-rail { position: fixed; left: 0; top: var(--connection-rail-top, 150px); z-index: 50; opacity: 0; transform: translateX(-6px); }
  .connection-rail .tooltip-anchor { pointer-events: none; }
  .layout.connection-collapsed .connection-rail { opacity: 1; transform: translateX(0); }
  .layout.connection-collapsed .connection-rail .tooltip-anchor { pointer-events: auto; }
  .connection-rail .panel-toggle-button { border-left: 0; border-radius: 0 4px 4px 0; }
  .connection-collapse-handle { position: absolute; right: 0; top: 6px; z-index: 30; }
  .connection-collapse-handle .panel-toggle-button { border-right: 0; border-radius: 4px 0 0 4px; }
  @media (prefers-reduced-motion: no-preference) {
    .layout.connection-transition-ready { transition: grid-template-columns 150ms ease-out, gap 150ms ease-out; }
    .layout.connection-transition-ready .connection-card { transition: opacity 150ms ease-out, transform 150ms ease-out, border-color 150ms ease-out; }
    .layout.connection-transition-ready .connection-panel-handle { transition: opacity 150ms ease-out, transform 150ms ease-out; }
    .layout.connection-transition-ready .connection-panel-handle .panel-toggle-button { transition: opacity 150ms ease-out, background-color 150ms ease-out, color 150ms ease-out; }
  }
  .browser-column { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .browser-card { flex: 1 1 auto; }
  .browser-open-section { position: relative; z-index: 2; display: grid; grid-template-columns: minmax(150px, auto) minmax(0, 1fr); column-gap: 10px; align-items: center; min-height: 46px; padding: 6px 10px; background: var(--vscode-editor-background); }
  .browser-open-text { min-width: 0; }
  .browser-open-section .card-subtitle { margin-top: 3px; }
  .browser-title-section { padding: 10px 12px; background: var(--vscode-editor-background); }
  .open-connections-row { display: flex; align-items: stretch; align-self: stretch; min-width: 0; min-height: 0; margin-bottom: -7px; }
  .browser-session-strip { margin-top: 0; min-height: 0; height: 100%; padding: 0; flex: 1 1 auto; min-width: 0; justify-content: flex-start; align-items: flex-end; border-bottom: 0; overflow-y: hidden; }
  .browser-session-strip .session-tabs { align-items: flex-end; height: 100%; overflow-x: auto; overflow-y: hidden; gap: 0; }
  .browser-session-strip .session-tabs.empty { align-items: center; overflow-x: hidden; }
  .browser-session-strip .session-tabs.empty .session-empty { display: inline-flex; align-items: center; height: 100%; line-height: normal; }
  .browser-section-divider { position: relative; z-index: 1; height: 1px; background: linear-gradient(to right, var(--vscode-panel-border) 0, var(--vscode-panel-border) var(--active-tab-left, 0px), transparent var(--active-tab-left, 0px), transparent calc(var(--active-tab-left, 0px) + var(--active-tab-width, 0px)), var(--vscode-panel-border) calc(var(--active-tab-left, 0px) + var(--active-tab-width, 0px)), var(--vscode-panel-border) 100%); flex: 0 0 auto; }
  .connection-view-switch { display: inline-flex; align-items: center; flex: 0 0 auto; height: 32px; box-sizing: border-box; padding: 1px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; background: var(--vscode-input-background); }
  .connection-view-switch[hidden] { display: none !important; }
  .connection-view-switch-button { width: 52px; min-width: 52px; height: 28px; min-height: 28px; padding: 0 4px; border: 0; border-radius: 3px; background: transparent; color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground)); font-size: inherit; }
  .pathbar-view-switch { justify-self: end; }
  .server-view-switch { justify-self: end; align-self: start; }
  .view-switch-separator { justify-self: center; margin-left: 2px; margin-right: 0; }
  .server-refresh-actions { display: none; align-items: center; gap: 4px; justify-content: flex-end; }
  .server-refresh-actions[hidden], .server-refresh-separator[hidden] { display: none !important; }
  .server-refresh-actions .icon-only { height: 32px; min-height: 32px; }
  .server-auto-refresh-picker { position: relative; width: 104px; min-width: 104px; }
  .server-auto-refresh-button { width: 100%; }
  .server-auto-refresh-menu { min-width: 128px; right: auto; }
  .server-refresh-separator { display: none; justify-self: center; }
  .server-toolbar-status { position: absolute; z-index: 2; top: 0; bottom: 0; left: 0; display: none; align-items: center; min-width: 0; width: var(--remote-path-width, 44vw); max-width: min(var(--remote-path-width, 44vw), calc(100% - 520px)); height: 32px; padding: 0 4px; box-sizing: border-box; color: var(--vscode-descriptionForeground); opacity: 0.92; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; line-height: 1.2; pointer-events: none; }
  .pathbar.server-toolbar-mode .server-toolbar-status { display: flex; }
  .server-toolbar-status.error { color: var(--vscode-errorForeground, var(--remoteedit-validation-error)); opacity: 1; }
  .pathbar.server-toolbar-mode .server-refresh-actions { display: inline-flex; }
  .pathbar.server-toolbar-mode .server-refresh-separator { display: block; }
  .connection-view-switch-button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); }
  .connection-view-switch-button.active { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); box-shadow: inset 0 0 0 1px var(--vscode-widget-border, var(--vscode-panel-border)); }
  .connection-view-switch-button:disabled { opacity: 0.48; cursor: default; }
  .connection-view { flex: 1 1 auto; min-width: 0; min-height: 0; }
  .files-view { display: flex; flex-direction: column; }
  .connection-view.hidden { display: none !important; }
  .server-view { overflow: auto; padding-right: 2px; font-size: 11.5px; line-height: 1.25; }
  .server-dashboard {
    --server-overview-card-height: 68px;
    --server-row-large-card-height: 176px;
    --server-row-standard-card-height: 176px;
    --server-system-info-card-height: 176px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 100%;
  }
  .server-header { display: flex; flex-direction: column; gap: 7px; padding: 8px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; background: var(--vscode-editor-background); }
  .server-header-top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; min-width: 0; }
  .server-header-main { min-width: 0; }
  .server-title-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .server-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-foreground); font-weight: 650; font-size: 12px; }
  .server-meta { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; flex-wrap: wrap; }
  .server-actions button { height: 24px; min-height: 24px; padding: 0 8px; font-size: 11px; }
  .server-badge { display: inline-flex; align-items: center; height: 16px; min-height: 16px; padding: 0 5px; border: 1px solid var(--vscode-panel-border); border-radius: 999px; color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background); font-size: 10px; line-height: 1; white-space: nowrap; }
  .server-badge.active { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, var(--vscode-focusBorder)) 45%, var(--vscode-panel-border)); }
  .server-overview-grid { display: grid; grid-template-columns: repeat(4, minmax(110px, 1fr)); gap: 8px; }
  .server-overview-card, .server-section-card { border: 1px solid var(--vscode-panel-border); border-radius: 5px; background: var(--vscode-editor-background); min-width: 0; box-sizing: border-box; overflow: hidden; }
  .server-overview-card { display: flex; flex-direction: column; height: var(--server-overview-card-height); min-height: var(--server-overview-card-height); padding: 7px 9px; }
  .server-overview-label { color: var(--vscode-descriptionForeground); font-size: 10.5px; margin-bottom: 3px; }
  .server-overview-value { color: var(--vscode-foreground); font-size: 13px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .server-overview-help { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .server-section-card { display: flex; flex-direction: column; height: var(--server-row-standard-card-height); min-height: var(--server-row-standard-card-height); padding: 8px 9px; }
  .server-grid > .server-section-card:nth-child(1),
  .server-grid > .server-section-card:nth-child(2) { height: var(--server-row-large-card-height); min-height: var(--server-row-large-card-height); }
  .server-grid > .server-section-card.full-width { height: var(--server-system-info-card-height); min-height: var(--server-system-info-card-height); }
  .server-section-card.full-width { grid-column: 1 / -1; }
  .server-section-title-row { position: relative; top: -4px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px; flex: 0 0 auto; min-height: 18px; margin-bottom: 4px; }
  .server-section-title-row::before { content: ''; position: absolute; top: -4px; right: -9px; bottom: -4px; left: -9px; background: color-mix(in srgb, var(--vscode-editor-foreground) 5%, transparent); pointer-events: none; }
  .server-section-title-row > * { position: relative; z-index: 1; }
  .server-section-title { color: var(--vscode-foreground); font-size: 11.5px; font-weight: 650; }
  .server-section-title-wrap { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; }
  .server-section-title-wrap .server-section-title { flex: 0 0 auto; }
  .server-section-count { color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .server-section-note { color: var(--vscode-descriptionForeground); font-size: 10.5px; }
  .server-list { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
  .server-list-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; min-height: 23px; padding: 2px 0; border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 52%, transparent); }
  .server-list-row:first-child { border-top: 0; }
  .server-list-column-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; flex: 0 0 auto; min-height: 17px; padding: 0 4px 3px; margin-bottom: 2px; border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 46%, transparent); color: var(--vscode-descriptionForeground); font-size: 9.8px; line-height: 1.2; }
  .server-list-column-header-main { min-width: 0; overflow: hidden; }
  .server-list-column-header-trailing { min-width: 0; }
  .server-list-column-sort-button { appearance: none; -webkit-appearance: none; display: inline-flex; align-items: center; gap: 3px; min-width: 0; height: 16px; min-height: 16px; padding: 0 2px; border: 0; border-radius: 2px; background: transparent; color: var(--vscode-descriptionForeground); font: inherit; font-weight: 600; line-height: 1.2; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-list-column-sort-button.active { color: var(--vscode-foreground); }
  .server-list-column-header button.server-list-column-sort-button:hover:not(:disabled),
  .server-list-column-header button.server-list-column-sort-button:focus-visible { color: var(--vscode-foreground); background: transparent; outline: none; box-shadow: none; }
  .server-list-sort-indicator { flex: 0 0 auto; width: 8px; min-width: 8px; text-align: center; font-size: 9px; opacity: 0.85; }
  .server-list-column-header-actions-space { display: inline-block; flex: 0 0 auto; }
  .server-quick-task-actions-space { min-width: 36px; }
  .server-log-shortcut-actions-space { min-width: 118px; }
  .server-service-actions-space { min-width: 114px; }
  .server-process-actions-space { min-width: 42px; }
  .server-scheduled-actions-space { min-width: 78px; }
  .server-port-forward-actions-space { min-width: 48px; }
  .server-list-main { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-list-title { color: var(--vscode-foreground); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-list-subtitle { margin-top: 1px; color: var(--vscode-descriptionForeground); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-row-actions { display: inline-flex; gap: 4px; align-items: center; }
  .server-row-actions button { height: 21px; min-height: 21px; padding: 0 6px; font-size: 10.5px; }
  .server-quick-tasks-title-row { grid-template-columns: minmax(0, 1fr) auto; }
  .server-quick-tasks-filter-box { position: relative; justify-self: end; width: 180px; min-width: 180px; max-width: 180px; }
  .server-quick-tasks-filter { width: 100%; min-width: 0; height: 21px; min-height: 21px; padding: 2px 27px 2px 7px; border-radius: 3px; border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; font-size: 10.5px; }
  .server-quick-tasks-filter:focus, .server-quick-tasks-filter:focus-visible { border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; }
  .server-quick-tasks-filter::placeholder { color: var(--vscode-input-placeholderForeground); opacity: 0.85; }
  .server-quick-tasks-filter-box .filter-clear-button { width: 19px; min-width: 19px; height: 19px; min-height: 19px; right: 3px; }
  .server-quick-tasks-filter-box.has-value .filter-clear-button { opacity: 0.7; visibility: visible; }
  .server-quick-tasks-filter-box.has-value .filter-clear-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .server-quick-task-row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 25px; padding: 2px 4px; border-radius: 4px; cursor: pointer; }
  .server-quick-task-row:hover { background: var(--vscode-list-hoverBackground); }
  .server-quick-task-main { display: grid; grid-template-columns: minmax(90px, 42%) minmax(0, 1fr); gap: 8px; align-items: center; min-width: 0; overflow: hidden; }
  .server-quick-task-details, .server-quick-task-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-quick-task-name { color: var(--vscode-foreground); font-size: 11.5px; }
  .server-quick-task-details { color: var(--vscode-descriptionForeground); font-size: 10.5px; }
  .server-quick-task-actions { display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; align-self: center; flex: 0 0 auto; min-width: 36px; opacity: 0; pointer-events: none; transition: opacity 80ms ease-out; }
  .server-quick-task-row:hover .server-quick-task-actions,
  .server-quick-task-row:focus-within .server-quick-task-actions { opacity: 1; pointer-events: auto; }
  .server-quick-task-actions .tooltip-anchor { display: inline-flex; align-items: center; justify-content: center; }
  .server-quick-task-action-button { height: 19px; min-height: 19px; padding: 0 6px; font-size: 10px; line-height: 1; }
  .server-quick-tasks-card .server-placeholder { display: grid; gap: 7px; align-content: start; }
  .server-quick-tasks-card .server-placeholder button { justify-self: start; height: 23px; min-height: 23px; padding: 0 7px; font-size: 10.5px; }
  .server-card-link-button { align-self: flex-start; height: 21px; min-height: 21px; margin-top: 5px; padding: 0 0; border: 0; background: transparent; color: var(--vscode-textLink-foreground); font-size: 10.5px; }
  .server-card-link-button:hover:not(:disabled), .server-card-link-button:focus-visible { background: transparent; color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground)); text-decoration: underline; outline: none; }
  .server-section-title-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; }
  .server-section-title-right { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
  .server-section-title-separator { width: 1px; height: 18px; flex: 0 0 auto; background: var(--vscode-panel-border); opacity: 0.9; }
  .server-section-title-actions .remote-command-icon-button { width: 18px; min-width: 18px; height: 18px; min-height: 18px; }
  .server-services-title-row { grid-template-columns: minmax(0, 1fr) auto; }
  .server-services-filter-box { position: relative; justify-self: end; width: 180px; min-width: 180px; max-width: 180px; }
  .server-services-filter { width: 100%; min-width: 0; height: 21px; min-height: 21px; padding: 2px 27px 2px 7px; border-radius: 3px; border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; font-size: 10.5px; }
  .server-services-filter:focus, .server-services-filter:focus-visible { border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; }
  .server-services-filter::placeholder { color: var(--vscode-input-placeholderForeground); opacity: 0.85; }
  .server-services-filter-box .filter-clear-button { width: 19px; min-width: 19px; height: 19px; min-height: 19px; right: 3px; }
  .server-services-filter-box.has-value .filter-clear-button { opacity: 0.7; visibility: visible; }
  .server-services-filter-box.has-value .filter-clear-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .server-logs-title-row { grid-template-columns: minmax(0, 1fr) auto; }
  .server-logs-filter-box { position: relative; justify-self: end; width: 180px; min-width: 180px; max-width: 180px; }
  .server-logs-filter { width: 100%; min-width: 0; height: 21px; min-height: 21px; padding: 2px 27px 2px 7px; border-radius: 3px; border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; font-size: 10.5px; }
  .server-logs-filter:focus, .server-logs-filter:focus-visible { border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; }
  .server-logs-filter::placeholder { color: var(--vscode-input-placeholderForeground); opacity: 0.85; }
  .server-logs-filter-box .filter-clear-button { width: 19px; min-width: 19px; height: 19px; min-height: 19px; right: 3px; }
  .server-logs-filter-box.has-value .filter-clear-button { opacity: 0.7; visibility: visible; }
  .server-logs-filter-box.has-value .filter-clear-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .server-log-shortcuts-list { max-height: none; overflow-y: auto; overflow-x: hidden; padding-right: 2px; }
  .server-log-shortcut-row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 25px; padding: 2px 4px; border-radius: 4px; }
  .server-log-shortcut-row:hover { background: var(--vscode-list-hoverBackground); }
  .server-log-shortcut-main { display: grid; grid-template-columns: minmax(90px, 38%) minmax(0, 1fr); gap: 8px; align-items: center; min-width: 0; overflow: hidden; }
  .server-log-shortcut-title { display: flex; align-items: center; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-log-shortcut-path { min-width: 0; color: var(--vscode-descriptionForeground); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-log-shortcut-title-button { display: block; width: 100%; min-width: 0; height: auto; min-height: 0; padding: 0; border: 0; border-radius: 2px; background: transparent; color: var(--vscode-foreground); text-align: left; font: inherit; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
  .server-log-shortcut-title-button:hover:not(:disabled), .server-log-shortcut-title-button:focus-visible { background: transparent; color: var(--vscode-foreground); text-decoration: none; outline: none; }
  .server-log-shortcut-actions { display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; align-self: center; flex: 0 0 auto; min-width: 118px; opacity: 0; pointer-events: none; transition: opacity 80ms ease-out; }
  .server-log-shortcut-row:hover .server-log-shortcut-actions,
  .server-log-shortcut-row:focus-within .server-log-shortcut-actions { opacity: 1; pointer-events: auto; }
  .server-log-shortcut-actions .tooltip-anchor { display: inline-flex; align-items: center; justify-content: center; }
  .server-log-shortcut-action-button { height: 19px; min-height: 19px; padding: 0 6px; font-size: 10px; line-height: 1; }
  .server-section-title-actions svg { width: 12px; height: 12px; display: block; fill: currentColor; }
  .server-service-row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 25px; padding: 2px 4px; border-radius: 4px; cursor: pointer; }
  .server-service-row:hover { background: var(--vscode-list-hoverBackground); }
  .server-service-main { display: flex; align-items: center; min-width: 0; overflow: hidden; }
  .server-service-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-service-trailing { display: inline-flex; gap: 7px; align-items: center; justify-content: flex-end; align-self: center; flex: 0 0 auto; min-width: 184px; }
  .server-service-status { display: inline-flex; align-items: center; justify-content: center; height: 16px; min-width: 54px; padding: 0 5px; border: 1px solid var(--vscode-panel-border); border-radius: 999px; color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background); font-size: 10px; line-height: 1; white-space: nowrap; }
  .server-service-status.running { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, var(--vscode-focusBorder)) 45%, var(--vscode-panel-border)); }
  .server-service-status.failed { color: var(--vscode-testing-iconFailed, var(--remoteedit-validation-error)); border-color: color-mix(in srgb, var(--vscode-testing-iconFailed, var(--remoteedit-validation-error)) 45%, var(--vscode-panel-border)); }
  .server-service-actions { display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; align-self: center; flex: 0 0 auto; min-width: 114px; opacity: 0; pointer-events: none; transition: opacity 80ms ease-out; }
  .server-service-row:hover .server-service-actions,
  .server-service-row:focus-within .server-service-actions { opacity: 1; pointer-events: auto; }
  .server-service-actions .tooltip-anchor { display: inline-flex; align-items: center; justify-content: center; }
  .server-service-action-button { height: 19px; min-height: 19px; padding: 0 6px; font-size: 10px; line-height: 1; }
  .server-processes-title-row { grid-template-columns: minmax(0, 1fr) auto; }
  .server-processes-filter-box { position: relative; justify-self: end; width: 180px; min-width: 180px; max-width: 180px; }
  .server-processes-filter { width: 100%; min-width: 0; height: 21px; min-height: 21px; padding: 2px 27px 2px 7px; border-radius: 3px; border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; font-size: 10.5px; }
  .server-processes-filter:focus, .server-processes-filter:focus-visible { border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; }
  .server-processes-filter::placeholder { color: var(--vscode-input-placeholderForeground); opacity: 0.85; }
  .server-processes-filter-box .filter-clear-button { width: 19px; min-width: 19px; height: 19px; min-height: 19px; right: 3px; }
  .server-processes-filter-box.has-value .filter-clear-button { opacity: 0.7; visibility: visible; }
  .server-processes-filter-box.has-value .filter-clear-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .server-process-row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 25px; padding: 2px 4px; border-radius: 4px; cursor: pointer; }
  .server-process-row:hover { background: var(--vscode-list-hoverBackground); }
  .server-process-main { display: grid; grid-template-columns: minmax(0, 1fr) 42px minmax(44px, 74px) 44px 44px; gap: 7px; align-items: center; min-width: 0; overflow: hidden; }
  .server-process-pid { min-width: 0; color: var(--vscode-descriptionForeground); font-size: 10.5px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-process-command { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-foreground); font-size: 11.5px; }
  .server-process-user { min-width: 0; color: var(--vscode-descriptionForeground); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-process-cpu, .server-process-memory { min-width: 0; color: var(--vscode-descriptionForeground); font-size: 10px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-process-trailing { display: inline-flex; gap: 7px; align-items: center; justify-content: flex-end; align-self: center; flex: 0 0 auto; min-width: 72px; }
  .server-process-actions { display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; align-self: center; flex: 0 0 auto; min-width: 42px; opacity: 0; pointer-events: none; transition: opacity 80ms ease-out; }
  .server-process-row:hover .server-process-actions,
  .server-process-row:focus-within .server-process-actions { opacity: 1; pointer-events: auto; }
  .server-process-row.process-action-active .server-process-actions { opacity: 0; pointer-events: none; }
  .server-process-actions .tooltip-anchor { display: inline-flex; align-items: center; justify-content: center; }
  .server-process-action-button { height: 19px; min-height: 19px; padding: 0 6px; font-size: 10px; line-height: 1; }
  .server-process-status { display: inline-flex; align-items: center; justify-content: center; height: 16px; min-width: 68px; padding: 0 5px; border: 1px solid var(--vscode-panel-border); border-radius: 999px; color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background); font-size: 10px; line-height: 1; white-space: nowrap; }
  .server-process-status.terminated { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, var(--vscode-focusBorder)) 45%, var(--vscode-panel-border)); }
  .server-process-status.killing, .server-process-status.still-running { color: var(--vscode-charts-yellow, var(--vscode-descriptionForeground)); border-color: color-mix(in srgb, var(--vscode-charts-yellow, var(--vscode-focusBorder)) 45%, var(--vscode-panel-border)); }
  .server-scheduled-title-row { grid-template-columns: minmax(0, 1fr) auto; }
  .server-scheduled-filter-box { position: relative; justify-self: end; width: 180px; min-width: 180px; max-width: 180px; }
  .server-scheduled-filter { width: 100%; min-width: 0; height: 21px; min-height: 21px; padding: 2px 27px 2px 7px; border-radius: 3px; border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; font-size: 10.5px; }
  .server-scheduled-filter:focus, .server-scheduled-filter:focus-visible { border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; }
  .server-scheduled-filter::placeholder { color: var(--vscode-input-placeholderForeground); opacity: 0.85; }
  .server-scheduled-filter-box .filter-clear-button { width: 19px; min-width: 19px; height: 19px; min-height: 19px; right: 3px; }
  .server-scheduled-filter-box.has-value .filter-clear-button { opacity: 0.7; visibility: visible; }
  .server-scheduled-filter-box.has-value .filter-clear-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .server-scheduled-list { max-height: none; overflow-y: auto; overflow-x: hidden; padding-right: 2px; }
  .server-scheduled-row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 25px; padding: 2px 4px; border-radius: 4px; cursor: pointer; }
  .server-scheduled-row:hover { background: var(--vscode-list-hoverBackground); }
  .server-scheduled-main { display: grid; grid-template-columns: minmax(0, 1fr) 74px 86px; gap: 8px; align-items: center; min-width: 0; overflow: hidden; }
  .server-scheduled-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-foreground); font-size: 11.5px; }
  .server-scheduled-count, .server-scheduled-type { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 10.5px; }
  .server-scheduled-actions { display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; align-self: center; flex: 0 0 auto; min-width: 78px; opacity: 0; pointer-events: none; transition: opacity 80ms ease-out; }
  .server-scheduled-row:hover .server-scheduled-actions,
  .server-scheduled-row:focus-within .server-scheduled-actions { opacity: 1; pointer-events: auto; }
  .server-scheduled-actions .tooltip-anchor { display: inline-flex; align-items: center; justify-content: center; }
  .server-scheduled-action-button { height: 19px; min-height: 19px; padding: 0 6px; font-size: 10px; line-height: 1; }
    .server-log-shortcut-empty { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 7px 8px; border: 1px dashed var(--vscode-panel-border); border-radius: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.25; background: color-mix(in srgb, var(--vscode-input-background) 70%, transparent); }
  .server-log-shortcut-dialog { width: min(520px, calc(100vw - 48px)); overflow: visible; }
  .server-log-shortcut-dialog .file-properties-body { overflow: visible; }
  .server-log-shortcut-fields { display: grid; gap: 10px; }
  .server-log-shortcut-field { display: grid; gap: 5px; }
  .server-log-shortcut-field label { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 650; }
  .server-log-shortcut-field input { width: 100%; box-sizing: border-box; }
  .server-log-shortcut-path-wrap { position: relative; display: block; }
  .server-log-shortcut-path-wrap input { min-width: 0; padding-right: 34px; }
  .server-log-shortcut-path-wrap .input-icon-button { position: absolute; top: 3px; right: 3px; bottom: 3px; z-index: 2; width: 26px; min-width: 26px; height: auto; min-height: 0; padding: 2px; }
  .remote-search-scope-picker.server-log-shortcut-picker {
    position: fixed;
    left: 0;
    right: auto;
    top: 0;
    bottom: auto;
    z-index: 10000;
    max-width: calc(100vw - 16px);
  }
  .remote-search-scope-picker.server-log-shortcut-picker .remote-search-scope-picker-list { max-height: 220px; }
  .server-log-shortcut-field input.server-log-shortcut-input-invalid { border-color: var(--remoteedit-validation-error); }
  .server-log-shortcut-feedback { min-height: 16px; line-height: 16px; color: var(--remoteedit-validation-error); font-size: 11px; }
  .server-log-shortcut-remove-path { margin-top: 8px; padding: 6px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-port-forwards-title-row { grid-template-columns: minmax(0, 1fr) auto; }
  .server-port-forwards-filter-box { position: relative; justify-self: end; width: 180px; min-width: 180px; max-width: 180px; }
  .server-port-forwards-filter { width: 100%; min-width: 0; height: 21px; min-height: 21px; padding: 2px 27px 2px 7px; border-radius: 3px; border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; font-size: 10.5px; }
  .server-port-forwards-filter:focus, .server-port-forwards-filter:focus-visible { border-color: var(--vscode-input-border, transparent); box-shadow: none; outline: none; }
  .server-port-forwards-filter::placeholder { color: var(--vscode-input-placeholderForeground); opacity: 0.85; }
  .server-port-forwards-filter-box .filter-clear-button { width: 19px; min-width: 19px; height: 19px; min-height: 19px; right: 3px; }
  .server-port-forwards-filter-box.has-value .filter-clear-button { opacity: 0.7; visibility: visible; }
  .server-port-forwards-filter-box.has-value .filter-clear-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .server-port-forward-row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 25px; padding: 2px 4px; border-radius: 4px; cursor: pointer; }
  .server-port-forward-row:hover { background: var(--vscode-list-hoverBackground); }
  .server-port-forward-main { display: grid; grid-template-columns: minmax(90px, 32%) minmax(0, 1fr); gap: 8px; align-items: center; min-width: 0; overflow: hidden; }
  .server-port-forward-name, .server-port-forward-target { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-port-forward-name { color: var(--vscode-foreground); font-size: 11.5px; }
  .server-port-forward-target { color: var(--vscode-descriptionForeground); font-size: 10.5px; }
  .server-port-forward-trailing { display: inline-flex; gap: 7px; align-items: center; justify-content: flex-end; align-self: center; flex: 0 0 auto; min-width: 156px; }
  .server-port-forward-status { display: inline-flex; align-items: center; justify-content: center; height: 16px; min-width: 54px; padding: 0 5px; border: 1px solid var(--vscode-panel-border); border-radius: 999px; color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background); font-size: 10px; line-height: 1; white-space: nowrap; }
  .server-port-forward-status.running { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, var(--vscode-focusBorder)) 45%, var(--vscode-panel-border)); }
  .server-port-forward-status.error { color: var(--vscode-testing-iconFailed, var(--remoteedit-validation-error)); border-color: color-mix(in srgb, var(--vscode-testing-iconFailed, var(--remoteedit-validation-error)) 45%, var(--vscode-panel-border)); }
  .server-port-forward-actions { display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; align-self: center; flex: 0 0 auto; min-width: 48px; opacity: 0; pointer-events: none; transition: opacity 80ms ease-out; }
  .server-port-forward-row:hover .server-port-forward-actions,
  .server-port-forward-row:focus-within .server-port-forward-actions { opacity: 1; pointer-events: auto; }
  .server-port-forward-actions .tooltip-anchor { display: inline-flex; align-items: center; justify-content: center; }
  .server-port-forward-action-button { height: 19px; min-height: 19px; padding: 0 6px; font-size: 10px; line-height: 1; }
  .server-port-forward-empty { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 7px 8px; border: 1px dashed var(--vscode-panel-border); border-radius: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.25; background: color-mix(in srgb, var(--vscode-input-background) 70%, transparent); }
  .server-port-forward-dialog { width: min(520px, calc(100vw - 48px)); }
  .server-port-forward-fields { display: grid; gap: 10px; }
  .server-port-forward-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .server-port-forward-field { display: grid; gap: 5px; }
  .server-port-forward-field label { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 650; }
  .server-port-forward-field input { width: 100%; box-sizing: border-box; }
  .server-port-forward-field input.server-port-forward-input-invalid { border-color: var(--remoteedit-validation-error); }
  .server-port-forward-option { width: fit-content; color: var(--vscode-descriptionForeground); user-select: none; }
  .server-port-forward-auto-badge { display: inline-flex; align-items: center; justify-content: center; height: 16px; min-width: 30px; padding: 0 5px; border: 1px solid var(--vscode-panel-border); border-radius: 999px; color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background); font-size: 10px; line-height: 1; white-space: nowrap; }
  .server-port-forward-feedback { min-height: 16px; line-height: 16px; color: var(--remoteedit-validation-error); font-size: 11px; }
  .server-port-forward-help { color: var(--vscode-descriptionForeground); font-size: 10.5px; line-height: 1.35; }
  .server-port-forward-running-note { padding: 6px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-descriptionForeground); font-size: 11px; }
  .server-port-forward-remove-path { margin-top: 8px; padding: 6px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-placeholder { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 7px 8px; border: 1px dashed var(--vscode-panel-border); border-radius: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.25; background: color-mix(in srgb, var(--vscode-input-background) 70%, transparent); }
  .server-disabled-state { display: grid; place-items: center; min-height: 220px; padding: 18px; text-align: center; color: var(--vscode-descriptionForeground); border: 1px dashed var(--vscode-panel-border); border-radius: 5px; background: var(--vscode-editor-background); }
  .server-disabled-title { color: var(--vscode-foreground); font-weight: 650; margin-bottom: 4px; }
  .server-system-info-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px 10px; align-content: start; flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
  .server-system-info-item { min-width: 0; }
  .server-system-info-label { color: var(--vscode-descriptionForeground); font-size: 10px; margin-bottom: 1px; }
  .server-system-info-value { color: var(--vscode-foreground); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 1100px) { .server-overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .server-grid { grid-template-columns: 1fr; } .server-system-info-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 820px) { .connection-view-switch { align-self: flex-start; } .server-header-top { grid-template-columns: 1fr; } .server-actions { justify-content: flex-start; } .server-overview-grid, .server-system-info-grid { grid-template-columns: 1fr; } }
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
  .card-header { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
  .card-header.connection-card-header { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; min-height: 46px; padding: 7px 32px 7px 12px; }
  .connection-card-title-text { min-width: 0; }
  .panel-toggle-button { width: 28px; min-width: 28px; height: 28px; min-height: 28px; padding: 4px; border-radius: 3px; flex: 0 0 auto; }
  .connection-card-header .panel-toggle-button { width: 24px; min-width: 24px; height: 24px; min-height: 24px; padding: 3px; }
  .panel-toggle-button svg { width: 16px; height: 16px; }
  .browser-open-text-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .card-title { font-weight: 650; margin: 0; }
  .card-subtitle { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; line-height: 1.3; margin-top: 3px; opacity: 0.85; }
  .card-body { padding: 12px; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden; }
  .browser-card .card-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .connection-card .connection-card-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; padding: 0; overflow: hidden; }
  .connection-profile-section { flex: 0 0 auto; padding: 12px; min-width: 0; }
  .connection-card .profile-row { margin-bottom: 0; }
  .connection-details-scroll { flex: 1 1 auto; min-height: 0; min-width: 0; padding: 10px 12px 12px; overflow-y: auto; overflow-x: hidden; }
  .connection-panel-divider { height: 1px; background: var(--vscode-panel-border); flex: 0 0 auto; }
  .connection-actions-section { flex: 0 0 auto; padding: 10px 12px 12px; background: var(--vscode-sideBar-background); }
  .form-grid { display: grid; grid-template-columns: minmax(0, 1fr) 70px; gap: 8px; min-width: 0; }
  .full { grid-column: 1 / -1; }
  .keepalive-row { margin-top: 6px; margin-bottom: 0; }
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
  .button-row { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 12px; }
  .connection-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; align-items: center; width: 100%; min-width: 0; margin-top: 0; }
  .connection-actions .connection-action-full { grid-column: 1 / -1; }
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
  .profile-picker.open .profile-dropdown-chevron, .auth-picker.open .profile-dropdown-chevron, .connection-type-picker.open .profile-dropdown-chevron, .server-auto-refresh-picker.open .profile-dropdown-chevron { transform: rotate(180deg); }
  .profile-dropdown-menu { position: absolute; z-index: 130; top: calc(100% + 4px); left: 0; right: 0; display: none; width: 100%; max-width: 100%; box-sizing: border-box; max-height: 300px; overflow-y: auto; overflow-x: hidden; padding: 5px; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); }
  .connection-profile-dropdown-menu { max-height: 340px; overflow: hidden; }
  .profile-dropdown-filter { padding: 2px 2px 5px; position: sticky; top: -5px; z-index: 1; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); }
  .connection-profile-dropdown-menu .profile-dropdown-filter { position: static; flex: 0 0 auto; }
  .profile-dropdown-filter input { width: 100%; height: 28px; box-sizing: border-box; padding: 4px 7px; }
  .profile-dropdown-pinned { flex: 0 0 auto; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); }
  .profile-dropdown-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
  .profile-dropdown-empty { color: var(--vscode-descriptionForeground); padding: 10px 7px; font-size: 12px; }
  .profile-picker.open .profile-dropdown-menu, .auth-picker.open .profile-dropdown-menu, .connection-type-picker.open .profile-dropdown-menu, .server-auto-refresh-picker.open .profile-dropdown-menu { display: block; }
  .profile-picker.open .connection-profile-dropdown-menu { display: flex; flex-direction: column; }
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
  .connection-profile-dropdown-menu .profile-dropdown-item { grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; cursor: pointer; }
  .connection-profile-dropdown-menu .profile-dropdown-main { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .profile-dropdown-name-row { min-width: 0; display: flex; align-items: center; gap: 5px; }
  .profile-dropdown-name.connected { color: var(--vscode-testing-iconPassed, #73c991); }
  .profile-dropdown-action { justify-self: end; align-self: center; width: 22px; min-width: 22px; height: 22px; min-height: 22px; padding: 0; display: inline-flex; align-items: center; justify-content: center; line-height: 0; opacity: 0; pointer-events: none; border: 0 !important; border-radius: 3px; background: transparent !important; color: var(--vscode-icon-foreground, var(--vscode-foreground)); box-shadow: none !important; outline: none; }
  .profile-dropdown-action:hover:not(:disabled), .profile-dropdown-action:focus-visible { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)) !important; color: var(--vscode-icon-foreground, var(--vscode-foreground)); }
  .profile-dropdown-item.selected .profile-dropdown-action,
  .profile-dropdown-item.selected .profile-dropdown-action:hover:not(:disabled),
  .profile-dropdown-item.selected .profile-dropdown-action:focus-visible { color: var(--vscode-list-activeSelectionForeground); }
  .profile-dropdown-item:hover .profile-dropdown-action, .profile-dropdown-action:focus-visible, .profile-dropdown-action.busy { opacity: 1; pointer-events: auto; }
  .profile-dropdown-action-icon { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: currentColor; }
  .profile-dropdown-action-icon svg { width: 16px; height: 16px; display: block; fill: currentColor; color: currentColor; }
  .profile-dropdown-action-spinner { display: none; width: 14px; height: 14px; border: 1.6px solid currentColor; border-right-color: transparent; border-radius: 50%; color: currentColor; opacity: 0.82; animation: profile-action-spin 0.75s linear infinite; }
  .profile-dropdown-action.busy .profile-dropdown-action-spinner { display: inline-flex; }
  .profile-dropdown-action.busy .profile-dropdown-action-icon { display: none; }
  @keyframes profile-action-spin { 100% { transform: rotate(360deg); } }
  .profile-dropdown-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .profile-dropdown-meta { color: var(--vscode-descriptionForeground); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .profile-dropdown-item.selected .profile-dropdown-meta { color: inherit; opacity: 0.78; }
  .profile-dropdown-separator { height: 1px; margin: 5px 3px; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); }
  .owner-group-combo { position: relative; }
  .owner-group-combo input { width: 100%; }
  .owner-group-suggestions { position: fixed; z-index: 10040; left: 0; top: 0; width: 240px; display: none; max-height: min(220px, calc(100vh - 24px)); overflow-y: auto; overflow-x: hidden; padding: 5px; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); }
  .owner-group-suggestions.visible { display: block; }
  .owner-group-suggestion-item { width: 100%; min-height: 30px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 5px 7px; border: 0; border-radius: 3px; background: transparent; color: inherit; text-align: left; }
  .owner-group-suggestion-item:hover:not(:disabled), .owner-group-suggestion-item:focus-visible { background: var(--vscode-list-hoverBackground); outline: none; }
  .owner-group-suggestion-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .owner-group-suggestion-detail { color: var(--vscode-descriptionForeground); font-size: 11px; white-space: nowrap; }
  .owner-group-suggestion-empty { padding: 8px 7px; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.35; }
  .owner-group-suggestion-empty.error { color: var(--vscode-errorForeground, var(--vscode-inputValidation-errorForeground)); }
  .manage-profiles-button { width: 32px; min-width: 32px; height: 32px; min-height: 32px; padding: 4px; display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
  .manage-profiles-button svg { width: 24px; height: 24px; display: block; fill: currentColor; flex: 0 0 auto; }
  .connection-details-title { margin: 0 0 8px; color: var(--vscode-foreground); font-size: 12px; font-weight: 650; }
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
  .sudo-toggle { display: inline-flex; align-items: center; justify-content: center; justify-self: start; width: 32px; min-width: 32px; height: 32px; min-height: 32px; box-sizing: border-box; margin: 0; padding: 4px; border: 1px solid var(--vscode-button-border, var(--vscode-input-border, var(--vscode-panel-border))); border-radius: 3px; background: var(--vscode-button-secondaryBackground, var(--vscode-input-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); cursor: pointer; user-select: none; white-space: nowrap; transition: background 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease; }
  .sudo-toggle:hover:not(.disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  .sudo-toggle input { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; }
  .sudo-toggle.disabled { cursor: default; opacity: 0.55; }
  .sudo-toggle.enabled { border-color: color-mix(in srgb, var(--remoteedit-validation-error) 58%, var(--vscode-button-border, var(--vscode-input-border, var(--vscode-panel-border)))); }
  .sudo-toggle-icon { width: 24px; height: 26px; display: block; flex: 0 0 auto; color: inherit; fill: currentColor; }
  .sudo-toggle-icon text { fill: currentColor; font-family: var(--vscode-font-family); font-size: 13.5px; font-weight: 400; letter-spacing: 0.035em; dominant-baseline: middle; }
  .sudo-toggle.enabled .sudo-toggle-icon { color: var(--remoteedit-validation-error); }
  .sudo-toggle-state { min-width: 0; text-align: center; color: inherit; font-weight: 650; }
  .pathbar { position: relative; display: grid; grid-template-columns: minmax(0, var(--remote-path-width, 1fr)) minmax(0, var(--remote-path-filter-width, 150px)) auto auto auto auto auto 32px auto auto; gap: 6px; align-items: center; margin-bottom: 8px; flex: 0 0 auto; }
  .pathbar.hide-command-actions { grid-template-columns: minmax(0, var(--remote-path-width, 1fr)) minmax(0, var(--remote-path-filter-width, 150px)) auto auto auto 32px auto auto; }
  .pathbar.hide-sudo-actions { grid-template-columns: minmax(0, var(--remote-path-width, 1fr)) minmax(0, var(--remote-path-filter-width, 150px)) auto auto auto auto auto auto; }
  .pathbar.hide-view-switch-actions { grid-template-columns: minmax(0, var(--remote-path-width, 1fr)) minmax(0, var(--remote-path-filter-width, 150px)) auto auto auto auto auto 32px; }
  .pathbar.hide-command-actions.hide-sudo-actions { grid-template-columns: minmax(0, var(--remote-path-width, 1fr)) minmax(0, var(--remote-path-filter-width, 150px)) auto auto auto auto; }
  .pathbar.hide-command-actions.hide-view-switch-actions { grid-template-columns: minmax(0, var(--remote-path-width, 1fr)) minmax(0, var(--remote-path-filter-width, 150px)) auto auto auto 32px; }
  .pathbar.hide-sudo-actions.hide-view-switch-actions,
  .pathbar.hide-command-actions.hide-sudo-actions.hide-view-switch-actions { grid-template-columns: minmax(0, var(--remote-path-width, 1fr)) minmax(0, var(--remote-path-filter-width, 150px)) auto auto auto auto; }
  .pathbar.server-toolbar-mode,
  .pathbar.server-toolbar-mode.hide-command-actions {
    grid-template-columns: auto auto auto auto auto auto 32px auto auto;
    justify-content: end;
  }
  .pathbar.server-toolbar-mode.hide-view-switch-actions,
  .pathbar.server-toolbar-mode.hide-command-actions.hide-view-switch-actions {
    grid-template-columns: auto auto auto auto auto auto 32px;
    justify-content: end;
  }
  .pathbar.server-toolbar-mode.hide-sudo-actions,
  .pathbar.server-toolbar-mode.hide-command-actions.hide-sudo-actions {
    grid-template-columns: auto auto auto auto auto auto auto;
    justify-content: end;
  }
  .pathbar.server-toolbar-mode.hide-sudo-actions.hide-view-switch-actions,
  .pathbar.server-toolbar-mode.hide-command-actions.hide-sudo-actions.hide-view-switch-actions {
    grid-template-columns: auto auto auto auto auto;
    justify-content: end;
  }
  .pathbar.server-toolbar-mode #remotePathBox,
  .pathbar.server-toolbar-mode #remotePathResizeHandle,
  .pathbar.server-toolbar-mode #filterBox,
  .pathbar.server-toolbar-mode #commandActionsSeparator,
  .pathbar.server-toolbar-mode #downloadAction,
  .pathbar.server-toolbar-mode #uploadAction {
    display: none !important;
  }
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
  .remote-path-dropdown-meta { color: var(--vscode-descriptionForeground); opacity: 0.72; font-size: 11px; white-space: nowrap; display: grid; grid-template-columns: minmax(0, 14ch) 10ch; column-gap: 12px; align-items: center; }
  .remote-path-dropdown-meta-owner, .remote-path-dropdown-meta-permissions { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  .table-wrap { border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); flex: 1 1 0; min-height: 0; max-height: none; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; border-radius: 6px; user-select: none; -webkit-user-select: none; transition: border-color 120ms ease, box-shadow 120ms ease; }
  .table-wrap.privileged-session { border-color: color-mix(in srgb, #7a2f2f 62%, var(--vscode-panel-border)); box-shadow: 0 0 0 1px color-mix(in srgb, #7a2f2f 18%, transparent); }
  table { width: 100%; min-width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed; }
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
  .table-wrap.name-click-open-enabled .entry-text { cursor: pointer; }
  .table-wrap.name-click-open-enabled .entry-text:hover { text-decoration: underline; text-decoration-color: currentColor; text-underline-offset: 2px; }
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
  #inputPromptBackdrop { z-index: 320; }
  .file-properties-dialog { width: min(640px, 100%); max-height: min(760px, calc(100vh - 48px)); overflow: hidden; display: flex; flex-direction: column; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .file-properties-header { padding: 16px 18px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .file-properties-title { margin: 0 0 5px; font-size: 18px; font-weight: 650; }
  .file-properties-path, .confirm-dialog-subtitle, .transfer-conflict-subtitle, .permission-dialog-path, .remote-command-subtitle, .transfer-queue-subtitle { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; line-height: 1.3; margin-top: 3px; opacity: 0.85; overflow-wrap: anywhere; }
  .modal-action-left { margin-right: auto; }
  .file-properties-actions button[hidden], .confirm-dialog-actions button[hidden], .permission-dialog-actions button[hidden], .remote-command-actions button[hidden], .transfer-conflict-actions button[hidden] { display: none !important; }
  .file-properties-body { padding: 16px 18px; overflow: auto; }
  .file-properties-grid { display: grid; grid-template-columns: 150px minmax(0, 1fr); border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; background: var(--vscode-editor-background); }
  .manage-profiles-dialog { width: min(640px, calc(100vw - 48px)); height: min(560px, calc(100vh - 48px)); max-height: calc(100vh - 48px); }
  .manage-profiles-dialog .file-properties-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .manage-profiles-filter { flex: 0 0 auto; margin-bottom: 10px; }
  .manage-profiles-filter input { width: 100%; box-sizing: border-box; }
  .manage-profiles-list { position: relative; flex: 1 1 auto; min-height: 0; display: grid; align-content: start; gap: 6px; overflow: auto; padding: 3px 0; }
  .manage-profiles-drop-line { position: absolute; left: 0; right: 0; height: 1px; background: var(--vscode-focusBorder); pointer-events: none; z-index: 8; display: none; }
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
  .input-prompt-dialog { width: min(460px, calc(100vw - 48px)); }
  .input-prompt-dialog .file-properties-body { display: grid; gap: 8px; }
  .input-prompt-feedback { min-height: 16px; color: var(--remoteedit-validation-error); font-size: 12px; line-height: 1.35; }
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
  .backup-summary-line { min-width: 0; color: var(--vscode-foreground); font-size: 11px; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; white-space: normal; overflow-wrap: anywhere; }
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
  @media (max-width: 560px) { .manage-profiles-header-row { flex-direction: column; } .backup-credential-fields { grid-template-columns: 1fr; } }
  .manage-profile-row { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 9px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
  .manage-profile-row.can-reorder { cursor: grab; }
  .manage-profile-row.dragging { opacity: 0.55; cursor: grabbing; }
  .manage-profile-row.drag-over-before,
  .manage-profile-row.drag-over-after { border-color: var(--vscode-panel-border); box-shadow: none; }
  .manage-profile-drag-handle { width: 18px; min-width: 18px; height: 24px; display: inline-flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); opacity: 0.62; cursor: grab; line-height: 0; }
  .manage-profile-row.can-reorder:hover .manage-profile-drag-handle { opacity: 0.95; }
  .manage-profile-row.dragging .manage-profile-drag-handle { cursor: grabbing; }
  .manage-profile-drag-handle.disabled { opacity: 0.25; cursor: default; }
  .manage-profile-drag-handle svg { width: 16px; height: 16px; display: block; fill: currentColor; }
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
  .remote-command-dialog { width: min(1180px, calc(100vw - 48px)); height: min(720px, calc(100vh - 48px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .remote-command-header { padding: 16px 18px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .remote-command-title { margin: 0 0 5px; font-size: 18px; font-weight: 650; }
  .remote-command-body { flex: 1 1 auto; min-height: 0; padding: 12px 18px 16px; display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; overflow: hidden; }
  .remote-command-main { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; overflow: hidden; }
  .remote-command-field-grid { display: grid; gap: 12px; }
  .remote-command-meta-block { display: grid; gap: 1px; }
  .remote-command-meta { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px; align-items: baseline; font-size: 11px; line-height: 1.22; min-width: 0; }
  .remote-command-meta-label { color: var(--vscode-descriptionForeground); font-weight: 500; white-space: nowrap; }
  .remote-command-connected-to { min-width: 0; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-command-run-as { min-width: 0; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-command-run-as.sudo { color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground)); }
  .remote-command-field { display: grid; gap: 5px; min-width: 0; }
  .remote-command-field label, .remote-command-section-title { margin: 0; font-size: 12px; font-weight: 650; color: var(--vscode-descriptionForeground); }
  .remote-command-input-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; align-items: start; }
  .remote-command-input-row textarea { width: 100%; min-height: 82px; max-height: 150px; box-sizing: border-box; resize: vertical; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: 5px 8px; outline: none; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-font-size); line-height: 1.4; }
  .remote-command-input-row textarea:focus, .remote-command-working-directory-row input:focus { border-color: var(--vscode-focusBorder); }
  .remote-command-input-row textarea:disabled, .remote-command-working-directory-row input:disabled { opacity: 0.68; }
  .remote-command-working-directory-wrap { position: relative; z-index: 6; display: grid; gap: 5px; }
  .remote-command-working-directory-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
  .remote-command-working-directory-row.input-with-button { display: flex; gap: 0; align-items: center; }
  .remote-command-working-directory-row.input-with-button input { padding-right: 34px; }
  .remote-command-working-directory-row input { width: 100%; box-sizing: border-box; height: 28px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: 4px 8px; outline: none; font-family: var(--vscode-editor-font-family); }
  .remote-command-sudo-row { display: flex; align-items: center; gap: 8px; min-height: 24px; color: var(--vscode-foreground); font-size: 12px; user-select: none; }
  .remote-command-command-field + .remote-command-sudo-row { margin-top: -9px; }
  .remote-command-sudo-row.hidden { display: none; }
  .remote-command-sudo-note { color: var(--vscode-descriptionForeground); font-size: 11px; opacity: 0.8; }
  .remote-command-sudo-row + .remote-command-run-row { margin-top: -5px; }
  .remote-command-run-row { display: flex; justify-content: flex-end; margin-bottom: -3px; }
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
  .remote-command-side { min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; overflow: hidden; }
  .remote-command-side-section { min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); overflow: hidden; }
  .remote-command-side-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 6px; border-bottom: 1px solid var(--vscode-panel-border); }
  .remote-command-side-title { margin: 0; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.03em; }
  .remote-command-side-list { min-height: 0; overflow: auto; padding: 3px; display: grid; align-content: start; gap: 2px; }
  .remote-command-empty { color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.25; padding: 4px 2px; opacity: 0.82; }
  .remote-command-card { display: grid; gap: 0; padding: 2px 4px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-editor-background); cursor: pointer; }
  .remote-command-card:hover { background: var(--vscode-list-hoverBackground); }
  .remote-command-card-main { min-width: 0; display: grid; gap: 1px; }
  .remote-command-card-header { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 2px; align-items: center; }
  .remote-command-card-header-compact { grid-template-columns: minmax(0, 1fr) auto; }
  .remote-command-card-name { min-width: 0; font-size: 10.5px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-command-card-details, .remote-command-card-meta { color: var(--vscode-descriptionForeground); font-size: 9.5px; line-height: 1.1; opacity: 0.85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-command-card-command { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 9.5px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .remote-command-icon-button { width: 16px; min-width: 16px; height: 16px; min-height: 16px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; line-height: 1; }
  .remote-command-compact-button, .remote-command-edit-actions button { min-height: 21px; height: 21px; padding: 0 7px; font-size: 10.5px; line-height: 1; }
  .remote-command-delete-confirm { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 3px; padding-top: 3px; border-top: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 10.5px; line-height: 1.2; cursor: default; }
  .remote-command-delete-confirm-actions { display: inline-flex; gap: 4px; flex: 0 0 auto; }
  .remote-command-delete-confirm-actions button { min-width: auto; height: 19px; min-height: 19px; padding: 0 6px; font-size: 10.5px; }
  .remote-command-edit-form { display: grid; gap: 3px; padding: 4px; border: 1px solid var(--vscode-focusBorder, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-editor-background); }
  .remote-command-edit-form label { display: grid; gap: 2px; color: var(--vscode-descriptionForeground); font-size: 10.5px; font-weight: 650; }
  .remote-command-edit-form input, .remote-command-edit-form textarea { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: 2px 5px; outline: none; font-family: var(--vscode-editor-font-family); font-size: 11px; }
  .remote-command-edit-form input { height: 24px; }
  .remote-command-edit-form textarea { min-height: 42px; resize: vertical; }
  .remote-command-edit-actions { display: flex; justify-content: flex-end; gap: 4px; }
  .remote-command-close-warning, .remote-command-stop-warning { display: none; align-items: center; justify-content: space-between; gap: 12px; margin: 0 18px 12px; padding: 10px 12px; border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border)); border-radius: 6px; background: var(--vscode-inputValidation-warningBackground, var(--vscode-editor-background)); color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground)); }
  .remote-command-close-warning.visible, .remote-command-stop-warning.visible { display: flex; }
  .remote-command-close-warning-text { min-width: 0; font-size: 12px; line-height: 1.35; }
  .remote-command-close-warning-actions, .remote-command-stop-warning-actions { display: inline-flex; gap: 8px; flex: 0 0 auto; }
  .remote-command-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 16px; }
  @media (max-width: 920px) { .remote-command-body { grid-template-columns: 1fr; overflow: auto; } .remote-command-side { grid-template-rows: auto auto; overflow: visible; } .remote-command-side-section { max-height: 240px; } }

  .remote-search-backdrop { z-index: 235; }
  .remote-search-dialog { width: min(940px, calc(100vw - 48px)); height: min(720px, calc(100vh - 48px)); max-height: calc(100vh - 48px); min-width: 0; }
  .remote-search-dialog .file-properties-body { flex: 1 1 auto; min-height: 0; min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); align-content: stretch; gap: 10px; overflow: hidden; }
  .remote-search-dialog .file-properties-path { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; line-height: 1.3; margin-top: 3px; opacity: 0.85; }
  .remote-search-section { display: grid; gap: 10px; min-width: 0; }
  .remote-search-scope-wrap { position: relative; z-index: 5; }
  .remote-search-scope-row.input-with-button { display: flex; gap: 0; align-items: center; }
  .remote-search-scope-row.input-with-button input { padding-right: 34px; }
  .remote-search-field { min-width: 0; }
  .remote-search-field label { display: block; margin-bottom: 5px; font-size: 11px; font-weight: 650; color: var(--vscode-descriptionForeground); }
  .remote-search-field input[type='text'] { width: 100%; box-sizing: border-box; }
  .remote-search-field input[type='text'].remote-search-input-invalid { border-color: var(--remoteedit-validation-error); }
  .remote-search-field input[type='text'].remote-search-input-invalid:focus, .remote-search-field input[type='text'].remote-search-input-invalid:focus-visible { border-color: var(--remoteedit-validation-error); outline: none; box-shadow: none; }
  .remote-search-scope-row input:focus { border-color: var(--vscode-focusBorder); }
  .remote-search-validation-line { height: 16px; line-height: 16px; color: var(--remoteedit-validation-error); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; visibility: hidden; }
  .remote-search-options-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 14px; }
  .remote-search-options-grid .modal-checkbox-line { min-width: 0; }
  .remote-search-options-grid .modal-checkbox-line span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .remote-search-ssh-only.hidden, .remote-search-text-field.hidden { display: none; }
  .remote-search-scope-picker.hidden { display: none; }
  .remote-search-scope-picker { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 20; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-input-background, var(--vscode-sideBar-background)); overflow: hidden; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28); font-size: 11px; }
  .remote-search-scope-picker-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background, var(--vscode-input-background)); }
  .remote-search-scope-picker-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 11px; }
  .remote-search-scope-picker-actions { display: flex; gap: 6px; flex: 0 0 auto; }
  .remote-search-scope-picker-actions button { min-height: 24px; padding: 3px 8px; font-size: 11px; }
  .remote-search-scope-picker-list { max-height: 180px; overflow: auto; padding: 3px 0; }
  .remote-search-scope-picker-empty { padding: 8px 10px; color: var(--vscode-descriptionForeground); font-size: 11px; }
  .remote-search-scope-picker-empty.error { color: var(--remoteedit-validation-error); }
  .remote-search-scope-picker-item { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 24px; border: 0; background: transparent; color: var(--vscode-foreground); text-align: left; padding: 3px 9px; cursor: pointer; font: inherit; font-size: 11px; }
  .remote-search-scope-picker-item:hover { background: var(--vscode-list-hoverBackground); }
  .remote-search-scope-picker-item-path { margin-left: auto; min-width: 0; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); }
  .remote-search-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 16px; }
  .remote-search-actions button { width: 72px; min-width: 72px; padding-left: 8px; padding-right: 8px; }
  .remote-search-results-section { min-height: 0; min-width: 0; max-width: 100%; display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
  .remote-search-results-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; max-width: 100%; color: var(--vscode-descriptionForeground); font-size: 12px; font-weight: 650; }
  .remote-search-results-status { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-search-results-status.error { color: var(--remoteedit-validation-error); }
  .remote-search-results { flex: 1 1 auto; min-height: 0; min-width: 0; max-width: 100%; box-sizing: border-box; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); overflow: auto; padding: 6px 0; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); user-select: none; -webkit-user-select: none; }
  .remote-search-show-more { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; max-width: 100%; box-sizing: border-box; padding: 8px 12px 4px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-font-family); font-size: 12px; border-top: 1px solid var(--vscode-panel-border); }
  .remote-search-show-more span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-search-show-more button { min-width: 88px; min-height: 26px; padding: 3px 10px; }
  .remote-search-empty { padding: 14px 12px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-font-family); font-size: 12px; }
  .remote-search-result-row { min-width: 0; max-width: 100%; box-sizing: border-box; cursor: pointer; user-select: none; -webkit-user-select: none; }
  .remote-search-result-row:hover { background: var(--vscode-list-hoverBackground); }
  .remote-search-result-row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .remote-search-result-row.selected:hover { background: var(--vscode-list-activeSelectionBackground); }
  .remote-search-file-result { padding: 4px 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .remote-search-result-group { min-width: 0; max-width: 100%; overflow: hidden; box-sizing: border-box; padding: 5px 0 7px; border-bottom: 1px solid var(--vscode-panel-border); }
  .remote-search-result-group:last-child { border-bottom: none; }
  .remote-search-result-path { padding: 2px 12px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .remote-search-match-count { color: var(--vscode-descriptionForeground); font-weight: 400; }
  .remote-search-match { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 8px; min-width: 0; max-width: 100%; box-sizing: border-box; padding: 1px 12px; font-size: 11px; line-height: 1.45; color: var(--vscode-descriptionForeground); }
  .remote-search-result-row.selected .remote-search-match-count,
  .remote-search-result-row.selected .remote-search-line-number,
  .remote-search-result-row.selected .remote-search-line-text { color: inherit; opacity: 0.78; }
  .remote-search-line-number { color: var(--vscode-descriptionForeground); text-align: right; }
  .remote-search-line-text { min-width: 0; color: var(--vscode-descriptionForeground); white-space: pre-wrap; overflow-wrap: anywhere; }
  .remote-search-hit { background: var(--vscode-editor-findMatchHighlightBackground, rgba(255, 214, 10, 0.22)); color: var(--vscode-descriptionForeground); border-radius: 3px; padding: 0 2px; }
  .remote-search-ellipsis { color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); }
  .remote-search-badge { position: absolute; right: -4px; top: -4px; min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 9px; line-height: 14px; text-align: center; display: none; }
  .remote-search-context-menu { z-index: 270; }
  .text-edit-context-menu { z-index: 290; width: 158px; }
  .remote-search-button-wrap { position: relative; display: inline-flex; }
  @media (max-width: 760px) { .remote-search-options-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

  .transfer-queue-backdrop { position: fixed; inset: 0; z-index: 220; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.45); }
  .transfer-queue-backdrop.visible { display: flex; }
  .transfer-queue-dialog { width: min(940px, calc(100vw - 48px)); height: min(720px, calc(100vh - 48px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .transfer-queue-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .transfer-queue-header-text { min-width: 0; }
  .transfer-queue-title { margin: 0 0 5px; font-size: 18px; font-weight: 650; }
  .transfer-queue-body { flex: 1 1 auto; min-height: 0; overflow: hidden; padding: 12px 14px 14px; display: grid; grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 10px; align-content: stretch; }
  .transfer-queue-section { min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; background: var(--vscode-editor-background); }
  .transfer-queue-section-title { flex: 0 0 auto; margin: 0; padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); font-size: 11px; font-weight: 600; }
  .transfer-queue-items { flex: 1 1 auto; min-height: 0; display: grid; align-content: start; gap: 0; overflow-x: hidden; overflow-y: auto; scrollbar-gutter: stable; }
  .transfer-queue-section-scroll .transfer-queue-items { overflow-y: auto; }
  .transfer-queue-empty { padding: 8px 8px; color: var(--vscode-descriptionForeground); text-align: center; font-size: 11px; }
  .transfer-queue-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 11.5px; }
  .transfer-queue-item:last-child { border-bottom: 0; }
  .transfer-queue-item-main { display: grid; gap: 1px; min-width: 0; }
  .transfer-queue-item-title { display: flex; align-items: center; gap: 4px; min-width: 0; font-weight: 600; font-size: 11.5px; }
  .transfer-queue-icon { width: 13px; min-width: 13px; text-align: center; color: var(--vscode-icon-foreground, var(--vscode-foreground)); }
  .transfer-queue-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .transfer-queue-detail, .transfer-queue-status, .transfer-queue-progress { color: var(--vscode-descriptionForeground); font-size: 10.5px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .transfer-queue-failed-items { margin-top: 3px; padding: 4px 6px; display: grid; gap: 1px; min-width: 0; border: 1px solid var(--vscode-panel-border); border-left: 2px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.2; }
  .transfer-queue-failed-title { color: var(--vscode-descriptionForeground); font-weight: 500; opacity: 0.92; }
  .transfer-queue-failed-item { display: grid; gap: 1px; min-width: 0; padding: 1px 0; }
  .transfer-queue-failed-path { color: var(--vscode-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .transfer-queue-failed-error { color: var(--vscode-descriptionForeground); opacity: 0.82; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 8px; }
  .transfer-queue-failed-more { color: var(--vscode-descriptionForeground); opacity: 0.78; }
  .transfer-queue-canceled-items { margin-top: 3px; padding: 4px 6px; display: grid; gap: 1px; min-width: 0; border: 1px solid var(--vscode-panel-border); border-left: 2px solid var(--vscode-panel-border); border-radius: 5px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.2; }
  .transfer-queue-canceled-title { color: var(--vscode-descriptionForeground); font-weight: 500; opacity: 0.92; }
  .transfer-queue-canceled-item { display: grid; gap: 1px; min-width: 0; padding: 1px 0; }
  .transfer-queue-canceled-path { color: var(--vscode-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .transfer-queue-canceled-error { color: var(--vscode-descriptionForeground); opacity: 0.82; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 8px; }
  .transfer-queue-canceled-more { color: var(--vscode-descriptionForeground); opacity: 0.78; }
  .transfer-queue-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; }
  .transfer-queue-actions button { min-height: 21px; padding: 1px 6px; font-size: 10.5px; }
  .transfer-queue-footer { display: flex; justify-content: flex-end; padding: 0 16px 16px; }

  .confirm-dialog-backdrop { position: fixed; inset: 0; z-index: 240; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.45); }
  .confirm-dialog-backdrop.visible { display: flex; }
  .confirm-dialog { width: min(520px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .confirm-dialog-header { padding: 16px 18px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .confirm-dialog-title { margin: 0 0 5px; font-size: 18px; font-weight: 650; }
  .confirm-dialog-body { padding: 15px 18px; display: grid; gap: 12px; overflow: auto; }
  .confirm-dialog-message { margin: 0; line-height: 1.45; }
  .confirm-dialog-details { margin: 0; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
  .confirm-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 16px; }
  .transfer-conflict-backdrop { position: fixed; inset: 0; z-index: 250; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.45); }
  .transfer-conflict-backdrop.visible { display: flex; }
  .transfer-conflict-dialog { width: min(620px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 18px 54px rgba(0, 0, 0, 0.45); }
  .transfer-conflict-header { padding: 16px 18px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .transfer-conflict-title { margin: 0 0 5px; font-size: 18px; font-weight: 650; }
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
  .statusbar { margin-top: 6px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; flex: 0 0 auto; height: 22px; min-height: 22px; padding: 0 8px; background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 20px; overflow: hidden; }
  .statusbar.error { color: var(--remoteedit-validation-error); border-color: var(--remoteedit-validation-error); }
  .statusbar.busy { color: var(--vscode-progressBar-background, var(--vscode-foreground)); }
  .status-main { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; }
  .status-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status-output-link { flex: 0 0 auto; min-height: auto; height: auto; padding: 0; border: 0; background: transparent; color: inherit; text-decoration: underline; text-underline-offset: 2px; line-height: 1.2; cursor: pointer; white-space: nowrap; }
  .statusbar .status-output-link:hover, .statusbar .status-output-link:active, .statusbar .status-output-link:focus { background: transparent; color: inherit; }
  .statusbar .status-output-link:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; background: transparent; }
  .status-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; min-width: 0; height: 18px; }
  .status-action-button { align-self: center; min-height: 18px; height: 18px; padding: 0 6px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; border-radius: 3px; border: 1px solid var(--vscode-panel-border); background: transparent; color: inherit; opacity: 0.9; line-height: 16px; white-space: nowrap; font-size: 11px; }
  .status-action-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); border-color: var(--vscode-focusBorder, var(--vscode-button-border, var(--vscode-panel-border))); }
  .status-action-button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .statusbar.error .status-copy-button:hover:not(:disabled) { border-color: var(--remoteedit-validation-error); }
  .statusbar.error .status-copy-button:focus-visible { outline-color: var(--remoteedit-validation-error); }
  .status-cancel-button[hidden] { display: none; }
  .status-copy-wrap { position: relative; display: inline-flex; align-items: center; justify-content: center; align-self: center; height: 18px; min-height: 18px; }
  .status-copy-button { width: 20px; min-width: 20px; padding: 0; }
  .status-copy-button svg { width: 13px; height: 13px; display: block; fill: currentColor; }
  .status-copy-feedback { position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 60; padding: 4px 8px; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-editorWidget-background, var(--vscode-notifications-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-notifications-foreground)); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28); font-size: 12px; line-height: 1.2; white-space: nowrap; opacity: 0; transform: translateY(4px); pointer-events: none; transition: opacity 120ms ease, transform 120ms ease; }
  .status-copy-feedback.visible { opacity: 1; transform: translateY(0); }
  .spinner { width: 12px; min-width: 12px; height: 12px; border: 2px solid var(--vscode-panel-border); border-top-color: var(--vscode-progressBar-background, var(--vscode-foreground)); border-radius: 50%; animation: spin 0.9s linear infinite; display: none; flex: 0 0 auto; }
  .statusbar.busy .spinner { display: block; }
  .muted { color: var(--vscode-descriptionForeground); }
  .small { font-size: 12px; }
  code { font-family: var(--vscode-editor-font-family); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 980px) { html, body { overflow: auto; } .page { height: auto; min-height: 100vh; } .layout, .layout.connection-collapsed { grid-template-columns: 1fr; flex: 0 0 auto; } .connection-resize-handle { display: none; } .connection-rail { left: 0; } .browser-column { min-height: 0; } .browser-card { min-height: 520px; } .pathbar, .profile-row, .connection-name-row { grid-template-columns: 1fr; } .remote-path-resize-handle { display: none; } .path-actions { justify-content: flex-start; } .filter-box { width: 100%; } .filter-sudo-separator { display: none; } .sudo-toggle { justify-self: flex-start; } .pathbar-view-switch { justify-self: flex-start; } .view-switch-separator { display: none; } .browser-header { align-items: flex-start; flex-direction: column; } }
  @media (max-height: 720px) and (min-width: 981px) { .hint-list { display: none; } .card-header, .card-body, .browser-title-section { padding: 9px 10px; } .card-header.connection-card-header { padding: 6px 30px 6px 10px; } .browser-open-section { padding: 5px 9px; } }
  @media (max-width: 760px) { .open-connections-row { align-items: flex-start; flex-direction: column; gap: 6px; } .browser-session-strip { width: 100%; } }

  /* Remove native browser/VS Code focus rings from webview controls. Remote Edit uses hover/active styles instead. */
  *:focus,
  *:focus-visible {
    outline: none !important;
  }
  button:focus,
  button:focus-visible,
  [role='button']:focus,
  [role='button']:focus-visible,
  a:focus,
  a:focus-visible,
  .session-tab:focus,
  .session-tab:focus-visible,
  .session-close:focus,
  .session-close:focus-visible,
  .remote-path-resize-handle:focus,
  .remote-path-resize-handle:focus-visible,
  .dialog-checkbox:focus,
  .dialog-checkbox:focus-visible,
  .checkbox-row input[type='checkbox']:focus,
  .checkbox-row input[type='checkbox']:focus-visible,
  .modal-checkbox-line input[type='checkbox']:focus,
  .modal-checkbox-line input[type='checkbox']:focus-visible,
  .backup-import-mode input[type='radio']:focus,
  .backup-import-mode input[type='radio']:focus-visible,
  .status-output-link:focus,
  .status-output-link:focus-visible,
  .status-action-button:focus,
  .status-action-button:focus-visible {
    outline: none !important;
    box-shadow: none !important;
  }
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
        <div id="connectionResizeHandle" class="connection-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize Connection Panel" aria-valuemin="240" aria-valuemax="390" aria-valuenow="320" data-tooltip="Resize Connection Panel"></div>
        <div class="card-body connection-card-body">
          <div class="connection-profile-section">
            <div class="profile-row">
            <div class="profile-picker-field">
              <label for="profileDropdownButton">Connection profile</label>
              <div class="profile-picker">
                <button id="profileDropdownButton" type="button" class="profile-dropdown-button" aria-haspopup="listbox" aria-expanded="false">
                  <span id="profileDropdownLabel" class="profile-dropdown-label">New / Quick Connection</span>
                  <svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg>
                </button>
                <div id="profileDropdownMenu" class="profile-dropdown-menu connection-profile-dropdown-menu" role="listbox" aria-label="Connection Profiles"></div>
              </div>
              <select id="profileSelect" class="profile-select-native" aria-hidden="true" tabindex="-1"><option value="">New / Quick Connection</option></select>
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
              <button id="connectButton" class="connection-action-full">Connect</button>
              <button id="saveProfileButton" class="secondary connection-action-full">Save</button>
              <button id="showSettingsButton" class="secondary">Settings</button>
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
                <div id="sessionTabs" class="session-tabs"></div>
              </div>
            </div>
          </div>
          <div class="browser-section-divider"></div>
          <div id="browserSubtitle" hidden>Connect to a host to list remote files.</div>

          <div class="card-body">
          <div class="pathbar">
            <div id="remotePathBox" class="remote-path-box">
              <input id="currentPath" value="" disabled aria-label="Remote Path" data-tooltip="Remote Path" />
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
            <div id="serverToolbarStatus" class="server-toolbar-status" role="status" aria-live="polite"></div>
            <div id="filterBox" class="filter-box">
              <input id="filterInput" class="filter-input" placeholder="Filter Files..." aria-label="Filter Files" disabled />
              <button id="clearFilterButton" class="filter-clear-button has-tooltip" aria-label="Clear Filter" data-tooltip="Clear Filter" disabled><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button>
            </div>
            <div id="serverRefreshActions" class="path-actions server-refresh-actions" aria-label="Server Refresh Controls">
              <span class="tooltip-anchor" data-tooltip="Refresh Server Dashboard">
                <button id="serverRefreshButton" class="secondary icon-only" type="button" aria-label="Refresh Server Dashboard" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M483.08-200q-117.25 0-198.63-81.34-81.37-81.34-81.37-198.54 0-117.2 81.37-198.66Q365.83-760 483.08-760q71.3 0 133.54 33.88 62.23 33.89 100.3 94.58V-760h40v209.23H547.69v-40h148q-31.23-59.85-87.88-94.54Q551.15-720 483.08-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h42.46Q725.08-310.15 651-255.08 576.92-200 483.08-200Z" /></svg></button>
              </span>
              <div id="serverAutoRefreshPicker" class="server-auto-refresh-picker">
                <button id="serverAutoRefreshDropdownButton" type="button" class="profile-dropdown-button server-auto-refresh-button has-tooltip" aria-haspopup="listbox" aria-expanded="false" aria-label="Server Auto Refresh" data-tooltip="Server Auto Refresh" disabled>
                  <span id="serverAutoRefreshDropdownLabel" class="profile-dropdown-label">Auto: Off</span>
                  <svg class="profile-dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" /></svg>
                </button>
                <div id="serverAutoRefreshDropdownMenu" class="profile-dropdown-menu server-auto-refresh-menu" role="listbox" aria-label="Server Auto Refresh">
                  <button type="button" class="profile-dropdown-item selected" role="option" aria-selected="true" data-server-auto-refresh="off"><span class="profile-dropdown-name">Auto: Off</span></button>
                  <button type="button" class="profile-dropdown-item" role="option" aria-selected="false" data-server-auto-refresh="15"><span class="profile-dropdown-name">Auto: 15s</span></button>
                  <button type="button" class="profile-dropdown-item" role="option" aria-selected="false" data-server-auto-refresh="30"><span class="profile-dropdown-name">Auto: 30s</span></button>
                  <button type="button" class="profile-dropdown-item" role="option" aria-selected="false" data-server-auto-refresh="60"><span class="profile-dropdown-name">Auto: 1m</span></button>
                  <button type="button" class="profile-dropdown-item" role="option" aria-selected="false" data-server-auto-refresh="300"><span class="profile-dropdown-name">Auto: 5m</span></button>
                </div>
              </div>
            </div>
            <span id="serverRefreshActionsSeparator" class="toolbar-separator filter-sudo-separator server-refresh-separator" aria-hidden="true"></span>
            <span id="commandActionsSeparator" class="toolbar-separator filter-sudo-separator" aria-hidden="true"></span>
            <div id="commandActions" class="path-actions command-actions">
              <span class="tooltip-anchor remote-search-button-wrap" data-tooltip="Remote Search">
                <button id="remoteSearchButton" class="secondary icon-only" type="button" aria-label="Remote Search" disabled><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 0 1 5.18 10.43l4.45 4.44-.71.71-4.44-4.45A6.5 6.5 0 1 1 10.5 4Zm0 1a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" /></svg><span id="remoteSearchBadge" class="remote-search-badge" aria-hidden="true"></span></button>
              </span>
              <span id="runRemoteCommandAction" class="tooltip-anchor remote-search-button-wrap" data-tooltip="Run Remote Command">
                <button id="runRemoteCommandButton" class="secondary icon-only" type="button" aria-label="Run Remote Command" disabled><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.5 13.8845 9.6923 9.6923 5.5 5.5l-.7078.7078 3.4848 3.4845-3.4848 3.4845L5.5 13.8845ZM12 18v-1h8v1h-8Z" /></svg><span id="remoteCommandBadge" class="remote-search-badge" aria-hidden="true"></span></button>
              </span>
              <span id="openSshTerminalAction" class="tooltip-anchor" data-tooltip="Open SSH Terminal">
                <button id="openSshTerminalButton" class="secondary icon-only" type="button" aria-label="Open SSH Terminal" disabled><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 5.5C4 4.6716 4.6716 4 5.5 4h13c.8284 0 1.5.6716 1.5 1.5v13c0 .8284-.6716 1.5-1.5 1.5h-13C4.6716 20 4 19.3284 4 18.5v-13ZM5.5 5C5.2239 5 5 5.2239 5 5.5v13c0 .2761.2239.5.5.5h13c.2761 0 .5-.2239.5-.5v-13c0-.2761-.2239-.5-.5-.5h-13Zm2.8536 4.1464L11.2071 12l-2.8535 2.8536-.7072-.7072L9.7929 12 7.6464 9.8536l.7072-.7072ZM12 15h5v1h-5v-1Z" /></svg></button>
              </span>
              <span id="openLogViewerAction" class="tooltip-anchor remote-search-button-wrap" data-tooltip="Log Viewer">
                <button id="openLogViewerButton" class="secondary icon-only" type="button" aria-label="Log Viewer" disabled><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4h14v16H5V4Zm1 1v14h12V5H6Zm2 3h8v1H8V8Zm0 3h8v1H8v-1Zm0 3h5v1H8v-1Z" /></svg><span id="logViewerBadge" class="remote-search-badge" aria-hidden="true"></span></button>
              </span>
            </div>
            <span id="transferActionsSeparator" class="toolbar-separator filter-sudo-separator" aria-hidden="true"></span>
            <div class="path-actions transfer-actions">
              <span id="downloadAction" class="tooltip-anchor" data-tooltip="Download Selected Files or Folders">
                <button id="downloadButton" class="secondary icon-only" aria-label="Download Selected Files or Folders" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M260-160q-41.92 0-70.96-29.04Q160-218.08 160-260v-80h40v80q0 25 17.5 42.5T260-200h440q25 0 42.5-17.5T760-260v-80h40v80q0 41.92-29.04 70.96Q741.92-160 700-160H260Zm220-146L314-472l28-28 118 118v-370h40v370l118-118 28 28-166 166Z" /></svg></button>
              </span>
              <span id="uploadAction" class="tooltip-anchor" data-tooltip="Upload Files or Folders">
                <button id="uploadButton" class="secondary icon-only" aria-label="Upload Files or Folders" disabled><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M260-160q-41.92 0-70.96-29.04Q160-218.08 160-260v-80h40v80q0 25 17.5 42.5T260-200h440q25 0 42.5-17.5T760-260v-80h40v80q0 41.92-29.04 70.96Q741.92-160 700-160H260Zm200-160v-370L342-572l-28-28 166-166 166 166-28 28-118-118v370h-40Z" /></svg></button>
              </span>
              <span id="transferQueueTooltip" class="tooltip-anchor" data-tooltip="Transfer Queue">
                <button id="transferQueueButton" class="secondary icon-only transfer-queue-button" type="button" aria-label="Transfer Queue"><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M340-596.38h40v359.3l83.54-83.54 28.77 28.31L360-160 227.69-292.31l28.77-28.31L340-237.08v-359.3ZM620-421h-40v-302.38l-84 84-28.31-28.31L600-800l132.31 132.31L704-639.38l-84-84V-421Z" /></svg><span id="transferQueueCount" class="transfer-queue-count" aria-hidden="true">0</span></button>
              </span>
            </div>
            <span id="sudoToggleSeparator" class="toolbar-separator filter-sudo-separator" aria-hidden="true"></span>
            <label id="sudoToggleLabel" class="sudo-toggle has-tooltip disabled" data-tooltip="Enable Sudo Mode">
              <input id="sudoToggle" type="checkbox" disabled aria-label="Enable Sudo Mode" />
              <svg id="sudoToggleState" class="sudo-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <text x="12" y="13.2" text-anchor="middle">SU</text>
              </svg>
            </label>
            <span class="toolbar-separator view-switch-separator" aria-hidden="true"></span>
            <div class="connection-view-switch pathbar-view-switch" role="tablist" aria-label="Connection View">
              <button class="connection-view-switch-button active" type="button" role="tab" aria-selected="true" aria-controls="filesView" data-connection-view="files">Files</button>
              <button class="connection-view-switch-button" type="button" role="tab" aria-selected="false" aria-controls="serverView" data-connection-view="server">Server</button>
            </div>
          </div>

          <div id="filesView" class="connection-view files-view">
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
          <div id="serverView" class="connection-view server-view hidden" aria-label="Server dashboard">
            <div id="serverViewContent" class="server-dashboard"></div>
          </div>
          </div>
        </section>
      </section>
    </section>
  </div>
  </main>

  <div id="webviewTooltip" class="webview-tooltip" role="tooltip" aria-hidden="true"></div>
  <div id="inputPromptBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="inputPromptTitle" aria-hidden="true">
    <section class="file-properties-dialog input-prompt-dialog">
      <div class="file-properties-header">
        <h2 id="inputPromptTitle" class="file-properties-title">Input</h2>
        <div id="inputPromptMessage" class="file-properties-path"></div>
      </div>
      <div class="file-properties-body">
        <label id="inputPromptLabel" for="inputPromptInput">Input</label>
        <div id="inputPromptInputWrap" class="input-with-button reveal-hidden">
          <input id="inputPromptInput" type="text" autocomplete="off" />
          <button id="inputPromptRevealButton" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show Password" data-tooltip="Hold to Show Password" disabled>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.3 3 1.73 6.11 1 8c.73 1.89 3.3 5 7 5s6.27-3.11 7-5c-.73-1.89-3.3-5-7-5Zm0 8.5A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7Zm0-1.25A2.25 2.25 0 1 0 8 5.75a2.25 2.25 0 0 0 0 4.5Z" /></svg>
          </button>
        </div>
        <div id="inputPromptFeedback" class="input-prompt-feedback" role="status" aria-live="polite"></div>
      </div>
      <div class="file-properties-actions">
        <button id="inputPromptCancelButton" type="button" class="secondary">Cancel</button>
        <button id="inputPromptConfirmButton" type="button">OK</button>
      </div>
    </section>
  </div>


  <div id="serverLogShortcutBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="serverLogShortcutTitle" aria-hidden="true">
    <section class="file-properties-dialog server-log-shortcut-dialog">
      <div class="file-properties-header">
        <h2 id="serverLogShortcutTitle" class="file-properties-title">Add Log Shortcut</h2>
        <div id="serverLogShortcutSubtitle" class="file-properties-path">Create a shortcut to a remote log file.</div>
      </div>
      <div class="file-properties-body">
        <div class="server-log-shortcut-fields">
          <div class="server-log-shortcut-field">
            <label for="serverLogShortcutNameInput">Name</label>
            <input id="serverLogShortcutNameInput" type="text" autocomplete="off" placeholder="Nginx error" />
          </div>
          <div class="server-log-shortcut-field">
            <label for="serverLogShortcutPathInput">Remote log path</label>
            <div class="server-log-shortcut-path-wrap">
              <input id="serverLogShortcutPathInput" type="text" autocomplete="off" placeholder="/var/log/nginx/error.log" />
              <button id="serverLogShortcutBrowseButton" class="input-icon-button has-tooltip" type="button" aria-label="Browse Remote Log File" data-tooltip="Browse Remote Log File">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4l2 2h8v12H4V4h6Zm-5 3v10h14V7H5Z" /></svg>
              </button>
              <div id="serverLogShortcutPathPicker" class="remote-search-scope-picker server-log-shortcut-picker hidden" aria-hidden="true">
                <div class="remote-search-scope-picker-header">
                  <div id="serverLogShortcutPathPickerPath" class="remote-search-scope-picker-path">/var/log</div>
                  <div class="remote-search-scope-picker-actions">
                    <button id="serverLogShortcutPathPickerCancelButton" class="secondary" type="button">Cancel</button>
                  </div>
                </div>
                <div id="serverLogShortcutPathPickerList" class="remote-search-scope-picker-list"><div class="remote-search-scope-picker-empty">Loading...</div></div>
              </div>
            </div>
          </div>
          <div id="serverLogShortcutFeedback" class="server-log-shortcut-feedback" role="status" aria-live="polite"></div>
        </div>
      </div>
      <div class="file-properties-actions">
        <button id="serverLogShortcutRemoveButton" type="button" class="secondary danger modal-action-left" hidden>Remove</button>
        <button id="serverLogShortcutCancelButton" type="button" class="secondary">Cancel</button>
        <button id="serverLogShortcutSaveButton" type="button">Add</button>
      </div>
    </section>
  </div>

  <div id="serverLogShortcutRemoveBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="serverLogShortcutRemoveTitle" aria-hidden="true">
    <section class="file-properties-dialog connection-name-dialog">
      <div class="file-properties-header">
        <h2 id="serverLogShortcutRemoveTitle" class="file-properties-title">Remove Log Shortcut</h2>
        <div class="file-properties-path">This will only remove the shortcut from Remote Edit. The remote log file will not be deleted.</div>
      </div>
      <div class="file-properties-body">
        <div id="serverLogShortcutRemovePath" class="server-log-shortcut-remove-path"></div>
      </div>
      <div class="file-properties-actions">
        <button id="serverLogShortcutRemoveCancelButton" type="button" class="secondary">Cancel</button>
        <button id="serverLogShortcutRemoveConfirmButton" type="button" class="danger">Remove</button>
      </div>
    </section>
  </div>


  <div id="serverPortForwardBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="serverPortForwardTitle" aria-hidden="true">
    <section class="file-properties-dialog server-port-forward-dialog">
      <div class="file-properties-header">
        <h2 id="serverPortForwardTitle" class="file-properties-title">Add Port Forward</h2>
        <div id="serverPortForwardSubtitle" class="file-properties-path">Create a local SSH port forward for this connection.</div>
      </div>
      <div class="file-properties-body">
        <div class="server-port-forward-fields">
          <div class="server-port-forward-field">
            <label for="serverPortForwardNameInput">Name</label>
            <input id="serverPortForwardNameInput" type="text" autocomplete="off" placeholder="My App" />
          </div>
          <div class="server-port-forward-field-grid">
            <div class="server-port-forward-field">
              <label for="serverPortForwardLocalHostInput">Local host</label>
              <input id="serverPortForwardLocalHostInput" type="text" autocomplete="off" placeholder="localhost" />
            </div>
            <div class="server-port-forward-field">
              <label for="serverPortForwardLocalPortInput">Local port</label>
              <input id="serverPortForwardLocalPortInput" type="text" inputmode="numeric" autocomplete="off" placeholder="3000" />
            </div>
          </div>
          <div class="server-port-forward-field-grid">
            <div class="server-port-forward-field">
              <label for="serverPortForwardRemoteHostInput">Remote host</label>
              <input id="serverPortForwardRemoteHostInput" type="text" autocomplete="off" placeholder="127.0.0.1" />
            </div>
            <div class="server-port-forward-field">
              <label for="serverPortForwardRemotePortInput">Remote port</label>
              <input id="serverPortForwardRemotePortInput" type="text" inputmode="numeric" autocomplete="off" placeholder="3000" />
            </div>
          </div>
          <label class="modal-checkbox-line server-port-forward-option"><input id="serverPortForwardAutoStartInput" class="dialog-checkbox" type="checkbox" /> <span>Auto-start on connect</span></label>
          <div id="serverPortForwardRunningNote" class="server-port-forward-running-note" hidden>Stop the port forward before editing local or remote ports.</div>
          <div class="server-port-forward-help">Local forwarding maps localhost:LOCAL_PORT on your computer to REMOTE_HOST:REMOTE_PORT from the remote server.</div>
          <div id="serverPortForwardFeedback" class="server-port-forward-feedback" role="status" aria-live="polite"></div>
        </div>
      </div>
      <div class="file-properties-actions">
        <button id="serverPortForwardDeleteButton" type="button" class="secondary danger modal-action-left" hidden>Delete</button>
        <button id="serverPortForwardCancelButton" type="button" class="secondary">Cancel</button>
        <button id="serverPortForwardSaveButton" type="button">Save</button>
      </div>
    </section>
  </div>

  <div id="serverPortForwardRemoveBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="serverPortForwardRemoveTitle" aria-hidden="true">
    <section class="file-properties-dialog connection-name-dialog">
      <div class="file-properties-header">
        <h2 id="serverPortForwardRemoveTitle" class="file-properties-title">Delete Port Forward</h2>
        <div class="file-properties-path">This will only remove the saved forward from Remote Edit.</div>
      </div>
      <div class="file-properties-body">
        <div id="serverPortForwardRemovePath" class="server-port-forward-remove-path"></div>
      </div>
      <div class="file-properties-actions">
        <button id="serverPortForwardRemoveCancelButton" type="button" class="secondary">Cancel</button>
        <button id="serverPortForwardRemoveConfirmButton" type="button" class="danger">Delete</button>
      </div>
    </section>
  </div>

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
        <button id="connectionNameCancelButton" type="button" class="secondary">Cancel</button>
        <button id="connectionNameCreateButton" type="button">Create</button>
      </div>
    </section>
  </div>

  <div id="manageProfilesBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="manageProfilesTitle" aria-hidden="true">
    <section class="file-properties-dialog manage-profiles-dialog">
      <div class="file-properties-header manage-profiles-header-row">
        <div>
          <h2 id="manageProfilesTitle" class="file-properties-title">Manage Saved Connections</h2>
          <div class="file-properties-path">Rename, reorder, or remove saved connection profiles.</div>
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
        <div class="transfer-queue-header-text">
          <h2 id="transferQueueTitle" class="transfer-queue-title">Transfer Queue</h2>
          <div class="transfer-queue-subtitle">Monitor current, pending, and completed transfers.</div>
        </div>
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
        <section class="transfer-queue-section transfer-queue-section-scroll" aria-labelledby="transferQueueCompletedTitle">
          <h3 id="transferQueueCompletedTitle" class="transfer-queue-section-title">Completed transfers</h3>
          <div id="transferQueueCompleted" class="transfer-queue-items"></div>
        </section>
      </div>
      <div class="transfer-queue-footer">
        <button id="transferQueueFooterCloseButton" class="secondary" type="button">Close</button>
      </div>
    </div>
  </div>

  <div id="remoteSearchBackdrop" class="file-properties-backdrop remote-search-backdrop" role="dialog" aria-modal="true" aria-labelledby="remoteSearchTitle" aria-hidden="true">
    <section class="file-properties-dialog remote-search-dialog">
      <div class="file-properties-header">
        <h2 id="remoteSearchTitle" class="file-properties-title">Remote Search</h2>
        <div class="file-properties-path">Search remote files by name. SSH/SFTP connections can also search inside files and use Sudo Mode.</div>
      </div>
      <div class="file-properties-body">
        <section class="remote-search-section">
          <div class="remote-command-meta-block">
            <div class="remote-command-meta">
              <span class="remote-command-meta-label">Connected to:</span>
              <span id="remoteSearchConnectedTo" class="remote-command-connected-to">-</span>
            </div>
            <div class="remote-command-meta">
              <span class="remote-command-meta-label">Run as:</span>
              <span id="remoteSearchRunAs" class="remote-command-run-as">SSH user</span>
            </div>
          </div>
          <div class="remote-search-scope-wrap">
            <div class="remote-search-field remote-search-scope-field">
              <label for="remoteSearchScopePath">Remote path</label>
              <div class="input-with-button remote-search-scope-row">
                <input id="remoteSearchScopePath" type="text" value="/" spellcheck="false" autocomplete="off" />
                <button id="remoteSearchBrowseButton" class="input-icon-button has-tooltip" type="button" aria-label="Browse Remote Path" data-tooltip="Browse Remote Path">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg>
                </button>
              </div>
            </div>
            <div id="remoteSearchScopePicker" class="remote-search-scope-picker hidden" aria-hidden="true">
              <div class="remote-search-scope-picker-header">
                <div id="remoteSearchScopePickerPath" class="remote-search-scope-picker-path">/</div>
                <div class="remote-search-scope-picker-actions">
                  <button id="remoteSearchScopeSelectButton" class="secondary" type="button">Select This Folder</button>
                  <button id="remoteSearchScopeCancelButton" class="secondary" type="button">Cancel</button>
                </div>
              </div>
              <div id="remoteSearchScopePickerList" class="remote-search-scope-picker-list"><div class="remote-search-scope-picker-empty">Loading...</div></div>
            </div>
          </div>
          <div class="remote-search-options-grid">
            <label class="modal-checkbox-line"><input id="remoteSearchSubdirectories" class="dialog-checkbox" type="checkbox" checked><span>Include subdirectories</span></label>
            <label class="modal-checkbox-line"><input id="remoteSearchHiddenFiles" class="dialog-checkbox" type="checkbox"><span>Include hidden files</span></label>
            <label class="modal-checkbox-line"><input id="remoteSearchCaseSensitive" class="dialog-checkbox" type="checkbox"><span>Case sensitive</span></label>
            <label id="remoteSearchSudoRow" class="modal-checkbox-line remote-search-ssh-only"><input id="remoteSearchUseSudo" class="dialog-checkbox" type="checkbox"><span>Use Sudo Mode</span><span id="remoteSearchSudoNote" class="remote-command-sudo-note"></span></label>
          </div>
          <div class="remote-search-field">
            <label for="remoteSearchFileName">File name</label>
            <input id="remoteSearchFileName" type="text" value="*" placeholder="*.conf" spellcheck="false" autocomplete="off" />
            <div class="modal-helper-text">Use wildcards: *, ?, [abc]. Separate multiple patterns with commas.</div>
          </div>
          <label id="remoteSearchInsideRow" class="modal-checkbox-line remote-search-ssh-only"><input id="remoteSearchInsideFiles" class="dialog-checkbox" type="checkbox"><span>Search inside files</span></label>
          <div id="remoteSearchTextField" class="remote-search-field remote-search-text-field hidden">
            <label for="remoteSearchTextToFind">Text to Find</label>
            <input id="remoteSearchTextToFind" type="text" spellcheck="false" autocomplete="off" />
          </div>
          <div id="remoteSearchValidation" class="remote-search-validation-line" role="alert" aria-live="polite"></div>
        </section>
        <section class="remote-search-results-section" aria-labelledby="remoteSearchResultsTitle">
          <div class="remote-search-results-header">
            <span id="remoteSearchResultsTitle">Results</span>
            <span id="remoteSearchResultsStatus" class="remote-search-results-status">Idle</span>
          </div>
          <div id="remoteSearchResults" class="remote-search-results"><div class="remote-search-empty">No results.</div></div>
        </section>
      </div>
      <div class="file-properties-actions remote-search-actions">
        <button id="remoteSearchCopyButton" class="secondary" type="button">Copy</button>
        <button id="remoteSearchClearButton" class="secondary" type="button">Clear</button>
        <button id="remoteSearchCloseButton" class="secondary" type="button">Close</button>
        <button id="remoteSearchPrimaryButton" class="remote-search-primary-button" type="button">Search</button>
      </div>
    </section>
  </div>

  <div id="remoteSearchResultContextMenu" class="context-menu remote-search-context-menu" role="menu" aria-label="Search Result Actions">
    <button id="remoteSearchContextOpen" type="button" role="menuitem">View/Edit</button>
    <button id="remoteSearchContextOpenReadOnly" type="button" role="menuitem">View Read-Only</button>
    <div id="remoteSearchContextFileSeparator" class="context-menu-separator" role="separator"></div>
    <button id="remoteSearchContextCopyPath" type="button" role="menuitem">Copy Path</button>
    <button id="remoteSearchContextCopyName" type="button" role="menuitem">Copy Filename</button>
    <div id="remoteSearchContextResultsSeparator" class="context-menu-separator" role="separator"></div>
    <button id="remoteSearchContextCopyResults" type="button" role="menuitem">Copy Results</button>
  </div>

  <div id="confirmDialogBackdrop" class="confirm-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirmDialogTitle" aria-hidden="true">
    <section class="confirm-dialog">
      <div class="confirm-dialog-header">
        <h2 id="confirmDialogTitle" class="confirm-dialog-title">Confirm action</h2>
        <div id="confirmDialogMessage" class="confirm-dialog-subtitle"></div>
      </div>
      <div id="confirmDialogBody" class="confirm-dialog-body">
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
        <div id="transferConflictMessage" class="transfer-conflict-subtitle"></div>
      </div>
      <div class="transfer-conflict-body">
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
              <div class="owner-group-combo" data-owner-group-combo="owner">
                <input id="ownerGroupOwnerInput" type="text" autocomplete="off" spellcheck="false" placeholder="owner" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ownerGroupOwnerSuggestions">
                <div id="ownerGroupOwnerSuggestions" class="owner-group-suggestions" role="listbox" aria-label="Owner suggestions"></div>
              </div>
            </div>
            <div>
              <label for="ownerGroupGroupInput">Group</label>
              <div class="owner-group-combo" data-owner-group-combo="group">
                <input id="ownerGroupGroupInput" type="text" autocomplete="off" spellcheck="false" placeholder="group" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ownerGroupGroupSuggestions">
                <div id="ownerGroupGroupSuggestions" class="owner-group-suggestions" role="listbox" aria-label="Group suggestions"></div>
              </div>
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
        <div class="remote-command-main">
          <div class="remote-command-field-grid">
            <div class="remote-command-meta-block">
              <div class="remote-command-meta">
                <span class="remote-command-meta-label">Connected to:</span>
                <span id="remoteCommandConnectedTo" class="remote-command-connected-to">-</span>
              </div>
              <div class="remote-command-meta">
                <span class="remote-command-meta-label">Run as:</span>
                <span id="remoteCommandRunAs" class="remote-command-run-as">SSH user</span>
              </div>
            </div>
            <div class="remote-command-working-directory-wrap">
              <label class="remote-command-section-title" for="remoteCommandWorkingDirectory">Remote path</label>
              <div class="input-with-button remote-command-working-directory-row">
                <input id="remoteCommandWorkingDirectory" type="text" value="/" spellcheck="false" autocomplete="off" />
                <button id="remoteCommandBrowseWorkingDirectoryButton" class="input-icon-button has-tooltip" type="button" aria-label="Browse Remote Path" data-tooltip="Browse Remote Path">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg>
                </button>
              </div>
              <div id="remoteCommandWorkingDirectoryPicker" class="remote-search-scope-picker hidden" aria-hidden="true">
                <div class="remote-search-scope-picker-header">
                  <div id="remoteCommandWorkingDirectoryPickerPath" class="remote-search-scope-picker-path">/</div>
                  <div class="remote-search-scope-picker-actions">
                    <button id="remoteCommandWorkingDirectorySelectButton" class="secondary" type="button">Select This Folder</button>
                    <button id="remoteCommandWorkingDirectoryCancelButton" class="secondary" type="button">Cancel</button>
                  </div>
                </div>
                <div id="remoteCommandWorkingDirectoryPickerList" class="remote-search-scope-picker-list"><div class="remote-search-scope-picker-empty">Loading...</div></div>
              </div>
            </div>
            <div class="remote-command-field remote-command-command-field">
              <label for="remoteCommandInput">Command</label>
              <div class="remote-command-input-row">
                <textarea id="remoteCommandInput" spellcheck="false" autocomplete="off"></textarea>
              </div>
            </div>
            <label id="remoteCommandSudoRow" class="remote-command-sudo-row">
              <input id="remoteCommandUseSudo" class="dialog-checkbox" type="checkbox">
              <span>Use Sudo Mode</span>
              <span id="remoteCommandSudoNote" class="remote-command-sudo-note"></span>
            </label>
            <div class="remote-command-run-row">
              <button id="remoteCommandRunButton" type="button">Run</button>
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
        <aside class="remote-command-side" aria-label="Saved Commands and Command History">
          <section class="remote-command-side-section" aria-labelledby="remoteCommandSavedTitle">
            <div class="remote-command-side-header">
              <h3 id="remoteCommandSavedTitle" class="remote-command-side-title">Saved Commands</h3>
              <button id="remoteCommandSaveCurrentButton" class="secondary remote-command-compact-button" type="button">+ Save current</button>
            </div>
            <div id="remoteCommandSavedList" class="remote-command-side-list"></div>
          </section>
          <section class="remote-command-side-section" aria-labelledby="remoteCommandHistoryTitle">
            <div class="remote-command-side-header">
              <h3 id="remoteCommandHistoryTitle" class="remote-command-side-title">Command History</h3>
            </div>
            <div id="remoteCommandHistoryList" class="remote-command-side-list"></div>
          </section>
        </aside>
      </div>
      <div id="remoteCommandCloseWarning" class="remote-command-close-warning" role="alert">
        <div class="remote-command-close-warning-text">Command is still running. Closing this window will keep it running.</div>
        <div class="remote-command-close-warning-actions">
          <button id="remoteCommandKeepRunningButton" class="secondary" type="button">Return to command</button>
          <button id="remoteCommandStopAndCloseButton" type="button">Stop command</button>
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
  <div id="contextItemSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextDownload" type="button" role="menuitem">Download...</button>
  <button id="contextUploadEntry" type="button" role="menuitem">Upload...</button>
  <div id="contextTransferSeparator" class="context-menu-separator" role="separator"></div>
  <div id="contextCompressSubmenu" class="context-submenu" role="none">
    <button id="contextCompressTrigger" class="context-submenu-trigger" type="button" role="menuitem" aria-haspopup="true">Compress to Archive</button>
    <div class="context-submenu-content" role="menu" aria-label="Archive Formats">
      <button id="contextCompressTarGz" type="button" role="menuitem" data-archive-format="tar.gz">tar.gz...</button>
      <button id="contextCompressTarBz2" type="button" role="menuitem" data-archive-format="tar.bz2">tar.bz2...</button>
      <button id="contextCompressTarXz" type="button" role="menuitem" data-archive-format="tar.xz">tar.xz...</button>
      <button id="contextCompressTarZ" type="button" role="menuitem" data-archive-format="tar.Z">tar.Z...</button>
    </div>
  </div>
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
  <button id="contextOpenLogViewer" type="button" role="menuitem">Open in Log Viewer</button>
  <button id="contextRunRemoteCommand" type="button" role="menuitem">Run Remote Command...</button>
  <button id="contextOpenSshTerminal" type="button" role="menuitem">Open SSH Terminal</button>
  <div id="contextDeleteSeparator" class="context-menu-separator" role="separator"></div>
  <button id="contextDelete" type="button" role="menuitem">Delete</button>
  </div>


  <div id="textEditContextMenu" class="context-menu text-edit-context-menu" role="menu" aria-label="Text Edit Actions">
    <button id="textEditContextUndo" type="button" role="menuitem">Undo</button>
    <button id="textEditContextRedo" type="button" role="menuitem">Redo</button>
    <div class="context-menu-separator" role="separator"></div>
    <button id="textEditContextCut" type="button" role="menuitem">Cut</button>
    <button id="textEditContextCopy" type="button" role="menuitem">Copy</button>
    <button id="textEditContextPaste" type="button" role="menuitem">Paste</button>
    <div class="context-menu-separator" role="separator"></div>
    <button id="textEditContextSelectAll" type="button" role="menuitem">Select All</button>
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
  let showRemotePathBreadcrumbDirectoryDetails = ${showRemotePathBreadcrumbDirectoryDetails ? 'true' : 'false'};
  let openFileListItemsOnNameClick = ${openFileListItemsOnNameClick ? 'true' : 'false'};

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
  const filesView = document.getElementById('filesView');
  const serverView = document.getElementById('serverView');
  const serverViewContent = document.getElementById('serverViewContent');
  const serverLogShortcutBackdrop = document.getElementById('serverLogShortcutBackdrop');
  const serverLogShortcutTitle = document.getElementById('serverLogShortcutTitle');
  const serverLogShortcutSubtitle = document.getElementById('serverLogShortcutSubtitle');
  const serverLogShortcutNameInput = document.getElementById('serverLogShortcutNameInput');
  const serverLogShortcutPathInput = document.getElementById('serverLogShortcutPathInput');
  const serverLogShortcutBrowseButton = document.getElementById('serverLogShortcutBrowseButton');
  const serverLogShortcutPathPicker = document.getElementById('serverLogShortcutPathPicker');
  const serverLogShortcutPathPickerPath = document.getElementById('serverLogShortcutPathPickerPath');
  const serverLogShortcutPathPickerList = document.getElementById('serverLogShortcutPathPickerList');
  const serverLogShortcutPathPickerCancelButton = document.getElementById('serverLogShortcutPathPickerCancelButton');
  const serverLogShortcutFeedback = document.getElementById('serverLogShortcutFeedback');
  const serverLogShortcutRemoveButton = document.getElementById('serverLogShortcutRemoveButton');
  const serverLogShortcutSaveButton = document.getElementById('serverLogShortcutSaveButton');
  const serverLogShortcutCancelButton = document.getElementById('serverLogShortcutCancelButton');
  const serverLogShortcutRemoveBackdrop = document.getElementById('serverLogShortcutRemoveBackdrop');
  const serverLogShortcutRemovePath = document.getElementById('serverLogShortcutRemovePath');
  const serverLogShortcutRemoveConfirmButton = document.getElementById('serverLogShortcutRemoveConfirmButton');
  const serverLogShortcutRemoveCancelButton = document.getElementById('serverLogShortcutRemoveCancelButton');
  const serverPortForwardBackdrop = document.getElementById('serverPortForwardBackdrop');
  const serverPortForwardTitle = document.getElementById('serverPortForwardTitle');
  const serverPortForwardSubtitle = document.getElementById('serverPortForwardSubtitle');
  const serverPortForwardNameInput = document.getElementById('serverPortForwardNameInput');
  const serverPortForwardLocalHostInput = document.getElementById('serverPortForwardLocalHostInput');
  const serverPortForwardLocalPortInput = document.getElementById('serverPortForwardLocalPortInput');
  const serverPortForwardRemoteHostInput = document.getElementById('serverPortForwardRemoteHostInput');
  const serverPortForwardRemotePortInput = document.getElementById('serverPortForwardRemotePortInput');
  const serverPortForwardAutoStartInput = document.getElementById('serverPortForwardAutoStartInput');
  const serverPortForwardRunningNote = document.getElementById('serverPortForwardRunningNote');
  const serverPortForwardFeedback = document.getElementById('serverPortForwardFeedback');
  const serverPortForwardDeleteButton = document.getElementById('serverPortForwardDeleteButton');
  const serverPortForwardSaveButton = document.getElementById('serverPortForwardSaveButton');
  const serverPortForwardCancelButton = document.getElementById('serverPortForwardCancelButton');
  const serverPortForwardRemoveBackdrop = document.getElementById('serverPortForwardRemoveBackdrop');
  const serverPortForwardRemovePath = document.getElementById('serverPortForwardRemovePath');
  const serverPortForwardRemoveConfirmButton = document.getElementById('serverPortForwardRemoveConfirmButton');
  const serverPortForwardRemoveCancelButton = document.getElementById('serverPortForwardRemoveCancelButton');
  const browserSectionDivider = document.querySelector('.browser-section-divider');
  const pathbar = document.querySelector('.pathbar');
  const currentPath = document.getElementById('currentPath');
  const remotePathLeadingIcon = document.querySelector('.remote-path-leading-icon');
  const SESSION_TAB_REMOTE_ICON = '<svg focusable="false" width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M12 11.5C12 11.5989 11.9707 11.6956 11.9157 11.7778C11.8608 11.86 11.7827 11.9241 11.6913 11.9619C11.6 11.9998 11.4994 12.0097 11.4025 11.9904C11.3055 11.9711 11.2164 11.9235 11.1464 11.8536C11.0765 11.7836 11.0289 11.6945 11.0096 11.5975C10.9903 11.5006 11.0002 11.4 11.0381 11.3087C11.0759 11.2173 11.14 11.1392 11.2222 11.0843C11.3044 11.0293 11.4011 11 11.5 11C11.6326 11 11.7598 11.0527 11.8536 11.1464C11.9473 11.2402 12 11.3674 12 11.5ZM11.5 8C11.5989 8 11.6956 7.97068 11.7778 7.91573C11.86 7.86079 11.9241 7.7827 11.9619 7.69134C11.9998 7.59998 12.0097 7.49945 11.9904 7.40245C11.9711 7.30546 11.9235 7.21637 11.8536 7.14645C11.7836 7.07652 11.6945 7.0289 11.5975 7.00961C11.5006 6.99031 11.4 7.00022 11.3087 7.03806C11.2173 7.0759 11.1392 7.13999 11.0843 7.22221C11.0293 7.30444 11 7.40111 11 7.5C11 7.63261 11.0527 7.75979 11.1464 7.85355C11.2402 7.94732 11.3674 8 11.5 8ZM14 4.5C13.999 4.87026 13.86 5.22685 13.61 5.5C13.86 5.77315 13.999 6.12974 14 6.5V8.5C13.999 8.87026 13.86 9.22685 13.61 9.5C13.86 9.77315 13.999 10.1297 14 10.5V12.5C14 12.8978 13.842 13.2794 13.5607 13.5607C13.2794 13.842 12.8978 14 12.5 14H3.5C3.10218 14 2.72064 13.842 2.43934 13.5607C2.15804 13.2794 2 12.8978 2 12.5V10.5C2.00097 10.1297 2.14003 9.77315 2.39 9.5C2.14003 9.22685 2.00097 8.87026 2 8.5V6.5C2.00097 6.12974 2.14003 5.77315 2.39 5.5C2.14003 5.22685 2.00097 4.87026 2 4.5V2.5C2 2.10218 2.15804 1.72064 2.43934 1.43934C2.72064 1.15804 3.10218 1 3.5 1H12.5C12.8978 1 13.2794 1.15804 13.5607 1.43934C13.842 1.72064 14 2.10218 14 2.5V4.5ZM3 4.5C3 4.63261 3.05268 4.75979 3.14645 4.85355C3.24021 4.94732 3.36739 5 3.5 5H12.5C12.6326 5 12.7598 4.94732 12.8536 4.85355C12.9473 4.75979 13 4.63261 13 4.5V2.5C13 2.36739 12.9473 2.24021 12.8536 2.14645C12.7598 2.05268 12.6326 2 12.5 2H3.5C3.36739 2 3.24021 2.05268 3.14645 2.14645C3.05268 2.24021 3 2.36739 3 2.5V4.5ZM12.5 6H3.5C3.36739 6 3.24021 6.05268 3.14645 6.14645C3.05268 6.24021 3 6.36739 3 6.5V8.5C3 8.63261 3.05268 8.75979 3.14645 8.85355C3.24021 8.94732 3.36739 9 3.5 9H12.5C12.6326 9 12.7598 8.94732 12.8536 8.85355C12.9473 8.75979 13 8.63261 13 8.5V6.5C13 6.36739 12.9473 6.24021 12.8536 6.14645C12.7598 6.05268 12.6326 6 12.5 6ZM13 10.5C13 10.3674 12.9473 10.2402 12.8536 10.1464C12.7598 10.0527 12.6326 10 12.5 10H3.5C3.36739 10 3.24021 10.0527 3.14645 10.1464C3.05268 10.2402 3 10.3674 3 10.5V12.5C3 12.6326 3.05268 12.7598 3.14645 12.8536C3.24021 12.9473 3.36739 13 3.5 13H12.5C12.6326 13 12.7598 12.9473 12.8536 12.8536C12.9473 12.7598 13 12.6326 13 12.5V10.5ZM11.5 4C11.5989 4 11.6956 3.97068 11.7778 3.91573C11.86 3.86079 11.9241 3.7827 11.9619 3.69134C11.9998 3.59998 12.0097 3.49945 11.9904 3.40245C11.9711 3.30546 11.9235 3.21637 11.8536 3.14645C11.7836 3.07652 11.6945 3.0289 11.5975 3.00961C11.5006 2.99031 11.4 3.00022 11.3087 3.03806C11.2173 3.0759 11.1392 3.13999 11.0843 3.22221C11.0293 3.30444 11 3.40111 11 3.5C11 3.63261 11.0527 3.75979 11.1464 3.85355C11.2402 3.94732 11.3674 4 11.5 4Z"/></svg>';
  const SESSION_TAB_CONNECTING_ICON = '<div class="spinner" aria-hidden="true"></div>';
  const SESSION_TAB_ERROR_ICON = '<svg focusable="false" width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 1.5 15 14H1L8 1.5Zm0 2.06L2.72 13h10.56L8 3.56ZM7.25 6h1.5v3.8h-1.5V6Zm0 5h1.5v1.5h-1.5V11Z" /></svg>';
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
  const inputPromptBackdrop = document.getElementById('inputPromptBackdrop');
  const inputPromptTitle = document.getElementById('inputPromptTitle');
  const inputPromptMessage = document.getElementById('inputPromptMessage');
  const inputPromptLabel = document.getElementById('inputPromptLabel');
  const inputPromptInputWrap = document.getElementById('inputPromptInputWrap');
  const inputPromptInput = document.getElementById('inputPromptInput');
  const inputPromptRevealButton = document.getElementById('inputPromptRevealButton');
  const inputPromptFeedback = document.getElementById('inputPromptFeedback');
  const inputPromptConfirmButton = document.getElementById('inputPromptConfirmButton');
  const inputPromptCancelButton = document.getElementById('inputPromptCancelButton');
  const browserSubtitle = document.getElementById('browserSubtitle');
  const serverRefreshActions = document.getElementById('serverRefreshActions');
  const serverToolbarStatus = document.getElementById('serverToolbarStatus');
  const serverRefreshButton = document.getElementById('serverRefreshButton');
  const serverAutoRefreshPicker = document.getElementById('serverAutoRefreshPicker');
  const serverAutoRefreshDropdownButton = document.getElementById('serverAutoRefreshDropdownButton');
  const serverAutoRefreshDropdownLabel = document.getElementById('serverAutoRefreshDropdownLabel');
  const serverAutoRefreshDropdownMenu = document.getElementById('serverAutoRefreshDropdownMenu');
  const serverRefreshActionsSeparator = document.getElementById('serverRefreshActionsSeparator');
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
  const showSettingsButton = document.getElementById('showSettingsButton');
  const showOutputButton = document.getElementById('showOutputButton');
  const runRemoteCommandAction = document.getElementById('runRemoteCommandAction');
  const openSshTerminalAction = document.getElementById('openSshTerminalAction');
  const openLogViewerAction = document.getElementById('openLogViewerAction');
  const runRemoteCommandButton = document.getElementById('runRemoteCommandButton');
  const remoteCommandBadge = document.getElementById('remoteCommandBadge');
  const openSshTerminalButton = document.getElementById('openSshTerminalButton');
  const openLogViewerButton = document.getElementById('openLogViewerButton');
  const logViewerBadge = document.getElementById('logViewerBadge');
  const remoteSearchButton = document.getElementById('remoteSearchButton');
  const remoteSearchBadge = document.getElementById('remoteSearchBadge');
  const remoteSearchBackdrop = document.getElementById('remoteSearchBackdrop');
  const remoteSearchConnectedTo = document.getElementById('remoteSearchConnectedTo');
  const remoteSearchRunAs = document.getElementById('remoteSearchRunAs');
  const remoteSearchScopePath = document.getElementById('remoteSearchScopePath');
  const remoteSearchBrowseButton = document.getElementById('remoteSearchBrowseButton');
  const remoteSearchScopePicker = document.getElementById('remoteSearchScopePicker');
  const remoteSearchScopePickerPath = document.getElementById('remoteSearchScopePickerPath');
  const remoteSearchScopePickerList = document.getElementById('remoteSearchScopePickerList');
  const remoteSearchScopeSelectButton = document.getElementById('remoteSearchScopeSelectButton');
  const remoteSearchScopeCancelButton = document.getElementById('remoteSearchScopeCancelButton');
  const remoteSearchSubdirectories = document.getElementById('remoteSearchSubdirectories');
  const remoteSearchHiddenFiles = document.getElementById('remoteSearchHiddenFiles');
  const remoteSearchCaseSensitive = document.getElementById('remoteSearchCaseSensitive');
  const remoteSearchSudoRow = document.getElementById('remoteSearchSudoRow');
  const remoteSearchUseSudo = document.getElementById('remoteSearchUseSudo');
  const remoteSearchSudoNote = document.getElementById('remoteSearchSudoNote');
  const remoteSearchInsideRow = document.getElementById('remoteSearchInsideRow');
  const remoteSearchInsideFiles = document.getElementById('remoteSearchInsideFiles');
  const remoteSearchFileName = document.getElementById('remoteSearchFileName');
  const remoteSearchTextField = document.getElementById('remoteSearchTextField');
  const remoteSearchTextToFind = document.getElementById('remoteSearchTextToFind');
  const remoteSearchValidation = document.getElementById('remoteSearchValidation');
  const remoteSearchResultsStatus = document.getElementById('remoteSearchResultsStatus');
  const remoteSearchResults = document.getElementById('remoteSearchResults');
  const remoteSearchPrimaryButton = document.getElementById('remoteSearchPrimaryButton');
  const remoteSearchCopyButton = document.getElementById('remoteSearchCopyButton');
  const remoteSearchClearButton = document.getElementById('remoteSearchClearButton');
  const remoteSearchCloseButton = document.getElementById('remoteSearchCloseButton');
  const remoteSearchResultContextMenu = document.getElementById('remoteSearchResultContextMenu');
  const remoteSearchContextOpen = document.getElementById('remoteSearchContextOpen');
  const remoteSearchContextOpenReadOnly = document.getElementById('remoteSearchContextOpenReadOnly');
  const remoteSearchContextFileSeparator = document.getElementById('remoteSearchContextFileSeparator');
  const remoteSearchContextCopyPath = document.getElementById('remoteSearchContextCopyPath');
  const remoteSearchContextCopyName = document.getElementById('remoteSearchContextCopyName');
  const remoteSearchContextResultsSeparator = document.getElementById('remoteSearchContextResultsSeparator');
  const remoteSearchContextCopyResults = document.getElementById('remoteSearchContextCopyResults');
  const uploadButton = document.getElementById('uploadButton');
  const downloadButton = document.getElementById('downloadButton');
  const transferQueueButton = document.getElementById('transferQueueButton');
  const transferQueueTooltip = document.getElementById('transferQueueTooltip');
  const transferQueueCount = document.getElementById('transferQueueCount');
  const transferQueueModal = document.getElementById('transferQueueModal');
  const transferQueueFooterCloseButton = document.getElementById('transferQueueFooterCloseButton');
  const transferQueueCurrent = document.getElementById('transferQueueCurrent');
  const transferQueuePending = document.getElementById('transferQueuePending');
  const transferQueueCompleted = document.getElementById('transferQueueCompleted');
  const confirmDialogBackdrop = document.getElementById('confirmDialogBackdrop');
  const confirmDialogTitle = document.getElementById('confirmDialogTitle');
  const confirmDialogMessage = document.getElementById('confirmDialogMessage');
  const confirmDialogBody = document.getElementById('confirmDialogBody');
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
  const contextTransferSeparator = document.getElementById('contextTransferSeparator');
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
  const contextOpenLogViewer = document.getElementById('contextOpenLogViewer');
  const contextOpenSshTerminal = document.getElementById('contextOpenSshTerminal');
  const textEditContextMenu = document.getElementById('textEditContextMenu');
  const textEditContextUndo = document.getElementById('textEditContextUndo');
  const textEditContextRedo = document.getElementById('textEditContextRedo');
  const textEditContextCut = document.getElementById('textEditContextCut');
  const textEditContextCopy = document.getElementById('textEditContextCopy');
  const textEditContextPaste = document.getElementById('textEditContextPaste');
  const textEditContextSelectAll = document.getElementById('textEditContextSelectAll');

  const remoteCommandBackdrop = document.getElementById('remoteCommandBackdrop');
  const remoteCommandConnectedTo = document.getElementById('remoteCommandConnectedTo');
  const remoteCommandWorkingDirectory = document.getElementById('remoteCommandWorkingDirectory');
  const remoteCommandBrowseWorkingDirectoryButton = document.getElementById('remoteCommandBrowseWorkingDirectoryButton');
  const remoteCommandWorkingDirectoryPicker = document.getElementById('remoteCommandWorkingDirectoryPicker');
  const remoteCommandWorkingDirectoryPickerPath = document.getElementById('remoteCommandWorkingDirectoryPickerPath');
  const remoteCommandWorkingDirectoryPickerList = document.getElementById('remoteCommandWorkingDirectoryPickerList');
  const remoteCommandWorkingDirectorySelectButton = document.getElementById('remoteCommandWorkingDirectorySelectButton');
  const remoteCommandWorkingDirectoryCancelButton = document.getElementById('remoteCommandWorkingDirectoryCancelButton');
  const remoteCommandSudoRow = document.getElementById('remoteCommandSudoRow');
  const remoteCommandUseSudo = document.getElementById('remoteCommandUseSudo');
  const remoteCommandSudoNote = document.getElementById('remoteCommandSudoNote');
  const remoteCommandSaveCurrentButton = document.getElementById('remoteCommandSaveCurrentButton');
  const remoteCommandSavedList = document.getElementById('remoteCommandSavedList');
  const remoteCommandHistoryList = document.getElementById('remoteCommandHistoryList');
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
  const ownerGroupOwnerSuggestions = document.getElementById('ownerGroupOwnerSuggestions');
  const ownerGroupGroupInput = document.getElementById('ownerGroupGroupInput');
  const ownerGroupGroupSuggestions = document.getElementById('ownerGroupGroupSuggestions');
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
  const clientPendingSessionsByConnectionId = new Map();
  const filesStatusByConnectionId = new Map();
  let draggedSessionId = '';
  let sessionDragOverId = '';
  let sessionDragOverPosition = '';
  let sessionDragDropIndex = -1;
  let sessionTabDragging = false;
  let draggedManageProfileId = '';
  let manageProfileDragOverId = '';
  let manageProfileDragOverPosition = '';
  let manageProfileDragging = false;
  let selectedProfileId = '';
  let pendingConnectionNameResolver = null;
  let profileDropdownOpen = false;
  let profileDropdownFilterText = '';
  let connectionTypeDropdownOpen = false;
  let authDropdownOpen = false;
  let serverAutoRefreshDropdownOpen = false;
  let serverAutoRefreshValue = 'off';
  let serverAutoRefreshTimer = null;
  const serverDashboardStatesByConnectionId = new Map();
  const serverServiceFiltersByConnectionId = new Map();
  const serverQuickTaskFiltersByConnectionId = new Map();
  const serverProcessFiltersByConnectionId = new Map();
  const serverScheduledJobFiltersByConnectionId = new Map();
  const serverProcessActionStatesByConnectionId = new Map();
  const serverLogShortcutFiltersByConnectionId = new Map();
  const serverCardSortsByConnectionId = new Map();
  const serverLogShortcutsSessionByConnectionId = new Map();
  const SERVER_LOG_SHORTCUTS_STORAGE_KEY = 'remoteedit.serverLogShortcuts';
  const serverPortForwardFiltersByConnectionId = new Map();
  const serverPortForwardsSessionByConnectionId = new Map();
  const serverPortForwardRuntimeByConnectionId = new Map();
  const serverPortForwardAutoStartedConnectionIds = new Set();
  const SERVER_PORT_FORWARDS_STORAGE_KEY = 'remoteedit.serverPortForwards';
  let serverPortForwardDialogOpen = false;
  let serverPortForwardDialogMode = 'add';
  let serverPortForwardDialogForwardId = '';
  let serverPortForwardRemoveDialogOpen = false;
  let serverPortForwardRemoveId = '';
  let serverLogShortcutDialogOpen = false;
  let serverLogShortcutDialogMode = 'add';
  let serverLogShortcutDialogShortcutId = '';
  let serverLogShortcutPathPickerOpen = false;
  let serverLogShortcutPathPickerPathValue = '/var/log';
  let serverLogShortcutPathPickerRequestId = 0;
  let serverLogShortcutRemoveDialogOpen = false;
  let serverLogShortcutRemoveId = '';
  let manageProfilesDialogOpen = false;
  let exportBackupDialogOpen = false;
  let importBackupDialogOpen = false;
  let importBackupSummaryState = null;
  let manageProfilesFilterText = '';
  let renameProfileId = '';
  let activeConnectionId = '';
  const activeConnectionViewsByConnectionId = new Map();
  let logViewerActiveSessionCount = 0;
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
  let serverToolbarStatusTimer = 0;
  const serverPortForwardPendingActions = new Map();
  const profileDisconnectingIds = new Set();
  let filePropertiesDialogOpen = false;
  let filePropertiesRemotePath = '';
  let checksumsDialogOpen = false;
  let ownerGroupDialogOpen = false;
  let ownerGroupEntries = [];
  const ownerGroupSuggestionsByConnectionId = new Map();
  let ownerGroupActiveSuggestionKind = '';
  let ownerGroupSuggestionRepositionFrame = 0;
  let checksumsCopyState = { sha256: '', md5: '', all: '' };
  let permissionsDialogOpen = false;
  let permissionPreviewKind = 'file';
  let transferQueueState = { current: null, currentTransfers: [], pending: [], completed: [] };
  const transferQueueCancelingIds = new Set();
  const transferQueueRemovingIds = new Set();
  let transferQueueModalOpen = false;
  let remoteCommandDialogOpen = false;
  let remoteCommandDialogConnectionId = '';
  let remoteCommandWorkingDirectoryPickerOpen = false;
  let remoteCommandWorkingDirectoryPickerPathValue = '/';
  let remoteCommandEditingSavedId = '';
  let remoteCommandDeletingSavedId = '';
  let remoteCommandStopEscalationTimer = null;
  const REMOTE_COMMAND_STORAGE_KEY = 'remoteedit.savedRemoteCommands';
  const REMOTE_COMMAND_HISTORY_STORAGE_KEY = 'remoteedit.remoteCommandHistory';
  const REMOTE_COMMAND_STOP_ESCALATION_MS = 10000;
  const REMOTE_COMMAND_MAX_OUTPUT_CHARS = 500000;
  const REMOTE_COMMAND_MAX_HISTORY_PER_CONNECTION = 50;
  const remoteCommandSessionsByConnectionId = new Map();
  const remoteCommandSavedByConnectionId = new Map();
  const remoteCommandHistoryByConnectionId = new Map();
  let persistentStorageApplyingSnapshot = false;
  let confirmDialogOpen = false;
  let confirmDialogRequestId = '';
  let inputPromptOpen = false;
  let inputPromptRequestId = '';
  let inputPromptPasswordMode = false;
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
  let remoteSearchDialogOpen = false;
  let remoteSearchScopePickerOpen = false;
  let remoteSearchScopePickerPathValue = '/';
  let remoteSearchContextPath = '';
  let remoteSearchContextKind = '';
  const remoteSearchStatesByConnectionId = new Map();
  const remoteSearchFormsByConnectionId = new Map();
  let remoteSearchState = { status: 'idle', connectionId: '', results: [], totalResults: 0, options: {} };
  const remoteSearchExpandedResultPaths = new Set();
  let remoteSearchSelectedResultKeys = new Set();
  let remoteSearchSelectionAnchorKey = '';
  const remoteSearchVisibleLimitsByConnectionId = new Map();
  let remoteSearchRenderTimer = 0;
  const REMOTE_SEARCH_INITIAL_VISIBLE_RESULTS = 2000;
  const REMOTE_SEARCH_SHOW_MORE_STEP = 2000;
  let connectionPanelTransitionTimer = 0;

  restoreNavigationHistoryFromState(initialWebviewState.navigationHistoryByConnectionId);

  const TOOLTIP_SHOW_DELAY_MS = 500;
  const TOOLTIP_TRANSIENT_DURATION_MS = 1500;
  const TOOLTIP_FADE_MS = 80;
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
    if (!webviewTooltip || !target || sessionTabDragging || manageProfileDragging) return;
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
    }, TOOLTIP_SHOW_DELAY_MS);
  }

  function showTransientActionTooltip(target, message = 'Copied', durationMs = TOOLTIP_TRANSIENT_DURATION_MS) {
    if (!webviewTooltip || !target) return;
    const tooltipTarget = target.closest ? (target.closest('.tooltip-anchor') || target) : target;
    if (!tooltipTarget) return;

    if (tooltipTimer) clearTimeout(tooltipTimer);
    activeTooltipTarget = tooltipTarget;
    webviewTooltip.textContent = String(message || 'Copied');
    webviewTooltip.setAttribute('aria-hidden', 'false');
    webviewTooltip.classList.remove('visible');
    webviewTooltip.style.left = '0px';
    webviewTooltip.style.top = '0px';

    positionWebviewTooltip(tooltipTarget, true);
    webviewTooltip.classList.add('visible');

    tooltipTimer = window.setTimeout(() => {
      if (activeTooltipTarget !== tooltipTarget) return;
      hideWebviewTooltip();
    }, Number(durationMs || 0) || TOOLTIP_TRANSIENT_DURATION_MS);
  }

  function getTooltipTarget(eventTarget) {
    if (sessionTabDragging || manageProfileDragging) return null;
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

  window.addEventListener('scroll', () => {
    hideWebviewTooltip();
    if (serverLogShortcutPathPickerOpen) positionServerLogShortcutPathPicker();
  }, true);
  window.addEventListener('resize', () => {
    hideWebviewTooltip();
    hideRemotePathDropdown();
    updateActiveSessionTabDivider();
    if (serverLogShortcutPathPickerOpen) positionServerLogShortcutPathPicker();
  });

  function showInputPromptDialog(payload) {
    if (!inputPromptBackdrop || !inputPromptInput) return;

    inputPromptRequestId = String(payload.requestId || '');
    inputPromptOpen = Boolean(inputPromptRequestId);
    inputPromptPasswordMode = Boolean(payload.password);

    if (inputPromptTitle) inputPromptTitle.textContent = String(payload.title || 'Input');
    if (inputPromptMessage) inputPromptMessage.textContent = String(payload.prompt || '');
    if (inputPromptLabel) inputPromptLabel.textContent = String(payload.label || (inputPromptPasswordMode ? 'Sudo password' : 'Name'));
    if (inputPromptFeedback) inputPromptFeedback.textContent = String(payload.validationMessage || '');

    inputPromptInput.type = inputPromptPasswordMode ? 'password' : 'text';
    inputPromptInput.value = String(payload.value || '');
    inputPromptInput.placeholder = String(payload.placeHolder || '');
    inputPromptInput.classList.toggle('backup-input-invalid', Boolean(payload.validationMessage));

    if (inputPromptInputWrap) {
      inputPromptInputWrap.classList.toggle('reveal-hidden', !inputPromptPasswordMode);
    }
    if (inputPromptRevealButton) {
      inputPromptRevealButton.disabled = !inputPromptPasswordMode;
      inputPromptRevealButton.style.display = inputPromptPasswordMode ? '' : 'none';
    }

    if (inputPromptConfirmButton) inputPromptConfirmButton.textContent = String(payload.confirmLabel || 'OK');
    if (inputPromptCancelButton) inputPromptCancelButton.textContent = String(payload.cancelLabel || 'Cancel');

    inputPromptBackdrop.classList.add('visible');
    inputPromptBackdrop.setAttribute('aria-hidden', 'false');

    setTimeout(() => {
      inputPromptInput.focus();
      const selection = Array.isArray(payload.valueSelection) ? payload.valueSelection : null;
      if (selection && selection.length >= 2) {
        inputPromptInput.setSelectionRange(Number(selection[0]) || 0, Number(selection[1]) || inputPromptInput.value.length);
      } else {
        inputPromptInput.select();
      }
    }, 0);
  }

  function closeInputPromptDialog(confirmed) {
    if (!inputPromptOpen) return;
    const requestId = inputPromptRequestId;
    const value = inputPromptInput ? String(inputPromptInput.value || '') : '';

    inputPromptOpen = false;
    inputPromptRequestId = '';
    inputPromptPasswordMode = false;

    if (inputPromptInput) {
      inputPromptInput.value = '';
      inputPromptInput.type = 'text';
      inputPromptInput.classList.remove('backup-input-invalid');
    }
    if (inputPromptFeedback) inputPromptFeedback.textContent = '';
    if (inputPromptInputWrap) inputPromptInputWrap.classList.add('reveal-hidden');
    if (inputPromptRevealButton) {
      inputPromptRevealButton.disabled = true;
      inputPromptRevealButton.style.display = 'none';
    }
    if (inputPromptBackdrop) {
      inputPromptBackdrop.classList.remove('visible');
      inputPromptBackdrop.setAttribute('aria-hidden', 'true');
    }

    vscode.postMessage({ type: 'inputDialogResponse', payload: { requestId, confirmed: Boolean(confirmed), value: confirmed ? value : '' } });
  }

  function trapInputPromptFocus(event) {
    if (!inputPromptOpen || event.key !== 'Tab') return;
    const focusable = [inputPromptInput, inputPromptRevealButton, inputPromptCancelButton, inputPromptConfirmButton]
      .filter(element => element && !element.hidden && element.style.display !== 'none' && !element.disabled);
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

  function showConfirmDialog(payload) {
    confirmDialogRequestId = String(payload.requestId || '');
    confirmDialogOpen = Boolean(confirmDialogRequestId);

    confirmDialogTitle.textContent = String(payload.title || 'Confirm action');
    confirmDialogMessage.textContent = String(payload.message || 'Confirm this action?');

    const details = String(payload.details || '').trim();
    confirmDialogDetails.textContent = details;
    confirmDialogDetails.hidden = !details;
    if (confirmDialogBody) confirmDialogBody.hidden = !details;

    const hideCancel = Boolean(payload.hideCancel);
    confirmDialogCancelButton.textContent = String(payload.cancelLabel || 'Cancel');
    confirmDialogCancelButton.hidden = hideCancel;
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
    setTimeout(() => (confirmDialogCancelButton.hidden ? confirmDialogConfirmButton : confirmDialogCancelButton).focus(), 0);
  }

  function closeConfirmDialog(confirmed) {
    if (!confirmDialogOpen) return;

    const requestId = confirmDialogRequestId;
    confirmDialogOpen = false;
    confirmDialogRequestId = '';
    confirmDialogBackdrop.classList.remove('visible');
    confirmDialogBackdrop.setAttribute('aria-hidden', 'true');
    confirmDialogCancelButton.hidden = false;
    confirmDialogConfirmButton.classList.remove('danger');

    if (requestId.indexOf('client:closeConnection:') === 0) {
      if (confirmed) {
        const connectionId = requestId.slice('client:closeConnection:'.length);
        disconnectSessionFromTabClose(connectionId);
      }
      return;
    }

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
      case 'persistentStorageSnapshot':
        applyPersistentStorageSnapshot(payload || {});
        break;
      case 'remotePathBreadcrumbSettingsChanged':
        showRemotePathBreadcrumbDirectoryDetails = payload.showDirectoryDetails !== false;
        refreshOpenRemotePathDropdown();
        break;
      case 'fileListSettingsChanged':
        openFileListItemsOnNameClick = payload.openOnNameClick !== false;
        updateFileListNameClickOpenState();
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
        if (previousActiveConnectionId && remoteSearchDialogOpen) saveRemoteSearchFormForConnection(previousActiveConnectionId);
        activeConnectionId = payload.activeConnectionId || '';
        connectionButtonState = '';
        renderSessionTabs();
        if (profileDropdownOpen) renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
        updateActiveSessionUi();
        if (activeConnectionId !== previousActiveConnectionId) restoreFilesStatusForActiveConnection();
        updateConnectionViewUi();
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
        currentEntries = [];
        selectedEntryPath = '';
        filterText = '';
        filterInput.value = '';
        updateFilterClearButton();
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
        entriesBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Connect to a host to list remote files.</div></td></tr>';
        currentPath.value = '';
        exitRemotePathEditMode({ reset: false, keepFocus: true });
        setControls();
        setStatus('No active connection.');
        break;
      }
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
        updateConnectionViewUi();
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
        setStatus(payload.message || '', false, Boolean(payload.showOutputLink), payload.outputLinkText || 'See details in Output.', payload.connectionId || '');
        break;
      case 'serverStatus':
        showServerToolbarStatus(payload.message || '', payload.kind || (payload.isError ? 'error' : 'info'), Number(payload.durationMs || 0));
        break;
      case 'statusCopyFeedback':
        showStatusCopyFeedback(payload.message || 'Copied');
        break;
      case 'busy':
        setBusy(Boolean(payload.isBusy), payload.message || '', payload.cancelAction || (payload.canCancelTransfer ? 'transfer' : ''), payload.cancelLabel || 'Cancel', payload.connectionId || '');
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
    selectProfile(profileSelect.value || '');
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
  if (serverLogShortcutBackdrop) serverLogShortcutBackdrop.addEventListener('mousedown', event => {
    if (event.target === serverLogShortcutBackdrop) hideServerLogShortcutDialog();
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
  if (serverLogShortcutRemoveBackdrop) serverLogShortcutRemoveBackdrop.addEventListener('mousedown', event => {
    if (event.target === serverLogShortcutRemoveBackdrop) hideServerLogShortcutRemoveDialog();
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
  if (serverPortForwardBackdrop) serverPortForwardBackdrop.addEventListener('mousedown', event => {
    if (event.target === serverPortForwardBackdrop) hideServerPortForwardDialog();
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
  if (serverPortForwardRemoveBackdrop) serverPortForwardRemoveBackdrop.addEventListener('mousedown', event => {
    if (event.target === serverPortForwardRemoveBackdrop) hideServerPortForwardRemoveDialog();
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
  if (remoteSearchBackdrop) remoteSearchBackdrop.addEventListener('mousedown', event => { if (event.target === remoteSearchBackdrop) hideRemoteSearchDialog(); });
  uploadButton.addEventListener('click', () => { if (activeConnectionId && canStartTransferAction()) vscode.postMessage({ type: 'requestUploadEntries', payload: { path: currentPath.value || '/' } }); });
  downloadButton.addEventListener('click', () => { const entries = getSelectedActionEntries(); if (entries.length && canStartTransferAction()) vscode.postMessage({ type: 'requestDownloadEntries', payload: { entries: entries.map(actionPayload) } }); });
  transferQueueButton.addEventListener('click', showTransferQueueModal);
  transferQueueFooterCloseButton.addEventListener('click', hideTransferQueueModal);
  transferQueueModal.addEventListener('click', event => { if (event.target === transferQueueModal) hideTransferQueueModal(); });
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
  if (inputPromptBackdrop) {
    inputPromptBackdrop.addEventListener('mousedown', event => {
      if (event.target === inputPromptBackdrop) {
        event.preventDefault();
        if (inputPromptInput) inputPromptInput.focus();
      }
    });
    inputPromptBackdrop.addEventListener('keydown', trapInputPromptFocus);
  }
  transferQueueModal.addEventListener('pointerdown', handleTransferQueueActionPointerDown, true);

  function handleTransferQueueActionPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const button = event.target && event.target.closest ? event.target.closest('[data-transfer-action]') : null;
    if (!button || button.disabled) return;
    const action = button.dataset.transferAction || '';
    const transferId = button.dataset.transferId || '';
    if (!action || !transferId) return;
    event.preventDefault();
    event.stopPropagation();

    if (action === 'cancel-current') {
      requestTransferCancel(transferId);
      return;
    }

    if (action === 'remove-pending') {
      requestQueuedTransferRemoval(transferId);
    }
  }

  function requestTransferCancel(transferId) {
    if (!transferId || transferQueueCancelingIds.has(transferId)) return;
    transferQueueCancelingIds.add(transferId);
    renderTransferQueueModal();
    vscode.postMessage({ type: 'cancelTransfer', payload: { transferId } });
  }

  function requestQueuedTransferRemoval(transferId) {
    if (!transferId || transferQueueRemovingIds.has(transferId)) return;
    transferQueueRemovingIds.add(transferId);
    renderTransferQueueModal();
    vscode.postMessage({ type: 'removeQueuedTransfer', payload: { transferId } });
  }

  statusCancelButton.addEventListener('click', () => {
    if (!statusCancelAction) return;
    const action = statusCancelAction;
    statusCancelButton.disabled = true;
    if (action === 'connection') {
      vscode.postMessage({ type: 'cancelConnection', payload: { connectionId: activeConnectionId } });
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
    if (serverAutoRefreshDropdownOpen && event.target && event.target.closest && !event.target.closest('#serverAutoRefreshPicker')) {
      hideServerAutoRefreshDropdown();
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
    if (event.key === 'Escape' && inputPromptOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeInputPromptDialog(false);
      return;
    }
    if (inputPromptOpen) {
      trapInputPromptFocus(event);
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
    if (event.key === 'Escape' && serverAutoRefreshDropdownOpen) {
      hideServerAutoRefreshDropdown();
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
      if (isOwnerGroupSuggestionsOpen()) {
        event.preventDefault();
        event.stopPropagation();
        hideOwnerGroupSuggestions();
        return;
      }
      hideOwnerGroupDialog();
      return;
    }
    if (event.key === 'Escape' && filePropertiesDialogOpen) {
      hideFilePropertiesDialog();
      return;
    }
    if (event.key === 'Escape' && remoteCommandWorkingDirectoryPickerOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      hideRemoteCommandWorkingDirectoryPicker();
      return;
    }
    if (event.key === 'Escape' && remoteCommandDialogOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      attemptCloseRemoteCommandDialog();
      return;
    }
    if (event.key === 'Escape' && remoteSearchScopePickerOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      hideRemoteSearchScopePicker();
      return;
    }
    if (event.key === 'Escape' && remoteSearchDialogOpen) {
      event.preventDefault();
      event.stopPropagation();
      hideRemoteSearchDialog();
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
    if (activeConnectionId) vscode.postMessage({ type: 'requestCreateFile', payload: { path: getContextWorkingDirectory() } });
  });

  contextCreateDirectory.addEventListener('click', () => {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestCreateDirectory', payload: { path: getContextWorkingDirectory() } });
  });

  function requestContextUpload() {
    hideContextMenu();
    if (activeConnectionId) vscode.postMessage({ type: 'requestUploadEntries', payload: { path: getContextWorkingDirectory() } });
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

  if (remoteSearchContextOpen) remoteSearchContextOpen.addEventListener('click', () => {
    const entry = getRemoteSearchContextEntry();
    hideRemoteSearchResultContextMenu();
    if (entry) vscode.postMessage({ type: 'openEntries', payload: { entries: [entry] } });
  });

  if (remoteSearchContextOpenReadOnly) remoteSearchContextOpenReadOnly.addEventListener('click', () => {
    const entry = getRemoteSearchContextEntry();
    hideRemoteSearchResultContextMenu();
    if (entry) vscode.postMessage({ type: 'openEntriesReadOnly', payload: { entries: [entry] } });
  });

  if (remoteSearchContextCopyPath) remoteSearchContextCopyPath.addEventListener('click', () => {
    const text = formatRemoteSearchSelectedPathsForCopy('path');
    hideRemoteSearchResultContextMenu();
    if (text) vscode.postMessage({ type: 'copyStatus', payload: { text, message: text.indexOf('\\n') >= 0 ? 'Copied paths' : 'Copied path' } });
  });

  if (remoteSearchContextCopyName) remoteSearchContextCopyName.addEventListener('click', () => {
    const text = formatRemoteSearchSelectedPathsForCopy('name');
    hideRemoteSearchResultContextMenu();
    if (text) vscode.postMessage({ type: 'copyStatus', payload: { text, message: text.indexOf('\\n') >= 0 ? 'Copied filenames' : 'Copied filename' } });
  });

  if (remoteSearchContextCopyResults) remoteSearchContextCopyResults.addEventListener('click', () => {
    hideRemoteSearchResultContextMenu();
    copyRemoteSearchResults();
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
    listDirectory(currentPath.value || '/', { forceRefresh: true });
  });

  if (contextOpenLogViewer) contextOpenLogViewer.addEventListener('click', () => {
    const selectedEntries = getSelectedActionEntries();
    const entry = selectedEntries.length === 1 ? selectedEntries[0] : null;
    const path = entry && getEffectiveEntryType(entry) === 'file' ? entry.path : '';
    hideContextMenu();
    if (!activeConnectionId || !getActiveRemoteCapabilities().canRunCommand) return;
    vscode.postMessage({
      type: 'requestOpenLogViewer',
      payload: { connectionId: activeConnectionId, path }
    });
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

  if (openLogViewerButton) openLogViewerButton.addEventListener('click', () => {
    const capabilities = getActiveRemoteCapabilities();
    if (!activeConnectionId || openLogViewerButton.disabled || !capabilities.canOpenSshTerminal) return;
    vscode.postMessage({
      type: 'requestOpenLogViewer',
      payload: { connectionId: activeConnectionId }
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
    if (getCurrentRemoteCommandSession().status === 'running') {
      stopRemoteCommandFromDialog();
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
  remoteCommandStopAndCloseButton.addEventListener('click', () => stopRemoteCommandFromDialog());
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
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running') {
      state.command = String(remoteCommandInput.value || '');
      updateRemoteCommandControls();
    }
  });

  remoteCommandWorkingDirectory.addEventListener('input', () => {
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running') {
      state.workingDirectory = normalizeUiRemotePath(remoteCommandWorkingDirectory.value || '/');
      updateRemoteCommandControls();
    }
  });
  remoteCommandUseSudo.addEventListener('change', () => {
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running') {
      state.useSudo = collectRemoteCommandUseSudo();
      updateRemoteCommandRunAs();
    }
  });
  remoteCommandBrowseWorkingDirectoryButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); browseRemoteCommandWorkingDirectory(); });
  if (remoteCommandWorkingDirectoryPicker) {
    remoteCommandWorkingDirectoryPicker.addEventListener('mousedown', event => event.stopPropagation());
    remoteCommandWorkingDirectoryPicker.addEventListener('click', event => event.stopPropagation());
  }
  remoteCommandWorkingDirectorySelectButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); selectRemoteCommandWorkingDirectoryPickerPath(); });
  remoteCommandWorkingDirectoryCancelButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); hideRemoteCommandWorkingDirectoryPicker(); });
  remoteCommandWorkingDirectoryPickerList.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const item = event.target.closest('[data-remote-command-working-directory-path]');
    if (!item) return;
    const path = item.getAttribute('data-remote-command-working-directory-path') || '/';
    requestRemoteCommandWorkingDirectoryEntries(path);
  });
  remoteCommandSaveCurrentButton.addEventListener('click', () => {
    if (getCurrentRemoteCommandSession().status === 'running') return;
    remoteCommandEditingSavedId = '__new__';
    remoteCommandDeletingSavedId = '';
    renderRemoteCommandSavedList();
  });
  remoteCommandSavedList.addEventListener('click', event => {
    const editButton = event.target.closest('[data-remote-command-edit-action]');
    if (editButton) {
      const form = editButton.closest('.remote-command-edit-form');
      const action = editButton.getAttribute('data-remote-command-edit-action');
      if (action === 'cancel') {
        remoteCommandEditingSavedId = '';
        remoteCommandDeletingSavedId = '';
        renderRemoteCommandSavedList();
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const actionButton = event.target.closest('[data-remote-command-action]');
    const card = event.target.closest('[data-remote-command-saved-id]');
    if (!card) return;
    const id = card.getAttribute('data-remote-command-saved-id') || '';
    const item = getRemoteCommandSavedList(remoteCommandDialogConnectionId || activeConnectionId).find(command => command.id === id);
    if (!item) return;
    if (actionButton) {
      const action = actionButton.getAttribute('data-remote-command-action');
      if (action === 'append') loadRemoteCommandIntoEditor(item, true);
      if (action === 'edit') {
        remoteCommandEditingSavedId = id;
        remoteCommandDeletingSavedId = '';
        renderRemoteCommandSavedList();
      }
      if (action === 'delete') {
        remoteCommandDeletingSavedId = id;
        remoteCommandEditingSavedId = '';
        renderRemoteCommandSavedList();
      }
      if (action === 'cancel-delete') {
        remoteCommandDeletingSavedId = '';
        renderRemoteCommandSavedList();
      }
      if (action === 'confirm-delete') deleteRemoteCommandSaved(id);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    loadRemoteCommandIntoEditor(item, false);
  });
  remoteCommandSavedList.addEventListener('submit', event => {
    const form = event.target.closest('.remote-command-edit-form');
    if (!form) return;
    event.preventDefault();
    saveRemoteCommandEditForm(form);
  });
  remoteCommandHistoryList.addEventListener('click', event => {
    const card = event.target.closest('[data-remote-command-history-id]');
    if (!card) return;
    const id = card.getAttribute('data-remote-command-history-id') || '';
    const item = getRemoteCommandHistoryList(remoteCommandDialogConnectionId || activeConnectionId).find(command => command.id === id);
    if (!item) return;
    const actionButton = event.target.closest('[data-remote-command-action]');
    if (actionButton && actionButton.getAttribute('data-remote-command-action') === 'save-history') {
      saveHistoryItemAsSavedCommand(item);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    loadRemoteCommandIntoEditor(item, false);
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

  ownerGroupOwnerInput.addEventListener('input', () => {
    updateOwnerGroupApplyState();
    renderOwnerGroupSuggestions('owner');
  });
  ownerGroupGroupInput.addEventListener('input', () => {
    updateOwnerGroupApplyState();
    renderOwnerGroupSuggestions('group');
  });
  ownerGroupOwnerInput.addEventListener('focus', () => showOwnerGroupSuggestions('owner'));
  ownerGroupGroupInput.addEventListener('focus', () => showOwnerGroupSuggestions('group'));
  ownerGroupOwnerSuggestions.addEventListener('mousedown', event => event.preventDefault());
  ownerGroupGroupSuggestions.addEventListener('mousedown', event => event.preventDefault());
  ownerGroupOwnerSuggestions.addEventListener('click', event => handleOwnerGroupSuggestionClick(event, 'owner'));
  ownerGroupGroupSuggestions.addEventListener('click', event => handleOwnerGroupSuggestionClick(event, 'group'));
  ownerGroupRecursiveInput.addEventListener('change', updateOwnerGroupApplyState);
  ownerGroupCancelButton.addEventListener('click', hideOwnerGroupDialog);
  ownerGroupApplyButton.addEventListener('click', applyOwnerGroupDialog);
  document.addEventListener('mousedown', event => {
    if (!ownerGroupDialogOpen || !isOwnerGroupSuggestionsOpen()) return;
    const target = event.target && event.target.closest ? event.target.closest('.owner-group-combo, .owner-group-suggestions') : null;
    if (!target) hideOwnerGroupSuggestions();
  });

  ownerGroupBackdrop.addEventListener('mousedown', event => {
    if (event.target === ownerGroupBackdrop) {
      hideOwnerGroupDialog();
    }
  });
  window.addEventListener('resize', scheduleOwnerGroupSuggestionsPosition);
  window.addEventListener('scroll', scheduleOwnerGroupSuggestionsPosition, true);

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
  bindTemporaryPasswordReveal(inputPromptRevealButton, inputPromptInput);

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
  manageProfilesList.addEventListener('dragover', handleManageProfilesDragOver);
  manageProfilesList.addEventListener('drop', handleManageProfilesDrop);
  document.addEventListener('dragover', handleManageProfilesDragOver);
  document.addEventListener('drop', handleManageProfilesDrop);

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

  let activeTextEditTarget = null;

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

  function updateFileListNameClickOpenState() {
    if (!entriesTableWrap) return;
    entriesTableWrap.classList.toggle('name-click-open-enabled', openFileListItemsOnNameClick);
  }

  applyColumnWidths();
  updateSortIndicators();
  updateFileListNameClickOpenState();

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
    const pathbarViewSwitch = pathbar ? pathbar.querySelector('.pathbar-view-switch') : null;
    const viewSwitchSeparator = pathbar ? pathbar.querySelector('.view-switch-separator') : null;
    return [
      remotePathBox,
      filterBox,
      serverRefreshActions,
      serverRefreshActionsSeparator,
      commandActionsSeparator,
      commandActions,
      transferActionsSeparator,
      transferActions,
      sudoToggleSeparator,
      sudoToggleLabel,
      viewSwitchSeparator,
      pathbarViewSwitch
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
    connectionRail.style.top = Math.max(6, Math.round(layoutRect.top + 8)) + 'px';
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
    profileSelect.innerHTML = '<option value="">New / Quick Connection</option>';

    for (const profile of profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      profileSelect.appendChild(option);
    }

    const wasProfileDropdownOpen = profileDropdownOpen;
    const exists = profiles.some(profile => profile.id === previousId);
    const nextId = exists ? previousId : '';
    selectProfile(nextId, { preserveStatus: true, keepDropdownOpen: wasProfileDropdownOpen });
    renderProfileDropdown({ preserveFilter: wasProfileDropdownOpen, preserveScroll: wasProfileDropdownOpen });
    renderManageProfilesList();
    setControls();
  }

  function selectProfile(profileId, options = {}) {
    selectedProfileId = profileId || '';
    profileSelect.value = selectedProfileId;
    if (!options.keepDropdownOpen) hideProfileDropdown();

    const profile = selectedProfileId ? profiles.find(item => item.id === selectedProfileId) : undefined;
    if (profile) {
      fillForm(profile);
    } else {
      clearForm();
      if (!options.preserveStatus) setStatus('New quick connection.');
    }

    updateProfileDropdownLabel();
    renderProfileDropdown({ preserveFilter: options.keepDropdownOpen, preserveScroll: options.keepDropdownOpen });
    setControls();
  }

  function updateProfileDropdownLabel() {
    const profile = selectedProfileId ? profiles.find(item => item.id === selectedProfileId) : undefined;
    profileDropdownLabel.textContent = profile ? profile.name : 'New / Quick Connection';
    profileDropdownButton.setAttribute('data-tooltip', profile ? formatProfileTarget(profile) : 'Use the form below');
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
    const currentList = profileDropdownMenu.querySelector ? profileDropdownMenu.querySelector('.profile-dropdown-list') : null;
    const previousListScrollTop = options.preserveScroll && currentList ? currentList.scrollTop : 0;
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

    const pinnedWrap = document.createElement('div');
    pinnedWrap.className = 'profile-dropdown-pinned';
    const quick = buildProfileDropdownItem('', 'New / Quick Connection', 'Use the form below', { suppressSelectedVisual: true });
    pinnedWrap.appendChild(quick);

    if (profiles.length) {
      const separator = document.createElement('div');
      separator.className = 'profile-dropdown-separator';
      pinnedWrap.appendChild(separator);
    }
    profileDropdownMenu.appendChild(pinnedWrap);

    const listWrap = document.createElement('div');
    listWrap.className = 'profile-dropdown-list';
    profileDropdownMenu.appendChild(listWrap);

    const filteredProfiles = profiles.filter(profile => profileMatchesFilter(profile, filterTextBeforeRender));
    if (profiles.length && !filteredProfiles.length) {
      const empty = document.createElement('div');
      empty.className = 'profile-dropdown-empty';
      empty.textContent = 'No saved connections found.';
      listWrap.appendChild(empty);
    } else {
      for (const profile of filteredProfiles) {
        listWrap.appendChild(buildProfileDropdownItem(profile.id, profile.name, formatProfileTarget(profile)));
      }
    }

    updateProfileDropdownLabel();

    if (options.preserveScroll && previousListScrollTop) {
      requestAnimationFrame(() => {
        const nextList = profileDropdownMenu.querySelector ? profileDropdownMenu.querySelector('.profile-dropdown-list') : null;
        if (nextList) nextList.scrollTop = previousListScrollTop;
      });
    }

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

  function buildProfileDropdownItem(id, name, meta, options = {}) {
    const profileId = String(id || '');
    const isSelected = profileId === selectedProfileId;
    const showSelectedVisual = isSelected && !options.suppressSelectedVisual;
    const item = document.createElement('div');
    item.className = 'profile-dropdown-item' + (showSelectedVisual ? ' selected' : '');
    item.dataset.profileId = profileId;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(isSelected));
    item.tabIndex = 0;

    const main = document.createElement('span');
    main.className = 'profile-dropdown-main';

    const nameRow = document.createElement('span');
    nameRow.className = 'profile-dropdown-name-row';

    const connectedSession = profileId ? getConnectedSessionForProfileId(profileId) : null;
    const pendingSession = profileId ? getPendingSessionForProfileId(profileId) : null;
    const disconnecting = profileId ? profileDisconnectingIds.has(profileId) : false;
    const isConnected = Boolean(connectedSession);
    const isBusy = Boolean(pendingSession) || disconnecting;

    const nameElement = document.createElement('span');
    nameElement.className = 'profile-dropdown-name' + (isConnected ? ' connected' : '');
    nameElement.textContent = name || 'Unnamed connection';
    nameRow.appendChild(nameElement);
    main.appendChild(nameRow);

    if (meta) {
      const metaElement = document.createElement('span');
      metaElement.className = 'profile-dropdown-meta';
      metaElement.textContent = meta;
      main.appendChild(metaElement);
    }

    item.appendChild(main);

    if (profileId) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'profile-dropdown-action' + (isConnected ? ' connected' : '') + (isBusy ? ' busy' : '');
      action.dataset.profileAction = isConnected ? 'disconnect' : 'connect';
      action.dataset.profileActionId = profileId;
      action.disabled = isBusy;
      action.setAttribute('aria-label', (isConnected ? 'Disconnect ' : 'Connect ') + (name || 'connection'));

      action.setAttribute('data-tooltip', disconnecting ? 'Disconnecting' : (pendingSession ? 'Connecting' : (isConnected ? 'Disconnect' : 'Connect')));

      const spinner = document.createElement('span');
      spinner.className = 'profile-dropdown-action-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      action.appendChild(spinner);

      if (!isBusy) {
        const icon = document.createElement('span');
        icon.className = 'profile-dropdown-action-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = isConnected ? PROFILE_ACTION_DISCONNECT_ICON : PROFILE_ACTION_CONNECT_ICON;
        action.appendChild(icon);
      }
      item.appendChild(action);
    }

    item.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectProfile(profileId);
      hideProfileDropdown();
    });

    return item;
  }

  function toggleProfileDropdown() {
    if (!profileDropdownButton) return;
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

  function updateActiveSessionTabDivider() {
    if (!browserSectionDivider || !sessionTabs) return;
    const activeTab = sessionTabs.querySelector('.session-tab.active');
    if (!activeTab) {
      browserSectionDivider.style.setProperty('--active-tab-left', '0px');
      browserSectionDivider.style.setProperty('--active-tab-width', '0px');
      return;
    }
    const tabRect = activeTab.getBoundingClientRect();
    const dividerRect = browserSectionDivider.getBoundingClientRect();
    const left = Math.max(0, Math.round(tabRect.left - dividerRect.left));
    const width = Math.max(0, Math.round(tabRect.width));
    const gapLeft = left + 1;
    const gapWidth = Math.max(0, width - 2);
    browserSectionDivider.style.setProperty('--active-tab-left', gapLeft + 'px');
    browserSectionDivider.style.setProperty('--active-tab-width', gapWidth + 'px');
  }

  function getSessionTabOrder() {
    return sessions.map(session => session.id).filter(Boolean);
  }

  function ensureSessionTabDropLine() {
    if (!sessionTabs) return null;
    let line = sessionTabs.querySelector('.session-tab-drop-line');
    if (!line) {
      line = document.createElement('div');
      line.className = 'session-tab-drop-line';
      line.setAttribute('aria-hidden', 'true');
      sessionTabs.appendChild(line);
    }
    return line;
  }

  function hideSessionTabDropLine() {
    if (!sessionTabs) return;
    const line = sessionTabs.querySelector('.session-tab-drop-line');
    if (line) {
      line.style.display = 'none';
      line.style.left = '';
    }
  }

  function clearSessionTabDragState() {
    draggedSessionId = '';
    sessionDragOverId = '';
    sessionDragOverPosition = '';
    sessionDragDropIndex = -1;
    sessionTabDragging = false;
    if (!sessionTabs) return;
    for (const tab of Array.from(sessionTabs.querySelectorAll('.session-tab'))) {
      tab.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
    }
    hideSessionTabDropLine();
  }

  function getSessionTabButtons() {
    if (!sessionTabs) return [];
    return Array.from(sessionTabs.querySelectorAll('.session-tab[data-session-id]'));
  }

  function getSessionTabDropZoneRect() {
    if (!sessionTabs) return null;
    const zone = sessionTabs.closest('.browser-open-section') || sessionTabs.closest('.open-connections-row') || sessionTabs;
    return zone.getBoundingClientRect();
  }

  function getSessionDropIndex(event) {
    const tabs = getSessionTabButtons();
    if (!tabs.length || !sessionTabs) return -1;

    const zoneRect = getSessionTabDropZoneRect();
    if (zoneRect) {
      const verticalPadding = 12;
      const horizontalPadding = 24;
      const insideZone = event.clientX >= zoneRect.left - horizontalPadding && event.clientX <= zoneRect.right + horizontalPadding && event.clientY >= zoneRect.top - verticalPadding && event.clientY <= zoneRect.bottom + verticalPadding;
      if (!insideZone) return -1;
    }

    const firstRect = tabs[0].getBoundingClientRect();
    const lastRect = tabs[tabs.length - 1].getBoundingClientRect();
    if (event.clientX <= firstRect.left) return 0;
    if (event.clientX >= lastRect.right) return tabs.length;

    for (let index = 0; index < tabs.length; index += 1) {
      const rect = tabs[index].getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      if (event.clientX < centerX) return index;
    }
    return tabs.length;
  }

  function showSessionTabDropLine(insertionIndex) {
    const tabs = getSessionTabButtons();
    if (!sessionTabs || !tabs.length || insertionIndex < 0) return;
    const line = ensureSessionTabDropLine();
    if (!line) return;

    const clampedIndex = Math.max(0, Math.min(insertionIndex, tabs.length));
    let left = 0;
    if (clampedIndex <= 0) {
      left = tabs[0].offsetLeft;
    } else if (clampedIndex >= tabs.length) {
      const lastTab = tabs[tabs.length - 1];
      left = lastTab.offsetLeft + lastTab.offsetWidth;
    } else {
      const previousTab = tabs[clampedIndex - 1];
      const nextTab = tabs[clampedIndex];
      left = ((previousTab.offsetLeft + previousTab.offsetWidth) + nextTab.offsetLeft) / 2;
    }

    const maxLeft = Math.max(0, sessionTabs.scrollWidth - 1);
    line.style.left = Math.max(0, Math.min(Math.round(left), maxLeft)) + 'px';
    line.style.display = 'block';
  }

  function setSessionTabDropIndicator(insertionIndex) {
    if (insertionIndex < 0) {
      sessionDragDropIndex = -1;
      hideSessionTabDropLine();
      return;
    }
    if (sessionDragDropIndex !== insertionIndex) {
      sessionDragOverId = '';
      sessionDragOverPosition = '';
      sessionDragDropIndex = insertionIndex;
    }
    showSessionTabDropLine(insertionIndex);
  }

  function reorderSessionTabsByIndex(draggedId, insertionIndex) {
    if (!draggedId || insertionIndex < 0) return;
    const orderedIds = getSessionTabOrder();
    const fromIndex = orderedIds.indexOf(draggedId);
    if (fromIndex < 0) return;

    const clampedIndex = Math.max(0, Math.min(insertionIndex, orderedIds.length));
    orderedIds.splice(fromIndex, 1);
    let insertIndex = clampedIndex;
    if (fromIndex < clampedIndex) insertIndex -= 1;
    insertIndex = Math.max(0, Math.min(insertIndex, orderedIds.length));
    orderedIds.splice(insertIndex, 0, draggedId);

    const currentOrder = getSessionTabOrder();
    if (orderedIds.length === currentOrder.length && orderedIds.every((id, index) => id === currentOrder[index])) {
      return;
    }

    const sessionById = new Map(sessions.map(session => [session.id, session]));
    sessions = orderedIds.map(id => sessionById.get(id)).filter(Boolean);
    renderSessionTabs();
    vscode.postMessage({ type: 'reorderSessions', payload: { connectionIds: orderedIds } });
  }

  function getSessionDropPosition(event, tab) {
    const rect = tab.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  }

  function reorderSessionTabs(draggedId, targetId, position) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const orderedIds = getSessionTabOrder();
    const targetIndex = orderedIds.indexOf(targetId);
    if (targetIndex < 0) return;
    reorderSessionTabsByIndex(draggedId, position === 'after' ? targetIndex + 1 : targetIndex);
  }

  function activateClientSession(connectionId) {
    const sessionId = String(connectionId || '').trim();
    const session = sessions.find(item => item.id === sessionId);
    if (!session) return;

    activeConnectionId = sessionId;
    renderSessionTabs();
    updateActiveSessionUi();
    updateConnectionViewUi();
    restoreFilesStatusForActiveConnection();
    setControls();

    if (isSessionConnected(session)) {
      setBusy(true, 'Switching to ' + session.name + '...', '', 'Cancel', session.id);
      vscode.postMessage({ type: 'switchSession', payload: { connectionId: session.id } });
      return;
    }

    currentEntries = [];
    currentPath.value = session.currentPath || session.startPath || '/';
    const message = isSessionFailed(session) ? (session.error || 'Connection failed.') : 'Connecting...';
    entriesBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">' + escapeHtml(message) + '</div></td></tr>';
  }

  function getSessionCloseDisplayName(session) {
    const rawName = session && (session.name || session.host || session.id);
    const name = String(rawName || 'this connection').trim();
    return name || 'this connection';
  }

  function disconnectSessionFromTabClose(connectionId) {
    const sessionId = String(connectionId || '');
    if (!sessionId || connectionButtonState === 'disconnecting') return;
    const session = sessions.find(item => item.id === sessionId);
    if (!session) return;
    connectionButtonState = 'disconnecting';
    setBusy(true, 'Disconnecting...');
    vscode.postMessage({ type: 'disconnect', payload: { connectionId: sessionId } });
  }

  function requestCloseSessionFromTab(session) {
    if (!session || !session.id || connectionButtonState === 'disconnecting') return;
    if (!isSessionConnected(session)) {
      removeClientPendingSession(session.id);
      return;
    }
    showConfirmDialog({
      requestId: 'client:closeConnection:' + session.id,
      title: 'Close connection?',
      message: 'This will disconnect "' + getSessionCloseDisplayName(session) + '" and stop any active Remote Edit operations for this connection.',
      cancelLabel: 'Cancel',
      confirmLabel: 'Disconnect'
    });
  }

  function renderSessionTabs() {
    if (!sessions.length) {
      sessionTabs.classList.add('empty');
      sessionTabs.innerHTML = '';
      updateActiveSessionTabDivider();
      return;
    }

    sessionTabs.classList.remove('empty');
    sessionTabs.innerHTML = '';

    for (const session of sessions) {
      const tab = document.createElement('button');
      const tabStateClass = isSessionConnecting(session) ? ' connecting' : (isSessionFailed(session) ? ' failed' : '');
      const tabIcon = isSessionConnecting(session) ? SESSION_TAB_CONNECTING_ICON : (isSessionFailed(session) ? SESSION_TAB_ERROR_ICON : SESSION_TAB_REMOTE_ICON);
      tab.className = 'session-tab has-tooltip tooltip-above' + tabStateClass + (session.id === activeConnectionId ? ' active' : '');
      tab.dataset.sessionId = session.id || '';
      tab.dataset.tooltip = formatSessionTooltipTarget(session);
      tab.draggable = true;
      tab.innerHTML = '<span class="session-icon" aria-hidden="true">' + tabIcon + '</span><span class="session-name">' + escapeHtml(session.name) + '</span><span class="session-close has-tooltip tooltip-above" data-tooltip="Disconnect"></span>';
      tab.addEventListener('click', () => {
        if (session.id === activeConnectionId) {
          if (isSessionConnected(session)) syncConnectionFormWithActiveSession({ preserveStatus: true });
          return;
        }
        activateClientSession(session.id);
      });

      tab.addEventListener('dragstart', event => {
        if (event.target && event.target.closest && event.target.closest('.session-close')) {
          event.preventDefault();
          return;
        }
        draggedSessionId = session.id || '';
        sessionDragOverId = '';
        sessionDragOverPosition = '';
        sessionTabDragging = true;
        hideWebviewTooltip();
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', draggedSessionId);
        }
        tab.classList.add('dragging');
      });

      tab.addEventListener('dragend', clearSessionTabDragState);

      const close = tab.querySelector('.session-close');
      close.addEventListener('pointerdown', event => { event.stopPropagation(); });
      close.addEventListener('dragstart', event => { event.preventDefault(); event.stopPropagation(); });
      close.addEventListener('click', event => {
        event.stopPropagation();
        requestCloseSessionFromTab(session);
      });

      sessionTabs.appendChild(tab);
    }
    updateActiveSessionTabDivider();
  }

  function handleSessionTabsDragOver(event) {
    if (!draggedSessionId) return;
    const insertionIndex = getSessionDropIndex(event);
    if (insertionIndex < 0) {
      setSessionTabDropIndicator(-1);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setSessionTabDropIndicator(insertionIndex);
  }

  function handleSessionTabsDrop(event) {
    if (!draggedSessionId) return;
    const insertionIndex = getSessionDropIndex(event);
    if (insertionIndex < 0) return;
    event.preventDefault();
    const droppedSessionId = draggedSessionId;
    clearSessionTabDragState();
    reorderSessionTabsByIndex(droppedSessionId, insertionIndex);
  }

  function handleSessionTabsDragLeave(event) {
    if (!draggedSessionId || !sessionTabs) return;
    const zone = sessionTabs.closest('.browser-open-section') || sessionTabs.closest('.open-connections-row') || sessionTabs;
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && zone.contains(relatedTarget)) return;
    hideSessionTabDropLine();
  }

  if (sessionTabs) {
    sessionTabs.addEventListener('scroll', () => {
      updateActiveSessionTabDivider();
      if (sessionDragDropIndex >= 0) showSessionTabDropLine(sessionDragDropIndex);
    });
    const sessionDropZone = sessionTabs.closest('.browser-open-section') || sessionTabs.closest('.open-connections-row') || sessionTabs;
    sessionDropZone.addEventListener('dragover', handleSessionTabsDragOver);
    sessionDropZone.addEventListener('drop', handleSessionTabsDrop);
    sessionDropZone.addEventListener('dragleave', handleSessionTabsDragLeave);
  }

  function getConnectionViewStorageKey() {
    return activeConnectionId || '__default__';
  }

  function isServerViewSupported(session) {
    return Boolean(session && normalizeConnectionTypeValue(session.connectionType) === 'sftp' && getActiveRemoteCapabilities().canRunCommand);
  }

  function getActiveConnectionView() {
    if (!activeConnectionId) return 'files';
    const active = getActiveSession();
    const saved = activeConnectionViewsByConnectionId.get(getConnectionViewStorageKey()) || 'files';
    if (saved === 'server' && !isServerViewSupported(active)) return 'files';
    return saved === 'server' ? 'server' : 'files';
  }

  function setActiveConnectionView(view) {
    const nextView = view === 'server' ? 'server' : 'files';
    const active = getActiveSession();
    if (nextView === 'server' && !isServerViewSupported(active)) {
      activeConnectionViewsByConnectionId.set(getConnectionViewStorageKey(), 'files');
    } else if (activeConnectionId) {
      activeConnectionViewsByConnectionId.set(getConnectionViewStorageKey(), nextView);
    }
    const toolbarLayoutSnapshot = prepareToolbarLayoutTransition();
    updateConnectionViewUi();
    setControls({ animateToolbarLayout: false });
    finishToolbarLayoutTransition(toolbarLayoutSnapshot);
    maybeRequestServerDashboardForActiveView();
    updateServerAutoRefreshTimer();
  }

  function pruneConnectionViewState() {
    const activeIds = new Set(sessions.map(session => session.id).filter(Boolean));
    for (const key of Array.from(activeConnectionViewsByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) activeConnectionViewsByConnectionId.delete(key);
    }
    for (const key of Array.from(serverDashboardStatesByConnectionId.keys())) {
      if (!activeIds.has(key)) serverDashboardStatesByConnectionId.delete(key);
    }
    for (const key of Array.from(serverServiceFiltersByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) serverServiceFiltersByConnectionId.delete(key);
    }
    for (const key of Array.from(serverQuickTaskFiltersByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) serverQuickTaskFiltersByConnectionId.delete(key);
    }
    for (const key of Array.from(serverProcessFiltersByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) serverProcessFiltersByConnectionId.delete(key);
    }
    for (const key of Array.from(serverProcessActionStatesByConnectionId.keys())) {
      if (!activeIds.has(key)) serverProcessActionStatesByConnectionId.delete(key);
    }
    for (const key of Array.from(serverLogShortcutFiltersByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) serverLogShortcutFiltersByConnectionId.delete(key);
    }
    for (const key of Array.from(serverPortForwardFiltersByConnectionId.keys())) {
      if (key !== '__default__' && !activeIds.has(key)) serverPortForwardFiltersByConnectionId.delete(key);
    }
    for (const key of Array.from(serverCardSortsByConnectionId.keys())) {
      const separatorIndex = String(key).indexOf('::');
      const connectionId = separatorIndex >= 0 ? String(key).slice(0, separatorIndex) : String(key);
      if (connectionId !== '__default__' && !activeIds.has(connectionId)) serverCardSortsByConnectionId.delete(key);
    }
    for (const key of Array.from(serverPortForwardRuntimeByConnectionId.keys())) {
      if (!activeIds.has(key)) serverPortForwardRuntimeByConnectionId.delete(key);
    }
  }

  function formatServerAdapterLabel(session) {
    if (!session) return 'unknown';
    const protocol = normalizeConnectionTypeValue(session.connectionType);
    if (protocol !== 'sftp') return protocol;
    return 'ssh/sftp';
  }

  function formatServerSudoLabel(session) {
    if (!session || normalizeConnectionTypeValue(session.connectionType) !== 'sftp') return 'Sudo unavailable';
    if (String(session.username || '').trim().toLowerCase() === 'root') return 'Root user';
    return session.sudoModeEnabled ? 'Sudo enabled' : 'Sudo disabled';
  }

  function formatServerTarget(session) {
    if (!session) return '';
    const user = String(session.username || '').trim();
    const hostValue = String(session.host || '').trim();
    if (user && hostValue) return user + '@' + hostValue;
    return user || hostValue || 'Remote host';
  }

  function createServerLogShortcutId() {
    return 'log-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function createServerLogShortcut(name, path) {
    const normalizedPath = normalizeUiRemotePath(path || '/');
    const normalizedName = String(name || '').trim() || getRemotePathBasename(normalizedPath);
    return {
      id: createServerLogShortcutId(),
      name: normalizedName,
      path: normalizedPath
    };
  }

  function getServerInfoValue(label) {
    const state = getActiveServerDashboardState();
    const items = state && state.data && Array.isArray(state.data.systemInfo) ? state.data.systemInfo : [];
    const target = String(label || '').toLowerCase();
    const item = items.find(info => String(info.label || '').toLowerCase() === target);
    return String((item && item.value) || '').trim();
  }

  function getDefaultServerLogShortcuts(session) {
    const protocol = normalizeConnectionTypeValue(session && session.connectionType);
    if (protocol !== 'sftp') return [];

    const osName = getServerInfoValue('OS').toLowerCase();
    const adapter = getServerInfoValue('Adapter').toLowerCase();
    if (osName === 'aix' || adapter.indexOf('aix') !== -1 || adapter === 'generic-unix') {
      return [
        createServerLogShortcut('AIX messages', '/var/adm/messages'),
        createServerLogShortcut('Messages', '/var/log/messages')
      ];
    }

    return [
      createServerLogShortcut('System log', '/var/log/syslog'),
      createServerLogShortcut('Messages', '/var/log/messages'),
      createServerLogShortcut('Nginx error', '/var/log/nginx/error.log'),
      createServerLogShortcut('Nginx access', '/var/log/nginx/access.log'),
      createServerLogShortcut('Apache error', '/var/log/httpd/error_log'),
      createServerLogShortcut('Apache2 error', '/var/log/apache2/error.log')
    ];
  }

  function sanitizeServerLogShortcut(item) {
    const path = normalizeUiRemotePath(item && item.path ? item.path : '');
    if (!path || path === '/') return null;
    const name = String(item && item.name ? item.name : '').trim() || getRemotePathBasename(path);
    return {
      id: String(item && item.id ? item.id : createServerLogShortcutId()).trim() || createServerLogShortcutId(),
      name: name,
      path: path
    };
  }

  function readServerLogShortcutsStorage() {
    try {
      const raw = localStorage.getItem(SERVER_LOG_SHORTCUTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeServerLogShortcutsStorage(storage) {
    try {
      localStorage.setItem(SERVER_LOG_SHORTCUTS_STORAGE_KEY, JSON.stringify(storage || {}));
      postPersistentStorageSnapshot();
    } catch (_) {
      // Ignore storage quota or disabled storage errors.
    }
  }

  function isServerLogShortcutsPersistent(session) {
    if (!session || session.isQuickConnect === true) return false;
    if (session.isQuickConnect === false) return true;
    return profiles.some(profile => profile.id === session.id);
  }

  function hasServerDashboardDataForLogDefaults() {
    const state = getActiveServerDashboardState();
    return Boolean(state && state.data);
  }

  function getServerLogShortcuts(session) {
    if (!session) return [];
    const connectionId = String(session.id || '').trim();
    if (!connectionId) return [];

    if (isServerLogShortcutsPersistent(session)) {
      const storage = readServerLogShortcutsStorage();
      if (Array.isArray(storage[connectionId])) {
        return storage[connectionId].map(sanitizeServerLogShortcut).filter(Boolean);
      }
      if (!hasServerDashboardDataForLogDefaults()) {
        return [];
      }
      const defaults = getDefaultServerLogShortcuts(session);
      storage[connectionId] = defaults;
      writeServerLogShortcutsStorage(storage);
      return defaults;
    }

    if (serverLogShortcutsSessionByConnectionId.has(connectionId)) {
      return (serverLogShortcutsSessionByConnectionId.get(connectionId) || []).map(sanitizeServerLogShortcut).filter(Boolean);
    }

    if (!hasServerDashboardDataForLogDefaults()) {
      return [];
    }

    const defaults = getDefaultServerLogShortcuts(session);
    serverLogShortcutsSessionByConnectionId.set(connectionId, defaults);
    return defaults;
  }

  function saveServerLogShortcuts(session, shortcuts) {
    if (!session) return;
    const connectionId = String(session.id || '').trim();
    if (!connectionId) return;
    const normalized = (Array.isArray(shortcuts) ? shortcuts : []).map(sanitizeServerLogShortcut).filter(Boolean);

    if (isServerLogShortcutsPersistent(session)) {
      const storage = readServerLogShortcutsStorage();
      storage[connectionId] = normalized;
      writeServerLogShortcutsStorage(storage);
      return;
    }

    serverLogShortcutsSessionByConnectionId.set(connectionId, normalized);
  }

  function getServerLogShortcutById(session, shortcutId) {
    const id = String(shortcutId || '').trim();
    return getServerLogShortcuts(session).find(shortcut => shortcut.id === id) || null;
  }

  function getRemotePathDirname(path) {
    const normalized = normalizeUiRemotePath(path || '/');
    if (normalized === '/') return '/';
    const trimmed = normalized.replace(new RegExp('/+$'), '');
    const index = trimmed.lastIndexOf('/');
    return index <= 0 ? '/' : trimmed.slice(0, index);
  }

  function getServerLogShortcutInitialPickerPath() {
    const typedPath = normalizeUiRemotePath(serverLogShortcutPathInput && serverLogShortcutPathInput.value ? serverLogShortcutPathInput.value : '');
    if (typedPath && typedPath !== '/') {
      return getRemotePathDirname(typedPath);
    }
    const state = getActiveServerDashboardState();
    const info = state && state.data && Array.isArray(state.data.systemInfo) ? state.data.systemInfo : [];
    const osName = String(((info.find(item => item && item.label === 'OS') || {}).value || '')).toLowerCase();
    return osName === 'aix' ? '/var/adm' : '/var/log';
  }

  function ensureServerLogShortcutPathPickerPortal() {
    if (!serverLogShortcutPathPicker || serverLogShortcutPathPicker.parentElement === document.body) return;
    document.body.appendChild(serverLogShortcutPathPicker);
  }

  function positionServerLogShortcutPathPicker() {
    if (!serverLogShortcutPathPickerOpen || !serverLogShortcutPathPicker || !serverLogShortcutPathInput) return;
    ensureServerLogShortcutPathPickerPortal();

    const rect = serverLogShortcutPathInput.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const margin = 8;
    const gap = 4;
    const width = Math.max(240, Math.min(rect.width, viewportWidth - (margin * 2)));
    const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
    const below = Math.max(0, viewportHeight - rect.bottom - margin - gap);
    const above = Math.max(0, rect.top - margin - gap);
    const openAbove = below < 180 && above > below;
    const available = Math.max(120, openAbove ? above : below);
    const maxHeight = Math.min(280, Math.max(120, available));

    serverLogShortcutPathPicker.style.left = Math.round(left) + 'px';
    serverLogShortcutPathPicker.style.right = 'auto';
    serverLogShortcutPathPicker.style.bottom = 'auto';
    serverLogShortcutPathPicker.style.width = Math.round(width) + 'px';
    serverLogShortcutPathPicker.style.maxHeight = Math.round(maxHeight) + 'px';

    if (serverLogShortcutPathPickerList) {
      serverLogShortcutPathPickerList.style.maxHeight = Math.max(80, Math.round(maxHeight - 38)) + 'px';
    }

    const measuredHeight = Math.min(serverLogShortcutPathPicker.offsetHeight || maxHeight, maxHeight);
    const top = openAbove
      ? Math.max(margin, rect.top - gap - measuredHeight)
      : Math.min(rect.bottom + gap, viewportHeight - margin - measuredHeight);
    serverLogShortcutPathPicker.style.top = Math.round(top) + 'px';
  }

  function browseServerLogShortcutPath() {
    if (!activeConnectionId || !serverLogShortcutDialogOpen) return;
    const path = getServerLogShortcutInitialPickerPath();
    showServerLogShortcutPathPicker(path);
    requestServerLogShortcutPathEntries(path);
  }

  function showServerLogShortcutPathPicker(path) {
    serverLogShortcutPathPickerOpen = true;
    serverLogShortcutPathPickerPathValue = normalizeUiRemotePath(path || '/');
    if (serverLogShortcutPathPicker) {
      ensureServerLogShortcutPathPickerPortal();
      serverLogShortcutPathPicker.classList.remove('hidden');
      serverLogShortcutPathPicker.setAttribute('aria-hidden', 'false');
    }
    if (serverLogShortcutPathPickerPath) serverLogShortcutPathPickerPath.textContent = serverLogShortcutPathPickerPathValue;
    if (serverLogShortcutPathPickerList) serverLogShortcutPathPickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
    positionServerLogShortcutPathPicker();
  }

  function hideServerLogShortcutPathPicker() {
    serverLogShortcutPathPickerOpen = false;
    if (serverLogShortcutPathPicker) {
      serverLogShortcutPathPicker.classList.add('hidden');
      serverLogShortcutPathPicker.setAttribute('aria-hidden', 'true');
      serverLogShortcutPathPicker.removeAttribute('style');
      if (serverLogShortcutPathPickerList) serverLogShortcutPathPickerList.style.maxHeight = '';
    }
  }

  function requestServerLogShortcutPathEntries(path) {
    if (!activeConnectionId || !serverLogShortcutDialogOpen) return;
    const scopePath = normalizeUiRemotePath(path || '/');
    serverLogShortcutPathPickerPathValue = scopePath;
    serverLogShortcutPathPickerRequestId += 1;
    if (serverLogShortcutPathPickerPath) serverLogShortcutPathPickerPath.textContent = scopePath;
    if (serverLogShortcutPathPickerList) serverLogShortcutPathPickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
    positionServerLogShortcutPathPicker();
    vscode.postMessage({ type: 'browseRemoteSearchScope', payload: { scopePath, includeFiles: true, purpose: 'serverLogShortcut', requestId: String(serverLogShortcutPathPickerRequestId) } });
  }

  function selectServerLogShortcutPath(path) {
    const selectedPath = normalizeUiRemotePath(path || '');
    if (!selectedPath || selectedPath === '/') return;
    serverLogShortcutPathInput.value = selectedPath;
    validateServerLogShortcutInputs(false);
    hideServerLogShortcutPathPicker();
    serverLogShortcutPathInput.focus();
  }

  function handleServerLogShortcutPathEntriesListed(payload) {
    if (payload && payload.purpose && payload.purpose !== 'serverLogShortcut') return false;
    if (!serverLogShortcutPathPickerOpen) return false;
    if (payload.connectionId && activeConnectionId && payload.connectionId !== activeConnectionId) return true;
    if (payload.requestId && String(payload.requestId) !== String(serverLogShortcutPathPickerRequestId)) return true;
    const path = normalizeUiRemotePath(payload.path || '/');
    const parentPath = normalizeUiRemotePath(payload.parentPath || '/');
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    serverLogShortcutPathPickerPathValue = path;
    if (serverLogShortcutPathPickerPath) serverLogShortcutPathPickerPath.textContent = path;
    if (!serverLogShortcutPathPickerList) return true;
    const parentItem = path && path !== '/' ? '<button class="remote-search-scope-picker-item" type="button" data-server-log-picker-type="directory" data-server-log-picker-path="' + escapeHtml(parentPath || '/') + '"><span aria-hidden="true">..</span></button>' : '';
    if (payload.error) {
      serverLogShortcutPathPickerList.innerHTML = parentItem + '<div class="remote-search-scope-picker-empty error">' + escapeHtml(payload.error || 'Unable to list this directory.') + '</div>';
      positionServerLogShortcutPathPicker();
      return true;
    }
    const currentPath = normalizeUiRemotePath(serverLogShortcutPathInput.value || '');
    const items = entries.map(entry => {
      const entryPath = normalizeUiRemotePath(entry.path || entry.name || '/');
      const type = getEffectiveEntryType(entry) === 'directory' ? 'directory' : 'file';
      const icon = type === 'directory' ? '▸' : '·';
      const selected = type === 'file' && currentPath && entryPath === currentPath ? ' file-selected' : '';
      return '<button class="remote-search-scope-picker-item' + selected + '" type="button" data-server-log-picker-type="' + escapeHtml(type) + '" data-server-log-picker-path="' + escapeHtml(entryPath) + '"><span aria-hidden="true">' + icon + '</span><span>' + escapeHtml(entry.name || entryPath) + '</span><span class="remote-search-scope-picker-item-path">' + escapeHtml(entryPath) + '</span></button>';
    }).join('');
    serverLogShortcutPathPickerList.innerHTML = parentItem + (items || '<div class="remote-search-scope-picker-empty">No files or folders.</div>');
    positionServerLogShortcutPathPicker();
    return true;
  }

  function validateServerLogShortcutInputs(showFeedback) {
    const name = String(serverLogShortcutNameInput.value || '').trim();
    const rawPath = String(serverLogShortcutPathInput.value || '').trim();
    const pathValid = Boolean(rawPath && rawPath.charAt(0) === '/');

    serverLogShortcutNameInput.classList.remove('server-log-shortcut-input-invalid');
    serverLogShortcutPathInput.classList.toggle('server-log-shortcut-input-invalid', !pathValid && showFeedback);

    if (!rawPath) {
      if (showFeedback) serverLogShortcutFeedback.textContent = 'Remote log path is required.';
      return null;
    }

    if (!pathValid) {
      if (showFeedback) serverLogShortcutFeedback.textContent = 'Path must be absolute.';
      return null;
    }

    if (showFeedback) serverLogShortcutFeedback.textContent = '';
    const normalizedPath = normalizeUiRemotePath(rawPath);
    return {
      name: name || getRemotePathBasename(normalizedPath),
      path: normalizedPath
    };
  }

  function showServerLogShortcutDialog(mode, shortcutId) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;
    const editing = mode === 'edit';
    const shortcut = editing ? getServerLogShortcutById(active, shortcutId) : null;
    if (editing && !shortcut) return;

    serverLogShortcutDialogOpen = true;
    serverLogShortcutDialogMode = editing ? 'edit' : 'add';
    serverLogShortcutDialogShortcutId = editing ? shortcut.id : '';

    serverLogShortcutTitle.textContent = editing ? 'Edit Log Shortcut' : 'Add Log Shortcut';
    serverLogShortcutSubtitle.textContent = editing ? 'Update this shortcut name or remote log path.' : 'Create a shortcut to a remote log file.';
    serverLogShortcutSaveButton.textContent = editing ? 'Save' : 'Add';
    if (serverLogShortcutRemoveButton) {
      serverLogShortcutRemoveButton.hidden = !editing;
      serverLogShortcutRemoveButton.disabled = !editing;
    }
    serverLogShortcutNameInput.value = shortcut ? shortcut.name : '';
    serverLogShortcutPathInput.value = shortcut ? shortcut.path : '';
    serverLogShortcutFeedback.textContent = '';
    serverLogShortcutNameInput.classList.remove('server-log-shortcut-input-invalid');
    serverLogShortcutPathInput.classList.remove('server-log-shortcut-input-invalid');

    serverLogShortcutBackdrop.classList.add('visible');
    serverLogShortcutBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (editing) {
        serverLogShortcutNameInput.focus();
        serverLogShortcutNameInput.select();
      } else {
        serverLogShortcutPathInput.focus();
      }
    }, 0);
  }

  function hideServerLogShortcutDialog() {
    hideServerLogShortcutPathPicker();
    serverLogShortcutDialogOpen = false;
    serverLogShortcutDialogMode = 'add';
    serverLogShortcutDialogShortcutId = '';
    if (serverLogShortcutRemoveButton) {
      serverLogShortcutRemoveButton.hidden = true;
      serverLogShortcutRemoveButton.disabled = true;
    }
    serverLogShortcutBackdrop.classList.remove('visible');
    serverLogShortcutBackdrop.setAttribute('aria-hidden', 'true');
  }

  function saveServerLogShortcutDialog() {
    const values = validateServerLogShortcutInputs(true);
    if (!values) {
      serverLogShortcutPathInput.focus();
      return;
    }

    const active = getActiveSession();
    if (!active) return;
    const shortcuts = getServerLogShortcuts(active).slice();

    if (serverLogShortcutDialogMode === 'edit') {
      const index = shortcuts.findIndex(shortcut => shortcut.id === serverLogShortcutDialogShortcutId);
      if (index < 0) return;
      shortcuts[index] = {
        id: shortcuts[index].id,
        name: values.name,
        path: values.path
      };
    } else {
      shortcuts.push(createServerLogShortcut(values.name, values.path));
    }

    saveServerLogShortcuts(active, shortcuts);
    hideServerLogShortcutDialog();
    renderServerView();
  }

  function showServerLogShortcutRemoveDialog(shortcutId) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;
    const shortcut = getServerLogShortcutById(active, shortcutId);
    if (!shortcut) return;

    serverLogShortcutRemoveDialogOpen = true;
    serverLogShortcutRemoveId = shortcut.id;
    serverLogShortcutRemovePath.textContent = shortcut.name + ' — ' + shortcut.path;
    serverLogShortcutRemoveBackdrop.classList.add('visible');
    serverLogShortcutRemoveBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => serverLogShortcutRemoveCancelButton.focus(), 0);
  }

  function hideServerLogShortcutRemoveDialog() {
    serverLogShortcutRemoveDialogOpen = false;
    serverLogShortcutRemoveId = '';
    serverLogShortcutRemoveBackdrop.classList.remove('visible');
    serverLogShortcutRemoveBackdrop.setAttribute('aria-hidden', 'true');
  }

  function confirmRemoveServerLogShortcut() {
    const active = getActiveSession();
    if (!active || !serverLogShortcutRemoveId) return;
    const shortcuts = getServerLogShortcuts(active).filter(shortcut => shortcut.id !== serverLogShortcutRemoveId);
    saveServerLogShortcuts(active, shortcuts);
    hideServerLogShortcutRemoveDialog();
    hideServerLogShortcutDialog();
    renderServerView();
  }

  function getServerDashboardState(connectionId) {
    const key = String(connectionId || '').trim();
    if (!key) return null;
    let state = serverDashboardStatesByConnectionId.get(key);
    if (!state) {
      state = { connectionId: key, data: null, loading: false, refreshing: false, error: '', requestId: '' };
      serverDashboardStatesByConnectionId.set(key, state);
    }
    return state;
  }

  function getActiveServerDashboardState() {
    return getServerDashboardState(activeConnectionId);
  }

  function createServerDashboardRequestId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function getDefaultServerOverviewItems() {
    return [
      { label: 'Uptime', value: '—', help: 'Not loaded' },
      { label: 'Load', value: '—', help: 'Not loaded' },
      { label: 'Memory', value: '—', help: 'Not loaded' },
      { label: 'Disk', value: '—', help: 'Not loaded' }
    ];
  }

  function requestServerDashboardRefresh(force) {
    const active = getActiveSession();
    if (!activeConnectionId || !active || !isServerViewSupported(active)) return;
    const state = getServerDashboardState(activeConnectionId);
    if (!state) return;
    if (state.refreshing && !force) return;
    const requestId = createServerDashboardRequestId();
    state.requestId = requestId;
    state.loading = !state.data;
    state.refreshing = true;
    state.error = '';
    renderServerView();
    if (serverRefreshButton) serverRefreshButton.classList.add('busy');
    vscode.postMessage({ type: 'requestServerDashboard', payload: { connectionId: activeConnectionId, requestId: requestId, force: Boolean(force) } });
  }

  function maybeRequestServerDashboardForActiveView() {
    const active = getActiveSession();
    if (getActiveConnectionView() !== 'server' || !activeConnectionId || !active || !isServerViewSupported(active)) return;
    const state = getServerDashboardState(activeConnectionId);
    if (!state || state.data || state.loading || state.refreshing) return;
    requestServerDashboardRefresh(false);
  }

  function handleServerDashboardSnapshot(payload) {
    const connectionId = String(payload.connectionId || '').trim();
    if (!connectionId) return;
    const state = getServerDashboardState(connectionId);
    if (!state) return;
    if (state.requestId && payload.requestId && state.requestId !== payload.requestId) return;
    const processActionState = getServerProcessActionState(connectionId);
    if (processActionState && state.data) {
      payload = Object.assign({}, payload, {
        processes: Array.isArray(state.data.processes) ? state.data.processes : [],
        processAdapter: state.data.processAdapter || payload.processAdapter || 'ps'
      });
    }
    state.data = payload;
    state.loading = false;
    state.refreshing = false;
    state.error = String(payload.error || '');
    state.requestId = '';
    if (connectionId === activeConnectionId) {
      renderServerView();
      updateServerRefreshBusyState();
    }
  }

  function updateServerRefreshBusyState() {
    const state = getActiveServerDashboardState();
    const refreshing = Boolean(state && state.refreshing);
    if (serverRefreshButton) serverRefreshButton.classList.toggle('busy', refreshing);
  }

  function updateServerAutoRefreshTimer() {
    if (serverAutoRefreshTimer) {
      clearInterval(serverAutoRefreshTimer);
      serverAutoRefreshTimer = null;
    }
    const seconds = Number(serverAutoRefreshValue || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    if (getActiveConnectionView() !== 'server') return;
    const active = getActiveSession();
    if (!activeConnectionId || !active || !isServerViewSupported(active)) return;
    serverAutoRefreshTimer = setInterval(() => {
      const currentActive = getActiveSession();
      if (getActiveConnectionView() !== 'server' || !activeConnectionId || !currentActive || !isServerViewSupported(currentActive)) {
        updateServerAutoRefreshTimer();
        return;
      }
      requestServerDashboardRefresh(false);
    }, Math.max(15, seconds) * 1000);
  }

  function renderServerOverviewCards() {
    const state = getActiveServerDashboardState();
    const dataItems = state && state.data && Array.isArray(state.data.overview) ? state.data.overview : getDefaultServerOverviewItems();
    const items = dataItems.map(item => ({
      label: item.label || '',
      value: state && state.loading ? 'Loading...' : (item.value || '—'),
      help: item.help || ''
    }));
    return items.map(item => '<div class="server-overview-card"><div class="server-overview-label">' + escapeHtml(item.label) + '</div><div class="server-overview-value">' + escapeHtml(item.value) + '</div><div class="server-overview-help">' + escapeHtml(item.help) + '</div></div>').join('');
  }


  function renderServerQuickTasks() {
    const list = getRemoteCommandSavedList(activeConnectionId);
    const running = getRemoteCommandSession(activeConnectionId).status === 'running';
    const filterText = getServerQuickTaskFilterText();
    const filteredList = list.filter(item => matchesServerQuickTaskFilter(item, filterText));
    const visibleList = sortServerItems('quickTasks', filteredList, (item, key) => {
      if (key === 'details') return item && (item.details || getRemoteCommandItemRemotePath(item) || item.command);
      return item && (item.name || firstRemoteCommandLine(item.command) || item.command);
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countLabel = formatServerListCount(list.length, filteredList.length, filterHasValue, false);
    const filterBox = '<div class="server-quick-tasks-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverQuickTasksFilterInput" class="server-quick-tasks-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter tasks" value="' + escapeHtml(filterText) + '" aria-label="Filter quick tasks"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Quick Tasks Filter" data-tooltip="Clear Filter" data-server-quick-tasks-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div>';
    const addTooltip = running ? 'A command is already running' : 'Add command';
    const addButton = '<span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(addTooltip) + '"><button class="secondary remote-command-icon-button" type="button" aria-label="Add command" data-server-quick-task-action="add"' + (running ? ' disabled' : '') + '><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 3h1v4.5H13v1H8.5V13h-1V8.5H3v-1h4.5V3Z"></path></svg></button></span>';
    const header = '<div class="server-section-title-row server-quick-tasks-title-row"><div class="server-section-title-wrap"><div class="server-section-title">Quick Tasks</div><span class="server-section-count">' + escapeHtml(countLabel) + '</span></div><div class="server-section-title-right"><div class="server-section-title-actions">' + addButton + '</div><span class="server-section-title-separator" aria-hidden="true"></span>' + filterBox + '</div></div>';

    if (!list.length) {
      return '<section class="server-section-card server-quick-tasks-card">' + header + '<div class="server-placeholder"><div>No saved commands yet.</div><button class="secondary" type="button" data-server-action="run-command">Open Run Commands</button></div></section>';
    }

    if (!filteredList.length) {
      return '<section class="server-section-card server-quick-tasks-card">' + header + '<div class="server-placeholder">No quick tasks match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('quickTasks', 'server-quick-task-main', [
      { key: 'name', label: 'Name' },
      { key: 'details', label: 'Details' }
    ], '<div class="server-list-column-header-trailing"><span class="server-list-column-header-actions-space server-quick-task-actions-space" aria-hidden="true"></span></div>');
    return '<section class="server-section-card server-quick-tasks-card">' + header + columns + '<div class="server-list server-quick-tasks-list">'
      + visibleList.map(item => {
        const id = String(item.id || '');
        const name = item.name || firstRemoteCommandLine(item.command) || 'Saved command';
        const details = item.details || truncateRemoteCommandText(item.command, 90);
        const disabledTooltip = running ? 'A command is already running' : 'Run command';
        return '<div class="server-list-row server-quick-task-row" data-server-quick-task-id="' + escapeHtml(id) + '" data-tooltip="Open in Run Commands">'
          + '<div class="server-list-main server-quick-task-main"><span class="server-quick-task-name tooltip-above" data-tooltip="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span><span class="server-quick-task-details tooltip-above" data-tooltip="' + escapeHtml(details) + '">' + escapeHtml(details) + '</span></div>'
          + '<div class="server-quick-task-actions"><span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(disabledTooltip) + '"><button class="secondary server-quick-task-action-button" type="button" data-server-quick-task-action="run" data-server-quick-task-id="' + escapeHtml(id) + '"' + (running ? ' disabled' : '') + '>Run</button></span></div>'
          + '</div>';
      }).join('')
      + '</div></section>';
  }


  function getServerQuickTaskFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerQuickTaskFilterText() {
    return serverQuickTaskFiltersByConnectionId.get(getServerQuickTaskFilterKey()) || '';
  }

  function setServerQuickTaskFilterText(value) {
    const key = getServerQuickTaskFilterKey();
    const text = String(value || '');
    if (text) serverQuickTaskFiltersByConnectionId.set(key, text);
    else serverQuickTaskFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusQuickTasksFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverQuickTasksFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerQuickTaskFilter(item, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const haystack = [
      item && item.name,
      item && item.details,
      item && item.command,
      getRemoteCommandItemRemotePath(item)
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function formatServerListCount(total, visible, filterHasValue, loading) {
    if (loading && !total) return 'Loading';
    const totalCount = Math.max(0, Number(total) || 0);
    const visibleCount = Math.max(0, Number(visible) || 0);
    const suffix = totalCount === 1 ? 'item' : 'items';
    if (filterHasValue) return visibleCount + ' of ' + totalCount + ' ' + suffix;
    return totalCount + ' ' + suffix;
  }

  function getServerCardSortStorageKey(card) {
    return (activeConnectionId || '__default__') + '::' + String(card || '');
  }

  function getServerCardSort(card) {
    const sort = serverCardSortsByConnectionId.get(getServerCardSortStorageKey(card));
    if (!sort || !sort.key || !sort.direction) return { key: '', direction: '' };
    return { key: String(sort.key || ''), direction: sort.direction === 'desc' ? 'desc' : 'asc' };
  }

  function setServerCardSort(card, key, direction) {
    const storageKey = getServerCardSortStorageKey(card);
    const nextKey = String(key || '');
    const nextDirection = direction === 'desc' ? 'desc' : (direction === 'asc' ? 'asc' : '');
    if (!nextKey || !nextDirection) {
      serverCardSortsByConnectionId.delete(storageKey);
      return;
    }
    serverCardSortsByConnectionId.set(storageKey, { key: nextKey, direction: nextDirection });
  }

  function handleServerCardSortClick(card, key) {
    const normalizedCard = String(card || '');
    const normalizedKey = String(key || '');
    if (!normalizedCard || !normalizedKey) return;
    const current = getServerCardSort(normalizedCard);
    if (current.key !== normalizedKey) {
      setServerCardSort(normalizedCard, normalizedKey, 'asc');
    } else if (current.direction === 'asc') {
      setServerCardSort(normalizedCard, normalizedKey, 'desc');
    } else {
      setServerCardSort(normalizedCard, '', '');
    }
    renderServerView();
  }

  function getServerSortComparable(value) {
    if (value === null || value === undefined) return { empty: true, number: null, text: '' };
    const text = String(value).trim();
    if (!text || text === '—') return { empty: true, number: null, text: '' };
    const numericText = text.replace(/%$/, '').replace(/,/g, '');
    const numericValue = Number(numericText);
    if (Number.isFinite(numericValue) && /^[-+]?\d+(?:\.\d+)?%?$/.test(text.replace(/,/g, ''))) {
      return { empty: false, number: numericValue, text: text.toLowerCase() };
    }
    return { empty: false, number: null, text: text.toLowerCase() };
  }

  function compareServerSortValues(leftValue, rightValue) {
    const left = getServerSortComparable(leftValue);
    const right = getServerSortComparable(rightValue);
    if (left.empty && right.empty) return 0;
    if (left.empty) return 1;
    if (right.empty) return -1;
    if (left.number !== null && right.number !== null) return left.number - right.number;
    return left.text.localeCompare(right.text, undefined, { numeric: true, sensitivity: 'base' });
  }

  function sortServerItems(card, items, getValue) {
    const list = Array.isArray(items) ? items.slice() : [];
    const sort = getServerCardSort(card);
    if (!sort.key || !sort.direction) return list;
    const direction = sort.direction === 'desc' ? -1 : 1;
    return list.map((item, index) => ({ item: item, index: index }))
      .sort((left, right) => {
        const comparison = compareServerSortValues(getValue(left.item, sort.key), getValue(right.item, sort.key));
        if (comparison !== 0) return comparison * direction;
        return left.index - right.index;
      })
      .map(entry => entry.item);
  }

  function renderServerSortButton(card, key, label) {
    const sort = getServerCardSort(card);
    const active = sort.key === key && Boolean(sort.direction);
    const indicator = active ? (sort.direction === 'desc' ? '↓' : '↑') : '';
    const tooltip = active
      ? (sort.direction === 'asc' ? 'Sort descending' : 'Clear sort')
      : 'Sort ascending';
    return '<button class="server-list-column-sort-button' + (active ? ' active' : '') + ' tooltip-above" type="button" data-tooltip="' + escapeHtml(tooltip) + '" data-server-sort-card="' + escapeHtml(card) + '" data-server-sort-key="' + escapeHtml(key) + '"><span>' + escapeHtml(label) + '</span><span class="server-list-sort-indicator" aria-hidden="true">' + escapeHtml(indicator) + '</span></button>';
  }

  function renderServerColumnHeader(card, mainClass, columns, trailingHtml) {
    const columnButtons = (Array.isArray(columns) ? columns : []).map(column => renderServerSortButton(card, column.key, column.label)).join('');
    return '<div class="server-list-column-header"><div class="server-list-column-header-main ' + escapeHtml(mainClass || '') + '">' + columnButtons + '</div>' + (trailingHtml || '') + '</div>';
  }

  function renderServerLogs(session) {
    const shortcuts = getServerLogShortcuts(session);
    const state = getActiveServerDashboardState();
    const loadingDefaults = Boolean(!state || (!state.data && !state.error));
    const filterText = getServerLogShortcutFilterText();
    const filteredShortcuts = shortcuts.filter(shortcut => matchesServerLogShortcutFilter(shortcut, filterText));
    const visibleShortcuts = sortServerItems('logs', filteredShortcuts, (shortcut, key) => {
      if (key === 'path') return shortcut && shortcut.path;
      return shortcut && shortcut.name;
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countDetail = formatServerListCount(shortcuts.length, filteredShortcuts.length, filterHasValue, loadingDefaults);
    const addButton = '<span class="tooltip-anchor tooltip-above" data-tooltip="Add log shortcut"><button class="secondary remote-command-icon-button" type="button" aria-label="Add log shortcut" data-server-log-action="add"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 3h1v4.5H13v1H8.5V13h-1V8.5H3v-1h4.5V3Z"></path></svg></button></span>';
    const filterBox = '<div class="server-logs-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverLogsFilterInput" class="server-logs-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter logs" value="' + escapeHtml(filterText) + '" aria-label="Filter logs"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Logs Filter" data-tooltip="Clear Filter" data-server-logs-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div>';
    const header = '<div class="server-section-title-row server-logs-title-row"><div class="server-section-title-wrap"><div class="server-section-title">Logs shortcuts</div><span class="server-section-count">' + escapeHtml(countDetail) + '</span></div><div class="server-section-title-right"><div class="server-section-title-actions">' + addButton + '</div><span class="server-section-title-separator" aria-hidden="true"></span>' + filterBox + '</div></div>';

    if (!shortcuts.length) {
      const message = loadingDefaults ? 'Loading log shortcuts...' : 'No log shortcuts. Use + to add one.';
      return '<section class="server-section-card server-logs-card">' + header + '<div class="server-log-shortcut-empty">' + escapeHtml(message) + '</div></section>';
    }

    if (!filteredShortcuts.length) {
      return '<section class="server-section-card server-logs-card">' + header + '<div class="server-log-shortcut-empty">No log shortcuts match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('logs', 'server-log-shortcut-main', [
      { key: 'name', label: 'Name' },
      { key: 'path', label: 'Path' }
    ], '<div class="server-list-column-header-trailing"><span class="server-list-column-header-actions-space server-log-shortcut-actions-space" aria-hidden="true"></span></div>');
    return '<section class="server-section-card server-logs-card">' + header + columns + '<div class="server-list server-log-shortcuts-list">'
      + visibleShortcuts.map(shortcut => '<div class="server-list-row server-log-shortcut-row" data-server-log-id="' + escapeHtml(shortcut.id) + '"><div class="server-list-main server-log-shortcut-main"><div class="server-list-title server-log-shortcut-title"><button class="server-log-shortcut-title-button tooltip-above" type="button" data-tooltip="' + escapeHtml(shortcut.path) + '">' + escapeHtml(shortcut.name) + '</button></div><span class="server-log-shortcut-path tooltip-above" data-tooltip="' + escapeHtml(shortcut.path) + '">' + escapeHtml(shortcut.path) + '</span></div><div class="server-log-shortcut-actions">'
        + '<span class="tooltip-anchor tooltip-above" data-tooltip="Follow in Log Viewer"><button class="secondary server-log-shortcut-action-button" type="button" data-server-log-action="follow" data-server-log-id="' + escapeHtml(shortcut.id) + '">Follow</button></span>'
        + '<span class="tooltip-anchor tooltip-above" data-tooltip="View Read-Only"><button class="secondary server-log-shortcut-action-button" type="button" data-server-log-action="readonly" data-server-log-id="' + escapeHtml(shortcut.id) + '">View</button></span>'
        + '<span class="tooltip-anchor tooltip-above" data-tooltip="Copy Path"><button class="secondary server-log-shortcut-action-button" type="button" data-server-log-action="copy" data-server-log-id="' + escapeHtml(shortcut.id) + '">Copy</button></span>'
        + '</div></div>').join('')
      + '</div></section>';
  }

  function getServerLogShortcutFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerLogShortcutFilterText() {
    return serverLogShortcutFiltersByConnectionId.get(getServerLogShortcutFilterKey()) || '';
  }

  function setServerLogShortcutFilterText(value) {
    const key = getServerLogShortcutFilterKey();
    const text = String(value || '');
    if (text) serverLogShortcutFiltersByConnectionId.set(key, text);
    else serverLogShortcutFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusLogsFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverLogsFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerLogShortcutFilter(shortcut, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const haystack = [
      shortcut && shortcut.name,
      shortcut && shortcut.path
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function getServerProcessFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerProcessFilterText() {
    return serverProcessFiltersByConnectionId.get(getServerProcessFilterKey()) || '';
  }

  function setServerProcessFilterText(value) {
    const key = getServerProcessFilterKey();
    const text = String(value || '');
    if (text) serverProcessFiltersByConnectionId.set(key, text);
    else serverProcessFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusProcessesFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverProcessesFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerProcessFilter(process, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const haystack = [
      process && process.pid,
      process && process.user,
      process && process.cpu,
      process && process.memory,
      process && process.command,
      process && process.args,
      process && process.adapter
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function getServerProcessActionState(connectionId) {
    const key = String(connectionId || activeConnectionId || '').trim();
    return key ? serverProcessActionStatesByConnectionId.get(key) || null : null;
  }

  function handleServerProcessActionState(payload) {
    const connectionId = String(payload.connectionId || '').trim();
    const pid = String(payload.pid || '').trim();
    const status = String(payload.status || '').trim();
    if (!connectionId || !pid) return;
    if (status === 'clear') {
      serverProcessActionStatesByConnectionId.delete(connectionId);
    } else {
      serverProcessActionStatesByConnectionId.set(connectionId, {
        connectionId,
        pid,
        status,
        process: payload.process || null
      });
    }
    if (connectionId === activeConnectionId) renderServerView();
  }

  function getServerProcessesForRender(processes) {
    const actionState = getServerProcessActionState(activeConnectionId);
    const items = Array.isArray(processes) ? processes.map(process => Object.assign({}, process)) : [];
    if (!actionState || !actionState.pid) return items;

    const index = items.findIndex(process => String(process.pid || '') === String(actionState.pid));
    const process = Object.assign({}, actionState.process || {}, { pid: actionState.pid, transientStatus: actionState.status });
    if (index >= 0) {
      items[index] = Object.assign({}, items[index], process);
    } else if (process.pid) {
      items.push(process);
    }
    return items;
  }

  function formatServerProcessTransientLabel(status) {
    if (status === 'terminated') return 'Terminated';
    if (status === 'still-running') return 'Still running';
    if (status === 'killing') return 'Killing...';
    return '';
  }

  const SERVER_SCROLL_PRESERVE_SELECTORS = {
    quickTasks: '.server-quick-tasks-list',
    logs: '.server-log-shortcuts-list, .server-log-shortcut-empty',
    services: '.server-services-list',
    processes: '.server-processes-list',
    scheduled: '.server-scheduled-list'
  };

  function captureServerViewScrollState() {
    if (!serverViewContent) return null;
    const connectionId = serverViewContent.getAttribute('data-server-view-connection-id') || '';
    const scrollTops = {};
    Object.keys(SERVER_SCROLL_PRESERVE_SELECTORS).forEach(key => {
      const element = serverViewContent.querySelector(SERVER_SCROLL_PRESERVE_SELECTORS[key]);
      if (element) scrollTops[key] = element.scrollTop;
    });
    return { connectionId, scrollTops };
  }

  function restoreServerViewScrollState(scrollState, connectionId) {
    if (!scrollState || String(scrollState.connectionId || '') !== String(connectionId || '')) return;
    const scrollTops = scrollState.scrollTops || {};
    requestAnimationFrame(() => {
      if (!serverViewContent) return;
      if (serverViewContent.getAttribute('data-server-view-connection-id') !== String(connectionId || '')) return;
      Object.keys(SERVER_SCROLL_PRESERVE_SELECTORS).forEach(key => {
        const value = scrollTops[key];
        if (typeof value !== 'number') return;
        const element = serverViewContent.querySelector(SERVER_SCROLL_PRESERVE_SELECTORS[key]);
        if (element) element.scrollTop = value;
      });
    });
  }

  function getServerServiceFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerServiceFilterText() {
    return serverServiceFiltersByConnectionId.get(getServerServiceFilterKey()) || '';
  }

  function setServerServiceFilterText(value) {
    const key = getServerServiceFilterKey();
    const text = String(value || '');
    if (text) serverServiceFiltersByConnectionId.set(key, text);
    else serverServiceFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusServicesFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverServicesFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerServiceFilter(service, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const haystack = [
      service && service.name,
      service && service.displayName,
      service && service.status,
      service && service.statusLabel,
      service && service.rawStatus,
      service && service.adapter
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function renderServerServices() {
    const state = getActiveServerDashboardState();
    const data = state && state.data ? state.data : null;
    const services = data && Array.isArray(data.services) ? data.services : [];
    const adapter = data && data.serviceAdapter ? String(data.serviceAdapter) : (state && state.loading ? 'loading' : 'not loaded');
    const filterText = getServerServiceFilterText();
    const filteredServices = services.filter(service => matchesServerServiceFilter(service, filterText));
    const visibleServices = sortServerItems('services', filteredServices, (service, key) => {
      if (key === 'status') return service && (service.statusLabel || service.status || service.rawStatus);
      return service && (service.displayName || service.name);
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countDetail = formatServerListCount(services.length, filteredServices.length, filterHasValue, Boolean(!data && state && state.loading));
    const header = '<div class="server-section-title-row server-services-title-row"><div class="server-section-title-wrap"><div class="server-section-title">Services</div><span class="server-section-count">' + escapeHtml(countDetail) + '</span></div><div class="server-section-title-right"><div class="server-services-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverServicesFilterInput" class="server-services-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter services" value="' + escapeHtml(filterText) + '" aria-label="Filter services"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Services Filter" data-tooltip="Clear Filter" data-server-services-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div></div></div>';

    if (!data && state && state.loading) {
      return '<section class="server-section-card server-services-card">' + header + '<div class="server-placeholder">Loading services...</div></section>';
    }

    if (!services.length) {
      const message = data && adapter === 'generic-unix'
        ? 'Services are limited for this Unix adapter. No safe service manager was detected.'
        : data ? 'No services found.' : 'Services are not loaded yet.';
      return '<section class="server-section-card server-services-card">' + header + '<div class="server-placeholder">' + escapeHtml(message) + '</div></section>';
    }

    if (!filteredServices.length) {
      return '<section class="server-section-card server-services-card">' + header + '<div class="server-placeholder">No services match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('services', 'server-service-main', [
      { key: 'name', label: 'Service' }
    ], '<div class="server-service-trailing server-list-column-header-trailing"><span class="server-list-column-header-actions-space server-service-actions-space" aria-hidden="true"></span>' + renderServerSortButton('services', 'status', 'Status') + '</div>');
    return '<section class="server-section-card server-services-card">' + header + columns + '<div class="server-list server-services-list">'
      + visibleServices.map(service => {
        const name = String(service.name || service.displayName || '');
        const displayName = String(service.displayName || name || 'Service');
        const status = String(service.status || 'unknown');
        const statusLabel = String(service.statusLabel || 'Unknown');
        const rawStatus = String(service.rawStatus || statusLabel);
        const serviceAdapter = String(service.adapter || adapter || 'unknown');
        const startStopAction = service.canStop ? 'stop' : 'start';
        const startStopLabel = service.canStop ? 'Stop' : 'Start';
        const startStopDisabled = !(service.canStart || service.canStop);
        const restartDisabled = !service.canRestart;
        return '<div class="server-list-row server-service-row" data-server-service-name="' + escapeHtml(name) + '" data-server-service-adapter="' + escapeHtml(serviceAdapter) + '">'
          + '<div class="server-list-main server-service-main"><div class="server-list-title server-service-name tooltip-above" data-tooltip="' + escapeHtml(name) + '">' + escapeHtml(displayName) + '</div></div>'
          + '<div class="server-service-trailing">'
          + '<div class="server-service-actions">'
          + '<span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(startStopLabel + ' service') + '"><button class="secondary server-service-action-button" type="button" data-server-service-action="' + escapeHtml(startStopAction) + '" data-server-service-name="' + escapeHtml(name) + '" data-server-service-adapter="' + escapeHtml(serviceAdapter) + '"' + (startStopDisabled ? ' disabled' : '') + '>' + escapeHtml(startStopLabel) + '</button></span>'
          + '<span class="tooltip-anchor tooltip-above" data-tooltip="Restart service"><button class="secondary server-service-action-button" type="button" data-server-service-action="restart" data-server-service-name="' + escapeHtml(name) + '" data-server-service-adapter="' + escapeHtml(serviceAdapter) + '"' + (restartDisabled ? ' disabled' : '') + '>Restart</button></span>'
          + '</div>'
          + '<span class="server-service-status ' + escapeHtml(status) + ' tooltip-above" data-tooltip="' + escapeHtml(rawStatus) + '">' + escapeHtml(statusLabel) + '</span>'
          + '</div></div>';
      }).join('')
      + '</div></section>';
  }

  function renderServerProcesses() {
    const state = getActiveServerDashboardState();
    const data = state && state.data ? state.data : null;
    const rawProcesses = data && Array.isArray(data.processes) ? data.processes : [];
    const processes = getServerProcessesForRender(rawProcesses);
    const adapter = data && data.processAdapter ? String(data.processAdapter) : (state && state.loading ? 'loading' : 'not loaded');
    const filterText = getServerProcessFilterText();
    const filteredProcesses = processes.filter(process => matchesServerProcessFilter(process, filterText));
    const visibleProcesses = sortServerItems('processes', filteredProcesses, (process, key) => {
      if (key === 'pid') return process && process.pid;
      if (key === 'user') return process && process.user;
      if (key === 'cpu') return process && process.cpu;
      if (key === 'memory') return process && process.memory;
      return process && (process.args || process.command);
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countDetail = formatServerListCount(processes.length, filteredProcesses.length, filterHasValue, Boolean(!data && state && state.loading));
    const header = '<div class="server-section-title-row server-processes-title-row"><div class="server-section-title-wrap"><div class="server-section-title">Processes</div><span class="server-section-count">' + escapeHtml(countDetail) + '</span></div><div class="server-section-title-right"><div class="server-processes-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverProcessesFilterInput" class="server-processes-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter processes" value="' + escapeHtml(filterText) + '" aria-label="Filter processes"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Processes Filter" data-tooltip="Clear Filter" data-server-processes-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div></div></div>';

    if (!data && state && state.loading) {
      return '<section class="server-section-card server-processes-card">' + header + '<div class="server-placeholder">Loading processes...</div></section>';
    }

    if (!processes.length) {
      const message = data ? 'No processes found.' : 'Processes are not loaded yet.';
      return '<section class="server-section-card server-processes-card">' + header + '<div class="server-placeholder">' + escapeHtml(message) + '</div></section>';
    }

    if (!filteredProcesses.length) {
      return '<section class="server-section-card server-processes-card">' + header + '<div class="server-placeholder">No processes match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('processes', 'server-process-main', [
      { key: 'command', label: 'Command' },
      { key: 'pid', label: 'PID' },
      { key: 'user', label: 'User' },
      { key: 'cpu', label: 'CPU' },
      { key: 'memory', label: 'Mem' }
    ], '<div class="server-process-trailing server-list-column-header-trailing"><span class="server-list-column-header-actions-space server-process-actions-space" aria-hidden="true"></span></div>');
    return '<section class="server-section-card server-processes-card">' + header + columns + '<div class="server-list server-processes-list">'
      + visibleProcesses.map(process => {
        const pid = String(process.pid || '');
        const user = String(process.user || '—');
        const cpu = String(process.cpu || '—');
        const memory = String(process.memory || '—');
        const command = String(process.args || process.command || '—');
        const shortCommand = String(process.command || command || '—');
        const adapterValue = String(process.adapter || adapter || 'ps');
        const transientStatus = String(process.transientStatus || '');
        const transientLabel = formatServerProcessTransientLabel(transientStatus);
        const pidNumber = Number(pid);
        const processCanKill = process.canKill !== false;
        const canKill = !transientStatus && processCanKill && Number.isInteger(pidNumber) && pidNumber > 1;
        const killTooltip = canKill ? 'Kill process' : (pidNumber === 1 ? 'PID 1 cannot be killed' : (processCanKill ? 'Kill unavailable' : 'Process cannot be killed'));
        const rowClass = 'server-list-row server-process-row' + (transientStatus ? ' process-action-active' : '');
        const cpuLabel = cpu !== '—' ? (/%$/.test(cpu) ? cpu : cpu + '%') : '—';
        const memoryLabel = memory !== '—' ? (/%$/.test(memory) ? memory : memory + '%') : '—';
        const dataset = ' data-server-process-pid="' + escapeHtml(pid) + '" data-server-process-user="' + escapeHtml(user) + '" data-server-process-cpu="' + escapeHtml(cpu) + '" data-server-process-memory="' + escapeHtml(memory) + '" data-server-process-command="' + escapeHtml(shortCommand) + '" data-server-process-args="' + escapeHtml(command) + '" data-server-process-adapter="' + escapeHtml(adapterValue) + '"';
        return '<div class="' + rowClass + '"' + dataset + '>'
          + '<div class="server-list-main server-process-main">'
          + '<span class="server-process-command tooltip-above" data-tooltip="' + escapeHtml(command) + '">' + escapeHtml(command) + '</span>'
          + '<span class="server-process-pid tooltip-above" data-tooltip="PID ' + escapeHtml(pid) + '">' + escapeHtml(pid) + '</span>'
          + '<span class="server-process-user tooltip-above" data-tooltip="' + escapeHtml(user) + '">' + escapeHtml(user) + '</span>'
          + '<span class="server-process-cpu tooltip-above" data-tooltip="CPU ' + escapeHtml(cpuLabel) + '">' + escapeHtml(cpuLabel) + '</span>'
          + '<span class="server-process-memory tooltip-above" data-tooltip="Memory ' + escapeHtml(memoryLabel) + '">' + escapeHtml(memoryLabel) + '</span>'
          + '</div><div class="server-process-trailing">'
          + (transientLabel ? '<span class="server-process-status ' + escapeHtml(transientStatus) + '">' + escapeHtml(transientLabel) + '</span>' : '')
          + '<div class="server-process-actions"><span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(killTooltip) + '"><button class="secondary server-process-action-button" type="button" data-server-process-action="kill"' + dataset + (canKill ? '' : ' disabled') + '>Kill</button></span></div>'
          + '</div></div>';
      }).join('')
      + '</div></section>';
  }

  function getServerScheduledJobFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerScheduledJobFilterText() {
    return serverScheduledJobFiltersByConnectionId.get(getServerScheduledJobFilterKey()) || '';
  }

  function setServerScheduledJobFilterText(value) {
    const key = getServerScheduledJobFilterKey();
    const text = String(value || '');
    if (text) serverScheduledJobFiltersByConnectionId.set(key, text);
    else serverScheduledJobFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusScheduledFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverScheduledFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerScheduledJobFilter(item, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const haystack = [
      item && item.name,
      item && item.countLabel,
      item && item.typeLabel,
      item && item.source,
      item && item.sourceType,
      item && item.user,
      item && item.path
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function renderServerCron() {
    const state = getActiveServerDashboardState();
    const data = state && state.data ? state.data : null;
    const items = data && Array.isArray(data.scheduledJobs) ? data.scheduledJobs : [];
    const adapter = data && data.scheduledJobsAdapter ? String(data.scheduledJobsAdapter) : (state && state.loading ? 'loading' : 'not loaded');
    const filterText = getServerScheduledJobFilterText();
    const filteredItems = items.filter(item => matchesServerScheduledJobFilter(item, filterText));
    const visibleItems = sortServerItems('cron', filteredItems, (item, key) => {
      if (key === 'entries') return item && (item.count || item.countLabel);
      if (key === 'type') return item && (item.typeLabel || item.sourceType);
      return item && (item.name || item.source);
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countDetail = formatServerListCount(items.length, filteredItems.length, filterHasValue, Boolean(!data && state && state.loading));
    const filterBox = '<div class="server-scheduled-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverScheduledFilterInput" class="server-scheduled-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter cron jobs" value="' + escapeHtml(filterText) + '" aria-label="Filter cron jobs jobs"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Cron Jobs Filter" data-tooltip="Clear Filter" data-server-scheduled-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div>';
    const header = '<div class="server-section-title-row server-scheduled-title-row"><div class="server-section-title-wrap"><div class="server-section-title">Cron Jobs</div><span class="server-section-count">' + escapeHtml(countDetail) + '</span></div><div class="server-section-title-right">' + filterBox + '</div></div>';

    if (!data && state && state.loading) {
      return '<section class="server-section-card server-scheduled-card">' + header + '<div class="server-placeholder">Loading cron jobs...</div></section>';
    }

    if (!items.length) {
      const message = data ? 'No cron jobs found.' : 'Cron jobs are not loaded yet.';
      return '<section class="server-section-card server-scheduled-card">' + header + '<div class="server-placeholder">' + escapeHtml(message) + '</div></section>';
    }

    if (!filteredItems.length) {
      return '<section class="server-section-card server-scheduled-card">' + header + '<div class="server-placeholder">No cron jobs match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('cron', 'server-scheduled-main', [
      { key: 'name', label: 'Name' },
      { key: 'entries', label: 'Entries' },
      { key: 'type', label: 'Type' }
    ], '<div class="server-list-column-header-trailing"><span class="server-list-column-header-actions-space server-scheduled-actions-space" aria-hidden="true"></span></div>');
    return '<section class="server-section-card server-scheduled-card">' + header + columns + '<div class="server-list server-scheduled-list">'
      + visibleItems.map(item => {
        const name = String(item.name || item.source || 'Scheduled item');
        const countLabel = String(item.countLabel || '—');
        const typeLabel = String(item.typeLabel || item.sourceType || '—');
        const source = String(item.source || '');
        const sourceType = String(item.sourceType || '');
        const user = String(item.user || '');
        const path = String(item.path || '');
        const copyValue = String(item.copyValue || path || source || name);
        const canOpen = item.canOpen !== false;
        const dataset = ' data-server-scheduled-id="' + escapeHtml(item.id || '') + '" data-server-scheduled-name="' + escapeHtml(name) + '" data-server-scheduled-count="' + escapeHtml(countLabel) + '" data-server-scheduled-type-label="' + escapeHtml(typeLabel) + '" data-server-scheduled-source="' + escapeHtml(source) + '" data-server-scheduled-source-type="' + escapeHtml(sourceType) + '" data-server-scheduled-user="' + escapeHtml(user) + '" data-server-scheduled-path="' + escapeHtml(path) + '" data-server-scheduled-copy="' + escapeHtml(copyValue) + '"';
        const openTooltip = canOpen ? 'Open Read-Only' : 'Open unavailable';
        return '<div class="server-list-row server-scheduled-row"' + dataset + '>'
          + '<div class="server-list-main server-scheduled-main">'
          + '<span class="server-scheduled-name tooltip-above" data-tooltip="' + escapeHtml(source || name) + '">' + escapeHtml(name) + '</span>'
          + '<span class="server-scheduled-count tooltip-above" data-tooltip="' + escapeHtml(countLabel) + '">' + escapeHtml(countLabel) + '</span>'
          + '<span class="server-scheduled-type tooltip-above" data-tooltip="' + escapeHtml(typeLabel) + '">' + escapeHtml(typeLabel) + '</span>'
          + '</div><div class="server-scheduled-actions">'
          + '<span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(openTooltip) + '"><button class="secondary server-scheduled-action-button" type="button" data-server-scheduled-action="open"' + dataset + (canOpen ? '' : ' disabled') + '>View</button></span>'
          + '<span class="tooltip-anchor tooltip-above" data-tooltip="Copy Source"><button class="secondary server-scheduled-action-button" type="button" data-server-scheduled-action="copy"' + dataset + '>Copy</button></span>'
          + '</div></div>';
      }).join('')
      + '</div></section>';
  }


  function createServerPortForwardId() {
    return 'pf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function sanitizeServerPortForward(value) {
    if (!value || typeof value !== 'object') return null;
    const id = String(value.id || '').trim();
    const localPort = Number(value.localPort || 0);
    const remotePort = Number(value.remotePort || 0);
    if (!id || !isValidServerPort(localPort) || !isValidServerPort(remotePort)) return null;
    const localHost = String(value.localHost || '').trim() || 'localhost';
    const remoteHost = String(value.remoteHost || '').trim() || '127.0.0.1';
    const name = String(value.name || '').trim() || buildServerPortForwardDefaultName(localPort, remotePort);
    return {
      id: id,
      name: name,
      localHost: localHost,
      localPort: localPort,
      remoteHost: remoteHost,
      remotePort: remotePort,
      autoStartOnConnect: Boolean(value.autoStartOnConnect),
      createdAt: Number(value.createdAt || Date.now()),
      updatedAt: Number(value.updatedAt || value.createdAt || Date.now())
    };
  }

  function createServerPortForward(values) {
    const now = Date.now();
    return {
      id: createServerPortForwardId(),
      name: String(values.name || '').trim() || buildServerPortForwardDefaultName(values.localPort, values.remotePort),
      localHost: String(values.localHost || '').trim() || 'localhost',
      localPort: Number(values.localPort || 0),
      remoteHost: String(values.remoteHost || '').trim() || '127.0.0.1',
      remotePort: Number(values.remotePort || 0),
      autoStartOnConnect: Boolean(values.autoStartOnConnect),
      createdAt: now,
      updatedAt: now
    };
  }

  function buildServerPortForwardDefaultName(localPort, remotePort) {
    const local = Number(localPort || 0);
    const remote = Number(remotePort || 0);
    if (local && remote) return local + ' → ' + remote;
    return 'Port forward';
  }

  function getServerPortForwardStorageKey(session) {
    return String((session && session.id) || activeConnectionId || '').trim();
  }

  function loadAllServerPortForwardsFromStorage() {
    try {
      return JSON.parse(localStorage.getItem(SERVER_PORT_FORWARDS_STORAGE_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function saveAllServerPortForwardsToStorage(all) {
    try {
      localStorage.setItem(SERVER_PORT_FORWARDS_STORAGE_KEY, JSON.stringify(all || {}));
      postPersistentStorageSnapshot();
    } catch (_) {
      // Ignore storage write errors.
    }
  }

  function getServerPortForwards(session) {
    const connectionId = getServerPortForwardStorageKey(session);
    if (!connectionId) return [];
    if (serverPortForwardsSessionByConnectionId.has(connectionId)) {
      return (serverPortForwardsSessionByConnectionId.get(connectionId) || []).map(sanitizeServerPortForward).filter(Boolean);
    }
    const all = loadAllServerPortForwardsFromStorage();
    const normalized = Array.isArray(all[connectionId]) ? all[connectionId].map(sanitizeServerPortForward).filter(Boolean) : [];
    serverPortForwardsSessionByConnectionId.set(connectionId, normalized);
    return normalized;
  }

  function saveServerPortForwards(session, forwards) {
    const connectionId = getServerPortForwardStorageKey(session);
    if (!connectionId) return;
    const normalized = (Array.isArray(forwards) ? forwards : []).map(sanitizeServerPortForward).filter(Boolean);
    serverPortForwardsSessionByConnectionId.set(connectionId, normalized);
    const all = loadAllServerPortForwardsFromStorage();
    all[connectionId] = normalized;
    saveAllServerPortForwardsToStorage(all);
  }

  function getServerPortForwardById(session, id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return null;
    return getServerPortForwards(session).find(item => item.id === normalizedId) || null;
  }

  function getServerPortForwardFilterKey() {
    return activeConnectionId || '__default__';
  }

  function getServerPortForwardFilterText() {
    return serverPortForwardFiltersByConnectionId.get(getServerPortForwardFilterKey()) || '';
  }

  function setServerPortForwardFilterText(value) {
    const key = getServerPortForwardFilterKey();
    const text = String(value || '');
    if (text) serverPortForwardFiltersByConnectionId.set(key, text);
    else serverPortForwardFiltersByConnectionId.delete(key);
  }

  function renderServerViewAndFocusPortForwardsFilter() {
    renderServerView();
    const nextInput = document.getElementById('serverPortForwardsFilterInput');
    if (nextInput) {
      nextInput.focus();
      const len = String(nextInput.value || '').length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  }

  function matchesServerPortForwardFilter(item, filterText) {
    const filter = String(filterText || '').trim().toLowerCase();
    if (!filter) return true;
    const haystack = [
      item && item.name,
      item && item.localHost,
      item && item.localPort,
      item && item.remoteHost,
      item && item.remotePort,
      item && item.autoStartOnConnect ? 'auto auto-start autostart' : '',
      formatServerPortForwardTarget(item)
    ].map(value => String(value || '').toLowerCase()).join(' ');
    return haystack.includes(filter);
  }

  function getServerPortForwardRuntimeMap(connectionId) {
    const key = String(connectionId || '').trim();
    if (!key) return new Map();
    let map = serverPortForwardRuntimeByConnectionId.get(key);
    if (!map) {
      map = new Map();
      serverPortForwardRuntimeByConnectionId.set(key, map);
    }
    return map;
  }

  function getServerPortForwardRuntimeState(connectionId, id) {
    const map = getServerPortForwardRuntimeMap(connectionId);
    return map.get(String(id || '').trim()) || { id: String(id || '').trim(), connectionId: connectionId, status: 'stopped', error: '' };
  }

  function setServerPortForwardRuntimeState(connectionId, state) {
    const id = String(state && state.id || '').trim();
    if (!connectionId || !id) return;
    const map = getServerPortForwardRuntimeMap(connectionId);
    map.set(id, {
      id: id,
      connectionId: connectionId,
      status: String(state.status || 'stopped'),
      error: String(state.error || ''),
      localUrl: String(state.localUrl || '')
    });
  }

  function handleServerPortForwardState(payload) {
    const connectionId = String(payload.connectionId || '').trim();
    const id = String(payload.id || '').trim();
    if (!connectionId || !id) return;
    setServerPortForwardRuntimeState(connectionId, payload);
    const pendingKey = connectionId + ':' + id;
    const pendingAction = serverPortForwardPendingActions.get(pendingKey) || '';
    const nextStatus = String(payload.status || '').trim();
    if (connectionId === activeConnectionId && pendingAction) {
      if ((nextStatus === 'running' && pendingAction === 'start') || (nextStatus === 'stopped' && pendingAction === 'stop')) {
        serverPortForwardPendingActions.delete(pendingKey);
      } else if (nextStatus === 'error') {
        const errorText = String(payload.error || '').trim();
        showServerToolbarStatus(errorText ? 'Port forward failed: ' + errorText : 'Port forward failed.', 'error', 7000);
        serverPortForwardPendingActions.delete(pendingKey);
      }
    }
    if (connectionId === activeConnectionId) {
      renderServerView();
    }
  }

  function formatServerPortForwardTarget(item) {
    if (!item) return '';
    return String(item.localHost || 'localhost') + ':' + String(item.localPort || '') + ' → ' + String(item.remoteHost || '127.0.0.1') + ':' + String(item.remotePort || '');
  }

  function isServerPortForwardBusy(status) {
    return status === 'starting' || status === 'stopping';
  }

  function isValidServerPort(port) {
    const value = Number(port || 0);
    return Number.isInteger(value) && value >= 1 && value <= 65535;
  }

  function normalizeServerPortForwardHost(value, fallback) {
    return String(value || '').trim() || fallback;
  }

  function markServerPortForwardInputInvalid(input, invalid) {
    if (!input) return;
    input.classList.toggle('server-port-forward-input-invalid', Boolean(invalid));
  }

  function readServerPortForwardDialogValues(showFeedback) {
    const name = String(serverPortForwardNameInput.value || '').trim();
    const localHost = normalizeServerPortForwardHost(serverPortForwardLocalHostInput.value, 'localhost');
    const remoteHost = normalizeServerPortForwardHost(serverPortForwardRemoteHostInput.value, '127.0.0.1');
    const localPort = Number(String(serverPortForwardLocalPortInput.value || '').trim());
    const remotePort = Number(String(serverPortForwardRemotePortInput.value || '').trim());
    const autoStartOnConnect = Boolean(serverPortForwardAutoStartInput && serverPortForwardAutoStartInput.checked);
    const localPortValid = isValidServerPort(localPort);
    const remotePortValid = isValidServerPort(remotePort);
    const localHostValid = Boolean(localHost);
    const remoteHostValid = Boolean(remoteHost);
    markServerPortForwardInputInvalid(serverPortForwardLocalPortInput, !localPortValid && showFeedback);
    markServerPortForwardInputInvalid(serverPortForwardRemotePortInput, !remotePortValid && showFeedback);
    markServerPortForwardInputInvalid(serverPortForwardLocalHostInput, !localHostValid && showFeedback);
    markServerPortForwardInputInvalid(serverPortForwardRemoteHostInput, !remoteHostValid && showFeedback);
    if (!localHostValid || !remoteHostValid || !localPortValid || !remotePortValid) {
      if (showFeedback && serverPortForwardFeedback) serverPortForwardFeedback.textContent = 'Enter valid hosts and ports between 1 and 65535.';
      return null;
    }
    if (serverPortForwardFeedback) serverPortForwardFeedback.textContent = '';
    return { name: name || buildServerPortForwardDefaultName(localPort, remotePort), localHost, localPort, remoteHost, remotePort, autoStartOnConnect };
  }

  function showServerPortForwardDialog(mode, forwardId) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;
    const editing = mode === 'edit';
    const forward = editing ? getServerPortForwardById(active, forwardId) : null;
    const runtime = forward ? getServerPortForwardRuntimeState(activeConnectionId, forward.id) : null;
    const status = runtime ? String(runtime.status || 'stopped') : 'stopped';
    const running = status === 'running' || status === 'starting' || status === 'stopping';

    serverPortForwardDialogOpen = true;
    serverPortForwardDialogMode = editing && forward ? 'edit' : 'add';
    serverPortForwardDialogForwardId = forward ? forward.id : '';
    if (serverPortForwardTitle) serverPortForwardTitle.textContent = forward ? 'Edit Port Forward' : 'Add Port Forward';
    if (serverPortForwardSubtitle) serverPortForwardSubtitle.textContent = forward ? formatServerPortForwardTarget(forward) : 'Create a local SSH port forward for this connection.';
    serverPortForwardNameInput.value = forward ? forward.name : '';
    serverPortForwardLocalHostInput.value = forward ? forward.localHost : 'localhost';
    serverPortForwardLocalPortInput.value = forward ? String(forward.localPort) : '';
    serverPortForwardRemoteHostInput.value = forward ? forward.remoteHost : '127.0.0.1';
    serverPortForwardRemotePortInput.value = forward ? String(forward.remotePort) : '';
    if (serverPortForwardAutoStartInput) serverPortForwardAutoStartInput.checked = Boolean(forward && forward.autoStartOnConnect);
    if (serverPortForwardFeedback) serverPortForwardFeedback.textContent = '';
    for (const input of [serverPortForwardNameInput, serverPortForwardLocalHostInput, serverPortForwardLocalPortInput, serverPortForwardRemoteHostInput, serverPortForwardRemotePortInput]) {
      if (input) input.classList.remove('server-port-forward-input-invalid');
    }
    for (const input of [serverPortForwardNameInput, serverPortForwardLocalHostInput, serverPortForwardLocalPortInput, serverPortForwardRemoteHostInput, serverPortForwardRemotePortInput]) {
      if (input) input.disabled = running;
    }
    if (serverPortForwardAutoStartInput) serverPortForwardAutoStartInput.disabled = running;
    if (serverPortForwardRunningNote) serverPortForwardRunningNote.hidden = !running;
    if (serverPortForwardDeleteButton) {
      serverPortForwardDeleteButton.hidden = !forward;
      serverPortForwardDeleteButton.disabled = running;
    }
    if (serverPortForwardSaveButton) serverPortForwardSaveButton.disabled = running;
    serverPortForwardBackdrop.classList.add('visible');
    serverPortForwardBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (running) serverPortForwardCancelButton.focus();
      else serverPortForwardNameInput.focus();
    }, 0);
  }

  function hideServerPortForwardDialog() {
    serverPortForwardDialogOpen = false;
    serverPortForwardDialogMode = 'add';
    serverPortForwardDialogForwardId = '';
    serverPortForwardBackdrop.classList.remove('visible');
    serverPortForwardBackdrop.setAttribute('aria-hidden', 'true');
  }

  function saveServerPortForwardDialog(startAfterSave) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return null;
    const existing = serverPortForwardDialogMode === 'edit' ? getServerPortForwardById(active, serverPortForwardDialogForwardId) : null;
    if (existing) {
      const runtime = getServerPortForwardRuntimeState(activeConnectionId, existing.id);
      if (runtime.status === 'running' || runtime.status === 'starting' || runtime.status === 'stopping') {
        if (startAfterSave && runtime.status === 'running') requestStopServerPortForward(existing.id);
        return existing;
      }
    }
    const values = readServerPortForwardDialogValues(true);
    if (!values) return null;
    const forwards = getServerPortForwards(active).slice();
    let saved;
    if (existing) {
      const index = forwards.findIndex(item => item.id === existing.id);
      if (index < 0) return null;
      saved = Object.assign({}, existing, values, { updatedAt: Date.now() });
      forwards[index] = saved;
    } else {
      saved = createServerPortForward(values);
      forwards.push(saved);
    }
    saveServerPortForwards(active, forwards);
    hideServerPortForwardDialog();
    renderServerView();
    if (startAfterSave && saved) {
      requestStartServerPortForward(saved);
    }
    return saved;
  }

  function requestServerPortForwardStatesForSession(session) {
    if (!session || !isServerViewSupported(session)) return;
    const connectionId = getServerPortForwardStorageKey(session);
    if (!connectionId) return;
    const ids = getServerPortForwards(session).map(item => item.id).filter(Boolean);
    if (!ids.length) return;
    vscode.postMessage({ type: 'requestPortForwardState', payload: { connectionId: connectionId, ids: ids } });
  }

  function maybeAutoStartServerPortForwardsForSession(session, isNewConnection) {
    if (!isNewConnection || !session || !isServerViewSupported(session)) return;
    const connectionId = getServerPortForwardStorageKey(session);
    if (!connectionId || serverPortForwardAutoStartedConnectionIds.has(connectionId)) return;
    serverPortForwardAutoStartedConnectionIds.add(connectionId);
    const forwards = getServerPortForwards(session).filter(item => item && item.autoStartOnConnect);
    forwards.forEach(forward => {
      const runtime = getServerPortForwardRuntimeState(connectionId, forward.id);
      if (runtime.status === 'running' || runtime.status === 'starting') return;
      requestStartServerPortForwardForConnection(connectionId, forward);
    });
  }

  function requestStartServerPortForwardForConnection(connectionId, forward) {
    if (!forward || !connectionId) return;
    serverPortForwardPendingActions.set(connectionId + ':' + forward.id, 'start');
    setServerPortForwardRuntimeState(connectionId, { id: forward.id, connectionId: connectionId, status: 'starting', error: '' });
    if (connectionId === activeConnectionId) renderServerView();
    vscode.postMessage({ type: 'startPortForward', payload: { connectionId: connectionId, forward: forward } });
  }

  function requestStartServerPortForward(forward) {
    requestStartServerPortForwardForConnection(activeConnectionId, forward);
  }

  function requestStopServerPortForward(forwardId) {
    if (!forwardId || !activeConnectionId) return;
    serverPortForwardPendingActions.set(activeConnectionId + ':' + forwardId, 'stop');
    setServerPortForwardRuntimeState(activeConnectionId, { id: forwardId, connectionId: activeConnectionId, status: 'stopping', error: '' });
    renderServerView();
    vscode.postMessage({ type: 'stopPortForward', payload: { connectionId: activeConnectionId, id: forwardId } });
  }

  function handleServerPortForwardAction(action, forwardId) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;
    if (action === 'add') {
      showServerPortForwardDialog('add', '');
      return;
    }
    const forward = getServerPortForwardById(active, forwardId);
    if (!forward) return;
    const runtime = getServerPortForwardRuntimeState(activeConnectionId, forward.id);
    if (action === 'stop') {
      requestStopServerPortForward(forward.id);
      return;
    }
    if (action === 'start') {
      requestStartServerPortForward(forward);
      return;
    }
    showServerPortForwardDialog('edit', forward.id);
  }

  function showServerPortForwardRemoveDialog() {
    const active = getActiveSession();
    if (!active || !serverPortForwardDialogForwardId) return;
    const forward = getServerPortForwardById(active, serverPortForwardDialogForwardId);
    if (!forward) return;
    serverPortForwardRemoveDialogOpen = true;
    serverPortForwardRemoveId = forward.id;
    if (serverPortForwardRemovePath) serverPortForwardRemovePath.textContent = forward.name + ' — ' + formatServerPortForwardTarget(forward);
    serverPortForwardRemoveBackdrop.classList.add('visible');
    serverPortForwardRemoveBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => serverPortForwardRemoveCancelButton.focus(), 0);
  }

  function hideServerPortForwardRemoveDialog() {
    serverPortForwardRemoveDialogOpen = false;
    serverPortForwardRemoveId = '';
    serverPortForwardRemoveBackdrop.classList.remove('visible');
    serverPortForwardRemoveBackdrop.setAttribute('aria-hidden', 'true');
  }

  function confirmRemoveServerPortForward() {
    const active = getActiveSession();
    if (!active || !serverPortForwardRemoveId) return;
    const runtime = getServerPortForwardRuntimeState(activeConnectionId, serverPortForwardRemoveId);
    if (runtime.status === 'running' || runtime.status === 'starting' || runtime.status === 'stopping') {
      requestStopServerPortForward(serverPortForwardRemoveId);
    }
    const forwards = getServerPortForwards(active).filter(item => item.id !== serverPortForwardRemoveId);
    saveServerPortForwards(active, forwards);
    hideServerPortForwardRemoveDialog();
    hideServerPortForwardDialog();
    renderServerView();
  }

  function renderServerPortForwarding() {
    const active = getActiveSession();
    const forwards = getServerPortForwards(active);
    const filterText = getServerPortForwardFilterText();
    const filtered = forwards.filter(item => matchesServerPortForwardFilter(item, filterText));
    const visible = sortServerItems('portForwards', filtered, (item, key) => {
      if (key === 'target') return formatServerPortForwardTarget(item);
      if (key === 'status') return (item && item.autoStartOnConnect ? 'auto ' : '') + getServerPortForwardRuntimeState(activeConnectionId, item && item.id).status;
      return item && item.name;
    });
    const filterHasValue = Boolean(String(filterText || '').trim());
    const countDetail = formatServerListCount(forwards.length, filtered.length, filterHasValue, false);
    const filterBox = '<div class="server-port-forwards-filter-box' + (filterHasValue ? ' has-value' : '') + '"><input id="serverPortForwardsFilterInput" class="server-port-forwards-filter" type="text" spellcheck="false" autocomplete="off" placeholder="Filter forwards" value="' + escapeHtml(filterText) + '" aria-label="Filter port forwards"><button class="filter-clear-button tooltip-above" type="button" aria-label="Clear Port Forwarding Filter" data-tooltip="Clear Filter" data-server-port-forwards-filter-clear="true"' + (filterHasValue ? '' : ' disabled') + '><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div>';
    const addButton = '<span class="tooltip-anchor tooltip-above" data-tooltip="Add port forward"><button class="secondary remote-command-icon-button" type="button" aria-label="Add port forward" data-server-port-forward-action="add"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 3h1v4.5H13v1H8.5V13h-1V8.5H3v-1h4.5V3Z"></path></svg></button></span>';
    const header = '<div class="server-section-title-row server-port-forwards-title-row"><div class="server-section-title-wrap"><div class="server-section-title">Port Forwarding</div><span class="server-section-count">' + escapeHtml(countDetail) + '</span></div><div class="server-section-title-right"><div class="server-section-title-actions">' + addButton + '</div><span class="server-section-title-separator" aria-hidden="true"></span>' + filterBox + '</div></div>';

    if (!forwards.length) {
      return '<section class="server-section-card server-port-forwards-card">' + header + '<div class="server-port-forward-empty">No port forwards yet. Use + to add one.</div></section>';
    }

    if (!filtered.length) {
      return '<section class="server-section-card server-port-forwards-card">' + header + '<div class="server-port-forward-empty">No port forwards match the current filter.</div></section>';
    }

    const columns = renderServerColumnHeader('portForwards', 'server-port-forward-main', [
      { key: 'name', label: 'Name' },
      { key: 'target', label: 'Target' }
    ], '<div class="server-port-forward-trailing server-list-column-header-trailing">' + renderServerSortButton('portForwards', 'status', 'Status') + '<span class="server-list-column-header-actions-space server-port-forward-actions-space" aria-hidden="true"></span></div>');
    return '<section class="server-section-card server-port-forwards-card">' + header + columns + '<div class="server-list server-port-forwards-list">'
      + visible.map(item => {
        const runtime = getServerPortForwardRuntimeState(activeConnectionId, item.id);
        const status = String(runtime.status || 'stopped');
        const action = status === 'running' ? 'stop' : 'start';
        const label = status === 'running' ? 'Stop' : 'Start';
        const disabled = isServerPortForwardBusy(status);
        const target = formatServerPortForwardTarget(item);
        const statusTooltip = status === 'error' && runtime.error ? runtime.error : status;
        const autoBadge = item.autoStartOnConnect ? '<span class="server-port-forward-auto-badge tooltip-above" data-tooltip="Auto-start on connect">auto-start</span>' : '';
        return '<div class="server-list-row server-port-forward-row" data-server-port-forward-id="' + escapeHtml(item.id) + '" data-tooltip="Edit port forward">'
          + '<div class="server-list-main server-port-forward-main"><span class="server-port-forward-name tooltip-above" data-tooltip="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span><span class="server-port-forward-target tooltip-above" data-tooltip="' + escapeHtml(target) + '">' + escapeHtml(target) + '</span></div>'
          + '<div class="server-port-forward-trailing">' + autoBadge + '<span class="server-port-forward-status ' + escapeHtml(status) + ' tooltip-above" data-tooltip="' + escapeHtml(statusTooltip) + '">' + escapeHtml(status) + '</span><div class="server-port-forward-actions"><span class="tooltip-anchor tooltip-above" data-tooltip="' + escapeHtml(disabled ? status : label + ' forward') + '"><button class="secondary server-port-forward-action-button" type="button" data-server-port-forward-action="' + escapeHtml(action) + '" data-server-port-forward-id="' + escapeHtml(item.id) + '"' + (disabled ? ' disabled' : '') + '>' + escapeHtml(label) + '</button></span></div></div>'
          + '</div>';
      }).join('')
      + '</div></section>';
  }

  function renderServerSystemInfo(session) {
    const state = getActiveServerDashboardState();
    const data = state && state.data ? state.data : null;
    const items = data && Array.isArray(data.systemInfo)
      ? data.systemInfo
      : [
        { label: 'Protocol', value: getConnectionTypeLabel(session.connectionType) },
        { label: 'Host', value: session.host || '—' },
        { label: 'Port', value: String(session.port || '—') },
        { label: 'User', value: session.username || '—' },
        { label: 'Adapter', value: 'not loaded' },
        { label: 'Sudo', value: formatServerSudoLabel(session) },
        { label: 'Last refresh', value: state && state.loading ? 'Loading...' : '—' }
      ];
    const errorBlock = state && state.error ? '<div class="server-placeholder">' + escapeHtml(state.error) + '</div>' : '';
    return '<section class="server-section-card full-width"><div class="server-section-title-row"><div class="server-section-title">System Info / Adapter Details</div></div>' + errorBlock + '<div class="server-system-info-grid">'
      + items.map(item => '<div class="server-system-info-item"><div class="server-system-info-label">' + escapeHtml(item.label || '') + '</div><div class="server-system-info-value tooltip-above" data-tooltip="' + escapeHtml(item.value || '—') + '">' + escapeHtml(item.value || '—') + '</div></div>').join('')
      + '</div></section>';
  }


  function renderServerUnsupported(session) {
    const protocol = getConnectionTypeLabel(session && session.connectionType);
    return '<div class="server-disabled-state"><div><div class="server-disabled-title">Server management requires SSH/SFTP.</div><div>' + escapeHtml(protocol) + ' connections support file browsing and transfers only.</div></div></div>';
  }

  function getServerAutoRefreshLabel(value) {
    if (value === '15') return 'Auto: 15s';
    if (value === '30') return 'Auto: 30s';
    if (value === '60') return 'Auto: 1m';
    if (value === '300') return 'Auto: 5m';
    return 'Auto: Off';
  }

  function updateServerAutoRefreshDropdown() {
    if (serverAutoRefreshDropdownLabel) serverAutoRefreshDropdownLabel.textContent = getServerAutoRefreshLabel(serverAutoRefreshValue);
    if (!serverAutoRefreshDropdownMenu) return;
    Array.from(serverAutoRefreshDropdownMenu.querySelectorAll('[data-server-auto-refresh]')).forEach(item => {
      const selected = item.getAttribute('data-server-auto-refresh') === serverAutoRefreshValue;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function showServerAutoRefreshDropdown() {
    if (!serverAutoRefreshDropdownButton || !serverAutoRefreshDropdownMenu || serverAutoRefreshDropdownButton.disabled) return;
    hideProfileDropdown();
    hideConnectionTypeDropdown();
    hideAuthDropdown();
    serverAutoRefreshDropdownOpen = true;
    const picker = serverAutoRefreshDropdownButton.closest('#serverAutoRefreshPicker');
    if (picker) picker.classList.add('open');
    serverAutoRefreshDropdownButton.setAttribute('aria-expanded', 'true');
    updateServerAutoRefreshDropdown();
  }

  function hideServerAutoRefreshDropdown() {
    if (!serverAutoRefreshDropdownButton) return;
    serverAutoRefreshDropdownOpen = false;
    const picker = serverAutoRefreshDropdownButton.closest('#serverAutoRefreshPicker');
    if (picker) picker.classList.remove('open');
    serverAutoRefreshDropdownButton.setAttribute('aria-expanded', 'false');
  }

  function toggleServerAutoRefreshDropdown() {
    if (serverAutoRefreshDropdownOpen) {
      hideServerAutoRefreshDropdown();
    } else {
      showServerAutoRefreshDropdown();
    }
  }

  function selectServerAutoRefresh(value) {
    const nextValue = ['15', '30', '60', '300'].includes(value) ? value : 'off';
    serverAutoRefreshValue = nextValue;
    updateServerAutoRefreshDropdown();
    updateServerAutoRefreshTimer();
  }

  function renderConnectionViewSwitchMarkup(extraClass) {
    const className = 'connection-view-switch' + (extraClass ? ' ' + extraClass : '');
    return '<div class="' + className + '" role="tablist" aria-label="Connection View"><button class="connection-view-switch-button" type="button" role="tab" aria-selected="false" aria-controls="filesView" data-connection-view="files">Files</button><button class="connection-view-switch-button" type="button" role="tab" aria-selected="false" aria-controls="serverView" data-connection-view="server">Server</button></div>';
  }

  function renderServerViewIfActiveRemoteCommandConnection(connectionId) {
    if (getActiveConnectionView() !== 'server') return;
    if (String(connectionId || activeConnectionId || '') !== String(activeConnectionId || '')) return;
    renderServerView();
  }

  function renderServerView() {
    if (!serverViewContent) return;
    const previousScrollState = captureServerViewScrollState();
    const active = getActiveSession();
    if (!active) {
      serverViewContent.removeAttribute('data-server-view-connection-id');
      serverViewContent.innerHTML = '<div class="server-disabled-state"><div><div class="server-disabled-title">No active connection.</div><div>Connect to a host to use the Server view.</div></div></div>';
      return;
    }

    const connectionId = String(active.id || activeConnectionId || '');
    serverViewContent.setAttribute('data-server-view-connection-id', connectionId);

    if (!isServerViewSupported(active)) {
      serverViewContent.innerHTML = renderServerUnsupported(active);
      return;
    }

    serverViewContent.innerHTML = '<div class="server-overview-grid">' + renderServerOverviewCards() + '</div>'
      + '<div class="server-grid">' + renderServerQuickTasks() + renderServerLogs(active) + renderServerServices() + renderServerProcesses() + renderServerCron() + renderServerPortForwarding() + renderServerSystemInfo(active) + '</div>';
    restoreServerViewScrollState(previousScrollState, connectionId);
  }

  function updateConnectionViewUi() {
    const active = getActiveSession();
    const hasActive = Boolean(active);
    pruneConnectionViewState();

    const activeView = getActiveConnectionView();
    const serverSupported = isServerViewSupported(active);

    if (filesView) filesView.classList.toggle('hidden', activeView !== 'files');
    if (serverView) serverView.classList.toggle('hidden', activeView !== 'server');
    if (pathbar) pathbar.classList.toggle('server-toolbar-mode', activeView === 'server');
    if (serverToolbarStatus) {
      serverToolbarStatus.hidden = activeView !== 'server';
      if (activeView !== 'server') serverToolbarStatus.classList.remove('visible');
    }
    const showServerRefreshControls = activeView === 'server' && hasActive && serverSupported;
    if (serverRefreshActions) serverRefreshActions.hidden = !showServerRefreshControls;
    if (serverRefreshActionsSeparator) serverRefreshActionsSeparator.hidden = !showServerRefreshControls;
    if (serverRefreshButton) serverRefreshButton.disabled = !showServerRefreshControls;
    if (serverAutoRefreshDropdownButton) serverAutoRefreshDropdownButton.disabled = !showServerRefreshControls;
    if (!showServerRefreshControls) hideServerAutoRefreshDropdown();
    renderServerView();
    updateServerRefreshBusyState();
    maybeRequestServerDashboardForActiveView();
    updateServerAutoRefreshTimer();

    const showConnectionViewSwitch = !hasActive || serverSupported;
    if (pathbar) pathbar.classList.toggle('hide-view-switch-actions', !showConnectionViewSwitch);
    document.querySelectorAll('.connection-view-switch').forEach(switchEl => {
      switchEl.hidden = !showConnectionViewSwitch;
    });
    document.querySelectorAll('.view-switch-separator').forEach(separator => {
      separator.hidden = !showConnectionViewSwitch;
    });
    document.querySelectorAll('[data-connection-view]').forEach(button => {
      const view = button.getAttribute('data-connection-view') || 'files';
      const isActive = view === activeView;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.disabled = !hasActive || (view === 'server' && !serverSupported);
      if (hasActive && view === 'server' && !serverSupported) { button.setAttribute('data-tooltip', 'Server management requires SSH/SFTP.'); } else { button.removeAttribute('data-tooltip'); }
    });
  }

  function handleServerViewAction(action) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;
    if (action === 'open-files') {
      setActiveConnectionView('files');
      return;
    }
    if (action === 'open-terminal') {
      vscode.postMessage({ type: 'requestOpenSshTerminal', payload: { connectionId: activeConnectionId, workingDirectory: normalizeUiRemotePath(currentPath.value || active.currentPath || '/') } });
      return;
    }
    if (action === 'run-command') {
      showRemoteCommandDialog(normalizeUiRemotePath(currentPath.value || active.currentPath || '/'));
      return;
    }
    if (action === 'open-log-viewer') {
      vscode.postMessage({ type: 'requestOpenLogViewer', payload: { connectionId: activeConnectionId } });
      return;
    }
    if (action === 'refresh') {
      requestServerDashboardRefresh(true);
    }
  }


  function getRemoteCommandConnectionSudoDefault(connectionId) {
    const active = sessions.find(item => item.id === connectionId) || getActiveSession();
    const username = active ? String(active.username || '').trim() : '';
    const isRootConnection = username.toLowerCase() === 'root';
    return Boolean(active && active.sudoModeEnabled && !isRootConnection);
  }

  function resetRemoteCommandSessionForQuickTask(state, workingDirectory) {
    if (!state || state.status === 'running') return;
    state.status = 'idle';
    state.commandId = '';
    state.command = '';
    state.workingDirectory = normalizeUiRemotePath(workingDirectory || state.workingDirectory || currentPath.value || '/');
    state.useSudo = getRemoteCommandConnectionSudoDefault(state.connectionId || activeConnectionId);
    state.outputText = '';
    state.finalMessage = '';
    state.outputViewLimited = false;
    state.stopping = false;
    state.forceKilling = false;
    state.exitCode = undefined;
    state.error = '';
    state.startedAt = 0;
    state.finishedAt = 0;
    state.finishedBadgeVisible = false;
    state.commandCount = 0;
    state.failedCommandCount = 0;
    clearRemoteCommandStopEscalationTimer();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');
  }

  function handleServerQuickTaskAction(commandId, autoRun) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active) || !activeConnectionId) return;

    const state = getRemoteCommandSession(activeConnectionId);
    const workingDirectory = normalizeUiRemotePath(currentPath.value || active.currentPath || '/');
    if (state.status === 'running') {
      showRemoteCommandDialog(workingDirectory);
      return;
    }

    const id = String(commandId || '').trim();
    const item = getRemoteCommandSavedList(activeConnectionId).find(command => command.id === id);
    if (!item) {
      resetRemoteCommandSessionForQuickTask(state, workingDirectory);
      showRemoteCommandDialog(workingDirectory);
      renderRemoteCommandSession();
      return;
    }

    resetRemoteCommandSessionForQuickTask(state, workingDirectory);
    showRemoteCommandDialog(workingDirectory);
    renderRemoteCommandSession();
    loadRemoteCommandIntoEditor(item, false);

    if (autoRun) {
      runRemoteCommandFromDialog();
    }
  }

  function handleServerQuickTaskAddAction() {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active) || !activeConnectionId) return;

    const state = getRemoteCommandSession(activeConnectionId);
    const workingDirectory = normalizeUiRemotePath(currentPath.value || active.currentPath || '/');
    if (state.status === 'running') {
      showRemoteCommandDialog(workingDirectory);
      return;
    }

    resetRemoteCommandSessionForQuickTask(state, workingDirectory);
    showRemoteCommandDialog(workingDirectory);
    renderRemoteCommandSession();
  }

  function readServerScheduledJobDataset(element) {
    return {
      id: element.getAttribute('data-server-scheduled-id') || '',
      name: element.getAttribute('data-server-scheduled-name') || '',
      countLabel: element.getAttribute('data-server-scheduled-count') || '',
      typeLabel: element.getAttribute('data-server-scheduled-type-label') || '',
      source: element.getAttribute('data-server-scheduled-source') || '',
      sourceType: element.getAttribute('data-server-scheduled-source-type') || '',
      user: element.getAttribute('data-server-scheduled-user') || '',
      path: element.getAttribute('data-server-scheduled-path') || '',
      copyValue: element.getAttribute('data-server-scheduled-copy') || ''
    };
  }

  function handleServerScheduledJobAction(action, item, feedbackTarget = null) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active) || !activeConnectionId) return;

    const payload = Object.assign({}, item || {}, { connectionId: activeConnectionId, action: action || 'open' });
    if (action === 'copy') {
      const value = String(payload.copyValue || payload.path || payload.source || payload.name || '').trim();
      if (!value) return;
      void copyTextFromEditableMenu(value);
      showTransientActionTooltip(feedbackTarget, 'Copied');
      return;
    }
    vscode.postMessage({ type: 'requestServerScheduledJobAction', payload: payload });
  }

  function readServerProcessDataset(element) {
    return {
      pid: element.getAttribute('data-server-process-pid') || '',
      user: element.getAttribute('data-server-process-user') || '',
      cpu: element.getAttribute('data-server-process-cpu') || '',
      memory: element.getAttribute('data-server-process-memory') || '',
      command: element.getAttribute('data-server-process-command') || '',
      args: element.getAttribute('data-server-process-args') || '',
      adapter: element.getAttribute('data-server-process-adapter') || ''
    };
  }

  function handleServerProcessAction(action, process) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active) || !activeConnectionId) return;

    const pid = String(process && process.pid || '').trim();
    if (!pid) return;

    const payload = Object.assign({}, process || {}, { connectionId: activeConnectionId, pid: pid });
    if (action === 'details') {
      vscode.postMessage({ type: 'requestServerProcessDetails', payload: payload });
      return;
    }

    if (action === 'kill') {
      vscode.postMessage({ type: 'requestServerProcessAction', payload: payload });
    }
  }

  function handleServerServiceAction(action, serviceName, adapter) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active) || !activeConnectionId) return;

    const normalizedName = String(serviceName || '').trim();
    const normalizedAdapter = String(adapter || '').trim();
    if (!normalizedName) return;

    if (action === 'details') {
      vscode.postMessage({ type: 'requestServerServiceDetails', payload: { connectionId: activeConnectionId, name: normalizedName, adapter: normalizedAdapter } });
      return;
    }

    if (action === 'start' || action === 'stop' || action === 'restart') {
      vscode.postMessage({ type: 'requestServerServiceAction', payload: { connectionId: activeConnectionId, name: normalizedName, adapter: normalizedAdapter, action: action } });
    }
  }

  function handleServerLogAction(action, shortcutId, path, feedbackTarget = null) {
    const active = getActiveSession();
    if (!active || !isServerViewSupported(active)) return;

    if (action === 'add') {
      showServerLogShortcutDialog('add', '');
      return;
    }

    const shortcut = shortcutId ? getServerLogShortcutById(active, shortcutId) : null;
    const normalizedPath = normalizeUiRemotePath((shortcut && shortcut.path) || path || '');
    if (!activeConnectionId || !normalizedPath || normalizedPath === '/') return;

    if (action === 'edit') {
      if (shortcut) showServerLogShortcutDialog('edit', shortcut.id);
      return;
    }

    if (action === 'remove') {
      if (shortcut) showServerLogShortcutRemoveDialog(shortcut.id);
      return;
    }

    if (action === 'copy') {
      void copyTextFromEditableMenu(normalizedPath);
      showTransientActionTooltip(feedbackTarget, 'Copied');
      return;
    }

    const entry = {
      path: normalizedPath,
      name: (shortcut && shortcut.name) || getRemotePathBasename(normalizedPath),
      type: 'file',
      effectiveType: 'file',
      linkTarget: '',
      permissions: ''
    };

    if (action === 'open') {
      vscode.postMessage({ type: 'openEntries', payload: { entries: [entry] } });
      return;
    }

    if (action === 'follow') {
      vscode.postMessage({ type: 'requestOpenLogViewer', payload: { connectionId: activeConnectionId, path: normalizedPath } });
      return;
    }

    vscode.postMessage({ type: 'openEntriesReadOnly', payload: { entries: [entry] } });
  }

  function updateSudoToggle() {
    const active = getActiveSession();
    const capabilities = getActiveRemoteCapabilities();
    const enabled = Boolean(capabilities.canUseSudo && active && active.sudoModeEnabled);
    const isRootConnection = Boolean(capabilities.canUseSudo && active && String(active.username || '').trim().toLowerCase() === 'root');
    const isPrivilegedSession = enabled || isRootConnection;

    sudoToggle.checked = enabled;
    sudoToggleLabel.classList.toggle('enabled', enabled);
    sudoToggleLabel.classList.toggle('disabled', Boolean(sudoToggle.disabled));
    sudoToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    entriesTableWrap.classList.toggle('privileged-session', isPrivilegedSession);
    sudoToggleLabel.dataset.tooltip = !active
      ? 'Enable Sudo Mode'
      : enabled
        ? 'Disable Sudo Mode'
        : 'Enable Sudo Mode';
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
        separator.setAttribute('data-tooltip', 'Show folders under ' + parentPart.path);
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
      button.setAttribute('data-tooltip', part.path);
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

  function findRemotePathBreadcrumbToggle(path) {
    if (!remotePathBreadcrumb) return null;
    const normalizedPath = normalizeUiRemotePath(path || '/');
    return Array.from(remotePathBreadcrumb.querySelectorAll('[data-breadcrumb-toggle]'))
      .find(item => normalizeUiRemotePath(item.dataset.breadcrumbToggle || '/') === normalizedPath) || null;
  }

  function refreshOpenRemotePathDropdown() {
    if (!breadcrumbDropdownState.open || !activeConnectionId) return;
    const normalizedPath = normalizeUiRemotePath(breadcrumbDropdownState.path || '/');
    const requestId = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    const anchor = findRemotePathBreadcrumbToggle(normalizedPath);
    breadcrumbDropdownState = { open: true, path: normalizedPath, requestId, anchorPath: normalizedPath };
    updateRemotePathBreadcrumb();
    if (anchor) positionRemotePathDropdown(anchor);
    renderRemotePathDropdown('loading', normalizedPath);

    vscode.postMessage({
      type: 'requestBreadcrumbDirectories',
      payload: { path: normalizedPath, requestId }
    });
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
    title.setAttribute('data-tooltip', path || '/');
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
      button.setAttribute('data-tooltip', item.path || item.name || '');

      const name = document.createElement('span');
      name.className = 'remote-path-dropdown-name';
      name.textContent = item.name || item.path || '';
      button.appendChild(name);

      if (showRemotePathBreadcrumbDirectoryDetails) {
        const meta = document.createElement('span');
        meta.className = 'remote-path-dropdown-meta';

        const ownerGroup = document.createElement('span');
        ownerGroup.className = 'remote-path-dropdown-meta-owner';
        ownerGroup.textContent = [item.owner, item.group].filter(Boolean).join(':');
        meta.appendChild(ownerGroup);

        const permissions = document.createElement('span');
        permissions.className = 'remote-path-dropdown-meta-permissions';
        permissions.textContent = item.permissions || '';
        meta.appendChild(permissions);

        button.appendChild(meta);
      }

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

  function isSessionConnected(session) {
    return Boolean(session) && (!session.connectionState || session.connectionState === 'connected');
  }

  function isSessionConnecting(session) {
    return Boolean(session && session.connectionState === 'connecting');
  }

  function isSessionFailed(session) {
    return Boolean(session && session.connectionState === 'failed');
  }

  function mergeIncomingSessionsWithClientPending(incomingSessions) {
    const incomingIds = new Set((incomingSessions || []).map(session => session.id));
    const pendingSessions = Array.from(clientPendingSessionsByConnectionId.values())
      .filter(session => session && session.id && !incomingIds.has(session.id));
    return [...(incomingSessions || []), ...pendingSessions];
  }

  function createClientConnectionId(payload) {
    const profileId = String(payload && payload.id || '').trim();
    if (profileId) return profileId;
    return 'quick-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function createClientPendingSession(payload, connectionId) {
    const id = String(connectionId || '').trim();
    if (!id) return;

    const session = {
      id,
      connectionType: normalizeConnectionTypeValue(payload.connectionType),
      name: String(payload.name || '').trim() || (String(payload.username || '').trim() + '@' + String(payload.host || '').trim()),
      host: String(payload.host || '').trim(),
      port: Number(payload.port || getDefaultPortForConnectionType(payload.connectionType)),
      username: String(payload.username || '').trim(),
      authType: String(payload.authType || 'password'),
      privateKeyPath: String(payload.privateKeyPath || '').trim(),
      startPath: normalizeUiRemotePath(payload.startPath || '/'),
      currentPath: normalizeUiRemotePath(payload.startPath || '/'),
      keepAlive: payload.keepAlive !== false,
      isQuickConnect: !payload.id,
      sudoModeEnabled: false,
      connectionState: 'connecting'
    };

    clientPendingSessionsByConnectionId.set(id, session);
    sessions = mergeIncomingSessionsWithClientPending(sessions.filter(item => item.id !== id));
    activeConnectionId = id;
    currentEntries = [];
    selectedEntryPath = '';
    selectedEntryPaths.clear();
    filterText = '';
    filterInput.value = '';
    updateFilterClearButton();
    currentSort = { key: '', direction: '' };
    entriesBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Connecting...</div></td></tr>';
    currentPath.value = session.currentPath || '/';
    setBusy(true, 'Connecting to ' + (session.name || session.host) + '...', 'connection', 'Cancel', id);
    renderSessionTabs();
    updateActiveSessionUi();
    updateConnectionViewUi();
    setControls();
  }

  function markClientPendingSessionFailed(connectionId, message) {
    const id = String(connectionId || '').trim();
    if (!id) return;
    const existing = clientPendingSessionsByConnectionId.get(id) || sessions.find(session => session.id === id);
    if (!existing || isSessionConnected(existing)) return;
    const failed = Object.assign({}, existing, { connectionState: 'failed', error: String(message || 'Connection failed.') });
    clientPendingSessionsByConnectionId.set(id, failed);
    sessions = sessions.map(session => session.id === id ? failed : session);
    renderSessionTabs();
    if (activeConnectionId === id) updateActiveSessionUi();
    setControls();
  }

  function removeClientPendingSession(connectionId) {
    const id = String(connectionId || '').trim();
    if (!id) return;
    const session = clientPendingSessionsByConnectionId.get(id) || sessions.find(item => item.id === id);
    clientPendingSessionsByConnectionId.delete(id);
    filesStatusByConnectionId.delete(id);
    sessions = sessions.filter(item => item.id !== id);
    if (activeConnectionId === id) {
      const fallback = sessions.find(isSessionConnected) || sessions[0];
      activeConnectionId = fallback ? fallback.id : '';
      if (fallback && isSessionConnected(fallback)) {
        vscode.postMessage({ type: 'switchSession', payload: { connectionId: fallback.id } });
      } else {
        currentEntries = [];
        entriesBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Connect to a host to list remote files.</div></td></tr>';
        currentPath.value = '';
        setStatus('No active connection.');
      }
    }
    renderSessionTabs();
    updateActiveSessionUi();
    updateConnectionViewUi();
    setControls();
    if (session && isSessionConnecting(session)) vscode.postMessage({ type: 'cancelConnection', payload: { connectionId: id } });
  }

  function findSessionForCurrentForm(predicate) {
    const matchesForm = session => {
      if (!session) return false;
      if (selectedProfileId) return session.id === selectedProfileId;
      const hostValue = String(host.value || '').trim();
      const portValue = Number(port.value || 22);
      const usernameValue = String(username.value || '').trim();
      const authTypeValue = String(authType.value || 'password');
      const connectionTypeValue = normalizeConnectionTypeValue(connectionType.value);
      return String(session.host || '').trim() === hostValue
        && normalizeConnectionTypeValue(session.connectionType) === connectionTypeValue
        && Number(session.port || getDefaultPortForConnectionType(session.connectionType)) === portValue
        && String(session.username || '').trim() === usernameValue
        && String(session.authType || 'password') === authTypeValue;
    };
    return sessions.find(session => matchesForm(session) && predicate(session));
  }

  function getPendingSessionForCurrentForm() {
    return findSessionForCurrentForm(session => isSessionConnecting(session));
  }

  function hasAnyConnectingSession() {
    return sessions.some(isSessionConnecting) || Array.from(clientPendingSessionsByConnectionId.values()).some(isSessionConnecting);
  }

  function getConnectedSessionForCurrentForm() {
    return findSessionForCurrentForm(session => isSessionConnected(session));
  }

  function getSessionForProfileId(profileId, predicate) {
    const id = String(profileId || '').trim();
    if (!id) return null;
    return sessions.find(session => session && session.id === id && predicate(session)) || null;
  }

  function getPendingSessionForProfileId(profileId) {
    return getSessionForProfileId(profileId, session => isSessionConnecting(session));
  }

  function getConnectedSessionForProfileId(profileId) {
    return getSessionForProfileId(profileId, session => isSessionConnected(session));
  }

  function collectConnectionPayloadFromProfile(profile) {
    if (!profile) return null;
    const connectionTypeValue = normalizeConnectionTypeValue(profile.connectionType);
    return {
      id: profile.id,
      name: profile.name,
      host: profile.host,
      connectionType: connectionTypeValue,
      port: profile.port || getDefaultPortForConnectionType(connectionTypeValue),
      username: profile.username,
      authType: connectionTypeValue === 'sftp' ? (profile.authType || 'password') : 'password',
      password: '',
      rememberPassword: Boolean(profile.hasSavedPassword),
      privateKeyPath: profile.privateKeyPath || '',
      passphrase: '',
      rememberPassphrase: Boolean(profile.hasSavedPassphrase),
      startPath: profile.startPath || '',
      keepAlive: profile.keepAlive !== false,
      ftpsAllowSelfSignedCertificate: Boolean(profile.ftpsAllowSelfSignedCertificate),
      ftpsCaCertificatePath: profile.ftpsCaCertificatePath || ''
    };
  }

  function handleProfileDropdownAction(profileId) {
    const id = String(profileId || '').trim();
    if (!id) return;

    const connectedSession = getConnectedSessionForProfileId(id);
    if (connectedSession) {
      profileDisconnectingIds.add(id);
      renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
      setBusy(true, 'Disconnecting...', '', 'Cancel', connectedSession.id);
      vscode.postMessage({ type: 'disconnect', payload: { connectionId: connectedSession.id } });
      return;
    }

    const pendingSession = getPendingSessionForProfileId(id);
    if (pendingSession) {
      activateClientSession(pendingSession.id);
      renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
      return;
    }

    const profile = profiles.find(item => item && item.id === id);
    if (!profile) return;
    const payload = collectConnectionPayloadFromProfile(profile);
    if (!payload) return;
    const clientConnectionId = createClientConnectionId(payload);
    payload.clientConnectionId = clientConnectionId;
    createClientPendingSession(payload, clientConnectionId);
    renderProfileDropdown({ preserveFilter: true, preserveScroll: true });
    vscode.postMessage({ type: 'connect', payload });
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
        selectProfile(profile.id, { preserveStatus: true, keepDropdownOpen: profileDropdownOpen });
      }
      lastSyncedActiveConnectionId = active.id;
      return;
    }

    selectedProfileId = '';
    profileSelect.value = '';
    if (!profileDropdownOpen) hideProfileDropdown();
    fillFormFromSession(active);
    updateProfileDropdownLabel();
    renderProfileDropdown({ preserveFilter: profileDropdownOpen, preserveScroll: profileDropdownOpen });
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
    const savedCommandCount = Number(summary.savedCommandCount || 0);
    const portForwardCount = Number(summary.portForwardCount || 0);
    const serverLogShortcutCount = Number(summary.serverLogShortcutCount || 0);
    const logViewerFavoriteCount = Number(summary.logViewerFavoriteCount || 0);
    const parts = [
      summary.hasSettings ? 'Settings included' : 'Settings not included',
      connectionCount === 1 ? '1 connection' : connectionCount + ' connections',
      favoriteCount === 1 ? '1 favorite' : favoriteCount + ' favorites',
      summary.usernamesIncluded ? 'usernames included' : 'usernames not included',
      summary.hasEncryptedCredentials ? 'passwords/passphrases encrypted' : 'passwords/passphrases not included'
    ];

    if (savedCommandCount) parts.push(savedCommandCount === 1 ? '1 saved command' : savedCommandCount + ' saved commands');
    if (portForwardCount) parts.push(portForwardCount === 1 ? '1 port forward' : portForwardCount + ' port forwards');
    if (serverLogShortcutCount) parts.push(serverLogShortcutCount === 1 ? '1 log shortcut' : serverLogShortcutCount + ' log shortcuts');
    if (logViewerFavoriteCount) parts.push(logViewerFavoriteCount === 1 ? '1 log favorite' : logViewerFavoriteCount + ' log favorites');

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

  // SVGs copied from the same icons used by the Sidebar inline actions.
  const PROFILE_ACTION_CONNECT_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" focusable="false" aria-hidden="true"><path d="M10.723 4H10V1.5C10 1.224 9.776 1 9.5 1C9.224 1 9 1.224 9 1.5V4H7V1.5C7 1.224 6.776 1 6.5 1C6.224 1 6 1.224 6 1.5V4H5.277C4.573 4 4 4.573 4 5.278V8C4 10.036 5.529 11.722 7.5 11.969V14.5C7.5 14.776 7.724 15 8 15C8.276 15 8.5 14.776 8.5 14.5V11.969C10.471 11.722 12 10.037 12 8V5.278C12 4.573 11.427 4 10.723 4ZM11 8C11 9.654 9.654 11 8 11C6.346 11 5 9.654 5 8V5.278C5 5.125 5.124 5 5.277 5H10.722C10.875 5 10.999 5.125 10.999 5.278V8H11Z"/></svg>';
  const PROFILE_ACTION_DISCONNECT_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" focusable="false" aria-hidden="true"><path d="M15.3542 0.646006C15.1592 0.451006 14.8422 0.451006 14.6472 0.646006L12.5772 2.71601C11.2072 1.71701 9.20723 1.87301 7.93723 3.14401L7.80623 3.27501C7.31923 3.76201 7.31923 4.55501 7.80623 5.04301L10.9882 8.22501C11.2312 8.46901 11.5512 8.59101 11.8722 8.59101C12.1932 8.59101 12.5132 8.46901 12.7562 8.22501L12.9762 8.00501C13.6522 7.33001 14.0162 6.43101 14.0012 5.47601C13.9892 4.72001 13.7412 4.00601 13.2912 3.41701L15.3542 1.35401C15.5492 1.15901 15.5492 0.841006 15.3542 0.646006ZM12.2682 7.29701L12.0482 7.51701C11.9502 7.61501 11.7922 7.61501 11.6942 7.51701L8.51223 4.33501C8.41423 4.23701 8.41423 4.07901 8.51223 3.98101L8.64323 3.85001C9.16723 3.32601 9.86023 3.06001 10.5402 3.06001C11.1502 3.06001 11.7512 3.27401 12.2112 3.70801C12.7092 4.17601 12.9882 4.80901 12.9992 5.49101C13.0092 6.17301 12.7502 6.81501 12.2682 7.29701ZM8.14623 9.14601L7.26623 10.026L5.97323 8.73301L6.85323 7.85301C7.04823 7.65801 7.04823 7.34101 6.85323 7.14601C6.65823 6.95101 6.34123 6.95101 6.14623 7.14601L5.26623 8.02601L5.01323 7.77301C4.52723 7.28701 3.73223 7.28701 3.24523 7.77401L3.02523 7.99401C2.34923 8.66901 1.98523 9.56801 2.00023 10.523C2.01223 11.279 2.26023 11.993 2.71023 12.582L0.647227 14.645C0.452227 14.84 0.452227 15.157 0.647227 15.352C0.745227 15.45 0.873227 15.498 1.00123 15.498C1.12923 15.498 1.25723 15.449 1.35523 15.352L3.42523 13.282C4.02223 13.717 4.73723 13.934 5.46123 13.934C6.39923 13.934 7.34923 13.571 8.06523 12.854L8.19623 12.723C8.68323 12.236 8.68323 11.443 8.19623 10.955L7.97423 10.733L8.85423 9.85301C9.04923 9.65801 9.04923 9.34101 8.85423 9.14601C8.65923 8.95101 8.34223 8.95101 8.14723 9.14601H8.14623ZM7.48923 12.018L7.35723 12.149C6.36323 13.144 4.76123 13.208 3.78923 12.291C3.29123 11.823 3.01223 11.19 3.00123 10.508C2.99123 9.82601 3.25123 9.18401 3.73323 8.70201L3.95323 8.48201C4.00223 8.43301 4.06523 8.40901 4.13023 8.40901C4.19523 8.40901 4.25823 8.43301 4.30723 8.48201C5.37118 9.54596 6.42725 10.602 7.48723 11.662C7.58523 11.76 7.58523 11.918 7.48723 12.016L7.48923 12.018Z"/></svg>';
  const MANAGE_ICON_RENAME = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="M200-200h57.46l391.77-391.77-57.46-57.46L200-257.46V-200Zm-40 40v-114.15l489.23-489.23q5.85-5.85 13.08-8.54 7.23-2.69 14.69-2.69 7.46 0 14.88 2.69 7.43 2.69 13.27 8.54l57.23 57.23q5.85 5.84 8.54 13.27 2.69 7.42 2.69 14.88 0 7.46-2.69 14.69-2.69 7.23-8.54 13.08L274.15-160H160Zm432-489.23 57.23 57.46L592-649.23Z"></path></svg>';
  const MANAGE_ICON_SAVE = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="M382-267.69 194.69-455l28.31-28.31 159 159 355-355L765.31-651 382-267.69Z"></path></svg>';
  const MANAGE_ICON_CANCEL = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="m256-227.69-28.31-28.31 224-224-224-224L256-732.31l224 224 224-224 28.31 28.31-224 224 224 224L704-227.69l-224-224-224 224Z"></path></svg>';
  const MANAGE_ICON_DELETE = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="M292.31-140q-29.83 0-51.07-21.24Q220-182.48 220-212.31V-720h-40v-40h180v-40h240v40h180v40h-40v507.69q0 29.83-21.24 51.07Q697.52-140 667.69-140H292.31ZM700-720H260v507.69q0 13.85 9.23 23.08 9.23 9.23 23.08 9.23h375.38q13.85 0 23.08-9.23 9.23-9.23 9.23-23.08V-720ZM376.92-266.15h40v-367.7h-40v367.7Zm166.16 0h40v-367.7h-40v367.7ZM260-720v540-540Z"></path></svg>';
  const MANAGE_ICON_DRAG = '<svg viewBox="0 -960 960 960" focusable="false" aria-hidden="true"><path d="M360-220q-24.75 0-42.37-17.63Q300-255.25 300-280q0-24.75 17.63-42.37Q335.25-340 360-340q24.75 0 42.38 17.63Q420-304.75 420-280q0 24.75-17.62 42.37Q384.75-220 360-220Zm240 0q-24.75 0-42.37-17.63Q540-255.25 540-280q0-24.75 17.63-42.37Q575.25-340 600-340q24.75 0 42.38 17.63Q660-304.75 660-280q0 24.75-17.62 42.37Q624.75-220 600-220ZM360-420q-24.75 0-42.37-17.63Q300-455.25 300-480q0-24.75 17.63-42.37Q335.25-540 360-540q24.75 0 42.38 17.63Q420-504.75 420-480q0 24.75-17.62 42.37Q384.75-420 360-420Zm240 0q-24.75 0-42.37-17.63Q540-455.25 540-480q0-24.75 17.63-42.37Q575.25-540 600-540q24.75 0 42.38 17.63Q660-504.75 660-480q0 24.75-17.62 42.37Q624.75-420 600-420ZM360-620q-24.75 0-42.37-17.63Q300-655.25 300-680q0-24.75 17.63-42.37Q335.25-740 360-740q24.75 0 42.38 17.63Q420-704.75 420-680q0 24.75-17.62 42.37Q384.75-620 360-620Zm240 0q-24.75 0-42.37-17.63Q540-655.25 540-680q0-24.75 17.63-42.37Q575.25-740 600-740q24.75 0 42.38 17.63Q660-704.75 660-680q0 24.75-17.62 42.37Q624.75-620 600-620Z"></path></svg>';

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

  function getManageProfileOrder() {
    return profiles.map(profile => profile.id).filter(Boolean);
  }

  function ensureManageProfileDropLine() {
    if (!manageProfilesList) return null;
    let line = manageProfilesList.querySelector('.manage-profiles-drop-line');
    if (!line) {
      line = document.createElement('div');
      line.className = 'manage-profiles-drop-line';
      line.setAttribute('aria-hidden', 'true');
      manageProfilesList.appendChild(line);
    }
    return line;
  }

  function hideManageProfileDropLine() {
    if (!manageProfilesList) return;
    const line = manageProfilesList.querySelector('.manage-profiles-drop-line');
    if (line) {
      line.style.display = 'none';
      line.style.top = '';
    }
  }

  function clearManageProfileDropIndicators() {
    if (!manageProfilesList) return;
    for (const row of Array.from(manageProfilesList.querySelectorAll('.manage-profile-row'))) {
      row.classList.remove('drag-over-before', 'drag-over-after');
    }
    hideManageProfileDropLine();
  }

  function clearManageProfileDragState() {
    draggedManageProfileId = '';
    manageProfileDragOverId = '';
    manageProfileDragOverPosition = '';
    manageProfileDragging = false;
    hideManageProfileDropLine();
    if (!manageProfilesList) return;
    for (const row of Array.from(manageProfilesList.querySelectorAll('.manage-profile-row'))) {
      row.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
    }
  }

  function getManageProfileRows() {
    if (!manageProfilesList) return [];
    return Array.from(manageProfilesList.querySelectorAll('.manage-profile-row[data-profile-id]'));
  }

  function getManageProfileInsertionIndex(profileId, position) {
    const rows = getManageProfileRows();
    const index = rows.findIndex(row => (row.dataset.profileId || '') === profileId);
    if (index < 0) return -1;
    return position === 'after' ? index + 1 : index;
  }

  function showManageProfileDropLine(insertionIndex) {
    const rows = getManageProfileRows();
    if (!manageProfilesList || !rows.length || insertionIndex < 0) return;
    const line = ensureManageProfileDropLine();
    if (!line) return;
    const clampedIndex = Math.max(0, Math.min(insertionIndex, rows.length));
    const lineHeight = Math.max(1, line.offsetHeight || 1);
    let top = 0;
    if (clampedIndex <= 0) {
      const firstRow = rows[0];
      top = (firstRow.offsetTop - lineHeight) / 2;
    } else if (clampedIndex >= rows.length) {
      const lastRow = rows[rows.length - 1];
      const listHeight = manageProfilesList.scrollHeight || manageProfilesList.clientHeight || (lastRow.offsetTop + lastRow.offsetHeight);
      top = ((lastRow.offsetTop + lastRow.offsetHeight) + listHeight - lineHeight) / 2;
    } else {
      const previousRow = rows[clampedIndex - 1];
      const nextRow = rows[clampedIndex];
      top = ((previousRow.offsetTop + previousRow.offsetHeight) + nextRow.offsetTop - lineHeight) / 2;
    }
    line.style.top = Math.max(0, top) + 'px';
    line.style.display = 'block';
  }

  function setManageProfileDropIndicator(profileId, position) {
    if (!profileId || !position) return;
    const insertionIndex = getManageProfileInsertionIndex(profileId, position);
    if (insertionIndex < 0) return;
    if (manageProfileDragOverId === profileId && manageProfileDragOverPosition === position) {
      showManageProfileDropLine(insertionIndex);
      return;
    }
    clearManageProfileDropIndicators();
    manageProfileDragOverId = profileId;
    manageProfileDragOverPosition = position;
    showManageProfileDropLine(insertionIndex);
  }

  function getManageProfileDropPosition(event, row) {
    const rect = row.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  function isManageProfileReorderDragActive() {
    return Boolean(manageProfilesDialogOpen && draggedManageProfileId && !String(manageProfilesFilterText || '').trim());
  }

  function getManageProfilesDialogRect() {
    const dialog = manageProfilesBackdrop ? manageProfilesBackdrop.querySelector('.manage-profiles-dialog') : null;
    return dialog ? dialog.getBoundingClientRect() : null;
  }

  function getManageProfileDropTarget(event) {
    const rows = getManageProfileRows();
    if (!rows.length || !manageProfilesList) return null;

    const dialogRect = getManageProfilesDialogRect();
    if (dialogRect) {
      const horizontalPadding = 24;
      const verticalPadding = 8;
      const insideDialog = event.clientX >= dialogRect.left - horizontalPadding && event.clientX <= dialogRect.right + horizontalPadding && event.clientY >= dialogRect.top - verticalPadding && event.clientY <= dialogRect.bottom + verticalPadding;
      if (!insideDialog) return null;
    }

    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    const firstRect = firstRow.getBoundingClientRect();
    const lastRect = lastRow.getBoundingClientRect();

    let insertionIndex = rows.length;
    if (event.clientY <= firstRect.top) {
      insertionIndex = 0;
    } else if (event.clientY >= lastRect.bottom) {
      insertionIndex = rows.length;
    } else {
      for (let index = 0; index < rows.length; index += 1) {
        const rect = rows[index].getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        if (event.clientY < centerY) {
          insertionIndex = index;
          break;
        }
      }
    }

    if (insertionIndex <= 0) {
      return { profileId: firstRow.dataset.profileId || '', position: 'before' };
    }
    if (insertionIndex >= rows.length) {
      return { profileId: lastRow.dataset.profileId || '', position: 'after' };
    }
    return { profileId: rows[insertionIndex].dataset.profileId || '', position: 'before' };
  }

  function handleManageProfilesDragOver(event) {
    if (!isManageProfileReorderDragActive()) return;
    const dropTarget = getManageProfileDropTarget(event);
    if (!dropTarget || !dropTarget.profileId) {
      clearManageProfileDropIndicators();
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setManageProfileDropIndicator(dropTarget.profileId, dropTarget.position);
  }

  function handleManageProfilesDrop(event) {
    if (!isManageProfileReorderDragActive()) {
      clearManageProfileDragState();
      return;
    }
    const dropTarget = getManageProfileDropTarget(event);
    event.preventDefault();
    const droppedProfileId = draggedManageProfileId;
    clearManageProfileDragState();
    if (!dropTarget || !dropTarget.profileId) return;
    if (dropTarget.profileId === droppedProfileId) return;
    reorderManageProfiles(droppedProfileId, dropTarget.profileId, dropTarget.position);
  }

  function reorderManageProfiles(draggedId, targetId, position) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const orderedIds = getManageProfileOrder();
    const fromIndex = orderedIds.indexOf(draggedId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (fromIndex < 0 || targetIndex < 0) return;

    orderedIds.splice(fromIndex, 1);
    let insertIndex = orderedIds.indexOf(targetId);
    if (insertIndex < 0) return;
    if (position === 'after') insertIndex += 1;
    orderedIds.splice(insertIndex, 0, draggedId);

    const currentOrder = getManageProfileOrder();
    if (orderedIds.length === currentOrder.length && orderedIds.every((id, index) => id === currentOrder[index])) {
      return;
    }

    const profileById = new Map(profiles.map(profile => [profile.id, profile]));
    profiles = orderedIds.map(id => profileById.get(id)).filter(Boolean);
    renderProfiles(selectedProfileId);
    vscode.postMessage({ type: 'reorderConnections', payload: { profileIds: orderedIds, selectedId: selectedProfileId } });
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
      const canReorderProfiles = !String(manageProfilesFilterText || '').trim();
      row.className = 'manage-profile-row' + (canReorderProfiles ? ' can-reorder' : '');
      row.dataset.profileId = profile.id;
      row.draggable = canReorderProfiles;

      if (renameProfileId === profile.id) {
        const dragPlaceholder = document.createElement('span');
        dragPlaceholder.className = 'manage-profile-drag-handle disabled';
        dragPlaceholder.setAttribute('aria-hidden', 'true');
        row.appendChild(dragPlaceholder);

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

      const dragHandle = document.createElement('span');
      dragHandle.className = 'manage-profile-drag-handle' + (canReorderProfiles ? '' : ' disabled');
      dragHandle.innerHTML = MANAGE_ICON_DRAG;
      dragHandle.setAttribute('aria-hidden', 'true');
      if (!canReorderProfiles) {
        dragHandle.setAttribute('data-tooltip', 'Clear the filter to reorder saved connections.');
      }
      row.appendChild(dragHandle);

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

      row.addEventListener('dragstart', event => {
        if (!canReorderProfiles) {
          event.preventDefault();
          return;
        }
        if (event.target && event.target.closest && event.target.closest('[data-manage-action], input, button')) {
          event.preventDefault();
          return;
        }
        draggedManageProfileId = profile.id || '';
        manageProfileDragOverId = '';
        manageProfileDragOverPosition = '';
        manageProfileDragging = true;
        hideWebviewTooltip();
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', draggedManageProfileId);
        }
        row.classList.add('dragging');
      });

      row.addEventListener('dragover', event => {
        if (!canReorderProfiles || !draggedManageProfileId) return;
        handleManageProfilesDragOver(event);
      });

      row.addEventListener('dragleave', event => {
        if (draggedManageProfileId) return;
        const relatedTarget = event.relatedTarget;
        if (relatedTarget && row.contains(relatedTarget)) return;
        row.classList.remove('drag-over-before', 'drag-over-after');
      });

      row.addEventListener('drop', event => {
        if (!canReorderProfiles || !draggedManageProfileId) return;
        handleManageProfilesDrop(event);
      });

      row.addEventListener('dragend', clearManageProfileDragState);

      manageProfilesList.appendChild(row);
    }
    ensureManageProfileDropLine();
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



  function readRemoteCommandCollection(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const map = new Map();
      if (parsed && typeof parsed === 'object') {
        for (const key of Object.keys(parsed)) {
          map.set(key, Array.isArray(parsed[key]) ? parsed[key] : []);
        }
      }
      return map;
    } catch (_) {
      return new Map();
    }
  }

  function persistRemoteCommandCollection(storageKey, map) {
    try {
      const raw = {};
      for (const [key, value] of map.entries()) {
        raw[key] = Array.isArray(value) ? value : [];
      }
      localStorage.setItem(storageKey, JSON.stringify(raw));
    } catch (_) {
      // Ignore localStorage failures.
    }
  }

  function mapToStorageObject(map) {
    const raw = {};
    if (!map || typeof map.entries !== 'function') return raw;
    for (const [key, value] of map.entries()) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) continue;
      raw[normalizedKey] = Array.isArray(value) ? value : [];
    }
    return raw;
  }

  function normalizePersistentStorageObject(value) {
    const normalized = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return normalized;
    Object.keys(value).forEach(key => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey || !Array.isArray(value[key])) return;
      normalized[normalizedKey] = value[key].filter(item => item && typeof item === 'object');
    });
    return normalized;
  }

  function objectToMap(value) {
    const normalized = normalizePersistentStorageObject(value);
    const map = new Map();
    Object.keys(normalized).forEach(key => {
      map.set(key, normalized[key]);
    });
    return map;
  }

  function collectPersistentStorageSnapshot() {
    return {
      savedCommands: mapToStorageObject(remoteCommandSavedByConnectionId),
      serverLogShortcuts: readServerLogShortcutsStorage(),
      portForwards: loadAllServerPortForwardsFromStorage()
    };
  }

  function postPersistentStorageSnapshot() {
    if (persistentStorageApplyingSnapshot) return;
    vscode.postMessage({
      type: 'syncPersistentStorage',
      payload: { snapshot: collectPersistentStorageSnapshot() }
    });
  }

  function applyPersistentStorageSnapshot(snapshot) {
    persistentStorageApplyingSnapshot = true;
    try {
      const savedCommands = normalizePersistentStorageObject(snapshot && snapshot.savedCommands);
      remoteCommandSavedByConnectionId.clear();
      objectToMap(savedCommands).forEach((value, key) => remoteCommandSavedByConnectionId.set(key, value));
      persistRemoteCommandCollection(REMOTE_COMMAND_STORAGE_KEY, remoteCommandSavedByConnectionId);

      const serverLogShortcuts = normalizePersistentStorageObject(snapshot && snapshot.serverLogShortcuts);
      writeServerLogShortcutsStorage(serverLogShortcuts);
      serverLogShortcutsSessionByConnectionId.clear();

      const portForwards = normalizePersistentStorageObject(snapshot && snapshot.portForwards);
      saveAllServerPortForwardsToStorage(portForwards);
      serverPortForwardsSessionByConnectionId.clear();
    } finally {
      persistentStorageApplyingSnapshot = false;
    }

    renderRemoteCommandSavedList();
    renderServerView();
  }

  function hydrateRemoteCommandStorage() {
    if (!remoteCommandSavedByConnectionId.size) {
      for (const [key, value] of readRemoteCommandCollection(REMOTE_COMMAND_STORAGE_KEY).entries()) {
        remoteCommandSavedByConnectionId.set(key, value);
      }
    }
    if (!remoteCommandHistoryByConnectionId.size) {
      for (const [key, value] of readRemoteCommandCollection(REMOTE_COMMAND_HISTORY_STORAGE_KEY).entries()) {
        remoteCommandHistoryByConnectionId.set(key, value);
      }
    }
  }

  function persistRemoteCommandSaved() {
    persistRemoteCommandCollection(REMOTE_COMMAND_STORAGE_KEY, remoteCommandSavedByConnectionId);
    postPersistentStorageSnapshot();
  }

  function persistRemoteCommandHistory() {
    persistRemoteCommandCollection(REMOTE_COMMAND_HISTORY_STORAGE_KEY, remoteCommandHistoryByConnectionId);
  }

  hydrateRemoteCommandStorage();

  function createRemoteCommandSession(connectionId) {
    return {
      connectionId: String(connectionId || ''),
      status: 'idle',
      commandId: '',
      command: '',
      workingDirectory: normalizeUiRemotePath(currentPath.value || '/'),
      useSudo: false,
      outputText: '',
      finalMessage: '',
      outputViewLimited: false,
      stopping: false,
      forceKilling: false,
      exitCode: undefined,
      error: '',
      startedAt: 0,
      finishedAt: 0,
      finishedBadgeVisible: false,
      commandCount: 0,
      failedCommandCount: 0
    };
  }

  function getRemoteCommandSession(connectionId) {
    const key = String(connectionId || activeConnectionId || '');
    if (!key) return createRemoteCommandSession('');
    let session = remoteCommandSessionsByConnectionId.get(key);
    if (!session) {
      session = createRemoteCommandSession(key);
      remoteCommandSessionsByConnectionId.set(key, session);
    }
    return session;
  }

  function findRemoteCommandSessionByCommandId(commandId) {
    const id = String(commandId || '');
    if (!id) return null;
    for (const session of remoteCommandSessionsByConnectionId.values()) {
      if (session.commandId === id) return session;
    }
    return null;
  }

  function getCurrentRemoteCommandSession() {
    return getRemoteCommandSession(remoteCommandDialogConnectionId || activeConnectionId);
  }

  function getRemoteCommandSavedList(connectionId) {
    const key = String(connectionId || activeConnectionId || '');
    if (!key) return [];
    if (!remoteCommandSavedByConnectionId.has(key)) remoteCommandSavedByConnectionId.set(key, []);
    return remoteCommandSavedByConnectionId.get(key);
  }

  function getRemoteCommandHistoryList(connectionId) {
    const key = String(connectionId || activeConnectionId || '');
    if (!key) return [];
    if (!remoteCommandHistoryByConnectionId.has(key)) remoteCommandHistoryByConnectionId.set(key, []);
    return remoteCommandHistoryByConnectionId.get(key);
  }

  function updateRemoteCommandConnectedTo() {
    if (!remoteCommandConnectedTo) return;

    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const active = sessions.find(item => item.id === connectionId) || getActiveSession();
    const hostValue = active ? String(active.host || '').trim() : String(host.value || '').trim();
    remoteCommandConnectedTo.textContent = hostValue || '-';
    if (hostValue) remoteCommandConnectedTo.setAttribute('data-tooltip', hostValue); else remoteCommandConnectedTo.removeAttribute('data-tooltip');
  }

  function updateRemoteCommandRunAs() {
    if (!remoteCommandRunAs) return;

    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const active = sessions.find(item => item.id === connectionId) || getActiveSession();
    const username = active ? String(active.username || '').trim() : '';
    const isRootConnection = username.toLowerCase() === 'root';
    const connectionSudoEnabled = Boolean(active && active.sudoModeEnabled && !isRootConnection);
    const state = getRemoteCommandSession(connectionId);
    const useSudo = connectionSudoEnabled || Boolean(state.useSudo && !isRootConnection);

    remoteCommandRunAs.textContent = useSudo
      ? 'root via sudo'
      : isRootConnection
        ? 'root'
        : (username || 'SSH user');
    remoteCommandRunAs.classList.toggle('sudo', useSudo);

    if (remoteCommandUseSudo) {
      remoteCommandUseSudo.checked = useSudo;
      remoteCommandUseSudo.disabled = connectionSudoEnabled || state.status === 'running';
    }
    if (remoteCommandSudoNote) {
      remoteCommandSudoNote.textContent = connectionSudoEnabled ? 'Enabled by connection Sudo Mode' : '';
    }
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
    remoteCommandDialogConnectionId = activeConnectionId;
    remoteCommandEditingSavedId = '';
    hideRemoteCommandWorkingDirectoryPicker();
    clearRemoteCommandStopEscalationTimer();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');

    const state = getCurrentRemoteCommandSession();
    if (state.status === 'idle') {
      state.workingDirectory = normalizeUiRemotePath(workingDirectory || currentPath.value || state.workingDirectory || '/');
    } else if (workingDirectory && state.status !== 'running') {
      state.workingDirectory = normalizeUiRemotePath(workingDirectory);
    }

    updateRemoteCommandConnectedTo();
    renderRemoteCommandSession();
    remoteCommandBackdrop.classList.add('visible');
    remoteCommandBackdrop.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(syncRemoteCommandRunButtonMinWidth);
    setTimeout(() => {
      if (state.status === 'running') {
        remoteCommandRunButton.focus();
      } else {
        remoteCommandInput.focus();
      }
    }, 0);
  }

  function attemptCloseRemoteCommandDialog() {
    if (!remoteCommandDialogOpen) return;
    hideRemoteCommandDialog();
  }

  function hideRemoteCommandDialog() {
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running' && state.finishedBadgeVisible) {
      state.finishedBadgeVisible = false;
    }
    remoteCommandDialogOpen = false;
    remoteCommandEditingSavedId = '';
    hideRemoteCommandWorkingDirectoryPicker();
    clearRemoteCommandStopEscalationTimer();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');
    remoteCommandBackdrop.classList.remove('visible');
    remoteCommandBackdrop.setAttribute('aria-hidden', 'true');
    renderRemoteCommandBadge();
  }

  function collectRemoteCommandUseSudo() {
    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const active = sessions.find(item => item.id === connectionId) || getActiveSession();
    const username = active ? String(active.username || '').trim() : '';
    const isRootConnection = username.toLowerCase() === 'root';
    if (isRootConnection) return false;
    if (active && active.sudoModeEnabled) return true;
    return Boolean(remoteCommandUseSudo && remoteCommandUseSudo.checked);
  }

  function runRemoteCommandFromDialog() {
    const state = getCurrentRemoteCommandSession();
    if (state.status === 'running') return;

    if (!getActiveRemoteCapabilities().canRunCommand) {
      setRemoteCommandStatus('Run Remote Command is available only for SFTP connections.', true);
      return;
    }

    const command = String(remoteCommandInput.value || '').trim();
    const workingDirectory = normalizeUiRemotePath(remoteCommandWorkingDirectory.value || currentPath.value || '/');

    if (!command) {
      setRemoteCommandStatus('Enter a command to run.', true);
      remoteCommandInput.focus();
      return;
    }

    state.commandId = Date.now() + '-' + Math.random().toString(36).slice(2);
    state.status = 'running';
    state.command = command;
    state.workingDirectory = workingDirectory;
    state.useSudo = collectRemoteCommandUseSudo();
    state.outputText = '';
    state.finalMessage = '';
    state.outputViewLimited = false;
    state.stopping = false;
    state.forceKilling = false;
    state.exitCode = undefined;
    state.error = '';
    state.startedAt = Date.now();
    state.finishedAt = 0;
    state.finishedBadgeVisible = false;
    state.commandCount = 0;
    state.failedCommandCount = 0;
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');
    renderRemoteCommandSession();
    renderServerViewIfActiveRemoteCommandConnection(state.connectionId);
    scrollRemoteCommandOutputToBottom();

    vscode.postMessage({
      type: 'requestRunRemoteCommand',
      payload: {
        commandId: state.commandId,
        connectionId: state.connectionId,
        workingDirectory,
        command,
        useSudo: state.useSudo
      }
    });
  }

  function stopRemoteCommandFromDialog() {
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running' || !state.commandId) return;

    state.stopping = true;
    state.forceKilling = false;
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');
    setRemoteCommandStatus('Stopping...');
    updateRemoteCommandControls();
    vscode.postMessage({ type: 'stopRemoteCommand', payload: { commandId: state.commandId, connectionId: state.connectionId } });
    startRemoteCommandStopEscalationTimer();
  }

  function forceKillRemoteCommandFromDialog() {
    const state = getCurrentRemoteCommandSession();
    if (state.status !== 'running' || !state.commandId) return;

    state.forceKilling = true;
    remoteCommandStopWarning.classList.remove('visible');
    setRemoteCommandStatus('Force killing...');
    updateRemoteCommandControls();
    vscode.postMessage({ type: 'stopRemoteCommand', payload: { commandId: state.commandId, connectionId: state.connectionId, force: true } });
  }

  function startRemoteCommandStopEscalationTimer() {
    clearRemoteCommandStopEscalationTimer();
    remoteCommandStopEscalationTimer = setTimeout(() => {
      remoteCommandStopEscalationTimer = null;
      const state = getCurrentRemoteCommandSession();
      if (state.status !== 'running' || !state.stopping) return;
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
    const state = getCurrentRemoteCommandSession();
    if (state.status === 'running') return;
    state.outputText = '';
    state.finalMessage = '';
    state.error = '';
    state.status = 'idle';
    state.finishedBadgeVisible = false;
    setRemoteCommandOutputText('');
    setRemoteCommandStatus('');
    renderRemoteCommandBadge();
    updateRemoteCommandControls();
  }

  function handleRemoteCommandStarted(payload) {
    if (!payload) return;
    const state = findRemoteCommandSessionByCommandId(payload.commandId) || getRemoteCommandSession(payload.connectionId || activeConnectionId);
    state.commandId = payload.commandId || state.commandId;
    state.connectionId = payload.connectionId || state.connectionId;
    state.status = 'running';
    state.command = payload.command || state.command;
    state.workingDirectory = normalizeUiRemotePath(payload.workingDirectory || state.workingDirectory || '/');
    state.useSudo = Boolean(payload.useSudo);
    state.stopping = false;
    state.forceKilling = false;
    clearRemoteCommandStopEscalationTimer();
    remoteCommandStopWarning.classList.remove('visible');
    if (remoteCommandDialogOpen && state.connectionId === remoteCommandDialogConnectionId) {
      renderRemoteCommandSession();
      setRemoteCommandStatus('Running...');
    }
    renderRemoteCommandBadge();
    renderServerViewIfActiveRemoteCommandConnection(state.connectionId);
  }

  function handleRemoteCommandOutput(payload) {
    if (!payload) return;
    const state = findRemoteCommandSessionByCommandId(payload.commandId);
    if (!state) return;

    const wasNearBottom = remoteCommandDialogOpen && state.connectionId === remoteCommandDialogConnectionId && isRemoteCommandOutputNearBottom();
    if (payload.kind === 'command') {
      appendRemoteCommandCommand(String(payload.text || ''), state);
    } else if (payload.kind === 'commandStatus') {
      appendRemoteCommandCommandStatus(Number(payload.code || 0), state);
    } else {
      appendRemoteCommandOutput(String(payload.text || ''), state);
    }

    if (remoteCommandDialogOpen && state.connectionId === remoteCommandDialogConnectionId) {
      renderRemoteCommandOutputText(state);
      updateRemoteCommandOutputNotice(state);
      updateRemoteCommandCopyButton();
      if (wasNearBottom) scrollRemoteCommandOutputToBottom();
    }
  }

  function handleRemoteCommandFinished(payload) {
    if (!payload) return;
    const state = findRemoteCommandSessionByCommandId(payload.commandId) || getRemoteCommandSession(payload.connectionId || remoteCommandDialogConnectionId || activeConnectionId);
    if (payload.commandId && state.commandId !== payload.commandId) return;

    state.status = 'finished';
    state.stopping = false;
    state.forceKilling = false;
    state.finishedAt = Date.now();
    state.finishedBadgeVisible = true;
    state.exitCode = typeof payload.code === 'number' ? payload.code : undefined;
    state.commandCount = Number(payload.commandCount || 0);
    state.failedCommandCount = Number(payload.failedCommandCount || 0);
    state.error = String(payload.error || '');
    clearRemoteCommandStopEscalationTimer();
    remoteCommandCloseWarning.classList.remove('visible');
    remoteCommandStopWarning.classList.remove('visible');

    if (payload.stopped) {
      state.finalMessage = payload.forceKilled ? 'Force killed by user.' : 'Stopped by user.';
      appendRemoteCommandSystemLine(state.finalMessage, state);
    } else if (payload.error) {
      state.finalMessage = 'Error: ' + String(payload.error || 'Remote command failed.');
      appendRemoteCommandSystemLine(state.finalMessage, state);
    } else if (typeof payload.code === 'number' && payload.signal) {
      state.finalMessage = 'Command exited with code ' + payload.code + ' and signal ' + payload.signal + '.';
      appendRemoteCommandSystemLine(state.finalMessage, state);
    } else {
      state.finalMessage = '';
    }

    addRemoteCommandHistoryItem(state);

    if (remoteCommandDialogOpen && state.connectionId === remoteCommandDialogConnectionId) {
      renderRemoteCommandSession();
      if (payload.stopped) {
        setRemoteCommandStatus(state.finalMessage);
      } else if (payload.error) {
        setRemoteCommandStatus(String(payload.error || 'Remote command failed.'), true);
      } else {
        const failedCount = Number(payload.failedCommandCount || 0);
        setRemoteCommandStatus(failedCount > 0 ? (failedCount + ' command' + (failedCount === 1 ? '' : 's') + ' failed.') : 'Finished.');
      }
      setTimeout(() => {
        remoteCommandInput.focus();
        remoteCommandInput.select();
      }, 0);
    }
    renderRemoteCommandBadge();
    renderRemoteCommandHistoryList();
    renderServerViewIfActiveRemoteCommandConnection(state.connectionId);
  }

  function formatRemoteCommandPrompt(command) {
    return '$ ' + String(command || '').trim() + '\\n';
  }

  function appendRemoteCommandCommand(command, state) {
    const target = state || getCurrentRemoteCommandSession();
    const current = target.outputText || '';
    const prefix = current && !current.endsWith('\\n') ? '\\n' : '';
    setRemoteCommandOutputText(current + prefix + formatRemoteCommandPrompt(command), target);
  }

  function appendRemoteCommandCommandStatus(code, state) {
    const target = state || getCurrentRemoteCommandSession();
    const current = target.outputText || '';
    const prefix = current && !current.endsWith('\\n') ? '\\n' : '';
    setRemoteCommandOutputText(current + prefix + '[Command finished with exit code ' + code + ']\\n', target);
  }

  function appendRemoteCommandSystemLine(message, state) {
    const target = state || getCurrentRemoteCommandSession();
    const current = target.outputText || '';
    const prefix = current && !current.endsWith('\\n') ? '\\n' : '';
    setRemoteCommandOutputText(current + prefix + '[' + String(message || '') + ']\\n', target);
  }

  function appendRemoteCommandOutput(text, state) {
    if (!text) return;
    const target = state || getCurrentRemoteCommandSession();
    setRemoteCommandOutputText((target.outputText || '') + text, target);
  }

  function setRemoteCommandOutputText(text, state) {
    const target = state || getCurrentRemoteCommandSession();
    target.outputText = String(text || '');
    target.outputViewLimited = target.outputText.length > REMOTE_COMMAND_MAX_OUTPUT_CHARS;

    if (target.outputViewLimited) {
      target.outputText = target.outputText.slice(-REMOTE_COMMAND_MAX_OUTPUT_CHARS);
    }

    if (remoteCommandDialogOpen && target.connectionId === remoteCommandDialogConnectionId) {
      renderRemoteCommandOutputText(target);
      updateRemoteCommandOutputNotice(target);
      updateRemoteCommandCopyButton();
    }
  }

  function getRemoteCommandOutputTextForDisplay(state) {
    const target = state || getCurrentRemoteCommandSession();
    const output = String(target.outputText || '');
    const finalMessage = String(target.finalMessage || '').trim();
    if (!finalMessage || output.includes(finalMessage)) return output;
    const separator = output && !output.endsWith('\\n') ? '\\n' : '';
    return output + separator + '[' + finalMessage + ']\\n';
  }

  function renderRemoteCommandOutputText(state) {
    const target = state || getCurrentRemoteCommandSession();
    remoteCommandOutput.innerHTML = renderRemoteCommandOutput(getRemoteCommandOutputTextForDisplay(target));
  }

  function renderRemoteCommandOutput(text) {
    const escaped = escapeHtml(String(text || ''));
    return escaped
      .split('\\n')
      .map(line => {
        if (!line) return '';
        const value = line.replace(/&amp;/g, '&');
        if (value.startsWith('$ ')) {
          return '<span class="remote-command-output-command">' + line + '</span>';
        }
        const remoteCommandSystemMessage = value === 'Stopped by user.'
          || value === 'Force killed by user.'
          || value.startsWith('[Command stopped by user.')
          || value.startsWith('[Command finished with exit code ')
          || value.startsWith('[Command exited with code ')
          || value.startsWith('[Error: ');
        if (remoteCommandSystemMessage) {
          return '<span class="remote-command-output-system">' + line + '</span>';
        }
        return line;
      })
      .join('\\n');
  }

  function selectRemoteCommandOutputText() {
    if (!remoteCommandOutput) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(remoteCommandOutput);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function getRemoteCommandOutputCopyText() {
    const state = getCurrentRemoteCommandSession();
    const output = getRemoteCommandOutputTextForDisplay(state).trim();
    const statusText = remoteCommandStatus ? String(remoteCommandStatus.textContent || '').trim() : '';
    if (!output) return statusText;
    return statusText ? output + '\\n' + statusText : output;
  }

  function copyRemoteCommandOutput() {
    const text = getRemoteCommandOutputCopyText();
    if (!text) return;
    vscode.postMessage({ type: 'copyStatus', payload: { text, message: 'Remote command output copied.' } });
  }

  function updateRemoteCommandCopyButton() {
    if (!remoteCommandCopyButton) return;
    remoteCommandCopyButton.disabled = !getRemoteCommandOutputCopyText();
  }

  function updateRemoteCommandOutputNotice(state) {
    const target = state || getCurrentRemoteCommandSession();
    remoteCommandOutputNotice.textContent = target.outputViewLimited ? 'Showing latest output only.' : '';
  }

  function setRemoteCommandStatus(message, isError) {
    remoteCommandStatus.textContent = message || '';
    remoteCommandStatus.classList.toggle('error', Boolean(isError));
    updateRemoteCommandCopyButton();
  }

  function renderRemoteCommandSession() {
    const state = getCurrentRemoteCommandSession();
    updateRemoteCommandConnectedTo();
    if (remoteCommandWorkingDirectory) remoteCommandWorkingDirectory.value = normalizeUiRemotePath(state.workingDirectory || currentPath.value || '/');
    if (remoteCommandInput) remoteCommandInput.value = state.command || '';
    renderRemoteCommandOutputText(state);
    updateRemoteCommandOutputNotice(state);
    updateRemoteCommandRunAs();
    renderRemoteCommandSavedList();
    renderRemoteCommandHistoryList();
    updateRemoteCommandControls();
    const status = state.status === 'running'
      ? (state.stopping ? 'Stopping...' : 'Running...')
      : state.status === 'finished'
        ? (state.error ? state.error : (typeof state.exitCode === 'number' ? 'Finished with exit code ' + state.exitCode : 'Finished.'))
        : 'Ready';
    setRemoteCommandStatus(status, state.status === 'finished' && Boolean(state.error));
    renderRemoteCommandBadge();
  }

  function updateRemoteCommandControls() {
    const state = getCurrentRemoteCommandSession();
    const running = state.status === 'running';
    if (remoteCommandInput) remoteCommandInput.disabled = running;
    if (remoteCommandWorkingDirectory) remoteCommandWorkingDirectory.disabled = running;
    if (remoteCommandBrowseWorkingDirectoryButton) remoteCommandBrowseWorkingDirectoryButton.disabled = running;

    if (running) {
      remoteCommandRunButton.textContent = state.stopping ? 'Stopping…' : 'Stop';
      remoteCommandRunButton.classList.add('secondary');
      remoteCommandRunButton.disabled = state.stopping;
    } else {
      remoteCommandRunButton.textContent = 'Run';
      remoteCommandRunButton.classList.remove('secondary');
      remoteCommandRunButton.disabled = !activeConnectionId || !getActiveRemoteCapabilities().canRunCommand;
    }

    if (remoteCommandSaveCurrentButton) {
      remoteCommandSaveCurrentButton.disabled = running || !String(remoteCommandInput.value || '').trim();
    }
    remoteCommandForceKillButton.disabled = !running || !state.stopping || state.forceKilling;
    remoteCommandClearButton.disabled = running || !(state.outputText || state.finalMessage || state.error || state.status === 'finished');
    updateRemoteCommandRunAs();
    updateRemoteCommandCopyButton();
  }

  function isRemoteCommandOutputNearBottom() {
    return remoteCommandOutputWrap.scrollTop + remoteCommandOutputWrap.clientHeight >= remoteCommandOutputWrap.scrollHeight - 24;
  }

  function scrollRemoteCommandOutputToBottom() {
    remoteCommandOutputWrap.scrollTop = remoteCommandOutputWrap.scrollHeight;
  }

  function renderLogViewerBadge() {
    if (!logViewerBadge) return;
    if (logViewerActiveSessionCount > 0) {
      logViewerBadge.textContent = String(Math.min(99, logViewerActiveSessionCount));
      logViewerBadge.style.display = 'block';
    } else {
      logViewerBadge.style.display = 'none';
    }
  }

  function renderRemoteCommandBadge() {
    if (!remoteCommandBadge) return;
    const state = getRemoteCommandSession(activeConnectionId);
    if (state.status === 'running') {
      remoteCommandBadge.textContent = '●';
      remoteCommandBadge.style.display = 'block';
    } else if (state.finishedBadgeVisible) {
      remoteCommandBadge.textContent = state.error || (typeof state.exitCode === 'number' && state.exitCode !== 0) || state.failedCommandCount > 0 ? '!' : '✓';
      remoteCommandBadge.style.display = 'block';
    } else {
      remoteCommandBadge.style.display = 'none';
    }
  }

  function createRemoteCommandId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function firstRemoteCommandLine(command) {
    const lines = String(command || '').split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
    return lines[0] || '';
  }

  function truncateRemoteCommandText(text, maxLength) {
    const value = String(text || '').replace(/\\s+/g, ' ').trim();
    return value.length > maxLength ? value.slice(0, Math.max(0, maxLength - 1)) + '…' : value;
  }

  function formatRemoteCommandRelativeTime(timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' min ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' h ago';
    const days = Math.floor(hours / 24);
    return days + ' d ago';
  }

  function getRemoteCommandItemRemotePath(item) {
    const raw = String(item && (item.remotePath || item.workingDirectory || '') || '').trim();
    return raw ? normalizeUiRemotePath(raw) : '';
  }

  function loadRemoteCommandIntoEditor(item, append) {
    if (!item || getCurrentRemoteCommandSession().status === 'running') return;
    const command = String(item.command || '').trim();
    if (!command) return;
    const current = String(remoteCommandInput.value || '').trimEnd();
    remoteCommandInput.value = append && current ? current + '\\n' + command : command;
    const state = getCurrentRemoteCommandSession();
    state.command = remoteCommandInput.value;
    const itemRemotePath = getRemoteCommandItemRemotePath(item);
    if (!append && itemRemotePath) {
      remoteCommandWorkingDirectory.value = itemRemotePath;
      state.workingDirectory = itemRemotePath;
    } else {
      state.workingDirectory = normalizeUiRemotePath(remoteCommandWorkingDirectory.value || state.workingDirectory || '/');
    }
    state.useSudo = collectRemoteCommandUseSudo();
    updateRemoteCommandControls();
    remoteCommandInput.focus();
  }

  function renderRemoteCommandSavedList() {
    if (!remoteCommandSavedList) return;
    const list = getRemoteCommandSavedList(remoteCommandDialogConnectionId || activeConnectionId);
    if (remoteCommandEditingSavedId === '__new__') {
      remoteCommandSavedList.innerHTML = renderRemoteCommandEditForm({
        id: '__new__',
        name: '',
        details: '',
        command: String(remoteCommandInput.value || '').trim(),
        remotePath: normalizeUiRemotePath(remoteCommandWorkingDirectory.value || currentPath.value || '/')
      }, true);
      wireRemoteCommandEditForm();
      return;
    }
    if (!list.length) {
      remoteCommandSavedList.innerHTML = '<div class="remote-command-empty">No saved commands for this connection.</div>';
      return;
    }
    remoteCommandSavedList.innerHTML = list.map(item => {
      if (remoteCommandEditingSavedId === item.id) return renderRemoteCommandEditForm(item, false);
      const remotePath = getRemoteCommandItemRemotePath(item);
      return '<div class="remote-command-card" data-remote-command-saved-id="' + escapeHtml(item.id) + '" data-tooltip="Load command">'
        + '<div class="remote-command-card-header">'
        + '<div class="remote-command-card-name">' + escapeHtml(item.name || firstRemoteCommandLine(item.command) || 'Saved command') + '</div>'
        + '<button class="secondary remote-command-icon-button" type="button" data-remote-command-action="append" data-tooltip="Add to editor">+</button>'
        + '<button class="secondary remote-command-icon-button" type="button" data-remote-command-action="edit" data-tooltip="Edit saved command">✎</button>'
        + '<button class="secondary remote-command-icon-button" type="button" data-remote-command-action="delete" data-tooltip="Delete saved command">×</button>'
        + '</div>'
        + (item.details ? '<div class="remote-command-card-details">' + escapeHtml(item.details) + '</div>' : '')
        + (remotePath ? '<div class="remote-command-card-meta tooltip-above" data-tooltip="' + escapeHtml(remotePath) + '">Remote path: ' + escapeHtml(truncateRemoteCommandText(remotePath, 90)) + '</div>' : '')
        + '<div class="remote-command-card-command">' + escapeHtml(truncateRemoteCommandText(item.command, 120)) + '</div>'
        + (remoteCommandDeletingSavedId === item.id ? '<div class="remote-command-delete-confirm" role="alert"><span>Delete saved command?</span><span class="remote-command-delete-confirm-actions"><button class="secondary" type="button" data-remote-command-action="cancel-delete">Cancel</button><button type="button" data-remote-command-action="confirm-delete">Delete</button></span></div>' : '')
        + '</div>';
    }).join('');
    wireRemoteCommandEditForm();
  }

  function renderRemoteCommandEditForm(item, isNew) {
    const remotePath = getRemoteCommandItemRemotePath(item);
    return '<form class="remote-command-edit-form" data-remote-command-edit-id="' + escapeHtml(item.id || '') + '">'
      + '<label>Name<input type="text" name="name" value="' + escapeHtml(item.name || '') + '" autocomplete="off" spellcheck="false" placeholder="Restart nginx"></label>'
      + '<label>Details<input type="text" name="details" value="' + escapeHtml(item.details || '') + '" autocomplete="off" spellcheck="false" placeholder="Explain what this command does"></label>'
      + '<label>Remote path<input type="text" name="remotePath" value="' + escapeHtml(remotePath) + '" autocomplete="off" spellcheck="false" placeholder="/var/www/app"></label>'
      + '<label>Command<textarea name="command" spellcheck="false">' + escapeHtml(item.command || '') + '</textarea></label>'
      + '<div class="remote-command-edit-actions">'
      + '<button class="secondary" type="button" data-remote-command-edit-action="cancel">Cancel</button>'
      + '<button type="submit">Save</button>'
      + '</div>'
      + '</form>';
  }

  function wireRemoteCommandEditForm() {
    const form = remoteCommandSavedList ? remoteCommandSavedList.querySelector('.remote-command-edit-form') : null;
    if (!form) return;
    const nameInput = form.querySelector('input[name="name"]');
    if (nameInput) setTimeout(() => nameInput.focus(), 0);
  }

  function saveRemoteCommandEditForm(form) {
    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const list = getRemoteCommandSavedList(connectionId);
    const id = String(form.getAttribute('data-remote-command-edit-id') || '').trim();
    const name = String((form.querySelector('input[name="name"]') || {}).value || '').trim();
    const details = String((form.querySelector('input[name="details"]') || {}).value || '').trim();
    const command = String((form.querySelector('textarea[name="command"]') || {}).value || '').trim();
    const remotePathInput = form.querySelector('input[name="remotePath"]');
    const remotePathRaw = String((remotePathInput || {}).value || '').trim();
    const remotePath = remotePathRaw ? normalizeUiRemotePath(remotePathRaw) : '';
    if (!command) return;
    const now = Date.now();
    const existingIndex = list.findIndex(item => item.id === id && id !== '__new__');
    const item = {
      id: existingIndex >= 0 ? list[existingIndex].id : createRemoteCommandId(),
      name: name || firstRemoteCommandLine(command) || 'Saved command',
      details,
      command,
      createdAt: existingIndex >= 0 ? list[existingIndex].createdAt || now : now,
      updatedAt: now
    };
    if (remotePath) item.remotePath = remotePath;
    if (existingIndex >= 0) list[existingIndex] = item;
    else list.unshift(item);
    remoteCommandSavedByConnectionId.set(connectionId, list);
    persistRemoteCommandSaved();
    remoteCommandEditingSavedId = '';
    remoteCommandDeletingSavedId = '';
    renderRemoteCommandSavedList();
    renderServerViewIfActiveRemoteCommandConnection(connectionId);
  }

  function deleteRemoteCommandSaved(id) {
    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const list = getRemoteCommandSavedList(connectionId).filter(item => item.id !== id);
    remoteCommandSavedByConnectionId.set(connectionId, list);
    persistRemoteCommandSaved();
    remoteCommandEditingSavedId = '';
    remoteCommandDeletingSavedId = '';
    renderRemoteCommandSavedList();
    renderServerViewIfActiveRemoteCommandConnection(connectionId);
  }

  function addRemoteCommandHistoryItem(state) {
    if (!state || !state.connectionId || !state.command) return;
    const list = getRemoteCommandHistoryList(state.connectionId);
    const command = String(state.command || '').trim();
    const previous = list[0];
    if (previous && String(previous.command || '').trim() === command) {
      previous.ranAt = Date.now();
      previous.workingDirectory = normalizeUiRemotePath(state.workingDirectory || '/');
      previous.exitCode = typeof state.exitCode === 'number' ? state.exitCode : undefined;
      previous.error = state.error || '';
      previous.usedSudo = Boolean(state.useSudo);
    } else {
      list.unshift({
        id: createRemoteCommandId(),
        command,
        workingDirectory: normalizeUiRemotePath(state.workingDirectory || '/'),
        usedSudo: Boolean(state.useSudo),
        exitCode: typeof state.exitCode === 'number' ? state.exitCode : undefined,
        error: state.error || '',
        ranAt: Date.now()
      });
    }
    if (list.length > REMOTE_COMMAND_MAX_HISTORY_PER_CONNECTION) list.length = REMOTE_COMMAND_MAX_HISTORY_PER_CONNECTION;
    remoteCommandHistoryByConnectionId.set(state.connectionId, list);
    persistRemoteCommandHistory();
  }

  function renderRemoteCommandHistoryList() {
    if (!remoteCommandHistoryList) return;
    const list = getRemoteCommandHistoryList(remoteCommandDialogConnectionId || activeConnectionId);
    if (!list.length) {
      remoteCommandHistoryList.innerHTML = '<div class="remote-command-empty">No command history yet.</div>';
      return;
    }
    remoteCommandHistoryList.innerHTML = list.map(item => {
      const exitLabel = item.error ? 'failed' : (typeof item.exitCode === 'number' ? 'exit ' + item.exitCode : 'finished');
      return '<div class="remote-command-card" data-remote-command-history-id="' + escapeHtml(item.id) + '" data-tooltip="Load command">'
        + '<div class="remote-command-card-header remote-command-card-header-compact">'
        + '<div class="remote-command-card-name">' + escapeHtml(truncateRemoteCommandText(firstRemoteCommandLine(item.command) || item.command, 90)) + '</div>'
        + '<button class="secondary remote-command-icon-button" type="button" data-remote-command-action="save-history" data-tooltip="Save as command">☆</button>'
        + '</div>'
        + '<div class="remote-command-card-meta">' + escapeHtml(formatRemoteCommandRelativeTime(item.ranAt) + ' · ' + exitLabel) + '</div>'
        + '</div>';
    }).join('');
  }

  function saveHistoryItemAsSavedCommand(item) {
    if (!item) return;
    const connectionId = remoteCommandDialogConnectionId || activeConnectionId;
    const list = getRemoteCommandSavedList(connectionId);
    const command = String(item.command || '').trim();
    if (!command) return;
    const remotePath = getRemoteCommandItemRemotePath(item);
    const savedItem = {
      id: createRemoteCommandId(),
      name: firstRemoteCommandLine(command) || 'Saved command',
      details: '',
      command,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    if (remotePath) savedItem.remotePath = remotePath;
    list.unshift(savedItem);
    remoteCommandSavedByConnectionId.set(connectionId, list);
    persistRemoteCommandSaved();
    renderRemoteCommandSavedList();
    renderServerViewIfActiveRemoteCommandConnection(connectionId);
  }

  function browseRemoteCommandWorkingDirectory() {
    const state = getCurrentRemoteCommandSession();
    if (!activeConnectionId || state.status === 'running') return;
    const path = normalizeUiRemotePath(remoteCommandWorkingDirectory.value || currentPath.value || '/');
    showRemoteCommandWorkingDirectoryPicker(path);
    requestRemoteCommandWorkingDirectoryEntries(path);
  }

  function showRemoteCommandWorkingDirectoryPicker(path) {
    remoteCommandWorkingDirectoryPickerOpen = true;
    remoteCommandWorkingDirectoryPickerPathValue = normalizeUiRemotePath(path || '/');
    if (remoteCommandWorkingDirectoryPicker) {
      remoteCommandWorkingDirectoryPicker.classList.remove('hidden');
      remoteCommandWorkingDirectoryPicker.setAttribute('aria-hidden', 'false');
    }
    if (remoteCommandWorkingDirectoryPickerPath) remoteCommandWorkingDirectoryPickerPath.textContent = remoteCommandWorkingDirectoryPickerPathValue;
    if (remoteCommandWorkingDirectoryPickerList) remoteCommandWorkingDirectoryPickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
  }

  function hideRemoteCommandWorkingDirectoryPicker() {
    remoteCommandWorkingDirectoryPickerOpen = false;
    if (remoteCommandWorkingDirectoryPicker) {
      remoteCommandWorkingDirectoryPicker.classList.add('hidden');
      remoteCommandWorkingDirectoryPicker.setAttribute('aria-hidden', 'true');
    }
  }

  function selectRemoteCommandWorkingDirectoryPickerPath() {
    const state = getCurrentRemoteCommandSession();
    if (state.status === 'running') return;
    remoteCommandWorkingDirectory.value = normalizeUiRemotePath(remoteCommandWorkingDirectoryPickerPathValue || '/');
    state.workingDirectory = normalizeUiRemotePath(remoteCommandWorkingDirectory.value || '/');
    hideRemoteCommandWorkingDirectoryPicker();
    updateRemoteCommandControls();
  }

  function requestRemoteCommandWorkingDirectoryEntries(path) {
    const state = getCurrentRemoteCommandSession();
    if (!activeConnectionId || state.status === 'running') return;
    const scopePath = normalizeUiRemotePath(path || '/');
    remoteCommandWorkingDirectoryPickerPathValue = scopePath;
    if (remoteCommandWorkingDirectoryPickerPath) remoteCommandWorkingDirectoryPickerPath.textContent = scopePath;
    if (remoteCommandWorkingDirectoryPickerList) remoteCommandWorkingDirectoryPickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
    vscode.postMessage({ type: 'browseRemoteSearchScope', payload: { scopePath } });
  }

  function handleRemoteCommandWorkingDirectoryEntriesListed(payload) {
    if (!remoteCommandWorkingDirectoryPickerOpen) return false;
    if (payload.connectionId && activeConnectionId && payload.connectionId !== activeConnectionId) return true;
    const path = normalizeUiRemotePath(payload.path || '/');
    const parentPath = normalizeUiRemotePath(payload.parentPath || '/');
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    remoteCommandWorkingDirectoryPickerPathValue = path;
    if (remoteCommandWorkingDirectoryPickerPath) remoteCommandWorkingDirectoryPickerPath.textContent = path;
    if (!remoteCommandWorkingDirectoryPickerList) return true;
    const parentItem = '<button class="remote-search-scope-picker-item" type="button" data-remote-command-working-directory-path="' + escapeHtml(parentPath) + '"><span>..</span></button>';
    const directoryItems = entries
      .filter(entry => entry && getEffectiveEntryType(entry) === 'directory')
      .map(entry => {
        const entryPath = normalizeUiRemotePath(entry.path || entry.name || '/');
        return '<button class="remote-search-scope-picker-item" type="button" data-remote-command-working-directory-path="' + escapeHtml(entryPath) + '"><span>' + escapeHtml(entry.name || entryPath) + '</span></button>';
      })
      .join('');
    remoteCommandWorkingDirectoryPickerList.innerHTML = parentItem + (directoryItems || '<div class="remote-search-scope-picker-empty">No folders.</div>');
    return true;
  }

  function showOwnerGroupDialog(entries) {
    const selectedEntries = Array.isArray(entries) ? entries.filter(entry => entry && !isParentEntry(entry)) : [];
    if (!selectedEntries.length) return;

    const prefillOwner = getCommonOwnerGroupDialogValue(selectedEntries, 'owner');
    const prefillGroup = getCommonOwnerGroupDialogValue(selectedEntries, 'group');

    ownerGroupEntries = selectedEntries.map(actionPayload);
    ownerGroupDialogOpen = true;
    ownerGroupOwnerInput.value = prefillOwner;
    ownerGroupGroupInput.value = prefillGroup;
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
    ensureOwnerGroupSuggestionsRequested();
    ownerGroupBackdrop.classList.add('visible');
    ownerGroupBackdrop.setAttribute('aria-hidden', 'false');
    setTimeout(() => ownerGroupOwnerInput.focus(), 0);
  }

  function hideOwnerGroupDialog() {
    ownerGroupDialogOpen = false;
    ownerGroupEntries = [];
    hideOwnerGroupSuggestions();
    ownerGroupBackdrop.classList.remove('visible');
    ownerGroupBackdrop.setAttribute('aria-hidden', 'true');
  }

  function getOwnerGroupSuggestionCache(connectionId) {
    const id = String(connectionId || activeConnectionId || '').trim();
    if (!id) return { owners: [], groups: [], loading: false, loaded: true, error: '' };
    let cache = ownerGroupSuggestionsByConnectionId.get(id);
    if (!cache) {
      cache = { owners: [], groups: [], loading: false, loaded: false, error: '' };
      ownerGroupSuggestionsByConnectionId.set(id, cache);
    }
    return cache;
  }

  function ensureOwnerGroupSuggestionsRequested() {
    if (!ownerGroupDialogOpen || !activeConnectionId) return;
    const cache = getOwnerGroupSuggestionCache(activeConnectionId);
    if (cache.loading || cache.loaded) return;
    cache.loading = true;
    cache.error = '';
    vscode.postMessage({ type: 'requestOwnerGroupSuggestions', payload: { connectionId: activeConnectionId } });
  }

  function handleOwnerGroupSuggestions(payload) {
    const connectionId = String(payload.connectionId || '').trim();
    if (!connectionId) return;
    const cache = getOwnerGroupSuggestionCache(connectionId);
    cache.owners = normalizeOwnerGroupSuggestions(payload.owners || []);
    cache.groups = normalizeOwnerGroupSuggestions(payload.groups || []);
    cache.loading = false;
    cache.loaded = true;
    cache.error = payload.error ? String(payload.error) : '';
    if (ownerGroupDialogOpen && connectionId === activeConnectionId && ownerGroupActiveSuggestionKind) {
      renderOwnerGroupSuggestions(ownerGroupActiveSuggestionKind);
    }
  }

  function normalizeOwnerGroupSuggestions(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    return values
      .map(value => ({
        name: String(value && value.name || '').trim(),
        id: String(value && value.id || '').trim(),
        detail: String(value && value.detail || '').trim()
      }))
      .filter(value => {
        if (!value.name || seen.has(value.name)) return false;
        seen.add(value.name);
        return true;
      })
      .slice(0, 500);
  }

  function showOwnerGroupSuggestions(kind) {
    ownerGroupActiveSuggestionKind = kind;
    ensureOwnerGroupSuggestionsRequested();
    renderOwnerGroupSuggestions(kind);
  }

  function isOwnerGroupSuggestionsOpen() {
    return Boolean(
      ownerGroupActiveSuggestionKind
      && (
        (ownerGroupOwnerSuggestions && ownerGroupOwnerSuggestions.classList.contains('visible'))
        || (ownerGroupGroupSuggestions && ownerGroupGroupSuggestions.classList.contains('visible'))
      )
    );
  }

  function hideOwnerGroupSuggestions() {
    ownerGroupActiveSuggestionKind = '';
    if (ownerGroupSuggestionRepositionFrame) {
      cancelAnimationFrame(ownerGroupSuggestionRepositionFrame);
      ownerGroupSuggestionRepositionFrame = 0;
    }
    if (ownerGroupOwnerSuggestions) ownerGroupOwnerSuggestions.classList.remove('visible');
    if (ownerGroupGroupSuggestions) ownerGroupGroupSuggestions.classList.remove('visible');
    if (ownerGroupOwnerInput) ownerGroupOwnerInput.setAttribute('aria-expanded', 'false');
    if (ownerGroupGroupInput) ownerGroupGroupInput.setAttribute('aria-expanded', 'false');
  }

  function ensureOwnerGroupSuggestionPortal() {
    if (ownerGroupOwnerSuggestions && ownerGroupOwnerSuggestions.parentElement !== document.body) {
      document.body.appendChild(ownerGroupOwnerSuggestions);
    }
    if (ownerGroupGroupSuggestions && ownerGroupGroupSuggestions.parentElement !== document.body) {
      document.body.appendChild(ownerGroupGroupSuggestions);
    }
  }

  function positionOwnerGroupSuggestions(kind) {
    const isOwner = kind === 'owner';
    const input = isOwner ? ownerGroupOwnerInput : ownerGroupGroupInput;
    const menu = isOwner ? ownerGroupOwnerSuggestions : ownerGroupGroupSuggestions;
    if (!ownerGroupDialogOpen || !input || !menu || !menu.classList.contains('visible')) return;

    ensureOwnerGroupSuggestionPortal();

    const rect = input.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const width = Math.max(180, Math.round(rect.width));
    const maxLeft = window.innerWidth - width - margin;
    const left = Math.max(margin, Math.min(Math.round(rect.left), maxLeft));
    const availableBelow = window.innerHeight - rect.bottom - margin - gap;
    const availableAbove = rect.top - margin - gap;
    const preferredHeight = Math.min(220, Math.max(120, menu.scrollHeight || 190));
    const placeBelow = availableBelow >= Math.min(preferredHeight, 160) || availableBelow >= availableAbove;
    const maxHeight = Math.max(72, Math.min(220, placeBelow ? availableBelow : availableAbove));
    const top = placeBelow
      ? Math.round(rect.bottom + gap)
      : Math.max(margin, Math.round(rect.top - gap - maxHeight));

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.width = width + 'px';
    menu.style.maxHeight = Math.round(maxHeight) + 'px';
  }

  function scheduleOwnerGroupSuggestionsPosition() {
    if (!ownerGroupDialogOpen || !ownerGroupActiveSuggestionKind) return;
    if (ownerGroupSuggestionRepositionFrame) cancelAnimationFrame(ownerGroupSuggestionRepositionFrame);
    ownerGroupSuggestionRepositionFrame = requestAnimationFrame(() => {
      ownerGroupSuggestionRepositionFrame = 0;
      positionOwnerGroupSuggestions(ownerGroupActiveSuggestionKind);
    });
  }

  function renderOwnerGroupSuggestions(kind) {
    const isOwner = kind === 'owner';
    const input = isOwner ? ownerGroupOwnerInput : ownerGroupGroupInput;
    const menu = isOwner ? ownerGroupOwnerSuggestions : ownerGroupGroupSuggestions;
    if (!ownerGroupDialogOpen || !input || !menu || ownerGroupActiveSuggestionKind !== kind) return;

    const cache = getOwnerGroupSuggestionCache(activeConnectionId);
    const source = isOwner ? cache.owners : cache.groups;
    const filter = String(input.value || '').trim().toLowerCase();
    const matches = source
      .filter(item => {
        if (!filter) return true;
        return item.name.toLowerCase().includes(filter)
          || item.id.toLowerCase().includes(filter)
          || item.detail.toLowerCase().includes(filter);
      })
      .slice(0, 80);

    if (cache.loading && !source.length) {
      menu.innerHTML = '<div class="owner-group-suggestion-empty">Loading suggestions...</div>';
    } else if (matches.length) {
      menu.innerHTML = matches.map(item => '<button type="button" class="owner-group-suggestion-item" role="option" data-owner-group-kind="' + escapeHtml(kind) + '" data-owner-group-value="' + escapeHtml(item.name) + '"><span class="owner-group-suggestion-name">' + escapeHtml(item.name) + '</span><span class="owner-group-suggestion-detail">' + escapeHtml(item.detail || item.id || '') + '</span></button>').join('');
    } else if (cache.loaded && source.length) {
      menu.innerHTML = '<div class="owner-group-suggestion-empty">No matching suggestions. You can type manually.</div>';
    } else if (cache.error) {
      menu.innerHTML = '<div class="owner-group-suggestion-empty error">Suggestions unavailable. You can type manually.</div>';
    } else {
      menu.innerHTML = '<div class="owner-group-suggestion-empty">No suggestions. You can type manually.</div>';
    }

    ensureOwnerGroupSuggestionPortal();
    menu.classList.add('visible');
    input.setAttribute('aria-expanded', 'true');
    positionOwnerGroupSuggestions(kind);
  }

  function handleOwnerGroupSuggestionClick(event, expectedKind) {
    const item = event.target && event.target.closest ? event.target.closest('[data-owner-group-value]') : null;
    if (!item) return;
    const kind = item.dataset.ownerGroupKind || expectedKind;
    const value = item.dataset.ownerGroupValue || '';
    if (kind === 'owner') ownerGroupOwnerInput.value = value;
    if (kind === 'group') ownerGroupGroupInput.value = value;
    hideOwnerGroupSuggestions();
    updateOwnerGroupApplyState();
    if (kind === 'owner') ownerGroupOwnerInput.focus();
    if (kind === 'group') ownerGroupGroupInput.focus();
  }

  function getCommonOwnerGroupDialogValue(entries, key) {
    const values = (Array.isArray(entries) ? entries : [])
      .map(entry => formatMetadata(entry && entry[key]).trim())
      .filter(Boolean);

    if (!values.length) return '';

    const first = values[0];
    return values.every(value => value === first) ? first : '';
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
    listDirectory(path, { forceRefresh: true });
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
        '<button type="button" class="remote-path-favorite-path" data-favorite-path="' + escapedPath + '" data-tooltip="' + escapedPath + '">' + escapedPath + '</button>' +
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


  function normalizeSearchScopePath(path) {
    const trimmed = String(path || '/').trim() || '/';
    return trimmed.startsWith('/') ? trimmed.replace(new RegExp('/+', 'g'), '/') : '/' + trimmed.replace(new RegExp('/+', 'g'), '/');
  }

  function getActiveConnectionType() {
    const session = getActiveSession();
    return String((session && session.connectionType) || 'sftp').toLowerCase();
  }

  function createEmptyRemoteSearchState(connectionId, connectionType) {
    return {
      status: 'idle',
      connectionId: connectionId || '',
      connectionType: connectionType || getActiveConnectionType(),
      results: [],
      totalResults: 0,
      options: {
        connectionId: connectionId || '',
        connectionType: connectionType || getActiveConnectionType(),
        scopePath: currentPath.value || '/',
        includeSubdirectories: true,
        includeHiddenFiles: false,
        caseSensitive: false,
        fileName: '*',
        searchInsideFiles: false,
        textToFind: '',
        useSudo: false
      }
    };
  }

  function getRemoteSearchStateForActiveConnection() {
    if (!activeConnectionId) return createEmptyRemoteSearchState('', 'sftp');
    return remoteSearchStatesByConnectionId.get(activeConnectionId) || createEmptyRemoteSearchState(activeConnectionId, getActiveConnectionType());
  }

  function storeRemoteSearchSnapshot(snapshot) {
    const normalized = snapshot || createEmptyRemoteSearchState(activeConnectionId, getActiveConnectionType());
    const connectionId = normalized.connectionId || activeConnectionId || '';
    normalized.connectionId = connectionId;
    if (!normalized.connectionType) normalized.connectionType = getActiveConnectionType();
    if (!Array.isArray(normalized.results)) normalized.results = [];
    if (!normalized.options) normalized.options = {};
    if (connectionId) remoteSearchStatesByConnectionId.set(connectionId, normalized);
    return normalized;
  }

  function isRemoteSearchSftp() {
    return getActiveConnectionType() === 'sftp';
  }

  function updateRemoteSearchConnectedTo() {
    if (!remoteSearchConnectedTo) return;

    const active = getActiveSession();
    const hostValue = active ? String(active.host || '').trim() : String(host.value || '').trim();
    remoteSearchConnectedTo.textContent = hostValue || '-';
    if (hostValue) remoteSearchConnectedTo.setAttribute('data-tooltip', hostValue); else remoteSearchConnectedTo.removeAttribute('data-tooltip');
  }

  function getRemoteSearchSudoContext(connectionId) {
    const key = connectionId || activeConnectionId;
    const active = (key ? sessions.find(item => item.id === key) : null) || getActiveSession();
    const username = active ? String(active.username || '').trim() : '';
    const connectionType = String((active && active.connectionType) || getActiveConnectionType() || 'sftp').toLowerCase();
    const isRootConnection = username.toLowerCase() === 'root';
    const isSftp = connectionType === 'sftp';
    const connectionSudoEnabled = Boolean(active && active.sudoModeEnabled && !isRootConnection && isSftp);
    return { active, username, isRootConnection, isSftp, connectionSudoEnabled };
  }

  function collectRemoteSearchEffectiveUseSudo(connectionId) {
    const context = getRemoteSearchSudoContext(connectionId);
    if (!context.isSftp || context.isRootConnection) return false;
    if (context.connectionSudoEnabled) return true;
    return Boolean(remoteSearchUseSudo && remoteSearchUseSudo.checked);
  }

  function collectRemoteSearchFormUseSudo(connectionId) {
    const key = String(connectionId || activeConnectionId || '');
    const context = getRemoteSearchSudoContext(key);
    if (!context.isSftp || context.isRootConnection) return false;
    if (context.connectionSudoEnabled) {
      const saved = key ? remoteSearchFormsByConnectionId.get(key) : null;
      return Boolean(saved && saved.useSudo);
    }
    return Boolean(remoteSearchUseSudo && remoteSearchUseSudo.checked);
  }

  function updateRemoteSearchRunAs() {
    if (!remoteSearchRunAs) return;

    const context = getRemoteSearchSudoContext(activeConnectionId);
    const useSudo = collectRemoteSearchEffectiveUseSudo(activeConnectionId);

    remoteSearchRunAs.textContent = useSudo
      ? 'root via sudo'
      : context.isRootConnection
        ? 'root'
        : (context.username || (context.isSftp ? 'SSH user' : 'FTP user'));
    remoteSearchRunAs.classList.toggle('sudo', useSudo);

    if (remoteSearchUseSudo) {
      remoteSearchUseSudo.checked = useSudo;
      remoteSearchUseSudo.disabled = context.connectionSudoEnabled || remoteSearchState.status === 'running';
    }
    if (remoteSearchSudoNote) {
      remoteSearchSudoNote.textContent = context.connectionSudoEnabled ? 'Enabled by connection Sudo Mode' : '';
    }
  }

  function updateRemoteSearchMeta() {
    updateRemoteSearchConnectedTo();
    updateRemoteSearchRunAs();
  }

  function updateRemoteSearchProtocolFields() {
    const isSftp = isRemoteSearchSftp();
    if (remoteSearchSudoRow) remoteSearchSudoRow.classList.toggle('hidden', !isSftp);
    if (remoteSearchInsideRow) remoteSearchInsideRow.classList.toggle('hidden', !isSftp);
    if (!isSftp) {
      if (remoteSearchUseSudo) remoteSearchUseSudo.checked = false;
      if (remoteSearchInsideFiles) remoteSearchInsideFiles.checked = false;
    }
    updateRemoteSearchTextField();
    updateRemoteSearchMeta();
  }

  function updateRemoteSearchTextField() {
    const visible = isRemoteSearchSftp() && Boolean(remoteSearchInsideFiles.checked);
    if (remoteSearchTextField) remoteSearchTextField.classList.toggle('hidden', !visible);
    if (remoteSearchTextToFind) remoteSearchTextToFind.disabled = !visible || remoteSearchState.status === 'running';
  }

  function setRemoteSearchValidation(message, field) {
    for (const control of [remoteSearchScopePath, remoteSearchFileName, remoteSearchTextToFind]) {
      if (!control) continue;
      control.classList.remove('remote-search-input-invalid');
      control.removeAttribute('aria-invalid');
    }

    const text = String(message || '');
    if (remoteSearchValidation) {
      remoteSearchValidation.textContent = text;
      remoteSearchValidation.style.visibility = text ? 'visible' : 'hidden';
    }

    if (field) {
      field.classList.add('remote-search-input-invalid');
      field.setAttribute('aria-invalid', 'true');
      window.setTimeout(() => field.focus(), 0);
    }
  }

  function clearRemoteSearchValidation(field) {
    if (field) {
      field.classList.remove('remote-search-input-invalid');
      field.removeAttribute('aria-invalid');
    } else {
      for (const control of [remoteSearchScopePath, remoteSearchFileName, remoteSearchTextToFind]) {
        if (!control) continue;
        control.classList.remove('remote-search-input-invalid');
        control.removeAttribute('aria-invalid');
      }
    }
    if (remoteSearchValidation) {
      remoteSearchValidation.textContent = '';
      remoteSearchValidation.style.visibility = 'hidden';
    }
  }

  function getDefaultRemoteSearchFormForConnection(connectionId) {
    const session = sessions.find(item => item.id === connectionId);
    const scopePath = normalizeSearchScopePath((session && session.currentPath) || currentPath.value || '/');
    return {
      scopePath,
      includeSubdirectories: true,
      includeHiddenFiles: false,
      caseSensitive: false,
      fileName: '*',
      searchInsideFiles: false,
      textToFind: '',
      useSudo: false
    };
  }

  function getRemoteSearchFormForConnection(connectionId) {
    const key = String(connectionId || '');
    if (!key) return getDefaultRemoteSearchFormForConnection('');
    const saved = remoteSearchFormsByConnectionId.get(key);
    if (saved) return Object.assign(getDefaultRemoteSearchFormForConnection(key), saved);
    const snapshot = remoteSearchStatesByConnectionId.get(key);
    if (snapshot && snapshot.status !== 'idle' && snapshot.options) {
      return Object.assign(getDefaultRemoteSearchFormForConnection(key), snapshot.options);
    }
    return getDefaultRemoteSearchFormForConnection(key);
  }

  function normalizeRemoteSearchFormForStorage(connectionId, form) {
    const key = String(connectionId || activeConnectionId || '');
    const normalized = Object.assign(getDefaultRemoteSearchFormForConnection(key), form || {});
    const context = getRemoteSearchSudoContext(key);
    if (!context.isSftp || context.isRootConnection) {
      normalized.useSudo = false;
    } else if (context.connectionSudoEnabled) {
      const existing = key ? remoteSearchFormsByConnectionId.get(key) : null;
      normalized.useSudo = Boolean(existing && existing.useSudo);
    }
    return normalized;
  }

  function applyRemoteSearchForm(form) {
    const options = form || getDefaultRemoteSearchFormForConnection(activeConnectionId);
    if (remoteSearchScopePath) remoteSearchScopePath.value = normalizeSearchScopePath(options.scopePath || currentPath.value || '/');
    if (remoteSearchSubdirectories) remoteSearchSubdirectories.checked = Boolean(options.includeSubdirectories);
    if (remoteSearchHiddenFiles) remoteSearchHiddenFiles.checked = Boolean(options.includeHiddenFiles);
    if (remoteSearchCaseSensitive) remoteSearchCaseSensitive.checked = Boolean(options.caseSensitive);
    if (remoteSearchFileName) remoteSearchFileName.value = String(options.fileName || '*');
    if (remoteSearchUseSudo) remoteSearchUseSudo.checked = Boolean(options.useSudo);
    if (remoteSearchInsideFiles) remoteSearchInsideFiles.checked = Boolean(options.searchInsideFiles);
    if (remoteSearchTextToFind) remoteSearchTextToFind.value = String(options.textToFind || '');
    updateRemoteSearchProtocolFields();
  }

  function applyRemoteSearchFormForActiveConnection() {
    applyRemoteSearchForm(getRemoteSearchFormForConnection(activeConnectionId));
  }

  function saveRemoteSearchFormForConnection(connectionId) {
    const key = String(connectionId || '');
    if (!key) return;
    remoteSearchFormsByConnectionId.set(key, normalizeRemoteSearchFormForStorage(key, collectRemoteSearchPayload()));
  }

  function saveRemoteSearchFormForActiveConnection() {
    saveRemoteSearchFormForConnection(activeConnectionId);
  }

  function showRemoteSearchDialog() {
    if (!activeConnectionId) return;
    remoteSearchDialogOpen = true;
    remoteSearchState = getRemoteSearchStateForActiveConnection();
    if (remoteSearchState.status !== 'running') {
      const key = String(activeConnectionId || '');
      const currentForm = getRemoteSearchFormForConnection(key);
      remoteSearchFormsByConnectionId.set(key, normalizeRemoteSearchFormForStorage(key, Object.assign({}, currentForm, { scopePath: normalizeSearchScopePath(currentPath.value || '/') })));
    }
    applyRemoteSearchFormForActiveConnection();
    clearRemoteSearchValidation();
    updateRemoteSearchMeta();
    renderRemoteSearchState();
    remoteSearchBackdrop.classList.add('visible');
    remoteSearchBackdrop.setAttribute('aria-hidden', 'false');
    window.setTimeout(() => remoteSearchFileName.focus(), 0);
    vscode.postMessage({ type: 'requestRemoteSearchState' });
  }

  function hideRemoteSearchDialog() {
    saveRemoteSearchFormForActiveConnection();
    remoteSearchDialogOpen = false;
    hideRemoteSearchScopePicker();
    remoteSearchBackdrop.classList.remove('visible');
    remoteSearchBackdrop.setAttribute('aria-hidden', 'true');
  }

  function collectRemoteSearchPayload(options) {
    const useEffectiveSudo = Boolean(options && options.effectiveSudo);
    return {
      scopePath: normalizeSearchScopePath(remoteSearchScopePath.value || currentPath.value || '/'),
      includeSubdirectories: Boolean(remoteSearchSubdirectories.checked),
      includeHiddenFiles: Boolean(remoteSearchHiddenFiles.checked),
      caseSensitive: Boolean(remoteSearchCaseSensitive.checked),
      fileName: String(remoteSearchFileName.value || '*').trim() || '*',
      searchInsideFiles: isRemoteSearchSftp() && Boolean(remoteSearchInsideFiles.checked),
      textToFind: String(remoteSearchTextToFind.value || ''),
      useSudo: useEffectiveSudo ? collectRemoteSearchEffectiveUseSudo(activeConnectionId) : collectRemoteSearchFormUseSudo(activeConnectionId)
    };
  }

  function startOrCancelRemoteSearch() {
    if (remoteSearchState.status === 'running') {
      remoteSearchState = Object.assign({}, remoteSearchState, { status: 'cancelled', finishedAt: Date.now() });
      storeRemoteSearchSnapshot(remoteSearchState);
      renderRemoteSearchState();
      vscode.postMessage({ type: 'cancelRemoteSearch' });
      return;
    }

    const payload = collectRemoteSearchPayload({ effectiveSudo: true });
    if (!String(remoteSearchScopePath.value || '').trim()) {
      setRemoteSearchValidation('Remote path is required.', remoteSearchScopePath);
      return;
    }
    if (payload.searchInsideFiles && !payload.textToFind.trim()) {
      setRemoteSearchValidation('Text to find is required when searching inside files.', remoteSearchTextToFind);
      return;
    }

    clearRemoteSearchValidation();
    saveRemoteSearchFormForActiveConnection();
    remoteSearchExpandedResultPaths.clear();
    remoteSearchSelectedResultKeys.clear();
    remoteSearchSelectionAnchorKey = '';
    vscode.postMessage({ type: 'startRemoteSearch', payload });
  }

  function clearRemoteSearch() {
    if (remoteSearchState.status === 'running') return;
    clearRemoteSearchValidation();
    remoteSearchExpandedResultPaths.clear();
    remoteSearchSelectedResultKeys.clear();
    remoteSearchSelectionAnchorKey = '';
    vscode.postMessage({ type: 'clearRemoteSearch' });
  }

  function browseRemoteSearchScope() {
    if (!activeConnectionId || remoteSearchState.status === 'running') return;
    const path = normalizeSearchScopePath(remoteSearchScopePath.value || currentPath.value || '/');
    showRemoteSearchScopePicker(path);
    requestRemoteSearchScopeEntries(path);
  }

  function showRemoteSearchScopePicker(path) {
    remoteSearchScopePickerOpen = true;
    remoteSearchScopePickerPathValue = normalizeSearchScopePath(path || '/');
    if (remoteSearchScopePicker) {
      remoteSearchScopePicker.classList.remove('hidden');
      remoteSearchScopePicker.setAttribute('aria-hidden', 'false');
    }
    if (remoteSearchScopePickerPath) remoteSearchScopePickerPath.textContent = remoteSearchScopePickerPathValue;
    if (remoteSearchScopePickerList) remoteSearchScopePickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
  }

  function hideRemoteSearchScopePicker() {
    remoteSearchScopePickerOpen = false;
    if (remoteSearchScopePicker) {
      remoteSearchScopePicker.classList.add('hidden');
      remoteSearchScopePicker.setAttribute('aria-hidden', 'true');
    }
  }

  function selectRemoteSearchScopePickerPath() {
    if (remoteSearchState.status === 'running') return;
    remoteSearchScopePath.value = normalizeSearchScopePath(remoteSearchScopePickerPathValue || '/');
    saveRemoteSearchFormForActiveConnection();
    clearRemoteSearchValidation(remoteSearchScopePath);
    hideRemoteSearchScopePicker();
  }

  function requestRemoteSearchScopeEntries(path) {
    if (!activeConnectionId || remoteSearchState.status === 'running') return;
    const scopePath = normalizeSearchScopePath(path || '/');
    remoteSearchScopePickerPathValue = scopePath;
    if (remoteSearchScopePickerPath) remoteSearchScopePickerPath.textContent = scopePath;
    if (remoteSearchScopePickerList) remoteSearchScopePickerList.innerHTML = '<div class="remote-search-scope-picker-empty">Loading...</div>';
    vscode.postMessage({ type: 'browseRemoteSearchScope', payload: { scopePath } });
  }

  function handleRemoteSearchScopeEntriesListed(payload) {
    if (!remoteSearchScopePickerOpen) return;
    if (payload.connectionId && activeConnectionId && payload.connectionId !== activeConnectionId) return;
    const path = normalizeSearchScopePath(payload.path || '/');
    const parentPath = normalizeSearchScopePath(payload.parentPath || '/');
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    remoteSearchScopePickerPathValue = path;
    if (remoteSearchScopePickerPath) remoteSearchScopePickerPath.textContent = path;
    if (!remoteSearchScopePickerList) return;
    const parentItem = '<button class="remote-search-scope-picker-item" type="button" data-remote-search-scope-path="' + escapeHtml(parentPath) + '"><span>..</span></button>';
    if (payload.error) {
      remoteSearchScopePickerList.innerHTML = parentItem + '<div class="remote-search-scope-picker-empty error">' + escapeHtml(payload.error || 'Unable to list this directory.') + '</div>';
      return;
    }
    const directoryItems = entries.map(entry => {
      const entryPath = normalizeSearchScopePath(entry.path || '/');
      const name = entry.name || entryPath;
      return '<button class="remote-search-scope-picker-item" type="button" data-remote-search-scope-path="' + escapeHtml(entryPath) + '"><span aria-hidden="true">▸</span><span>' + escapeHtml(name) + '</span><span class="remote-search-scope-picker-item-path">' + escapeHtml(entryPath) + '</span></button>';
    }).join('');
    remoteSearchScopePickerList.innerHTML = parentItem + (directoryItems || '<div class="remote-search-scope-picker-empty">No subdirectories.</div>');
  }

  function applyRemoteSearchSnapshot(snapshot) {
    const normalized = storeRemoteSearchSnapshot(snapshot);
    if (normalized.status === 'running' || normalized.status === 'idle') {
      resetRemoteSearchVisibleLimit(normalized.connectionId || activeConnectionId || '');
    }
    if (normalized.connectionId && activeConnectionId && normalized.connectionId !== activeConnectionId) {
      renderRemoteSearchBadge();
      return;
    }

    remoteSearchState = normalized;
    const options = remoteSearchState.options || {};
    if (remoteSearchState.status !== 'idle') {
      remoteSearchFormsByConnectionId.set(remoteSearchState.connectionId || activeConnectionId || '', normalizeRemoteSearchFormForStorage(remoteSearchState.connectionId || activeConnectionId || '', options));
      applyRemoteSearchForm(options);
      clearRemoteSearchValidation();
    } else if (remoteSearchDialogOpen) {
      applyRemoteSearchFormForActiveConnection();
    }
    updateRemoteSearchProtocolFields();
    renderRemoteSearchStateNow();
    setControls();
  }

  function appendRemoteSearchResult(payload) {
    appendRemoteSearchResultsBatch(Object.assign({}, payload, { results: payload && payload.result ? [payload.result] : [] }));
  }

  function appendRemoteSearchResultsBatch(payload) {
    const connectionId = payload.connectionId || activeConnectionId || '';
    const snapshot = remoteSearchStatesByConnectionId.get(connectionId) || createEmptyRemoteSearchState(connectionId, getActiveConnectionType());
    const incomingResults = Array.isArray(payload.results) ? payload.results : [];
    if (!snapshot.results) snapshot.results = [];
    if (snapshot.status === 'cancelled' && payload.status === 'running') {
      return;
    }
    if (payload.searchId && snapshot.id && payload.searchId !== snapshot.id) {
      return;
    }
    snapshot.status = payload.status || snapshot.status || 'running';
    if (incomingResults.length) {
      snapshot.results.push.apply(snapshot.results, incomingResults);
    }
    snapshot.totalResults = payload.totalResults || snapshot.results.length;
    remoteSearchStatesByConnectionId.set(connectionId, snapshot);

    if (!activeConnectionId || connectionId === activeConnectionId) {
      remoteSearchState = snapshot;
      scheduleRemoteSearchRender();
    } else {
      renderRemoteSearchBadge();
    }
  }

  function scheduleRemoteSearchRender() {
    if (remoteSearchRenderTimer) return;
    remoteSearchRenderTimer = setTimeout(() => {
      remoteSearchRenderTimer = 0;
      renderRemoteSearchStateNow();
      setControls();
    }, 100);
  }

  function renderRemoteSearchStateNow() {
    if (remoteSearchRenderTimer) {
      clearTimeout(remoteSearchRenderTimer);
      remoteSearchRenderTimer = 0;
    }
    const statusText = remoteSearchState.status === 'running'
      ? 'Running... ' + (remoteSearchState.totalResults || 0) + ' found'
      : remoteSearchState.status === 'completed'
        ? 'Completed - ' + (remoteSearchState.totalResults || 0) + ' found'
        : remoteSearchState.status === 'cancelled'
          ? 'Cancelled - ' + (remoteSearchState.totalResults || 0) + ' found'
          : remoteSearchState.status === 'failed'
            ? 'Failed - ' + (remoteSearchState.error || 'Search failed.')
            : 'Idle';

    if (remoteSearchResultsStatus) {
      remoteSearchResultsStatus.textContent = statusText;
      remoteSearchResultsStatus.classList.toggle('error', remoteSearchState.status === 'failed');
    }
    if (remoteSearchState.status === 'failed' && remoteSearchState.error) {
      setRemoteSearchValidation(remoteSearchState.error, null);
    } else if (remoteSearchState.status !== 'failed') {
      clearRemoteSearchValidation();
    }

    if (remoteSearchPrimaryButton) remoteSearchPrimaryButton.textContent = remoteSearchState.status === 'running' ? 'Stop' : 'Search';
    if (remoteSearchCopyButton) remoteSearchCopyButton.disabled = !Array.isArray(remoteSearchState.results) || remoteSearchState.results.length === 0;
    if (remoteSearchClearButton) remoteSearchClearButton.disabled = remoteSearchState.status === 'running';

    const running = remoteSearchState.status === 'running';
    if (running) hideRemoteSearchScopePicker();
    for (const control of [remoteSearchScopePath, remoteSearchBrowseButton, remoteSearchSubdirectories, remoteSearchHiddenFiles, remoteSearchCaseSensitive, remoteSearchUseSudo, remoteSearchInsideFiles, remoteSearchFileName]) {
      if (control) control.disabled = running;
    }
    updateRemoteSearchTextField();
    updateRemoteSearchMeta();
    renderRemoteSearchBadge();
    renderRemoteSearchResults();
  }

  function renderRemoteSearchState() {
    renderRemoteSearchStateNow();
  }

  function getRemoteSearchVisibleLimit(connectionId) {
    const key = connectionId || activeConnectionId || '';
    return remoteSearchVisibleLimitsByConnectionId.get(key) || REMOTE_SEARCH_INITIAL_VISIBLE_RESULTS;
  }

  function resetRemoteSearchVisibleLimit(connectionId) {
    const key = connectionId || activeConnectionId || '';
    if (key) remoteSearchVisibleLimitsByConnectionId.set(key, REMOTE_SEARCH_INITIAL_VISIBLE_RESULTS);
  }

  function showMoreRemoteSearchResults() {
    const key = remoteSearchState.connectionId || activeConnectionId || '';
    const current = getRemoteSearchVisibleLimit(key);
    remoteSearchVisibleLimitsByConnectionId.set(key, current + REMOTE_SEARCH_SHOW_MORE_STEP);
    renderRemoteSearchResults();
  }

  function renderRemoteSearchBadge() {
    if (!remoteSearchBadge) return;
    const activeState = getRemoteSearchStateForActiveConnection();
    const status = activeState.status;
    if (status === 'running') {
      remoteSearchBadge.textContent = '●';
      remoteSearchBadge.style.display = 'block';
    } else if (status === 'completed') {
      remoteSearchBadge.textContent = String(Math.min(99, activeState.totalResults || 0));
      remoteSearchBadge.style.display = 'block';
    } else if (status === 'failed') {
      remoteSearchBadge.textContent = '!';
      remoteSearchBadge.style.display = 'block';
    } else {
      remoteSearchBadge.style.display = 'none';
    }
  }

  function findRemoteSearchTextMatches(text, needle, caseSensitive) {
    const source = String(text || '');
    const query = String(needle || '');
    if (!query) return [];
    const haystack = caseSensitive ? source : source.toLowerCase();
    const target = caseSensitive ? query : query.toLowerCase();
    const matches = [];
    let index = 0;
    while (index <= haystack.length) {
      const found = haystack.indexOf(target, index);
      if (found < 0) break;
      matches.push({ start: found, end: found + target.length });
      index = Math.max(found + target.length, found + 1);
      if (matches.length >= 50) break;
    }
    return matches;
  }

  function buildRemoteSearchSnippetRanges(text, matches) {
    const source = String(text || '');
    const maxFullLength = 220;
    const before = 70;
    const after = 90;
    const maxRanges = 3;
    if (source.length <= maxFullLength || !matches.length) {
      return [{ start: 0, end: Math.min(source.length, maxFullLength), leading: false, trailing: source.length > maxFullLength }];
    }

    const ranges = [];
    for (const match of matches.slice(0, maxRanges)) {
      const start = Math.max(0, match.start - before);
      const end = Math.min(source.length, match.end + after);
      const previous = ranges[ranges.length - 1];
      if (previous && start <= previous.end + 12) {
        previous.end = Math.max(previous.end, end);
      } else {
        ranges.push({ start, end, leading: start > 0, trailing: false });
      }
    }
    ranges.forEach((range, index) => {
      range.leading = range.start > 0;
      range.trailing = range.end < source.length || index < ranges.length - 1;
    });
    return ranges;
  }

  function renderRemoteSearchMatchSnippet(text, query, caseSensitive) {
    const source = String(text || '');
    const matches = findRemoteSearchTextMatches(source, query, caseSensitive);
    const ranges = buildRemoteSearchSnippetRanges(source, matches);
    if (!matches.length) {
      const plain = source.length > 220 ? source.slice(0, 220) + '…' : source;
      return escapeHtml(plain);
    }

    let html = '';
    for (const range of ranges) {
      if (range.leading) html += '<span class="remote-search-ellipsis">…</span>';
      let cursor = range.start;
      for (const match of matches) {
        if (match.end <= range.start || match.start >= range.end) continue;
        const highlightStart = Math.max(match.start, range.start);
        const highlightEnd = Math.min(match.end, range.end);
        if (highlightStart > cursor) {
          html += escapeHtml(source.slice(cursor, highlightStart));
        }
        html += '<span class="remote-search-hit">' + escapeHtml(source.slice(highlightStart, highlightEnd)) + '</span>';
        cursor = highlightEnd;
      }
      if (cursor < range.end) {
        html += escapeHtml(source.slice(cursor, range.end));
      }
      if (range.trailing) html += '<span class="remote-search-ellipsis">…</span>';
    }
    return html;
  }

  function getRemoteSearchSelectedRows() {
    const rows = getRemoteSearchResultRows();
    if (!remoteSearchSelectedResultKeys.size) return [];
    return rows.filter(row => remoteSearchSelectedResultKeys.has(row.key));
  }

  function getRemoteSearchSelectedOrContextPaths() {
    const selectedRows = getRemoteSearchSelectedRows();
    const rawPaths = selectedRows.length
      ? selectedRows.map(row => row.path)
      : [remoteSearchContextPath];
    const paths = [];
    const seen = new Set();
    for (const rawPath of rawPaths) {
      const path = normalizeUiRemotePath(rawPath || '');
      if (!path || seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
    return paths;
  }

  function formatRemoteSearchSelectedPathsForCopy(mode) {
    const paths = getRemoteSearchSelectedOrContextPaths();
    if (!paths.length) return '';
    return paths.map(path => mode === 'name' ? getRemotePathBasename(path) : path).join('\\n');
  }

  function formatRemoteSearchResultsForCopy() {
    const results = Array.isArray(remoteSearchState.results) ? remoteSearchState.results : [];
    if (!results.length) return '';

    const contentSearch = results.some(result => result && typeof result.line !== 'undefined');
    if (!contentSearch) {
      return results.map(result => String(result.path || '').trim()).filter(Boolean).join('\\n');
    }

    const grouped = new Map();
    for (const result of results) {
      const path = result.path || '';
      if (!grouped.has(path)) grouped.set(path, []);
      grouped.get(path).push(result);
    }

    return Array.from(grouped.entries()).map(([path, matches]) => {
      const matchLabel = matches.length === 1 ? '1 match' : matches.length + ' matches';
      const lines = matches.map(match => '  ' + String(match.line || '') + ': ' + String(match.text || '')).join('\\n');
      return path + ' (' + matchLabel + ')' + (lines ? '\\n' + lines : '');
    }).join('\\n\\n');
  }

  function copyRemoteSearchResults() {
    const text = formatRemoteSearchResultsForCopy();
    if (!text) return;
    vscode.postMessage({ type: 'copyStatus', payload: { text, message: 'Copied search results' } });
  }

  function getRemoteSearchRenderableResults() {
    const results = Array.isArray(remoteSearchState.results) ? remoteSearchState.results : [];
    const visibleLimit = getRemoteSearchVisibleLimit(remoteSearchState.connectionId || activeConnectionId || '');
    return results.length > visibleLimit ? results.slice(0, visibleLimit) : results;
  }

  function renderRemoteSearchShowMore(totalResults, renderedResults) {
    if (totalResults <= renderedResults) return '';
    return '<div class="remote-search-show-more"><span>Showing ' + escapeHtml(String(renderedResults)) + ' of ' + escapeHtml(String(totalResults)) + ' results. Copy Results includes all results.</span><button class="secondary" type="button" data-remote-search-show-more="true">Show more</button></div>';
  }

  function getRemoteSearchResultRows() {
    const rows = [];
    const results = getRemoteSearchRenderableResults();
    const contentSearch = results.some(result => result && typeof result.line !== 'undefined');

    if (!contentSearch) {
      results.forEach((result, index) => {
        const path = result && result.path ? String(result.path) : '';
        if (!path) return;
        rows.push({
          key: 'file:' + path + ':' + index,
          path,
          kind: result && result.type === 'directory' ? 'directory' : 'file'
        });
      });
      return rows;
    }

    const grouped = new Map();
    for (const result of results) {
      const path = result && result.path ? String(result.path) : '';
      if (!path) continue;
      if (!grouped.has(path)) grouped.set(path, []);
      grouped.get(path).push(result);
    }

    for (const [path, matches] of grouped.entries()) {
      rows.push({ key: 'group:' + path, path, kind: 'file' });
      if (remoteSearchExpandedResultPaths.has(path)) {
        matches.forEach((match, index) => rows.push({
          key: 'match:' + path + ':' + String(match.line || '') + ':' + index,
          path,
          kind: 'file'
        }));
      }
    }

    return rows;
  }

  function getVisibleRemoteSearchResultKeys() {
    return getRemoteSearchResultRows().map(row => row.key);
  }

  function syncRemoteSearchSelectedRows() {
    if (!remoteSearchResults) return;
    for (const row of remoteSearchResults.querySelectorAll('.remote-search-result-row[data-remote-search-result-key]')) {
      row.classList.toggle('selected', remoteSearchSelectedResultKeys.has(row.getAttribute('data-remote-search-result-key') || ''));
    }
  }

  function normalizeRemoteSearchSelection() {
    const visibleKeys = new Set(getVisibleRemoteSearchResultKeys());
    remoteSearchSelectedResultKeys = new Set(Array.from(remoteSearchSelectedResultKeys).filter(key => visibleKeys.has(key)));
    if (remoteSearchSelectionAnchorKey && !visibleKeys.has(remoteSearchSelectionAnchorKey)) {
      remoteSearchSelectionAnchorKey = Array.from(remoteSearchSelectedResultKeys).pop() || '';
    }
  }

  function selectRemoteSearchResult(key) {
    remoteSearchSelectedResultKeys = new Set([key]);
    remoteSearchSelectionAnchorKey = key;
    syncRemoteSearchSelectedRows();
  }

  function toggleRemoteSearchResultSelection(key) {
    if (remoteSearchSelectedResultKeys.has(key)) {
      remoteSearchSelectedResultKeys.delete(key);
    } else {
      remoteSearchSelectedResultKeys.add(key);
      remoteSearchSelectionAnchorKey = key;
    }
    if (!remoteSearchSelectedResultKeys.size) remoteSearchSelectionAnchorKey = '';
    syncRemoteSearchSelectedRows();
  }

  function selectRemoteSearchResultRange(anchorKey, targetKey) {
    const visibleKeys = getVisibleRemoteSearchResultKeys();
    const anchorIndex = visibleKeys.indexOf(anchorKey);
    const targetIndex = visibleKeys.indexOf(targetKey);
    if (anchorIndex === -1 || targetIndex === -1) {
      selectRemoteSearchResult(targetKey);
      return;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    remoteSearchSelectedResultKeys = new Set(visibleKeys.slice(start, end + 1));
    remoteSearchSelectionAnchorKey = targetKey;
    syncRemoteSearchSelectedRows();
  }

  function renderRemoteSearchResults() {
    if (!remoteSearchResults) return;
    const allResults = Array.isArray(remoteSearchState.results) ? remoteSearchState.results : [];
    const results = getRemoteSearchRenderableResults();
    const showMoreHtml = renderRemoteSearchShowMore(allResults.length, results.length);
    if (!allResults.length) {
      remoteSearchSelectedResultKeys.clear();
      remoteSearchSelectionAnchorKey = '';
      remoteSearchResults.innerHTML = '<div class="remote-search-empty">' + escapeHtml(remoteSearchState.status === 'running' ? 'Searching...' : 'No results.') + '</div>';
      return;
    }

    const contentSearch = results.some(result => result && typeof result.line !== 'undefined');
    if (!contentSearch) {
      remoteSearchResults.innerHTML = results.map((result, index) => {
        const path = result.path || '';
        const kind = result.type === 'directory' ? 'directory' : 'file';
        const key = 'file:' + path + ':' + index;
        const selected = remoteSearchSelectedResultKeys.has(key) ? ' selected' : '';
        return '<div class="remote-search-result-row remote-search-file-result' + selected + '" data-remote-search-result-key="' + escapeHtml(key) + '" data-remote-search-result-path="' + escapeHtml(path) + '" data-remote-search-result-kind="' + escapeHtml(kind) + '">' + escapeHtml(path) + '</div>';
      }).join('') + showMoreHtml;
      normalizeRemoteSearchSelection();
      syncRemoteSearchSelectedRows();
      return;
    }

    const grouped = new Map();
    for (const result of results) {
      const path = result.path || '';
      if (!grouped.has(path)) grouped.set(path, []);
      grouped.get(path).push(result);
    }

    const options = remoteSearchState.options || {};
    const query = String(options.textToFind || '');
    const caseSensitive = Boolean(options.caseSensitive);
    remoteSearchResults.innerHTML = Array.from(grouped.entries()).map(([path, matches]) => {
      const expanded = remoteSearchExpandedResultPaths.has(path);
      const matchLabel = matches.length === 1 ? '1 match' : matches.length + ' matches';
      const groupKey = 'group:' + path;
      const groupSelected = remoteSearchSelectedResultKeys.has(groupKey) ? ' selected' : '';
      const lines = expanded
        ? matches.map((match, index) => {
          const matchKey = 'match:' + path + ':' + String(match.line || '') + ':' + index;
          const matchSelected = remoteSearchSelectedResultKeys.has(matchKey) ? ' selected' : '';
          return '<div class="remote-search-result-row remote-search-match' + matchSelected + '" data-remote-search-result-key="' + escapeHtml(matchKey) + '" data-remote-search-result-path="' + escapeHtml(path) + '" data-remote-search-result-kind="file"><span class="remote-search-line-number">' + escapeHtml(String(match.line || '')) + '</span><span class="remote-search-line-text">' + renderRemoteSearchMatchSnippet(match.text || '', query, caseSensitive) + '</span></div>';
        }).join('')
        : '';
      return '<div class="remote-search-result-group"><div class="remote-search-result-row remote-search-result-path' + groupSelected + '" data-remote-search-result-key="' + escapeHtml(groupKey) + '" data-remote-search-result-path="' + escapeHtml(path) + '" data-remote-search-result-kind="file">' + (expanded ? '▾ ' : '▸ ') + escapeHtml(path) + ' <span class="remote-search-match-count">(' + matchLabel + ')</span></div>' + lines + '</div>';
    }).join('') + showMoreHtml;
    normalizeRemoteSearchSelection();
    syncRemoteSearchSelectedRows();
  }


  function listDirectory(path, options = {}) {
    if (!activeConnectionId || busy) return;
    setBusy(true, 'Loading ' + path + '...');
    vscode.postMessage({ type: 'listDirectory', payload: { path, forceRefresh: Boolean(options.forceRefresh) } });
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
    const renderStart = performance.now();
    entriesBody.innerHTML = '';

    if (!entries.length) {
      const message = filterText ? 'No items match the current filter.' : 'This folder is empty.';
      entriesBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">' + message + '</div></td></tr>';
      postRenderPerformance(entries.length, performance.now() - renderStart);
      return;
    }

    for (const entry of entries) {
      const row = document.createElement('tr');
      const isParentEntry = entry.name === '..' && entry.type === 'directory';
      const entryKey = entry.path || entry.name;
      row.className = 'entry-row' + (selectedEntryPaths.has(entryKey) ? ' selected' : '');
      row.dataset.entryPath = entryKey;
      row.innerHTML = '<td><div class="entry-name"><span class="entry-icon">' + iconFor(entry) + '</span><span class="entry-text" data-entry-name-action="open">' + escapeHtml(formatEntryName(entry)) + '</span></div></td>' +
        '<td class="type">' + escapeHtml(formatEntryType(entry)) + '</td>' +
        '<td class="size">' + (isDirectoryLike(entry) ? '' : formatSize(entry.size)) + '</td>' +
        '<td class="owner">' + escapeHtml(formatMetadata(entry.owner)) + '</td>' +
        '<td class="group">' + escapeHtml(formatMetadata(entry.group)) + '</td>' +
        '<td class="permissions">' + escapeHtml(entry.permissions || '') + '</td>' +
        '<td class="modified">' + formatDate(entry.modifyTime) + '</td>';

      const entryNameText = row.querySelector('[data-entry-name-action="open"]');
      if (entryNameText) {
        entryNameText.addEventListener('click', event => {
          if (!openFileListItemsOnNameClick || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          hideContextMenu();
          if (event.detail > 1) {
            return;
          }
          selectEntry(entryKey);
          vscode.postMessage({ type: 'openEntry', payload: entry });
        });
        entryNameText.addEventListener('dblclick', event => {
          if (!openFileListItemsOnNameClick) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
        });
      }

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

    postRenderPerformance(entries.length, performance.now() - renderStart);
  }

  function postRenderPerformance(itemCount, renderMs) {
    vscode.postMessage({
      type: 'performanceLog',
      payload: {
        message: 'renderEntries',
        items: itemCount,
        renderMs: renderMs
      }
    });
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
    hideRemoteSearchResultContextMenu();
    hideTextEditContextMenu();
    entryContextMenu.classList.add('visible');
    entryContextMenu.style.left = '0px';
    entryContextMenu.style.top = '0px';

    const menuRect = entryContextMenu.getBoundingClientRect();
    const left = Math.min(clientX, Math.max(0, window.innerWidth - menuRect.width - 8));
    const top = Math.min(clientY, Math.max(0, window.innerHeight - menuRect.height - 8));
    entryContextMenu.style.left = left + 'px';
    entryContextMenu.style.top = top + 'px';
  }

  function setRemoteSearchContextActionVisible(element, visible) {
    if (element) element.style.display = visible ? '' : 'none';
  }

  function showRemoteSearchResultContextMenu(path, kind, clientX, clientY) {
    if (!activeConnectionId || !remoteSearchResultContextMenu) return;
    const normalizedPath = path ? normalizeUiRemotePath(path) : '';
    const normalizedKind = kind === 'directory' ? 'directory' : (normalizedPath ? 'file' : '');
    const hasPath = Boolean(normalizedPath);
    const isDirectory = normalizedKind === 'directory';
    const hasResults = Array.isArray(remoteSearchState.results) && remoteSearchState.results.length > 0;

    remoteSearchContextPath = normalizedPath;
    remoteSearchContextKind = normalizedKind;

    setRemoteSearchContextActionVisible(remoteSearchContextOpen, hasPath && !isDirectory);
    setRemoteSearchContextActionVisible(remoteSearchContextOpenReadOnly, hasPath && !isDirectory);
    setRemoteSearchContextActionVisible(remoteSearchContextFileSeparator, hasPath && !isDirectory);
    setRemoteSearchContextActionVisible(remoteSearchContextCopyPath, hasPath);
    setRemoteSearchContextActionVisible(remoteSearchContextCopyName, hasPath);
    setRemoteSearchContextActionVisible(remoteSearchContextResultsSeparator, hasPath && hasResults);
    setRemoteSearchContextActionVisible(remoteSearchContextCopyResults, hasResults);

    if (!hasPath && !hasResults) return;

    hideContextMenu();
    hideTextEditContextMenu();
    remoteSearchResultContextMenu.classList.add('visible');
    remoteSearchResultContextMenu.style.left = '0px';
    remoteSearchResultContextMenu.style.top = '0px';

    const menuRect = remoteSearchResultContextMenu.getBoundingClientRect();
    const left = Math.min(clientX, Math.max(0, window.innerWidth - menuRect.width - 8));
    const top = Math.min(clientY, Math.max(0, window.innerHeight - menuRect.height - 8));
    remoteSearchResultContextMenu.style.left = left + 'px';
    remoteSearchResultContextMenu.style.top = top + 'px';
  }

  function hideRemoteSearchResultContextMenu() {
    remoteSearchContextPath = '';
    remoteSearchContextKind = '';
    if (remoteSearchResultContextMenu) remoteSearchResultContextMenu.classList.remove('visible');
  }

  function getRemotePathBasename(path) {
    const normalized = normalizeUiRemotePath(path || '/');
    if (normalized === '/') return '/';
    const trimmed = normalized.replace(new RegExp('/+$'), '');
    const index = trimmed.lastIndexOf('/');
    return index >= 0 ? trimmed.slice(index + 1) : trimmed;
  }

  function getRemoteSearchContextEntry() {
    const path = normalizeUiRemotePath(remoteSearchContextPath || '');
    if (!path) return null;
    return {
      path,
      name: getRemotePathBasename(path),
      type: remoteSearchContextKind === 'directory' ? 'directory' : 'file',
      effectiveType: remoteSearchContextKind === 'directory' ? 'directory' : 'file',
      linkTarget: '',
      permissions: ''
    };
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
    const canCreateInContext = hasCurrentDirectoryActions || isSingleDirectory;
    const canRefresh = Boolean(activeConnectionId);
    const canRunRemoteCommand = Boolean(activeConnectionId) && capabilities.canRunCommand;
    const canOpenSshTerminal = canRunRemoteCommand && capabilities.canOpenSshTerminal;
    const canOpenLogViewer = Boolean(activeConnectionId) && capabilities.canRunCommand && (!hasEntryActions || isSingleFile);
    const canUpload = Boolean(activeConnectionId) && !hasEntryActions;
    const canCopyCurrentPath = Boolean(activeConnectionId) && !hasEntryActions;
    const canDownload = hasEntryActions;
    const canUploadWithEntryActions = Boolean(activeConnectionId) && canDownload;
    const hasTransferActions = canDownload || canUploadWithEntryActions;
    const hasItemToolActions = canCompress || canCalculateChecksums || canShowProperties || canChangePermissions || canChangeOwnerGroup;
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

    contextCopySeparator.style.display = canCopy && (canMakeCopy || canRename || canOpen || canOpenReadOnly || canCompare) ? '' : 'none';
    contextCopyPath.style.display = canCopy ? '' : 'none';
    contextCopyName.style.display = canCopy ? '' : 'none';
    contextCompressSubmenu.style.display = canCompress ? '' : 'none';

    contextCopyPath.textContent = selectedEntries.length > 1 ? 'Copy Paths' : 'Copy Path';
    if (selectedEntries.length > 1) {
      contextCopyName.textContent = isMixedSelection ? 'Copy Names' : allDirectories ? 'Copy Directory Names' : 'Copy Filenames';
    } else {
      contextCopyName.textContent = isSingleDirectory ? 'Copy Directory Name' : 'Copy Filename';
    }

    contextItemSeparator.style.display = (hasTransferActions || hasItemToolActions) && (canCopy || canMakeCopy || canRename || canOpen || canOpenReadOnly || canCompare) ? '' : 'none';
    contextDownload.style.display = canDownload ? '' : 'none';
    contextDownload.textContent = selectedEntries.length > 1 ? 'Download Selected...' : 'Download...';
    contextUploadEntry.style.display = canUploadWithEntryActions ? '' : 'none';
    contextUploadEntry.textContent = 'Upload...';
    contextTransferSeparator.style.display = hasTransferActions && hasItemToolActions ? '' : 'none';
    contextCalculateChecksums.style.display = canCalculateChecksums ? '' : 'none';
    contextFileProperties.style.display = canShowProperties ? '' : 'none';
    contextSetPermissions.style.display = canChangePermissions ? '' : 'none';
    contextChangeOwnerGroup.style.display = canChangeOwnerGroup ? '' : 'none';

    contextRefreshSeparator.style.display = (canCreateInContext || canRefresh || canRunRemoteCommand || canUpload) && (hasEntryActions || canOpen || canOpenReadOnly || canCompare) ? '' : 'none';
    contextCreateFile.style.display = canCreateInContext ? '' : 'none';
    contextCreateDirectory.style.display = canCreateInContext ? '' : 'none';
    contextUpload.style.display = canUpload ? '' : 'none';
    contextUpload.textContent = 'Upload...';
    contextEmptyCopySeparator.style.display = canCopyCurrentPath && canUpload ? '' : 'none';
    contextCopyCurrentPath.style.display = canCopyCurrentPath ? '' : 'none';
    contextEmptyRefreshSeparator.style.display = canCopyCurrentPath && (canRefresh || canOpenLogViewer || canRunRemoteCommand || canOpenSshTerminal) ? '' : 'none';
    contextRefresh.style.display = canRefresh ? '' : 'none';
    if (contextOpenLogViewer) contextOpenLogViewer.style.display = canOpenLogViewer ? '' : 'none';
    if (contextOpenLogViewer) contextOpenLogViewer.textContent = isSingleFile ? 'Open in Log Viewer' : 'Open Log Viewer';
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
    const trimmed = normalized.replace(new RegExp('/+$'), '');
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
    entriesTable.style.minWidth = '100%';
    entriesTable.style.maxWidth = '100%';
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

  function showServerToolbarStatus(message, kind = 'info', durationMs = 0) {
    if (!serverToolbarStatus) return;
    const text = String(message || '').trim();
    if (serverToolbarStatusTimer) {
      window.clearTimeout(serverToolbarStatusTimer);
      serverToolbarStatusTimer = 0;
    }
    serverToolbarStatus.textContent = text;
    if (text) serverToolbarStatus.setAttribute('data-tooltip', text); else serverToolbarStatus.removeAttribute('data-tooltip');
    serverToolbarStatus.classList.toggle('error', kind === 'error');
    serverToolbarStatus.classList.toggle('visible', Boolean(text) && getActiveConnectionView() === 'server');
    if (!text) return;
    const timeout = Number(durationMs || 0) || (kind === 'error' ? 7000 : 3000);
    serverToolbarStatusTimer = window.setTimeout(() => {
      serverToolbarStatus.textContent = '';
      serverToolbarStatus.removeAttribute('data-tooltip');
      serverToolbarStatus.classList.remove('visible', 'error');
      serverToolbarStatusTimer = 0;
    }, timeout);
  }

  function showStatusCopyFeedback(message) {
    if (!statusCopyFeedback) return;
    statusCopyFeedback.textContent = message || 'Copied';
    statusCopyFeedback.classList.add('visible');
    if (statusCopyFeedbackTimer) window.clearTimeout(statusCopyFeedbackTimer);
    statusCopyFeedbackTimer = window.setTimeout(() => {
      statusCopyFeedback.classList.remove('visible');
      statusCopyFeedbackTimer = 0;
    }, TOOLTIP_TRANSIENT_DURATION_MS);
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
    return key || (activeConnectionId || '__global__');
  }

  function createFilesStatusState(isBusy, message, options = {}) {
    return {
      busy: Boolean(isBusy),
      message: String(message || ''),
      isError: Boolean(options.isError),
      showOutputLink: Boolean(options.showOutputLink),
      outputLinkText: String(options.outputLinkText || 'See details in Output.'),
      cancelAction: Boolean(isBusy) ? String(options.cancelAction || '') : '',
      cancelLabel: String(options.cancelLabel || 'Cancel')
    };
  }

  function applyFilesStatusState(state) {
    const nextState = state || createFilesStatusState(false, activeConnectionId ? 'Ready.' : 'No active connection.');
    busy = Boolean(nextState.busy);
    statusCancelAction = busy ? String(nextState.cancelAction || '') : '';
    statusCancelLabel = String(nextState.cancelLabel || 'Cancel');
    if (!busy && isConnectionTransitionBusy()) {
      connectionButtonState = '';
    }
    setControls();
    statusText.textContent = nextState.message || (activeConnectionId ? 'Ready.' : 'No active connection.');
    setStatusOutputLink(Boolean(nextState.showOutputLink), nextState.outputLinkText || 'See details in Output.');
    status.className = busy ? 'statusbar busy' : (nextState.isError ? 'statusbar error' : 'statusbar');
  }

  function storeFilesStatusState(connectionId, state) {
    const key = getStatusConnectionKey(connectionId);
    filesStatusByConnectionId.set(key, state);
  }

  function restoreFilesStatusForActiveConnection() {
    const key = activeConnectionId || '__global__';
    const stored = filesStatusByConnectionId.get(key);
    applyFilesStatusState(stored || createFilesStatusState(false, activeConnectionId ? 'Ready.' : 'No active connection.'));
  }

  function setBusy(isBusy, message, cancelAction = '', cancelLabel = 'Cancel', connectionId = '') {
    const targetConnectionId = String(connectionId || '').trim();
    const state = createFilesStatusState(Boolean(isBusy), message, { cancelAction, cancelLabel });
    storeFilesStatusState(targetConnectionId, state);
    if (targetConnectionId && targetConnectionId !== activeConnectionId) return;
    if (isBusy) {
      hideContextMenu();
    }
    applyFilesStatusState(state);
  }

  function setStatus(message, isError = false, showOutputLink = false, outputLinkText = 'See details in Output.', connectionId = '') {
    const targetConnectionId = String(connectionId || '').trim();
    const state = createFilesStatusState(false, message, { isError, showOutputLink, outputLinkText });
    storeFilesStatusState(targetConnectionId, state);
    if (targetConnectionId && targetConnectionId !== activeConnectionId) return;
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

    saveProfileButton.disabled = isConnectedForm || Boolean(pendingFormSession) || hasConnectingSession;
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
  </script>
</body>
</html>`;
}
