import type { Tool } from '../../services/toolRegistry';
import { decompressEar, isEarWrapped } from '../refpack/refpack';

/**
 * Decoders for the texture formats the games ship: Truevision TGA and
 * DirectDraw Surface. Both turn the bytes of an entry into RGBA pixels a
 * preview can draw, and both refuse what they cannot read with an error that
 * says why, rather than drawing plausible garbage.
 *
 * Nothing allocates from a header field before the field is checked against
 * the bytes present: a 200 byte file claiming 65535 by 65535 is an error.
 */

/** Pixels top row first, four bytes each in red, green, blue, alpha order */
export interface RgbaImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** A decoded texture: its levels largest first, and how it was stored */
export interface DecodedTexture {
  /** The storage format as a preview names it: `TGA 32-bit`, `DXT5`, ... */
  format: string;
  /** Whether the stored format carries alpha at all */
  hasAlpha: boolean;
  levels: RgbaImage[];
}

/** Largest width or height decoded, far above any shipped texture */
const MAX_DIMENSION = 8192;

const checkDimensions = (width: number, height: number): void => {
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(
      `Image size ${width}x${height} is outside 1 to ${MAX_DIMENSION}`,
    );
  }
};

// TGA

const TGA_HEADER_LENGTH = 18;

/** Image types: colour-mapped, true colour, greyscale, each also run-length encoded */
const TGA_TYPES: Record<
  number,
  { kind: 'mapped' | 'true' | 'grey'; rle: boolean }
> = {
  1: { kind: 'mapped', rle: false },
  2: { kind: 'true', rle: false },
  3: { kind: 'grey', rle: false },
  9: { kind: 'mapped', rle: true },
  10: { kind: 'true', rle: true },
  11: { kind: 'grey', rle: true },
};

/**
 * Reads one stored pixel of `bytesPerPixel` bytes into RGBA. Colours are
 * stored blue first; a 16-bit pixel is 5 bits per channel and one of alpha.
 */
const readTgaPixel = (
  bytes: Uint8Array,
  at: number,
  bytesPerPixel: number,
  out: Uint8Array,
  to: number,
  hasAlpha: boolean,
): void => {
  if (bytesPerPixel === 1) {
    out.fill(bytes[at], to, to + 3);
    out[to + 3] = 255;
    return;
  }

  if (bytesPerPixel === 2) {
    const value = bytes[at] | (bytes[at + 1] << 8);

    out[to] = (((value >> 10) & 31) * 255) / 31;
    out[to + 1] = (((value >> 5) & 31) * 255) / 31;
    out[to + 2] = ((value & 31) * 255) / 31;
    out[to + 3] = hasAlpha && !(value & 0x8000) ? 0 : 255;
    return;
  }

  out[to] = bytes[at + 2];
  out[to + 1] = bytes[at + 1];
  out[to + 2] = bytes[at];
  out[to + 3] = bytesPerPixel === 4 ? bytes[at + 3] : 255;
};

/** A texture some retail files keep RefPack-compressed in an `EAR\0` wrapper */
const unwrapEar = (bytes: Uint8Array) =>
  isEarWrapped(bytes) ? decompressEar(bytes) : bytes;

/**
 * Decodes a TGA: true colour at 16, 24 or 32 bits, 8-bit greyscale and 8-bit
 * colour-mapped images, each stored plain or run-length encoded, in any of
 * the four row and column orders.
 */
