import * as vscode from 'vscode';
import type { ToolBox } from '../tools/toolRegistry';
import { decodeDdsTool, decodeTgaTool } from '../tools/textureTools';
import { playableAudioTool } from '../tools/audioTools';
import { buildW3dScene } from '../formats/w3dScene';
import { parseW3dAnimations } from '../formats/w3dAnimation';
import { Vp6Movie } from '../formats/vp6/container';
import type { ModelScene } from '../formats/w3dScene';
import type { EntryLocator } from '../formats/entryLocator';
import { MODEL_SCRIPT } from './previewModelScript';

/**
 * Read-only editor that previews the binary entries a text editor cannot
 * show: TGA and DDS textures, drawn on a canvas with zoom, channel and mip
 * controls, WAV sounds, played after IMA ADPCM is decoded, and W3D models,
 * drawn in 3D with their skeleton and textures found wherever they live. It opens files
 * inside archives and loose on disk alike, since it only reads bytes through
 * `workspace.fs`.
 */

/** View type `package.json` registers the editor under */
export const PREVIEW_VIEW_TYPE = 'bigfs.preview';

/** What the webview is sent to draw or play */
type PreviewMessage =
  | {
      kind: 'texture';
      format: string;
      hasAlpha: boolean;
      levels: { width: number; height: number; pixels: Uint8Array }[];
    }
  | {
      kind: 'audio';
      wav: Uint8Array;
      info: {
        format: string;
        channels: number;
        sampleRate: number;
        bitsPerSample: number;
        durationSeconds: number;
      };
    }
  | { kind: 'compressedAudio'; bytes: Uint8Array; mime: string; format: string }
  | {
      kind: 'video';
      width: number;
      height: number;
      frameCount: number;
      framesPerSecond: number;
      hasAlpha: boolean;
    }
  | ({ kind: 'model' } & ModelScene)
  | { kind: 'error'; message: string };

/** Decodes an entry into what its preview shows, by its extension */
const buildMessage = async (
  uri: vscode.Uri,
  tools: ToolBox,
  locator: EntryLocator,
  openMovie: (movie: Vp6Movie) => void,
): Promise<PreviewMessage> => {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const extension = uri.path.slice(uri.path.lastIndexOf('.')).toLowerCase();

  try {
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
      case '.w3d':
        return {
          kind: 'model',
          ...(await buildW3dScene(
            bytes,
            (fileName) => locator.read(fileName, uri),
            tools,
          )),
        };
      default:
        return { kind: 'error', message: `No preview for ${extension} files` };
    }
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

/** A random token the page's one script carries, so no other script runs */
const createNonce = (): string =>
  Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 36).toString(36),
  ).join('');

