/**
 * The viewer's styles. `:where` keeps their weight at zero, so a page's own
 * classes still win over the base look of a button or a select.
 */
const VIEWER_STYLE = `
.viewer { display: flex; height: 100%; min-height: 0; }
.viewer-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.viewer-bar { flex: none; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 4px 8px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); }
.viewer-bar input[type=range] { flex: 1; min-width: 120px; }
.viewer-status { margin-left: auto; opacity: 0.8; }
.viewer-stage { flex: 1; min-height: 0; position: relative; }
.viewer-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
.viewer-side { flex: none; width: 340px; overflow-y: auto; padding: 8px 10px; box-sizing: border-box; border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
.viewer-side p { margin: 6px 0; overflow-wrap: anywhere; }
.viewer-side p:empty { display: none; }
.viewer-parts summary { cursor: pointer; }
:where(.viewer) button, :where(.viewer) select { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; padding: 3px 8px; border-radius: 2px; font: inherit; cursor: pointer; }
:where(.viewer) button[aria-pressed="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
:where(.viewer) button:disabled, :where(.viewer) select:disabled { opacity: 0.5; cursor: default; }
`;

/**
 * Gives the page the viewer's styles. An adopted sheet is not inline style, so
 * it needs no change to the policy of either page the viewer runs on.
 */
export const adoptViewerStyle = (): void => {
  const sheet = new CSSStyleSheet();

  sheet.replaceSync(VIEWER_STYLE);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
};
