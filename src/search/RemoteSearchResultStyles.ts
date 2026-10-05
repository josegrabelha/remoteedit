export const remoteSearchResultStyles = `  .remote-search-show-more { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; max-width: 100%; box-sizing: border-box; padding: 8px 12px 4px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-font-family); font-size: 12px; border-top: 1px solid var(--vscode-panel-border); }
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
`;