/** The page: a toolbar, a canvas or an audio element, and a status line */
export const renderHtml = (webview: vscode.Webview): string => {
  const nonce = createNonce();

  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; media-src blob:; img-src blob: data:;">
<style>
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
</style>
</head>
<body>
<header id="toolbar" hidden>
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
<main id="main"></main>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const main = document.getElementById('main');
  const toolbar = document.getElementById('toolbar');
  const status = document.getElementById('status');
  const levelSelect = document.getElementById('level');
  const channelSelect = document.getElementById('channels');
  const backgroundSelect = document.getElementById('background');
  const state = { zoom: 0, levels: [], level: 0 };
  let canvas;
  let stage;

  const drawTexture = () => {
    const { width, height, pixels } = state.levels[state.level];
    const image = new ImageData(width, height);
    const mode = channelSelect.value;

    for (let at = 0; at < pixels.length; at += 4) {
      if (mode === 'alpha') {
        image.data.fill(pixels[at + 3], at, at + 3);
        image.data[at + 3] = 255;
      } else {
        image.data[at] = pixels[at];
        image.data[at + 1] = pixels[at + 1];
        image.data[at + 2] = pixels[at + 2];
        image.data[at + 3] = mode === 'rgb' ? 255 : pixels[at + 3];
      }
    }

    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(image, 0, 0);
    layout();
  };

  const layout = () => {
    const { width, height } = state.levels[state.level];
    const available = Math.max(1, main.clientWidth - 24);
    const scale = state.zoom || Math.min(1, available / width);

    canvas.style.width = width * scale + 'px';
    canvas.style.height = height * scale + 'px';
    canvas.classList.toggle('pixelated', scale > 1);
    document.getElementById('fit').setAttribute('aria-pressed', String(!state.zoom));
    document.getElementById('actual').setAttribute('aria-pressed', String(state.zoom === 1));
    status.textContent = state.format + ' · ' + width + '×' + height +
      (state.levels.length > 1 ? ' · ' + state.levels.length + ' mips' : '') +
      ' · ' + Math.round(scale * 100) + '%';
  };

  const setZoom = (zoom) => {
    state.zoom = zoom;
    layout();
  };

  const currentScale = () => {
    const { width } = state.levels[state.level];
    return parseFloat(canvas.style.width) / width;
  };

  document.getElementById('fit').onclick = () => setZoom(0);
  document.getElementById('actual').onclick = () => setZoom(1);
  document.getElementById('zoom-in').onclick = () => setZoom(Math.min(32, currentScale() * 2));
  document.getElementById('zoom-out').onclick = () => setZoom(Math.max(1 / 32, currentScale() / 2));
  channelSelect.onchange = drawTexture;
  levelSelect.onchange = () => { state.level = Number(levelSelect.value); drawTexture(); };
  backgroundSelect.onchange = () => { stage.className = 'stage ' + backgroundSelect.value; };
  window.addEventListener('resize', () => canvas && layout());

  const showTexture = (message) => {
    Object.assign(state, { levels: message.levels, format: message.format, level: 0 });
    toolbar.hidden = false;
    channelSelect.value = message.hasAlpha ? 'rgba' : 'rgb';
    levelSelect.hidden = message.levels.length < 2;
    levelSelect.replaceChildren(...message.levels.map((level, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = 'Mip ' + index + ' (' + level.width + '×' + level.height + ')';
      return option;
    }));
    stage = document.createElement('div');
    stage.className = 'stage checker';
    canvas = document.createElement('canvas');
    stage.append(canvas);
    main.replaceChildren(stage);
    drawTexture();
  };

  const showAudio = ({ wav, info }) => {
    const rows = [
      ['Codec', info.format],
      ['Channels', info.channels],
      ['Sample rate', info.sampleRate + ' Hz'],
      ['Bits per sample', info.bitsPerSample],
      ['Duration', info.durationSeconds.toFixed(2) + ' s'],
    ];
    const list = document.createElement('dl');

    for (const [term, value] of rows) {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = term;
      dd.textContent = String(value);
      list.append(dt, dd);
    }

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    main.replaceChildren(list, audio);
  };

  ${MODEL_SCRIPT}

  const showCompressedAudio = ({ bytes, mime, format }) => {
    const list = document.createElement('dl');
    const audio = document.createElement('audio');
    const add = (term, value) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = term;
      dd.textContent = value;
      list.append(dt, dd);
    };
    add('Codec', format);
    audio.controls = true;
    audio.src = URL.createObjectURL(new Blob([bytes], { type: mime }));
    audio.addEventListener('loadedmetadata', () => add('Duration', audio.duration.toFixed(2) + ' s'));
    main.replaceChildren(list, audio);
  };

  /** Plays a VP6 movie: the extension decodes, the page asks frame by frame */
  let video;
  const showVideo = (info) => {
    const canvas = document.createElement('canvas');
    canvas.width = info.width;
    canvas.height = info.height;
    canvas.className = 'video' + (info.hasAlpha ? ' checker' : '');
    const bar = document.createElement('div');
    bar.className = 'controls';
    const play = document.createElement('button');
    const slider = document.createElement('input');
    const label = document.createElement('span');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(Math.max(0, info.frameCount - 1));
    label.className = 'status';
    bar.append(play, slider, label);
    const facts = document.createElement('p');
    facts.textContent = info.width + ' × ' + info.height + ' · ' + info.frameCount + ' frames · ' + info.framesPerSecond.toFixed(2) + ' fps' + (info.hasAlpha ? ' · with alpha' : '') + ' · no sound: EA movies keep it in a separate file';
    main.replaceChildren(bar, canvas, facts);
    const context = canvas.getContext('2d');
    video = { info, frame: 0, playing: true, pending: false, last: 0 };
    const request = (index) => {
      if (video.pending) return;
      video.pending = true;
      vscode.postMessage({ kind: 'videoFrame', index });
    };
    const update = () => {
      play.textContent = video.playing ? 'Pause' : 'Play';
      slider.value = String(video.frame);
      label.textContent = 'frame ' + (video.frame + 1) + ' / ' + info.frameCount;
    };
    play.onclick = () => {
      video.playing = !video.playing;
      if (video.playing && video.frame >= info.frameCount - 1) video.frame = -1;
      update();
      if (video.playing) request(video.frame + 1);
    };
    slider.oninput = () => { video.playing = false; update(); request(Number(slider.value)); };
    video.show = (index, pixels) => {
      video.pending = false;
      video.frame = index;
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), info.width, info.height), 0, 0);
      update();
      if (video.playing && index < info.frameCount - 1) {
        const wait = Math.max(0, 1000 / info.framesPerSecond - (performance.now() - video.last));
        setTimeout(() => { video.last = performance.now(); request(index + 1); }, wait);
      } else if (index >= info.frameCount - 1) {
        video.playing = false;
        update();
      }
    };
    update();
    request(0);
  };

  let modelControl;

  window.addEventListener('message', ({ data }) => {
    if (data.kind === 'model') {
      modelControl = showModel(data);
    } else if (data.kind === 'compressedAudio') {
      showCompressedAudio(data);
    } else if (data.kind === 'video') {
      showVideo(data);
    } else if (data.kind === 'videoFrame') {
      video?.show(data.index, data.pixels);
    } else if (data.kind === 'videoError') {
      if (video) video.pending = false;
      const error = document.createElement('p');
      error.className = 'error';
      error.textContent = 'Cannot decode this frame: ' + data.message;
      main.append(error);
    } else if (data.kind === 'animations') {
      modelControl?.setAnimations(data.names);
    } else if (data.kind === 'animation') {
      modelControl?.play(data);
    } else if (data.kind === 'animationError') {
      modelControl?.notice(data.message);
    } else if (data.kind === 'texture') {
      showTexture(data);
    } else if (data.kind === 'audio') {
      showAudio(data);
    } else {
      const error = document.createElement('p');
      error.className = 'error';
      error.textContent = 'Cannot preview this file: ' + data.message;
      main.replaceChildren(error);
    }
  });

  vscode.postMessage({ kind: 'ready' });