export const decodeTga = (wrapped: Uint8Array): DecodedTexture => {
  const bytes = unwrapEar(wrapped);

  if (bytes.length < TGA_HEADER_LENGTH) {
    throw new Error('Too short for a TGA header');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0];
  const type = TGA_TYPES[bytes[2]];
  const mapFirst = view.getUint16(3, true);
  const mapLength = view.getUint16(5, true);
  const mapBits = bytes[7];
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const bits = bytes[16];
  const descriptor = bytes[17];

  if (!type) {
    throw new Error(`TGA image type ${bytes[2]} is not supported`);
  }

  checkDimensions(width, height);

  const pixelBits = type.kind === 'mapped' ? mapBits : bits;
  const bytesPerPixel = pixelBits / 8;
  const isValidDepth =
    type.kind === 'grey'
      ? bits === 8
      : [16, 24, 32].includes(pixelBits) &&
        (type.kind !== 'mapped' || bits === 8);

  if (!isValidDepth) {
    throw new Error(`TGA ${type.kind} image at ${bits} bits is not supported`);
  }

  const hasAlpha =
    bytesPerPixel === 4 || (bytesPerPixel === 2 && (descriptor & 15) > 0);
  let cursor = TGA_HEADER_LENGTH + idLength;

  // A colour map is decoded once to RGBA, so an index just copies four bytes
  let palette: Uint8Array | undefined;

  if (bytes[1] === 1) {
    const mapLengthBytes = mapLength * (mapBits / 8);

    if (cursor + mapLengthBytes > bytes.length) {
      throw new Error('TGA colour map runs past the end of the file');
    }

    if (type.kind === 'mapped') {
      palette = new Uint8Array((mapFirst + mapLength) * 4);

      for (let entry = 0; entry < mapLength; entry++) {
        readTgaPixel(
          bytes,
          cursor + entry * bytesPerPixel,
          bytesPerPixel,
          palette,
          (mapFirst + entry) * 4,
          hasAlpha,
        );
      }
    }

    cursor += mapLengthBytes;
  }

  if (type.kind === 'mapped' && !palette) {
    throw new Error('TGA colour-mapped image has no colour map');
  }

  const count = width * height;
  const stored = new Uint8Array(count * 4);
  const storedBytesPerPixel = type.kind === 'mapped' ? 1 : bytesPerPixel;

  /** Writes the pixel stored at `at` as the `pixel`-th decoded one */
  const put = (at: number, pixel: number): void => {
    if (palette) {
      const index = bytes[at] * 4;

      stored.set(palette.subarray(index, index + 4), pixel * 4);
    } else {
      readTgaPixel(bytes, at, bytesPerPixel, stored, pixel * 4, hasAlpha);
    }
  };

  if (!type.rle) {
    if (cursor + count * storedBytesPerPixel > bytes.length) {
      throw new Error('TGA pixel data runs past the end of the file');
    }

    for (let pixel = 0; pixel < count; pixel++) {
      put(cursor + pixel * storedBytesPerPixel, pixel);
    }
  } else {
    let pixel = 0;

    while (pixel < count) {
      if (cursor >= bytes.length) {
        throw new Error('TGA run-length data ends before the image does');
      }

      const header = bytes[cursor++];
      const run = (header & 127) + 1;

      if (pixel + run > count) {
        throw new Error('TGA run-length packet runs past the image');
      }

      const packetBytes =
        header & 128 ? storedBytesPerPixel : run * storedBytesPerPixel;

      if (cursor + packetBytes > bytes.length) {
        throw new Error('TGA run-length data ends before the image does');
      }

      for (let index = 0; index < run; index++) {
        put(
          header & 128 ? cursor : cursor + index * storedBytesPerPixel,
          pixel++,
        );
      }

      cursor += packetBytes;
    }
  }

  // Rows are stored bottom first unless bit 5 says otherwise, and left to
  // right unless bit 4 does
  const isTopFirst = (descriptor & 0x20) !== 0;
  const isRightFirst = (descriptor & 0x10) !== 0;
  const pixels = new Uint8Array(count * 4);

  for (let row = 0; row < height; row++) {
    const sourceRow = isTopFirst ? row : height - 1 - row;

    for (let column = 0; column < width; column++) {
      const sourceColumn = isRightFirst ? width - 1 - column : column;
      const from = (sourceRow * width + sourceColumn) * 4;

      pixels.set(stored.subarray(from, from + 4), (row * width + column) * 4);
    }
  }

  return {
    format: `TGA ${type.kind === 'mapped' ? 'colour-mapped' : type.kind === 'grey' ? 'greyscale' : `${bits}-bit`}${type.rle ? ', RLE' : ''}`,
    hasAlpha,
    levels: [{ width, height, pixels }],
  };
};

// DDS

const DDS_MAGIC = 0x20534444; // 'DDS ' read little endian
const DDS_HEADER_END = 128;
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;

/** Expands a 5:6:5 colour to RGB */
const expand565 = (value: number): [number, number, number] => [
  (((value >> 11) & 31) * 255) / 31,
  (((value >> 5) & 63) * 255) / 63,
  ((value & 31) * 255) / 31,
];

