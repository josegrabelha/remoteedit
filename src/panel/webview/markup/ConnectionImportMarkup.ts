export function renderConnectionImportMarkup(): string {
  return `
<div id="connectionImportBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="connectionImportTitle" aria-hidden="true">
<section class="file-properties-dialog connection-import-dialog">
<div class="file-properties-header"><h2 id="connectionImportTitle" class="file-properties-title">Import Connections</h2><div id="connectionImportStep" class="file-properties-path">Sources</div></div>
<div class="file-properties-body">
<div id="connectionImportContent" class="connection-import-scroll"></div>
<div id="connectionImportDetails" class="connection-import-details"></div>
</div>
<div class="file-properties-actions connection-import-actions"><div id="connectionImportFeedback" class="connection-import-footer-status has-tooltip tooltip-above" role="status" aria-live="polite"></div><button id="connectionImportBack" class="secondary" type="button">Back</button><button id="connectionImportCancel" class="secondary" type="button">Cancel</button><button id="connectionImportNext" type="button">Review</button></div>
</section></div>
<div id="connectionImportUnlockBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="connectionImportUnlockTitle" aria-hidden="true">
<section class="file-properties-dialog connection-name-dialog connection-import-unlock-dialog">
<div class="file-properties-header"><h2 id="connectionImportUnlockTitle" class="file-properties-title">Unlock Credentials</h2></div>
<div class="file-properties-body">
<label for="connectionImportUnlockPassword">External Master Password</label>
<div class="input-with-button">
<input id="connectionImportUnlockPassword" type="password" autocomplete="off" />
<button id="connectionImportUnlockReveal" class="input-icon-button password-reveal-button has-tooltip" type="button" aria-label="Temporarily Show External Master Password" data-tooltip="Hold to Show Password">
<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.5 3 2.1 5.1 1 8c1.1 2.9 3.5 5 7 5s5.9-2.1 7-5c-1.1-2.9-3.5-5-7-5Zm0 8.7A3.7 3.7 0 1 1 8 4.3a3.7 3.7 0 0 1 0 7.4Zm0-1.2A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5Z" /></svg>
</button>
</div>
<div class="connection-import-unlock-note">The password is used only to unlock protected credentials from this application during import and is not saved.</div>
<div id="connectionImportUnlockFeedback" class="connection-import-unlock-feedback" role="status" aria-live="polite"></div>
</div>
<div class="file-properties-actions"><button id="connectionImportUnlockCancel" type="button" class="secondary">Skip</button><button id="connectionImportUnlockSkipAll" type="button" class="secondary" hidden>Skip All</button><button id="connectionImportUnlockSubmit" type="button">Unlock</button></div>
</section></div>
<div id="connectionImportConfirmBackdrop" class="file-properties-backdrop" role="dialog" aria-modal="true" aria-labelledby="connectionImportConfirmTitle" aria-hidden="true">
<section class="file-properties-dialog connection-name-dialog connection-import-confirm-dialog">
<div class="file-properties-header"><h2 id="connectionImportConfirmTitle" class="file-properties-title">Protected Credentials</h2></div>
<div class="file-properties-body">
<div id="connectionImportConfirmText" class="connection-import-confirm-text"></div>
<div id="connectionImportConfirmRisk" class="connection-import-confirm-risk"></div>
</div>
<div class="file-properties-actions"><button id="connectionImportConfirmBack" class="secondary" type="button">Back</button><button id="connectionImportConfirmUnlock" class="secondary" type="button">Unlock Credentials</button><button id="connectionImportConfirmProceed" type="button">Import Without Credentials</button></div>
</section></div>`;
}
