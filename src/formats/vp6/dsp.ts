import { VP6_BICUBIC_COEFFS } from './tables';

/**
 * VP6's inverse transform and motion compensation, ported from mint's
 * `crates/core/vp6` (`idct.rs`, `mc.rs`; NihAV via Ruffle, MIT).
 */

/** One 8-bit image plane, rows stored contiguously with no padding */
export class Plane {
  public data: Uint8Array;

  public constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    this.data = new Uint8Array(width * height);
  }

  /** Creates an independent copy of the plane */
  public clone(): Plane {
    const copy = new Plane(this.width, this.height);

    copy.data.set(this.data);

    return copy;
  }
}

/** Decoded picture: Y, U and V planes at the coded size, in whole macroblocks */
export class Picture {
  public readonly planes: [Plane, Plane, Plane];

  public constructor(mbWidth: number, mbHeight: number) {
    const width = mbWidth * 16;
    const height = mbHeight * 16;

    this.planes = [
      new Plane(width, height),
      new Plane(width / 2, height / 2),
      new Plane(width / 2, height / 2),
    ];
  }

  /** Luma width in pixels */
  public get width(): number {
    return this.planes[0].width;
  }

  /** Luma height in pixels */
  public get height(): number {
    return this.planes[0].height;
  }

  /** Creates an independent copy of the picture */
  public clone(): Picture {
    const copy = new Picture(this.width / 16, this.height / 16);

    this.planes.forEach((plane, index) =>
      copy.planes[index].data.set(plane.data),
    );

    return copy;
  }
}

const C1S7 = 64277;
const C2S6 = 60547;
const C3S5 = 54491;
const C4S4 = 46341;
const C5S3 = 36410;
const C6S2 = 25080;
const C7S1 = 12785;

/** `a * b >> 16` with 32-bit wrapping, as the reference computes it */
const mul16 = (a: number, b: number) => Math.imul(a, b) >> 16;

const i16 = (value: number) => (value << 16) >> 16;

const idct8 = (s: number[], bias: number, shift: number): number[] => {
  const tA = mul16(C1S7, s[1]) + mul16(C7S1, s[7]);
  const tB = mul16(C7S1, s[1]) - mul16(C1S7, s[7]);
  let tC = mul16(C3S5, s[3]) + mul16(C5S3, s[5]);
  let tD = mul16(C3S5, s[5]) - mul16(C5S3, s[3]);
  const tA1 = mul16(C4S4, tA - tC);
  const tB1 = mul16(C4S4, tB - tD);

  tC = tA + tC;
  tD = tB + tD;

  const tE = mul16(C4S4, s[0] + s[4]) + bias;
  let tF = mul16(C4S4, s[0] - s[4]) + bias;
  let tG = mul16(C2S6, s[2]) + mul16(C6S2, s[6]);
  let tH = mul16(C6S2, s[2]) - mul16(C2S6, s[6]);
  const tE1 = tE - tG;

  tG = tE + tG;

  const tA2 = tF + tA1;

  tF = tF - tA1;

  const tB2 = tB1 - tH;

  tH = tB1 + tH;

  return [
    tG + tC,
    tA2 + tH,
    tA2 - tH,
    tE1 + tD,
    tE1 - tD,
    tF + tB2,
    tF - tB2,
    tG - tC,
  ].map((value) => (value | 0) >> shift);
};

/** Applies the inverse transform to an 8×8 block in place; results truncate to 16 bits */
export const idct = (coeffs: Int16Array): void => {
  const rows: number[][] = [];

  for (let row = 0; row < 8; row++) {
    rows.push(idct8(Array.from(coeffs.subarray(row * 8, row * 8 + 8)), 0, 0));
  }

  for (let column = 0; column < 8; column++) {
    idct8(
      rows.map((row) => row[column]),
      8,
      4,
    ).forEach((value, row) => {
      coeffs[row * 8 + column] = i16(value);
    });
  }
};

/** Computes the inverse transform of a block whose only non-zero coefficient is its DC */
export const idctDc = (dc: number): number =>
  i16((mul16(C4S4, mul16(C4S4, dc)) + 8) >> 4);

const clampU8 = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);

/** The offsets of a block's eight rows: consecutive, or every other for a field */
const rowStarts = (
  plane: Plane,
  bx: number,
  by: number,
  isField: boolean,
): number[] => {
  const first = isField ? (by & ~1) * 8 + (by & 1) : by * 8;
  const step = isField ? 2 : 1;
  const starts: number[] = [];

  for (let row = 0; row < 8; row++) {
    const y = first + row * step;

    if (y < plane.height && bx * 8 + 8 <= plane.width) {
      starts.push(y * plane.width + bx * 8);
    }
  }

  return starts;
};

