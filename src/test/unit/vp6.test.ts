import * as assert from 'assert';
import { parseVp6, toRgba } from '../../formats/vp6/container';
import { Vp6Decoder } from '../../formats/vp6/decoder';
import type { Picture } from '../../formats/vp6/dsp';
import * as T from '../../formats/vp6/tables';

/**
 * Synthetic VP6 frames, after mint's `crates/core/vp6/src/tests.rs`: a key
 * frame whose blocks carry only a DC, and an inter frame that repeats it.
 */

/** The VP8 bool encoder (RFC 6386 7.3); VP6 shares its arithmetic */
class BoolEncoder {
  private readonly out: number[] = [];
  private range = 255;
  private bottom = 0;
  private bitCount = 24;

  private carry() {
    for (let index = this.out.length - 1; index >= 0; index--) {
      if (this.out[index] === 255) {
        this.out[index] = 0;
      } else {
        this.out[index]++;

        return;
      }
    }
  }

  public put(bit: boolean, prob: number) {
    const split = 1 + (((this.range - 1) * prob) >>> 8);

    if (bit) {
      this.bottom = (this.bottom + split) >>> 0;
      this.range -= split;
    } else {
      this.range = split;
    }

    while (this.range < 128) {
      this.range <<= 1;

      if (this.bottom & 0x80000000) {
        this.carry();
      }

      this.bottom = (this.bottom << 1) >>> 0;
      this.bitCount--;

      if (this.bitCount === 0) {
        this.out.push(this.bottom >>> 24);
        this.bottom &= 0xffffff;
        this.bitCount = 8;
      }
    }
  }

  public bits(value: number, count: number) {
    for (let index = count - 1; index >= 0; index--) {
      this.put(((value >> index) & 1) !== 0, 128);
    }
  }

  public finish(): number[] {
    let count = this.bitCount;
    let value = this.bottom;

    if (count < 32 && value & (1 << (32 - count))) {
      this.carry();
    }

    value = Number((BigInt(value) << BigInt(count & 7)) & 0xffffffffn);
    count >>= 3;

    while (count > 0) {
      value = Number((BigInt(value) << 8n) & 0xffffffffn);
      count--;
    }

    for (let index = 0; index < 4; index++) {
      this.out.push(value >>> 24);
      value = Number((BigInt(value) << 8n) & 0xffffffffn);
    }

    return this.out;
  }
}

const putDcThenEob = (enc: BoolEncoder, value: number, ctx: number) => {
  const dcProbs = [0, 1, 2, 3, 4].map((k) => {
    const [a, b] = T.VP6_DC_WEIGHTS[k][ctx];

    return Math.max(1, Math.min(255, ((128 * a + 128) >> 8) + b));
  });
  const magnitude = Math.abs(value);

  if (magnitude === 0) {
    enc.put(false, dcProbs[0]);
  } else {
    enc.put(true, dcProbs[0]);

    if (magnitude === 1) {
      enc.put(false, dcProbs[2]);
    } else if (magnitude <= 4) {
      enc.put(true, dcProbs[2]);
      enc.put(false, dcProbs[3]);

      if (magnitude === 2) {
        enc.put(false, dcProbs[4]);
      } else {
        enc.put(true, dcProbs[4]);
        enc.put(magnitude === 4, 128);
      }
    } else {
      enc.put(true, dcProbs[2]);
      enc.put(true, dcProbs[3]);

      let category = 0;

      T.VP56_COEF_BASE.forEach((base, index) => {
        if (base <= magnitude) {
          category = index;
        }
      });

      if (category <= 1) {
        enc.put(false, 128);
        enc.put(category === 1, 128);
      } else {
        enc.put(true, 128);
        enc.put(category >= 4, 128);
        enc.put(category % 2 === 1, 128);
      }

      const add = magnitude - T.VP56_COEF_BASE[category];
      const probs: number[] = [];

      for (const prob of T.VP56_COEF_ADD_PROBS[category]) {
        if (prob === 128) {
          break;
        }
        probs.push(prob);
      }

      probs.forEach((prob, index) =>
        enc.put(((add >> (probs.length - 1 - index)) & 1) !== 0, prob),
      );
    }

    enc.put(value < 0, 128);
  }

  enc.put(false, 128);
  enc.put(false, 128);
};

