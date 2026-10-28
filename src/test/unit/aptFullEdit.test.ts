import * as assert from 'assert';
import {
  CHARACTER_SIGNATURE,
  parseAptMovie,
  parseConst,
  parseSpriteFrames,
} from '../../formats/apt/aptMovie';
import type {
  AptMovie,
  Character,
  Frame,
  FrameItem,
} from '../../formats/apt/aptMovie';
import {
  AptImage,
  applyAptEdit,
  changeConstItem,
} from '../../formats/apt/aptWriter';
import type { AptEdit } from '../../formats/apt/aptWriter';
import { Image, buildConst } from './aptSynth';

/**
 * A movie with one of every character type the parser reads and every
 * frame item: the root frame has a label, a background colour, an init
 * action and a script; the sprite places with every PlaceObject flag set,
 * clip actions included, and removes a depth.
 */
export const buildFullMovie = () => {
  const apt = new Image();

  apt.u8(...Array.from('Apt Data:7\x1a\0', (c) => c.charCodeAt(0)));
  apt.align();

  const block = apt.u8(0x00);
  apt.align();

  const shape = apt.u32(1, CHARACTER_SIGNATURE);
  apt.f32(0, 0, 10, 10);
  apt.u32(1);

  const fontName = apt.string('Arial');
  apt.align();
  const glyphTable = apt.u32(65, 66);
  const font = apt.u32(3, CHARACTER_SIGNATURE, fontName, 2, glyphTable);

  // A button: one record, its hit mesh a single triangle, one action
  const vertices = apt.f32(0, 0, 10, 0, 0, 10);
  const triangles = apt.u32(0 | (1 << 16), 2);
  const buttonRecords = apt.u32(1 | 2 | 4, 1, 1);
  apt.f32(1, 0, 0, 1, 2, 3, 0.5, 0.25, 1, 1, 0, 0, 0, 0);
  const buttonActions = apt.u32(0x8, block);
  const button = apt.u32(4, CHARACTER_SIGNATURE, 0);
  apt.f32(0, 0, 10, 10);
  apt.u32(1, 3, vertices, triangles, 1, buttonRecords, 1, buttonActions);

  // Sprite frame: a PlaceObject with every flag, a RemoveObject
  const placeName = apt.string('clip');
  apt.align();
  const clipArray = apt.u32(1 << 1, 0, block);
  const clipList = apt.u32(1, clipArray);
  const place = apt.u32(3, 0xff, 2, 1);
  apt.f32(1, 0, 0, 1, 5, 6);
  apt.u32(0x80ff8040, 0x00102030);
  apt.f32(0.5);
  apt.u32(placeName, 4, clipList);
  const remove = apt.u32(4, 7);
  const spriteItems = apt.u32(place, remove);
  const spriteFrames = apt.u32(2, spriteItems);
  const sprite = apt.u32(5, CHARACTER_SIGNATURE, 1, spriteFrames, 0);

  const image = apt.u32(7, CHARACTER_SIGNATURE, 5);
  const morph = apt.u32(8, CHARACTER_SIGNATURE, 1, 1);

  // A Text character with one run of two glyphs
  const glyphs = apt.u32(3, 7, 4, 0xfffffffe);
  const textRuns = apt.u32(2);
  apt.f32(0.25, 0.5, 1, 0.75, 0, 0, 0, 0, 1, 2, 12);
  apt.u32(2, glyphs);
  const text = apt.u32(10, CHARACTER_SIGNATURE);
  apt.f32(0, 0, 50, 20, 1, 0, 0, 1, 4, 8);
  apt.u32(1, textRuns);

  const textValue = apt.string('Hello');
  apt.align();
  const editText = apt.u32(2, CHARACTER_SIGNATURE);
  apt.f32(0, 0, 100, 20);
  apt.u32(2, 1, 0xffffcc00);
  apt.f32(12);
  apt.u32(1, 0, 0, textValue, 0);

  const label = apt.string('_start');
  apt.align();
  const rootLabel = apt.u32(2, label, 0, 0);
  const rootBackground = apt.u32(5, 0xff102030);
  const rootInit = apt.u32(8, 4, block);
  const rootAction = apt.u32(1, block);
  const rootItems = apt.u32(rootLabel, rootBackground, rootInit, rootAction);
  const rootFrames = apt.u32(4, rootItems);

  const importMovie = apt.string('shared');
  const importName = apt.string('Thing');
  const exportName = apt.string('Label');
  apt.align();
  const imports = apt.u32(importMovie, importName, 9, 0);
  const exports = apt.u32(exportName, 8);
  const characters = apt.u32(
    0,
    shape,
    font,
    button,
    sprite,
    image,
    morph,
    text,
    editText,
    0,
  );
  const movie = apt.u32(
    9,
    CHARACTER_SIGNATURE,
    1,
    rootFrames,
    0,
    10,
    characters,
  );
  apt.u32(1024, 768, 33, 1, imports, 1, exports, 0);
  apt.patch(characters, movie);

  return {
    apt: apt.build(),
    constFile: buildConst(movie, ['this', 'stop', 7]),
    offsets: { place, remove, rootLabel, rootBackground, rootInit },
  };
};

