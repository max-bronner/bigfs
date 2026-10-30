import type { Mv } from './dsp';

/**
 * Predictions the VP6 decoder makes from macroblocks already coded: each
 * block's DC value and each macroblock's motion vector candidates. The
 * encoder runs the same predictions to write what the decoder will read,
 * so both use this one implementation.
 */

/** Reference frame a macroblock predicts from */
export const enum Ref {
  Intra = 0,
  Previous = 1,
  Golden = 2,
}

/** Macroblock coding mode: intra, or the reference and motion vector an inter macroblock uses */
export const enum MbType {
  Intra,
  InterNoMv,
  InterMv,
  InterNearest,
  InterNear,
  InterFourMv,
  GoldenNoMv,
  GoldenMv,
  GoldenNearest,
  GoldenNear,
}

/** Gets the reference frame a macroblock mode predicts from */
export const referenceOf = (type: MbType): Ref =>
  type === MbType.Intra
    ? Ref.Intra
    : type <= MbType.InterFourMv
      ? Ref.Previous
      : Ref.Golden;

/** Zero motion vector, the candidate when no neighbour has one */
export const ZERO_MV: Mv = { x: 0, y: 0 };
/** Whether two motion vectors are equal */
export const sameMv = (a: Mv, b: Mv) => a.x === b.x && a.y === b.y;
const i16 = (value: number) => (value << 16) >> 16;

/** Neighbours searched for candidates, as `[row, column]` offsets, nearest first */
const CANDIDATE_OFFSETS = [
  [-1, 0],
  [0, -1],
  [-1, -1],
  [-1, 1],
  [-2, 0],
  [0, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
  [-2, -2],
  [-2, 2],
];

/** Motion vector candidates gathered from a macroblock's neighbours */
export interface MvCandidates {
  /** How many distinct non-zero vectors were found, at most 2 */
  count: number;
  nearest: Mv;
  near: Mv;
  /** The vector a coded vector is a delta from: `nearest` if it is adjacent */
  pred: Mv;
}

/** Finds the first two distinct non-zero vectors of neighbours that predict from `want` */
export const mvCandidates = (
  neighbour: (index: number) => { type: MbType; mv: Mv } | undefined,
  mbX: number,
  mbY: number,
  mbWidth: number,
  mbHeight: number,
  want: Ref,
): MvCandidates => {
  let nearest = ZERO_MV;
  let near = ZERO_MV;
  let pred = ZERO_MV;
  let count = 0;

  for (let index = 0; index < CANDIDATE_OFFSETS.length; index++) {
    const [yOffset, xOffset] = CANDIDATE_OFFSETS[index];
    const cx = mbX + xOffset;
    const cy = mbY + yOffset;

    if (cx < 0 || cy < 0 || cx >= mbWidth || cy >= mbHeight) {
      continue;
    }

    const info = neighbour(cy * mbWidth + cx);

    if (!info || referenceOf(info.type) !== want || sameMv(info.mv, ZERO_MV)) {
      continue;
    }
    if (count === 0) {
      nearest = info.mv;
      count = 1;
      if (index < 2) {
        pred = info.mv;
      }
    } else if (!sameMv(info.mv, nearest)) {
      near = info.mv;
      count = 2;
      break;
    }
  }
  return { count, nearest, near, pred };
};

/**
 * DC predictor for one frame: the average of the left and above blocks' DC
 * where they use the same reference, else the last DC coded against that reference
 */
export class DcPredictor {
  private dc: Int16Array[] = [];
  private refsY: (Ref | undefined)[] = [];
  private refsC: (Ref | undefined)[] = [];
  private leftY = [0, 0];
  private leftU = 0;
  private leftV = 0;
  private leftRef: Ref | undefined;
  private yIdx = 1;
  private cIdx = 1;
  private lastDc: number[][] = [];

  public constructor(mbWidth = 0) {
    this.resize(mbWidth);
  }

  /** Sizes the row buffers for a frame `mbWidth` macroblocks wide, and resets */
  public resize(mbWidth: number): void {
    this.dc = [
      new Int16Array(mbWidth * 2 + 2),
      new Int16Array(mbWidth + 2),
      new Int16Array(mbWidth + 2),
    ];
    this.refsY = new Array(mbWidth * 2 + 2).fill(undefined);
    this.refsC = new Array(mbWidth + 2).fill(undefined);
    this.reset();
  }

  /** Restores the state at the start of a frame */
  public reset(): void {
    this.newRow();
    this.refsY.fill(undefined);
    this.refsC.fill(undefined);
    this.lastDc = [
      [0, 0x80, 0x80],
      [0, 0, 0],
      [0, 0, 0],
    ];
  }

  /** Moves to the start of a macroblock row */
  public newRow(): void {
    this.yIdx = 1;
    this.cIdx = 1;
    this.leftY = [0, 0];
    this.leftU = 0;
    this.leftV = 0;
    this.leftRef = undefined;
  }

  /** Moves to the next macroblock in the row */
  public nextMb(): void {
    this.yIdx += 2;
    this.cIdx += 1;
  }

  /** Predicts the DC of block `blockNo` (0-3 luma, 4 U, 5 V) of the current macroblock */
  public predict(blockNo: number, reference: Ref): number {
    const luma = blockNo < 4;
    const plane = luma ? 0 : blockNo - 3;
    const index = luma ? this.yIdx + (blockNo & 1) : this.cIdx;
    const refs = luma ? this.refsY : this.refsC;
    let sum = 0;
    let count = 0;

    // The right luma block always has its left neighbour in the same macroblock
    if ((luma && (blockNo & 1) === 1) || this.leftRef === reference) {
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
    if (refs[index] === reference) {
      sum += this.dc[plane][index];
      count++;
    }
    sum = i16(sum);
    return count === 0
      ? this.lastDc[reference][plane]
      : count === 2
        ? Math.trunc(sum / 2)
        : sum;
  }

  /** Records a block's reconstructed DC for the blocks after it */
  public update(blockNo: number, reference: Ref, dc: number): void {
    const luma = blockNo < 4;
    const plane = luma ? 0 : blockNo - 3;
    const index = luma ? this.yIdx + (blockNo & 1) : this.cIdx;

    if (blockNo !== 4) {
      (luma ? this.refsY : this.refsC)[index] = reference;
    }
    if (blockNo <= 1) {
      this.leftY[0] = dc;
    } else if (blockNo <= 3) {
      this.leftY[1] = dc;
    } else if (blockNo === 4) {
      this.leftU = dc;
    } else {
      this.leftV = dc;
      this.leftRef = reference;
    }
    this.dc[plane][index] = dc;
    this.lastDc[reference][plane] = dc;
  }
}
