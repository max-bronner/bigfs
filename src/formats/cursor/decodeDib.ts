/** Largest width or height decoded, above the 256 an icon directory can state */
export const MAX_CURSOR_DIMENSION = 512;

const HEADER_LENGTH = 40;

/** Pixels the stored DIB paints, before a container attaches its hotspot */
interface DibImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Bytes a row takes, padded to a 4 byte boundary */
const rowStride = (width: number, bitsPerPixel: number) =>
  Math.ceil((width * bitsPerPixel) / 32) * 4;

/**
 * Decodes the DIB inside an icon or cursor entry: a bitmap header, an
 * optional colour table, the colour bitmap and a 1-bit AND mask, stacked in
 * one buffer. Handles 1, 4, 8, 24 and 32 bits a pixel, uncompressed. Rows are
 * stored bottom first and the stated height covers both bitmaps.
 *
 * A 32-bit bitmap takes its transparency from its alpha channel, or from the
 * AND mask when every alpha is zero, as Windows does. Every size is checked
 * against the bytes present before anything is allocated.
 */
export const decodeDib = (bytes: Uint8Array): DibImage => {
  if (bytes.length < HEADER_LENGTH) {
    throw new Error('Too short for a bitmap header');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint32(0, true);
  const width = view.getInt32(4, true);
  const storedHeight = view.getInt32(8, true);
  const bitsPerPixel = view.getUint16(14, true);
  const compression = view.getUint32(16, true);
  const colourCount = view.getUint32(32, true);
  const isTopDown = storedHeight < 0;
  const height = Math.abs(storedHeight) / 2;

  if (headerSize < HEADER_LENGTH || headerSize > bytes.length) {
    throw new Error(`Bitmap header size ${headerSize} is not valid`);
  }

  if (
    width <= 0 ||
    !Number.isInteger(height) ||
    !height ||
    width > MAX_CURSOR_DIMENSION ||
    height > MAX_CURSOR_DIMENSION
  ) {
    throw new Error(
      `Image size ${width}x${Math.abs(storedHeight) / 2} is outside 1 to ${MAX_CURSOR_DIMENSION}`,
    );
  }

  if (![1, 4, 8, 24, 32].includes(bitsPerPixel)) {
    throw new Error(`${bitsPerPixel} bits a pixel is not supported`);
  }

  if (compression !== 0) {
    throw new Error(`Bitmap compression ${compression} is not supported`);
  }

  let at = headerSize;
  let palette: Uint8Array | undefined;

  if (bitsPerPixel <= 8) {
    const entries = Math.min(
      colourCount || 1 << bitsPerPixel,
      1 << bitsPerPixel,
    );

    if (at + entries * 4 > bytes.length) {
      throw new Error('The colour table runs past the end of the data');
    }

    palette = bytes.subarray(at, at + entries * 4);
    at += entries * 4;
  }

  const colourStride = rowStride(width, bitsPerPixel);
  const maskStride = rowStride(width, 1);

  if (at + colourStride * height > bytes.length) {
    throw new Error('The pixel data runs past the end of the data');
  }

  const colourStart = at;
  const maskStart = at + colourStride * height;
  const hasMask = maskStart + maskStride * height <= bytes.length;
  const pixels = new Uint8Array(width * height * 4);
  let hasAlpha = false;

  // Stored row `row` is shown row `height - 1 - row` unless the DIB is top-down
  for (let row = 0; row < height; row++) {
    const shown = isTopDown ? row : height - 1 - row;
    const colourRow = colourStart + row * colourStride;

    for (let column = 0; column < width; column++) {
      const to = (shown * width + column) * 4;

      if (bitsPerPixel >= 24) {
        const from = colourRow + column * (bitsPerPixel / 8);

        pixels[to] = bytes[from + 2];
        pixels[to + 1] = bytes[from + 1];
        pixels[to + 2] = bytes[from];
        pixels[to + 3] = bitsPerPixel === 32 ? bytes[from + 3] : 255;
        hasAlpha ||= bitsPerPixel === 32 && bytes[from + 3] !== 0;
      } else {
        const bit = column * bitsPerPixel;
        const index =
          (bytes[colourRow + (bit >> 3)] >> (8 - bitsPerPixel - (bit & 7))) &
          ((1 << bitsPerPixel) - 1);
        const entry = (palette as Uint8Array).subarray(
          index * 4,
          index * 4 + 3,
        );

        pixels[to] = entry[2] ?? 0;
        pixels[to + 1] = entry[1] ?? 0;
        pixels[to + 2] = entry[0] ?? 0;
        pixels[to + 3] = 255;
      }
    }
  }

  if (bitsPerPixel === 32 && !hasAlpha) {
    for (let alpha = 3; alpha < pixels.length; alpha += 4) {
      pixels[alpha] = 255;
    }
  }

  // The mask marks transparent pixels with a set bit
  if (hasMask && !hasAlpha) {
    for (let row = 0; row < height; row++) {
      const shown = isTopDown ? row : height - 1 - row;
      const maskRow = maskStart + row * maskStride;

      for (let column = 0; column < width; column++) {
        if ((bytes[maskRow + (column >> 3)] >> (7 - (column & 7))) & 1) {
          pixels[(shown * width + column) * 4 + 3] = 0;
        }
      }
    }
  }

  return { width, height, pixels };
};
