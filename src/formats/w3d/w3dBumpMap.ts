import type { RgbaImage } from "../texture/textureTools";

/**
 * Converts a height map into the offsets `GRADIENT_BUMPENVMAP` reads: the
 * slopes of the texel's luminance, a `du` and a `dv`. Ported from mint's
 * `bump_offsets`, EA's `bitmaphandler.cpp`, down to its walk through memory:
 * left and right neighbours run on across rows.
 * @returns the image with `du` in red and `dv` in green, each a signed byte plus 128
 */
export const buildBumpOffsets = ({ width, height, pixels }: RgbaImage): RgbaImage => {
  const count = width * height;
  const luminance = new Int32Array(count);

  for (let at = 0; at < count; at++) {
    const [red, green, blue] = [pixels[at * 4], pixels[at * 4 + 1], pixels[at * 4 + 2]];

    // CIE 709 in EA's fixed point
    luminance[at] = ((blue * 0x1275 + green * 0xb725 + red * 0x3666) >>> 16) & 0xff;
  }

  const out = new Uint8Array(count * 4);

  for (let at = 0; at < count; at++) {
    const row = Math.floor(at / width);
    const mid = luminance[at];
    const left = luminance[Math.max(at - 1, 0)];
    const right = luminance[Math.min(at + 1, count - 1)];
    const above = row === 0 ? mid : luminance[at - width];
    const below = row + 1 === height ? mid : luminance[at + width];
    // At a local minimum along the row, the larger one-sided slope
    const du = mid < left && mid < right ? Math.max(left - mid, mid - right) : left - right;
    const dv = below - above;

    // The low byte, read back as signed, as a U8V8 surface does
    out[at * 4] = ((du << 24) >> 24) + 128;
    out[at * 4 + 1] = ((dv << 24) >> 24) + 128;
    out[at * 4 + 3] = 255;
  }

  return { width, height, pixels: out };
};
