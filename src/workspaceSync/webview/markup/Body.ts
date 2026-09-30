export function renderWorkspaceSyncBody(questionIconSvg = ''): string {
  const helpIcon = renderOptionHelpIcon(questionIconSvg);
  return `<main id="workspaceContent">
  <div class="card connection-card">
    <div class="grid">
      <div id="mappingHeading" class="label">Mapping</div><select aria-label="Mapping" id="mapping"></select><div id="mappingActions" class="toolbar"><button id="newMapping" class="secondary">New</button><button id="manage">Manage</button></div>
      <div id="targetHeading" class="label">Target</div><select aria-label="Target" id="target"></select><div id="connectionAction"><button id="connect">Connect</button></div>
      <div class="metadata-block">
        <div class="metadata-layout">
          <div class="metadata-grid">
            <div class="metadata-left-item"><span id="connectionHeading" class="metadata-muted metadata-left-label">Connection:</span><span id="connectionLabel" class="metadata-muted metadata-left-value">—</span></div>
            <div class="metadata-left-item"><span id="localHeading" class="metadata-muted metadata-left-label">Local:</span><span id="localRoot" class="path metadata-muted metadata-left-value">—</span></div>
            <div class="metadata-left-item"><span id="remoteHeading" class="metadata-muted metadata-left-label">Remote:</span><span id="remoteRoot" class="path metadata-muted metadata-left-value">—</span></div>
          </div>
          <div class="options metadata-options" id="options"></div>
        </div>
        <div id="targetStates" class="target-states metadata-targets" hidden></div>
      </div>
    </div>
  </div>


  <div class="card changes-card">
    <div class="filters"><button data-filter="changes" class="filter-tab filterActive"><span class="filter-label">Changes</span><span class="filter-count" data-filter-count="changes">0</span></button><button data-filter="modified" class="filter-tab"><span class="filter-label">Modified</span><span class="filter-count" data-filter-count="modified">0</span></button><button data-filter="local" class="filter-tab"><span class="filter-label">Local</span><span class="filter-count" data-filter-count="local">0</span></button><button data-filter="remote" class="filter-tab"><span class="filter-label">Remote</span><span class="filter-count" data-filter-count="remote">0</span></button><button data-filter="conflict" class="filter-tab"><span class="filter-label">Conflicts</span><span class="filter-count" data-filter-count="conflict">0</span></button><button data-filter="same" class="filter-tab"><span class="filter-label">Same</span><span class="filter-count" data-filter-count="same">0</span></button><button data-filter="all" class="filter-tab"><span class="filter-label">All</span><span class="filter-count" data-filter-count="all">0</span></button><div id="searchBox" class="filter-box"><input id="search" class="search filter-input" placeholder="Filter Paths..." aria-label="Filter Paths"><button id="clearSearch" class="filter-clear-button" type="button" aria-label="Clear Filter" data-tooltip="Clear Filter" disabled><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3L3 9"></path></svg></button></div><div class="changes-primary-actions"><button id="compare">Refresh</button><button id="sync">Sync</button></div><div class="changes-more-wrap"><button id="changesMore" class="secondary changes-more-button" type="button" aria-label="More Changes actions" data-tooltip="More Changes actions" aria-haspopup="menu" aria-expanded="false"><span class="changes-more-glyph" aria-hidden="true">…</span></button><div id="changesMenu" class="changes-menu" role="menu" hidden><button id="resetBaseline" class="changes-menu-item" type="button" role="menuitem">Reset Baseline…</button></div></div></div>
    <div id="snapshotStatus" class="snapshot-status muted" aria-live="polite"></div>
    <div id="changesPanel" class="changes-panel">
      <div class="changes-table-header" role="row">
        <div class="changes-select-header" role="columnheader"><input id="selectVisible" type="checkbox" aria-label="Select all visible items" data-tooltip="Select all visible items"></div>
        <div class="changes-marker-header" role="columnheader" aria-label="Change type"></div>
        <div class="changes-sort-header" role="columnheader" data-change-sort-column="target" aria-sort="none"><button class="changes-sort-button" type="button" data-change-sort="target" data-tooltip="Sort by Target"><span>Target</span><span class="changes-sort-indicator" data-change-sort-indicator="target" aria-hidden="true"></span></button></div>
        <div class="changes-sort-header" role="columnheader" data-change-sort-column="path" aria-sort="none"><button class="changes-sort-button" type="button" data-change-sort="path" data-tooltip="Sort by Path"><span>Path</span><span class="changes-sort-indicator" data-change-sort-indicator="path" aria-hidden="true"></span></button></div>
        <div class="changes-sort-header" role="columnheader" data-change-sort-column="status" aria-sort="none"><button class="changes-sort-button" type="button" data-change-sort="status" data-tooltip="Sort by Status"><span>Status</span><span class="changes-sort-indicator" data-change-sort-indicator="status" aria-hidden="true"></span></button></div>
        <div class="changes-actions-header" role="columnheader">Actions</div>
      </div>
      <div id="changes" class="changes" role="rowgroup"><div class="empty">Create a mapping and connect a target to load the file list.</div></div>
    </div>
    <div class="footer"><div id="selectedCount" class="muted">0 selected</div><div class="toolbar"><button id="uploadSelected" class="secondary">Upload ↑</button><button id="downloadSelected" class="secondary">Download ↓</button></div></div>
  </div>

  <section class="card activity-card" aria-label="Activity">
    <div class="activity-heading"><h2>Activity</h2><span id="activityCount" class="muted">0 events</span><span class="toolbar-spacer"></span><button id="activityFollow" class="secondary" hidden>Follow latest</button></div>
    <div id="activityLog" class="activity-log" role="log" aria-label="Workspace Sync activity" aria-live="off" tabindex="0"></div>
    <div id="operationBar" class="operationBar" aria-live="polite">
      <div class="operationText"><div class="operationPrimary"><span id="operationSpinner" class="operationSpinner" aria-hidden="true"></span><span id="operationLabel">Loading Workspace Sync...</span></div><span id="operationDetail" class="muted"></span></div>
      <div class="operationActions">
        <button id="cancelOperation" class="secondary" disabled hidden>Cancel</button>
        <button id="activityCopy" class="secondary activityUtilityAction">Copy</button>
        <button id="activityClear" class="secondary">Clear</button>
      </div>
    </div>
  </section>
</main>  <div id="previewDialog" class="sync-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="previewDialogTitle" hidden><div class="sync-dialog">
    <h2 id="previewDialogTitle" class="dialog-title">Sync Review</h2><div id="previewBody"></div>
    <div class="toolbar dialog-actions"><button id="closePreview" class="secondary">Close</button><button id="startPreviewSync">Start Sync</button></div>
  </div></div>

  <div id="mappingDialog" class="sync-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="mappingDialogTitle" hidden><div class="sync-dialog mapping-dialog">
    <h2 id="mappingDialogTitle" class="dialog-title">Workspace Sync Mapping</h2>
    <div id="mappingDialogBody" class="mapping-dialog-body">
      <div class="form">
        <div class="label">Name</div><input id="mapName"><span></span>
        <div class="label">Local Root</div><div class="input-with-button"><input id="mapLocal"><button id="pickLocal" class="input-icon-button" type="button" aria-label="Browse Local Root" data-tooltip="Browse Local Root"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.44c.4 0 .78.16 1.06.44L8.56 4H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Zm1-.01v7.51c0 .28.22.5.5.5h10a.5.5 0 0 0 .5-.5v-6A.5.5 0 0 0 13 5H8.15L6.8 3.65a.5.5 0 0 0-.36-.15H3a.5.5 0 0 0-.5.49Z" /></svg></button></div><span></span>
        <div class="label">Direction</div><select aria-label="Direction" id="mapDirection"><option value="bidirectional">Bidirectional</option><option value="localToRemote">Local → Remote</option><option value="remoteToLocal">Remote → Local</option></select><span></span>
        <div class="label">Ignore</div><textarea id="mapIgnore" rows="4" placeholder="One pattern per line"></textarea><span></span>
        <div class="mapping-options-grid full">
          <div class="mapping-options-column">
            <div class="mapping-option-row"><label><input id="optConflict" type="checkbox" class="checkbox-inline dialog-checkbox"> <span>Unknown Change Protection</span></label><button type="button" class="option-help-button" data-option-help="unknownChangeProtection" aria-label="About Unknown Change Protection" aria-expanded="false">${helpIcon}</button></div>
            <div class="mapping-option-row"><label><input id="optAtomic" type="checkbox" class="checkbox-inline dialog-checkbox"> <span>Atomic Transfer when supported</span></label><button type="button" class="option-help-button" data-option-help="atomicTransfer" aria-label="About Atomic Transfer when supported" aria-expanded="false">${helpIcon}</button></div>
            <div class="mapping-option-row"><label><input id="optDeletes" type="checkbox" class="checkbox-inline dialog-checkbox"> <span>Propagate Deletes</span></label><button type="button" class="option-help-button" data-option-help="propagateDeletes" aria-label="About Propagate Deletes" aria-expanded="false">${helpIcon}</button></div>
          </div>
          <div class="mapping-options-column">
            <div class="mapping-option-row"><label><input id="optUploadSave" type="checkbox" class="checkbox-inline dialog-checkbox"> <span>Upload on Save</span></label><button type="button" class="option-help-button" data-option-help="uploadOnSave" aria-label="About Upload on Save" aria-expanded="false">${helpIcon}</button></div>
            <div class="mapping-option-row"><label><input id="optWatch" type="checkbox" class="checkbox-inline dialog-checkbox"> <span>Watch Local Changes</span></label><button type="button" class="option-help-button" data-option-help="watchLocalChanges" aria-label="About Watch Local Changes" aria-expanded="false">${helpIcon}</button></div>
            <div class="mapping-option-row"><label><input id="optWatchRemote" type="checkbox" class="checkbox-inline dialog-checkbox"> <span>Watch Remote Changes</span></label><button type="button" class="option-help-button" data-option-help="watchRemoteChanges" aria-label="About Watch Remote Changes" aria-expanded="false">${helpIcon}</button></div>
          </div>
        </div>
      </div>
      <div class="split"></div>
      <div class="mapping-actions"><b>Targets</b><button id="addTarget" class="secondary">Add Target</button></div>
      <div id="targetEditor"></div>
    </div>
    <button id="directionHelpButton" type="button" class="option-help-button direction-help-button" data-option-help="direction" aria-label="About Sync Direction" aria-expanded="false">${helpIcon}</button>
    <button id="ignoreHelpButton" type="button" class="option-help-button ignore-help-button" data-option-help="ignorePatterns" aria-label="About Ignore Patterns" aria-expanded="false">${helpIcon}</button>
    <div class="toolbar dialog-actions mapping-dialog-actions"><div id="mappingError" class="mapping-dialog-validation" role="alert" aria-live="polite"></div><div class="mapping-dialog-action-buttons"><button id="deleteMapping" class="secondary">Delete</button><button id="cancelMapping" class="secondary">Cancel</button><button id="saveMapping">Save</button></div></div>
  </div></div>

  <div id="optionHelpPopover" class="option-help-popover" role="tooltip" hidden><div id="optionHelpTitle" class="option-help-title"></div><div id="optionHelpText" class="option-help-text"></div></div>

  <div id="webviewTooltip" class="webview-tooltip" role="tooltip" aria-hidden="true"></div>

  <div id="changesContextMenu" class="context-menu changes-context-menu" role="menu" aria-label="Workspace Sync Change Actions">
    <button id="changesContextCompare" type="button" role="menuitem">Compare Local and Remote</button>
    <div id="changesContextCompareSeparator" class="context-menu-separator" role="separator"></div>
    <button id="changesContextUpload" type="button" role="menuitem">Upload to Remote</button>
    <button id="changesContextDownload" type="button" role="menuitem">Download to Local</button>
    <button id="changesContextUseLocal" type="button" role="menuitem">Use Local</button>
    <button id="changesContextUseRemote" type="button" role="menuitem">Use Remote</button>
    <button id="changesContextSkip" type="button" role="menuitem">Skip</button>
  </div>

  <div id="activityContextMenu" class="context-menu activity-context-menu" role="menu" aria-label="Activity Actions">
    <button id="activityContextCopySelected" type="button" role="menuitem" hidden>Copy Selected</button>
    <button id="activityContextCopyAll" type="button" role="menuitem">Copy All</button>
    <div class="context-menu-separator" role="separator"></div>
    <button id="activityContextClear" type="button" role="menuitem">Clear</button>
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

  <div id="requestDialog" class="sync-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="requestTitle" hidden><div id="requestDialogPanel" class="sync-dialog compact-dialog"><h2 id="requestTitle" class="dialog-title"></h2><p id="requestDetail" class="request-detail"></p><div id="requestBody"></div><div id="requestActions" class="toolbar dialog-actions"></div></div></div>
  <div id="diffDialog" class="sync-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="diffTitle" hidden><div class="sync-dialog diff-dialog"><h2 id="diffTitle" class="dialog-title path"></h2><p id="diffSummary" class="muted"></p><div class="diff-heading"><span>Local</span><span>Remote</span><span></span><span>Content</span></div><div id="diffLines" class="diff-lines" tabindex="0" aria-label="File comparison"></div><div class="toolbar dialog-actions"><button id="closeDiff" class="secondary">Close</button></div></div></div>
`;
}

function renderOptionHelpIcon(questionIconSvg: string): string {
  const svg = String(questionIconSvg || '').trim();
  if (/^<svg\b/i.test(svg) && /<\/svg>$/i.test(svg)) {
    return `<span class="option-help-icon" aria-hidden="true">${svg}</span>`;
  }
  return '<span class="option-help-icon option-help-fallback" aria-hidden="true">?</span>';
}
