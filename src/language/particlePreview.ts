import * as vscode from 'vscode';
import { decodeWindows1252 } from '../common/windows1252';
import type { EntryLocator } from '../formats/entryLocator';
import {
  applyValueEdits,
  findParticleDefinitions,
  numericFields,
  readFxList,
  readParticleDef,
  referencedNames,
  valueEdits,
} from '../formats/particles/particleIni';
import type {
  FxListDef,
  IniDefinition,
  ParticleDef,
} from '../formats/particles/particleIni';
import { encodePng } from '../formats/textureEncode';
import { createNonce } from '../providers/webviewNonce';
import { decodeDds, decodeTga } from '../tools/textureTools';
import { PARTICLE_VIEW_SCRIPT } from './particleViewScript';
import type { SageIniIndex } from './sageIniIndex';

/**
 * The particle preview: a "Preview" lens on every `FXParticleSystem`,
 * `ParticleSystem` and `FXList` block, and a panel that simulates it with
 * its textures. Every number of the previewed block gets a slider; moving
 * one changes the running preview only, until "Apply to INI" writes the
 * values back as one edit. Typing in the block updates the preview too.
 */

const MAX_REFERENCES = 64;

const findDefinitionAt = (
  definitions: IniDefinition[],
  line: number,
): IniDefinition | undefined =>
  definitions.find(
    (definition) => definition.startLine <= line && line <= definition.endLine,
  );

/** The text of a file, from its editor when it is open there */
const readText = async (uri: vscode.Uri): Promise<string> => {
  const open = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  );

  return open
    ? open.getText()
    : decodeWindows1252(await vscode.workspace.fs.readFile(uri));
};

class ParticlePreview {
  private static readonly panels = new Map<string, ParticlePreview>();

  private readonly panel: vscode.WebviewPanel;
  private readonly values = new Map<string, number>();
  private readonly textures = new Map<string, Promise<string | null>>();
  private readonly disposables: vscode.Disposable[] = [];
  private restartNext = true;
  private updating: Promise<void> = Promise.resolve();
  /** Whether an update is waiting; slider drags coalesce into it */
  private queued = false;

