/**
 * The block editor's styles, added to the page when it starts. Colours are
 * VS Code theme variables only, so every theme and high contrast work.
 */
const CSS = /* css */ `
.bk-stack { display: flex; flex-direction: column; gap: 6px; padding: 6px 0; }
.bk { border: 1px solid var(--vscode-panel-border, transparent); border-radius: 4px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); }
.bk .bk { background: var(--vscode-editor-background); }
.bk.dragging { opacity: 0.4; }
.bk.drop-before { box-shadow: 0 -2px 0 var(--vscode-focusBorder); }
.bk.drop-after { box-shadow: 0 2px 0 var(--vscode-focusBorder); }
.bk.bk-problem { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); }
.bk-list { display: flex; flex-direction: column; gap: 4px; margin: 4px 0; }
.bk-head { display: flex; align-items: center; gap: 6px; padding: 4px 6px; cursor: pointer; user-select: none; border-radius: 4px; min-height: 22px; }
.bk-head:hover { background: var(--vscode-list-hoverBackground); }
.bk-head:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.bk-chevron { width: 10px; opacity: 0.7; flex: none; }
.bk-type { flex: none; min-width: 20px; text-align: center; font-size: 11px; font-weight: 600; color: var(--vscode-symbolIcon-classForeground, var(--vscode-textLink-foreground)); }
.bk-title { font-weight: 600; white-space: nowrap; }
.bk-summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.7; font-size: 0.92em; }
.bk-tools { display: flex; gap: 2px; align-items: center; margin-left: auto; flex: none; }
.bk-handle { cursor: grab; opacity: 0.5; letter-spacing: -2px; padding: 0 2px; }
.bk-handle:hover { opacity: 1; }
.bk-icon { background: transparent; color: var(--vscode-icon-foreground, var(--vscode-foreground)); border: none; border-radius: 3px; padding: 1px 5px; cursor: pointer; opacity: 0.55; }
.bk-icon:hover, .bk-head:focus-within .bk-icon { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
.bk-body { display: none; padding: 4px 8px 8px 22px; border-top: 1px solid var(--vscode-panel-border, transparent); }
.bk.open > .bk-body { display: block; }
.bk-section { margin: 10px 0 4px; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; }
.bk-field { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 4px 0; }
.bk-field > label { flex: 0 0 84px; opacity: 0.8; }
.bk-text { opacity: 0.9; }
.bk-input, .bk-select { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 2px 4px; font: inherit; min-width: 0; }
.bk-input:focus, .bk-select:focus, .bk-code-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.bk-input.invalid { border-color: var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); }
.bk-number { width: 70px; }
.bk-number.short { width: 48px; }
.bk-line { width: 170px; }
.bk-hex { width: 92px; font-family: var(--vscode-editor-font-family, monospace); }
.bk-tuple, .bk-colour { display: inline-flex; gap: 3px; align-items: center; flex-wrap: wrap; }
.bk-swatch { position: relative; width: 22px; height: 22px; border-radius: 3px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); background: repeating-conic-gradient(var(--vscode-editorWidget-border, #808080) 0 25%, transparent 0 50%) 0 0 / 8px 8px; overflow: hidden; flex: none; }
.bk-swatch::before { content: ''; position: absolute; inset: 0; background: var(--bk-swatch, transparent); }
.bk-picker { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: none; padding: 0; }
.bk-flags { display: inline-flex; flex-wrap: wrap; gap: 3px; }
.bk-flag { color: var(--vscode-foreground); background: transparent; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); border-radius: 10px; padding: 0 8px; cursor: pointer; font-size: 0.92em; opacity: 0.75; }
.bk-flag[aria-pressed=true] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: transparent; opacity: 1; }
.bk-flag:disabled { cursor: default; opacity: 0.4; }
.bk-flag:focus-visible, .bk-button:focus-visible, .bk-pick:focus-visible, .bk-add-button:focus-visible, .bk-menu-item:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.bk-button, .bk-pick { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; border-radius: 2px; padding: 2px 8px; cursor: pointer; }
.bk-button:hover, .bk-pick:hover { background: var(--vscode-button-secondaryHoverBackground); }
.bk-link { background: transparent; color: var(--vscode-textLink-foreground); padding: 0 4px; }
.bk-link:hover { background: transparent; color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
.bk-pick { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.bk-picker-box, .bk-add { position: relative; display: inline-block; }
.bk-popup { position: absolute; z-index: 10; top: 100%; left: 0; min-width: 220px; max-width: 320px; max-height: 280px; overflow: auto; margin-top: 2px; padding: 4px; color: var(--vscode-menu-foreground, var(--vscode-foreground)); background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, var(--vscode-panel-border))); border-radius: 4px; box-shadow: 0 2px 8px var(--vscode-widget-shadow); }
.bk-search { width: 100%; box-sizing: border-box; margin-bottom: 4px; }
.bk-option { padding: 2px 6px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 2px; }
.bk-option:hover, .bk-option.active { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
.bk-add { margin: 6px 0 2px; }
.bk-add-button { color: var(--vscode-textLink-foreground); background: transparent; border: 1px dashed var(--vscode-panel-border); border-radius: 4px; padding: 3px 10px; cursor: pointer; }
.bk-add-button:hover { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
.bk-menu { display: flex; flex-direction: column; }
.bk-menu-item { display: flex; align-items: center; gap: 6px; color: inherit; background: transparent; border: none; text-align: left; padding: 3px 6px; cursor: pointer; border-radius: 2px; }
.bk-menu-item:hover { color: var(--vscode-menu-selectionForeground); background: var(--vscode-menu-selectionBackground); }
.bk-script-host { min-height: 1.4em; }
.bk-script { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.bk-code { position: relative; width: 100%; box-sizing: border-box; background: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; overflow: hidden; }
.bk-code-layer, .bk-code-input { margin: 0; padding: 6px 8px; box-sizing: border-box; width: 100%; font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 12px); line-height: 1.5; tab-size: 2; white-space: pre; word-break: normal; overflow: auto; border: none; letter-spacing: 0; }
.bk-code-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; color: var(--vscode-editor-foreground); }
.bk-code-input { position: relative; display: block; resize: vertical; color: transparent; caret-color: var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground)); background: transparent; outline: none; }
.bk-code-input::selection { color: transparent; background: var(--vscode-editor-selectionBackground); }
.bk-script-status { font-size: 0.9em; opacity: 0.7; }
.bk-script-status.error { opacity: 1; color: var(--vscode-errorForeground); }
.tok-comment { color: var(--vscode-editor-foreground); opacity: 0.55; font-style: italic; }
.tok-string { color: var(--vscode-debugTokenExpression-string, #ce9178); }
.tok-name-quoted { color: var(--vscode-debugTokenExpression-string, #ce9178); }
.tok-number { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
.tok-keyword { color: var(--vscode-symbolIcon-keywordForeground, #569cd6); }
.tok-register { color: var(--vscode-symbolIcon-variableForeground, #9cdcfe); }
.tok-directive { color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); }
.tok-label { color: var(--vscode-symbolIcon-constantForeground, #4fc1ff); }
.tok-operator { color: var(--vscode-editor-foreground); opacity: 0.85; }
.tok-error { text-decoration: underline wavy var(--vscode-editorError-foreground, red); text-underline-offset: 2px; }
.bk-flow { display: inline-flex; flex-wrap: wrap; gap: 4px; }
#inspector .bk-stack, #details .bk-stack { padding-top: 6px; }
#inspector > .bk, #timeline > .bk { margin: 6px 0; }
#timeline > .bk > .bk-body { padding-left: 8px; }
#toggleTextView { margin-left: auto; }
`;

/** Adds the block styles once */
export const installBlockStyles = (): void => {
  if (document.getElementById('block-styles')) {
    return;
  }

  const style = document.createElement('style');

  style.id = 'block-styles';
  style.textContent = CSS;
  document.head.append(style);
};
