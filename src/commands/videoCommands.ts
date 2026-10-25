import * as vscode from 'vscode';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { decodePng } from '../formats/textureEncode';
import { Vp6Movie } from '../formats/vp6/container';
import { MAX_SIDE, encodeMovie, resizeRgba } from '../formats/vp6/encodeMovie';
import type { FrameSource } from '../formats/vp6/encodeMovie';
import { webviewPage } from '../providers/webviewPage';
import { ffmpegSource, probe, run } from '../tools/ffmpeg';
import { decodeDds, decodeTga } from '../tools/textureTools';

/**
 * "Convert to VP6 Movie…": a video file, or a folder of numbered PNG, TGA or
 * DDS frames, to an EA VP6 movie the games play. Videos are read with
 * FFmpeg when it is installed (any format it reads), and otherwise by VS
 * Code's own browser engine (WebM and Ogg; MP4 only where the build has the
 * codec). The result is decoded again before it is saved, and opens in the
 * movie preview.
 */

export const FFMPEG_SETTING = 'bigfs.ffmpegPath';

const IMAGE = /\.(png|tga|dds)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm|ogv|ogg|mkv|avi|wmv|mpg|mpeg|gif|bik|vp6)$/i;
const BROWSER_VIDEO = /\.(webm|ogv|ogg|mp4|m4v|mov)$/i;

type Target = vscode.Uri | { resourceUri?: vscode.Uri } | undefined;

const QUALITIES = [
  { label: 'High', description: 'quantizer 54, larger files', q: 54 },
  { label: 'Medium', description: 'quantizer 42', q: 42 },
  { label: 'Low', description: 'quantizer 28, smallest files', q: 28 },
];

const decodeImage = (name: string, bytes: Uint8Array) =>
  /\.png$/i.test(name)
    ? decodePng(bytes)
    : (/\.dds$/i.test(name) ? decodeDds(bytes) : decodeTga(bytes)).levels[0];

/** The FFmpeg to use: the setting's, else one on the PATH, else none */
const findFfmpeg = async (): Promise<string | undefined> => {
  const configured = vscode.workspace
    .getConfiguration()
    .get<string>(FFMPEG_SETTING);

  for (const candidate of [configured, 'ffmpeg'].filter(Boolean) as string[]) {
    try {
      if ((await run(candidate, ['-version'])).code === 0) {
        return candidate;
      }
    } catch {
      // not installed there
    }
  }
  return undefined;
};

/** Frames read in VS Code's own browser engine, one per request */
class BrowserFrames {
  private readonly panel: vscode.WebviewPanel;
  private readonly pending = new Map<number, (data: Uint8Array) => void>();
  public readonly meta: Promise<{
    width: number;
    height: number;
    duration: number;
  }>;

