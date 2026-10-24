import { Picture } from './dsp';
import * as T from './tables';

/**
 * A VP6 encoder, the inverse of `decoder.ts`: it writes exactly what that
 * decoder (and so FFmpeg's and the game's) reads. Simple profile, VP6.0
 * bitstream, two bool-coded partitions; every frame a key frame, coded with
 * the default probabilities. Built from the decoder's own tables and
 * arithmetic, so the round trip is checked in code rather than assumed.
 */

const TOKEN_LARGE = 5;
const VERSION = 6;
const PROFILE_SIMPLE = 0;
const i16 = (value: number) => (value << 16) >> 16;
/** The largest magnitude a token can carry: category 5's base and 11 bits */
const MAX_LEVEL = 67 + 2047;
const clampLevel = (value: number) =>
  Math.max(-MAX_LEVEL, Math.min(MAX_LEVEL, value));

/** VP6's (and VP8's) binary arithmetic coder, writing */
export class BoolEncoder {
  private low = 0;
  private range = 255;
  private count = -24;
  private readonly out: number[] = [];

  public writeBool(bit: boolean, prob: number): void {
    const split = 1 + (((this.range - 1) * prob) >> 8);
    let range = split;

    if (bit) {
      this.low += split;
      range = this.range - split;
    }

    let shift = Math.clz32(range) - 24;

    range <<= shift;
    this.count += shift;

    if (this.count >= 0) {
      const offset = shift - this.count;

      if (((this.low << (offset - 1)) >>> 0) & 0x80000000) {
        let at = this.out.length - 1;

        while (at >= 0 && this.out[at] === 0xff) {
          this.out[at] = 0;
          at--;
        }
        this.out[at]++;
      }
      this.out.push((this.low >>> (24 - offset)) & 0xff);
      this.low = (this.low << offset) & 0xffffff;
      shift = this.count;
      this.count -= 8;
    }
    this.low = (this.low << shift) >>> 0;
    this.range = range;
  }

  public writeFlag(bit: boolean): void {
    this.writeBool(bit, 128);
  }

  public writeBits(value: number, count: number): void {
    for (let bit = count - 1; bit >= 0; bit--) {
      this.writeFlag(((value >> bit) & 1) === 1);
    }
  }

  /** Flushes the coder, as the reference does, and returns its bytes */
  public finish(): Uint8Array {
    for (let index = 0; index < 32; index++) {
      this.writeBool(false, 128);
    }
    return Uint8Array.from(this.out);
  }
}

/** Bits most significant first, for the frame's uncompressed header */
class BitWriter {
  private readonly bytes: number[] = [];
  private bit = 0;

  public write(value: number, count: number): void {
    for (let index = count - 1; index >= 0; index--) {
      if (this.bit === 0) {
        this.bytes.push(0);
      }
      if ((value >> index) & 1) {
        this.bytes[this.bytes.length - 1] |= 0x80 >> this.bit;
      }
      this.bit = (this.bit + 1) & 7;
    }
  }

  public finish(): number[] {
    return this.bytes;
  }
}

/** Orthonormal 8x8 DCT times four: the scale `dsp.idct` inverts */
const COSINES = Array.from({ length: 8 }, (_, frequency) =>
  Array.from(
    { length: 8 },
    (_, x) =>
      Math.cos(((2 * x + 1) * frequency * Math.PI) / 16) *
      (frequency ? Math.sqrt(2 / 8) : Math.sqrt(1 / 8)),
  ),
);

export const forwardDct = (pixels: Float64Array, out: Float64Array): void => {
  const rows = new Float64Array(64);

  for (let y = 0; y < 8; y++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;

      for (let x = 0; x < 8; x++) {
        sum += pixels[y * 8 + x] * COSINES[v][x];
      }
      rows[y * 8 + v] = sum;
    }
  }
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;

      for (let y = 0; y < 8; y++) {
        sum += rows[y * 8 + v] * COSINES[u][y];
      }
      out[u * 8 + v] = sum * 4;
    }
  }
};

