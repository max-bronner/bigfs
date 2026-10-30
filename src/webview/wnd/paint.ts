import type { Rgba, WndBox, WndPart } from '../../formats/wnd/wndLayout';
import type { PreviewImage } from './protocol';

/**
 * Draws a window the way mint's `apt-viewer` gadgets do: a check box's
 * square box at the left with its label after it (`gadget/check.rs`), a
 * slider's row of segments and its thumb (`slider.rs`), a list box's body,
 * selection and scroll bar (`list.rs`), a combo box's drop-down button
 * (`combo.rs`). The slots each part reads are chosen in `wndLayout.ts`.
 */

export const POINTS_TO_UNITS = 96 / 72;
const SLIDER_THUMB = [13, 16];
const SCROLL_BUTTON = [21, 22];
const THUMB_HEIGHT = 16;
const SEGMENT_GAP = 2;

type Rect = [number, number, number, number];

/** What drawing a part needs: the canvas, the images by name and their textures */
export interface Painter {
  context: CanvasRenderingContext2D;
  images: Record<string, PreviewImage>;
  textures: Record<string, HTMLImageElement>;
}

export const css = (c: Rgba, scale = 1) =>
  `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255) * scale})`;

const drawImage = (
  { context, images, textures }: Painter,
  name: string,
  left: number,
  top: number,
  width: number,
  height: number,
) => {
  const info = images[name];
  const texture = info && textures[info.texture];

  if (!texture || !texture.naturalWidth || width <= 0 || height <= 0) {
    return;
  }

  const sx = info.uv[0] * texture.naturalWidth;
  const sy = info.uv[1] * texture.naturalHeight;
  const sw = info.uv[2] * texture.naturalWidth;
  const sh = info.uv[3] * texture.naturalHeight;

  if (sw <= 0 || sh <= 0) {
    return;
  }

  if (!info.rotated) {
    context.drawImage(texture, sx, sy, sw, sh, left, top, width, height);
  } else {
    // packed turned a quarter turn clockwise: turn it back
    context.save();
    context.translate(left, top);
    context.scale(width / sh, height / sw);
    context.transform(0, -1, 1, 0, 0, sw);
    context.drawImage(texture, sx, sy, sw, sh, 0, 0, sw, sh);
    context.restore();
  }
};

export const drawPart = (
  painter: Painter,
  part: WndPart,
  left: number,
  top: number,
  width: number,
  height: number,
) => {
  const { context } = painter;

  if (part.image) {
    drawImage(painter, part.image, left, top, width, height);
    return;
  }

  if (part.color && part.color[3] > 0) {
    context.fillStyle = css(part.color);
    context.fillRect(left, top, width, height);
  }

  if (part.border && part.border[3] > 0) {
    context.strokeStyle = css(part.border);
    context.lineWidth = 1;
    context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
  }
};

const extentOf = (
  { images }: Painter,
  part: WndPart | undefined,
  fallback: [number, number],
) => (part?.image && images[part.image] ? images[part.image].extent : fallback);

const roleFinder = (parts: WndPart[]) => (role: string) =>
  parts.find((part) => part.role === role);

