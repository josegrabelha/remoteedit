export function renderProfileDropdownStyles(): string {
  return `  .profile-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: end; margin-bottom: 12px; min-width: 0; }
  .profile-picker-field { min-width: 0; }
  .profile-select-native { display: none; }
  .profile-picker { position: relative; min-width: 0; }
  .profile-dropdown-button { width: 100%; height: 31px; min-height: 31px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 5px 7px 5px 8px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); text-align: left; }
  .profile-dropdown-button:hover:not(:disabled) { background: var(--vscode-input-background); border-color: var(--vscode-focusBorder); }
  .profile-dropdown-button:focus { outline: none; border-color: var(--vscode-focusBorder); }
  .profile-dropdown-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .profile-dropdown-chevron { width: 15px; height: 15px; display: block; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; fill: none; opacity: 0.78; transition: transform 120ms ease; }
  .profile-picker.open .profile-dropdown-chevron, .auth-picker.open .profile-dropdown-chevron, .connection-type-picker.open .profile-dropdown-chevron, .jump-profile-picker.open .profile-dropdown-chevron, .connection-name-group-picker.open .profile-dropdown-chevron, .server-auto-refresh-picker.open .profile-dropdown-chevron { transform: rotate(180deg); }
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
  .profile-picker.open .profile-dropdown-menu, .auth-picker.open .profile-dropdown-menu, .connection-type-picker.open .profile-dropdown-menu, .jump-profile-picker.open .profile-dropdown-menu, .connection-name-group-picker.open .profile-dropdown-menu, .server-auto-refresh-picker.open .profile-dropdown-menu { display: block; }
  .profile-picker.open .connection-profile-dropdown-menu { display: flex; flex-direction: column; }
  .auth-select-native, .connection-type-select-native, .jump-profile-select-native { display: none; }
  .auth-picker, .connection-type-picker, .jump-profile-picker, .connection-name-group-picker { position: relative; min-width: 0; }
  .jump-profile-block[hidden] { display: none; }
  .jump-profile-dropdown-menu { max-height: min(300px, 55vh); overflow: hidden; }
  .jump-profile-picker.open .jump-profile-dropdown-menu { display: flex; flex-direction: column; }
  .jump-profile-dropdown-menu .profile-dropdown-filter { position: static; flex: 0 0 auto; }
  .jump-profile-dropdown-menu .profile-dropdown-meta { white-space: normal; line-height: 1.25; overflow-wrap: anywhere; }
  .jump-route-summary { margin-top: 5px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.3; opacity: 0.82; overflow-wrap: anywhere; }
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
  .connection-name-group-label[hidden], .connection-name-group-picker[hidden] { display: none !important; }
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
`;
}
