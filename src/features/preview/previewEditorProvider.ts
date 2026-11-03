import * as vscode from 'vscode';
import { PREVIEW_VIEW_TYPE } from '../../constants';
import type { ToolBox } from '../../core/toolRegistry';
import {
  decodeDdsTool,
  decodeTgaTool,
} from '../../formats/texture/textureTools';
import { playableAudioTool } from '../../formats/audio/audioTools';
import { buildW3dScene, loadSkeleton } from '../../formats/w3d/w3dScene';
import { decodePng } from '../../node/png';
import { parseW3dAnimations } from '../../formats/w3d/w3dAnimation';
import {
  findAnimationCarrier,
  sortClipsBySkeleton,
} from '../../formats/w3d/w3dModelFinder';
import type { SkeletonClips } from '../../formats/w3d/w3dModelFinder';
import type { SceneSkeleton } from '../../formats/w3d/w3dScene';
import { decompressEar, isEarWrapped } from '../../formats/refpack/refpack';
import { parseCursorFile } from '../../formats/cursor/parseCursorFile';
import { Vp6Movie } from '../../formats/vp6/container';
import type { EntryLocator } from '../../services/entryLocator';
import type { TextureRegions } from './createTextureRegions';
import { renderWebviewPage } from '../../platform/webview/webviewPage';
import type {
  FromPreviewPage,
  ToPreviewPage,
} from '../../webview/preview/protocol';
import { describeError } from '../../core/errors';

/** Gets a file's name, lowercased, as the INI files are matched against it */
const getFileName = (uri: vscode.Uri) =>
  uri.path.slice(uri.path.lastIndexOf('/') + 1).toLowerCase();

/**
 * Read-only editor that previews the binary entries a text editor cannot
 * show: TGA and DDS textures, drawn on a canvas with zoom, channel and mip
 * controls, WAV sounds, played after IMA ADPCM is decoded, which VS Code's own
 * audio preview cannot play, VP6 movies, and W3D models, drawn in 3D with their
 * skeleton and textures found wherever they live. It opens files inside
 * archives and loose on disk alike,
 * since it only reads bytes through `workspace.fs`.
 */


/** What the page is sent to draw or play for the file */
type PreviewMessage = Extract<
  ToPreviewPage,
  {
    kind: 'texture' | 'audio' | 'video' | 'cursor' | 'model' | 'error';
  }
>;

/** Decodes an entry into what its preview shows, by its extension */
const buildMessage = async (
  uri: vscode.Uri,
  tools: ToolBox,
  locator: EntryLocator,
  openMovie: (movie: Vp6Movie) => void,
): Promise<PreviewMessage> => {
  const extension = uri.path.slice(uri.path.lastIndexOf('.')).toLowerCase();

  try {
    const read = await vscode.workspace.fs.readFile(uri);
    // Retail files are sometimes RefPack-compressed in an EAR wrapper
    const bytes = isEarWrapped(read) ? decompressEar(read) : read;

    switch (extension) {
      case '.tga':
        return { kind: 'texture', ...(await tools.use(decodeTgaTool)(bytes)) };
      case '.dds':
        return { kind: 'texture', ...(await tools.use(decodeDdsTool)(bytes)) };
      case '.wav':
        return {
          kind: 'audio',
          ...(await tools.use(playableAudioTool)(bytes)),
        };
      case '.cur':
      case '.ani':
        return {
          kind: 'cursor',
          ...parseCursorFile(bytes, { decodePng }),
        };
      case '.vp6': {
        const movie = new Vp6Movie(bytes);

        openMovie(movie);

        return {
          kind: 'video',
          width: movie.header.width,
          height: movie.header.height,
          frameCount: movie.frameCount,
          framesPerSecond: movie.framesPerSecond,
          hasAlpha: movie.hasAlpha,
        };
      }
      case '.w3d': {
        const loadFile = (fileName: string) => locator.read(fileName, uri);
        const scene = await buildW3dScene(bytes, loadFile, tools, decodePng);

        // An animation alone is bones: play it on the model drawn on them,
        // the one an object's INI plays it on, else found by the skeleton
        if (!scene.meshes.length && scene.animation && scene.skeleton) {
          const fromIni = await vscode.commands
            .executeCommand<
              string | undefined
            >('bigfs.findModelForAnimation', getFileName(uri))
            .then(
              (found) => found,
              () => undefined,
            );
          const carrier = await findAnimationCarrier(
            scene.skeleton.name,
            fromIni && `${fromIni.replace(/\.w3d$/i, '')}.w3d`,
            () =>
              locator.findNames(
                (name) => name.endsWith('.w3d'),
                '**/*.{w3d,W3D}',
              ),
            loadFile,
            tools,
          );

          return {
            kind: 'model',
            ...(carrier.scene ?? scene),
            animation: scene.animation,
            animationSkeleton: scene.skeleton,
            shownOn: carrier.scene && carrier.name,
          };
        }
        return { kind: 'model', ...scene };
      }
      default:
        return { kind: 'error', message: `No preview for ${extension} files` };
    }
  } catch (error) {
    return {
      kind: 'error',
      message: describeError(error),
    };
  }
};

