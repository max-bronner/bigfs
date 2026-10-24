import * as vscode from 'vscode';
import type { ToolBox } from '../tools/toolRegistry';
import { decodeTgaTool } from '../tools/textureTools';
import type { EntryLocator } from '../formats/entryLocator';
import {
  parseAptMovie,
  parseConst,
  parseSpriteFrames,
} from '../formats/apt/aptMovie';
import type { AptMovie, ConstFile, Frame } from '../formats/apt/aptMovie';
import { AptImage, applyAptEdit } from '../formats/apt/aptWriter';
import type { AptEdit, EditResult } from '../formats/apt/aptWriter';
import {
  appendConstItems,
  decompileBlock,
  replaceBlock,
} from '../formats/apt/aptScript';
import { getTexturePath, parseDat, parseRu } from '../formats/apt/aptGeometry';
import type { RuRun } from '../formats/apt/aptGeometry';
import { APT_VIEW_SCRIPT } from './aptViewScript';
import { createNonce } from './webviewNonce';
import { decodeWindows1252 } from '../common/windows1252';

/**
 * Custom editor for `.apt` movies: a list of every character, a stage that
 * draws the selected one (shapes with their textures, sprites at any frame,
 * text fields, buttons in their up state), and its fields and scripts.
 *
 * A movie spans files: the `.const` beside the `.apt` locates the Movie
 * record, the `.dat` names each image's texture, and every shape's triangles
 * are in `<name>_geometry/<n>.ru`. They are read from the `.apt`'s own folder,
 * which in a shipped `apt/*.big` is the archive's root, and textures from
 * `art/textures/` below it.
 */

/** View type `package.json` registers the editor under */
export const APT_VIEW_TYPE = 'bigfs.aptEditor';

/** What the page is sent: the movie, the geometry and textures it draws with */
interface MovieMessage {
  kind: 'movie';
  summary: string;
  movie: AptMovie & {
    spriteFrames: Record<number, Frame[]>;
    shapes: Record<number, RuRun[]>;
    /** Image character id to the texture path its pixels are in */
    imageTextures: Record<number, string>;
  };
  textures: Record<
    string,
    { width: number; height: number; pixels: Uint8Array }
  >;
}

/** Reads a file, or nothing when it is not there */
const tryRead = async (uri: vscode.Uri): Promise<Uint8Array | undefined> => {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
};

const latin1 = decodeWindows1252;

/** A movie's state an undo restores: its image, `.const` and added files */
interface Snapshot {
  apt: Uint8Array;
  constBytes: Uint8Array;
  files: Map<string, Uint8Array>;
}

/** Packs a snapshot into one file for a hot-exit backup, and back */
const packSnapshot = (snapshot: Snapshot): Uint8Array => {
  const parts: Uint8Array[] = [];
  const word = (value: number) =>
    parts.push(new Uint8Array(new Uint32Array([value]).buffer));
  const blob = (bytes: Uint8Array) => {
    word(bytes.length);
    parts.push(bytes);
  };

  blob(snapshot.apt);
  blob(snapshot.constBytes);
  word(snapshot.files.size);
  for (const [name, bytes] of snapshot.files) {
    blob(new TextEncoder().encode(name));
    blob(bytes);
  }

  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};

const unpackSnapshot = (bytes: Uint8Array): Snapshot => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const word = () => {
    const value = view.getUint32(at, true);

    at += 4;

    return value;
  };
  const blob = () => {
    const length = word();

    if (at + length > bytes.length) {
      throw new Error('The backup is cut short');
    }

    at += length;

    return bytes.slice(at - length, at);
  };
  const apt = blob();
  const constBytes = blob();
  const files = new Map<string, Uint8Array>();

  for (let count = word(); count > 0; count--) {
    files.set(new TextDecoder().decode(blob()), blob());
  }

  return { apt, constBytes, files };
};

/**
 * One open movie: the `.apt` image being edited, the files beside it, and
 * what was decoded from them, kept so an edit redraws without reading or
 * decoding a texture again
 */
export class AptDocument implements vscode.CustomDocument {
  /** The image as edited; saving writes it */
  public image: AptImage;

  /** Files an edit adds beside the movie, by path relative to its folder */
  public files = new Map<string, Uint8Array>();

