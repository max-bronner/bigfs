import * as vscode from 'vscode';
import { readWorkspaceText } from '../services/ini/workspaceText';
import type { EntryLocator } from '../services/entryLocator';
import {
  applyValueEdits,
  findParticleDefinitions,
  numericFields,
  readFxList,
  readParticleDef,
  valueEdits,
} from '../formats/particles/particleIni';
import type {
  FxListDef,
  IniDefinition,
  ParticleDef,
} from '../formats/particles/particleIni';
import { keyEdits } from '../formats/particles/particleKeys';
import type { ModelScene } from '../formats/w3d/w3dScene';
import { buildW3dScene } from '../formats/w3d/w3dScene';
import { createToolRegistry } from '../services/toolRegistry';
import { duplicateDefinition } from '../game/objects/duplicateDefinition';
import type { KeyKind, KeyValue } from '../formats/particles/particleKeys';
import { webviewPage } from '../platform/webview/webviewPage';
import type { SageIniIndex } from '../services/ini/sageIniIndex';
import { EffectLibrary } from './effectLibrary';

/**
 * The particle preview: a "Preview" lens on every `FXParticleSystem`,
 * `ParticleSystem` and `FXList` block, and a panel that simulates it with
 * its textures. Every number of the previewed block gets a slider; moving
 * one changes the running preview only, until "Apply to INI" writes the
 * values back as one edit. Typing in the block updates the preview too.
 */

const findDefinitionAt = (
  definitions: IniDefinition[],
  line: number,
): IniDefinition | undefined =>
  definitions.find(
    (definition) => definition.startLine <= line && line <= definition.endLine,
  );

class ParticlePreview {
  private static readonly panels = new Map<string, ParticlePreview>();

  private readonly panel: vscode.WebviewPanel;
  private readonly values = new Map<string, number>();
  private readonly library: EffectLibrary;
  private readonly disposables: vscode.Disposable[] = [];
  private restartNext = true;
  /** Showing the block as written, slider values held back, to compare */
  private comparing = false;
  private updating: Promise<void> = Promise.resolve();
  /** Whether an update is waiting; slider drags coalesce into it */
  private queued = false;
  /** The last scene sent to the page */
  public lastScene?: Record<string, unknown>;
  /** What the page last said it is running */
  public lastStatus?: { frame: number; systems: number; particles: number };

  public static show(
    context: vscode.ExtensionContext,
    index: SageIniIndex,
    locator: EntryLocator | undefined,
    uri: vscode.Uri,
    name: string,
  ): ParticlePreview {
    const key = `${uri.toString()}#${name.toLowerCase()}`;
    const existing = ParticlePreview.panels.get(key);

    if (existing) {
      existing.panel.reveal(undefined, true);
      existing.restart();
      return existing;
    }

    const preview = new ParticlePreview(
      context,
      index,
      locator,
      uri,
      name,
      key,
    );

    ParticlePreview.panels.set(key, preview);
    return preview;
  }

  /** Resolves once every update asked for so far has been sent */
  public settled(): Promise<void> {
    return this.updating;
  }