/**
 * Decodes one BC1 colour block into 16 RGBA texels. With `hasPunchThrough`,
 * a block whose first colour is not above its second has three colours and
 * a transparent one, as DXT1 defines; DXT3 and DXT5 always use four.
 */
const decodeColourBlock = (
  bytes: Uint8Array,
  at: number,
  out: Uint8Array,
  hasPunchThrough: boolean,
): void => {
  const first = bytes[at] | (bytes[at + 1] << 8);
  const second = bytes[at + 2] | (bytes[at + 3] << 8);
  const [r0, g0, b0] = expand565(first);
  const [r1, g1, b1] = expand565(second);
  const isFourColour = !hasPunchThrough || first > second;
  const colours = [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    isFourColour
      ? [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3, 255]
      : [(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255],
    isFourColour
      ? [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3, 255]
      : [0, 0, 0, 0],
  ];

  for (let texel = 0; texel < 16; texel++) {
    const index = (bytes[at + 4 + (texel >> 2)] >> ((texel & 3) * 2)) & 3;

    out.set(colours[index], texel * 4);
  }
};

/** Decodes a DXT5 alpha block: two endpoints and sixteen 3-bit indices */
const decodeInterpolatedAlpha = (
  bytes: Uint8Array,
  at: number,
  out: Uint8Array,
): void => {
  const first = bytes[at];
  const second = bytes[at + 1];
  const alphas = [first, second];

  for (let step = 1; step < (first > second ? 7 : 5); step++) {
    const steps = first > second ? 7 : 5;

    alphas.push(((steps - step) * first + step * second) / steps);
  }

  if (first <= second) {
    alphas.push(0, 255);
  }

  // The sixteen indices sit in 48 bits, little endian, in two 24-bit halves
  for (let half = 0; half < 2; half++) {
    const bitsValue =
      bytes[at + 2 + half * 3] |
      (bytes[at + 3 + half * 3] << 8) |
      (bytes[at + 4 + half * 3] << 16);

    for (let texel = 0; texel < 8; texel++) {
      out[(half * 8 + texel) * 4 + 3] = alphas[(bitsValue >> (texel * 3)) & 7];
    }
  }
};

/** Decodes a DXT3 alpha block: sixteen explicit 4-bit alphas */
const decodeExplicitAlpha = (
  bytes: Uint8Array,
  at: number,
  out: Uint8Array,
): void => {
  for (let texel = 0; texel < 16; texel++) {
    const nibble = (bytes[at + (texel >> 1)] >> ((texel & 1) * 4)) & 15;

    out[texel * 4 + 3] = nibble * 17;
  }
};

/** Bytes one level of a block-compressed format takes */
const blockLevelLength = (
  width: number,
  height: number,
  blockBytes: number,
): number =>
  Math.max(1, Math.ceil(width / 4)) *
  Math.max(1, Math.ceil(height / 4)) *
  blockBytes;

/** Decodes one block-compressed level into RGBA */
const decodeBlockLevel = (
  bytes: Uint8Array,
  at: number,
  width: number,
  height: number,
  fourCC: string,
): Uint8Array => {
  const pixels = new Uint8Array(width * height * 4);
  const blockBytes = fourCC === 'DXT1' ? 8 : 16;
  const block = new Uint8Array(64);
  let cursor = at;

  for (let blockY = 0; blockY < height; blockY += 4) {
    for (let blockX = 0; blockX < width; blockX += 4) {
      if (fourCC === 'DXT1') {
        decodeColourBlock(bytes, cursor, block, true);
      } else {
        decodeColourBlock(bytes, cursor + 8, block, false);

        if (fourCC === 'DXT3') {
          decodeExplicitAlpha(bytes, cursor, block);
        } else {
          decodeInterpolatedAlpha(bytes, cursor, block);
        }
      }

      cursor += blockBytes;

      // A level smaller than a block uses only its top-left texels
      for (let y = 0; y < 4 && blockY + y < height; y++) {
        for (let x = 0; x < 4 && blockX + x < width; x++) {
          pixels.set(
            block.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4),
            ((blockY + y) * width + blockX + x) * 4,
          );
        }
      }
    }
  }

  return pixels;
};