  /** The `.const` as edited; a script edit can add items to it */
  private constBytes: Uint8Array;
  private readonly savedConst: Uint8Array;
  private parsedConst: ConstFile;

  private readonly read: (relative: string) => Promise<Uint8Array | undefined>;
  private readonly cache = new Map<string, Promise<Uint8Array | undefined>>();
  private readonly textures = new Map<
    string,
    MovieMessage['textures'][string] | undefined
  >();

  private constructor(
    public readonly uri: vscode.Uri,
    apt: Uint8Array,
    constBytes: Uint8Array,
    public readonly name: string,
    locator: EntryLocator,
    private readonly tools: ToolBox,
  ) {
    const folder = vscode.Uri.joinPath(uri, '..');

    this.image = new AptImage(apt);
    this.constBytes = constBytes;
    this.savedConst = constBytes;
    this.parsedConst = parseConst(constBytes);
    this.read = (relative) =>
      this.files.has(relative)
        ? Promise.resolve(this.files.get(relative))
        : this.cached(
            relative,
            async () =>
              (await tryRead(vscode.Uri.joinPath(folder, relative))) ??
              (await locator.read(
                relative.slice(relative.lastIndexOf('/') + 1),
                uri,
              )),
          );
  }

  /** Reads a movie and its `.const`, which is the least it opens with */
  public static async open(
    uri: vscode.Uri,
    locator: EntryLocator,
    tools: ToolBox,
  ): Promise<AptDocument> {
    const name = uri.path
      .slice(uri.path.lastIndexOf('/') + 1)
      .replace(/\.apt$/i, '');
    const apt = await vscode.workspace.fs.readFile(uri);
    const constUri = vscode.Uri.joinPath(uri, '..', `${name}.const`);
    const constBytes =
      (await tryRead(constUri)) ?? (await locator.read(`${name}.const`, uri));

    if (!constBytes) {
      throw new Error(`${name}.const is not beside the movie`);
    }

    return new AptDocument(uri, apt, constBytes, name, locator, tools);
  }

  /** The `.const` as it now stands */
  public get constFile(): ConstFile {
    return this.parsedConst;
  }

  /** Adds `.const` items a compiled script needs */
  public addConstItems(items: ConstFile['items']): void {
    if (items.length) {
      this.constBytes = appendConstItems(this.constBytes, items);
      this.parsedConst = parseConst(this.constBytes);
    }
  }

  public backup(): Uint8Array {
    return packSnapshot(this.snapshot());
  }

  public restoreBackup(bytes: Uint8Array): void {
    this.restore(unpackSnapshot(bytes));
  }

  public dispose(): void {
    this.cache.clear();
  }

  private cached(
    key: string,
    load: () => Promise<Uint8Array | undefined>,
  ): Promise<Uint8Array | undefined> {
    let entry = this.cache.get(key);

    if (!entry) {
      entry = load();
      this.cache.set(key, entry);
    }

    return entry;
  }

  /** Reads a file beside the movie, an added one first */
  public readBeside(relative: string): Promise<Uint8Array | undefined> {
    return this.read(relative);
  }

  public snapshot(): Snapshot {
    return {
      apt: this.image.bytes,
      constBytes: this.constBytes,
      files: new Map(this.files),
    };
  }

  public restore(snapshot: Snapshot): void {
    this.image = new AptImage(snapshot.apt);
    this.constBytes = snapshot.constBytes;
    this.parsedConst = parseConst(snapshot.constBytes);
    this.files = new Map(snapshot.files);
  }