/** Writes an intra block's inverse transform into a plane at block `bx`, `by` */
export const putBlock = (
  coeffs: Int16Array,
  dcOnly: boolean,
  plane: Plane,
  bx: number,
  by: number,
  isField: boolean,
): void => {
  const starts = rowStarts(plane, bx, by, isField);

  if (dcOnly) {
    const value = clampU8(idctDc(coeffs[0]) + 128);

    starts.forEach((start) => plane.data.fill(value, start, start + 8));

    return;
  }

  idct(coeffs);
  starts.forEach((start, row) => {
    for (let column = 0; column < 8; column++) {
      plane.data[start + column] = clampU8(coeffs[row * 8 + column] + 128);
    }
  });
};

/** Adds an inter block's inverse transform onto its prediction in a plane at block `bx`, `by` */
export const addBlock = (
  coeffs: Int16Array,
  dcOnly: boolean,
  plane: Plane,
  bx: number,
  by: number,
  isField: boolean,
): void => {
  const starts = rowStarts(plane, bx, by, isField);

  if (dcOnly) {
    const dc = idctDc(coeffs[0]);

    starts.forEach((start) => {
      for (let column = 0; column < 8; column++) {
        plane.data[start + column] = clampU8(plane.data[start + column] + dc);
      }
    });

    return;
  }

  idct(coeffs);
  starts.forEach((start, row) => {
    for (let column = 0; column < 8; column++) {
      plane.data[start + column] = clampU8(
        plane.data[start + column] + coeffs[row * 8 + column],
      );
    }
  });
};

/** Motion vector in quarter pixels for luma, eighth pixels for chroma */
export interface Mv {
  x: number;
  y: number;
}

/** Motion compensation filter settings a frame header selects */
export interface Filter {
  advanced: boolean;
  autosel: boolean;
  varThresh: number;
  mvThresh: number;
  bicubic: boolean;
  filterAlpha: number;
  loopThr: number;
  deblock: boolean;
}

const TMP_STRIDE = 16;
const TMP_LEN = TMP_STRIDE * 12;
const ORIGIN = 2 * TMP_STRIDE + 2;
/** Scratch for one block at a time; motion compensation is not re-entered */
const SCRATCH = new Uint8Array(TMP_LEN);
const HORIZONTAL = new Uint16Array(9 * 8);

/** Copies the 12×12 source area around a block, clamping at the edges */
const copyBlockArea = (tmp: Uint8Array, src: Plane, x: number, y: number) => {
  const { width, height } = src;

  if (!width || !height) {
    tmp.fill(0);

    return;
  }

  for (let row = 0; row < 12; row++) {
    const sy = Math.min(Math.max(y + row, 0), height - 1);
    const base = sy * width;

    for (let column = 0; column < 12; column++) {
      const sx = Math.min(Math.max(x + column, 0), width - 1);

      tmp[row * TMP_STRIDE + column] = src.data[base + sx];
    }
  }
};

const loopFilter = (
  buf: Uint8Array,
  start: number,
  step: number,
  stride: number,
  strength: number,
) => {
  let off = start;

  for (let index = 0; index < 12; index++) {
    const at = (offset: number) =>
      offset >= 0 && offset < buf.length ? buf[offset] : 0;
    const a = at(off - step * 2);
    const b = at(off - step);
    const c = at(off);
    const d = at(off + step);
    let diff = (a - d + (c - b) * 3 + 4) >> 3;

    if (Math.abs(diff) >= strength * 2) {
      diff = 0;
    } else if (Math.abs(diff) >= strength) {
      diff = diff < 0 ? -diff - strength * 2 : -diff + strength * 2;
    }

    if (diff !== 0) {
      if (off - step >= 0) {
        buf[off - step] = clampU8(b + diff);
      }

      if (off < buf.length) {
        buf[off] = clampU8(c - diff);
      }
    }

    off += stride;
  }
};

const variance = (buf: Uint8Array, off: number) => {
  let sum = 0;
  let squares = 0;

  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      const value = buf[off + row * 2 * TMP_STRIDE + column * 2] ?? 0;

      sum += value;
      squares += value * value;
    }
  }

  return Math.min(0xffff, ((squares * 16 - sum * sum) >>> 0) >>> 8);
};

const bicubic = (
  src: Uint8Array,
  off: number,
  step: number,
  k: readonly number[],
) => {
  const at = (offset: number) =>
    offset >= 0 && offset < src.length ? src[offset] : 0;

  return clampU8(
    (at(off - step) * k[0] +
      at(off) * k[1] +
      at(off + step) * k[2] +
      at(off + step * 2) * k[3] +
      64) >>
      7,
  );
};

