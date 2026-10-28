import * as assert from 'assert';
import { parseAptMovie, parseConst } from '../../formats/apt/aptMovie';
import { AptImage, applyAptEdit } from '../../formats/apt/aptWriter';
import type { AptEdit } from '../../formats/apt/aptWriter';
import { buildFullMovie } from './aptFullEdit.test';

/** Applies edits to the full movie and reads it back */
const after = (...edits: AptEdit[]) => {
  const { apt, constFile } = buildFullMovie();
  const movieOffset = parseConst(constFile).movieOffset;
  const image = new AptImage(apt);

  edits.forEach((edit) => applyAptEdit(image, movieOffset, edit));
  return parseAptMovie(image.bytes, movieOffset);
};

const itemTypes = (movie: ReturnType<typeof after>) =>
  movie.frames[0].items.map((item) => item.type);

suite('APT block editor edits', () => {
  test('a frame item moves to another place in its frame', () => {
    const before = after();

    assert.deepStrictEqual(itemTypes(before), [
      'frameLabel',
      'backgroundColor',
      'initAction',
      'action',
    ]);
    assert.deepStrictEqual(
      itemTypes(
        after({ kind: 'moveItem', timeline: 0, frame: 0, from: 3, to: 0 }),
      ),
      ['action', 'frameLabel', 'backgroundColor', 'initAction'],
    );
    assert.deepStrictEqual(
      itemTypes(
        after({ kind: 'moveItem', timeline: 0, frame: 0, from: 0, to: 2 }),
      ),
      ['backgroundColor', 'initAction', 'frameLabel', 'action'],
    );
  });

  test("moving an item keeps each item's own fields", () => {
    const moved = after({
      kind: 'moveItem',
      timeline: 0,
      frame: 0,
      from: 0,
      to: 3,
    });
    const label = moved.frames[0].items[3];

    assert.ok(label.type === 'frameLabel');
    assert.strictEqual(label.label, '_start');
  });

  test('moving an item to where it is, or out of the frame, changes nothing or is refused', () => {
    assert.deepStrictEqual(
      itemTypes(
        after({ kind: 'moveItem', timeline: 0, frame: 0, from: 1, to: 1 }),
      ),
      itemTypes(after()),
    );
    assert.throws(() =>
      after({ kind: 'moveItem', timeline: 0, frame: 0, from: 0, to: 9 }),
    );
    assert.throws(() =>
      after({ kind: 'moveItem', timeline: 0, frame: 7, from: 0, to: 0 }),
    );
  });

  test("a button record moves among the button's records with all its fields", () => {
    const added = after({
      kind: 'addButtonRecord',
      id: 3,
      flags: 1,
      character: 1,
      depth: 9,
      color: [0.5, 0.25, 0.125, 1],
      unknown: [1, 2, 3, 4],
    });
    const button = added.characters[3];

    assert.ok(button.type === 'button');
    assert.strictEqual(button.records.length, 2);
    assert.deepStrictEqual(button.records[1].color, [0.5, 0.25, 0.125, 1]);
    assert.deepStrictEqual(button.records[1].unknown, [1, 2, 3, 4]);

    const swapped = after(
      {
        kind: 'addButtonRecord',
        id: 3,
        flags: 1,
        character: 1,
        depth: 9,
        color: [0.5, 0.25, 0.125, 1],
        unknown: [1, 2, 3, 4],
      },
      { kind: 'moveButtonRecord', id: 3, from: 1, to: 0 },
    );
    const moved = swapped.characters[3];

    assert.ok(moved.type === 'button');
    assert.strictEqual(moved.records[0].depth, 9);
    assert.deepStrictEqual(moved.records[0].color, [0.5, 0.25, 0.125, 1]);
    assert.strictEqual(moved.records[1].depth, 1);
    assert.deepStrictEqual(moved.records[1].matrix, [1, 0, 0, 1]);
  });

  test('a record that is not there cannot be moved', () => {
    assert.throws(() =>
      after({ kind: 'moveButtonRecord', id: 3, from: 0, to: 4 }),
    );
    assert.throws(() =>
      after({ kind: 'moveButtonRecord', id: 1, from: 0, to: 0 }),
    );
  });

  test('a new button record is white with no unknowns unless given', () => {
    const plain = after({
      kind: 'addButtonRecord',
      id: 3,
      flags: 1,
      character: 1,
      depth: 2,
    });
    const button = plain.characters[3];

    assert.ok(button.type === 'button');
    assert.deepStrictEqual(button.records[1].color, [1, 1, 1, 1]);
    assert.deepStrictEqual(button.records[1].unknown, [0, 0, 0, 0]);
  });
});