  /** Decodes a texture once, however often the movie is redrawn */
  private async texture(path: string, problems: string[]) {
    if (!this.textures.has(path)) {
      const bytes = await this.read(path);
      let texture: MovieMessage['textures'][string] | undefined;

      if (bytes) {
        try {
          texture = (await this.tools.use(decodeTgaTool)(bytes)).levels[0];
        } catch (error) {
          problems.push(
            `${path}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }

      this.textures.set(path, texture);
    }

    const texture = this.textures.get(path);

    if (!texture) {
      problems.push(`texture ${path}`);
    }

    return texture;
  }

  /**
   * Parses the movie as it now stands into what the page draws. Textures
   * already sent are left out; the page keeps them.
   */
  public async buildMessage(sentTextures: Set<string>): Promise<MovieMessage> {
    const apt = this.image.bytes;
    const movie = parseAptMovie(apt, this.constFile.movieOffset);
    const datBytes = await this.read(`${this.name}.dat`);
    const dat = datBytes ? parseDat(latin1(datBytes)) : new Map();
    const spriteFrames: Record<number, Frame[]> = {};
    const shapes: Record<number, RuRun[]> = {};
    const imageTextures: Record<number, string> = {};
    const problems: string[] = [];

    await Promise.all(
      movie.characters.map(async (character) => {
        try {
          if (character.type === 'sprite') {
            spriteFrames[character.id] = parseSpriteFrames(apt, character);
          } else if (character.type === 'shape') {
            const ru = await this.read(
              `${this.name}_geometry/${character.geometry}.ru`,
            );

            shapes[character.id] = ru ? parseRu(latin1(ru)) : [];

            if (!ru) {
              problems.push(`geometry of shape #${character.id}`);
            }
          } else if (character.type === 'image') {
            const location = dat.get(character.texture);

            if (location) {
              imageTextures[character.id] = getTexturePath(
                this.name,
                character.texture,
                location,
              );
            }
          }
        } catch (error) {
          problems.push(
            `#${character.id}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }),
    );

    const textures: MovieMessage['textures'] = {};

    for (const path of new Set(Object.values(imageTextures))) {
      const texture = await this.texture(path, problems);

      if (texture && !sentTextures.has(path)) {
        textures[path] = texture;
        sentTextures.add(path);
      }
    }

    const counts = new Map<string, number>();

    movie.characters.forEach((character) =>
      counts.set(character.type, (counts.get(character.type) ?? 0) + 1),
    );

    const summary = [
      `${movie.record.screenWidth}×${movie.record.screenHeight}`,
      `${movie.characters.length} characters (${[...counts].map(([type, count]) => `${count} ${type}`).join(', ')})`,
      `${movie.imports.length} imports, ${movie.exports.length} exports`,
      problems.length
        ? `not found: ${problems.slice(0, 6).join('; ')}${problems.length > 6 ? '…' : ''}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return {
      kind: 'movie',
      summary,
      movie: { ...movie, spriteFrames, shapes, imageTextures },
      textures,
    };
  }

  /** Writes the movie, and the files edits added, to `target`'s folder */
  public async save(target: vscode.Uri = this.uri): Promise<void> {
    const folder = vscode.Uri.joinPath(target, '..');

    await vscode.workspace.fs.writeFile(target, this.image.bytes);

    // A movie saved elsewhere takes its .const along; in place, only a changed one is written
    if (
      target.toString() !== this.uri.toString() ||
      this.constBytes !== this.savedConst
    ) {
      const stem = target.path
        .slice(target.path.lastIndexOf('/') + 1)
        .replace(/\.apt$/i, '');

      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(folder, `${stem}.const`),
        this.constBytes,
      );
    }

    for (const [relative, bytes] of this.files) {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(folder, relative),
        bytes,
      );
    }
  }
}

/** The page: character list, stage and details, around the page script */
export const renderHtml = (webview: vscode.Webview): string => {
  const nonce = createNonce();

  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src blob: data:;">
<style>
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
  #details { border-left: 1px solid var(--vscode-panel-border); padding: 0 10px; }
  pre { white-space: pre-wrap; word-break: break-all; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .muted, #summary { opacity: 0.75; }
  .error { color: var(--vscode-errorForeground); padding: 12px; }
  #notice { position: fixed; bottom: 8px; left: 250px; right: 12px; z-index: 2; padding: 6px 10px; color: var(--vscode-inputValidation-errorForeground, inherit); background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
  .field { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin: 3px 0; }
  .field label { min-width: 84px; opacity: 0.8; }
  .field input, .field textarea { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px; width: 90px; font: inherit; }
  .field textarea { width: 100%; min-height: 3em; }
  .field input.short { width: 52px; }
  .field input.line { width: 160px; }
  textarea.code { width: 100%; box-sizing: border-box; font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 12px); color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); white-space: pre; tab-size: 2; }
  .field input.invalid { border-color: var(--vscode-inputValidation-errorBorder); }
  .field button, button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; padding: 2px 8px; border-radius: 2px; cursor: pointer; }
  select, input[type=range] { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); }
