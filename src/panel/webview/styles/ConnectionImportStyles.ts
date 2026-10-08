export function renderConnectionImportStyles(): string {
  return `
#connectionImportUnlockBackdrop { z-index: 280; }
#connectionImportConfirmBackdrop { z-index: 270; }
.file-properties-dialog.connection-import-unlock-dialog { width: min(460px, calc(100vw - 48px)); height: min(280px, calc(100vh - 36px)); box-sizing: border-box; }
#connectionImportUnlockBackdrop .connection-import-unlock-dialog .file-properties-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; gap: 5px; padding: 12px 16px 5px; overflow: hidden; }
.connection-import-unlock-dialog .file-properties-actions { flex: 0 0 auto; margin-top: auto; padding: 0 16px 14px; }
.connection-import-unlock-dialog .connection-import-unlock-note { margin-top: 5px; }
.connection-import-unlock-feedback { flex: 0 0 15px; height: 15px; min-width: 0; font-size: 10px; line-height: 15px; color: var(--vscode-errorForeground); opacity: 0.85; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.file-properties-dialog.connection-import-confirm-dialog { width: min(500px, calc(100vw - 48px)); min-height: 205px; max-height: calc(100vh - 36px); box-sizing: border-box; }
.connection-import-confirm-dialog .file-properties-body { flex: 1 1 auto; min-height: 0; gap: 9px; }
.connection-import-confirm-text { font-size: 12px; line-height: 1.4; }
.connection-import-confirm-risk { color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.35; }
.connection-import-confirm-risk.connection-import-dependency-list { white-space: pre-line; overflow: auto; max-height: min(240px, 38vh); }
.connection-import-confirm-dialog .file-properties-actions { flex-wrap: wrap; }
.connection-import-unlocked { margin-top: 5px; color: var(--vscode-testing-iconPassed, #73c991); font-size: 10px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; }
.connection-import-unlocked svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

#connectionImportBackdrop { z-index: 260; }
.file-properties-dialog.connection-import-dialog { width: min(1120px, calc(100vw - 40px)); height: min(635px, calc(100vh - 40px)); max-height: calc(100vh - 40px); }
.connection-import-dialog .file-properties-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.connection-import-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; }
.connection-import-dialog .server-overview-detail-table { font-size: 11px; }
.connection-import-dialog .server-overview-detail-table th,
.connection-import-dialog .server-overview-detail-table td { padding: 4px 7px; }
.connection-import-sources-table th,
.connection-import-sources-table td { height: 32px; }
.connection-import-sources-table th:nth-child(1),
.connection-import-sources-table td:nth-child(1) { width: 52px; }
.connection-import-sources-table th:nth-child(5),
.connection-import-sources-table td:nth-child(5) { width: 90px; }
.connection-import-sources-table th:nth-child(1),
.connection-import-sources-table td:nth-child(1),
.connection-import-sources-table th:nth-child(5),
.connection-import-sources-table td:nth-child(5) { text-align: center; }
.connection-import-sources-table td:first-child .dialog-checkbox { display: block; margin: 0 auto; }
.connection-import-dialog tbody tr:hover { background: var(--vscode-list-hoverBackground); }
.connection-import-dialog tbody tr:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.connection-import-dialog tr.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.connection-import-source-row { cursor: pointer; }
.connection-import-source-row button,
.connection-import-source-row input { cursor: default; }
.connection-import-dialog .server-overview-detail-table td > button.secondary { min-height: 24px; height: 24px; padding: 1px 7px; font-size: 11px; }
.connection-import-dialog .server-overview-detail-table td > button.connection-import-source-action { width: 64px; min-width: 64px; padding-left: 5px; padding-right: 5px; }
.connection-import-details { flex: 0 0 auto; max-height: 170px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.connection-import-details:empty { display: none; }
.connection-import-details p { margin: 6px 0; }
.connection-import-review-layout { display: flex !important; flex-direction: column; gap: 0; overflow: hidden !important; }
.connection-import-review-layout .connection-import-scroll { flex: 1 1 auto; min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-bottom: 6px; scrollbar-width: none; -ms-overflow-style: none; }
.connection-import-review-layout .connection-import-details { display: block; flex: 0 0 250px; min-width: 0; min-height: 250px; max-height: 250px; box-sizing: border-box; overflow: hidden; padding: 6px 2px 5px; border-top: 1px solid var(--vscode-panel-border); white-space: normal; font-size: 10px; line-height: 1.2; }
.connection-import-review-layout .connection-import-scroll::-webkit-scrollbar,
.connection-import-review-layout .connection-import-details::-webkit-scrollbar { width: 0; height: 0; display: none; }
.connection-import-result-layout .connection-import-details { flex: 0 0 210px; min-height: 210px; max-height: 210px; overflow-y: auto; padding: 9px 3px; }
.connection-import-result-layout .connection-import-scroll { display: flex; flex-direction: column; overflow: hidden; }
.connection-import-result-summary { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 11px; padding: 6px 5px 10px; }
.connection-import-result-table-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; -ms-overflow-style: none; }
.connection-import-result-table-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
.connection-import-result-table { table-layout: fixed; width: 100%; }
.connection-import-result-table thead th { position: sticky; top: 0; z-index: 1; }
.connection-import-result-table th:first-child, .connection-import-result-table td:first-child { width: 32%; }
.connection-import-result-table th:nth-child(2), .connection-import-result-table td:nth-child(2) { width: 105px; }
.connection-import-result-table td { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.connection-import-result-row { cursor: pointer; }
.connection-import-result-imported { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
.connection-import-result-failed { color: var(--vscode-errorForeground); }
.connection-import-result-skipped { color: var(--vscode-descriptionForeground); }
.connection-import-result-detail-grid { display: grid; grid-template-columns: 88px minmax(0,1fr) 88px minmax(0,1fr); gap: 5px 9px; font-size: 11px; }
.connection-import-result-detail-value { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.connection-import-result-note { margin-top: 7px; font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
.connection-import-result-note.warning { color: var(--vscode-descriptionForeground); }
.connection-import-review-table { width: 100%; min-width: 0; table-layout: fixed; font-size: 10.5px !important; }
.connection-import-review-table th,
.connection-import-review-table td { min-width: 0; height: 32px; padding: 4px 5px !important; overflow: visible; vertical-align: middle; }
.connection-import-review-table th:nth-child(1), .connection-import-review-table td:nth-child(1) { width: 34px; text-align: center; }
.connection-import-review-table th:nth-child(2), .connection-import-review-table td:nth-child(2) { width: 82px; }
.connection-import-review-table th:nth-child(3), .connection-import-review-table td:nth-child(3) { width: 194px; }
.connection-import-review-table th:nth-child(4), .connection-import-review-table td:nth-child(4) { width: 74px; }
.connection-import-review-table th:nth-child(5), .connection-import-review-table td:nth-child(5) { width: auto; }
.connection-import-review-table th:nth-child(6), .connection-import-review-table td:nth-child(6) { width: 76px; }
.connection-import-review-table th:nth-child(7), .connection-import-review-table td:nth-child(7) { width: 294px; }
.connection-import-review-table th:first-child .dialog-checkbox,
.connection-import-review-table td:first-child .dialog-checkbox { display: block; margin: 0 auto; }
.connection-import-review-row { cursor: pointer; }
.connection-import-review-row button,
.connection-import-review-row input { cursor: default; }
.connection-import-review-table td.connection-import-review-value { min-width: 0; white-space: normal; overflow-wrap: anywhere; word-break: normal; }
.connection-import-review-table td:nth-child(3) { overflow-wrap: anywhere; }
.connection-import-review-table th .server-list-column-sort-button { width: 100%; }
.connection-import-review-table th[aria-sort="ascending"] .server-list-column-sort-button,
.connection-import-review-table th[aria-sort="descending"] .server-list-column-sort-button { color: var(--vscode-foreground); }
.connection-import-review-table td:nth-child(2),
.connection-import-review-table td:nth-child(4),
.connection-import-review-table td:nth-child(6) { white-space: nowrap; overflow-wrap: normal; }
.connection-import-select-all:indeterminate { background: var(--vscode-button-background); border-color: var(--vscode-button-background); }
.connection-import-select-all:indeterminate::after { content: ''; position: absolute; left: 3px; right: 3px; top: 50%; height: 1.5px; background: var(--vscode-button-foreground); transform: translateY(-50%); }
.connection-import-review-layout .connection-import-picker .profile-dropdown-button { width: 100%; }
.connection-import-action-controls { display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
.connection-import-action-controls .connection-import-picker + .connection-import-picker { margin-top: 0; }
.connection-import-action-label { display: inline-flex; align-items: center; flex: 0 0 116px; width: 116px; min-width: 116px; min-height: 24px; padding: 0 2px; box-sizing: border-box; color: var(--vscode-descriptionForeground); font-size: 10.5px; }
.connection-import-picker.connection-import-action-picker { flex: 0 0 116px; min-width: 116px; width: 116px; }
.connection-import-action-picker-empty .profile-dropdown-button:disabled { opacity: 0.58; }
.connection-import-action-picker-empty .profile-dropdown-label { min-height: 1em; }

.connection-import-picker.connection-import-target-picker { flex: 0 0 158px; min-width: 158px; width: 158px; }
.connection-import-target-picker .profile-dropdown-button { width: 158px !important; min-width: 158px; }
.connection-import-target-picker .profile-dropdown-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connection-import-detail-title { margin-bottom: 3px; font-size: 10px; }
.connection-import-detail-grid { display: grid; grid-template-columns: max-content minmax(0, 1fr) max-content minmax(0, 1fr) max-content minmax(0, 1fr); gap: 2px 7px; align-items: baseline; min-width: 0; }
.connection-import-detail-label { color: var(--vscode-descriptionForeground); font-weight: 600; white-space: nowrap; }
.connection-import-detail-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connection-import-detail-value.connection-import-detail-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; overflow-wrap: normal; }
.connection-import-detail-label.wide { grid-column: 1; }
.connection-import-detail-value.wide { grid-column: 2 / -1; }
.connection-import-detail-note { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 7px; margin-top: 3px; min-width: 0; }
.connection-import-detail-note > span:first-child { color: var(--vscode-descriptionForeground); font-weight: 600; white-space: nowrap; }
.connection-import-detail-note > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connection-import-detail-action { min-height: 23px; height: 23px; margin-top: 5px; padding: 1px 7px; font-size: 10px; }
.connection-import-compare-title { margin-top: 5px; margin-bottom: 2px; font-size: 10px; }
.connection-import-compare-wrap { overflow: hidden; }
.connection-import-compare-table { width: 100%; font-size: 9.5px !important; table-layout: fixed; }
.connection-import-compare-table th,
.connection-import-compare-table td { padding: 2px 5px !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: top; }
.connection-import-compare-table th:first-child, .connection-import-compare-table td:first-child { width: 84px; }
.connection-import-detail-footnote { margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: 9.5px; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connection-import-compare-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 9.5px; margin-top: 3px; }
.connection-import-detail-empty { color: var(--vscode-descriptionForeground); font-size: 10px; }
.webview-tooltip.connection-import-multiline-tooltip { max-width: min(640px, calc(100vw - 24px)); max-height: calc(100vh - 24px); white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: hidden; text-overflow: clip; }
.connection-import-menu-wrap { position: relative; }
.manage-profiles-header-actions .connection-import-menu-wrap,
.manage-profiles-header-actions #manageProfilesExportButton { width: 68px; flex: 0 0 68px; box-sizing: border-box; }
.connection-import-menu-wrap #manageProfilesImportButton { display: inline-flex; align-items: center; justify-content: space-between; gap: 3px; width: 100%; min-width: 0; box-sizing: border-box; padding: 3px 6px; line-height: normal; }
.connection-import-menu-wrap #manageProfilesImportButton .profile-dropdown-chevron { flex: 0 0 15px; }
.connection-import-menu-wrap.open #manageProfilesImportButton .profile-dropdown-chevron { transform: rotate(180deg); }
.connection-import-menu-wrap .profile-dropdown-menu { width: max-content; min-width: 0; max-width: calc(100vw - 24px); right: 0; left: auto; }
.connection-import-picker { min-width: 132px; }
.connection-import-picker + .connection-import-picker { margin-top: 3px; }
.connection-import-picker-menu { position: fixed; z-index: 275; right: auto; display: none; width: auto; min-width: 0; max-width: calc(100vw - 16px); overflow-x: hidden; }
.connection-import-picker-menu.visible { display: block; }
.connection-import-picker .profile-dropdown-button { height: 24px; min-height: 24px; padding-top: 1px; padding-bottom: 1px; font-size: 11px; }
.connection-import-picker-menu .profile-dropdown-item { min-height: 25px; padding: 3px 7px; width: 100%; min-width: 0; }
.connection-import-picker-menu .profile-dropdown-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connection-import-details .server-overview-detail-table { margin-top: 6px; }
.connection-import-actions { align-items: center; }
.connection-import-footer-status { min-width: 0; flex: 1 1 auto; margin-right: auto; overflow: hidden; color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.25; opacity: 0.82; text-overflow: ellipsis; white-space: nowrap; }
.connection-import-footer-status.error { color: var(--vscode-errorForeground); opacity: 1; }
.connection-import-actions button { flex: 0 0 auto; }
.connection-import-unlock-note { margin-top: 7px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.3; }
`;
}