/** Writes one coefficient token and its value, as `decodeToken` reads it */
const writeToken = (
  bc: BoolEncoder,
  probs: readonly number[],
  valueProbs: readonly number[],
  value: number,
  needsNonZeroFlag: boolean,
  isDc: boolean,
): void => {
  const level = Math.abs(value);

  if (needsNonZeroFlag) {
    bc.writeBool(level !== 0, probs[0]);
    if (level === 0) {
      if (!isDc) {
        bc.writeBool(true, probs[1]);
      }
      return;
    }
  }

  if (level === 1) {
    bc.writeBool(false, probs[2]);
  } else if (level < TOKEN_LARGE) {
    bc.writeBool(true, probs[2]);
    bc.writeBool(false, probs[3]);
    bc.writeBool(level !== 2, probs[4]);
    if (level !== 2) {
      bc.writeBool(level === 4, probs[5]);
    }
  } else {
    bc.writeBool(true, probs[2]);
    bc.writeBool(true, probs[3]);

    let category = T.VP56_COEF_BASE.length - 1;

    while (category > 0 && level < T.VP56_COEF_BASE[category]) {
      category--;
    }

    // The category tree: 0/1 under one branch, 2/3 and 4/5 under the other
    bc.writeBool(category >= 2, valueProbs[6]);
    if (category < 2) {
      bc.writeBool(category === 1, valueProbs[7]);
    } else {
      bc.writeBool(category >= 4, valueProbs[8]);
      bc.writeBool(category % 2 === 1, valueProbs[category < 4 ? 9 : 10]);
    }

    const extra = level - T.VP56_COEF_BASE[category];
    const addProbs = T.VP56_COEF_ADD_PROBS[category];
    const bits = addProbs.indexOf(128);

    for (let bit = 0; bit < bits; bit++) {
      bc.writeBool(((extra >> (bits - 1 - bit)) & 1) === 1, addProbs[bit]);
    }
  }
  bc.writeFlag(value < 0);
};

/** Writes a run of zeros after a zero token, as `decodeZeroRun` reads it */
const writeZeroRun = (
  bc: BoolEncoder,
  probs: readonly number[],
  run: number,
): void => {
  if (run < 8) {
    bc.writeBool(run >= 4, probs[0]);
    if (run < 4) {
      bc.writeBool(run >= 2, probs[1]);
      bc.writeBool(run % 2 === 1, probs[run < 2 ? 2 : 3]);
    } else {
      bc.writeBool(false, probs[4]);
      bc.writeBool(run >= 6, probs[5]);
      bc.writeBool(run % 2 === 1, probs[run < 6 ? 6 : 7]);
    }
    return;
  }
  bc.writeBool(true, probs[0]);
  bc.writeBool(true, probs[4]);

  const extra = run - 8;

  for (let index = 8; index < probs.length; index++) {
    bc.writeBool(((extra >> (index - 8)) & 1) === 1, probs[index]);
  }
};

/** The coefficient probabilities a key frame with no updates leaves */
const defaultModel = () => {
  const dcValueProbs = new Array<number>(11).fill(128);
  const dcTokenProbs = [0, 1, 2].map((ctx) =>
    [0, 1, 2, 3, 4].map((slot) => {
      const [scale, add] = T.VP6_DC_WEIGHTS[slot]?.[ctx] ?? [0, 1];

      return Math.max(1, Math.min(255, ((128 * scale + 128) >> 8) + add));
    }),
  );

  return {
    dcValueProbs,
    dcTokenProbs,
    acValueProbs: new Array<number>(11).fill(128),
    zeroRunProbs: T.ZERO_RUN_PROBS.map((row) => [...row]),
  };
};

/** The DC predictor of an intra frame, mirroring the decoder's */
class IntraDcPredictor {
  private readonly dc: Int16Array[];
  private readonly seenY: Uint8Array;
  private readonly seenC: Uint8Array;
  private leftY = [0, 0];
  private leftU = 0;
  private leftV = 0;
  private leftSeen = false;
  private yIdx = 1;
  private cIdx = 1;
  private lastDc = [0, 0x80, 0x80];

  public constructor(mbWidth: number) {
    this.dc = [
      new Int16Array(mbWidth * 2 + 2),
      new Int16Array(mbWidth + 2),
      new Int16Array(mbWidth + 2),
    ];
    this.seenY = new Uint8Array(mbWidth * 2 + 2);
    this.seenC = new Uint8Array(mbWidth + 2);
  }

  public newRow(): void {
    this.yIdx = 1;
    this.cIdx = 1;
    this.leftY = [0, 0];
    this.leftU = 0;
    this.leftV = 0;
    this.leftSeen = false;
  }

  public nextMb(): void {
    this.yIdx += 2;
    this.cIdx += 1;
  }

