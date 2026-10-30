import { writeVp6 } from './container';
import { Vp6Encoder, pictureFromRgba } from './encoder';

/**
 * Encoding of a whole movie from a stream of RGBA frames: colour, and alpha
 * when the source asks for it, each its own VP6 stream as EA's movies carry
 * them. Frames are pulled one at a time, so a long movie never sits in
 * memory as pictures.
 */

/** Source of RGBA frames for `encodeMovie`, pulled one at a time */
export interface FrameSource {
  width: number;
  height: number;
  rateNumerator: number;
  rateDenominator: number;
  /** Whether the frames carry alpha the movie should keep */
  alpha: boolean;
  /** Reads the next frame, `width * height * 4` bytes, or `undefined` at the end */
  next(): Promise<Uint8Array | undefined>;
}

/** Settings for `encodeMovie` */
export interface MovieOptions {
  /** 0 (smallest) to 63 (best), VP6's quantizer index */
  quality: number;
  /** Frames between forced key frames; scene changes add their own */
  keyInterval?: number;
  /** Called after each frame with the number done */
  progress?: (frames: number) => void;
  /** Checked between frames; true stops the encode */
  cancelled?: () => boolean;
}

/** Largest picture side in pixels VP6 can code (255 macroblocks), checked before encoding */
export const MAX_SIDE = 255 * 16;

/**
 * Encodes a movie in EA's VP6 container, with a key frame every two seconds
 * unless `keyInterval` says otherwise.
 * @returns `undefined` when `cancelled` stopped the encode
 */
export const encodeMovie = async (
  source: FrameSource,
  options: MovieOptions,
): Promise<Uint8Array | undefined> => {
  const { width, height } = source;

  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) {
    throw new Error(`A VP6 movie is 1 to ${MAX_SIDE} pixels a side`);
  }

  const colour = new Vp6Encoder({ quality: options.quality });
  const alpha = new Vp6Encoder({ quality: options.quality });
  const keyInterval = Math.max(
    1,
    Math.round(
      options.keyInterval ??
        (2 * source.rateNumerator) / Math.max(1, source.rateDenominator),
    ),
  );
  const frames: { colour: Uint8Array; isKey: boolean; alpha?: Uint8Array }[] =
    [];

  for (;;) {
    if (options.cancelled?.()) {
      return undefined;
    }

    const rgba = await source.next();

    if (!rgba) {
      break;
    }
    if (rgba.length < width * height * 4) {
      throw new Error(`Frame ${frames.length + 1} is smaller than the movie`);
    }
    const forceKey = frames.length % keyInterval === 0;
    const coded = colour.encode(pictureFromRgba(rgba, width, height), forceKey);

    // Seeking restarts both streams at a colour key frame, so alpha keys there too
    frames.push({
      colour: coded.data,
      isKey: coded.isKey,
      alpha: source.alpha
        ? alpha.encode(pictureFromRgba(rgba, width, height, true), coded.isKey)
            .data
        : undefined,
    });
    options.progress?.(frames.length);
  }

  if (!frames.length) {
    throw new Error('The source has no frames');
  }
  return writeVp6({
    width,
    height,
    rateNumerator: source.rateNumerator,
    rateDenominator: source.rateDenominator,
    frames,
  });
};

/** Resizes an RGBA image bilinearly, for sources that cannot scale themselves */
export const resizeRgba = (
  rgba: Uint8Array,
  width: number,
  height: number,
  toWidth: number,
  toHeight: number,
): Uint8Array => {
  if (width === toWidth && height === toHeight) {
    return rgba;
  }

  const out = new Uint8Array(toWidth * toHeight * 4);

  for (let y = 0; y < toHeight; y++) {
    const sy = Math.max(0, ((y + 0.5) * height) / toHeight - 0.5);
    const y0 = Math.min(height - 1, Math.floor(sy));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;

    for (let x = 0; x < toWidth; x++) {
      const sx = Math.max(0, ((x + 0.5) * width) / toWidth - 0.5);
      const x0 = Math.min(width - 1, Math.floor(sx));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;

      for (let channel = 0; channel < 4; channel++) {
        const at = (yy: number, xx: number) =>
          rgba[(yy * width + xx) * 4 + channel];
        const top = at(y0, x0) * (1 - fx) + at(y0, x1) * fx;
        const bottom = at(y1, x0) * (1 - fx) + at(y1, x1) * fx;

        out[(y * toWidth + x) * 4 + channel] = Math.round(
          top * (1 - fy) + bottom * fy,
        );
      }
    }
  }
  return out;
};
