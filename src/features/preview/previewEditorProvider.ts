import * as vscode from 'vscode';
import { PREVIEW_VIEW_TYPE } from '../../constants';
import type { ToolBox } from '../../core/toolRegistry';
import {
  decodeDdsTool,
  decodeTgaTool,
} from '../../formats/texture/textureTools';
import { playableAudioTool } from '../../formats/audio/audioTools';
import { buildW3dScene } from '../../formats/w3d/w3dScene';
import { parseW3dAnimations } from '../../formats/w3d/w3dAnimation';
import { findModelForSkeleton } from '../../formats/w3d/w3dModelFinder';
import { decompressEar, isEarWrapped } from '../../formats/refpack/refpack';
import { Vp6Movie } from '../../formats/vp6/container';
import type { EntryLocator } from '../../services/entryLocator';
import { webviewPage } from '../../platform/webview/webviewPage';
import type {
  FromPreviewPage,
  ToPreviewPage,
} from '../../webview/preview/protocol';
import { describeError } from '../../core/errors';

/** Gets a file's name, lowercased, as the INI files are matched against it */
const basename = (uri: vscode.Uri) =>
  uri.path.slice(uri.path.lastIndexOf('/') + 1).toLowerCase();

/**
 * Read-only editor that previews the binary entries a text editor cannot
 * show: TGA and DDS textures, drawn on a canvas with zoom, channel and mip
 * controls, WAV and MP3 sounds, a WAV played after IMA ADPCM is decoded, VP6
 * movies, and W3D models, drawn in 3D with their skeleton and textures found
 * wherever they live. It opens files inside archives and loose on disk alike,
 * since it only reads bytes through `workspace.fs`.
 */


/** What the page is sent to draw or play for the file */
type PreviewMessage = Extract<
  ToPreviewPage,
  {
    kind: 'texture' | 'audio' | 'compressedAudio' | 'video' | 'model' | 'error';
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
      case '.mp3':
        return {
          kind: 'compressedAudio',
          bytes,
          mime: 'audio/mpeg',
          format: 'MP3',
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
        const scene = await buildW3dScene(bytes, loadFile, tools);

        // An animation alone is bones: play it on the model drawn on them,
        // the one an object's INI plays it on, else found by the skeleton
        if (!scene.meshes.length && scene.animation && scene.skeleton) {
          const fromIni = await vscode.commands
            .executeCommand<
              string | undefined
            >('bigfs.findModelForAnimation', basename(uri))
            .then(
              (found) => found,
              () => undefined,
            );
          const model =
            (fromIni && `${fromIni.replace(/\.w3d$/i, '')}.w3d`) ??
            (await findModelForSkeleton(
              scene.skeleton.name,
              await locator.findNames(
                (name) => name.endsWith('.w3d'),
                '**/*.{w3d,W3D}',
              ),
              loadFile,
              tools,
            ));
          const bytesOfModel = model && (await loadFile(model));

          if (bytesOfModel) {
            return {
              kind: 'model',
              ...(await buildW3dScene(bytesOfModel, loadFile, tools)),
              animation: scene.animation,
              shownOn: model,
            };
          }
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
  webviewPage({
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
  main { padding: 12px; }
  .stage { display: inline-block; line-height: 0; }
  .stage.checker { background: repeating-conic-gradient(#808080 0 25%, #c0c0c0 0 50%) 0 0 / 16px 16px; }
  .stage.black { background: #000; }
  .stage.white { background: #fff; }
  canvas.pixelated { image-rendering: pixelated; }
  .error { color: var(--vscode-errorForeground); }
  audio { width: min(600px, 100%); margin-top: 12px; }
  canvas.model { display: block; cursor: grab; touch-action: none; }
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
  <span class="status" id="status"></span>
</header>
<main id="main"></main>`,
  });

/** Custom editor provider behind `bigfs.preview` */
export class PreviewEditorProvider
  implements vscode.CustomReadonlyEditorProvider
{
  public constructor(
    private readonly tools: ToolBox,
    private readonly locator: EntryLocator,
    private readonly extensionUri: vscode.Uri,
  ) {}

  /** Registers the provider under `PREVIEW_VIEW_TYPE` */
  public static register(
    tools: ToolBox,
    locator: EntryLocator,
    extensionUri: vscode.Uri,
  ): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      PREVIEW_VIEW_TYPE,
      new PreviewEditorProvider(tools, locator, extensionUri),
      { supportsMultipleEditorsPerDocument: true },
    );
  }

  /**
   * Finds the files that look like animations of a skeleton: for `GUArcher_SKL`, every
   * `guarcher_*.w3d` but the skeleton itself
   */
  private findAnimations(skeleton: string): Promise<string[]> {
    const prefix = `${skeleton.toLowerCase().replace(/_skl$/, '')}_`;
    const own = `${skeleton.toLowerCase()}.w3d`;

    return this.locator.findNames(
      (name) =>
        name.startsWith(prefix) && name.endsWith('.w3d') && name !== own,
      '**/*.{w3d,W3D}',
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

          if (built.kind === 'model' && built.skeleton) {
            await panel.webview.postMessage({
              kind: 'animations',
              names: await this.findAnimations(built.skeleton.name),
            });
          }
          if (built.kind === 'model') {
            await panel.webview.postMessage({
              kind: 'uses',
              uses: await vscode.commands
                .executeCommand<
                  unknown[]
                >('bigfs.findFileUses', basename(document.uri))
                .then(
                  (uses) => uses ?? [],
                  () => [],
                ),
            });
          }
        } else if (received.kind === 'reveal') {
          const position = new vscode.Position(received.line || 0, 0);

          await vscode.window.showTextDocument(vscode.Uri.parse(received.uri), {
            selection: new vscode.Range(position, position),
          });
        } else if (received.kind === 'videoFrame' && movie) {
          const index = received.index;

          try {
            const pixels = movie.frame(index);

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
              ? { kind: 'animation', file: name, animation }
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

    panel.onDidDispose(() => subscription.dispose());
  }
}
