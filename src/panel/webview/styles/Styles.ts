export function renderStyles(): string {
  return `  :root { color-scheme: light dark; --remoteedit-validation-error: #b94a48; --remoteedit-connection-header-height: 50px; --remoteedit-session-tab-height: 34px; }
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
  .session-tab { position: relative; z-index: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: var(--remoteedit-session-tab-height); min-height: var(--remoteedit-session-tab-height); max-width: 220px; border: 1px solid var(--vscode-panel-border); border-bottom: 0; background: var(--vscode-editor-background); color: var(--vscode-tab-inactiveForeground, var(--vscode-foreground)); border-radius: 0; padding: 0 8px 0 10px; cursor: pointer; white-space: nowrap; line-height: normal; font-size: 12px; }
  .session-tab:hover:not(:disabled) { background: var(--vscode-tab-hoverBackground, var(--vscode-list-hoverBackground)); border-color: var(--vscode-panel-border); color: var(--vscode-foreground); }
  .session-tab + .session-tab { margin-left: -1px; }
  .session-tab.active { position: relative; z-index: 4; border: 1px solid var(--vscode-panel-border); border-bottom: 0; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); color: var(--vscode-tab-activeForeground, var(--vscode-foreground)); box-shadow: none; }
  .session-tab.active::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: var(--vscode-tab-activeBorderTop, var(--vscode-focusBorder)); border-radius: 0; pointer-events: none; }
  .session-tab.active:hover:not(:disabled) { background: var(--vscode-sideBar-background, var(--vscode-editor-background)); border-color: var(--vscode-panel-border); color: var(--vscode-tab-activeForeground, var(--vscode-foreground)); }
  .browser-session-strip .session-tab.active::after { content: ''; position: absolute; left: 1px; right: 1px; bottom: 0; z-index: 5; height: 1px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); pointer-events: none; }
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
  .session-empty { color: var(--vscode-descriptionForeground); font-size: 11.5px; line-height: var(--remoteedit-session-tab-height); opacity: 0.82; white-space: nowrap; }
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
  .browser-card { position: relative; flex: 1 1 auto; }
  .browser-open-section { position: relative; z-index: 2; isolation: isolate; display: block; flex: 0 0 var(--remoteedit-connection-header-height); min-height: var(--remoteedit-connection-header-height); height: var(--remoteedit-connection-header-height); max-height: var(--remoteedit-connection-header-height); padding: 0; overflow: hidden; background: var(--vscode-editor-background); }
  .browser-open-section::after { content: ''; position: absolute; z-index: 3; left: 0; right: 0; bottom: 0; height: 1px; background: var(--vscode-panel-border); pointer-events: none; }
  .browser-title-section { padding: 10px 12px; background: var(--vscode-editor-background); }
  .open-connections-row { position: absolute; left: 10px; right: 10px; bottom: 0; display: flex; align-items: flex-end; min-width: 0; min-height: var(--remoteedit-session-tab-height); height: var(--remoteedit-session-tab-height); width: auto; margin: 0; }
  .browser-open-section.empty-session-tabs .open-connections-row { top: 0; bottom: 0; height: auto; min-height: var(--remoteedit-connection-header-height); align-items: center; }
  .browser-session-strip { position: relative; margin-top: 0; min-height: var(--remoteedit-session-tab-height); height: var(--remoteedit-session-tab-height); padding: 0; flex: 1 1 auto; min-width: 0; justify-content: flex-start; align-items: flex-end; border-bottom: 0; overflow: hidden !important; transform: none; }
  .browser-session-strip.has-session-tabs { transform: none; }
  .browser-session-strip .session-tabs { flex: 1 1 auto; width: 100%; align-items: flex-end; height: var(--remoteedit-session-tab-height); max-height: var(--remoteedit-session-tab-height); padding-bottom: 0; margin-bottom: 0; overflow-x: hidden !important; overflow-y: hidden !important; gap: 0; scrollbar-width: none !important; -ms-overflow-style: none !important; }
  #sessionTabs::-webkit-scrollbar,
  .session-tabs::-webkit-scrollbar,
  .session-strip::-webkit-scrollbar,
  .browser-session-strip::-webkit-scrollbar,
  .browser-session-strip .session-tabs::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; background: transparent !important; }
  #sessionTabs::-webkit-scrollbar-track,
  .session-tabs::-webkit-scrollbar-track,
  .session-strip::-webkit-scrollbar-track,
  .browser-session-strip::-webkit-scrollbar-track,
  #sessionTabs::-webkit-scrollbar-thumb,
  .session-tabs::-webkit-scrollbar-thumb,
  .session-strip::-webkit-scrollbar-thumb,
  .browser-session-strip::-webkit-scrollbar-thumb { display: none !important; width: 0 !important; height: 0 !important; background: transparent !important; border: 0 !important; }
  .session-tabs-scrollbar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: transparent; pointer-events: none; z-index: 12; cursor: pointer; opacity: 0; display: none; }
  .session-tabs-scrollbar[hidden], .session-tabs-scrollbar:not(.visible) { display: none !important; }
  .session-tabs-scrollbar.visible { display: block; pointer-events: auto; opacity: 1; }
  .session-tabs-scrollbar-thumb { position: absolute; left: 0; top: 0; height: 3px; min-width: 24px; border-radius: 999px; background: var(--vscode-scrollbarSlider-background); opacity: 0.9; pointer-events: auto; }
  .session-tabs-scrollbar:hover .session-tabs-scrollbar-thumb { background: var(--vscode-scrollbarSlider-hoverBackground); opacity: 1; }
  .session-tabs-scrollbar.dragging .session-tabs-scrollbar-thumb { background: var(--vscode-scrollbarSlider-activeBackground); opacity: 1; }
    .browser-session-strip .session-tabs.empty { align-items: center; height: var(--remoteedit-session-tab-height); max-height: var(--remoteedit-session-tab-height); padding-bottom: 0; margin-bottom: 0; overflow-x: hidden !important; }
  .browser-session-strip .session-tab-drop-line { bottom: 0; }
  .browser-open-section.empty-session-tabs .browser-session-strip,
  .browser-open-section.empty-session-tabs .session-tabs.empty { min-height: var(--remoteedit-connection-header-height); height: var(--remoteedit-connection-header-height); align-items: center; }
  .browser-session-strip .session-tabs.empty .session-empty { display: inline-flex; align-items: center; height: auto; line-height: normal; }
  .browser-section-divider { position: relative; z-index: 0; height: 0; min-height: 0; flex: 0 0 0; margin: 0; background: transparent; pointer-events: none; }
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
  .server-auto-refresh-countdown { position: absolute; z-index: 1; left: 4px; bottom: -3px; display: none; max-width: min(var(--remote-path-width, 44vw), calc(100% - 520px)); color: var(--vscode-descriptionForeground); opacity: 0.62; font-size: 9px; line-height: 1; white-space: nowrap; pointer-events: none; user-select: none; -webkit-user-select: none; }
  .pathbar.server-toolbar-mode .server-auto-refresh-countdown:not([hidden]) { display: block; }
  .server-auto-refresh-countdown.refreshing { opacity: 0.72; }
  .pathbar.server-toolbar-mode .server-refresh-actions { display: inline-flex; }
  .pathbar.server-toolbar-mode .server-refresh-separator { display: block; }
  .connection-view-switch-button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); }
  .connection-view-switch-button.active { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); box-shadow: inset 0 0 0 1px var(--vscode-widget-border, var(--vscode-panel-border)); }
  .connection-view-switch-button:disabled { opacity: 0.48; cursor: default; }
  .connection-view { flex: 1 1 auto; min-width: 0; min-height: 0; }
  .files-view { position: relative; display: flex; flex-direction: column; }
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
  .server-overview-card.is-clickable { cursor: pointer; }
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
  .server-process-command-cell { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; }
  .server-process-command { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-foreground); font-size: 11.5px; }
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
  .server-process-zombie-badge { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; height: 16px; padding: 0 5px; border: 1px solid rgba(245, 196, 66, 0.34); border-radius: 999px; color: var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow, var(--vscode-foreground))); background: rgba(245, 196, 66, 0.12); font-size: 10px; line-height: 1; white-space: nowrap; }
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
  .card-header.connection-card-header { display: flex; justify-content: space-between; gap: 10px; align-items: center; flex: 0 0 var(--remoteedit-connection-header-height); height: var(--remoteedit-connection-header-height); min-height: var(--remoteedit-connection-header-height); max-height: var(--remoteedit-connection-header-height); padding: 7px 32px 7px 12px; }
  .connection-card-title-text { min-width: 0; }
  .panel-toggle-button { width: 28px; min-width: 28px; height: 28px; min-height: 28px; padding: 4px; border-radius: 3px; flex: 0 0 auto; }
  .connection-card-header .panel-toggle-button { width: 24px; min-width: 24px; height: 24px; min-height: 24px; padding: 3px; }
  .panel-toggle-button svg { width: 16px; height: 16px; }
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
  .webview-tooltip { position: fixed; z-index: 10000; max-width: min(520px, calc(100vw - 24px)); padding: 4px 7px; border-radius: 3px; background: var(--vscode-editorWidget-background); color: var(--vscode-editorWidget-foreground); border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28); font-size: 12px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(2px); transition: opacity 80ms ease, transform 80ms ease; }
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
  .profile-picker.open .profile-dropdown-chevron, .auth-picker.open .profile-dropdown-chevron, .connection-type-picker.open .profile-dropdown-chevron, .connection-name-group-picker.open .profile-dropdown-chevron, .server-auto-refresh-picker.open .profile-dropdown-chevron { transform: rotate(180deg); }
  .profile-dropdown-menu { position: absolute; z-index: 130; top: calc(100% + 4px); left: 0; right: 0; display: none; width: 100%; max-width: 100%; box-sizing: border-box; max-height: 300px; overflow-y: auto; overflow-x: hidden; padding: 5px; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); }
  .connection-profile-dropdown-menu { max-height: min(75vh, 600px); overflow: hidden; }
  .profile-dropdown-filter { padding: 2px 2px 5px; position: sticky; top: -5px; z-index: 1; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); }
  .connection-profile-dropdown-menu .profile-dropdown-filter { position: static; flex: 0 0 auto; }
  .profile-dropdown-filter input { width: 100%; height: 28px; box-sizing: border-box; padding: 4px 7px; }
  .profile-dropdown-pinned { flex: 0 0 auto; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); }
  .profile-dropdown-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
  .profile-dropdown-empty { color: var(--vscode-descriptionForeground); padding: 10px 7px; font-size: 12px; }
  .profile-dropdown-group-block { background: var(--vscode-sideBar-background); border-radius: 3px; overflow: hidden; margin: 0 0 2px; }
  .profile-dropdown-group-block:last-child { margin-bottom: 0; }
  .profile-dropdown-group-header { width: 100%; min-height: 24px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 6px; align-items: center; padding: 4px 7px 3px; border: 0; border-radius: 0; background: transparent; color: var(--vscode-descriptionForeground); font-size: 10.5px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.03em; text-align: left; cursor: pointer; }
  .profile-dropdown-group-header:hover, .profile-dropdown-group-header:focus-visible, .profile-dropdown-group-header:active { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); outline: none; }
  .profile-dropdown-group-header:hover .profile-dropdown-group-count, .profile-dropdown-group-header:focus-visible .profile-dropdown-group-count, .profile-dropdown-group-header:active .profile-dropdown-group-count { color: inherit; }
  .profile-dropdown-group-items { display: grid; gap: 0; }
  .profile-dropdown-group-chevron { width: 12px; display: inline-flex; align-items: center; justify-content: center; line-height: 1; opacity: 0.9; }
  .profile-dropdown-group-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .profile-dropdown-group-count { min-width: 16px; text-align: right; color: var(--vscode-descriptionForeground); font-size: 10.5px; font-weight: 500; }
  .connection-profile-dropdown-menu .profile-dropdown-group-header { background: transparent; color: var(--vscode-textLink-foreground, #3794ff); }
  .connection-profile-dropdown-menu .profile-dropdown-group-header .profile-dropdown-group-chevron, .connection-profile-dropdown-menu .profile-dropdown-group-header .profile-dropdown-group-name { opacity: 0.68; }
  .connection-profile-dropdown-menu .profile-dropdown-group-header:hover, .connection-profile-dropdown-menu .profile-dropdown-group-header:focus-visible, .connection-profile-dropdown-menu .profile-dropdown-group-header:active { background: var(--vscode-list-hoverBackground); color: var(--vscode-textLink-foreground, #3794ff); }
  .connection-profile-dropdown-menu .profile-dropdown-group-header:hover .profile-dropdown-group-chevron, .connection-profile-dropdown-menu .profile-dropdown-group-header:focus-visible .profile-dropdown-group-chevron, .connection-profile-dropdown-menu .profile-dropdown-group-header:active .profile-dropdown-group-chevron, .connection-profile-dropdown-menu .profile-dropdown-group-header:hover .profile-dropdown-group-name, .connection-profile-dropdown-menu .profile-dropdown-group-header:focus-visible .profile-dropdown-group-name, .connection-profile-dropdown-menu .profile-dropdown-group-header:active .profile-dropdown-group-name { opacity: 0.82; }
  .connection-profile-dropdown-menu .profile-dropdown-group-count { color: var(--vscode-textLink-foreground, #3794ff); opacity: 0.55; }
  .connection-profile-dropdown-menu .profile-dropdown-group-header:hover .profile-dropdown-group-count, .connection-profile-dropdown-menu .profile-dropdown-group-header:focus-visible .profile-dropdown-group-count, .connection-profile-dropdown-menu .profile-dropdown-group-header:active .profile-dropdown-group-count { color: inherit; opacity: 0.66; }
  .profile-picker.open .profile-dropdown-menu, .auth-picker.open .profile-dropdown-menu, .connection-type-picker.open .profile-dropdown-menu, .connection-name-group-picker.open .profile-dropdown-menu, .server-auto-refresh-picker.open .profile-dropdown-menu { display: block; }
  .profile-picker.open .connection-profile-dropdown-menu { display: flex; flex-direction: column; }
  .auth-select-native, .connection-type-select-native { display: none; }
  .auth-picker, .connection-type-picker, .connection-name-group-picker { position: relative; min-width: 0; }
  .connection-name-group-dropdown-menu { position: fixed; z-index: 10040; left: 0; top: 0; right: auto; width: 240px; max-width: calc(100vw - 16px); max-height: min(260px, calc(100vh - 24px)); }
  .connection-name-group-dropdown-menu.visible { display: block; }
  .connection-name-group-picker.new-group-mode .profile-dropdown-button { display: none; }
  .connection-name-group-new-input { width: 100%; height: 31px; min-height: 31px; box-sizing: border-box; }
  .connection-name-group-picker:not(.new-group-mode) .connection-name-group-new-input { display: none; }
  .connection-name-group-new-input[hidden] { display: none !important; }
  .auth-method-block.hidden { display: none; }
  .connection-type-note { display: none; margin-top: 5px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.25; opacity: 0.78; }
  .connection-type-note.visible { display: block; }
  .ftps-certificate-block { display: none; }
  .ftps-certificate-block.visible { display: block; margin-top: 8px; }
  .ftps-self-signed-row { margin-top: 8px; margin-bottom: 0; line-height: 1.35; }
  #ftpsCaCertificateBlock { margin-top: 10px; }
  .profile-dropdown-item { width: 100%; min-height: 34px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; align-items: center; padding: 6px 7px; border: 0; border-radius: 3px; background: transparent; color: inherit; text-align: left; }
  .connection-profile-dropdown-menu .profile-dropdown-item { min-height: 30px; padding: 4px 7px; }
  .connection-profile-dropdown-menu .profile-dropdown-item.grouped { background: transparent; padding-left: 13px; border-radius: 0; }
  .profile-dropdown-item:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  .profile-dropdown-item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .connection-profile-dropdown-menu .profile-dropdown-item { grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; cursor: pointer; }
  .connection-profile-dropdown-menu .profile-dropdown-main { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .profile-dropdown-name-row { min-width: 0; display: flex; align-items: center; gap: 5px; }
  .profile-dropdown-name.connected { color: var(--vscode-testing-iconPassed, #73c991); }
  .profile-dropdown-button.dirty .profile-dropdown-label, .profile-dropdown-label.dirty, .profile-dropdown-name.dirty, .profile-dropdown-item.selected .profile-dropdown-name.dirty { color: var(--vscode-inputValidation-warningForeground, var(--vscode-charts-yellow, #cca700)); }
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
  .connection-profile-dropdown-menu .profile-dropdown-meta { font-size: 10px; line-height: 1.2; opacity: 0.72; }
  .profile-dropdown-item.selected .profile-dropdown-meta { color: inherit; opacity: 0.78; }
  .profile-dropdown-separator { height: 1px; margin: 5px 3px; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); }
  .connection-name-group-label { display: block; margin-top: 10px; }
  .connection-name-group-dropdown-menu .profile-dropdown-item { min-height: 30px; padding: 5px 7px; }
  .connection-name-group-dropdown-menu .profile-dropdown-separator { margin: 4px 3px; }
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
  .remote-path-dropdown { position: absolute; z-index: 120; top: calc(100% + 4px); left: 0; display: none; width: min(640px, calc(100vw - 56px)); max-height: 300px; overflow-y: auto; overflow-x: hidden; padding: 6px; border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); }
  .remote-path-dropdown.visible { display: block; }
  .remote-path-dropdown-title { padding: 4px 7px 6px; font-size: 12px; font-weight: 650; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-path-dropdown-state { padding: 8px 7px; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.35; }
  .remote-path-dropdown-state.error { color: var(--vscode-errorForeground, var(--vscode-inputValidation-errorForeground)); }
  .remote-path-dropdown-item { width: 100%; min-height: 30px; display: grid; grid-template-columns: minmax(96px, 1fr) auto; gap: 14px; align-items: center; padding: 5px 7px; border: 0; border-radius: 3px; background: transparent; color: inherit; text-align: left; }
  .remote-path-dropdown-item:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  .remote-path-dropdown-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-path-dropdown-meta { color: var(--vscode-descriptionForeground); opacity: 0.72; font-size: 11px; white-space: nowrap; display: grid; grid-template-columns: minmax(0, 14ch) max-content; column-gap: 12px; align-items: center; }
  .remote-path-dropdown-meta-owner { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .remote-path-dropdown-meta-permissions { min-width: max-content; overflow: visible; text-overflow: clip; white-space: nowrap; text-align: right; }
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
  .table-wrap.drag-drop-target-active { border-color: var(--vscode-panel-border); box-shadow: inset 0 0 14px color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent), 0 0 10px color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent); }
  .table-wrap.privileged-session { border-color: color-mix(in srgb, #7a2f2f 62%, var(--vscode-panel-border)); box-shadow: 0 0 0 1px color-mix(in srgb, #7a2f2f 18%, transparent); }
  .table-wrap.privileged-session.drag-drop-target-active { border-color: color-mix(in srgb, #7a2f2f 62%, var(--vscode-panel-border)); box-shadow: inset 0 0 14px color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent), 0 0 10px color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent), 0 0 0 1px color-mix(in srgb, #7a2f2f 18%, transparent); }
  table { width: 100%; min-width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 6px 10px; line-height: 1.25; border-bottom: 1px solid var(--vscode-panel-border); text-align: left; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  th { position: sticky; top: 0; background: var(--vscode-sideBar-background); font-weight: 500; z-index: 1; user-select: none; overflow: visible; }
  th.sortable { cursor: pointer; }
  th.sortable:hover { background: var(--vscode-list-hoverBackground); }
  th.size, td.size { text-align: right; }
  th.permissions, td.permissions { font-family: var(--vscode-editor-font-family); }
  table.hide-posix-metadata col[data-column="owner"], table.hide-posix-metadata col[data-column="group"], table.hide-posix-metadata col[data-column="permissions"], table.hide-posix-metadata th.owner, table.hide-posix-metadata th.group, table.hide-posix-metadata th.permissions, table.hide-posix-metadata td.owner, table.hide-posix-metadata td.group, table.hide-posix-metadata td.permissions { display: none; }
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
  tr.entry-row.drop-target { outline: none; background: color-mix(in srgb, var(--vscode-list-hoverBackground) 78%, transparent); box-shadow: inset 0 0 12px color-mix(in srgb, var(--vscode-focusBorder) 26%, transparent), inset 0 0 0 9999px color-mix(in srgb, var(--vscode-focusBorder) 5%, transparent); }
  tr.entry-row.drag-source { opacity: 0.72; }
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
  .server-overview-details { display: grid; gap: 12px; }
  .server-overview-detail-grid { display: grid; grid-template-columns: 150px minmax(0, 1fr); border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; background: var(--vscode-editor-background); }
  .server-overview-detail-section { display: grid; gap: 7px; min-width: 0; }
  .server-overview-detail-section-title { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.03em; }
  .server-overview-detail-table-wrap { border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: auto; background: var(--vscode-editor-background); }
  .server-overview-detail-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .server-overview-detail-table th, .server-overview-detail-table td { padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); text-align: left; white-space: nowrap; }
  .server-overview-detail-table th { color: var(--vscode-descriptionForeground); font-weight: 650; background: color-mix(in srgb, var(--vscode-editor-background) 95%, var(--vscode-foreground)); }
  .server-overview-detail-table tr:last-child td { border-bottom: 0; }
  .server-overview-detail-empty { padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background); font-size: 12px; }
  #serverOverviewDetailsBackdrop .file-properties-dialog { width: min(600px, 100%); }
  #serverOverviewDetailsBackdrop .file-properties-header { padding: 12px 16px 8px; }
  #serverOverviewDetailsBackdrop .file-properties-title { margin-bottom: 3px; font-size: 16px; }
  #serverOverviewDetailsBackdrop .file-properties-body { padding: 10px 16px 16px; }
  #serverOverviewDetailsBackdrop .file-properties-actions { margin-top: 2px; padding: 4px 16px 12px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); }
  #serverOverviewDetailsCopyButton, #confirmDialogCopyButton { width: 58px; min-width: 58px; display: inline-flex; align-items: center; justify-content: center; text-align: center; white-space: nowrap; padding-left: 0; padding-right: 0; }
  #serverOverviewDetailsBackdrop .server-overview-details { gap: 8px; }
  #serverOverviewDetailsBackdrop .server-overview-detail-grid { grid-template-columns: 118px minmax(0, 1fr); }
  #serverOverviewDetailsBackdrop .file-properties-label, #serverOverviewDetailsBackdrop .file-properties-value { padding: 5px 8px; line-height: 1.25; font-size: 11.5px; }
  #serverOverviewDetailsBackdrop .server-overview-detail-section { gap: 5px; }
  #serverOverviewDetailsBackdrop .server-overview-detail-section-title { font-size: 10.5px; }
  #serverOverviewDetailsBackdrop .server-overview-detail-table { font-size: 11px; }
  #serverOverviewDetailsBackdrop .server-overview-detail-table th, #serverOverviewDetailsBackdrop .server-overview-detail-table td { padding: 4px 7px; }
  #serverOverviewDetailsBackdrop .server-overview-detail-empty { padding: 8px 10px; font-size: 11.5px; }
  .manage-profiles-dialog { width: min(640px, calc(100vw - 48px)); height: min(560px, calc(100vh - 48px)); max-height: calc(100vh - 48px); }
  .manage-profiles-dialog .file-properties-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .manage-profiles-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .manage-profiles-filter { flex: 1 1 auto; min-width: 0; }
  .manage-profiles-filter input { width: 100%; box-sizing: border-box; }
  .manage-profiles-toolbar-separator { width: 1px; height: 22px; flex: 0 0 auto; background: var(--vscode-panel-border); opacity: 0.9; }
  .manage-profiles-toolbar-actions { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .manage-profiles-toolbar-actions button { min-height: 26px; height: 26px; padding: 2px 8px; font-size: 12px; }
  .manage-profiles-toolbar-actions .manage-profiles-group-action-button { width: 26px; min-width: 26px; height: 26px; min-height: 26px; padding: 3px; }
  .manage-profiles-toolbar-actions .manage-profiles-group-action-button svg { width: 18px; height: 18px; display: block; fill: currentColor; }
  .manage-profiles-group-action-button[hidden] { display: none !important; }
  .manage-profiles-list { position: relative; flex: 1 1 auto; min-height: 0; display: grid; align-content: start; gap: 6px; overflow: auto; padding: 3px 0; }
  .manage-profiles-drop-line { position: absolute; left: 0; right: 0; height: 1px; background: var(--vscode-focusBorder); pointer-events: none; z-index: 8; display: none; }
  .manage-profiles-empty { color: var(--vscode-descriptionForeground); padding: 14px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
  .manage-profiles-header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
  .manage-profiles-header-actions { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
  .manage-profiles-header-actions button { min-height: 28px; height: 28px; padding: 3px 10px; font-size: 12px; }
  .manage-profile-group-header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto auto; gap: 6px; align-items: center; min-height: 34px; padding: 4px 6px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-sideBar-background); }
  .manage-profile-group-header.renaming { grid-template-columns: 1fr; }
  .manage-profile-group-header:not(.renaming) { cursor: pointer; }
  .manage-profile-group-header:not(.renaming):hover, .manage-profile-group-header:not(.renaming):focus-within { background: var(--vscode-list-hoverBackground); }
  .manage-profile-group-header:not(.collapsed) { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .manage-profile-group-body { display: grid; gap: 5px; margin-top: -6px; padding: 6px; border: 1px solid var(--vscode-panel-border); border-top: 0; border-radius: 0 0 6px 6px; background: var(--vscode-sideBar-background); }
  .manage-profile-group-body.empty { min-height: 18px; }
  .manage-profile-group-header.drag-over-group,
  .manage-profile-group-body.drag-over-group { border-color: var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
  .manage-profiles-list.drag-over-loose { outline: none; }
  .manage-profile-group-drop-placeholder { min-height: 18px; display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); font-size: 11px; opacity: 0.78; pointer-events: none; }
  .manage-profile-group-toggle { width: 24px; min-width: 24px; height: 24px; min-height: 24px; padding: 0; border: 0; background: transparent; color: var(--vscode-descriptionForeground); display: inline-flex; align-items: center; justify-content: center; line-height: 1; }
  .manage-profile-group-toggle:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); }
  .manage-profile-group-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; }
  .manage-profile-group-count { color: var(--vscode-descriptionForeground); font-size: 11px; min-width: 18px; text-align: right; }
  .manage-profile-group-header:not(.renaming) .manage-profile-group-toggle,
  .manage-profile-group-header:not(.renaming) .manage-profile-group-name { color: var(--vscode-textLink-foreground, #3794ff); opacity: 0.68; }
  .manage-profile-group-header:not(.renaming) .manage-profile-group-count { color: var(--vscode-textLink-foreground, #3794ff); opacity: 0.55; }
  .manage-profile-group-header:not(.renaming):hover .manage-profile-group-toggle,
  .manage-profile-group-header:not(.renaming):focus-within .manage-profile-group-toggle,
  .manage-profile-group-header:not(.renaming):hover .manage-profile-group-name,
  .manage-profile-group-header:not(.renaming):focus-within .manage-profile-group-name { opacity: 0.82; }
  .manage-profile-group-header:not(.renaming):hover .manage-profile-group-count,
  .manage-profile-group-header:not(.renaming):focus-within .manage-profile-group-count { opacity: 0.66; }
  .manage-profile-group-header .manage-profile-icon-button { align-self: center; box-sizing: border-box; width: 26px; min-width: 26px; height: 26px; min-height: 26px; padding: 3px; }
  .manage-profile-group-header:not(.renaming) > .manage-profile-icon-button { color: var(--vscode-textLink-foreground, #3794ff); border-color: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 32%, var(--vscode-button-border, var(--vscode-input-border, var(--vscode-panel-border)))); }
  .manage-profile-group-header:not(.renaming) > .manage-profile-icon-button svg { opacity: 0.68; }
  .manage-profile-group-header:not(.renaming):hover > .manage-profile-icon-button svg,
  .manage-profile-group-header:not(.renaming):focus-within > .manage-profile-icon-button svg { opacity: 0.82; }
  .manage-profile-group-header .manage-profile-icon-button svg { width: 18px; height: 18px; }
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
  .manage-group-remove-name { padding: 7px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .manage-group-remove-options { display: grid; gap: 8px; margin-top: 2px; }
  .manage-group-remove-option { align-items: flex-start; padding: 6px 7px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
  .manage-group-remove-option > span { display: grid; gap: 2px; min-width: 0; }
  .manage-group-remove-option-title { font-weight: 600; }
  .manage-group-remove-options input[type="radio"] { appearance: none; -webkit-appearance: none; position: relative; flex: 0 0 auto; width: 14px; min-width: 14px; height: 14px; min-height: 14px; margin: 1px 0 0; padding: 0; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 50%; background: var(--vscode-input-background); cursor: pointer; }
  .manage-group-remove-options input[type="radio"]:checked { border-color: var(--vscode-button-background); }
  .manage-group-remove-options input[type="radio"]:checked::after { content: ''; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-button-background); transform: translate(-50%, -50%); }
  .manage-group-remove-options input[type="radio"]:focus-visible { border-color: var(--vscode-focusBorder); outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .backup-import-mode input[type="radio"] { appearance: none; -webkit-appearance: none; position: relative; flex: 0 0 auto; width: 14px; min-width: 14px; height: 14px; min-height: 14px; margin: 0; padding: 0; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 50%; background: var(--vscode-input-background); cursor: pointer; }
  .backup-import-mode input[type="radio"]:checked { border-color: var(--vscode-button-background); }
  .backup-import-mode input[type="radio"]:checked::after { content: ''; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-button-background); transform: translate(-50%, -50%); }
  .backup-import-mode input[type="radio"]:focus-visible { border-color: var(--vscode-focusBorder); outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .backup-import-mode input[type="radio"]:disabled { opacity: 0.68; cursor: default; }
  .backup-mode-help { margin: 0; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.35; opacity: 0.78; }
  .backup-validation { min-height: 16px; color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground)); font-size: 12px; line-height: 1.35; }
  @media (max-width: 560px) { .manage-profiles-header-row { flex-direction: column; } .manage-profiles-toolbar { flex-wrap: wrap; align-items: stretch; } .manage-profiles-filter { flex-basis: 100%; } .manage-profiles-toolbar-separator { display: none; } .manage-profiles-toolbar-actions { margin-left: auto; } .backup-credential-fields { grid-template-columns: 1fr; } }
  .manage-profile-row { --manage-profile-row-height: 44px; position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 6px; align-items: center; height: var(--manage-profile-row-height); min-height: var(--manage-profile-row-height); max-height: var(--manage-profile-row-height); padding: 5px 6px; overflow: hidden; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
  .manage-profile-row.grouped { background: var(--vscode-editor-background); }
  .manage-profile-row.can-reorder { cursor: grab; }
  .manage-profile-row.dragging { opacity: 0.55; cursor: grabbing; }
  .manage-profile-row.drag-over-before,
  .manage-profile-row.drag-over-after { border-color: var(--vscode-panel-border); box-shadow: none; }
  .manage-profile-drag-handle { width: 15px; min-width: 15px; height: 20px; display: inline-flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); opacity: 0.62; cursor: grab; line-height: 0; }
  .manage-profile-row.can-reorder:hover .manage-profile-drag-handle { opacity: 0.95; }
  .manage-profile-row.dragging .manage-profile-drag-handle { cursor: grabbing; }
  .manage-profile-drag-handle.disabled { opacity: 0.25; cursor: default; }
  .manage-profile-drag-handle svg { width: 13px; height: 13px; display: block; fill: currentColor; }
  .manage-profile-main { min-width: 0; }
  .manage-profile-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .manage-profile-meta { color: var(--vscode-descriptionForeground); font-size: 10.5px; line-height: 1.2; opacity: 0.72; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .manage-profile-rename-form, .manage-profile-group-rename-form { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; align-items: center; align-self: center; grid-column: 1 / -1; min-height: 26px; }
  .manage-profile-rename-form input, .manage-profile-group-rename-form input { height: 26px; }
  .manage-profile-row button, .manage-profile-group-header button { min-height: 26px; padding: 2px 6px; }
  .manage-profile-icon-button { width: 26px; min-width: 26px; height: 26px; min-height: 26px; padding: 3px; display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
  .manage-profile-icon-button svg { width: 18px; height: 18px; display: block; fill: currentColor; stroke: none; flex: 0 0 auto; }
  .manage-profile-row:not(.renaming) > .manage-profile-icon-button,
  .manage-profile-group-header > .manage-profile-icon-button { opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
  .manage-profile-row:not(.renaming):hover > .manage-profile-icon-button,
  .manage-profile-row:not(.renaming):focus-within > .manage-profile-icon-button,
  .manage-profile-group-header:hover > .manage-profile-icon-button,
  .manage-profile-group-header:focus-within > .manage-profile-icon-button { opacity: 1; pointer-events: auto; }
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
  .status-output-link { appearance: none; -webkit-appearance: none; display: inline-flex; align-items: center; flex: 0 0 auto; min-height: 0; height: 20px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-size: inherit; font-weight: inherit; line-height: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; white-space: nowrap; }
  .status-output-link[hidden] { display: none !important; }
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
  @media (max-height: 720px) and (min-width: 981px) { .hint-list { display: none; } .card-header, .card-body, .browser-title-section { padding: 9px 10px; } .card-header.connection-card-header { padding: 6px 30px 6px 10px; } }
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
`;
}