const MB_W = 2;
const MB_H = 2;
const TARGET = [
  [3, -8, 12, 5, 7, 20, -15, 1, -3, 9, 14, -20, 0, 11, -6, 2],
  [150, 133, 141, 120],
  [100, 117, 90, 131],
];

const predicted = (
  dcs: number[],
  columns: number,
  index: number,
  first: number,
) => {
  const column = index % columns;
  const row = Math.floor(index / columns);

  if (column > 0 && row > 0) {
    return Math.trunc((dcs[index - 1] + dcs[index - columns]) / 2);
  }

  return column > 0 ? dcs[index - 1] : row > 0 ? dcs[index - columns] : first;
};

const dcKeyFrame = (): Uint8Array => {
  const enc = new BoolEncoder();

  enc.bits(MB_H, 8);
  enc.bits(MB_W, 8);
  enc.bits(MB_H, 8);
  enc.bits(MB_W, 8);
  enc.bits(0, 2);
  enc.put(false, 128);
  enc.put(false, 128);
  enc.put(false, 128);
  T.HAS_COEF_PROBS.flat().forEach((prob) => enc.put(false, prob));
  enc.put(false, 128);
  T.HAS_ZERO_RUN_PROBS.flat().forEach((prob) => enc.put(false, prob));
  T.VP6_AC_PROBS.flat(3).forEach((prob) => enc.put(false, prob));

  const raw = TARGET.map((dcs, plane) =>
    dcs.map(
      (dc, index) =>
        dc -
        predicted(
          dcs,
          plane === 0 ? MB_W * 2 : MB_W,
          index,
          plane === 0 ? 0 : 128,
        ),
    ),
  );
  const nonZero = (plane: number, index: number) =>
    raw[plane][index] !== 0 ? 1 : 0;

  for (let mbY = 0; mbY < MB_H; mbY++) {
    for (let mbX = 0; mbX < MB_W; mbX++) {
      for (let block = 0; block < 6; block++) {
        const [plane, columns, column, row] =
          block < 4
            ? [0, MB_W * 2, mbX * 2 + (block & 1), mbY * 2 + (block >> 1)]
            : [block - 3, MB_W, mbX, mbY];
        const index = row * columns + column;
        const left = column > 0 ? nonZero(plane, index - 1) : 0;
        const up = row > 0 ? nonZero(plane, index - columns) : 0;

        putDcThenEob(enc, raw[plane][index], left + up);
      }
    }
  }

  return Uint8Array.from([0, (6 << 3) | (3 << 1), ...enc.finish()]);
};

const skipFrame = (): Uint8Array => {
  const enc = new BoolEncoder();

  enc.put(false, 128);
  enc.put(false, 128);
  enc.put(false, 128);

  for (let index = 0; index < 3; index++) {
    enc.put(false, 174);
    enc.put(false, 254);
  }

  for (let component = 0; component < 2; component++) {
    enc.put(false, T.HAS_NZ_PROB[component]);
    enc.put(false, T.HAS_SIGN_PROB[component]);
  }

  [
    ...T.HAS_TREE_PROB.flat(),
    ...T.HAS_RAW_PROB.flat(),
    ...T.HAS_COEF_PROBS.flat(),
  ].forEach((prob) => enc.put(false, prob));
  enc.put(false, 128);
  [...T.HAS_ZERO_RUN_PROBS.flat(), ...T.VP6_AC_PROBS.flat(3)].forEach((prob) =>
    enc.put(false, prob),
  );

  for (let mb = 0; mb < MB_W * MB_H; mb++) {
    enc.put(true, 10);

    for (let block = 0; block < 6; block++) {
      putDcThenEob(enc, 0, 0);
    }
  }

  return Uint8Array.from([0x80, ...enc.finish()]);
};

