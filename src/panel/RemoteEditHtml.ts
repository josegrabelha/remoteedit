import * as vscode from 'vscode';
import { renderBody } from './webview/markup/Body';
import { renderClientScript } from './webview/scripts/ClientScript';
import { renderStyles } from './webview/styles/Styles';

export interface RemoteEditHtmlOptions {
  showRemotePathBreadcrumbDirectoryDetails: boolean;
  openFileListItemsOnNameClick: boolean;
}

export function renderRemoteEditHtml(webview: vscode.Webview, nonce: string, options: RemoteEditHtmlOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Remote Edit</title>
  <style>
${renderStyles()}  </style>
${renderBody()}  <script nonce="${nonce}">
${renderClientScript(options)}  </script>
</body>
</html>`;
}
