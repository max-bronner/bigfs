import * as assert from 'assert';
import {
  parseAptMovie,
  parseConst,
  parseSpriteFrames,
} from '../../formats/apt/aptMovie';
import { decodeBlock, printListing } from '../../formats/apt/aptBytecode';
import { parseDat, parseRu } from '../../formats/apt/aptGeometry';
import { Image, buildConst } from './aptSynth';

const SIGNATURE = 0x09876543;

/**
 * A movie with a shape, an image, a sprite placing the shape, an edit text
 * and a button; one frame placing the sprite, labelled, with an action.
 */
const buildMovie = () => {
  const apt = new Image();

  apt.u8(...Array.from('Apt Data:7\x1a\0', (c) => c.charCodeAt(0)));
  apt.align();

  const shape = apt.u32(1, SIGNATURE);
  apt.f32(0, 0, 10, 10);
  apt.u32(1);

  const image = apt.u32(7, SIGNATURE, 2);

  // Sprite: one frame placing character 1 at depth 1
  const place = apt.u32(3, 0x02 | 0x04, 1, 1);
  apt.f32(1, 0, 0, 1, 5, 6);
  apt.u32(0xffffffff, 0);
  apt.f32(0);
  apt.u32(0, 0, 0);
  const spriteItems = apt.u32(place);
  const spriteFrames = apt.u32(1, spriteItems);
  const sprite = apt.u32(5, SIGNATURE, 1, spriteFrames, 0);

  const text = apt.string('Hello');
  const variable = apt.string('_parent.label');
  const editText = apt.u32(2, SIGNATURE);
  apt.f32(0, 0, 100, 20);
  apt.u32(0, 1, 0xffffcc00);
  apt.f32(12);
  apt.u32(1, 0, 0, text, variable);

  // Action block: ConstantPool [0, 1]; push "go"; branch over a Stop; End
  apt.align();
  const poolList = apt.u32(0, 1);
  const go = apt.string('go');
  const block = apt.u8(0x88);
  apt.align();
  apt.u32(2, poolList);
  const pushAt = apt.u8(0xa1);
  apt.align();
  apt.u32(go);
  apt.u8(0x99);
  apt.align();
  apt.u32(1);
  apt.u8(0x07, 0x00);

  // Root frame: place the sprite, a label, the action
  apt.align();
  const label = apt.string('_start');
  apt.align();
  const rootPlace = apt.u32(3, 0x02, 2, 3);
  apt.u32(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  const rootLabel = apt.u32(2, label, 0, 0);
  const rootAction = apt.u32(1, block);
  const rootItems = apt.u32(rootPlace, rootLabel, rootAction);
  const rootFrames = apt.u32(3, rootItems);

  const exportName = apt.string('Label');
  apt.align();
  const exports = apt.u32(exportName, 4);
  const characters = apt.u32(0, shape, image, sprite, editText);

  const movie = apt.u32(9, SIGNATURE, 1, rootFrames, 0, 5, characters);
  apt.u32(1024, 768, 33, 0, 0, 1, exports, 0);
  apt.patch(characters, movie);

  return {
    apt: apt.build(),
    constFile: buildConst(movie, ['this', 'stop', 7]),
    block,
    pushAt,
  };
};

suite('APT movies', () => {
  test('the .const gives the movie offset and its items', () => {
    const { constFile } = buildMovie();
    const parsed = parseConst(constFile);

    assert.deepStrictEqual(
      parsed.items.map((item) => item.value),
      ['this', 'stop', 7],
    );
  });

  test('reads every character type, the exports and the timeline', () => {
    const { apt, constFile } = buildMovie();
    const movie = parseAptMovie(apt, parseConst(constFile).movieOffset);

    assert.deepStrictEqual(
      movie.characters.map((character) => character.type),
      ['movie', 'shape', 'image', 'sprite', 'editText'],
    );
    assert.deepStrictEqual(movie.exports, [{ name: 'Label', character: 4 }]);
    assert.deepStrictEqual(
      movie.frames[0].items.map((item) => item.type),
      ['placeObject', 'frameLabel', 'action'],
    );

    const edit = movie.characters[4];

    assert.ok(edit.type === 'editText');
    assert.strictEqual(edit.text, 'Hello');
    assert.strictEqual(edit.variable, '_parent.label');

    const sprite = movie.characters[3];

    assert.ok(sprite.type === 'sprite');

    const [placement] = parseSpriteFrames(apt, sprite)[0].items;

    assert.ok(placement.type === 'placeObject');
    assert.strictEqual(placement.character, 1);
    assert.deepStrictEqual(placement.translate, [5, 6]);
  });

  test('a character table that claims more than the file holds is refused', () => {
    const { apt, constFile } = buildMovie();
    const movieOffset = parseConst(constFile).movieOffset;

    new DataView(apt.buffer).setUint32(movieOffset + 20, 0x10000000, true);

    assert.throws(() => parseAptMovie(apt, movieOffset), /cannot fit/);
  });

  test('decodes a block with its aligned operands and branch targets', () => {
    const { apt, block } = buildMovie();
    const code = decodeBlock(apt, block);

    assert.deepStrictEqual(
      code.map((instruction) => instruction.name),
      ['ConstantPool', 'EA_PushString', 'BranchAlways', 'Stop', 'End'],
    );
    assert.strictEqual(code[1].operand, 'go');
    // The branch skips the one-byte Stop and lands on End
    assert.strictEqual(code[2].target, code[4].offset);

    const listing = printListing(code, [
      { kind: 'string', value: 'this' },
      { kind: 'string', value: 'stop' },
    ]);

    assert.match(listing, /ConstantPool \["this", "stop"\]/);
    assert.match(listing, /BranchAlways L[0-9a-f]+/);
  });

  test('an unknown opcode is named with its offset', () => {
    assert.throws(
      () => decodeBlock(Uint8Array.from([0x02, 0x00]), 0),
      /Unknown opcode 0x2 at 0/,
    );
  });

  test('reads .ru styles with the texture matrix as the data stores it', () => {
    const runs = parseRu(
      [
        'c',
        's s:255:0:0:255',
        't 0:0:10:0:0:10',
        's tc:255:255:255:255:2:0.5:0:0:0.5:1:2',
        't 0:0:4:0:0:4',
        's l:1:0:0:0:255',
        'l 0:0:10:10',
      ].join('\n'),
    );

    assert.deepStrictEqual(
      runs.map((run) => [
        run.style.kind,
        run.triangles.length,
        run.lines.length,
      ]),
      [
        ['solid', 6, 0],
        ['texture', 6, 0],
        ['line', 0, 4],
      ],
    );
    assert.deepStrictEqual(
      runs[1].style.kind === 'texture' && runs[1].style.transform,
      [0.5, 0, 0, 0.5, 1, 2],
    );
    assert.throws(() => parseRu('s s:1:2:3:4\nq 1:2'), /line 2/);
  });

  test('reads both .dat line forms', () => {
    const entries = parseDat(
      [
        '; Created by AptToBigc.',
        '3=0 0 112 5',
        '; Created by AptToBigc.',
        '4->1',
      ].join('\n'),
    );

    assert.deepStrictEqual(entries.get(3), {
      kind: 'standalone',
      rect: [0, 0, 112, 5],
    });
    assert.deepStrictEqual(entries.get(4), { kind: 'atlas', page: 1 });
  });
});