const blockValues = (
  picture: Picture,
  plane: number,
  column: number,
  row: number,
) => {
  const target = picture.planes[plane];
  const values: number[] = [];

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      values.push(target.data[(row * 8 + y) * target.width + column * 8 + x]);
    }
  }

  return values;
};

suite('VP6', () => {
  test('a DC-only key frame rebuilds each block from its predicted DC', () => {
    const picture = new Vp6Decoder().decode(dcKeyFrame());

    assert.deepStrictEqual(
      [picture.width, picture.height],
      [MB_W * 16, MB_H * 16],
    );

    TARGET.forEach((dcs, plane) => {
      const columns = plane === 0 ? MB_W * 2 : MB_W;

      dcs.forEach((dc, index) => {
        const want = Math.max(
          0,
          Math.min(255, 128 + (dc * T.VP56_DC_QUANTS[0] * 4) / 32),
        );
        const values = blockValues(
          picture,
          plane,
          index % columns,
          Math.floor(index / columns),
        );

        assert.ok(
          values.every((value) => Math.abs(value - want) <= 1),
          `plane ${plane} block ${index}: want ${want}, got ${values[0]}`,
        );
      });
    });
  });

  test('an inter frame of skipped macroblocks repeats the previous picture', () => {
    const decoder = new Vp6Decoder();
    const key = decoder.decode(dcKeyFrame()).clone();
    const inter = decoder.decode(skipFrame());

    inter.planes.forEach((plane, index) =>
      assert.deepStrictEqual(plane.data, key.planes[index].data),
    );
    assert.throws(() => new Vp6Decoder().decode(skipFrame()), /key frame/);
  });

  test('truncated and corrupt frames throw rather than hang', () => {
    const key = dcKeyFrame();
    let seed = 7;

    for (let length = 0; length < key.length; length++) {
      try {
        new Vp6Decoder().decode(key.subarray(0, length));
      } catch {
        // Any error will do; a hang or a crash would not
      }
    }

    for (let round = 0; round < 300; round++) {
      const frame = Uint8Array.from(key);

      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      frame[2 + (seed % (frame.length - 2))] ^= 1 << (seed % 8);

      try {
        new Vp6Decoder().decode(frame);
      } catch {
        // as above
      }
    }
  });

  test('the container splits frames and the picture converts the way retail does', () => {
    const chunk = (tag: string, payload: number[]) => {
      const size = new Uint8Array(new Uint32Array([payload.length + 8]).buffer);

      return [
        ...Array.from(tag, (char) => char.charCodeAt(0)),
        ...size,
        ...payload,
      ];
    };
    const header = [
      ...Array.from('vp60', (char) => char.charCodeAt(0)),
      32,
      0,
      32,
      0,
      2,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      30,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
    ];
    const movie = parseVp6(
      Uint8Array.from([
        ...chunk('MVhd', header),
        ...chunk('MV0K', [1, 2]),
        ...chunk('MV0F', [3]),
      ]),
    );

    assert.deepStrictEqual(movie.header, {
      width: 32,
      height: 32,
      frameCount: 2,
      rateNumerator: 30,
      rateDenominator: 1,
    });
    assert.deepStrictEqual(
      movie.frames.map((frame) => [frame.isKey, Array.from(frame.colour)]),
      [
        [true, [1, 2]],
        [false, [3]],
      ],
    );

    const picture = new Vp6Decoder().decode(dcKeyFrame());

    picture.planes[0].data.fill(128);
    picture.planes[1].data.fill(128);
    picture.planes[2].data.fill(128);
    assert.deepStrictEqual(
      Array.from(toRgba(picture, 1, 1)),
      [138, 138, 138, 255],
    );
  });
});
