import { MODEL_INDEX, Vp6Decoder, predictMb } from './decoder';
import { Picture } from './dsp';
import { mcBlock } from './dsp';
import type { Filter, Mv } from './dsp';
import { Models } from './models';
import type { MvModel } from './models';
import {
  DcPredictor,
  MbType,
  Ref,
  ZERO_MV,
  mvCandidates,
  referenceOf,
} from './prediction';
import type { MvCandidates } from './prediction';
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

/**
 * Where binary decisions go: the arithmetic coder, or a counter that
 * learns which probabilities the frame wants. A decision names the table
 * and slot its probability comes from, so counts land on model entries.
 */
interface Sink {
  put(bit: boolean, table: readonly number[], slot: number): void;
}

const SIGN_TABLE = [128] as const;

class WriteSink implements Sink {
  public constructor(private readonly bc: BoolEncoder) {}

  public put(bit: boolean, table: readonly number[], slot: number): void {
    this.bc.writeBool(bit, table[slot]);
  }
}

/** Counts zeros and ones per table slot */
class CountSink implements Sink {
  public readonly counts = new Map<readonly number[], number[]>();

  public put(bit: boolean, table: readonly number[], slot: number): void {
    let counts = this.counts.get(table);

    if (!counts) {
      counts = new Array<number>(table.length * 2).fill(0);
      this.counts.set(table, counts);
    }
    counts[slot * 2 + (bit ? 1 : 0)]++;
  }

  public of(table: readonly number[], slot: number): [number, number] {
    const counts = this.counts.get(table);

    return counts ? [counts[slot * 2], counts[slot * 2 + 1]] : [0, 0];
  }
}

/** Bits a decision costs at a probability of `prob / 256` for false */
const bitCost = (zeros: number, ones: number, prob: number): number =>
  (zeros ? -zeros * Math.log2(prob / 256) : 0) +
  (ones ? -ones * Math.log2(1 - prob / 256) : 0);

/** The probabilities a 7-bit update can carry: 1, then even values */
const SENDABLE = [1, ...Array.from({ length: 127 }, (_, raw) => (raw + 1) * 2)];

/** The sendable probability closest to the counts' own */
const bestSendable = (zeros: number, ones: number): number => {
  const ideal = (256 * (zeros + 0.5)) / (zeros + ones + 1);

  return SENDABLE.reduce((best, value) =>
    Math.abs(value - ideal) < Math.abs(best - ideal) ? value : best,
  );
};

/**
 * One coefficient token and its value, as `decodeToken` and `expandToken`
 * read them. `token(slot)` names where slot `slot`'s probability lives.
 */
const writeToken = (
  sink: Sink,
  token: (slot: number) => [readonly number[], number],
  valueTable: readonly number[],
  value: number,
  needsNonZeroFlag: boolean,
  isDc: boolean,
): void => {
  const put = (bit: boolean, slot: number) => {
    const [table, index] = token(slot);

    sink.put(bit, table, index);
  };
  const level = Math.abs(value);

  if (needsNonZeroFlag) {
    put(level !== 0, 0);
    if (level === 0) {
      if (!isDc) {
        put(true, 1);
      }
      return;
    }
  }

  if (level === 1) {
    put(false, 2);
  } else if (level < TOKEN_LARGE) {
    put(true, 2);
    put(false, 3);
    put(level !== 2, 4);
    if (level !== 2) {
      put(level === 4, 5);
    }
  } else {
    put(true, 2);
    put(true, 3);

    let category = T.VP56_COEF_BASE.length - 1;

    while (category > 0 && level < T.VP56_COEF_BASE[category]) {
      category--;
    }

    // The category tree: 0/1 under one branch, 2/3 and 4/5 under the other
    sink.put(category >= 2, valueTable, 6);
    if (category < 2) {
      sink.put(category === 1, valueTable, 7);
    } else {
      sink.put(category >= 4, valueTable, 8);
      sink.put(category % 2 === 1, valueTable, category < 4 ? 9 : 10);
    }

    const extra = level - T.VP56_COEF_BASE[category];
    const addProbs = T.VP56_COEF_ADD_PROBS[category];
    const bits = addProbs.indexOf(128);

    for (let bit = 0; bit < bits; bit++) {
      sink.put(((extra >> (bits - 1 - bit)) & 1) === 1, addProbs, bit);
    }
  }
  sink.put(value < 0, SIGN_TABLE, 0);
};

