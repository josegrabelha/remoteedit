export function renderReusableProfileListStyles(): string {
  return `.target-set-card{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:4px 6px;border:1px solid var(--vscode-panel-border);border-radius:4px;background:var(--vscode-editor-background)}
.target-set-card:hover{background:var(--vscode-list-hoverBackground)}
.target-set-main{min-width:0;padding:2px 1px;cursor:pointer;outline:none}
.target-set-main:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
.target-set-name{min-width:0;font-size:var(--multi-target-font-size, 12px);font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.target-set-detail{color:var(--vscode-descriptionForeground);font-size:var(--multi-target-font-size, 12px);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.target-set-actions{display:flex;align-items:center;gap:4px}`;
}
