import * as assert from 'assert';
import { buildAnimation } from '../../formats/cursor/buildAnimation';
import type { CursorFrame } from '../../formats/cursor/cursorFrame';
import {
  jiffiesToMilliseconds,
  millisecondsToJiffies,
} from '../../formats/cursor/jiffies';
import { parseAni } from '../../formats/cursor/parseAni';
import { parseCur } from '../../formats/cursor/parseCur';
import { parseHotspot } from '../../formats/cursor/parseHotspot';
import { parseCursorFile } from '../../formats/cursor/parseCursorFile';
import { writeAni } from '../../formats/cursor/writeAni';
import { writeCur } from '../../formats/cursor/writeCur';
import { decodePng, encodePng } from '../../node/png';

/** A frame whose pixel `i` is `(i, 2i, 3i, alpha)`, alpha 0 on the first pixel */
const makeFrame = (
  width: number,
  height: number,
  hotspotX = 0,
  hotspotY = 0,
): CursorFrame => {
  const pixels = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    pixels.set([i, i * 2, i * 3, i === 0 ? 0 : 255 - i], i * 4);
  }

  return { width, height, hotspotX, hotspotY, pixels };
};

/** A DIB of the given depth: palette entries (blue, green, red, 0), colour rows then 1-bit mask rows, both bottom first */
const buildDib = (
  width: number,
  height: number,
  bits: number,
  palette: number[][],
  colourRows: number[][],
  maskRows: number[][],
): number[] => {
  const header = new Uint8Array(40);
  const view = new DataView(header.buffer);

  view.setUint32(0, 40, true);
  view.setInt32(4, width, true);
  view.setInt32(8, height * 2, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, bits, true);

  return [
    ...header,
    ...palette.flat(),
    ...colourRows.flat(),
    ...maskRows.flat(),
  ];
};

/** A cursor file around one DIB payload */
const buildCur = (
  dib: number[],
  hotspot: [number, number] = [0, 0],
): Uint8Array => {
  const out = new Uint8Array(22 + dib.length);
  const view = new DataView(out.buffer);

  view.setUint16(2, 2, true);
  view.setUint16(4, 1, true);
  view.setUint16(10, hotspot[0], true);
  view.setUint16(12, hotspot[1], true);
  view.setUint32(14, dib.length, true);
  view.setUint32(18, 22, true);
  out.set(dib, 22);

  return out;
};

