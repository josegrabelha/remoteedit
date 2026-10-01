import { renderProfileDropdownStyles } from '../../../panel/webview/styles/ProfileDropdownStyles';
export function renderSyncStyles(): string {
  return renderProfileDropdownStyles() + `:root { color-scheme: light dark; --workspace-section-padding-y: 12px; --workspace-section-padding-x: 12px; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 18px;
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
button, select, input, textarea { font: inherit; }
button {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: 0;
  padding: 6px 12px;
  cursor: pointer;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
button.ghost {
  background: transparent;
  color: var(--vscode-foreground);
  padding: 3px 7px;
}
button.icon-action { display: inline-flex; align-items: center; justify-content: center; }
button.compare-action svg { width: 14px; height: 14px; display: block; fill: currentColor; }
button.compare-action .compare-icon-fallback { display: inline-block; line-height: 1; }
button:disabled { opacity: .5; cursor: default; }
input, select, textarea {
  width: 100%;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
  padding: 5px 7px;
}

.input-with-button { position: relative; display: flex; align-items: center; min-width: 0; }
.input-with-button input { padding-right: 34px; }
.input-icon-button {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 27px;
  min-width: 27px;
  height: 27px;
  min-height: 27px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-left: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 0 2px 2px 0;
  background: transparent;
  color: var(--vscode-input-foreground);
  opacity: .8;
}
.input-icon-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
.input-icon-button svg { width: 15px; height: 15px; display: block; fill: currentColor; }
.tooltip-anchor { position: relative; display: inline-flex; }
.has-tooltip { position: relative; }
.webview-tooltip { position: fixed; z-index: 10000; max-width: min(520px, calc(100vw - 24px)); padding: 4px 7px; border-radius: 3px; background: var(--vscode-editorWidget-background); color: var(--vscode-editorWidget-foreground); border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28); font-size: 12px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(2px); transition: opacity 80ms ease, transform 80ms ease; }
.webview-tooltip.visible { opacity: 1; visibility: visible; transform: translateY(0); }
.context-menu { position: fixed; z-index: 10060; width: 196px; padding: 4px; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, var(--vscode-editorWidget-foreground)); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35); display: none; }
.context-menu.visible { display: block; }
.context-menu button { width: 100%; box-sizing: border-box; min-height: 28px; padding: 5px 9px; text-align: left; white-space: nowrap; background: transparent; color: inherit; border-radius: 3px; }
.context-menu button:hover:not(:disabled) { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-menu-selectionForeground, inherit); }
.context-menu-separator { height: 1px; margin: 4px 3px; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); opacity: 0.9; }
.text-edit-context-menu { z-index: 10070; width: 158px; }
.changes-context-menu { z-index: 10070; }
.activity-context-menu { z-index: 10070; width: 158px; }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.toolbar-spacer { flex: 1; }
#compare { width: 112px; min-width: 112px; flex: 0 0 112px; }
#connect { width: 100%; min-width: 0; }
.card { border: 1px solid var(--vscode-panel-border); padding: var(--workspace-section-padding-y) var(--workspace-section-padding-x); margin-bottom: 8px; }
.grid { display: grid; grid-template-columns: 58px minmax(220px, 1fr) auto; gap: 6px 4px; align-items: center; }
.label { color: var(--vscode-descriptionForeground); }
.metadata-block {
  grid-column: 1 / -1;
  margin: 1px 0;
  padding: 5px 0 0;
  border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 58%, transparent);
}
.metadata-layout {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) max-content;
  gap: 6px 32px;
  align-items: start;
}
.metadata-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  align-items: center;
}
.metadata-left-item {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}
.metadata-left-label { flex: 0 0 auto; }
.metadata-left-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; }
.metadata-block .metadata-muted {
  min-width: 0;
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.35;
}
.metadata-block .metadata-left-label { font-weight: 600; }
.metadata-block .metadata-left-value { font-weight: 400; }
.metadata-block .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.summary { display: flex; gap: 16px; flex-wrap: wrap; color: var(--vscode-descriptionForeground); margin: 10px 0; }
.previewSummary {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  margin: 8px 0 10px;
  color: var(--vscode-descriptionForeground);
  font-size: 10px;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}
.previewSummaryItem { display: flex; align-items: baseline; gap: 4px; min-width: 0; white-space: nowrap; }
.previewSummaryCount { display: inline-block; flex: 0 0 4ch; width: 4ch; text-align: right; font-weight: 400; }
.changes-card { font-size: 11px; }
.changes-status-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; min-height: 21px; margin: -1px 0 5px; }
.changes-card .snapshot-status { min-height: 16px; min-width: 0; flex: 1 1 auto; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; line-height: 1.35; }
.snapshot-status.stale { font-style: italic; }
.filters { display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 6px; }
.filters button.filter-tab {
  position: relative;
  width: auto;
  min-width: 0;
  flex: 0 0 auto;
  height: 24px;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 2px 8px 4px;
  font-size: 11px;
  border: 0;
  border-radius: 2px 2px 0 0;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  box-shadow: inset 0 -2px 0 transparent;
}
.filters button.filter-tab:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
  color: var(--vscode-foreground);
}
.filter-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filter-count {
  margin-left: 0;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--vscode-descriptionForeground);
  opacity: .72;
}
.filters button.filterActive {
  background: transparent;
  color: var(--vscode-foreground);
  font-weight: 600;
  box-shadow: inset 0 -2px 0 var(--vscode-focusBorder);
}
.filters button.filterActive:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
.filters button.filterActive .filter-count { opacity: .88; }
.filters .filter-box { position: relative; flex: 0 1 260px; min-width: 160px; max-width: 260px; margin-left: auto; }
.changes-primary-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; margin-left: 2px; padding-left: 8px; border-left: 1px solid var(--vscode-panel-border); }
.changes-primary-actions button { height: 27px; min-height: 27px; padding: 3px 10px; font-size: 11px; }
.changes-primary-actions #compare { width: 112px; min-width: 112px; flex: 0 0 112px; }
.changes-more-wrap {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  margin-left: 2px;
  padding-left: 8px;
  border-left: 1px solid var(--vscode-panel-border);
}
.changes-more-button {
  position: relative;
  box-sizing: border-box;
  width: 29px;
  min-width: 29px;
  height: 27px;
  min-height: 27px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.changes-more-glyph {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  line-height: 1;
  pointer-events: none;
}
.changes-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 10050; min-width: 172px; padding: 4px; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); background: var(--vscode-menu-background, var(--vscode-dropdown-background)); color: var(--vscode-menu-foreground, var(--vscode-dropdown-foreground)); box-shadow: 0 4px 12px rgba(0,0,0,.22); }
.changes-menu[hidden] { display: none; }
.changes-menu-item { width: 100%; min-height: 26px; padding: 4px 8px; display: flex; align-items: center; justify-content: space-between; gap: 16px; text-align: left; white-space: nowrap; background: transparent; color: inherit; }
.changes-menu-label { min-width: 0; }
.changes-menu-check { width: 14px; flex: 0 0 14px; text-align: right; }
.changes-menu-item:hover:not(:disabled), .changes-menu-item:focus-visible { background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground)); color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground)); outline: none; }
.protected-entry-icon { font-weight: 700; color: var(--vscode-charts-orange, var(--vscode-descriptionForeground)); }
.filters .search { width: 100%; max-width: none; height: 27px; padding-right: 28px; font-size: 11px; }
.filter-clear-button { position: absolute; top: 50%; right: 4px; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: 22px; min-width: 22px; height: 22px; min-height: 22px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: var(--vscode-input-foreground); opacity: 0; visibility: hidden; cursor: pointer; line-height: 0; }
.filter-clear-button svg { display: block; width: 11px; height: 11px; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; pointer-events: none; }
.filter-box.has-value .filter-clear-button { opacity: 0.7; visibility: visible; }
.filter-box.has-value .filter-clear-button:hover:not(:disabled) { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
.filter-clear-button:disabled { cursor: default; }
.changes-panel {
  flex: 1 1 auto;
  height: auto;
  min-height: 120px;
  max-height: none;
  overflow: auto;
  resize: none;
  border: 1px solid var(--vscode-panel-border);
}
.changes-table {
  width: 100%;
  min-width: 0;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}
.changes-table th,
.changes-table td {
  box-sizing: border-box;
  padding: 1px 3px;
  vertical-align: middle;
  text-align: left;
}
.changes-table th:first-child,
.changes-table td:first-child { padding-left: 7px; }
.changes-table th:last-child,
.changes-table td:last-child { padding-right: 7px; }
.changes-table-header {
  color: var(--vscode-descriptionForeground);
  font-size: 10px;
  line-height: 1.2;
}
.changes-table-header th {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 23px;
  border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
  background: var(--vscode-editor-background);
  font-weight: 400;
}
.changes-col-select { width: 26px; }
.changes-col-marker { width: 24px; }
.changes-col-target { width: 132px; }
.changes-col-path { width: auto; }
.changes-col-status { width: 118px; }
.changes-col-modified { width: 0; }
.changes-col-actions { width: 280px; }
.changes-panel.show-modified-times .changes-col-modified { width: 168px; }
.changes-select-header input {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  display: block;
  width: 14px;
  min-width: 14px;
  height: 14px;
  min-height: 14px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 3px;
  background: var(--vscode-input-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
}
.changes-select-header input:checked,
.changes-select-header input:indeterminate {
  background: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
}
.changes-select-header input:checked::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 40%;
  width: 3.5px;
  height: 7px;
  border: solid var(--vscode-button-foreground);
  border-width: 0 1.5px 1.5px 0;
  transform: translate(-50%, -50%) rotate(45deg);
  transform-origin: center;
}
.changes-select-header input:indeterminate::after {
  content: '';
  position: absolute;
  left: 3px;
  right: 3px;
  top: 50%;
  height: 1.5px;
  border-radius: 1px;
  background: var(--vscode-button-foreground);
  transform: translateY(-50%);
}
.changes-select-header input:disabled { opacity: .55; cursor: default; }
.changes-sort-button {
  appearance: none;
  -webkit-appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  width: auto;
  min-width: 0;
  height: 18px;
  min-height: 18px;
  padding: 0 2px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  font: inherit;
  font-weight: 600;
  line-height: 1.2;
  text-align: left;
  cursor: pointer;
}
.changes-sort-button:hover:not(:disabled), .changes-sort-button:focus-visible {
  background: transparent;
  color: var(--vscode-foreground);
  outline: none;
  box-shadow: none;
}
.changes-sort-header[aria-sort="ascending"] .changes-sort-button,
.changes-sort-header[aria-sort="descending"] .changes-sort-button { color: var(--vscode-foreground); }
.changes-sort-indicator { flex: 0 0 auto; width: 8px; min-width: 8px; text-align: center; font-size: 9px; opacity: .85; }
.changes-actions-header { font-weight: 600; text-align: left; }
.changes-column-resizer {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  z-index: 4;
  width: 7px;
  cursor: col-resize;
  touch-action: none;
}
.changes-column-resizer::after {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 3px;
  width: 1px;
  background: transparent;
}
.changes-column-resizer:hover::after,
body.changes-column-resizing .changes-column-resizer[data-change-resize]::after { background: var(--vscode-focusBorder); }
body.changes-column-resizing { cursor: col-resize; user-select: none; }
body.changes-column-resizing * { cursor: col-resize !important; }
.changes { font-size: 11px; line-height: 1.2; }
.row > td {
  height: 24px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.row:hover > td { background: var(--vscode-list-hoverBackground); }
.target-cell, .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.target-cell { color: var(--vscode-descriptionForeground); }
.kind { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 11px; }
.conflict { color: var(--vscode-errorForeground); }
.local { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
.remote { color: var(--vscode-charts-blue); }
.actions-cell { white-space: nowrap; }
.actions { display: flex; gap: 4px; justify-content: flex-start; flex-wrap: nowrap; min-width: 0; white-space: nowrap; }
.empty { padding: 24px; text-align: center; color: var(--vscode-descriptionForeground); }
.footer { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-top: 6px; }
.changes-card .footer .muted { font-size: 11px; }
.changes-card .footer button { min-height: 27px; padding: 4px 9px; font-size: 11px; }
.options { font-size: 11px; line-height: 1.35; color: var(--vscode-descriptionForeground); }
.metadata-options {
  min-width: 0;
  max-width: 100%;
  display: grid;
  grid-template-columns: max-content max-content max-content;
  grid-auto-rows: minmax(15px, auto);
  column-gap: 24px;
  row-gap: 2px;
  align-items: baseline;
  justify-content: end;
  justify-self: end;
  white-space: nowrap;
}
.metadata-options-row {
  display: contents;
}
.metadata-option { display: inline-flex; align-items: baseline; gap: 4px; white-space: nowrap; justify-self: start; }
.metadata-option-label { color: var(--vscode-descriptionForeground); font-weight: 600; }
.metadata-option-value { color: var(--vscode-descriptionForeground); font-weight: 400; }
.target-states { font-size: 11px; line-height: 1.35; color: var(--vscode-descriptionForeground); }
.target-states b { color: inherit; font-weight: 400; }
.target-status { font-weight: 400; }
.metadata-targets {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  margin-top: 4px;
  padding-top: 0;
  border-top: 0;
  white-space: nowrap;
  overflow: hidden;
}
.metadata-targets > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.metadata-targets-label { font-weight: 600; }
#workspaceContent {
  height: calc(100vh - 20px);
  min-height: 560px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#workspaceContent > .connection-card {
  flex: 0 0 auto;
}
#workspaceContent > .changes-card {
  flex: 1 1 auto;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#workspaceContent > .activity-card {
  flex: 0 0 auto;
  margin-bottom: 0;
}

.form { display: grid; grid-template-columns: 58px 1fr auto; gap: 8px 4px; align-items: center; }
.full { grid-column: 1 / -1; }
.muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
.errorBox { display: none; color: var(--vscode-errorForeground); margin-bottom: 10px; }
.targetHeader, .targetRow { display: grid; grid-template-columns: 110px minmax(0, 1fr) minmax(0, 1.3fr) 56px 22px; gap: 6px; }
.targetHeader { align-items: end; margin: 6px 0 0; }
.targetRow { align-items: center; margin: 6px 0; }
.targetField { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.targetFieldLabel { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; line-height: 1.2; white-space: nowrap; }
.targetField > input, .targetField > select { min-height: 29px; }
.targetRowControl { min-height: 29px; display: flex; align-items: center; align-self: center; }
.targetEnabledHeader { text-align: center; }
.targetEnabledCell { justify-content: center; }
.targetEnabledCell .checkbox-inline { margin: 0; }
.targetRemoveControl { justify-content: center; }
.split { height: 1px; background: var(--vscode-panel-border); margin: 12px 0; }
.dialog-title { font-size: 16px; margin-top: 0; }
.dialog-actions { justify-content: flex-end; margin-top: 14px; }
.mapping-actions { display: flex; align-items: center; justify-content: space-between; }
.checkbox-inline { width: auto; }
.mapping-options-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 28px;
  align-items: start;
}
.mapping-options-column { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.mapping-option-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.mapping-option-row label { display: flex; align-items: center; gap: 6px; min-width: 0; }
.direction-help-button,
.ignore-help-button {
  position: absolute;
  z-index: 2;
  visibility: hidden;
}
.option-help-button {
  width: 16px;
  min-width: 16px;
  height: 16px;
  min-height: 16px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  opacity: .78;
  flex: 0 0 16px;
}
.option-help-button:hover {
  background: transparent;
  color: var(--vscode-descriptionForeground);
  opacity: .78;
}
.option-help-button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 1px;
}
.option-help-icon {
  display: inline-flex;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  flex: 0 0 14px;
  color: currentColor;
  line-height: 0;
}
.option-help-icon > svg {
  display: block;
  width: 14px;
  height: 14px;
  max-width: 14px;
  max-height: 14px;
  flex: none;
  overflow: visible;
}
.option-help-icon > svg path { fill: currentColor !important; }
.option-help-icon > svg circle { stroke: currentColor; }
.option-help-fallback { font-size: 12px; line-height: 14px; font-weight: 600; }
.option-help-popover {
  position: fixed;
  z-index: 1300;
  width: max-content;
  max-width: min(360px, calc(100vw - 16px));
  padding: 8px 10px;
  border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  border-radius: 3px;
  color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
  background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
  box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, .35));
  font-size: 12px;
  line-height: 1.4;
}
.option-help-popover[hidden] { display: none; }
.option-help-title { margin-bottom: 3px; font-weight: 600; }
.option-help-text { color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground)); white-space: pre-line; }
@media (max-width: 760px) {
  .grid { grid-template-columns: 100px minmax(0, 1fr); }
  .metadata-layout { grid-template-columns: 1fr; gap: 4px; }
  .metadata-options { padding-top: 4px; justify-self: start; justify-items: start; width: auto; }
  .metadata-options-row { display: flex; justify-content: flex-start; gap: 18px; }

  .changes-table { min-width: 760px; }
  .targetHeader { display: none; }
  .targetRow { grid-template-columns: 1fr; align-items: stretch; }
  .targetRowControl { min-height: 29px; align-self: stretch; }
  .targetRemoveControl { justify-content: flex-start; }
  .mapping-options-grid { grid-template-columns: 1fr; row-gap: 8px; }
}

.previewSectionTitle { margin: 10px 0 5px; font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); }
.previewList { border: 1px solid var(--vscode-panel-border); max-height: 46vh; overflow: auto; margin: 5px 0 10px; }
.previewRow {
  display: grid;
  grid-template-columns: 150px minmax(180px, 1fr);
  gap: 5px;
  align-items: center;
  min-height: 24px;
  padding: 1px 7px;
  font-size: 11px;
  line-height: 1.2;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.previewRow:last-child { border-bottom: 0; }
.previewDecisionList { border: 1px solid var(--vscode-panel-border); max-height: 38vh; overflow: auto; margin: 5px 0 10px; }
.previewDecision {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  gap: 5px;
  align-items: center;
  min-height: 24px;
  padding: 1px 7px;
  font-size: 11px;
  line-height: 1.2;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.previewDecision:last-child { border-bottom: 0; }
.previewDecision.pending { background: color-mix(in srgb, var(--vscode-list-hoverBackground) 45%, transparent); }
.previewDecisionInfo { min-width: 0; display: flex; align-items: baseline; gap: 8px; }
.previewDecisionInfo .path { min-width: 0; flex: 1 1 auto; }
.previewDecisionInfo .conflict { flex: 0 0 auto; font-size: 11px; }
.previewDecisionActions { display: flex; gap: 4px; justify-content: flex-end; white-space: nowrap; }
.previewDecisionActions button { min-height: 22px; padding: 2px 5px; border-radius: 2px; font-size: 11px; line-height: 1.15; }
.previewPlanFooter {
  min-height: 34px;
  margin-top: 7px;
  color: var(--vscode-descriptionForeground);
  font-size: 10px;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}
.previewPlanStatus {
  display: grid;
  grid-template-columns: 150px 190px 145px;
  column-gap: 12px;
  align-items: baseline;
  min-height: 13px;
}
.previewPlanStatusItem { min-width: 0; white-space: nowrap; }
.previewPlanStatusItem + .previewPlanStatusItem::before { content: '·'; display: inline-block; margin-right: 8px; }
.previewPlanStatusCount { display: inline-block; width: 3ch; text-align: right; }
.previewRevalidation { margin-top: 3px; padding-left: 2ch; color: var(--vscode-descriptionForeground); opacity: .82; }
@media (max-width: 760px) {
  .previewSummary { grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 4px; }
  .previewDecision { grid-template-columns: 1fr; gap: 5px; }
  .previewDecisionActions { justify-content: flex-start; }
  .previewPlanStatus { grid-template-columns: 1fr; row-gap: 1px; }
  .previewPlanStatusItem + .previewPlanStatusItem::before { content: none; margin-right: 0; }
}
.row .actions { min-width: 0; flex-wrap: nowrap; }
.row .actions button { flex: 0 0 auto; min-height: 22px; padding: 2px 5px; border-radius: 2px; font-size: 11px; line-height: 1.15; white-space: nowrap; }

.operationBar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  gap: 12px;
  align-items: center;
  margin-top: 6px;
}
.operationActions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  white-space: nowrap;
}
.operationActions .activityUtilityAction { margin-left: 7px; }
#activityCopy { width: 58px; min-width: 58px; max-width: 58px; text-align: center; }
.operationText { display: flex; flex-direction: column; min-width: 0; min-height: 30px; gap: 1px; }
.operationPrimary { display: flex; align-items: center; min-width: 0; gap: 6px; }
.operationPrimary > #operationLabel, #operationDetail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#operationDetail { color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.2; }
.operationSpinner {
  display: none;
  width: 11px;
  min-width: 11px;
  height: 11px;
  border: 1px solid var(--vscode-panel-border, var(--vscode-descriptionForeground));
  border-top-color: var(--vscode-foreground);
  border-radius: 50%;
  box-sizing: border-box;
  flex: 0 0 11px;
  animation: workspaceSyncSpin .8s linear infinite;
}
.operationBar.active .operationSpinner { display: inline-block; }
@keyframes workspaceSyncSpin { to { transform: rotate(360deg); } }

[hidden] { display: none !important; }
body { padding: 10px; font-size: var(--vscode-font-size, 13px); overflow: auto; }
button { min-height: 31px; border-radius: 3px; white-space: nowrap; }
input, textarea { border-radius: 3px; outline: none; }
input:not([type=checkbox]) { height: 31px; }
input:focus, textarea:focus { border-color: var(--vscode-focusBorder); }
button:focus-visible, [tabindex]:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
button.secondary { background: var(--vscode-button-secondaryBackground, var(--vscode-input-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-button-border, var(--vscode-input-border, var(--vscode-panel-border))); }
button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
button.ghost:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
button.resolution-choice.resolution-selected,
.context-menu button.resolution-selected {
  background: var(--vscode-list-activeSelectionBackground, var(--vscode-button-background));
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-button-foreground));
}
button.resolution-choice.resolution-selected:hover:not(:disabled),
.context-menu button.resolution-selected:hover:not(:disabled) {
  background: var(--vscode-list-activeSelectionBackground, var(--vscode-button-background));
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-button-foreground));
}
.card { border-radius: 4px; }
.label { font-size: 12px; }
.profile-select-native { display: none !important; }
.sync-combo-menu { display: block !important; position: fixed; z-index: 10040; right: auto; }
.sync-combo-menu .profile-dropdown-item { grid-template-columns: minmax(0,1fr); }
.sync-dialog-backdrop { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.45); }
.sync-dialog { box-sizing: border-box; width: min(880px,100%); max-height: calc(100vh - 48px); overflow: auto; resize: none; border: 1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border)); border-radius: 6px; background: var(--vscode-editorWidget-background,var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground,var(--vscode-foreground)); box-shadow: 0 12px 36px rgba(0,0,0,.4); padding: 18px; }
.sync-dialog textarea { resize: none; }
.mapping-dialog { position: relative; height: min(620px, calc(100vh - 48px)); max-height: none; overflow: hidden; display: flex; flex-direction: column; }
.mapping-dialog > .dialog-title { flex: 0 0 auto; }
.mapping-dialog-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-right: 4px; }
.mapping-dialog-actions { flex: 0 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border); }
.mapping-dialog-validation { min-width: 0; height: 16px; line-height: 16px; color: var(--vscode-errorForeground); font-size: 10px; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mapping-dialog-action-buttons { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: 0 0 auto; }
.compact-dialog { width: min(640px,100%); }
.folder-dialog { height: min(470px, calc(100vh - 48px)); max-height: none; overflow: hidden; display: flex; flex-direction: column; }
.folder-dialog #requestDetail:empty { display: none; }
.folder-dialog #requestBody { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.folder-dialog .folder-shortcuts { margin-top: 0; }
.folder-dialog .folder-list { flex: 1 1 auto; min-height: 0; height: auto; }
.folder-dialog .dialog-actions { flex: 0 0 auto; }
.request-detail { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
input[type=checkbox] { appearance: none; -webkit-appearance: none; position: relative; flex: 0 0 auto; width: 14px; min-width: 14px; height: 14px; margin: 0; padding: 0; border: 1px solid var(--vscode-input-border,var(--vscode-panel-border)); border-radius: 3px; background: var(--vscode-input-background); cursor: pointer; }
input[type=checkbox]:checked { background: var(--vscode-button-background); border-color: var(--vscode-button-background); }
input[type=checkbox]:checked::after { content: ''; position: absolute; left: 50%; top: 40%; width: 3.5px; height: 7px; border: solid var(--vscode-button-foreground); border-width: 0 1.5px 1.5px 0; transform: translate(-50%,-50%) rotate(45deg); }
input[type=checkbox]:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.validation { color: var(--vscode-errorForeground); margin-top: 8px; }
#folderError { min-height: 18px; }
.activity-card { font-size: 11px; }
.activity-heading { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: center; gap: 6px; height: 27px; min-height: 27px; margin-bottom: 6px; }
.activity-heading h2 { font-size: 12px; font-weight: 600; margin: 0 6px 0 0; }
.activity-heading .muted { font-size: 11px; }
.activity-heading button, .activity-card .operationActions button { min-height: 27px; padding: 4px 9px; font-size: 11px; }
.activity-log { height: 140px; min-height: 140px; max-height: 140px; resize: none; overflow: auto; overflow-anchor: none; background: var(--vscode-textCodeBlock-background,var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border); padding: 6px; font: 11px/1.45 var(--vscode-editor-font-family,monospace); user-select: text; }
.activity-line { white-space: pre-wrap; overflow-wrap: anywhere; }
.activity-line.success, .target-status.connected { color: var(--vscode-testing-iconPassed,#73c991); }
.target-status.disabled { color: var(--vscode-descriptionForeground); }
.activity-line.warning { color: var(--vscode-editorWarning-foreground,#cca700); }
.activity-line.error, .target-status.error { color: var(--vscode-errorForeground,#f48771); }
.folder-navigation { display: flex; gap: 6px; }
.folder-shortcuts { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
.folder-shortcuts button { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.folder-list { height: 260px; overflow: auto; margin-top: 10px; border: 1px solid var(--vscode-panel-border); }
.folder-item { display: block; width: 100%; background: transparent; color: inherit; text-align: left; overflow: hidden; text-overflow: ellipsis; border-radius: 0; }
.folder-item:hover { background: var(--vscode-list-hoverBackground); }
.diff-dialog { width: min(1200px,100%); }
.diff-lines { max-height: 65vh; overflow: auto; font: 12px/1.6 var(--vscode-editor-font-family,monospace); }
.diff-line, .diff-heading { display: grid; grid-template-columns: 55px 55px 22px minmax(max-content,1fr); }
.diff-line { min-width: max-content; }
.diff-line span { white-space: pre; padding: 0 5px; }
.diff-line span:nth-child(-n+3) { color: var(--vscode-editorLineNumber-foreground); user-select: none; text-align: right; }
.diff-line.removed { background: var(--vscode-diffEditor-removedTextBackground,rgba(255,0,0,.15)); }
.diff-line.added { background: var(--vscode-diffEditor-insertedTextBackground,rgba(0,255,0,.12)); }
.diff-heading { color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); padding: 6px 0; font-size: 11px; }
* { scrollbar-width: thin; scrollbar-color: var(--vscode-scrollbarSlider-background) transparent; }

.grid { grid-template-areas: "mappingHeading mapping mappingActions" "targetHeading target connectionAction" "metadata metadata metadata"; }
.grid > span:empty { display: none; }
#mappingHeading { grid-area: mappingHeading; }
#targetHeading { grid-area: targetHeading; }
.grid > [data-for="mapping"] { grid-area: mapping; }
.grid > [data-for="target"] { grid-area: target; }
#mappingActions {
  grid-area: mappingActions;
  margin-left: 4px;
  display: grid;
  grid-template-columns: 56px 76px;
  gap: 8px;
  width: 140px;
  min-width: 140px;
}
#mappingActions > button { width: 100%; min-width: 0; padding-left: 8px; padding-right: 8px; }
#connectionAction { grid-area: connectionAction; width: 140px; min-width: 140px; margin-left: 4px; }
#connectionAction #connect { display: block; width: 140px; min-width: 140px; }
.metadata-block { grid-area: metadata; }
#connectionLabel, #localRoot, #remoteRoot { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 900px) {
  .metadata-layout { grid-template-columns: 1fr; gap: 4px; }
  .metadata-options { display: flex; flex-direction: column; gap: 2px; padding-top: 4px; justify-self: start; width: auto; }
  .metadata-options-row { display: flex; justify-content: flex-start; gap: 18px; }
}
@media (max-width: 680px) {
  .metadata-options { white-space: normal; }
  .metadata-options-row { flex-wrap: wrap; justify-content: flex-start; gap: 2px 14px; }
  .metadata-option { white-space: nowrap; }
}
@media (max-width: 760px) {
  .grid { grid-template-columns: 58px minmax(0,1fr); grid-template-areas: "mappingHeading mapping" ". mappingActions" "targetHeading target" ". connectionAction" "metadata metadata"; }
  #mappingActions, #connectionAction { justify-self: end; margin-left: 0; }
}
/* Keep the optional Modified Time cells in the table column model at all times.
   When hidden, their columns are zero-width instead of removing cells from the row.
   This preserves the exact column index for Actions and prevents header/body drift. */
.modified-time-header, .modified-time-cell {
  width: 0;
  max-width: 0;
  min-width: 0;
  padding-left: 0 !important;
  padding-right: 0 !important;
  overflow: hidden;
  visibility: hidden;
  white-space: nowrap;
}
.modified-time-header .changes-sort-button,
.modified-time-header .changes-column-resizer { display: none; }
.changes-panel.show-modified-times .modified-time-header,
.changes-panel.show-modified-times .modified-time-cell {
  width: auto;
  max-width: none;
  padding-left: 3px !important;
  padding-right: 3px !important;
  visibility: visible;
}
.changes-panel.show-modified-times .modified-time-header .changes-sort-button { display: inline-flex; }
.changes-panel.show-modified-times .modified-time-header .changes-column-resizer { display: block; }
.changes-panel.show-modified-times .modified-time-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--vscode-descriptionForeground);
  font-variant-numeric: tabular-nums;
}

.changes-footer-toolbar { justify-content: flex-end; }
.changes-resolution-toolbar { flex: 0 0 auto; margin: 0; }
.changes-resolution-toolbar[hidden] { display: none; }
.previewDecisionToolbar button { min-height: 21px; padding: 2px 6px; font-size: 10px; }
.changes-resolution-label { margin-right: 2px; color: var(--vscode-descriptionForeground); font-size: 10px; }

.resolution-choice { position: relative; }
.row .actions button.resolution-choice,
.previewDecisionActions button.resolution-choice {
  /* Reserve the suggestion-marker gutter on both sides at all times.
     The label stays centered and never moves when the marker appears/disappears. */
  padding-left: 15px;
  padding-right: 15px;
}
.resolution-choice.resolution-suggested { }
.suggested-resolution-marker {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9px;
  line-height: 1;
  opacity: .9;
  pointer-events: none;
}

.compare-split { display: inline-flex; align-items: stretch; flex: 0 0 auto; }
.compare-split .compare-action { border-radius: 2px 0 0 2px; }
.compare-split .compare-menu-action {
  min-width: 16px;
  width: 16px;
  padding: 0 2px;
  border-left: 1px solid color-mix(in srgb, var(--vscode-button-border, var(--vscode-panel-border)) 65%, transparent);
  border-radius: 0 2px 2px 0;
  font-size: 9px;
}
.compare-menu { width: 156px; }

.previewDecisionToolbar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  margin: 3px 0 4px;
  white-space: nowrap;
}
.changes-status-row .previewDecisionToolbar { margin: 0; }

.diff-dialog-title-row { display: flex; align-items: center; gap: 12px; }
.diff-dialog-title-row .dialog-title { min-width: 0; flex: 1 1 auto; margin-bottom: 0; }
.diff-native-button { flex: 0 0 auto; min-height: 25px; padding: 3px 8px; font-size: 11px; }
`;
}
