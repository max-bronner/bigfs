import { Vp6Decoder } from './decoder';
import type { Picture } from './dsp';

/**
 * EA's VP6 movie container, after mint's `crates/sage/vp6`:
 *
 * ```
 * ["AVP6" chunk, empty]                 only when the movie has alpha
 * "MVhd" fourcc, u16 width, height, u32 frames, max chunk, rate num, rate den
 * ["AVhd" the same, for the alpha stream]
 * then chunks: "MV0K"/"MV0F" colour key/inter, "AV0K"/"AV0F" alpha
 * ```
 *
 * Every chunk is a tag and a u32 size that counts its own 8-byte header.
 * Pictures are coded bottom-up and in whole macroblocks; `Vp6Movie` crops
 * and flips them, and converts colour the way the retail player does
 * (mint's `crates/core/movie/src/yuv.rs`).
 */

export interface Vp6Header {
  width: number;
  height: number;
  frameCount: number;
  /** Frames per second is numerator over denominator */
  rateNumerator: number;
  rateDenominator: number;
}

interface FrameChunks {
  colour: Uint8Array;
  isKey: boolean;
  alpha?: Uint8Array;
  isAlphaKey?: boolean;
}

const tag = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(...bytes.subarray(at, at + 4));

const readHeader = (
  bytes: Uint8Array,
  at: number,
  expected: string,
): [Vp6Header, number] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (
    at + 32 > bytes.length ||
    tag(bytes, at) !== expected ||
    view.getUint32(at + 4, true) !== 32
  ) {
    throw new Error(`Expected a ${expected} header at ${at}`);
  }

  return [
    {
      width: view.getUint16(at + 12, true),
      height: view.getUint16(at + 14, true),
      frameCount: view.getUint32(at + 16, true),
      rateNumerator: view.getUint32(at + 24, true),
      rateDenominator: view.getUint32(at + 28, true),
    },
    at + 32,
  ];
};

/** Splits a movie into its header and per-frame chunks */
export const parseVp6 = (
  bytes: Uint8Array,
): { header: Vp6Header; hasAlpha: boolean; frames: FrameChunks[] } => {
  if (bytes.length === 0) {
    throw new Error('The file is empty');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const hasAlpha = tag(bytes, 0) === 'AVP6';

  if (hasAlpha) {
    at = view.getUint32(4, true);
  }

  const [header, afterHeader] = readHeader(bytes, at, 'MVhd');

  at = afterHeader;

  if (hasAlpha) {
    at = readHeader(bytes, at, 'AVhd')[1];
  }

  const frames: FrameChunks[] = [];
  let alpha: Uint8Array | undefined;
  let isAlphaKey = false;

  while (at + 8 <= bytes.length) {
    const kind = tag(bytes, at);
    const size = view.getUint32(at + 4, true);

    if (size < 8 || at + size > bytes.length) {
      throw new Error(`Chunk ${kind} at ${at} runs past the end of the movie`);
    }

    const payload = bytes.subarray(at + 8, at + size);

    if (kind === 'AV0K' || kind === 'AV0F') {
      alpha = payload;
      isAlphaKey = kind === 'AV0K';
    } else if (kind === 'MV0K' || kind === 'MV0F') {
      frames.push({
        colour: payload,
        isKey: kind === 'MV0K',
        alpha,
        isAlphaKey,
      });
      alpha = undefined;
      isAlphaKey = false;
    } else {
      throw new Error(`Unexpected chunk ${JSON.stringify(kind)} at ${at}`);
    }

    at += size;
  }

  return { header, hasAlpha, frames };
};

const clampByte = (value: number) =>
  value < 0 ? 0 : value > 255 ? 255 : value;
const channel = (sum: number) => clampByte(Math.trunc((sum * 6 - 75) / 5));

/** Converts planes to RGBA, cropped to `width` × `height`, top row first */
export const toRgba = (
  picture: Picture,
  width: number,
  height: number,
  alpha?: Picture,
): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(width * height * 4);
  const [yPlane, uPlane, vPlane] = picture.planes;
  const rows = Math.min(height, yPlane.height);
  const columns = Math.min(width, yPlane.width);

  for (let row = 0; row < rows; row++) {
    // Row 0 of the coded picture is the bottom of the image
    const source = yPlane.height - 1 - row;
    const chromaRow = source >> 1;

    for (let column = 0; column < columns; column++) {
      const y = yPlane.data[source * yPlane.width + column];
      const u = uPlane.data[chromaRow * uPlane.width + (column >> 1)] - 128;
      const v = vPlane.data[chromaRow * vPlane.width + (column >> 1)] - 128;
      const at = (row * width + column) * 4;

      out[at] = channel(y + Math.trunc((351 * v) / 256));
      out[at + 1] = channel(
        y + Math.trunc((-86 * u) / 256) + Math.trunc((-179 * v) / 256),
      );
      out[at + 2] = channel(y + Math.trunc((443 * u) / 256));
      out[at + 3] = alpha
        ? clampByte(
            Math.trunc(
              (255 *
                (alpha.planes[0].data[source * alpha.planes[0].width + column] -
                  23)) /
                211,
            ),
          )
        : 255;
    }
  }

  return out;
};