/** Everything the parser reads of a movie, sprite frames included */
const readAll = (bytes: Uint8Array, movieOffset: number) => {
  const movie = parseAptMovie(bytes, movieOffset);
  const sprite = movie.characters[4];

  assert.ok(sprite.type === 'sprite');
  return { movie, spriteFrames: parseSpriteFrames(bytes, sprite) };
};

type Parsed = ReturnType<typeof readAll>;

/** Applies edits to the full movie and gives what was read before and after */
const edited = (...edits: AptEdit[]) => {
  const { apt, constFile, offsets } = buildFullMovie();
  const movieOffset = parseConst(constFile).movieOffset;
  const image = new AptImage(apt);

  edits.forEach((edit) => applyAptEdit(image, movieOffset, edit));

  const bytes = image.bytes;
  // The bytes of the original that the edits changed
  const changed = Array.from(apt).flatMap((byte, index) =>
    byte === bytes[index] ? [] : [index],
  );

  return {
    before: readAll(apt, movieOffset),
    after: readAll(bytes, movieOffset),
    changed,
    offsets,
  };
};

/** Asserts the edit changed what `expect` changes and nothing else the parser reads */
const assertOnly = (
  result: { before: Parsed; after: Parsed },
  expect: (parsed: Parsed) => void,
): void => {
  const expected = structuredClone(result.before);

  expect(expected);
  assert.deepStrictEqual(result.after, expected);
};

/** Asserts every changed byte of the original lies in one of the ranges */
const assertBytesWithin = (changed: number[], ranges: [number, number][]) =>
  assert.deepStrictEqual(
    changed.filter(
      (index) => !ranges.some(([from, to]) => index >= from && index < to),
    ),
    [],
  );

const ofType = <T extends Character['type']>(
  movie: AptMovie,
  id: number,
  type: T,
): Extract<Character, { type: T }> => {
  const character = movie.characters[id];

  assert.strictEqual(character.type, type);
  return character as Extract<Character, { type: T }>;
};

const placeIn = (frames: Frame[]) =>
  frames[0].items[0] as Extract<FrameItem, { type: 'placeObject' }>;