/** A run of zeros after a zero token, as `decodeZeroRun` reads it */
const writeZeroRun = (
  sink: Sink,
  probs: readonly number[],
  run: number,
): void => {
  if (run < 8) {
    sink.put(run >= 4, probs, 0);
    if (run < 4) {
      sink.put(run >= 2, probs, 1);
      sink.put(run % 2 === 1, probs, run < 2 ? 2 : 3);
    } else {
      sink.put(false, probs, 4);
      sink.put(run >= 6, probs, 5);
      sink.put(run % 2 === 1, probs, run < 6 ? 6 : 7);
    }
    return;
  }
  sink.put(true, probs, 0);
  sink.put(true, probs, 4);

  const extra = run - 8;

  for (let index = 8; index < probs.length; index++) {
    sink.put(((extra >> (index - 8)) & 1) === 1, probs, index);
  }
};

/** A motion vector component, as `decodeMvComponent` reads it */
const writeMvComponent = (sink: Sink, model: MvModel, value: number): void => {
  const magnitude = Math.abs(value);
  const tree = model.treeProbs;

  if (magnitude < 8) {
    sink.put(false, [model.nzProb], 0);
    sink.put(magnitude >= 4, tree, 0);
    if (magnitude < 4) {
      sink.put(magnitude >= 2, tree, 1);
      sink.put(magnitude % 2 === 1, tree, magnitude < 2 ? 2 : 3);
    } else {
      sink.put(magnitude >= 6, tree, 4);
      sink.put(magnitude % 2 === 1, tree, magnitude < 6 ? 5 : 6);
    }
  } else {
    sink.put(true, [model.nzProb], 0);
    for (const bit of T.LONG_VECTOR_ORDER) {
      sink.put(((magnitude >> bit) & 1) === 1, model.rawProbs, bit);
    }
    if (magnitude & 0xf0) {
      sink.put(((magnitude >> 3) & 1) === 1, model.rawProbs, 3);
    }
  }
  if (magnitude !== 0) {
    sink.put(value < 0, [model.signProb], 0);
  }
};

export interface EncodeOptions {
  /** 0 (smallest) to 63 (best), VP6's quantizer index */
  quality: number;
}

/** One coded block: its DC token and its AC levels in scan order */
interface CodedBlock {
  dcToken: number;
  levels: Int16Array;
  last: number;
}

interface CodedMb {
  type: MbType;
  mv: Mv;
  blocks: CodedBlock[];
}

/** The mode decision weight of a bit, in units of absolute pixel error */
const lambdaOf = (acQuant: number) => Math.max(1, acQuant / 6);

/**
 * Encodes pictures as key frames and inter frames. Inter macroblocks are
 * predicted from the previous decoded frame along a searched motion vector
 * (or none, or a neighbour's), and coded as their residual; probabilities
 * are learnt per frame from a counting pass and sent where they pay. The
 * reference is the frame as the decoder rebuilds it, so prediction never
 * drifts.
 */
export class Vp6Encoder {
  private readonly quality: number;
  private readonly models = new Models();
  private readonly decoder = new Vp6Decoder();
  private reference?: Picture;
  private mbWidth = 0;
  private mbHeight = 0;

  public constructor(options: EncodeOptions) {
    this.quality = Math.max(0, Math.min(63, Math.round(options.quality)));
  }

  /** One key frame of `picture`, whose size is whole macroblocks */
  public encodeKey(picture: Picture): Uint8Array {
    return this.encode(picture, true).data;
  }

  /**
   * One frame: a key frame when asked, at the start, or when most of the
   * picture is new; an inter frame otherwise
   */
  public encode(
    picture: Picture,
    forceKey = false,
  ): { data: Uint8Array; isKey: boolean } {
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

    const sizeChanged = mbWidth !== this.mbWidth || mbHeight !== this.mbHeight;

    [this.mbWidth, this.mbHeight] = [mbWidth, mbHeight];

    let isKey = forceKey || sizeChanged || !this.reference;
    let mbs = isKey ? undefined : this.decide(picture);

    // A scene change: most macroblocks gave up on the previous frame
    if (
      mbs &&
      mbs.filter((mb) => mb.type === MbType.Intra).length > mbs.length * 0.6
    ) {
      isKey = true;
      mbs = undefined;
    }
    mbs ??= this.decideIntra(picture);

    const data = this.write(mbs, isKey);

    // The next frame predicts from what the decoder makes of this one
    this.reference = this.decoder.decode(data).clone();
    return { data, isKey };
  }

