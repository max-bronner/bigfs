import { getVsCodeApi } from '../shared/vscodeApi';
import type { FromVideoPage, ToVideoPage } from './protocol';

/**
 * The frame reader's page: VS Code's own browser engine decodes a video the
 * extension cannot read with FFmpeg, and the page sends back its frames as
 * pixels. The video is muted and never plays; it is only seeked.
 */

const vscode = getVsCodeApi<FromVideoPage>();
const video = document.getElementById('video') as HTMLVideoElement;
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const context = canvas.getContext('2d', { willReadFrequently: true })!;
let queue = Promise.resolve();

video.addEventListener('loadedmetadata', () =>
  vscode.postMessage({
    kind: 'meta',
    width: video.videoWidth,
    height: video.videoHeight,
    duration: video.duration,
  }),
);
video.addEventListener('error', () =>
  vscode.postMessage({
    kind: 'error',
    message:
      'This video cannot be read here; install FFmpeg, or convert it to WebM first',
  }),
);

window.addEventListener('message', ({ data }: MessageEvent<ToVideoPage>) => {
  if (data.kind !== 'frame') {
    return;
  }

  queue = queue.then(
    () =>
      new Promise<void>((resolve) => {
        const draw = () => {
          canvas.width = data.width;
          canvas.height = data.height;
          context.drawImage(video, 0, 0, data.width, data.height);

          const pixels = context.getImageData(
            0,
            0,
            data.width,
            data.height,
          ).data;

          status.textContent = `Frame ${data.index + 1}`;
          vscode.postMessage({
            kind: 'frame',
            index: data.index,
            data: new Uint8Array(pixels.buffer),
          });
          resolve();
        };

        if (
          Math.abs(video.currentTime - data.time) < 1e-6 &&
          video.readyState >= 2
        ) {
          draw();
        } else {
          video.addEventListener('seeked', draw, { once: true });
          video.currentTime = data.time;
        }
      }),
  );
});
