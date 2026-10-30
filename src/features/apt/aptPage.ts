import type * as vscode from 'vscode';
import { SPEEDS } from '../../webview/apt/protocol';
import { renderWebviewPage } from '../../platform/webview/webviewPage';

const STYLE = /* css */ `
  body { margin: 0; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); display: grid; grid-template-columns: 240px 1fr minmax(360px, 42%); height: 100vh; }
  aside, section { overflow: auto; }
  aside { border-right: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; }
  #filter { margin: 6px; padding: 3px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
  #list { overflow: auto; flex: 1; }
  .row { padding: 2px 8px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row.selected { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
  main { overflow: auto; padding: 8px 12px; }
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  #stage { background: repeating-conic-gradient(#808080 0 25%, #a0a0a0 0 50%) 0 0 / 16px 16px; }
  #side { border-left: 1px solid var(--vscode-panel-border); padding: 0 10px; }
  #inspector:not(:empty) { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; }
  #atlas:not(:empty) { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; }
  canvas.atlas { display: block; max-width: 100%; background: repeating-conic-gradient(#808080 0 25%, #a0a0a0 0 50%) 0 0 / 12px 12px; }
  #integrity .problem { cursor: default; margin: 1px 0; }
  #integrity .problem[data-character] { cursor: pointer; }
  #integrity .error { color: var(--vscode-errorForeground); }
  #integrity .warning { color: var(--vscode-editorWarning-foreground); }
  #integrity .info { opacity: 0.75; }
  #timeline .grid { overflow-x: auto; max-height: 220px; overflow-y: auto; border: 1px solid var(--vscode-panel-border); }
  #timeline table { border-collapse: collapse; font-size: 10px; }
  #timeline td { min-width: 9px; height: 13px; padding: 0 1px; text-align: center; cursor: pointer; border-right: 1px solid var(--vscode-panel-border); }
  #timeline td.depth { position: sticky; left: 0; min-width: 34px; background: var(--vscode-editor-background); cursor: default; }
  #timeline td.frame { opacity: 0.8; }
  #timeline td.held { background: color-mix(in srgb, var(--vscode-charts-blue, #3794ff) 35%, transparent); }
  #timeline td.key { background: color-mix(in srgb, var(--vscode-charts-blue, #3794ff) 65%, transparent); }
  #timeline td.born { background: var(--vscode-charts-blue, #3794ff); }
  #timeline td.removed { background: color-mix(in srgb, var(--vscode-charts-red, #f14c4c) 50%, transparent); }
  #timeline td.tween { background-image: linear-gradient(to bottom, transparent 40%, var(--vscode-charts-purple, #b180d7) 40%, var(--vscode-charts-purple, #b180d7) 60%, transparent 60%); }
  #timeline td.tween-start { border-left: 2px solid var(--vscode-charts-purple, #b180d7); }
  #timeline td.picked { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: -1px; }
  #timeline td.label { text-align: left; white-space: nowrap; overflow: hidden; max-width: 0; padding: 0 3px; color: var(--vscode-charts-yellow, #cca700); border-left: 2px solid var(--vscode-charts-yellow, #cca700); }
  #timeline td.flow { color: var(--vscode-charts-orange, #d18616); }
  #timeline td.jump-target { box-shadow: inset 0 0 0 2px var(--vscode-charts-green, #89d185); }
  #timeline td.now { box-shadow: inset 0 0 0 1px var(--vscode-charts-orange, #d18616); }
  #timeline .field label { min-width: 0; }
  #timeline input.short { width: 44px; }
  #timeline input.line { width: 150px; }
  #timeline .error-text { color: var(--vscode-errorForeground); }
  #log { font-family: var(--vscode-editor-font-family); font-size: 12px; opacity: 0.8; }
  button.chosen { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  pre { white-space: pre-wrap; word-break: break-all; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .muted, #summary { opacity: 0.75; }
  .error { color: var(--vscode-errorForeground); padding: 12px; }
  #notice { position: fixed; bottom: 8px; left: 250px; right: 12px; z-index: 2; padding: 6px 10px; color: var(--vscode-inputValidation-errorForeground, inherit); background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
  #engine summary { cursor: pointer; font-weight: 600; margin: 6px 0; }
  #engine .field label { min-width: 0; margin-right: 4px; font-family: var(--vscode-editor-font-family, monospace); }
  .field { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin: 3px 0; }
  .field label { min-width: 84px; opacity: 0.8; }
  .field input, .field textarea { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px; width: 90px; font: inherit; }
  .field textarea { width: 100%; min-height: 3em; }
  .field input.short { width: 52px; }
  .field label.bit { min-width: 0; opacity: 1; margin-right: 6px; white-space: nowrap; }
  .field label.bit input { width: auto; }
  .field input.line { width: 160px; }
  textarea.code { width: 100%; box-sizing: border-box; font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 12px); color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); white-space: pre; tab-size: 2; }
  .field input.invalid { border-color: var(--vscode-inputValidation-errorBorder); }
  .field button, button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; padding: 2px 8px; border-radius: 2px; cursor: pointer; }
  select, input[type=range] { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); }
`;