</script>
</body>
</html>`;
};

/** Custom editor provider behind `bigfs.preview` */
export class PreviewEditorProvider
  implements vscode.CustomReadonlyEditorProvider
{
  public constructor(
    private readonly tools: ToolBox,
    private readonly locator: EntryLocator,
  ) {}

  /** Registers the provider under `PREVIEW_VIEW_TYPE` */
  public static register(
    tools: ToolBox,
    locator: EntryLocator,
  ): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      PREVIEW_VIEW_TYPE,
      new PreviewEditorProvider(tools, locator),
      { supportsMultipleEditorsPerDocument: true },
    );
  }

  /**
   * Files that look like animations of a skeleton: for `GUArcher_SKL`, every
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

  public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  public async resolveCustomEditor(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    panel.webview.options = { enableScripts: true };
    panel.webview.html = renderHtml(panel.webview);

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
    const subscription = panel.webview.onDidReceiveMessage(async (received) => {
      if (received?.kind === 'ready') {
        const built = await message;

        await panel.webview.postMessage(built);

        if (built.kind === 'model' && built.skeleton) {
          await panel.webview.postMessage({
            kind: 'animations',
            names: await this.findAnimations(built.skeleton.name),
          });
        }
      } else if (received?.kind === 'videoFrame' && movie) {
        const index = Number(received.index);

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
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (received?.kind === 'animation') {
        const name = String(received.file);
        let reply: unknown;

        try {
          const bytes = await this.locator.read(name, document.uri);
          const [animation] = bytes ? parseW3dAnimations(bytes) : [];

          reply = animation
            ? { kind: 'animation', file: name, animation }
            : { kind: 'animationError', message: `${name} holds no animation` };
        } catch (error) {
          reply = {
            kind: 'animationError',
            message: error instanceof Error ? error.message : String(error),
          };
        }

        await panel.webview.postMessage(reply);
      }
    });

    panel.onDidDispose(() => subscription.dispose());
  }
}
