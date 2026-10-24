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
import { decodeBlock, printListing } from '../formats/apt/aptBytecode';
import { getTexturePath, parseDat, parseRu } from '../formats/apt/aptGeometry';
import type { RuRun } from '../formats/apt/aptGeometry';
import { APT_VIEW_SCRIPT } from './aptViewScript';

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

/** Everything a movie is read from, kept so a script listing can be decoded later */
interface LoadedMovie {
  apt: Uint8Array;
  constFile: ConstFile;
}

/** Reads a file, or nothing when it is not there */
const tryRead = async (uri: vscode.Uri): Promise<Uint8Array | undefined> => {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
};

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** Loads a movie and everything it draws with */
const loadMovie = async (
  uri: vscode.Uri,
  tools: ToolBox,
  locator: EntryLocator,
): Promise<[LoadedMovie, MovieMessage]> => {
  const folder = vscode.Uri.joinPath(uri, '..');
  const fileName = uri.path.slice(uri.path.lastIndexOf('/') + 1);
  const name = fileName.replace(/\.apt$/i, '');
  const read = async (relative: string) =>
    (await tryRead(vscode.Uri.joinPath(folder, relative))) ??
    (await locator.read(relative.slice(relative.lastIndexOf('/') + 1), uri));

  const apt = await vscode.workspace.fs.readFile(uri);
  const constBytes = await read(`${name}.const`);

  if (!constBytes) {
    throw new Error(`${name}.const is not beside the movie`);
  }

  const constFile = parseConst(constBytes);
  const movie = parseAptMovie(apt, constFile.movieOffset);
  const datBytes = await read(`${name}.dat`);
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
          const ru = await read(`${name}_geometry/${character.geometry}.ru`);

          shapes[character.id] = ru ? parseRu(latin1(ru)) : [];

          if (!ru) {
            problems.push(`geometry of shape #${character.id}`);
          }
        } else if (character.type === 'image') {
          const location = dat.get(character.texture);

          if (location) {
            imageTextures[character.id] = getTexturePath(
              name,
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
    const bytes = await read(path);

    if (!bytes) {
      problems.push(`texture ${path}`);
      continue;
    }

    try {
      const { levels } = await tools.use(decodeTgaTool)(bytes);

      textures[path] = levels[0];
    } catch (error) {
      problems.push(
        `${path}: ${error instanceof Error ? error.message : error}`,
      );
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

  return [
    { apt, constFile },
    {
      kind: 'movie',
      summary,
      movie: { ...movie, spriteFrames, shapes, imageTextures },
      textures,
    },
  ];
};

/** A random token the page's one script carries */
const createNonce = (): string =>
  Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 36).toString(36),
  ).join('');

/** The page: character list, stage and details, around the page script */
export const renderHtml = (webview: vscode.Webview): string => {
  const nonce = createNonce();

  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src blob: data:;">
<style>
  body { margin: 0; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); display: grid; grid-template-columns: 260px 1fr 340px; height: 100vh; }
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
<script nonce="${nonce}">${APT_VIEW_SCRIPT}</script>
</body>
</html>`;
};

/** Custom editor provider behind `bigfs.aptEditor` */
export class AptEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public constructor(
    private readonly tools: ToolBox,
    private readonly locator: EntryLocator,
  ) {}

  /** Registers the provider under `APT_VIEW_TYPE` */
  public static register(
    tools: ToolBox,
    locator: EntryLocator,
  ): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      APT_VIEW_TYPE,
      new AptEditorProvider(tools, locator),
      { webviewOptions: { retainContextWhenHidden: true } },
    );
  }

  public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  public async resolveCustomEditor(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    panel.webview.options = { enableScripts: true };
    panel.webview.html = renderHtml(panel.webview);

    const loading = loadMovie(document.uri, this.tools, this.locator);

    const subscription = panel.webview.onDidReceiveMessage(async (message) => {
      try {
        if (message?.kind === 'ready') {
          await panel.webview.postMessage((await loading)[1]);
        } else if (message?.kind === 'listing') {
          const [{ apt, constFile }] = await loading;
          const block = Number(message.block);
          let text: string;

          try {
            text = printListing(decodeBlock(apt, block), constFile.items);
          } catch (error) {
            text = `Cannot decode: ${error instanceof Error ? error.message : error}`;
          }

          await panel.webview.postMessage({ kind: 'listing', block, text });
        }
      } catch (error) {
        await panel.webview.postMessage({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    panel.onDidDispose(() => subscription.dispose());
  }
}