/** Predicts one 8×8 block from the reference plane along a motion vector */
export const predictMotionBlock = (
  dst: Plane,
  src: Plane,
  x: number,
  y: number,
  mv: Mv,
  luma: boolean,
  f: Filter,
): void => {
  const [sx, sy, mx, my, msx, msy] = luma
    ? [
        mv.x >> 2,
        mv.y >> 2,
        (mv.x & 3) << 1,
        (mv.y & 3) << 1,
        Math.trunc(mv.x / 4),
        Math.trunc(mv.y / 4),
      ]
    : [
        mv.x >> 3,
        mv.y >> 3,
        mv.x & 7,
        mv.y & 7,
        Math.trunc(mv.x / 8),
        Math.trunc(mv.y / 8),
      ];
  const tmp = SCRATCH;

  copyBlockArea(tmp, src, x + sx - 2, y + sy - 2);

  if (f.deblock && (msx & 7) !== 0) {
    loopFilter(tmp, 8 - (sx & 7) + 2, 1, TMP_STRIDE, f.loopThr);
  }

  if (f.deblock && (msy & 7) !== 0) {
    loopFilter(tmp, (8 - (sy & 7) + 2) * TMP_STRIDE, TMP_STRIDE, 1, f.loopThr);
  }

  const isCopy = mx === 0 && my === 0;
  let useBicubic = !isCopy && luma && f.bicubic;

  if (luma && !isCopy && f.advanced) {
    if (!f.autosel) {
      useBicubic = true;
    } else {
      const limit = 1 << (f.mvThresh + 1);

      if (Math.abs(mv.x) <= limit && Math.abs(mv.y) <= limit) {
        let offset = ORIGIN;

        if (mv.x < 0) {
          offset += 1;
        }

        if (mv.y < 0) {
          offset += TMP_STRIDE;
        }

        if (variance(tmp, offset) >= f.varThresh) {
          useBicubic = true;
        }
      }
    }
  }

  const rows = Math.min(8, dst.height - y);
  const write = (row: number, column: number, value: number) => {
    if (x + column < dst.width) {
      dst.data[(y + row) * dst.width + x + column] = value;
    }
  };
  const at = (row: number, column: number) =>
    ORIGIN + row * TMP_STRIDE + column;

  if (isCopy) {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < 8; column++) {
        write(row, column, tmp[at(row, column)]);
      }
    }
  } else if (useBicubic) {
    const table = VP6_BICUBIC_COEFFS[f.filterAlpha] ?? VP6_BICUBIC_COEFFS[16];
    const kh = table[mx] ?? table[0];
    const kv = table[my] ?? table[0];

    if (kv[1] === 128) {
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < 8; column++) {
          write(row, column, bicubic(tmp, at(row, column), 1, kh));
        }
      }
    } else if (kh[1] === 128) {
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < 8; column++) {
          write(row, column, bicubic(tmp, at(row, column), TMP_STRIDE, kv));
        }
      }
    } else {
      const buf = new Uint8Array(16 * 11);

      for (let row = 0; row < 11; row++) {
        for (let column = 0; column < 8; column++) {
          buf[row * 16 + column] = bicubic(
            tmp,
            ORIGIN - TMP_STRIDE + row * TMP_STRIDE + column,
            1,
            kh,
          );
        }
      }

      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < 8; column++) {
          write(row, column, bicubic(buf, 16 + row * 16 + column, 16, kv));
        }
      }
    }
  } else {
    // Bilinear, as the reference computes it, without per-pixel allocation
    const left = 8 - mx;
    const top = 8 - my;

    if (my === 0) {
      for (let row = 0; row < rows; row++) {
        const base = ORIGIN + row * TMP_STRIDE;

        for (let column = 0; column < 8; column++) {
          write(
            row,
            column,
            (tmp[base + column] * left + tmp[base + column + 1] * mx + 4) >> 3,
          );
        }
      }
    } else if (mx === 0) {
      for (let row = 0; row < rows; row++) {
        const base = ORIGIN + row * TMP_STRIDE;

        for (let column = 0; column < 8; column++) {
          write(
            row,
            column,
            (tmp[base + column] * top +
              tmp[base + column + TMP_STRIDE] * my +
              4) >>
              3,
          );
        }
      }
    } else {
      const across = HORIZONTAL;

      for (let row = 0; row <= rows; row++) {
        const base = ORIGIN + row * TMP_STRIDE;

        for (let column = 0; column < 8; column++) {
          across[row * 8 + column] =
            (tmp[base + column] * left + tmp[base + column + 1] * mx + 4) >> 3;
        }
      }
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < 8; column++) {
          write(
            row,
            column,
            (across[row * 8 + column] * top +
              across[(row + 1) * 8 + column] * my +
              4) >>
              3,
          );
        }
      }
    }
  }
};