</style>
</head>
<body>
<aside><input id="filter" placeholder="Filter characters, exports, text"><div id="list"></div></aside>
<main>
  <div class="toolbar">
    <select id="zoom"><option value="fit">Fit</option><option value="0.5">50%</option><option value="1">100%</option><option value="2">200%</option></select>
    <input id="frame" type="range" min="0" max="0" value="0"> <span id="frame-label"></span>
  </div>
  <canvas id="stage"></canvas>
  <p id="summary"></p>
</main>
<section id="details"></section>
<div id="notice" hidden></div>
<script nonce="${nonce}">${APT_VIEW_SCRIPT}</script>
</body>
</html>`;
};

/** Custom editor provider behind `bigfs.aptEditor` */
export class AptEditorProvider implements vscode.CustomEditorProvider<AptDocument> {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<AptDocument>
  >();

  /** Fires for every edit, which is what makes the editor dirty and undoable */
  public readonly onDidChangeCustomDocument = this.onDidChangeEmitter.event;

  /** Redraws of each open document's page */
  private readonly redraws = new Map<AptDocument, () => Promise<void>>();

  /** Open documents by uri, for edits that do not come from the page */
  private readonly open = new Map<string, AptDocument>();

  /** Whether each open document's page has loaded and asked for its data */
  private readonly pagesReady = new Set<AptDocument>();

  public constructor(
    private readonly tools: ToolBox,
    private readonly locator: EntryLocator,
  ) {}

  /** Registers the provider under `APT_VIEW_TYPE` */
  public static register(
    tools: ToolBox,
    locator: EntryLocator,
  ): vscode.Disposable {
    const provider = new AptEditorProvider(tools, locator);

    return vscode.Disposable.from(
      vscode.window.registerCustomEditorProvider(APT_VIEW_TYPE, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }),
      // The same edit path the page uses, for automation and tests
      vscode.commands.registerCommand(
        'bigfs.aptApplyEdit',
        async (uri: vscode.Uri, edit?: AptEdit) => {
          const document = provider.open.get(uri.toString());

          if (!document) {
            throw new Error(`${uri.toString()} is not open in the APT editor`);
          }

          if (!edit) {
            return { pageReady: provider.pagesReady.has(document) };
          }

          const result = await provider.edit(document, edit);

          await provider.redraws.get(document)?.();
          return {
            ...result,
            pageReady: provider.pagesReady.has(document),
          };
        },
      ),
    );
  }

  public async openCustomDocument(
    uri: vscode.Uri,
    context: vscode.CustomDocumentOpenContext,
  ): Promise<AptDocument> {
    const document = await AptDocument.open(uri, this.locator, this.tools);

    if (context.backupId) {
      document.restoreBackup(
        await vscode.workspace.fs.readFile(vscode.Uri.parse(context.backupId)),
      );
    }

    return document;
  }

  public async saveCustomDocument(document: AptDocument): Promise<void> {
    await document.save();
  }

  public async saveCustomDocumentAs(
    document: AptDocument,
    destination: vscode.Uri,
  ): Promise<void> {
    await document.save(destination);
  }

  public async revertCustomDocument(document: AptDocument): Promise<void> {
    const fresh = await AptDocument.open(
      document.uri,
      this.locator,
      this.tools,
    );

    document.restore(fresh.snapshot());
    await this.redraws.get(document)?.();
  }

  public async backupCustomDocument(
    document: AptDocument,
    context: vscode.CustomDocumentBackupContext,
  ): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(context.destination, document.backup());

    return {
      id: context.destination.toString(),
      delete: () => vscode.workspace.fs.delete(context.destination),
    };
  }

  /**
   * Applies an edit the page sent, records how to undo it, and redraws.
   * Duplicating a shape also copies its geometry file under the new id.
   */
  private async edit(
    document: AptDocument,
    edit: AptEdit,
  ): Promise<EditResult> {
    return this.record(document, edit.kind, () => this.apply(document, edit));
  }

  /**
   * Compiles a script over the block at `block`. The old code stays where it
   * is, unreferenced; an undo points back at it.
   */
  private editScript(
    document: AptDocument,
    block: number,
    text: string,
  ): Promise<number> {
    return this.record(document, 'script', async () => {
      const { start, added } = replaceBlock(
        document.image,
        document.constFile.movieOffset,
        block,
        text,
        document.constFile.items,
      );

      document.addConstItems(added);

      return start;
    });
  }

  /** Runs a change, records how to undo it, and redraws */
  private async record<T>(
    document: AptDocument,
    label: string,
    change: () => Promise<T>,
  ): Promise<T> {
    const before = document.snapshot();
    let result: T;

    try {
      result = await change();
    } catch (error) {
      document.restore(before);
      throw error;
    }

    const after = document.snapshot();
    const redraw = () => this.redraws.get(document)?.() ?? Promise.resolve();

    this.onDidChangeEmitter.fire({
      document,
      label,
      undo: async () => {
        document.restore(before);
        await redraw();
      },
      redo: async () => {
        document.restore(after);
        await redraw();
      },
    });
    await redraw();

    return result;
  }

  /** Applies an edit; duplicating a shape also copies its geometry file */
  private async apply(
    document: AptDocument,
    edit: AptEdit,
  ): Promise<EditResult> {
    const before = document.snapshot();
    const source =
      edit.kind === 'duplicateCharacter'
        ? parseAptMovie(before.apt, document.constFile.movieOffset).characters[
            edit.id
          ]
        : undefined;
    const result = applyAptEdit(
      document.image,
      document.constFile.movieOffset,
      edit,
    );

    if (
      edit.kind === 'addCharacter' &&
      edit.type === 'shape' &&
      result.character !== undefined
    ) {
      document.files.set(
        `${document.name}_geometry/${result.character}.ru`,
        new TextEncoder().encode(
          'c\ns s:255:255:255:255\nt 0:0:100:0:0:100\nt 100:0:100:100:0:100\n',
        ),
      );
    }

    if (source?.type === 'shape' && result.character !== undefined) {
      const geometry = await document.readBeside(
        `${document.name}_geometry/${source.geometry}.ru`,
      );

      if (geometry) {
        document.files.set(
          `${document.name}_geometry/${result.character}.ru`,
          geometry,
        );
      }
    }

    return result;
  }

  public async resolveCustomEditor(
    document: AptDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    panel.webview.options = { enableScripts: true };
    panel.webview.html = renderHtml(panel.webview);

    const sentTextures = new Set<string>();
    const post = (message: unknown) => panel.webview.postMessage(message);
    const report = (error: unknown) =>
      post({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });

    this.redraws.set(document, async () => {
      await post(await document.buildMessage(sentTextures));
    });
    this.open.set(document.uri.toString(), document);

    const subscription = panel.webview.onDidReceiveMessage(async (message) => {
      try {
        if (message?.kind === 'ready') {
          this.pagesReady.add(document);
          await this.redraws.get(document)?.();
        } else if (message?.kind === 'script') {
          const block = Number(message.block);
          let script;

          try {
            script = decompileBlock(
              document.image.bytes,
              block,
              document.constFile.items,
            );
          } catch (error) {
            script = {
              text: `Cannot decode: ${error instanceof Error ? error.message : error}`,
              mode: 'listing',
            };
          }

          await post({ kind: 'script', block, ...script });
        } else if (message?.kind === 'edit') {
          const result = await this.edit(document, message.edit as AptEdit);

          if (result.character !== undefined) {
            await post({ kind: 'select', character: result.character });
          }
        } else if (message?.kind === 'scriptEdit') {
          const block = await this.editScript(
            document,
            Number(message.block),
            String(message.text),
          );

          await post({
            kind: 'scriptSaved',
            block,
            previous: Number(message.block),
          });
        } else if (message?.kind === 'openGeometry') {
          const relative = `${document.name}_geometry/${Number(message.geometry)}.ru`;

          await vscode.commands.executeCommand(
            'vscode.open',
            vscode.Uri.joinPath(document.uri, '..', relative),
          );
        }
      } catch (error) {
        await post({
          kind: 'notice',
          message: error instanceof Error ? error.message : String(error),
        });

        if (message?.kind === 'ready') {
          await report(error);
        }
      }
    });

    panel.onDidDispose(() => {
      subscription.dispose();
      this.redraws.delete(document);
      this.open.delete(document.uri.toString());
      this.pagesReady.delete(document);
    });
  }
}
