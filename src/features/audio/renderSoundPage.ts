import * as vscode from 'vscode';
import { renderWebviewPage } from '../../platform/webview/webviewPage';

/** Renders the sound player panel's page, whose script is `sound.js` in `scripts` */
export const renderSoundPage = (webview: vscode.Webview, scripts: vscode.Uri): string => {
  return renderWebviewPage({
    allow: { script: webview.cspSource },
    scriptFiles: [
      webview.asWebviewUri(vscode.Uri.joinPath(scripts, 'sound.js')).toString(),
    ],
    style: `
  body { padding: 10px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  ul { list-style: none; padding: 0; }
  li { margin: 2px 0; }
  .muted { opacity: 0.7; }
`,
    body: `<strong id="status">Nothing played yet</strong>
<div class="muted">Played before; Ctrl+click opens the file</div>
<ul id="history"></ul>`,
  });
};