/** Position and width of a channel within a pixel, from its bit mask */
const maskShape = (mask: number): { shift: number; max: number } => {
  if (!mask) {
    return { shift: 0, max: 0 };
  }

  let shift = 0;

  while (!((mask >>> shift) & 1)) {
    shift++;
  }

  return { shift, max: mask >>> shift };
};

/**
 * Decodes a DDS: DXT1, DXT3 and DXT5 compressed textures and uncompressed
 * 16, 24 and 32-bit ones described by channel masks, with every mip level
 * the file carries.
 */
export const decodeDds = (wrapped: Uint8Array): DecodedTexture => {
  const bytes = unwrapEar(wrapped);

  if (bytes.length < DDS_HEADER_END) {
    throw new Error('Too short for a DDS header');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint32(0, true) !== DDS_MAGIC) {
    throw new Error('Not a DDS file');
  }

  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const levelCount = Math.max(1, view.getUint32(28, true));
  const flags = view.getUint32(80, true);
  const fourCC = String.fromCharCode(...bytes.subarray(84, 88));
  const bitCount = view.getUint32(88, true);
  const masks = [92, 96, 100, 104].map((offset) =>
    view.getUint32(offset, true),
  );

  checkDimensions(width, height);

  const isCompressed = (flags & DDPF_FOURCC) !== 0;

  if (isCompressed && !['DXT1', 'DXT3', 'DXT5'].includes(fourCC)) {
    throw new Error(
      `DDS compression ${JSON.stringify(fourCC)} is not supported`,
    );
  }

  if (
    !isCompressed &&
    (!(flags & DDPF_RGB) || ![16, 24, 32].includes(bitCount))
  ) {
    throw new Error(`DDS pixel format with ${bitCount} bits is not supported`);
  }

  const levels: RgbaImage[] = [];
  let cursor = DDS_HEADER_END;
  let levelWidth = width;
  let levelHeight = height;

  for (let level = 0; level < levelCount && level < 16; level++) {
    const length = isCompressed
      ? blockLevelLength(levelWidth, levelHeight, fourCC === 'DXT1' ? 8 : 16)
      : levelWidth * levelHeight * (bitCount / 8);

    // A file that ends early keeps the levels it does hold
    if (cursor + length > bytes.length) {
      if (!levels.length) {
        throw new Error('DDS pixel data runs past the end of the file');
      }

      break;
    }

    let pixels: Uint8Array;

    if (isCompressed) {
      pixels = decodeBlockLevel(bytes, cursor, levelWidth, levelHeight, fourCC);
    } else {
      const shapes = masks.map(maskShape);
      const bytesPerPixel = bitCount / 8;
      const hasAlphaMask = (flags & DDPF_ALPHAPIXELS) !== 0 && masks[3] !== 0;

      pixels = new Uint8Array(levelWidth * levelHeight * 4);

      for (let pixel = 0; pixel < levelWidth * levelHeight; pixel++) {
        let value = 0;

        for (let byte = 0; byte < bytesPerPixel; byte++) {
          value |= bytes[cursor + pixel * bytesPerPixel + byte] << (byte * 8);
        }

        shapes.forEach(({ shift, max }, channel) => {
          pixels[pixel * 4 + channel] =
            channel === 3 && !hasAlphaMask
              ? 255
              : max
                ? Math.round((((value >>> shift) & max) * 255) / max)
                : 0;
        });
      }
    }

    levels.push({ width: levelWidth, height: levelHeight, pixels });
    cursor += length;
    levelWidth = Math.max(1, levelWidth >> 1);
    levelHeight = Math.max(1, levelHeight >> 1);
  }

  return {
    format: isCompressed ? fourCC : `uncompressed ${bitCount}-bit`,
    // DXT1 carries alpha too, as a punch-through transparent colour
    hasAlpha: isCompressed || (flags & DDPF_ALPHAPIXELS) !== 0,
    levels,
  };
};

/** Tool that decodes a TGA entry to RGBA */
export const decodeTgaTool: Tool<Uint8Array, DecodedTexture> = {
  id: 'texture.decodeTga',
  run: decodeTga,
};

/** Tool that decodes a DDS entry to RGBA, every mip level */
export const decodeDdsTool: Tool<Uint8Array, DecodedTexture> = {
  id: 'texture.decodeDds',
  run: decodeDds,
};