/** Renders the preview page: a toolbar, a canvas or an audio element, and a status line */
export const renderHtml = (
  webview: vscode.Webview,
  modelScript: vscode.Uri,
): string =>
  renderWebviewPage({
    allow: {
      img: 'blob: data:',
      media: 'blob:',
      script: webview.cspSource,
    },
    styleSources: `${webview.cspSource} 'unsafe-inline'`,
    scriptFiles: [webview.asWebviewUri(modelScript).toString()],
    style: `
  body { margin: 0; padding: 0; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  header { position: sticky; top: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 12px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); z-index: 1; }
  header[hidden] { display: none; }
  button, select { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; padding: 3px 8px; border-radius: 2px; font: inherit; cursor: pointer; }
  button[aria-pressed="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .status { margin-left: auto; opacity: 0.8; }
  .content { display: flex; align-items: flex-start; }
  main { flex: 1; min-width: 0; padding: 12px; }
  aside { flex: none; width: 260px; box-sizing: border-box; padding: 12px; max-height: calc(100vh - 44px); overflow-y: auto; position: sticky; top: 44px; border-left: 1px solid var(--vscode-panel-border); }
  aside[hidden], .splitter[hidden] { display: none; }
  body.model-page { height: 100vh; overflow: hidden; }
  body.model-page .content { height: 100%; }
  body.model-page main { height: 100%; padding: 0; }
  body.texture-page { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  body.texture-page header { flex: none; position: static; }
  body.texture-page .content { flex: 1; min-height: 0; align-items: stretch; }
  body.texture-page main { overflow: auto; }
  body.texture-page aside { max-height: none; position: static; border-left: none; }
  .splitter { flex: none; width: 4px; cursor: col-resize; background: var(--vscode-panel-border); touch-action: none; }
  .splitter:hover { background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder)); }
  aside h3, aside h4 { margin: 0 0 6px; }
  aside h4 { margin-top: 10px; opacity: 0.8; }
  aside .detail { margin-bottom: 8px; }
  aside .detail p { margin: 6px 0; opacity: 0.8; }
  aside .edges { display: grid; grid-template-columns: max-content 1fr; gap: 4px 8px; margin-top: 6px; }
  aside input { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px; }
  aside .item { display: block; width: 100%; text-align: left; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stage { display: inline-block; line-height: 0; position: relative; }
  .stage.checker { background: repeating-conic-gradient(#808080 0 25%, #c0c0c0 0 50%) 0 0 / 16px 16px; }
  .stage.black { background: #000; }
  .stage.white { background: #fff; }
  canvas.pixelated { image-rendering: pixelated; }
  .error { color: var(--vscode-errorForeground); }
  audio { width: min(600px, 100%); margin-top: 12px; }
  canvas.video { display: block; max-width: 100%; image-rendering: auto; }
  canvas.video.checker { background: repeating-conic-gradient(#808080 0 25%, #c0c0c0 0 50%) 0 0 / 16px 16px; }
  .controls { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  .controls input[type=range] { flex: 1; min-width: 120px; }
  dl { display: grid; grid-template-columns: max-content auto; gap: 4px 16px; margin: 0; }
  dt { opacity: 0.8; }
`,
    body: `<header id="toolbar" hidden>
  <button id="fit" aria-pressed="true" title="Fit to window">Fit</button>
  <button id="actual" aria-pressed="false" title="Actual size">1:1</button>
  <button id="zoom-out" title="Zoom out">−</button>
  <button id="zoom-in" title="Zoom in">+</button>
  <select id="channels" title="Channels">
    <option value="rgba">RGBA</option>
    <option value="rgb">RGB</option>
    <option value="alpha">Alpha</option>
  </select>
  <select id="background" title="Background">
    <option value="checker">Checker</option>
    <option value="black">Black</option>
    <option value="white">White</option>
  </select>
  <select id="level" title="Mip level"></select>
  <button id="popout" title="Open this editor in its own window, with more room for the texture and its references">Pop out</button>
  <span class="status" id="status"></span>
</header>
<div class="content">
  <main id="main"></main>
  <aside id="regions" hidden></aside>
</div>`,
  });

