import type { CursorFrame } from '../../formats/cursor/cursorFrame';

/** Whole-number zoom that shows a frame at roughly `targetSide` pixels */
export const pickCursorScale = (frame: CursorFrame, targetSide = 128): number =>
  Math.max(1, Math.floor(targetSide / Math.max(frame.width, frame.height)));

/**
 * Draws a cursor frame magnified by `scale`, without smoothing, with its
 * hotspot pixel outlined in white and red so it shows on any colour.
 */
export const drawCursorFrame = (
  canvas: HTMLCanvasElement,
  frame: CursorFrame,
  scale: number,
): void => {
  const source = document.createElement('canvas');

  source.width = frame.width;
  source.height = frame.height;
  source
    .getContext('2d')!
    .putImageData(
      new ImageData(
        new Uint8ClampedArray(
          frame.pixels.buffer as ArrayBuffer,
          frame.pixels.byteOffset,
          frame.pixels.byteLength,
        ),
        frame.width,
        frame.height,
      ),
      0,
      0,
    );

  canvas.width = frame.width * scale;
  canvas.height = frame.height * scale;

  const context = canvas.getContext('2d')!;
  const x = frame.hotspotX * scale;
  const y = frame.hotspotY * scale;

  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  context.lineWidth = 1;
  context.strokeStyle = '#fff';
  context.strokeRect(x + 0.5, y + 0.5, scale - 1, scale - 1);
  context.strokeStyle = '#f00';
  context.strokeRect(
    x + 1.5,
    y + 1.5,
    Math.max(0, scale - 3),
    Math.max(0, scale - 3),
  );
};