suite('APT editing, every field', () => {
  test('the full movie comes back byte for byte and reads every field', () => {
    const { before, changed } = edited();
    const { movie, spriteFrames } = before;

    assert.deepStrictEqual(changed, []);
    assert.strictEqual(movie.record.unknown36, 33);
    assert.deepStrictEqual(
      ofType(movie, 3, 'button').records[0].color,
      [0.5, 0.25, 1, 1],
    );
    assert.deepStrictEqual(ofType(movie, 7, 'text').records[0], {
      offset: ofType(movie, 7, 'text').records[0].offset,
      font: 2,
      // Stored as the rect's left, top, right, bottom 0.25, 0.5, 1, 0.75
      color: [0.5, 0.25, 0.75, 1],
      unknown: [0, 0, 0, 0],
      penOffset: [1, 2],
      textHeight: 12,
      glyphs: [
        { index: 3, advance: 7 },
        { index: 4, advance: -2 },
      ],
    });
    assert.deepStrictEqual(placeIn(spriteFrames), {
      ...placeIn(spriteFrames),
      flags: 0xff,
      colorTransform: 0x80ff8040,
      colorAdd: 0x00102030,
      ratio: 0.5,
      name: 'clip',
      clipDepth: 4,
    });
  });

  test('a placement takes a clip depth and its flag', () => {
    const result = edited(
      {
        kind: 'placement',
        offset: buildFullMovie().offsets.place,
        change: { clear: ['clipDepth'] },
      },
      {
        kind: 'placement',
        offset: buildFullMovie().offsets.place,
        change: { clipDepth: 9 },
      },
    );

    assertOnly(result, (parsed) => {
      placeIn(parsed.spriteFrames).clipDepth = 9;
    });
    const { place } = result.offsets;

    assertBytesWithin(result.changed, [[place + 56, place + 60]]);
  });

  test('clearing a field turns its flag off and leaves the stored value', () => {
    const result = edited({
      kind: 'placement',
      offset: buildFullMovie().offsets.place,
      change: { clear: ['colorTransform', 'ratio', 'character'] },
    });

    assertOnly(result, (parsed) => {
      const place = placeIn(parsed.spriteFrames);

      place.flags = 0xff & ~(0x02 | 0x08 | 0x10);
      place.colorTransform = undefined;
      place.colorAdd = undefined;
      place.ratio = undefined;
      place.character = undefined;
    });
    const { place } = result.offsets;

    assertBytesWithin(result.changed, [[place + 4, place + 8]]);
  });

  test('the full colour transform, ratio, move bit and character change in place', () => {
    const result = edited({
      kind: 'placement',
      offset: buildFullMovie().offsets.place,
      change: {
        colorTransform: 0x11223344,
        colorAdd: 0x55667788,
        ratio: 0.25,
        isMove: false,
        character: 5,
      },
    });

    assertOnly(result, (parsed) => {
      Object.assign(placeIn(parsed.spriteFrames), {
        flags: 0xfe,
        colorTransform: 0x11223344,
        colorAdd: 0x55667788,
        ratio: 0.25,
        character: 5,
      });
    });
    const { place } = result.offsets;

    assertBytesWithin(result.changed, [
      [place + 4, place + 16],
      [place + 40, place + 52],
    ]);
  });

  test('a button record takes its colour and unknown floats', () => {
    const { before } = edited();
    const record = ofType(before.movie, 3, 'button').records[0];
    const result = edited({
      kind: 'buttonRecord',
      offset: record.offset,
      color: [1, 0.5, 0, 0.75],
      unknown: [1, 2, 3, 4],
      depth: -2,
    });

    assertOnly(result, (parsed) => {
      Object.assign(ofType(parsed.movie, 3, 'button').records[0], {
        color: [1, 0.5, 0, 0.75],
        unknown: [1, 2, 3, 4],
        depth: -2,
      });
    });
    assertBytesWithin(result.changed, [
      [record.offset + 8, record.offset + 68],
    ]);
  });

  test('a frame label takes its flags and frame, and keeps its label', () => {
    const { rootLabel } = buildFullMovie().offsets;
    const result = edited({
      kind: 'frameLabel',
      offset: rootLabel,
      flags: 1,
      frame: 3,
    });

    assertOnly(result, (parsed) => {
      Object.assign(parsed.movie.frames[0].items[0], { flags: 1, frame: 3 });
    });
    assertBytesWithin(result.changed, [[rootLabel + 8, rootLabel + 16]]);
  });

  test('a background colour changes in place, and one can be added', () => {
    const { rootBackground } = buildFullMovie().offsets;
    const result = edited(
      { kind: 'backgroundColor', offset: rootBackground, color: 0xff00ff00 },
      { kind: 'addBackgroundColor', timeline: 4, frame: 0, color: 0xff0000ff },
    );

    assertOnly(result, (parsed) => {
      Object.assign(parsed.movie.frames[0].items[1], { color: 0xff00ff00 });
      parsed.spriteFrames[0].items.push({
        offset: result.after.spriteFrames[0].items[2].offset,
        type: 'backgroundColor',
        color: 0xff0000ff,
      });
    });
  });

  test('an init action is repointed at another sprite', () => {
    const { rootInit } = buildFullMovie().offsets;
    const result = edited({ kind: 'initAction', offset: rootInit, sprite: 7 });

    assertOnly(result, (parsed) => {
      Object.assign(parsed.movie.frames[0].items[2], { sprite: 7 });
    });
    assertBytesWithin(result.changed, [[rootInit + 4, rootInit + 8]]);
  });

  test('a RemoveObject takes another depth', () => {
    const { remove } = buildFullMovie().offsets;
    const result = edited({
      kind: 'removeObjectDepth',
      offset: remove,
      depth: -3,
    });

    assertOnly(result, (parsed) => {
      Object.assign(parsed.spriteFrames[0].items[1], { depth: -3 });
    });
    assertBytesWithin(result.changed, [[remove + 4, remove + 8]]);
  });

  test('an edit aimed at the wrong kind of frame item is refused', () => {
    const { remove } = buildFullMovie().offsets;

    assert.throws(
      () => edited({ kind: 'backgroundColor', offset: remove, color: 0 }),
      /No background colour/,
    );
  });

  test('every field of a text run changes, the glyphs appended', () => {
    const { before } = edited();
    const run = ofType(before.movie, 7, 'text').records[0];
    const glyphs = [{ index: 9, advance: -5 }];
    const result = edited({
      kind: 'textRecord',
      id: 7,
      index: 0,
      change: {
        font: 8,
        color: [1, 0.5, 0.25, 0],
        unknown: [1, 2, 3, 4],
        penOffset: [-1, 6],
        textHeight: 20,
        glyphs,
      },
    });

    assertOnly(result, (parsed) => {
      Object.assign(ofType(parsed.movie, 7, 'text').records[0], {
        font: 8,
        color: [1, 0.5, 0.25, 0],
        unknown: [1, 2, 3, 4],
        penOffset: [-1, 6],
        textHeight: 20,
        glyphs,
      });
    });
    assertBytesWithin(result.changed, [[run.offset, run.offset + 56]]);
  });

  test('a text run can be added and removed', () => {
    const added = edited({ kind: 'addTextRecord', id: 7, font: 2 });
    const records = ofType(added.after.movie, 7, 'text').records;

    assert.strictEqual(records.length, 2);
    assert.deepStrictEqual(
      { ...records[1], offset: 0 },
      {
        offset: 0,
        font: 2,
        color: [1, 1, 1, 1],
        unknown: [0, 0, 0, 0],
        penOffset: [0, 0],
        textHeight: 16,
        glyphs: [],
      },
    );
    assert.deepStrictEqual(
      { ...records[0], offset: 0 },
      { ...ofType(added.before.movie, 7, 'text').records[0], offset: 0 },
    );
    assertOnly(added, (parsed) => {
      ofType(parsed.movie, 7, 'text').records = records;
    });

    const removed = edited({ kind: 'removeTextRecord', id: 7, index: 0 });

    assertOnly(removed, (parsed) => {
      ofType(parsed.movie, 7, 'text').records = [];
    });
  });

  test('a Text character takes its matrix and translation', () => {
    const result = edited(
      {
        kind: 'character',
        id: 7,
        change: { field: 'matrix', value: [2, 0, 0.5, 2] },
      },
      {
        kind: 'character',
        id: 7,
        change: { field: 'translate', value: [-4, 3] },
      },
    );

    assertOnly(result, (parsed) => {
      Object.assign(ofType(parsed.movie, 7, 'text'), {
        matrix: [2, 0, 0.5, 2],
        translate: [-4, 3],
      });
    });
  });

  test('a morph takes its shapes, and a font its glyph ids', () => {
    const result = edited(
      { kind: 'character', id: 6, change: { field: 'startShape', value: 5 } },
      { kind: 'character', id: 6, change: { field: 'endShape', value: 8 } },
      {
        kind: 'character',
        id: 2,
        change: { field: 'glyphs', value: [1, 2, 3] },
      },
    );

    assertOnly(result, (parsed) => {
      Object.assign(ofType(parsed.movie, 6, 'morph'), {
        startShape: 5,
        endShape: 8,
      });
      ofType(parsed.movie, 2, 'font').glyphs = [1, 2, 3];
    });
  });

  test('the Movie record word at +36 and an import slot change in place', () => {
    const result = edited(
      { kind: 'movieUnknown36', value: 40 },
      { kind: 'import', index: 0, character: 1 },
    );

    assertOnly(result, (parsed) => {
      parsed.movie.record.unknown36 = 40;
      ofType(parsed.movie, 0, 'movie').record.unknown36 = 40;
      parsed.movie.imports[0].character = 1;
    });
  });
});

