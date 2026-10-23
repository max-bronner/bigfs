import * as assert from 'assert';
import { decodeDds, decodeTga } from '../../tools/textureTools';

/** A TGA header for an image of the given type, depth and descriptor */
const tgaHeader = (
  type: number,
  width: number,
  height: number,
  bits: number,
  descriptor = 0,
): number[] => [
  0,
  0,
  type,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  width,
  0,
  height,
  0,
  bits,
  descriptor,
];

/** The RGBA pixels of a decoded image as one array per pixel */
const pixelsOf = (pixels: Uint8Array): number[][] =>
  Array.from({ length: pixels.length / 4 }, (_, index) =>
    Array.from(pixels.subarray(index * 4, index * 4 + 4)),
  );

/** A DDS header for a texture with the given pixel format */
const ddsHeader = (
  width: number,
  height: number,
  levels: number,
  pixelFormat: {
    flags: number;
    fourCC?: string;
    bits?: number;
    masks?: number[];
  },
): Uint8Array => {
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);

  header.set([0x44, 0x44, 0x53, 0x20]);
  view.setUint32(4, 124, true);
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(28, levels, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, pixelFormat.flags, true);
  header.set(
    Array.from(pixelFormat.fourCC ?? '\0\0\0\0', (c) => c.charCodeAt(0)),
    84,
  );
  view.setUint32(88, pixelFormat.bits ?? 0, true);
  (pixelFormat.masks ?? []).forEach((mask, index) =>
    view.setUint32(92 + index * 4, mask, true),
  );

  return header;
};

suite('Texture decoding', () => {
  test('a bottom-up 24-bit TGA comes out top row first, in RGBA', () => {
    // Two rows of one pixel, blue first: the bottom row is stored first
    const bytes = Uint8Array.from([
      ...tgaHeader(2, 1, 2, 24),
      ...[255, 0, 0], // bottom: blue
      ...[0, 0, 255], // top: red
    ]);

    const { levels, hasAlpha } = decodeTga(bytes);

    assert.strictEqual(hasAlpha, false);
    assert.deepStrictEqual(pixelsOf(levels[0].pixels), [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);
  });

  test('a run-length encoded 32-bit TGA expands its runs and keeps alpha', () => {
    const bytes = Uint8Array.from([
      ...tgaHeader(10, 3, 1, 32, 0x28),
      0x81, // a run of two
      ...[1, 2, 3, 128],
      0x00, // one raw pixel
      ...[4, 5, 6, 0],
    ]);

    assert.deepStrictEqual(pixelsOf(decodeTga(bytes).levels[0].pixels), [
      [3, 2, 1, 128],
      [3, 2, 1, 128],
      [6, 5, 4, 0],
    ]);
  });

  test('a TGA that claims more pixels than it holds is refused', () => {
    const bytes = Uint8Array.from([...tgaHeader(2, 64, 64, 32), 1, 2, 3, 4]);

    assert.throws(() => decodeTga(bytes), /past the end/);
  });

  test('a DXT1 block decodes its four colours and the punch-through one', () => {
    const header = ddsHeader(4, 4, 1, { flags: 0x4, fourCC: 'DXT1' });
    // Red then blue in 5:6:5; first above second, so four opaque colours.
    // Indices: texel 0 -> 0, texel 1 -> 1, the rest -> 0
    const block = Uint8Array.from([0x00, 0xf8, 0x1f, 0x00, 0b0100, 0, 0, 0]);

    const { levels, format } = decodeDds(
      Uint8Array.from([...header, ...block]),
    );

    assert.strictEqual(format, 'DXT1');
    assert.deepStrictEqual(pixelsOf(levels[0].pixels).slice(0, 3), [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [255, 0, 0, 255],
    ]);

    // First not above second: index 3 is transparent
    const punch = Uint8Array.from([0x1f, 0x00, 0x00, 0xf8, 0b11, 0, 0, 0]);
    const transparent = decodeDds(Uint8Array.from([...header, ...punch]));

    assert.strictEqual(transparent.levels[0].pixels[3], 0);
  });

  test('a DXT5 alpha block interpolates between its endpoints', () => {
    const header = ddsHeader(4, 4, 1, { flags: 0x4, fourCC: 'DXT5' });
    // Alpha 255 to 0, texel 0 index 0 (255), texel 1 index 1 (0)
    const alpha = [255, 0, 0b001000, 0, 0, 0, 0, 0];
    const colour = [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0];

    const { levels } = decodeDds(
      Uint8Array.from([...header, ...alpha, ...colour]),
    );
    const pixels = pixelsOf(levels[0].pixels);

    assert.strictEqual(pixels[0][3], 255);
    assert.strictEqual(pixels[1][3], 0);
    assert.deepStrictEqual(pixels[0].slice(0, 3), [255, 255, 255]);
  });

  test('an uncompressed DDS reads its channels through the masks, every mip', () => {
    const header = ddsHeader(2, 2, 2, {
      flags: 0x41,
      bits: 32,
      masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000],
    });
    // BGRA in memory for 0xAARRGGBB little endian
    const level0 = Array.from({ length: 4 }, () => [30, 20, 10, 40]).flat();
    const level1 = [3, 2, 1, 4];

    const { levels, hasAlpha } = decodeDds(
      Uint8Array.from([...header, ...level0, ...level1]),
    );

    assert.strictEqual(hasAlpha, true);
    assert.deepStrictEqual(
      levels.map(({ width, height }) => [width, height]),
      [
        [2, 2],
        [1, 1],
      ],
    );
    assert.deepStrictEqual(pixelsOf(levels[1].pixels), [[1, 2, 3, 4]]);
  });

  test('a DDS compression it does not read is named, not guessed', () => {
    const header = ddsHeader(4, 4, 1, { flags: 0x4, fourCC: 'ATI2' });

    assert.throws(
      () => decodeDds(Uint8Array.from([...header, ...new Array(16).fill(0)])),
      /"ATI2" is not supported/,
    );
  });
});