  public dispose(): void {
    this.panel.dispose();
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly index: SageIniIndex,
    private readonly locator: EntryLocator | undefined,
    private readonly uri: vscode.Uri,
    private readonly name: string,
    key: string,
  ) {
    this.library = new EffectLibrary(index, locator, uri);
    const scripts = vscode.Uri.joinPath(
      context.extensionUri,
      'dist',
      'webview',
    );

    this.panel = vscode.window.createWebviewPanel(
      'bigfs.particlePreview',
      `Particles: ${name}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [scripts],
      },
    );
    this.panel.webview.html = particlePageHtml(
      this.panel.webview.cspSource,
      this.panel.webview
        .asWebviewUri(vscode.Uri.joinPath(scripts, 'particles.js'))
        .toString(),
    );
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message) =>
        this.receive(message),
      ),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.uri.toString()) {
          this.update();
        }
      }),
    );
    this.panel.onDidDispose(() => {
      ParticlePreview.panels.delete(key);
      this.disposables.forEach((disposable) => disposable.dispose());
    });
  }

  private restart(): void {
    this.restartNext = true;
    this.update();
  }

  /** Handles a message from the page; public so automation can act as it */
  public async receive(message: {
    kind?: string;
    id?: string;
    value?: number;
    line?: number;
    frame?: number;
    systems?: number;
    particles?: number;
    keyKind?: KeyKind;
    values?: Record<string, number>;
    on?: boolean;
    name?: string;
    keys?: KeyValue[];
  }): Promise<void> {
    switch (message?.kind) {
      case 'status':
        this.lastStatus = {
          frame: Number(message.frame),
          systems: Number(message.systems),
          particles: Number(message.particles),
        };
        break;
      case 'ready':
        this.restart();
        break;
      case 'set':
        if (message.id && Number.isFinite(message.value)) {
          this.values.set(message.id, Number(message.value));
          this.update();
        }
        break;
      case 'setMany':
        for (const [id, value] of Object.entries(message.values ?? {})) {
          if (Number.isFinite(value)) {
            this.values.set(id, Number(value));
          }
        }
        this.update();
        break;
      case 'compare':
        this.comparing = !!message.on;
        this.restartNext = true;
        this.update();
        break;
      case 'pickModel':
        await this.pickModel();
        break;
      case 'variant':
        await this.saveVariant(message.name);
        break;
      case 'reset':
        this.values.clear();
        this.update();
        break;
      case 'apply':
        await this.apply();
        break;
      case 'keys':
        if (
          (message.keyKind === 'Color' || message.keyKind === 'Alpha') &&
          Array.isArray(message.keys)
        ) {
          await this.apply({ kind: message.keyKind, keys: message.keys });
        }
        break;
      case 'playSound':
        // Only a click or the page's opt-in checkbox gets here; one name, one play
        if (message.name) {
          await vscode.commands.executeCommand(
            'bigfs.playAudioEvent',
            String(message.name),
            this.uri.toString(),
          );
        }
        break;
      case 'reveal': {
        const editor = await vscode.window.showTextDocument(this.uri, {
          viewColumn: vscode.ViewColumn.One,
        });
        const position = new vscode.Position(Number(message.line) || 0, 0);

        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
        break;
      }
    }
  }

  /** The previewed definition as the file now has it */
  private async rootDefinition(): Promise<
    { definition: IniDefinition; text: string } | undefined
  > {
    const text = await readWorkspaceText(this.uri);
    const definition = findParticleDefinitions(text).find(
      (candidate) => candidate.name.toLowerCase() === this.name.toLowerCase(),
    );

    return definition && { definition, text };
  }

  /**
   * Writes the slider values; with `keys`, also rewrites that kind's key
   * lines, which renumbers them, so the values are written in the same edit
   */
  private async apply(keys?: {
    kind: KeyKind;
    keys: KeyValue[];
  }): Promise<void> {
    const root = await this.rootDefinition();

    if (!root || (!this.values.size && !keys)) {
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const newline = /\r\n/.test(root.text) ? '\r\n' : '\n';
    const rewritten = keys
      ? keyEdits(root.text, root.definition, keys.kind, keys.keys)
      : [];
    const replaced = new Set(
      rewritten.flatMap((change) =>
        Array.from({ length: change.remove }, (_, at) => change.line + at),
      ),
    );

    for (const change of rewritten) {
      edit.replace(
        this.uri,
        new vscode.Range(change.line, 0, change.line + change.remove, 0),
        change.insert.map((line) => line + newline).join(''),
      );
    }
    for (const change of valueEdits(root.definition, this.values).filter(
      (each) => !replaced.has(each.line),
    )) {
      edit.replace(
        this.uri,
        new vscode.Range(change.line, change.start, change.line, change.end),
        change.text,
      );
    }
    this.values.clear();
    await vscode.workspace.applyEdit(edit);
  }

  /** Asks for a model to show the effect on, and sends it to the page */
  private async pickModel(): Promise<void> {
    if (!this.locator) {
      return;
    }

    const names = await this.locator.findNames(
      (name) => name.endsWith('.w3d') && !name.endsWith('_skl.w3d'),
      '**/*.w3d',
    );
    const picked = await vscode.window.showQuickPick(
      [
        { label: 'No model', name: undefined },
        ...names.map((name) => ({ label: name, name })),
      ],
      { placeHolder: 'A model to show the effect on, at one of its bones' },
    );

    if (!picked) {
      return;
    }

    let model: { name: string; scene: ModelScene } | undefined;

    if (picked.name) {
      const bytes = await this.locator.read(picked.name, this.uri);

      if (!bytes) {
        throw new Error(`${picked.name} could not be read`);
      }
      model = {
        name: picked.name,
        scene: await buildW3dScene(
          bytes,
          (fileName) => this.locator!.read(fileName, this.uri),
          createToolRegistry(),
        ),
      };
    }
    await this.panel.webview.postMessage({ kind: 'model', model });
  }

  /**
   * Writes the block, with its slider values, as a new definition after
   * it, and leaves the block itself as it was: a variant to keep
   */
  private async saveVariant(given?: string): Promise<void> {
    const root = await this.rootDefinition();

    if (!root) {
      return;
    }

    const name =
      given ??
      (await vscode.window.showInputBox({
        prompt: `Name of the variant of ${this.name}, with the values in the preview`,
        value: `${this.name}_Variant`,
        validateInput: (value) =>
          /^[A-Za-z0-9_]+$/.test(value)
            ? undefined
            : 'One word: letters, digits and _',
      }));

    if (!name) {
      return;
    }

    const lines = applyValueEdits(
      root.text,
      valueEdits(root.definition, this.values),
    ).split(/\r?\n/);
    const copy = duplicateDefinition(
      lines,
      root.definition.startLine,
      root.definition.endLine,
      name,
    );
    const document = await vscode.workspace.openTextDocument(this.uri);
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const edit = new vscode.WorkspaceEdit();

    edit.insert(
      this.uri,
      document.lineAt(root.definition.endLine).range.end,
      `${eol}${eol}${copy.lines.join(eol)}`,
    );
    this.values.clear();
    await vscode.workspace.applyEdit(edit);
    void vscode.window.showInformationMessage(
      `${name} written after ${this.name}; ${this.name} keeps its values`,
    );
  }

  private update(): void {
    if (this.queued) {
      return;
    }
    this.queued = true;
    this.updating = this.updating
      .then(() => {
        this.queued = false;
        return this.send();
      })
      .catch(async (error: unknown) => {
        await this.panel.webview.postMessage({
          kind: 'notice',
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }

  /**
   * The particle count each detail level allows, from the mod's own
   * `StaticGameLOD` blocks (`MaxParticleCount`), smallest first
   */
  private async particleBudgets(): Promise<{ lod: string; max: number }[]> {
    const budgets: { lod: string; max: number }[] = [];

    for (const name of this.index.getNames('StaticGameLOD')) {
      const [place] = this.index.findDefinitions('StaticGameLOD', name);

      if (!place) {
        continue;
      }

      const lines = (await readWorkspaceText(place.uri))
        .split(/\r?\n/)
        .slice(place.line + 1, place.endLine);
      const max = lines
        .map((line) => /^\s*MaxParticleCount\s*=\s*(\d+)/i.exec(line))
        .find(Boolean)?.[1];

      if (max !== undefined) {
        budgets.push({ lod: name, max: Number(max) });
      }
    }
    return budgets.sort((a, b) => a.max - b.max);
  }

  private async send(): Promise<void> {
    await this.index.whenReady();

    const root = await this.rootDefinition();

    if (!root) {
      await this.panel.webview.postMessage({
        kind: 'notice',
        message: `${this.name} is no longer in the file`,
      });
      return;
    }

    // Slider values are previewed on a copy of the text, never written
    const text = this.comparing
      ? root.text
      : applyValueEdits(root.text, valueEdits(root.definition, this.values));
    const definition = findParticleDefinitions(text).find(
      (candidate) => candidate.startLine === root.definition.startLine,
    )!;
    const previewed = (
      definition.keyword === 'FXList'
        ? readFxList(definition)
        : readParticleDef(definition)
    ) as ParticleDef | FxListDef;
    const { systems, fxLists, textures, notes } = await this.library.collect(
      [previewed],
      [],
      text,
    );

    this.lastScene = {
      kind: 'scene',
      restart: this.restartNext,
      root: {
        kind: definition.keyword === 'FXList' ? 'fxList' : 'system',
        name: definition.name,
        line: definition.startLine,
      },
      systems,
      fxLists,
      textures,
      notes,
      fields: numericFields(root.definition),
      values: Object.fromEntries(this.values),
      comparing: this.comparing,
      budgets: await this.particleBudgets(),
    };
    await this.panel.webview.postMessage(this.lastScene);
    this.restartNext = false;
  }
}

/** The preview page: its controls, and the bundle that simulates and draws */
export const particlePageHtml = (source: string, script: string): string =>
  webviewPage({
    allow: { img: 'data:', script: source },
    scriptFiles: [script],
    style: `
html, body { height: 100%; margin: 0; overflow: hidden; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
#layout { display: flex; height: 100%; }
#view { flex: 1; position: relative; min-width: 0; }
canvas { width: 100%; height: 100%; display: block; cursor: grab; }
#hud { position: absolute; left: 8px; top: 6px; font: 11px var(--vscode-editor-font-family); color: #ddd; text-shadow: 0 1px 2px #000; pointer-events: none; white-space: pre; }
#side { width: 340px; overflow-y: auto; padding: 8px 10px; box-sizing: border-box; border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
h3 { margin: 12px 0 4px; font-size: 11px; text-transform: uppercase; opacity: 0.75; }
.row { display: flex; gap: 6px; align-items: center; margin: 3px 0; flex-wrap: wrap; }
button, select, input { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); padding: 2px 8px; cursor: pointer; }
button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.field { display: grid; grid-template-columns: 112px 1fr 64px; gap: 4px; align-items: center; margin: 2px 0; }
.field label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.field.changed label { color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); font-weight: 600; }
.field input[type=number] { width: 60px; }
#scaleSpace, #scaleTime, #varyAmount { width: 52px; }
button.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.field input[type=range] { width: 100%; }
#handles { position: absolute; inset: 0; pointer-events: none; cursor: default; }
#flash { position: absolute; inset: 0; pointer-events: none; }
#notes div { opacity: 0.8; margin: 2px 0; }
.stats-lines { white-space: pre; font: 11px var(--vscode-editor-font-family); }
.stats-table { border-collapse: collapse; font-size: 11px; margin-top: 4px; }
.stats-table td { padding: 1px 6px 1px 0; }
.stats-table thead td { opacity: 0.7; }
#stats .over { color: var(--vscode-errorForeground, #f66); }
#stats .within { color: var(--vscode-testing-iconPassed, #73c991); }
#stats .row span { margin-left: 4px; }
.curve { display: block; margin: 2px 0 4px; cursor: crosshair; touch-action: none; }
.curve-heading { margin: 8px 0 2px; font-weight: 600; }
.curve-heading .muted { font-weight: normal; font-size: 11px; }
#curves input[type=number] { width: 52px; }
#curves input[type=color] { width: 36px; height: 20px; padding: 0; }
#notice { color: var(--vscode-errorForeground); }
.muted { opacity: 0.7; }
kbd { font-size: 10px; opacity: 0.7; }
`,
    body: `<div id="layout">
<div id="view"><canvas id="canvas"></canvas><canvas id="handles"></canvas><div id="flash"></div><div id="hud"></div></div>
<div id="side">
  <div class="row"><strong id="title"></strong></div>
  <div id="object" hidden>
    <div class="row">State <select id="objectState"></select></div>
    <div class="row">Animation <select id="objectAnimation"></select></div>
    <div id="objectElements"></div>
    <div id="objectVoices" hidden></div>
    <div id="objectNotice" class="muted"></div>
  </div>
  <div class="row">
    <button id="play" title="Space">Pause</button>
    <button id="restart" title="R">Restart</button>
    <button id="step" title=".">Step</button>
    <select id="speed" title="Playback speed">
      <option value="0.1">0.1×</option><option value="0.25">0.25×</option><option value="0.5">0.5×</option>
      <option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option>
    </select>
    <label><input type="checkbox" id="loop" checked> Loop</label>
  </div>
  <h3>View</h3>
  <div class="row">
    <label><input type="checkbox" id="showVolume" checked> Emitter volume</label>
    <label><input type="checkbox" id="showGrid" checked> Ground</label>
    <label><input type="checkbox" id="keys" checked> Colour keys</label>
  </div>
  <div class="row">
    Emitter <select id="motion"><option value="still">still</option><option value="circle">circling</option><option value="line">back and forth</option></select>
    <button id="pickModel" title="Show the effect on a model, started at one of its bones">On a model…</button> <select id="bone" hidden></select>
    Sky <select id="sky"><option value="#1b1c1f">dark</option><option value="#7a8ea6">day</option><option value="#000000">black</option><option value="#c8c8c8">light</option></select>
  </div>
  <h3>Readings <span class="muted">where the game's rule is open</span></h3>
  <div class="row">Wind <select id="wind" title="W"><option value="retail">as written</option><option value="doubled">doubled</option><option value="off">off</option></select></div>
  <div class="row">Hollow box <select id="hollowBox" title="H"><option value="surface">surface</option><option value="point">point (EA release)</option></select></div>
  <div class="row">
    <label><input type="checkbox" id="compound" checked> Attached systems and events</label>
    <label><input type="checkbox" id="batchLimit" checked> 512 per system</label>
  </div>
  <div class="row muted"><kbd>Space</kbd> play · <kbd>R</kbd> restart · <kbd>.</kbd> step · <kbd>W</kbd> wind · <kbd>H</kbd> hollow box · <kbd>B</kbd> as written or with changes · drag the yellow handles to size the emission volume · drag to orbit, right-drag to pan, wheel to zoom</div>
  <div id="notice"></div>
  <div id="notes"></div>
  <h3>Load</h3>
  <div id="stats"></div>
  <div id="editing">
  <div id="timeline"></div>
  <div id="curves"></div>
  <h3>Values <span class="muted">preview only until applied</span></h3>
  <div class="row"><button id="apply" class="primary" disabled>Apply to INI</button><button id="reset" disabled>Reset</button></div>
  <div class="row" title="Scales every length, speed and duration together, so the effect stays the same effect: previewed until applied">Scale: size × <input id="scaleSpace" type="number" value="1" step="0.1" min="0.05"> time × <input id="scaleTime" type="number" value="1" step="0.1" min="0.05"> <button id="scale">Scale</button></div>
  <div class="row"><button id="compare" title="B: show the block as written, then with the values here, to compare">A/B: as written</button> <button id="vary" title="Nudge every value up to the amount either way, to try variations">Vary ±</button><input id="varyAmount" type="number" value="15" step="5" min="1">% <button id="variant" title="Write the values here as a new system after this one; this one keeps its values">Save as variant…</button></div>
  <div id="fields"></div>
  </div>
</div>
</div>`,
  });

/** A lens over every particle system and FX list in an INI file */
class ParticleLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    return findParticleDefinitions(document.getText()).map(
      (definition) =>
        new vscode.CodeLens(
          new vscode.Range(definition.startLine, 0, definition.startLine, 0),
          {
            title:
              definition.keyword === 'FXList'
                ? '▶ Preview FX list'
                : '▶ Preview particle system',
            command: 'bigfs.previewParticles',
            arguments: [document.uri, definition.name],
          },
        ),
    );
  }
}

export const registerParticlePreview = (
  context: vscode.ExtensionContext,
  selector: vscode.DocumentSelector,
  index: SageIniIndex,
  locator: EntryLocator | undefined,
): vscode.Disposable[] => [
  vscode.languages.registerCodeLensProvider(
    selector,
    new ParticleLensProvider(),
  ),
  vscode.commands.registerCommand(
    'bigfs.previewParticles',
    (uri?: vscode.Uri, name?: string) => {
      const editor = vscode.window.activeTextEditor;

      if (!uri || !name) {
        const found =
          editor &&
          findDefinitionAt(
            findParticleDefinitions(editor.document.getText()),
            editor.selection.active.line,
          );

        if (!editor || !found) {
          void vscode.window.showInformationMessage(
            'Put the cursor inside an FXParticleSystem, ParticleSystem or FXList block',
          );
          return;
        }
        uri = editor.document.uri;
        name = found.name;
      }
      return ParticlePreview.show(context, index, locator, uri, name);
    },
  ),
];
