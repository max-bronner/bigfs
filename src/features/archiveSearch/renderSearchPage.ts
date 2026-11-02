import type { Uri, Webview } from 'vscode';
import { getPageBundleOptions } from '../../platform/webview/pageBundle';
import { renderWebviewPage } from '../../platform/webview/webviewPage';

const STYLE = `
  body { padding: 0 10px 10px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  input { box-sizing: border-box; width: 100%; padding: 3px 4px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); font: inherit; }
  input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  label { display: block; margin: 6px 0 2px; font-size: 0.9em; opacity: 0.85; }
  .field { position: relative; margin-top: 8px; }
  .field input { padding-right: 78px; }
  .toggles { position: absolute; top: 2px; right: 2px; display: flex; gap: 1px; }
  .toggles button { width: 22px; height: 20px; padding: 0; color: var(--vscode-foreground); background: none; border: 1px solid transparent; border-radius: 3px; cursor: pointer; font: inherit; font-size: 0.85em; }
  .toggles button:hover { background: var(--vscode-inputOption-hoverBackground); }
  .toggles button[aria-pressed="true"] { color: var(--vscode-inputOption-activeForeground); background: var(--vscode-inputOption-activeBackground); border-color: var(--vscode-inputOption-activeBorder); }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .row input { width: 52px; }
  #cancel { margin-left: auto; padding: 2px 10px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 0; cursor: pointer; font: inherit; }
  #status { margin: 10px 0 6px; min-height: 1.3em; opacity: 0.9; }
  #status.error { color: var(--vscode-errorForeground); opacity: 1; }
  #notes { margin: 0 0 6px; opacity: 0.8; }
  .archive, .file { display: flex; align-items: baseline; gap: 6px; padding: 2px 0; cursor: pointer; user-select: none; white-space: nowrap; }
  .archive:hover, .file:hover { background: var(--vscode-list-hoverBackground); }
  .archive { font-weight: 600; }
  .file { padding-left: 14px; }
  .twisty { width: 10px; opacity: 0.8; }
  .name { overflow: hidden; text-overflow: ellipsis; }
  .detail { overflow: hidden; text-overflow: ellipsis; opacity: 0.65; font-weight: normal; }
  .badge { margin-left: auto; padding: 0 6px; border-radius: 9px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 0.85em; font-weight: normal; }
  .block { margin: 2px 0 4px 28px; border-left: 1px solid var(--vscode-editorIndentGuide-background1, #8884); }
  .line { display: flex; min-height: 1.4em; line-height: 1.4em; gap: 8px; padding: 0 4px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre; cursor: pointer; }
  .line:hover { background: var(--vscode-list-hoverBackground); }
  .line .number { flex: none; min-width: 3ch; text-align: right; opacity: 0.55; }
  .line .text { overflow: hidden; text-overflow: ellipsis; opacity: 0.7; }
  .line.hit .text { opacity: 1; }
  mark { color: inherit; background: var(--vscode-editor-findMatchHighlightBackground); border: 1px solid var(--vscode-editor-findMatchHighlightBorder, transparent); }
  [hidden] { display: none !important; }
`;

const BODY = `
  <div class="field">
    <input id="query" placeholder="Search" aria-label="Search" spellcheck="false">
    <span class="toggles">
      <button id="case" title="Match Case" aria-pressed="false">Aa</button>
      <button id="word" title="Match Whole Word" aria-pressed="false"><u>ab</u></button>
      <button id="regex" title="Use Regular Expression" aria-pressed="false">.*</button>
    </span>
  </div>
  <label for="include">files to include</label>
  <input id="include" placeholder="e.g. *.ini, data/ini" spellcheck="false">
  <label for="exclude">files to exclude</label>
  <input id="exclude" placeholder="e.g. data/lang/**" spellcheck="false">
  <div class="row">
    <label for="context" style="margin:0">Context lines</label>
    <input id="context" type="number" min="0" max="10" value="2">
    <button id="cancel" hidden>Cancel</button>
  </div>
  <div id="status" role="status"></div>
  <div id="notes"></div>
  <div id="results"></div>
`;

/** Renders the page of the search view, with the bundled script that draws and runs it */
export const renderSearchPage = (webview: Webview, extensionUri: Uri): string =>
  renderWebviewPage({
    style: STYLE,
    body: BODY,
    ...getPageBundleOptions(extensionUri, webview, 'archiveSearch'),
  });