/** A movie decoded on demand, frame by frame, seeking through key frames */
export class Vp6Movie {
  public readonly header: Vp6Header;
  public readonly hasAlpha: boolean;
  private readonly frames: FrameChunks[];
  private colour = new Vp6Decoder();
  private alpha = new Vp6Decoder();
  private next = 0;
  /** First frames each decoder may decode: its own stream's key frames */
  private colourFrom = 0;
  private alphaFrom = 0;
  private lastAlpha?: Picture;

  public constructor(bytes: Uint8Array) {
    const parsed = parseVp6(bytes);

    this.header = parsed.header;
    this.hasAlpha = parsed.hasAlpha;
    this.frames = parsed.frames;
  }

  public get frameCount(): number {
    return this.frames.length;
  }

  public get framesPerSecond(): number {
    const { rateNumerator, rateDenominator } = this.header;

    return rateNumerator && rateDenominator
      ? rateNumerator / rateDenominator
      : 15;
  }

  /** The RGBA image of frame `index` */
  public frame(index: number): Uint8ClampedArray {
    const target = Math.max(0, Math.min(this.frames.length - 1, index));

    // Going back, or far ahead, starts again from key frames before it. The
    // colour and alpha streams key independently, so decode forward from the
    // earlier of the two, each decoder skipping frames before its own key.
    if (target < this.next || target - this.next > 60) {
      let colourKey = target;

      while (colourKey > 0 && !this.frames[colourKey].isKey) {
        colourKey--;
      }

      let alphaKey = this.hasAlpha ? target : colourKey;

      while (
        this.hasAlpha &&
        alphaKey > 0 &&
        !(this.frames[alphaKey].alpha && this.frames[alphaKey].isAlphaKey)
      ) {
        alphaKey--;
      }

      const start = Math.min(colourKey, alphaKey);

      if (start >= this.next || target < this.next) {
        this.colour = new Vp6Decoder();
        this.alpha = new Vp6Decoder();
        this.lastAlpha = undefined;
        this.next = start;
        this.colourFrom = colourKey;
        this.alphaFrom = alphaKey;
      }
    }

    let picture: Picture | undefined;

    for (; this.next <= target; this.next++) {
      const chunks = this.frames[this.next];

      if (this.next >= this.colourFrom) {
        picture = this.colour.decode(chunks.colour);
      }
      if (chunks.alpha && this.next >= this.alphaFrom) {
        this.lastAlpha = this.alpha.decode(chunks.alpha);
      }
    }

    if (!picture) {
      throw new Error('The movie has no frames');
    }

    return toRgba(
      picture,
      this.header.width,
      this.header.height,
      this.hasAlpha ? this.lastAlpha : undefined,
    );
  }
}

/** A movie to write: its size, rate and coded frames */
export interface Vp6Output {
  width: number;
  height: number;
  rateNumerator: number;
  rateDenominator: number;
  frames: {
    colour: Uint8Array;
    isKey: boolean;
    alpha?: Uint8Array;
    /** Whether the alpha chunk is a key frame; follows `isKey` when unset */
    isAlphaKey?: boolean;
  }[];
}

const latin1 = (text: string) =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));

/** Writes EA's container around coded frames, as `parseVp6` reads it */
export const writeVp6 = (movie: Vp6Output): Uint8Array => {
  const hasAlpha = movie.frames.some((frame) => frame.alpha);
  const chunk = (kind: string, payload: Uint8Array) => {
    const out = new Uint8Array(8 + payload.length);

    out.set(latin1(kind), 0);
    new DataView(out.buffer).setUint32(4, out.length, true);
    out.set(payload, 8);
    return out;
  };
  const body = movie.frames.flatMap((frame) => [
    ...(frame.alpha
      ? [
          chunk(
            (frame.isAlphaKey ?? frame.isKey) ? 'AV0K' : 'AV0F',
            frame.alpha,
          ),
        ]
      : []),
    chunk(frame.isKey ? 'MV0K' : 'MV0F', frame.colour),
  ]);
  const largest = Math.max(0, ...body.map((part) => part.length));
  const header = (kind: string) => {
    const out = new Uint8Array(32);
    const view = new DataView(out.buffer);

    out.set(latin1(kind), 0);
    view.setUint32(4, 32, true);
    out.set(latin1('vp60'), 8);
    view.setUint16(12, movie.width, true);
    view.setUint16(14, movie.height, true);
    view.setUint32(16, movie.frames.length, true);
    view.setUint32(20, largest, true);
    view.setUint32(24, movie.rateNumerator, true);
    view.setUint32(28, movie.rateDenominator, true);
    return out;
  };
  const parts = [
    ...(hasAlpha ? [chunk('AVP6', new Uint8Array(0))] : []),
    header('MVhd'),
    ...(hasAlpha ? [header('AVhd')] : []),
    ...body,
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