export const drawSlider = (
  painter: Painter,
  parts: WndPart[],
  rect: Rect,
  vertical: boolean,
) => {
  const [left, top, right, bottom] = rect;
  const find = roleFinder(parts);
  const filled = find('bar-filled');
  const empty = find('bar-empty');
  const outline = find('outline');
  const thumb = find('thumb');
  // A preview has no value: the thumb sits halfway
  const fraction = 0.5;

  if (vertical) {
    const middle = top + (bottom - top) * (1 - fraction);

    if (empty) {
      drawPart(painter, empty, left, top, right - left, middle - top);
    }

    if (filled) {
      drawPart(painter, filled, left, middle, right - left, bottom - middle);
    }

    if (thumb) {
      drawPart(
        painter,
        thumb,
        (left + right - SLIDER_THUMB[1]) / 2,
        middle - SLIDER_THUMB[0] / 2,
        SLIDER_THUMB[1],
        SLIDER_THUMB[0],
      );
    }

    return;
  }

  const extent = extentOf(painter, filled, extentOf(painter, empty, [6, 24]));
  const segment = extent[0] > 0 ? extent[0] : 6;
  const width = right - left;
  const filledTo = left + fraction * width;
  const starts: number[] = [];

  for (
    let start = left;
    start + segment < right && starts.length < 4096;
    start += segment + SEGMENT_GAP
  ) {
    starts.push(start);
  }

  const covered = starts.length
    ? starts[starts.length - 1] + segment - left
    : 0;
  const shift = (width - covered) / 2;
  const y = (top + bottom) / 2 - extent[1] / 2;

  for (const start of starts) {
    const x = start + shift;

    if (outline) {
      drawPart(painter, outline, x, y, segment, extent[1]);
    }

    const part = start <= filledTo ? filled : empty;

    if (part) {
      drawPart(painter, part, x, y, segment, extent[1]);
    }
  }

  if (thumb) {
    const x = left + fraction * Math.max(0, width - SLIDER_THUMB[0]);

    drawPart(
      painter,
      thumb,
      x,
      top + (SLIDER_THUMB[1] * 2) / 3,
      SLIDER_THUMB[0],
      SLIDER_THUMB[1],
    );
  }
};

export const drawList = (
  painter: Painter,
  box: WndBox,
  parts: WndPart[],
  rect: Rect,
) => {
  const [left, top, right, bottom] = rect;
  const find = roleFinder(parts);
  const [bw, bh] = SCROLL_BUTTON;
  const bar = parts.some((part) =>
    [
      'up',
      'down',
      'track',
      'thumb-top',
      'thumb-middle',
      'thumb-bottom',
    ].includes(part.role),
  );
  const textWidth = bar ? right - left - (bw + 3) : right - left;
  const body = find('body');

  if (body) {
    drawPart(painter, body, left, top, right - left, bottom - top);
  }

  const selection = find('selection');

  if (selection) {
    const row = box.font ? box.font.size * POINTS_TO_UNITS + 2 : 16;

    drawPart(
      painter,
      selection,
      left,
      top + 4,
      textWidth,
      Math.min(row, bottom - top - 4),
    );
  }

  if (!bar) {
    return;
  }

  const x = right - bw - 2;
  const up = find('up');
  const down = find('down');
  const track = find('track');

  if (up) {
    drawPart(painter, up, x, top + 2, bw, bh);
  }

  if (down) {
    drawPart(painter, down, x, bottom - bh - 2, bw, bh);
  }

  const trackTop = top + bh + 3;
  const trackBottom = bottom - bh - 3;

  if (track) {
    drawPart(painter, track, x, trackTop, bw, trackBottom - trackTop);
  }

  const topCap = find('thumb-top');
  const middle = find('thumb-middle');
  const bottomCap = find('thumb-bottom');
  const cap = (part: WndPart | undefined) => {
    const extent =
      part?.image && painter.images[part.image]
        ? painter.images[part.image].extent
        : undefined;

    return extent && extent[0] > 0 ? (extent[1] / extent[0]) * bw : 0;
  };
  const capTop = cap(topCap);
  const capBottom = cap(bottomCap);
  const thumbHeight = Math.max(THUMB_HEIGHT, capTop + capBottom);

  if (middle) {
    drawPart(
      painter,
      middle,
      x,
      trackTop + capTop,
      bw,
      Math.max(0, thumbHeight - capTop - capBottom),
    );
  }

  if (topCap) {
    drawPart(painter, topCap, x, trackTop, bw, capTop);
  }

  if (bottomCap) {
    drawPart(
      painter,
      bottomCap,
      x,
      trackTop + thumbHeight - capBottom,
      bw,
      capBottom,
    );
  }
};