suite('parseCur', () => {
  test('reads a 4-bit bitmap with its palette, bottom-up rows and AND mask', () => {
    // 2x2: top row red, green; bottom row blue, then white that the mask hides
    const palette = [
      [0, 0, 255, 0],
      [0, 255, 0, 0],
      [255, 0, 0, 0],
      [255, 255, 255, 0],
    ];
    const dib = buildDib(
      2,
      2,
      4,
      [...palette, ...Array.from({ length: 12 }, () => [0, 0, 0, 0])],
      [
        [0x23, 0, 0, 0],
        [0x01, 0, 0, 0],
      ],
      [
        [0b01000000, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    );
    const [frame] = parseCur(buildCur(dib, [1, 0]));

    assert.strictEqual(frame.hotspotX, 1);
    assert.strictEqual(frame.hotspotY, 0);
    assert.deepStrictEqual(
      [...frame.pixels],
      [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0],
    );
  });

  test('reads 24-bit pixels as blue, green, red and applies the mask', () => {
    const dib = buildDib(1, 1, 24, [], [[10, 20, 30, 0]], [[0x80, 0, 0, 0]]);
    const [frame] = parseCur(buildCur(dib));

    assert.deepStrictEqual([...frame.pixels], [30, 20, 10, 0]);
  });

  test('takes alpha from a 32-bit bitmap and the mask when every alpha is zero', () => {
    const withAlpha = parseCur(
      buildCur(buildDib(1, 1, 32, [], [[1, 2, 3, 128]], [[0x80, 0, 0, 0]])),
    );
    const withoutAlpha = parseCur(
      buildCur(buildDib(1, 1, 32, [], [[1, 2, 3, 0]], [[0, 0, 0, 0]])),
    );

    assert.strictEqual(withAlpha[0].pixels[3], 128);
    assert.strictEqual(withoutAlpha[0].pixels[3], 255);
  });

  test('hands a PNG-compressed entry to the decoder and refuses it without one', () => {
    const png = [137, 80, 78, 71, 13, 10, 26, 10, ...new Array(16).fill(0)];
    const bytes = buildCur(png, [2, 3]);
    const [frame] = parseCur(bytes, {
      decodePng: () => ({ width: 4, height: 4, pixels: new Uint8Array(64) }),
    });

    assert.strictEqual(frame.width, 4);
    assert.strictEqual(frame.hotspotY, 3);
    assert.throws(() => parseCur(bytes), /PNG decoder/);
  });

  test('fails with a message on every truncation instead of throwing out of range', () => {
    const bytes = writeCur([makeFrame(4, 4, 1, 1)]);

    for (let length = 0; length < bytes.length; length++) {
      assert.throws(
        () => parseCur(bytes.subarray(0, length)),
        Error,
        `length ${length}`,
      );
    }
  });

  test('refuses a size that the bytes present cannot hold', () => {
    const dib = buildDib(500, 500, 24, [], [], []);

    assert.throws(() => parseCur(buildCur(dib)), /runs past the end/);
  });
});

suite('writeCur', () => {
  test('round trips pixels, size and hotspot', () => {
    const frame = makeFrame(5, 3, 4, 2);
    const [back] = parseCur(writeCur([frame]));

    assert.strictEqual(back.width, 5);
    assert.strictEqual(back.height, 3);
    assert.strictEqual(back.hotspotX, 4);
    assert.strictEqual(back.hotspotY, 2);
    assert.deepStrictEqual([...back.pixels], [...frame.pixels]);
  });

  test('refuses a hotspot outside the image', () => {
    assert.throws(() => writeCur([makeFrame(2, 2, 2, 0)]), /hotspot/);
  });
});

suite('animated cursors', () => {
  const animation = () => ({
    frames: [makeFrame(3, 3, 1, 1), makeFrame(3, 3, 2, 0)],
    steps: [
      { frame: 0, jiffies: 4 },
      { frame: 1, jiffies: 9 },
      { frame: 0, jiffies: 2 },
    ],
  });

  test('round trips frames, hotspots, sequence and rates', () => {
    const written = animation();
    const back = parseAni(writeAni(written));

    assert.deepStrictEqual(back.steps, written.steps);
    assert.strictEqual(back.frames.length, 2);
    assert.deepStrictEqual(
      back.frames.map((frame) => [
        frame.hotspotX,
        frame.hotspotY,
        [...frame.pixels],
      ]),
      written.frames.map((frame) => [
        frame.hotspotX,
        frame.hotspotY,
        [...frame.pixels],
      ]),
    );
  });

  test('is told from a plain cursor by its RIFF signature', () => {
    assert.ok(parseCursorFile(writeAni(animation())).steps);
    assert.strictEqual(
      parseCursorFile(writeCur([makeFrame(2, 2)])).steps,
      undefined,
    );
  });

  test('plays the frames in order at the header rate when seq and rate are missing', () => {
    const bytes = writeAni(animation());
    // Rename the rate and seq chunks to ids nothing reads
    const text = String.fromCharCode(...bytes);
    const renamed = Uint8Array.from(
      text.replace('rate', 'xxxx').replace('seq ', 'yyyy'),
      (c) => c.charCodeAt(0),
    );
    const back = parseAni(renamed);

    assert.deepStrictEqual(back.steps, [
      { frame: 0, jiffies: 4 },
      { frame: 1, jiffies: 4 },
    ]);
  });

  test('skips a list of another type by its size', () => {
    const bytes = writeAni(animation());
    const watermark = Uint8Array.from(
      [...'LIST']
        .map((c) => c.charCodeAt(0))
        .concat(
          [12, 0, 0, 0],
          [...'Crea'].map((c) => c.charCodeAt(0)),
          [...'abcdefgh'].map((c) => c.charCodeAt(0)),
        ),
    );
    const merged = new Uint8Array(bytes.length + watermark.length);

    merged.set(bytes);
    merged.set(watermark, bytes.length);

    assert.strictEqual(parseAni(merged).frames.length, 2);
  });

  test('ends on a chunk that declares size zero', () => {
    const bytes = writeAni(animation());
    const withEmpty = new Uint8Array(bytes.length + 8);

    withEmpty.set(bytes);
    withEmpty.set(
      [...'JUNK'].map((c) => c.charCodeAt(0)),
      bytes.length,
    );

    assert.strictEqual(parseAni(withEmpty).frames.length, 2);
  });

  test('fails with a message on every truncation', () => {
    const bytes = writeAni(animation());

    for (let length = 0; length < bytes.length - 8; length += 7) {
      assert.throws(
        () => parseAni(bytes.subarray(0, length)),
        Error,
        `length ${length}`,
      );
    }
  });

  test('refuses frames of different sizes and a step that names no frame', () => {
    assert.throws(
      () =>
        writeAni({
          frames: [makeFrame(2, 2), makeFrame(3, 3)],
          steps: [{ frame: 0, jiffies: 1 }],
        }),
      /frame 1 is 2x2/,
    );
    assert.throws(
      () =>
        writeAni({
          frames: [makeFrame(2, 2)],
          steps: [{ frame: 1, jiffies: 1 }],
        }),
      /does not exist/,
    );
  });
});

suite('cursor conversion', () => {
  test('a cursor survives a trip through PNG and back with its hotspot typed in', () => {
    const [original] = parseCur(writeCur([makeFrame(6, 4, 3, 1)]));
    const image = decodePng(encodePng(original));
    const hotspot = parseHotspot('3,1', image.width, image.height);

    assert.ok(typeof hotspot !== 'string');

    const [back] = parseCur(
      writeCur([{ ...image, hotspotX: hotspot.x, hotspotY: hotspot.y }]),
    );

    assert.deepStrictEqual(back, original);
  });

  test('a PNG-compressed cursor entry opens through the host decoder', () => {
    const png = encodePng(makeFrame(3, 2));
    const bytes = buildCur([...png], [1, 1]);
    const [frame] = parseCur(bytes, { decodePng });

    assert.deepStrictEqual(
      [frame.width, frame.height, frame.hotspotX],
      [3, 2, 1],
    );
  });

  test('a typed hotspot is checked against the image', () => {
    assert.deepStrictEqual(parseHotspot(' 4 , 2 ', 8, 8), { x: 4, y: 2 });
    assert.deepStrictEqual(parseHotspot('4 2', 8, 8), { x: 4, y: 2 });
    assert.match(String(parseHotspot('8,0', 8, 8)), /inside/);
    assert.match(String(parseHotspot('-1,0', 8, 8)), /x,y/);
    assert.match(String(parseHotspot('left', 8, 8)), /x,y/);
  });
});

suite('animation builder', () => {
  test('rows become an animation that writes and reads back in the same order', () => {
    const rows = [
      { frame: makeFrame(4, 4, 1, 2), jiffies: millisecondsToJiffies(100) },
      { frame: makeFrame(4, 4, 3, 0), jiffies: millisecondsToJiffies(250) },
      { frame: makeFrame(4, 4, 0, 3), jiffies: millisecondsToJiffies(16) },
    ];
    const back = parseAni(writeAni(buildAnimation(rows)));

    assert.deepStrictEqual(
      back.steps,
      rows.map((row, frame) => ({ frame, jiffies: row.jiffies })),
    );
    assert.deepStrictEqual(
      back.frames.map((frame) => [frame.hotspotX, frame.hotspotY]),
      [
        [1, 2],
        [3, 0],
        [0, 3],
      ],
    );
    assert.deepStrictEqual(
      back.steps.map((step) => jiffiesToMilliseconds(step.jiffies)),
      [100, 250, 17],
    );
  });

  test('a duration never rounds down to no time at all', () => {
    assert.strictEqual(millisecondsToJiffies(0), 1);
    assert.strictEqual(millisecondsToJiffies(1000), 60);
  });

  test('rows of different sizes cannot be saved', () => {
    assert.throws(
      () =>
        writeAni(
          buildAnimation([
            { frame: makeFrame(4, 4), jiffies: 6 },
            { frame: makeFrame(4, 5), jiffies: 6 },
          ]),
        ),
      /Frame 2 is 4x5/,
    );
  });

  test('directory entries cannot share bytes to decode more than the file holds', () => {
    const file = writeCur([
      { width: 2, height: 2, hotspotX: 0, hotspotY: 0, pixels: new Uint8Array(16) },
    ]);
    const twice = new Uint8Array(file.length + 16);

    twice.set(file.subarray(0, 22));
    twice.set(file.subarray(6, 22), 22);
    twice.set(file.subarray(22), 38);

    const view = new DataView(twice.buffer);

    view.setUint16(4, 2, true);
    view.setUint32(18, 38, true);
    view.setUint32(34, 38, true);
    assert.throws(() => parseCur(twice), /more bytes than the file holds/);
  });

  test('a PNG image too large is refused before it is decoded', () => {
    const png = new Uint8Array(24);

    png.set([137, 80, 78, 71]);
    new DataView(png.buffer).setUint32(16, 100000);

    const file = new Uint8Array(22 + png.length);
    const view = new DataView(file.buffer);

    view.setUint16(2, 2, true);
    view.setUint16(4, 1, true);
    view.setUint32(14, png.length, true);
    view.setUint32(18, 22, true);
    file.set(png, 22);
    assert.throws(
      () =>
        parseCur(file, {
          decodePng: () => assert.fail('it must not be decoded'),
        }),
      /outside 1 to/,
    );
  });

  test('a step of no time lasts one jiffy', () => {
    const frame = { width: 1, height: 1, hotspotX: 0, hotspotY: 0, pixels: new Uint8Array(4) };
    const file = writeAni({ frames: [frame], steps: [{ frame: 0, jiffies: 1 }] });
    const text = String.fromCharCode(...file);
    const rate = text.indexOf('rate') + 8;

    new DataView(file.buffer, file.byteOffset).setUint32(rate, 0, true);
    assert.strictEqual(parseAni(file).steps[0].jiffies, 1);
  });
});
