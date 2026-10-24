import { deflateSync } from 'zlib';
import * as assert from 'assert';
import { decodeDds, decodeTga } from '../../tools/textureTools';
import {
  decodePng,
  encodeDds,
  encodePng,
  encodeTga,
} from '../../formats/textureEncode';

/** A 8×4 gradient with varying alpha */
const image = () => {
  const width = 8;
  const height = 4;
  const pixels = new Uint8Array(width * height * 4);

  for (let index = 0; index < width * height; index++) {
    pixels.set(
      [index * 7, 255 - index * 5, index * 3, index < 16 ? 255 : 0],
      index * 4,
    );
  }

  return { width, height, pixels };
};

suite('Texture encoding', () => {
  test('PNG and TGA round-trip exactly', () => {
    const source = image();

    assert.deepStrictEqual(decodePng(encodePng(source)), source);
    assert.deepStrictEqual(
      decodeTga(encodeTga(source, true)).levels[0].pixels,
      source.pixels,
    );

    const opaque = decodeTga(encodeTga(source, false));

    assert.strictEqual(opaque.format, 'TGA 24-bit');
    assert.ok(
      opaque.levels[0].pixels.every(
        (value, index) => index % 4 !== 3 || value === 255,
      ),
    );
  });

  test('DDS reads back in its format, with mips and close colours', () => {
    const source = image();

    for (const format of ['DXT1', 'DXT3', 'DXT5', 'RGBA'] as const) {
      const decoded = decodeDds(encodeDds(source, format, true));

      assert.strictEqual(
        decoded.format,
        format === 'RGBA' ? 'uncompressed 32-bit' : format,
      );
      assert.deepStrictEqual(
        decoded.levels.map((level) => [level.width, level.height]),
        [
          [8, 4],
          [4, 2],
          [2, 1],
          [1, 1],
        ],
      );

      const error = Math.max(
        ...Array.from(decoded.levels[0].pixels, (value, index) =>
          format === 'DXT1' && source.pixels[index - (index % 4) + 3] < 128
            ? 0
            : Math.abs(value - source.pixels[index]),
        ),
      );

      assert.ok(
        error <= (format === 'RGBA' ? 0 : 32),
        `${format}: largest error ${error}`,
      );
    }
  });

  test('a PNG filtered with Paeth decodes', () => {
    const source = image();
    const stride = source.width * 4;
    const raw = new Uint8Array((stride + 1) * source.height);

    for (let row = 0; row < source.height; row++) {
      raw[row * (stride + 1)] = 4;

      for (let index = 0; index < stride; index++) {
        const at = (r: number, i: number) =>
          r < 0 || i < 0 ? 0 : source.pixels[r * stride + i];
        const left = at(row, index - 4);
        const up = at(row - 1, index);
        const upLeft = at(row - 1, index - 4);
        const p = left + up - upLeft;
        const [pa, pb, pc] = [
          Math.abs(p - left),
          Math.abs(p - up),
          Math.abs(p - upLeft),
        ];
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;

        raw[row * (stride + 1) + 1 + index] =
          (at(row, index) - predictor) & 255;
      }
    }

    // Swap the IDAT of a plain encode for the Paeth-filtered data
    const plain = encodePng(source);
    const header = plain.subarray(0, 33);
    const idat = deflateSync(raw);
    const chunk = new Uint8Array(12 + idat.length);
    const view = new DataView(chunk.buffer);

    view.setUint32(0, idat.length);
    chunk.set([73, 68, 65, 84], 4);
    chunk.set(idat, 8);

    const png = Uint8Array.from([
      ...header,
      ...chunk,
      0,
      0,
      0,
      0,
      73,
      69,
      78,
      68,
      0,
      0,
      0,
      0,
    ]);

    assert.deepStrictEqual(decodePng(png), source);
    assert.throws(() => decodePng(Uint8Array.of(1, 2, 3)), /Not a PNG/);
  });
});
