import * as assert from 'assert';
import {
  parseAptMovie,
  parseConst,
  parseSpriteFrames,
} from '../../formats/apt/aptMovie';
import { applyAptEdit } from '../../formats/apt/writer/applyAptEdit';
import { AptImage } from '../../formats/apt/writer/aptImage';
import type { AptEdit } from '../../formats/apt/writer/aptEdit';
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

  test('swapping depths moves every record of both depths, in every frame', () => {
    const depths = (movie: ReturnType<typeof edited>['movie']) =>
      movie.frames.map((frame) =>
        frame.items.flatMap((item) =>
          'depth' in item ? [`${item.type}@${item.depth}`] : [],
        ),
      );
    const before = edited(
      { kind: 'placeObject', timeline: 0, frame: 0, depth: 7, character: 1 },
      { kind: 'addFrame', timeline: 0 },
      { kind: 'removeObject', timeline: 0, frame: 1, depth: 7 },
    );
    const after = edited(
      { kind: 'placeObject', timeline: 0, frame: 0, depth: 7, character: 1 },
      { kind: 'addFrame', timeline: 0 },
      { kind: 'removeObject', timeline: 0, frame: 1, depth: 7 },
      { kind: 'swapDepths', timeline: 0, a: 7, b: 8 },
    );

    assert.deepStrictEqual(
      depths(after.movie),
      depths(before.movie).map((frame) =>
        frame.map((entry) => entry.replace('@7', '@8')),
      ),
    );
  });

  test('a new button reads back, gains a record, and its scripts attach and detach', () => {
    const { movie, results } = edited(
      { kind: 'addCharacter', type: 'button' },
      {
        kind: 'addButtonRecord',
        id: 5,
        flags: 15,
        character: 1,
        depth: 1,
        translate: [4, 5],
      },
      { kind: 'addButtonAction', id: 5, condition: 0x1, block: 0x100 },
      { kind: 'addButtonAction', id: 5, condition: 0x4, block: 0x200 },
      { kind: 'buttonAction', id: 5, index: 1, condition: 0x8 },
      { kind: 'removeButtonAction', id: 5, index: 0 },
    );
    const button = movie.characters[5];

    assert.strictEqual(results[0].character, 5);
    assert.ok(button.type === 'button');
    assert.deepStrictEqual(button.bounds, [0, 0, 100, 30]);
    assert.strictEqual(button.hitTriangles, 2);
    assert.deepStrictEqual(
      button.records.map(({ flags, character, depth, translate }) => ({
        flags,
        character,
        depth,
        translate,
      })),
      [{ flags: 15, character: 1, depth: 1, translate: [4, 5] }],
    );
    assert.deepStrictEqual(button.actions, [{ condition: 0x8, block: 0x200 }]);
  });

  test('frame and clip scripts attach to a timeline and a placement, and detach', () => {
    const place = (movie: ReturnType<typeof edited>['movie']) =>
      movie.frames[0].items.find((item) => item.type === 'placeObject')!;
    const { movie: before } = edited();
    const { movie } = edited(
      { kind: 'addFrameScript', timeline: 0, frame: 0, block: 0x300 },
      {
        kind: 'addClipAction',
        offset: place(before).offset,
        events: 1 << 9,
        block: 0x400,
      },
      {
        kind: 'addClipAction',
        offset: place(before).offset,
        events: 1,
        block: 0x500,
      },
      { kind: 'clipAction', offset: place(before).offset, index: 1, events: 2 },
      { kind: 'removeClipAction', offset: place(before).offset, index: 0 },
    );
    const item = place(movie);

    assert.deepStrictEqual(movie.frames[0].items.at(-1), {
      offset: movie.frames[0].items.at(-1)!.offset,
      type: 'action',
      block: 0x300,
    });
    assert.ok(item.type === 'placeObject');
    assert.deepStrictEqual(item.clipActions, [{ events: 2, block: 0x500 }]);
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