  private get quants() {
    return {
      dc: T.VP56_DC_QUANTS[this.quality] * 4,
      ac: T.VP56_AC_QUANTS[this.quality] * 4,
    };
  }

  /** Quantized blocks of a macroblock's residual from `prediction` */
  private codeMb(
    picture: Picture,
    prediction: Picture | undefined,
    mbX: number,
    mbY: number,
  ): { levels: Int16Array; dc: number }[] {
    const { dc: dcQuant, ac: acQuant } = this.quants;
    const pixels = new Float64Array(64);
    const transformed = new Float64Array(64);

    return [0, 1, 2, 3, 4, 5].map((blockNo) => {
      const luma = blockNo < 4;
      const planeNo = luma ? 0 : blockNo - 3;
      const plane = picture.planes[planeNo];
      const predicted = prediction?.planes[planeNo];
      const bx = luma ? mbX * 2 + (blockNo & 1) : mbX;
      const by = luma ? mbY * 2 + (blockNo >> 1) : mbY;

      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const at = (by * 8 + y) * plane.width + bx * 8 + x;

          pixels[y * 8 + x] =
            plane.data[at] - (predicted ? predicted.data[at] : 128);
        }
      }
      forwardDct(pixels, transformed);

      const levels = new Int16Array(64);

      for (let index = 1; index < 64; index++) {
        const coefficient = transformed[T.ZIGZAG[index]] / acQuant;

        // A slight dead zone: lone small values cost more than they give
        levels[index] = clampLevel(
          Math.sign(coefficient) * Math.floor(Math.abs(coefficient) + 0.4),
        );
      }
      return { levels, dc: i16(Math.round(transformed[0] / dcQuant)) };
    });
  }

  private decideIntra(picture: Picture): CodedMb[] {
    const mbs: CodedMb[] = [];

    for (let mbY = 0; mbY < this.mbHeight; mbY++) {
      for (let mbX = 0; mbX < this.mbWidth; mbX++) {
        mbs.push(
          this.withDc(
            MbType.Intra,
            ZERO_MV,
            this.codeMb(picture, undefined, mbX, mbY),
          ),
        );
      }
    }
    return this.predictDcs(mbs);
  }

  /** A macroblock whose DC tokens are filled in by `predictDcs` */
  private withDc(
    type: MbType,
    mv: Mv,
    coded: { levels: Int16Array; dc: number }[],
  ): CodedMb & { dcs?: number[] } {
    return {
      type,
      mv,
      dcs: coded.map((block) => block.dc),
      blocks: coded.map((block) => {
        let last = 63;

        while (last > 0 && block.levels[last] === 0) {
          last--;
        }
        return { dcToken: 0, levels: block.levels, last };
      }),
    };
  }

  /** DC values to tokens, with the decoder's prediction, in coding order */
  private predictDcs(mbs: (CodedMb & { dcs?: number[] })[]): CodedMb[] {
    const predictor = new DcPredictor(this.mbWidth);

    mbs.forEach((mb, index) => {
      if (index > 0 && index % this.mbWidth === 0) {
        predictor.newRow();
      }

      const reference = referenceOf(mb.type);

      mb.blocks.forEach((block, blockNo) => {
        const prediction = predictor.predict(blockNo, reference);
        const token = clampLevel((mb.dcs?.[blockNo] ?? 0) - prediction);

        block.dcToken = token;
        predictor.update(blockNo, reference, i16(prediction + token));
      });
      predictor.nextMb();
    });
    return mbs;
  }

  /** The decoder's motion vector candidates for a macroblock */
  private candidates(mbs: CodedMb[], mbX: number, mbY: number): MvCandidates {
    return mvCandidates(
      (index) => mbs[index],
      mbX,
      mbY,
      this.mbWidth,
      this.mbHeight,
      Ref.Previous,
    );
  }

  private filter(): Filter {
    return {
      advanced: false,
      autosel: false,
      varThresh: 0,
      mvThresh: 0,
      bicubic: false,
      filterAlpha: 0,
      loopThr: T.VP56_FILTER_LIMITS[this.quality] ?? 0,
      deblock: false,
    };
  }

  /** Mode and motion for every macroblock of an inter frame */
  private decide(picture: Picture): CodedMb[] {
    const reference = this.reference!;
    const scratch = new Picture(this.mbWidth, this.mbHeight);
    const filter = this.filter();
    const lambda = lambdaOf(this.quants.ac);
    const mbs: (CodedMb & { dcs?: number[] })[] = [];
    const source = picture.planes[0];
    const predicted = scratch.planes[0];

    const lumaError = (mbX: number, mbY: number, limit = Infinity) => {
      let sum = 0;

      for (let y = 0; y < 16; y++) {
        const row = (mbY * 16 + y) * source.width + mbX * 16;

        for (let x = 0; x < 16; x++) {
          sum += Math.abs(source.data[row + x] - predicted.data[row + x]);
        }
        if (sum > limit) {
          return sum;
        }
      }
      return sum;
    };
    const refLuma = reference.planes[0];
    /** Luma error of a whole-pixel offset, read straight from the reference */
    const wholePixelError = (
      mbX: number,
      mbY: number,
      dx: number,
      dy: number,
      limit: number,
    ) => {
      const x0 = mbX * 16 + dx;
      const y0 = mbY * 16 + dy;
      const inside =
        x0 >= 0 &&
        y0 >= 0 &&
        x0 + 16 <= refLuma.width &&
        y0 + 16 <= refLuma.height;
      let sum = 0;

      for (let y = 0; y < 16; y++) {
        const row = (mbY * 16 + y) * source.width + mbX * 16;
        const ry = inside
          ? y0 + y
          : Math.min(Math.max(y0 + y, 0), refLuma.height - 1);

        for (let x = 0; x < 16; x++) {
          const rx = inside
            ? x0 + x
            : Math.min(Math.max(x0 + x, 0), refLuma.width - 1);

          sum += Math.abs(
            source.data[row + x] - refLuma.data[ry * refLuma.width + rx],
          );
        }
        if (sum >= limit) {
          return sum;
        }
      }
      return sum;
    };
    /** Luma error along a motion vector; chroma is not needed to choose */
    const tryMv = (mbX: number, mbY: number, mv: Mv, limit = Infinity) => {
      for (const [bx, by] of [
        [0, 0],
        [8, 0],
        [0, 8],
        [8, 8],
      ]) {
        mcBlock(
          predicted,
          reference.planes[0],
          mbX * 16 + bx,
          mbY * 16 + by,
          mv,
          true,
          filter,
        );
      }
      return lumaError(mbX, mbY, limit);
    };
    const intraError = (mbX: number, mbY: number) => {
      let sum = 0;

      for (let block = 0; block < 4; block++) {
        const x0 = mbX * 16 + (block & 1) * 8;
        const y0 = mbY * 16 + (block >> 1) * 8;
        let mean = 0;

        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            mean += source.data[(y0 + y) * source.width + x0 + x];
          }
        }
        mean /= 64;
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            sum += Math.abs(
              source.data[(y0 + y) * source.width + x0 + x] - mean,
            );
          }
        }
      }
      return sum;
    };
    const mvBits = (delta: Mv) =>
      [delta.x, delta.y].reduce(
        (bits, value) =>
          bits + (Math.abs(value) < 8 ? 4 : 9) + (value !== 0 ? 1 : 0),
        2,
      );

    for (let mbY = 0; mbY < this.mbHeight; mbY++) {
      for (let mbX = 0; mbX < this.mbWidth; mbX++) {
        const { count, nearest, near, pred } = this.candidates(mbs, mbX, mbY);
        const options: { type: MbType; mv: Mv; cost: number }[] = [
          {
            type: MbType.InterNoMv,
            mv: ZERO_MV,
            cost: tryMv(mbX, mbY, ZERO_MV) + lambda,
          },
        ];

        if (count >= 1) {
          options.push({
            type: MbType.InterNearest,
            mv: nearest,
            cost: tryMv(mbX, mbY, nearest) + lambda * 2,
          });
        }
        if (count >= 2) {
          options.push({
            type: MbType.InterNear,
            mv: near,
            cost: tryMv(mbX, mbY, near) + lambda * 2,
          });
        }

        // A search: whole pixels outwards from the best start, then quarters
        let best = options.reduce((a, b) => (b.cost < a.cost ? b : a));

        if (best.cost > lambda * 4) {
          const start = { x: best.mv.x >> 2, y: best.mv.y >> 2 };
          let [cx, cy] = [start.x, start.y];
          let centreError = wholePixelError(mbX, mbY, cx, cy, Infinity);

          for (const step of [8, 4, 2, 1]) {
            let moved = true;

            while (moved) {
              moved = false;
              for (const [dx, dy] of [
                [step, 0],
                [-step, 0],
                [0, step],
                [0, -step],
              ]) {
                const [x, y] = [cx + dx, cy + dy];

                if (Math.abs(x) > 63 || Math.abs(y) > 63) {
                  continue;
                }

                const error = wholePixelError(mbX, mbY, x, y, centreError);

                if (error < centreError) {
                  [cx, cy, centreError, moved] = [x, y, error, true];
                }
              }
            }
          }

          // Half and quarter pixels, through the decoder's own filter
          let centre = { x: cx * 4, y: cy * 4 };

          centreError = tryMv(mbX, mbY, centre);
          for (const step of [2, 1]) {
            for (const [dx, dy] of [
              [step, 0],
              [-step, 0],
              [0, step],
              [0, -step],
            ]) {
              const mv = { x: centre.x + dx, y: centre.y + dy };
              const error = tryMv(mbX, mbY, mv, centreError);

              if (error < centreError) {
                [centre, centreError] = [mv, error];
              }
            }
          }

          const delta = { x: centre.x - pred.x, y: centre.y - pred.y };

          if (Math.abs(delta.x) <= 255 && Math.abs(delta.y) <= 255) {
            options.push({
              type: MbType.InterMv,
              mv: centre,
              cost: centreError + lambda * (mvBits(delta) + 1),
            });
          }
          options.push({
            type: MbType.Intra,
            mv: ZERO_MV,
            cost: intraError(mbX, mbY) * 1.2 + lambda * 4,
          });
          best = options.reduce((a, b) => (b.cost < a.cost ? b : a));
        }

        if (best.type === MbType.Intra) {
          mbs.push(
            this.withDc(
              MbType.Intra,
              ZERO_MV,
              this.codeMb(picture, undefined, mbX, mbY),
            ),
          );
        } else {
          predictMb(
            scratch,
            reference,
            mbX,
            mbY,
            best.type,
            best.mv,
            [],
            filter,
          );
          mbs.push(
            this.withDc(
              best.type,
              best.mv,
              this.codeMb(picture, scratch, mbX, mbY),
            ),
          );
        }
      }
    }
    return this.predictDcs(mbs);
  }

  /** The coefficient tokens of every block, to `sink` */
  private writeCoefficients(sink: Sink, mbs: CodedMb[]): void {
    const models = this.models;
    const topCtx = [
      new Uint8Array(this.mbWidth * 2),
      new Uint8Array(this.mbWidth),
      new Uint8Array(this.mbWidth),
    ];

    for (let mbY = 0; mbY < this.mbHeight; mbY++) {
      const leftCtx = [0, 0, 0, 0];

      for (let mbX = 0; mbX < this.mbWidth; mbX++) {
        const mb = mbs[mbY * this.mbWidth + mbX];

        mb.blocks.forEach((block, blockNo) => {
          const luma = blockNo < 4;
          const planeIdx = luma ? 0 : blockNo - 3;
          const ctxIdx = luma ? blockNo >> 1 : blockNo - 2;
          const topPos = luma ? mbX * 2 + (blockNo & 1) : mbX;
          const model = models.coeff[luma ? 0 : 1];
          const context = topCtx[planeIdx][topPos] + leftCtx[ctxIdx];
          const dcTokenProbs = model.dcTokenProbs[context];

          writeToken(
            sink,
            (slot) =>
              slot < 5 ? [dcTokenProbs, slot] : [model.dcValueProbs, slot],
            model.dcValueProbs,
            block.dcToken,
            true,
            true,
          );

          let index = 1;
          let previous = block.dcToken;

          while (index < 64) {
            const band = T.VP6_IDX_TO_AC_BAND[index];
            const probs =
              model.acValProbs[Math.min(Math.abs(previous), 2)][band];
            const needsFlag = index === 1 || previous !== 0;

            if (index > block.last) {
              sink.put(false, probs, 0);
              sink.put(false, probs, 1);
              break;
            }

            const value = block.levels[index];

            writeToken(
              sink,
              (slot) => [probs, slot],
              probs,
              value,
              needsFlag,
              false,
            );
            index++;
            previous = value;
            if (value === 0) {
              let run = 0;

              while (
                index + run <= block.last &&
                block.levels[index + run] === 0
              ) {
                run++;
              }
              writeZeroRun(sink, models.zeroRunProbs[index >= 7 ? 1 : 0], run);
              index += run;
            }
          }

          const category = block.dcToken !== 0 ? 1 : 0;

          leftCtx[ctxIdx] = category;
          topCtx[planeIdx][topPos] = category;
        });
      }
    }
  }

  /** Macroblock types and motion vectors, to `sink` */
  private writeModes(sink: Sink, mbs: CodedMb[]): void {
    let lastType = MbType.InterNoMv;
    const done: CodedMb[] = [];

    for (let mbY = 0; mbY < this.mbHeight; mbY++) {
      for (let mbX = 0; mbX < this.mbWidth; mbX++) {
        const mb = mbs[mbY * this.mbWidth + mbX];
        const { count, pred } = this.candidates(done, mbX, mbY);
        const probs =
          this.models.mbtype[(count + 1) % 3][MODEL_INDEX[lastType]];

        sink.put(mb.type === lastType, probs, 9);
        if (mb.type !== lastType) {
          const inter = mb.type !== MbType.Intra;

          sink.put(!inter, probs, 0);
          if (inter) {
            const far =
              mb.type === MbType.InterNearest || mb.type === MbType.InterNear;

            sink.put(far, probs, 1);
            sink.put(
              mb.type === MbType.InterMv || mb.type === MbType.InterNear,
              probs,
              far ? 4 : 3,
            );
          } else {
            sink.put(false, probs, 2);
            sink.put(false, probs, 5);
          }
          lastType = mb.type;
        }
        if (mb.type === MbType.InterMv) {
          writeMvComponent(sink, this.models.mv[0], mb.mv.x - pred.x);
          writeMvComponent(sink, this.models.mv[1], mb.mv.y - pred.y);
        }
        done[mbY * this.mbWidth + mbX] = mb;
      }
    }
  }

  /**
   * Sends the coefficient probabilities the counts ask for, mirroring
   * `Models.decodeCoeffModels` (including its carried defaults on key
   * frames), and sets them on the model
   */
  private sendCoeffModels(
    header: BoolEncoder,
    counts: CountSink,
    isKey: boolean,
  ): void {
    const models = this.models;
    const defProb = new Array<number>(11).fill(128);
    const send = (
      has: number,
      keep: number,
      cost: (prob: number) => number,
      ideal: number,
    ): number => {
      const flagCost = -Math.log2(1 - has / 256) + Math.log2(has / 256);

      if (ideal !== keep && cost(keep) - cost(ideal) > 7 + flagCost) {
        header.writeBool(true, has);
        header.writeBits(ideal === 1 ? 0 : ideal >> 1, 7);
        return ideal;
      }
      header.writeBool(false, has);
      return -1;
    };

    models.coeff.forEach((model, plane) => {
      T.HAS_COEF_PROBS[plane].forEach((has, slot) => {
        const keep = isKey ? defProb[slot] : model.dcValueProbs[slot];
        let cost: (prob: number) => number;
        let ideal: number;

        if (slot < 5) {
          // These reach the decoder through the three context weights
          const perContext = [0, 1, 2].map((ctx) => ({
            counts: counts.of(model.dcTokenProbs[ctx], slot),
            weights: T.VP6_DC_WEIGHTS[slot]?.[ctx] ?? [0, 1],
          }));

          cost = (prob) =>
            perContext.reduce(
              (sum, { counts: [zeros, ones], weights }) =>
                sum +
                bitCost(
                  zeros,
                  ones,
                  Math.max(
                    1,
                    Math.min(
                      255,
                      ((prob * weights[0] + 128) >> 8) + weights[1],
                    ),
                  ),
                ),
              0,
            );
          ideal = SENDABLE.reduce((best, value) =>
            cost(value) < cost(best) ? value : best,
          );
        } else {
          const [zeros, ones] = counts.of(model.dcValueProbs, slot);

          cost = (prob) => bitCost(zeros, ones, prob);
          ideal = bestSendable(zeros, ones);
        }

        const sent = send(has, keep, cost, ideal);

        if (sent >= 0) {
          defProb[slot] = sent;
          model.dcValueProbs[slot] = sent;
        } else if (isKey) {
          model.dcValueProbs[slot] = defProb[slot];
        }
      });
    });

    header.writeFlag(false); // the scan order stays

    models.zeroRunProbs.forEach((probs, which) => {
      T.HAS_ZERO_RUN_PROBS[which].forEach((has, slot) => {
        const [zeros, ones] = counts.of(probs, slot);
        const sent = send(
          has,
          probs[slot],
          (prob) => bitCost(zeros, ones, prob),
          bestSendable(zeros, ones),
        );

        if (sent >= 0) {
          probs[slot] = sent;
        }
      });
    });

    T.VP6_AC_PROBS.forEach((planes, ctype) => {
      models.coeff.forEach((model, plane) => {
        planes[plane].forEach((has, group) => {
          const target = model.acValProbs[ctype][group];

          has.forEach((hasProb, slot) => {
            const [zeros, ones] = counts.of(target, slot);
            const keep = isKey ? defProb[slot] : target[slot];
            const sent = send(
              hasProb,
              keep,
              (prob) => bitCost(zeros, ones, prob),
              bestSendable(zeros, ones),
            );

            if (sent >= 0) {
              defProb[slot] = sent;
              target[slot] = sent;
            } else if (isKey) {
              target[slot] = defProb[slot];
            }
          });
        });
      });
    });

    for (const model of models.coeff) {
      model.dcTokenProbs.forEach((probs, ctx) => {
        for (let slot = 0; slot < probs.length; slot++) {
          const [scale, add] = T.VP6_DC_WEIGHTS[slot]?.[ctx] ?? [0, 1];

          probs[slot] = Math.max(
            1,
            Math.min(
              255,
              ((model.dcValueProbs[slot] * scale + 128) >> 8) + add,
            ),
          );
        }
      });
    }
  }

  /** The frame's bytes: header, modes and models, then the coefficients */
  private write(mbs: CodedMb[], isKey: boolean): Uint8Array {
    const models = this.models;

    if (isKey) {
      models.reset(false);
    }

    // Counting pass: which probabilities this frame wants. Counted against
    // the current tables, which the sending below updates in place, so the
    // tables keep their identity and the counts stay attached.
    const counts = new CountSink();

    this.writeCoefficients(counts, mbs);

    const header = new BoolEncoder();

    if (isKey) {
      header.writeBits(this.mbHeight, 8);
      header.writeBits(this.mbWidth, 8);
      header.writeBits(this.mbHeight, 8);
      header.writeBits(this.mbWidth, 8);
      header.writeBits(0, 2);
    } else {
      header.writeFlag(false); // not a golden frame
    }
    header.writeFlag(false); // bool-coded, not Huffman

    if (!isKey) {
      // Mode and motion vector probabilities stay as they are
      for (let ctx = 0; ctx < 3; ctx++) {
        header.writeBool(false, 174);
        header.writeBool(false, 254);
      }
      models.computeModeProbs();
      T.HAS_NZ_PROB.forEach((has, index) => {
        header.writeBool(false, has);
        header.writeBool(false, T.HAS_SIGN_PROB[index]);
      });
      T.HAS_TREE_PROB.forEach((row) =>
        row.forEach((has) => header.writeBool(false, has)),
      );
      T.HAS_RAW_PROB.forEach((row) =>
        row.forEach((has) => header.writeBool(false, has)),
      );
    }

    this.sendCoeffModels(header, counts, isKey);

    if (!isKey) {
      this.writeModes(new WriteSink(header), mbs);
    }

    const coefficients = new BoolEncoder();

    this.writeCoefficients(new WriteSink(coefficients), mbs);

    const first = header.finish();
    const second = coefficients.finish();
    const bits = new BitWriter();

    bits.write(isKey ? 0 : 1, 1);
    bits.write(this.quality, 6);
    bits.write(1, 1); // two partitions
    if (isKey) {
      bits.write(VERSION, 5);
      bits.write(PROFILE_SIMPLE, 2);
      bits.write(0, 1); // progressive
    }

    const headerBytes = isKey ? 4 : 3;
    const offset = headerBytes + first.length;

    if (offset > 0xffff) {
      throw new Error('The frame header partition is too large');
    }
    bits.write(offset, 16);

    const frame = new Uint8Array(offset + second.length);

    frame.set(bits.finish(), 0);
    frame.set(first, headerBytes);
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