/** Renders the APT editor's page: character list, stage and details, around the page bundle */
export const renderAptPage = (
  webview: vscode.Webview,
  script: vscode.Uri,
): string =>
  renderWebviewPage({
    style: STYLE,
    body: /* html */ `<aside><input id="filter" placeholder="Filter characters, exports, text"><div id="list"></div></aside>
<main>
  <div class="toolbar">
    <select id="zoom"><option value="fit">Fit</option><option value="0.5">50%</option><option value="1">100%</option><option value="2">200%</option></select>
    <button id="play" title="Play or pause (Space)">▶</button>
    <button id="back" title="Previous frame (, or ← with nothing selected)">‹</button>
    <input id="frame" type="range" min="0" max="0" value="0">
    <button id="forward" title="Next frame (. or → with nothing selected)">›</button>
    <select id="speed" title="Playback speed; 1× is the game's 30 frames a second ([ and ] to change)">${SPEEDS.map((speed) => `<option value="${speed}"${speed === 1 ? ' selected' : ''}>${speed}×</option>`).join('')}</select>
    <span id="frame-label"></span>
    <button id="toggleTextView" title="Show the whole movie as text">Text view</button>
  </div>
  <div class="toolbar">
    <label title="O"><input type="checkbox" id="show-origin" checked> Origin</label>
    <label title="B"><input type="checkbox" id="show-boxes" checked> Boxes</label>
    <label title="M: draw everything, what a clip mask hides faintly, with the masks outlined; off draws the masks applied, as the game does"><input type="checkbox" id="show-masks"> Show masks</label>
    <select id="play-from" title="Play from a labelled frame, with its scripts run from there"></select>
    <label title="S: play every frame in order, as if no frame script stopped or jumped; off, stop() stops and gotoAndPlay jumps, as in the game"><input type="checkbox" id="scripts"> Ignore action scripts</label>
    <label title="I: run everything as the game does and let the pointer drive buttons"><input type="checkbox" id="interact"> Interact</label>
    <label title="W: draw the triangles of what is picked; a shape's vertices can then be dragged"><input type="checkbox" id="wireframe"> Wireframe</label>
    <span id="mode" class="muted"></span>
  </div>
  <canvas id="stage"></canvas>
  <div id="timeline"></div>
  <p id="summary"></p>
  <div id="integrity"></div>
  <div id="log"></div>
</main>
<section id="side"><div id="engine"></div><div id="inspector"></div><div id="atlas"></div><div id="details"></div></section>
<div id="notice" hidden></div>`,
    allow: { img: 'blob: data:', script: webview.cspSource },
    styleSources: `${webview.cspSource} 'unsafe-inline'`,
    scriptFiles: [script.toString()],
  });