suite('.const editing', () => {
  const items = (bytes: Uint8Array) =>
    parseConst(bytes).items.map((item) => item.value);

  test('a number changes in place and a string is appended', () => {
    const original = buildConst(64, ['this', 'stop', 7]);
    const number = changeConstItem(original, { index: 2, value: 12 });

    assert.deepStrictEqual(items(number), ['this', 'stop', 12]);
    assert.strictEqual(number.length, original.length);

    const text = changeConstItem(original, { index: 1, value: 'play' });

    assert.deepStrictEqual(items(text), ['this', 'play', 7]);
    // Only the item's pointer moved; the old string stays where it was
    assert.deepStrictEqual(text.subarray(0, 0x2c), original.subarray(0, 0x2c));
    assert.deepStrictEqual(
      text.subarray(0x30, original.length),
      original.subarray(0x30),
    );
  });

  test('an item can change kind, and a missing one is refused', () => {
    const original = buildConst(64, ['this', 7]);

    assert.deepStrictEqual(
      items(changeConstItem(original, { index: 0, value: 3 })),
      [3, 7],
    );
    assert.deepStrictEqual(
      items(changeConstItem(original, { index: 1, value: '7' })),
      ['this', '7'],
    );
    assert.throws(
      () => changeConstItem(original, { index: 2, value: 1 }),
      /no item 2/,
    );
    assert.throws(
      () => changeConstItem(original, { index: 0, value: 0.5 }),
      /whole/,
    );
  });
});