  public constructor(file: vscode.Uri) {
    const folder = vscode.Uri.joinPath(file, '..');

    this.panel = vscode.window.createWebviewPanel(
      'bigfs.videoFrames',
      `Reading ${path.basename(file.path)}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [folder] },
    );

    let failed: (error: Error) => void = () => {};

    this.meta = new Promise((resolve, reject) => {
      failed = reject;
      this.panel.webview.onDidReceiveMessage((message) => {
        if (message?.kind === 'meta') {
          resolve(message);
        } else if (message?.kind === 'error') {
          reject(new Error(String(message.message)));
        } else if (message?.kind === 'frame') {
          this.pending.get(message.index)?.(new Uint8Array(message.data));
          this.pending.delete(message.index);
        }
      });
    });
    this.panel.onDidDispose(() =>
      failed(new Error('The reading panel was closed')),
    );
    this.panel.webview.html = browserPage(
      this.panel.webview.asWebviewUri(file),
      this.panel.webview.cspSource,
    );
  }

  public frame(
    index: number,
    time: number,
    width: number,
    height: number,
  ): Promise<Uint8Array> {
    return new Promise((resolve) => {
      this.pending.set(index, resolve);
      void this.panel.webview.postMessage({
        kind: 'frame',
        index,
        time,
        width,
        height,
      });
    });
  }

  public dispose(): void {
    this.panel.dispose();
  }
}

const browserPage = (video: vscode.Uri, source: string): string => {
  return webviewPage({
    allow: { media: source },
    style: `body { color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); padding: 10px; } canvas { max-width: 100%; }`,
    body: `<div id="status">Reading frames…</div>
<video id="video" src="${video}" muted preload="auto" hidden></video>
<canvas id="canvas"></canvas>`,
    script: `
const vscode = acquireVsCodeApi();
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d', { willReadFrequently: true });
video.addEventListener('loadedmetadata', () =>
  vscode.postMessage({ kind: 'meta', width: video.videoWidth, height: video.videoHeight, duration: video.duration }));
video.addEventListener('error', () =>
  vscode.postMessage({ kind: 'error', message: 'This video cannot be read here; install FFmpeg, or convert it to WebM first' }));
let queue = Promise.resolve();
window.addEventListener('message', ({ data }) => {
  if (data.kind !== 'frame') return;
  queue = queue.then(() => new Promise((resolve) => {
    const draw = () => {
      canvas.width = data.width;
      canvas.height = data.height;
      context.drawImage(video, 0, 0, data.width, data.height);
      const pixels = context.getImageData(0, 0, data.width, data.height).data;
      document.getElementById('status').textContent = 'Frame ' + (data.index + 1);
      vscode.postMessage({ kind: 'frame', index: data.index, data: new Uint8Array(pixels.buffer) });
      resolve();
    };
    if (Math.abs(video.currentTime - data.time) < 1e-6 && video.readyState >= 2) draw();
    else { video.addEventListener('seeked', draw, { once: true }); video.currentTime = data.time; }
  }));
});
`,
  });
};

const askNumber = async (
  prompt: string,
  value: string,
  test: (value: number) => boolean,
): Promise<number | undefined> => {
  const answer = await vscode.window.showInputBox({
    prompt,
    value,
    validateInput: (text) =>
      test(Number(text)) ? undefined : 'Enter a number in range',
  });

  return answer === undefined ? undefined : Number(answer);
};

/** Asks for the output size; keeps the source's unless told otherwise */
const askSize = async (
  width: number,
  height: number,
): Promise<[number, number] | undefined> => {
  const fit = Math.min(1, MAX_SIDE / Math.max(width, height));
  const source: [number, number] = [
    Math.round(width * fit),
    Math.round(height * fit),
  ];
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: `${source[0]}×${source[1]}`,
        description: 'source size',
        size: source,
      },
      {
        label: `${Math.round(source[0] / 2)}×${Math.round(source[1] / 2)}`,
        description: 'half',
        size: [Math.round(source[0] / 2), Math.round(source[1] / 2)] as [
          number,
          number,
        ],
      },
      { label: 'Other size…', size: undefined },
    ],
    { placeHolder: 'Movie size' },
  );

  if (!picked) {
    return undefined;
  }
  if (picked.size) {
    return picked.size;
  }

  const text = await vscode.window.showInputBox({
    prompt: 'Width x height',
    value: `${source[0]}x${source[1]}`,
    validateInput: (value) => {
      const match = /^(\d+)x(\d+)$/.exec(value);

      return match &&
        Number(match[1]) >= 16 &&
        Number(match[2]) >= 16 &&
        Number(match[1]) <= MAX_SIDE &&
        Number(match[2]) <= MAX_SIDE
        ? undefined
        : `16 to ${MAX_SIDE} pixels a side, e.g. 800x600`;
    },
  });

  return text ? (text.split('x').map(Number) as [number, number]) : undefined;
};

/** A rate as numerator and denominator, keeping 29.97-style rates exact */
const rateOf = (fps: number): [number, number] => {
  const whole = Math.round(fps * 1.001);

  return !Number.isInteger(fps) && Math.abs((whole * 1000) / 1001 - fps) < 0.01
    ? [whole * 1000, 1001]
    : [Math.round(fps * 1000), 1000];
};

/** Frames between forced key frames, from the setting */
const keyInterval = (fps: number): number => {
  const seconds = vscode.workspace
    .getConfiguration()
    .get<number>('bigfs.vp6.keyFrameSeconds', 2);

  return seconds > 0 ? Math.max(1, Math.round(seconds * fps)) : 1;
};

const convert = async (target: Target): Promise<vscode.Uri | undefined> => {
  let input = target instanceof vscode.Uri ? target : target?.resourceUri;

  if (!input) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      openLabel: 'Convert',
      title: 'A video, or a folder of numbered PNG, TGA or DDS frames',
    });

    input = picked?.[0];
  }
  if (!input) {
    return undefined;
  }

  const isFolder =
    ((await vscode.workspace.fs.stat(input)).type &
      vscode.FileType.Directory) !==
    0;
  const name = path.basename(input.path).replace(/\.[^.]*$/, '');
  let cleanup: (() => Promise<void>) | undefined;
  let stop: (() => void) | undefined;

  try {
    let width: number;
    let height: number;
    let fps: number;
    let makeSource: (w: number, h: number, rate: number) => FrameSource['next'];

    if (isFolder || IMAGE.test(input.path)) {
      const files = isFolder
        ? (await vscode.workspace.fs.readDirectory(input))
            .filter(
              ([file, type]) =>
                type === vscode.FileType.File && IMAGE.test(file),
            )
            .map(([file]) => file)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map((file) => vscode.Uri.joinPath(input!, file))
        : [input];

      if (!files.length) {
        throw new Error('The folder holds no PNG, TGA or DDS frames');
      }

      const first = decodeImage(
        files[0].path,
        await vscode.workspace.fs.readFile(files[0]),
      );

      [width, height, fps] = [first.width, first.height, 30];
      makeSource = (w, h) => {
        let index = 0;

        return async () => {
          const file = files[index++];

          if (!file) {
            return undefined;
          }

          const image = decodeImage(
            file.path,
            await vscode.workspace.fs.readFile(file),
          );

          return resizeRgba(image.pixels, image.width, image.height, w, h);
        };
      };
    } else {
      if (!VIDEO.test(input.path)) {
        throw new Error('Pick a video, an image, or a folder of frames');
      }

      // Both readers need the video as a file on disk
      let file = input;

      if (input.scheme !== 'file') {
        const folder = await mkdtemp(path.join(os.tmpdir(), 'bigfs-video-'));
        const copy = path.join(folder, path.basename(input.path));

        await writeFile(copy, await vscode.workspace.fs.readFile(input));
        file = vscode.Uri.file(copy);
        cleanup = () => rm(folder, { recursive: true, force: true });
      }

      const ffmpeg = await findFfmpeg();

      if (ffmpeg) {
        ({ width, height, fps } = await probe(ffmpeg, file.fsPath));
        makeSource = (w, h, rate) => {
          const source = ffmpegSource(ffmpeg, file.fsPath, w, h, rate);

          stop = source.stop;
          return source.next;
        };
      } else {
        if (!BROWSER_VIDEO.test(input.path)) {
          throw new Error(
            `Reading ${path.extname(input.path)} needs FFmpeg; install it or set ${FFMPEG_SETTING}`,
          );
        }

        const browser = new BrowserFrames(file);
        const meta = await browser.meta;

        stop = () => browser.dispose();
        [width, height, fps] = [meta.width, meta.height, 30];
        makeSource = (w, h, rate) => {
          const count = Math.max(1, Math.floor(meta.duration * rate));
          let index = 0;

          return async () =>
            index < count
              ? browser.frame(index, index++ / rate + 0.5 / rate, w, h)
              : undefined;
        };
      }
    }

    const size = await askSize(width, height);

    if (!size) {
      return undefined;
    }

    const rate = await askNumber(
      'Frames per second',
      String(Math.round(fps * 1000) / 1000),
      (value) => value > 0 && value <= 120,
    );

    if (!rate) {
      return undefined;
    }

    const quality = await vscode.window.showQuickPick(QUALITIES, {
      placeHolder: 'Quality',
    });

    if (!quality) {
      return undefined;
    }

    const output =
      input.scheme === 'file'
        ? vscode.Uri.joinPath(input, '..', `${name}.vp6`)
        : await vscode.window.showSaveDialog({
            defaultUri: vscode.workspace.workspaceFolders?.[0]
              ? vscode.Uri.joinPath(
                  vscode.workspace.workspaceFolders[0].uri,
                  `${name}.vp6`,
                )
              : undefined,
            filters: { 'VP6 movies': ['vp6'] },
          });

    if (!output) {
      return undefined;
    }

    const next = makeSource(size[0], size[1], rate);
    const firstFrame = await next();

    if (!firstFrame) {
      throw new Error('The source has no frames');
    }

    // Alpha is kept when the first frame has any transparency
    let alpha = false;

    for (let at = 3; at < firstFrame.length; at += 4) {
      if (firstFrame[at] < 255) {
        alpha = true;
        break;
      }
    }

    let pending: Uint8Array | undefined = firstFrame;
    const [rateNumerator, rateDenominator] = rateOf(rate);
    const bytes = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Converting ${path.basename(input.path)} to VP6`,
        cancellable: true,
      },
      (progress, token) =>
        encodeMovie(
          {
            width: size[0],
            height: size[1],
            rateNumerator,
            rateDenominator,
            alpha,
            next: async () => {
              const frame = pending ?? (await next());

              pending = undefined;
              return frame;
            },
          },
          {
            quality: quality.q,
            keyInterval: keyInterval(rate),
            cancelled: () => token.isCancellationRequested,
            progress: (frames) =>
              progress.report({
                message: `${frames} frames`,
              }),
          },
        ),
    );

    if (!bytes) {
      return undefined;
    }

    // The movie is read back with the decoder before it is kept
    const movie = new Vp6Movie(bytes);

    for (const index of [0, movie.frameCount >> 1, movie.frameCount - 1]) {
      movie.frame(index);
    }

    await vscode.workspace.fs.writeFile(output, bytes);
    await vscode.commands.executeCommand(
      'vscode.openWith',
      output,
      'bigfs.preview',
    );
    void vscode.window.showInformationMessage(
      `${path.basename(output.path)}: ${movie.frameCount} frames, ${size[0]}×${size[1]}${alpha ? ' with alpha' : ''}, ${(bytes.length / 1024).toFixed(0)} KB`,
    );
    return output;
  } finally {
    stop?.();
    await cleanup?.();
  }
};

export const registerVideoCommands = (
  context: vscode.ExtensionContext,
): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'bigfs.convertToVp6',
      async (target: Target) => {
        try {
          return await convert(target);
        } catch (error) {
          void vscode.window.showErrorMessage(
            error instanceof Error ? error.message : String(error),
          );
          return undefined;
        }
      },
    ),
  );
};