/** Custom editor provider behind `bigfs.preview` */
export class PreviewEditorProvider
  implements vscode.CustomReadonlyEditorProvider
{
  public constructor(
    private readonly tools: ToolBox,
    private readonly locator: EntryLocator,
    private readonly extensionUri: vscode.Uri,
    private readonly regions: TextureRegions,
  ) {}

  /** Registers the provider under `PREVIEW_VIEW_TYPE` */
  public static register(
    tools: ToolBox,
    locator: EntryLocator,
    extensionUri: vscode.Uri,
    regions: TextureRegions,
  ): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      PREVIEW_VIEW_TYPE,
      new PreviewEditorProvider(tools, locator, extensionUri, regions),
      { supportsMultipleEditorsPerDocument: true },
    );
  }

  /**
   * Finds the animations of a skeleton: for `GUArcher_SKL`, every
   * `guarcher_*.w3d` but the skeleton itself, sorted by the skeleton each names
   */
  private async findAnimations(
    skeleton: SceneSkeleton,
    uri: vscode.Uri,
  ): Promise<SkeletonClips> {
    const name = skeleton.name.toLowerCase();
    const prefix = `${name.replace(/_skl$/, '')}_`;
    const names = await this.locator.findNames(
      (each) =>
        each.startsWith(prefix) &&
        each.endsWith('.w3d') &&
        each !== `${name}.w3d`,
      '**/*.{w3d,W3D}',
    );

    return sortClipsBySkeleton(
      skeleton,
      names,
      (fileName) => this.locator.read(fileName, uri),
      this.tools,
    );
  }

  /** Opens a file as a document that holds only its URI; the bytes are read when it is shown */
  public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  /** Decodes the file and sends it to the page once the page is ready */
  public async resolveCustomEditor(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const scripts = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [scripts],
    };
    panel.webview.html = renderHtml(
      panel.webview,
      vscode.Uri.joinPath(scripts, 'model.js'),
    );

    // Decoding starts at once; the page asks for the result when its script
    // has loaded, so the message cannot arrive before anything listens
    let movie: Vp6Movie | undefined;
    let attached: vscode.Disposable | undefined;
    const message = buildMessage(
      document.uri,
      this.tools,
      this.locator,
      (opened) => {
        movie = opened;
      },
    );
    const subscription = panel.webview.onDidReceiveMessage(
      async (received: FromPreviewPage) => {
        if (received.kind === 'ready') {
          const built = await message;

          await panel.webview.postMessage(built);

          // A page VS Code rebuilds, as when the editor moves to another
          // window, asks again; the old page no longer listens
          attached?.dispose();
          if (built.kind === 'texture' && built.levels[0]) {
            attached = this.regions.attach(
              document.uri,
              [built.levels[0].width, built.levels[0].height],
              (regionsMessage) => void panel.webview.postMessage(regionsMessage),
            );
          }
          if (built.kind === 'model' && built.skeleton) {
            await panel.webview.postMessage({
              kind: 'animations',
              ...(await this.findAnimations(built.skeleton, document.uri)),
            });
          }
          if (built.kind === 'model') {
            await panel.webview.postMessage({
              kind: 'uses',
              uses: await vscode.commands
                .executeCommand<
                  unknown[]
                >('bigfs.findFileUses', getFileName(document.uri))
                .then(
                  (uses) => uses ?? [],
                  () => [],
                ),
            });
          }
        } else if (received.kind === 'popOut') {
          // The command moves the active editor, which the press made this one
          if (!panel.active) {
            panel.reveal();
          }
          await vscode.commands.executeCommand(
            'workbench.action.moveEditorToNewWindow',
          );
        } else if (received.kind === 'editRegion') {
          await this.regions.edit(document.uri, received.id, received.rect);
        } else if (received.kind === 'reveal') {
          const position = new vscode.Position(received.line || 0, 0);

          await vscode.window.showTextDocument(vscode.Uri.parse(received.uri), {
            selection: new vscode.Range(position, position),
          });
        } else if (received.kind === 'videoFrame' && movie) {
          const index = received.index;

          try {
            const pixels = movie.decodeFrame(index);

            await panel.webview.postMessage({
              kind: 'videoFrame',
              index,
              pixels: new Uint8Array(pixels.buffer),
            });
          } catch (error) {
            await panel.webview.postMessage({
              kind: 'videoError',
              message: describeError(error),
            });
          }
        } else if (received.kind === 'animation') {
          const name = received.file;
          let reply: ToPreviewPage;

          try {
            const bytes = await this.locator.read(name, document.uri);
            const [animation] = bytes ? parseW3dAnimations(bytes) : [];

            reply = animation
              ? {
                  kind: 'animation',
                  file: name,
                  animation,
                  skeleton: await loadSkeleton(
                    animation.hierarchyName,
                    (fileName) => this.locator.read(fileName, document.uri),
                    this.tools,
                  ),
                }
              : {
                  kind: 'animationError',
                  message: `${name} holds no animation`,
                };
          } catch (error) {
            reply = {
              kind: 'animationError',
              message: describeError(error),
            };
          }

          await panel.webview.postMessage(reply);
        }
      },
    );

    panel.onDidDispose(() => {
      subscription.dispose();
      attached?.dispose();
    });
  }
}