  public predict(blockNo: number): number {
    const luma = blockNo < 4;
    const plane = luma ? 0 : blockNo - 3;
    const index = luma ? this.yIdx + (blockNo & 1) : this.cIdx;
    const seen = luma ? this.seenY : this.seenC;
    let sum = 0;
    let count = 0;

    if ((luma && (blockNo & 1) === 1) || this.leftSeen) {
      sum +=
        blockNo <= 1
          ? this.leftY[0]
          : blockNo <= 3
            ? this.leftY[1]
            : blockNo === 4
              ? this.leftU
              : this.leftV;
      count++;
    }
    if (seen[index]) {
      sum += this.dc[plane][index];
      count++;
    }
    sum = i16(sum);
    return count === 0
      ? this.lastDc[plane]
      : count === 2
        ? Math.trunc(sum / 2)
        : sum;
  }

  public update(blockNo: number, dc: number): void {
    const luma = blockNo < 4;
    const plane = luma ? 0 : blockNo - 3;
    const index = luma ? this.yIdx + (blockNo & 1) : this.cIdx;

    if (blockNo !== 4) {
      (luma ? this.seenY : this.seenC)[index] = 1;
    }
    if (blockNo <= 1) {
      this.leftY[0] = dc;
    } else if (blockNo <= 3) {
      this.leftY[1] = dc;
    } else if (blockNo === 4) {
      this.leftU = dc;
    } else {
      this.leftV = dc;
      this.leftSeen = true;
    }
    this.dc[plane][index] = dc;
    this.lastDc[plane] = dc;
  }
}

export interface EncodeOptions {
  /** 0 (smallest) to 63 (best), VP6's quantizer index */
  quality: number;
}

/** Encodes pictures, each as a key frame */
export class Vp6Encoder {
  private readonly quality: number;

  public constructor(options: EncodeOptions) {
    this.quality = Math.max(0, Math.min(63, Math.round(options.quality)));
  }

  /** One key frame of `picture`, whose size is whole macroblocks */
  public encodeKey(picture: Picture): Uint8Array {
    const mbWidth = picture.width / 16;
    const mbHeight = picture.height / 16;

    if (
      !Number.isInteger(mbWidth) ||
      !Number.isInteger(mbHeight) ||
      mbWidth < 1 ||
      mbHeight < 1 ||
      mbWidth > 255 ||
      mbHeight > 255
    ) {
      throw new Error('A VP6 picture is 1 to 255 whole macroblocks a side');
    }

    const q = this.quality;
    const dcQuant = T.VP56_DC_QUANTS[q] * 4;
    const acQuant = T.VP56_AC_QUANTS[q] * 4;
    const header = new BoolEncoder();

    header.writeBits(mbHeight, 8);
    header.writeBits(mbWidth, 8);
    header.writeBits(mbHeight, 8);
    header.writeBits(mbWidth, 8);
    header.writeBits(0, 2);
    header.writeFlag(false); // bool-coded, not Huffman

    // No probability updates: every coefficient probability is the default
    for (const has of T.HAS_COEF_PROBS) {
      has.forEach((prob) => header.writeBool(false, prob));
    }
    header.writeFlag(false); // default scan order
    for (const has of T.HAS_ZERO_RUN_PROBS) {
      has.forEach((prob) => header.writeBool(false, prob));
    }
    for (const planes of T.VP6_AC_PROBS) {
      for (const groups of planes) {
        for (const group of groups) {
          group.forEach((prob) => header.writeBool(false, prob));
        }
      }
    }

    const model = defaultModel();
    const coefficients = new BoolEncoder();
    const predictor = new IntraDcPredictor(mbWidth);
    const topCtx = [
      new Uint8Array(mbWidth * 2),
      new Uint8Array(mbWidth),
      new Uint8Array(mbWidth),
    ];
    const pixels = new Float64Array(64);
    const transformed = new Float64Array(64);

    for (let mbY = 0; mbY < mbHeight; mbY++) {
      const leftCtx = [0, 0, 0, 0];

      for (let mbX = 0; mbX < mbWidth; mbX++) {
        for (let blockNo = 0; blockNo < 6; blockNo++) {
          const luma = blockNo < 4;
          const plane = picture.planes[luma ? 0 : blockNo - 3];
          const bx = luma ? mbX * 2 + (blockNo & 1) : mbX;
          const by = luma ? mbY * 2 + (blockNo >> 1) : mbY;

          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              pixels[y * 8 + x] =
                plane.data[(by * 8 + y) * plane.width + bx * 8 + x] - 128;
            }
          }
          forwardDct(pixels, transformed);

          const dc = i16(Math.round(transformed[0] / dcQuant));
          const prediction = predictor.predict(blockNo);
          const dcToken = clampLevel(dc - prediction);

          predictor.update(blockNo, i16(prediction + dcToken));

          const levels = new Int16Array(64);

          for (let index = 1; index < 64; index++) {
            levels[index] = clampLevel(
              Math.round(transformed[T.ZIGZAG[index]] / acQuant),
            );
          }

          const ctxIdx = luma ? blockNo >> 1 : blockNo - 2;
          const planeIdx = luma ? 0 : blockNo - 3;
          const topPos = luma ? mbX * 2 + (blockNo & 1) : mbX;
          const context = topCtx[planeIdx][topPos] + leftCtx[ctxIdx];
          const dcProbs = [
            ...model.dcTokenProbs[context],
            ...model.dcValueProbs.slice(5),
          ];

          writeToken(
            coefficients,
            dcProbs,
            model.dcValueProbs,
            dcToken,
            true,
            true,
          );

          let last = 63;

          while (last > 0 && levels[last] === 0) {
            last--;
          }

          let index = 1;
          let previous = dcToken;

          while (index < 64) {
            const probs = model.acValueProbs;
            const needsFlag = index === 1 || previous !== 0;

            if (index > last) {
              // End of block: a zero token whose second flag says "stop"
              coefficients.writeBool(false, probs[0]);
              coefficients.writeBool(false, probs[1]);
              break;
            }

            const value = levels[index];

            if (value !== 0) {
              writeToken(coefficients, probs, probs, value, needsFlag, false);
              index++;
              previous = value;
              continue;
            }

            // A zero, then the further zeros before the next value
            writeToken(coefficients, probs, probs, 0, needsFlag, false);
            index++;

            let run = 0;

            while (index + run <= last && levels[index + run] === 0) {
              run++;
            }
            writeZeroRun(
              coefficients,
              model.zeroRunProbs[index >= 7 ? 1 : 0],
              run,
            );
            index += run;
            previous = 0;
          }

          const category = dcToken !== 0 ? 1 : 0;

          leftCtx[ctxIdx] = category;
          topCtx[planeIdx][topPos] = category;
        }
        predictor.nextMb();
      }
      predictor.newRow();
    }

    const first = header.finish();
    const second = coefficients.finish();
    const bits = new BitWriter();
    const offset = 4 + first.length;

    if (offset > 0xffff) {
      throw new Error('The frame header partition is too large');
    }
    bits.write(0, 1); // key frame
    bits.write(q, 6);
    bits.write(1, 1); // two partitions
    bits.write(VERSION, 5);
    bits.write(PROFILE_SIMPLE, 2);
    bits.write(0, 1); // progressive
    bits.write(offset, 16);

    const frame = new Uint8Array(offset + second.length);

    frame.set(bits.finish(), 0);
    frame.set(first, 4);
    frame.set(second, offset);
    return frame;
  }
}

