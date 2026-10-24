import * as assert from 'assert';
import {
  parseAptMovie,
  parseConst,
  parseSpriteFrames,
} from '../../formats/apt/aptMovie';
import { AptImage, applyAptEdit } from '../../formats/apt/aptWriter';
import type { AptEdit } from '../../formats/apt/aptWriter';
import { buildMovie } from './apt.test';

/** Applies edits to the synthetic movie and parses the result */
const edited = (...edits: AptEdit[]) => {
  const { apt, constFile } = buildMovie();
  const movieOffset = parseConst(constFile).movieOffset;
  const image = new AptImage(apt);
  const results = edits.map((edit) => applyAptEdit(image, movieOffset, edit));

  return {
    original: apt,
    bytes: image.bytes,
    movie: parseAptMovie(image.bytes, movieOffset),
    results,
  };
};

suite('APT editing', () => {
  test('a movie with no edits comes back byte for byte', () => {
    const { original, bytes } = edited();

    assert.deepStrictEqual(bytes, original);
  });

  test('a new text is appended and only its pointer changes in the record', () => {
    const { original, bytes, movie } = edited({
      kind: 'character',
      id: 4,
      change: { field: 'text', value: 'A longer text than before' },
    });
    const edit = movie.characters[4];

    assert.ok(edit.type === 'editText');
    assert.strictEqual(edit.text, 'A longer text than before');

    // Every byte before the appended data but the one pointer is unchanged
    const changed = Array.from(original).flatMap((byte, index) =>
      byte === bytes[index] ? [] : [index],
    );

    assert.ok(
      changed.every(
        (index) => index >= edit.offset + 52 && index < edit.offset + 56,
      ),
    );
  });

  test('fixed fields change in place', () => {
    const { bytes, original, movie } = edited(
      {
        kind: 'character',
        id: 4,
        change: { field: 'color', value: 0xff00ff00 },
      },
      { kind: 'character', id: 4, change: { field: 'fontHeight', value: 18 } },
    );
    const edit = movie.characters[4];

    assert.strictEqual(bytes.length, original.length);
    assert.ok(edit.type === 'editText');
    assert.strictEqual(edit.color, 0xff00ff00);
    assert.strictEqual(edit.fontHeight, 18);
  });

  test('a placement moves, gets a name and a colour transform', () => {
    const { movie } = edited();
    const sprite = movie.characters[3];

    assert.ok(sprite.type === 'sprite');

    const { apt } = buildMovie();
    const [place] = parseSpriteFrames(apt, sprite)[0].items;
    const after = edited({
      kind: 'placement',
      offset: place.offset,
      change: {
        translate: [50, 60],
        name: 'thing',
        colorTransform: 0x80ffffff,
      },
    });
    const sprite2 = after.movie.characters[3];

    assert.ok(sprite2.type === 'sprite');

    const [moved] = parseSpriteFrames(after.bytes, sprite2)[0].items;

    assert.ok(moved.type === 'placeObject');
    assert.deepStrictEqual(moved.translate, [50, 60]);
    assert.strictEqual(moved.name, 'thing');
    assert.strictEqual(moved.colorTransform, 0x80ffffff);
    assert.strictEqual(moved.character, 1);
  });

  test('exports are added, renamed and removed', () => {
    const { movie } = edited(
      { kind: 'addExport', name: 'Shape', character: 1 },
      { kind: 'export', index: 0, name: 'LabelRenamed' },
      { kind: 'removeExport', index: 1 },
    );

    assert.deepStrictEqual(movie.exports, [
      { name: 'LabelRenamed', character: 4 },
    ]);
  });

  test('a duplicated sprite is a new character with its own timeline', () => {
    const { movie, results, bytes } = edited({
      kind: 'duplicateCharacter',
      id: 3,
    });
    const id = results[0].character!;

    assert.strictEqual(id, 5);
    assert.strictEqual(movie.characters.length, 6);

    const after = edited(
      { kind: 'duplicateCharacter', id: 3 },
      {
        kind: 'placeObject',
        timeline: 5,
        frame: 0,
        depth: 9,
        character: 2,
        translate: [1, 2],
      },
    );
    const original = after.movie.characters[3];
    const copy = after.movie.characters[5];

    assert.ok(original.type === 'sprite' && copy.type === 'sprite');
    assert.strictEqual(
      parseSpriteFrames(after.bytes, original)[0].items.length,
      1,
    );
    assert.strictEqual(parseSpriteFrames(after.bytes, copy)[0].items.length, 2);
    assert.ok(bytes.length > 0);
  });

  test('frames, labels and removals are added to a timeline', () => {
    const { movie } = edited(
      { kind: 'addFrame', timeline: 0 },
      { kind: 'addFrameLabel', timeline: 0, frame: 1, label: '_end' },
      { kind: 'removeObject', timeline: 0, frame: 1, depth: 2 },
    );

    assert.strictEqual(movie.frames.length, 2);
    assert.deepStrictEqual(
      movie.frames[1].items.map((item) => item.type),
      ['frameLabel', 'removeObject'],
    );

    const label = movie.frames[0].items[1];
    const removed = edited({
      kind: 'removeItem',
      timeline: 0,
      frame: 0,
      offset: label.offset,
    });

    assert.deepStrictEqual(
      removed.movie.frames[0].items.map((item) => item.type),
      ['placeObject', 'action'],
    );
  });

  test('an edit to a field the type lacks is refused', () => {
    assert.throws(
      () =>
        edited({
          kind: 'character',
          id: 1,
          change: { field: 'text', value: 'x' },
        }),
      /A shape has no field text/,
    );
  });
});

suite('APT new characters', () => {
  test('each kind is appended to the character table and reads back', () => {
    const { apt, constFile } = buildMovie();
    const movieOffset = parseConst(constFile).movieOffset;
    const image = new AptImage(apt);
    const ids = (['editText', 'sprite', 'shape', 'image'] as const).map(
      (type) =>
        applyAptEdit(image, movieOffset, { kind: 'addCharacter', type })
          .character,
    );
    const movie = parseAptMovie(image.bytes, movieOffset);

    assert.deepStrictEqual(ids, [5, 6, 7, 8]);
    assert.deepStrictEqual(
      ids.map((id) => movie.characters[id as number].type),
      ['editText', 'sprite', 'shape', 'image'],
    );

    const text = movie.characters[5];

    assert.ok(text.type === 'editText' && text.text === 'Text');

    const sprite = movie.characters[6];

    assert.ok(sprite.type === 'sprite');
    assert.strictEqual(parseSpriteFrames(image.bytes, sprite).length, 1);
  });
});