  public static show(
    context: vscode.ExtensionContext,
    index: SageIniIndex,
    locator: EntryLocator | undefined,
    uri: vscode.Uri,
    name: string,
  ): void {
    const key = `${uri.toString()}#${name.toLowerCase()}`;
    const existing = ParticlePreview.panels.get(key);

    if (existing) {
      existing.panel.reveal(undefined, true);
      existing.restart();
      return;
    }
    ParticlePreview.panels.set(
      key,
      new ParticlePreview(context, index, locator, uri, name, key),
    );
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly index: SageIniIndex,
    private readonly locator: EntryLocator | undefined,
    private readonly uri: vscode.Uri,
    private readonly name: string,
    key: string,
  ) {
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
    this.panel.webview.html = this.renderHtml(
      this.panel.webview.asWebviewUri(
        vscode.Uri.joinPath(scripts, 'particles.js'),
      ),
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

  private async receive(message: {
    kind?: string;
    id?: string;
    value?: number;
    line?: number;
  }): Promise<void> {
    switch (message?.kind) {
      case 'ready':
        this.restart();
        break;
      case 'set':
        if (message.id && Number.isFinite(message.value)) {
          this.values.set(message.id, Number(message.value));
          this.update();
        }
        break;
      case 'reset':
        this.values.clear();
        this.update();
        break;
      case 'apply':
        await this.apply();
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
    const text = await readText(this.uri);
    const definition = findParticleDefinitions(text).find(
      (candidate) => candidate.name.toLowerCase() === this.name.toLowerCase(),
    );

    return definition && { definition, text };
  }

  private async apply(): Promise<void> {
    const root = await this.rootDefinition();

    if (!root || !this.values.size) {
      return;
    }

    const edit = new vscode.WorkspaceEdit();

    for (const change of valueEdits(root.definition, this.values)) {
      edit.replace(
        this.uri,
        new vscode.Range(change.line, change.start, change.line, change.end),
        change.text,
      );
    }
    this.values.clear();
    await vscode.workspace.applyEdit(edit);
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

  /** Finds a referenced definition: this file first, then everything indexed */
  private async lookUp(
    name: string,
    keywords: string[],
    localText: string,
  ): Promise<IniDefinition | undefined> {
    const local = findParticleDefinitions(localText).find(
      (definition) =>
        definition.name.toLowerCase() === name.toLowerCase() &&
        keywords.includes(definition.keyword),
    );

    if (local) {
      return local;
    }
    for (const keyword of keywords) {
      for (const place of this.index.findDefinitions(keyword, name)) {
        const found = findParticleDefinitions(await readText(place.uri)).find(
          (definition) =>
            definition.keyword === keyword &&
            definition.name.toLowerCase() === name.toLowerCase(),
        );

        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }

  private texture(name: string): Promise<string | null> {
    const key = name.toLowerCase();
    let entry = this.textures.get(key);

    if (!entry) {
      entry = (async () => {
        if (!this.locator) {
          return null;
        }
        for (const candidate of [name.replace(/\.[^.]*$/, '.dds'), name]) {
          const bytes = await this.locator.read(candidate, this.uri);

          if (bytes) {
            const image = (
              /\.dds$/i.test(candidate) ? decodeDds(bytes) : decodeTga(bytes)
            ).levels[0];

            return `data:image/png;base64,${Buffer.from(encodePng(image)).toString('base64')}`;
          }
        }
        return null;
      })().catch(() => null);
      this.textures.set(key, entry);
    }
    return entry;
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
    const text = applyValueEdits(
      root.text,
      valueEdits(root.definition, this.values),
    );
    const definition = findParticleDefinitions(text).find(
      (candidate) => candidate.startLine === root.definition.startLine,
    )!;
    const systems: Record<string, ParticleDef> = {};
    const fxLists: Record<string, FxListDef> = {};
    const notes = new Set<string>();
    const queue: { name: string; list: boolean }[] = [];
    const visit = (def: ParticleDef | FxListDef) => {
      const { systems: names, fxLists: lists } = referencedNames(def);

      names.forEach((name) => queue.push({ name, list: false }));
      lists.forEach((name) => queue.push({ name, list: true }));
    };

    if (definition.keyword === 'FXList') {
      const list = readFxList(definition);

      fxLists[list.name.toLowerCase()] = list;
      visit(list);
    } else {
      const def = readParticleDef(definition);

      systems[def.name.toLowerCase()] = def;
      visit(def);
    }

    for (let count = 0; queue.length && count < MAX_REFERENCES; count++) {
      const next = queue.shift()!;
      const table = next.list ? fxLists : systems;

      if (table[next.name.toLowerCase()]) {
        continue;
      }

      // Reading (i) of particles.md §2c: the block form wins over the flat
      const found = await this.lookUp(
        next.name,
        next.list ? ['FXList'] : ['FXParticleSystem', 'ParticleSystem'],
        text,
      );

      if (!found) {
        notes.add(
          `${next.list ? 'FX list' : 'Particle system'} ${next.name} was not found`,
        );
        continue;
      }

      const def = next.list ? readFxList(found) : readParticleDef(found);

      table[next.name.toLowerCase()] = def as ParticleDef & FxListDef;
      visit(def);
    }

    for (const list of Object.values(fxLists)) {
      if (list.skipped.length) {
        notes.add(
          `${list.name}: ${list.skipped.join(', ')} not previewed; only ParticleSystem nuggets play`,
        );
      }
    }

    const textures: Record<string, string | null> = {};

    for (const def of Object.values(systems)) {
      if (def.type === 'DRAWABLE') {
        notes.add(
          `${def.name} draws the model ${def.particleName ?? '?'}; shown as markers`,
        );
        continue;
      }
      if (def.type === 'STREAK') {
        notes.add(`${def.name} is a streak; shown as sprites`);
      }
      if (def.volume.type === 'unread') {
        notes.add(
          `${def.name}: ${def.volume.module} emits from its centre here`,
        );
      }
      if (def.particleName) {
        const texture = await this.texture(def.particleName);

        textures[def.particleName.toLowerCase()] = texture;
        if (!texture) {
          notes.add(
            `Texture ${def.particleName} was not found; a soft dot stands in`,
          );
        }
      }
    }

    await this.panel.webview.postMessage({
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
      notes: [...notes],
      fields: numericFields(root.definition),
      values: Object.fromEntries(this.values),
    });
    this.restartNext = false;
  }

  private renderHtml(script: vscode.Uri): string {
    const nonce = createNonce();
    const source = this.panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${source};">
<style nonce="${nonce}">
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
  .field input[type=range] { width: 100%; }
  #notes div { opacity: 0.8; margin: 2px 0; }
  #notice { color: var(--vscode-errorForeground); }
  .muted { opacity: 0.7; }
  kbd { font-size: 10px; opacity: 0.7; }
</style></head><body>
<div id="layout">
  <div id="view"><canvas id="canvas"></canvas><div id="hud"></div></div>
  <div id="side">
    <div class="row"><strong id="title"></strong></div>
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
      Sky <select id="sky"><option value="#1b1c1f">dark</option><option value="#7a8ea6">day</option><option value="#000000">black</option><option value="#c8c8c8">light</option></select>
    </div>
    <h3>Readings <span class="muted">where the game's rule is open</span></h3>
    <div class="row">Wind <select id="wind" title="W"><option value="retail">as written</option><option value="doubled">doubled</option><option value="off">off</option></select></div>
    <div class="row">Hollow box <select id="hollowBox" title="H"><option value="surface">surface</option><option value="point">point (EA release)</option></select></div>
    <div class="row">
      <label><input type="checkbox" id="compound" checked> Attached systems and events</label>
      <label><input type="checkbox" id="batchLimit" checked> 512 per system</label>
    </div>
    <div class="row muted"><kbd>Space</kbd> play · <kbd>R</kbd> restart · <kbd>.</kbd> step · <kbd>W</kbd> wind · <kbd>H</kbd> hollow box · drag to orbit, right-drag to pan, wheel to zoom</div>
    <div id="notice"></div>
    <div id="notes"></div>
    <h3>Values <span class="muted">preview only until applied</span></h3>
    <div class="row"><button id="apply" class="primary" disabled>Apply to INI</button><button id="reset" disabled>Reset</button></div>
    <div id="fields"></div>
  </div>
</div>
<script nonce="${nonce}" src="${script}"></script>
<script nonce="${nonce}">${PARTICLE_VIEW_SCRIPT}</script>
</body></html>`;
  }
}

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
      ParticlePreview.show(context, index, locator, uri, name);
    },
  ),
];