/**
 * RGBA to the planes VP6 codes: the inverse of the retail player's colour
 * conversion, padded to whole macroblocks by repeating the edge, and bottom
 * row first as EA's movies store it
 */
export const pictureFromRgba = (
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  alpha = false,
): Picture => {
  const picture = new Picture(Math.ceil(width / 16), Math.ceil(height / 16));
  const [yPlane, uPlane, vPlane] = picture.planes;
  const sumU = new Float64Array(uPlane.width * uPlane.height);
  const sumV = new Float64Array(sumU.length);
  const clamp = (value: number) =>
    value < 0 ? 0 : value > 255 ? 255 : Math.round(value);

  for (let row = 0; row < yPlane.height; row++) {
    // Coded row 0 is the bottom of the image; padding repeats the top row
    const imageRow = Math.min(height - 1, yPlane.height - 1 - row);

    for (let column = 0; column < yPlane.width; column++) {
      const at = (imageRow * width + Math.min(width - 1, column)) * 4;
      let y: number;
      let u = 0;
      let v = 0;

      if (alpha) {
        // The player maps 23..234 onto 0..255
        y = (rgba[at + 3] * 211) / 255 + 23;
      } else {
        // The player scales by 6/5 and lowers by 15; undo that first
        const [r, g, b] = [0, 1, 2].map(
          (channel) => (rgba[at + channel] * 5 + 75) / 6,
        );

        y = 0.299 * r + 0.587 * g + 0.114 * b;
        u = (b - y) / (443 / 256);
        v = (r - y) / (351 / 256);
      }
      yPlane.data[row * yPlane.width + column] = clamp(y);

      const chroma = (row >> 1) * uPlane.width + (column >> 1);

      sumU[chroma] += u;
      sumV[chroma] += v;
    }
  }
  for (let index = 0; index < sumU.length; index++) {
    uPlane.data[index] = clamp(sumU[index] / 4 + 128);
    vPlane.data[index] = clamp(sumV[index] / 4 + 128);
  }
  return picture;
};
