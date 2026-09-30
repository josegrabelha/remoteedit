import type * as vscode from 'vscode';
import { getNonce } from '../../utils/webviewUtils';
import { renderWorkspaceSyncBody } from './markup/Body';
import { renderSyncStyles } from './styles/Styles';
import { renderWorkspaceSyncClientScript } from './scripts/ClientScript';
import { renderComboboxControls } from '../../panel/webview/scripts/ComboboxControls';

export function renderWorkspaceSyncHtml(webview: vscode.Webview, questionIconSvg = '', compareIconSvg = ''): string {
  const nonce = getNonce();
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><title>Workspace Sync</title><style>${renderSyncStyles()}</style></head><body>${renderWorkspaceSyncBody(questionIconSvg)}<script nonce="${nonce}">${renderComboboxControls()}${renderWorkspaceSyncClientScript(compareIconSvg)}</script></body></html>`;
}
