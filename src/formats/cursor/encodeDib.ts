import type { CursorFrame } from './cursorFrame';

const HEADER_LENGTH = 40;

/**
 * Encodes a frame as the DIB of an icon entry: a 32-bit bottom-up bitmap with
 * alpha, then the 1-bit AND mask that marks fully transparent pixels, which
 * keeps the cursor correct where the system ignores alpha.
 */
export const encodeDib = ({
  width,
  height,
  pixels,
}: CursorFrame): Uint8Array => {
  const maskStride = Math.ceil(width / 32) * 4;
  const colourLength = width * height * 4;
  const out = new Uint8Array(
    HEADER_LENGTH + colourLength + maskStride * height,
  );
  const view = new DataView(out.buffer);

  view.setUint32(0, HEADER_LENGTH, true);
  view.setInt32(4, width, true);
  view.setInt32(8, height * 2, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, 32, true);
  view.setUint32(20, colourLength + maskStride * height, true);

  for (let row = 0; row < height; row++) {
    const stored = height - 1 - row;

    for (let column = 0; column < width; column++) {
      const from = (row * width + column) * 4;
      const to = HEADER_LENGTH + (stored * width + column) * 4;

      out[to] = pixels[from + 2];
      out[to + 1] = pixels[from + 1];
      out[to + 2] = pixels[from];
      out[to + 3] = pixels[from + 3];

      if (!pixels[from + 3]) {
        out[
          HEADER_LENGTH + colourLength + stored * maskStride + (column >> 3)
        ] |= 0x80 >> (column & 7);
      }
    }
  }

  return out;
};
