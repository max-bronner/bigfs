import * as assert from 'assert';
import { CHARACTER_SIGNATURE, parseConst } from '../../formats/apt/aptMovie';
import {
  blockScripts,
  movieText,
  saveMovieText,
  TextSaveError,
} from '../../formats/apt/movieTextEdits';
import type { TextSave } from '../../formats/apt/movieTextEdits';
import {
  composeMatrix,
  f32Bits,
  formatF32,
  movieToText,
  parseMovieText,
  printMovieText,
  textBlocks,
} from '../../formats/apt/movieText';
import { buildFullMovie } from './aptFullEdit.test';
import { Image, buildConst } from './aptSynth';

/** The full movie's text, and a save of that text with `edit` applied to it */
const full = () => {
  const { apt, constFile, offsets } = buildFullMovie();
  const text = movieText(apt, constFile);
  const before = movieToText(
    apt,
    constFile,
    blockScripts(apt, parseConst(constFile).items),
  );
  const save = (edit: (text: string) => string): TextSave => {
    const parsed = parseMovieText(edit(text));

    assert.deepStrictEqual(parsed.problems, []);
    return saveMovieText(apt, constFile, before, parsed.movie);
  };

  return { apt, constFile, offsets, text, save };
};

/** Replaces exactly one occurrence, so a test cannot edit the wrong line */
const replaceOnce = (text: string, from: string, to: string): string => {
  assert.strictEqual(text.split(from).length, 2, `"${from}" occurs once`);
  return text.replace(from, to);
};

/** A movie of one character of an unknown type, whose frame holds an unknown item */
const buildUnknownMovie = () => {
  const apt = new Image();

  apt.u8(...Array.from('Apt Data:7\x1a\0', (c) => c.charCodeAt(0)));
  apt.align();

  const strange = apt.u32(42, CHARACTER_SIGNATURE, 0);
  const item = apt.u32(77, 0);
  const items = apt.u32(item);
  const frames = apt.u32(1, items);
  const characters = apt.u32(0, strange);
  const movie = apt.u32(9, CHARACTER_SIGNATURE, 1, frames, 0, 2, characters);

  apt.u32(800, 600, 33, 0, 0, 0, 0, 0);
  apt.patch(characters, movie);
  return { apt: apt.build(), constFile: buildConst(movie, []) };
};

suite('APT text view', () => {
  test('the text of every record kind reads back to the same text', () => {
    const { text } = full();
    const parsed = parseMovieText(text);

    assert.deepStrictEqual(parsed.problems, []);
    assert.strictEqual(printMovieText(parsed.movie), text);

    for (const kind of [
      'movie',
      'shape',
      'font',
      'button',
      'sprite',
      'image',
      'morph',
      'text',
      'edittext',
      'placeholder',
    ]) {
      assert.match(text, new RegExp(`^character \\d+ ${kind}\\b`, 'm'));
    }
    for (const line of [
      'bg ',
      'initaction',
      'action',
      'place move',
      'remove',
      'record',
      'run',
      'import',
      'export',
    ]) {
      assert.ok(text.includes(line), line);
    }
  });

  test('unknown characters and frame items keep their type through the text', () => {
    const { apt, constFile } = buildUnknownMovie();
    const text = movieText(apt, constFile);

    assert.match(text, /^character 1 unknown type=42$/m);
    assert.match(text, /^ {4}unknown type=77$/m);
    assert.strictEqual(printMovieText(parseMovieText(text).movie), text);
  });

  test('saving the text unchanged writes nothing and keeps every byte', () => {
    const { apt, constFile, save } = full();
    const saved = save((text) => text);

    assert.deepStrictEqual(saved.edits, []);
    assert.deepStrictEqual(saved.scripts, []);
    assert.deepStrictEqual(saved.constChanges, []);
    assert.deepStrictEqual(saved.apt, apt);
    assert.deepStrictEqual(saved.constBytes, constFile);
  });

  test('comments and blank lines are free to add', () => {
    const { apt, save } = full();
    const saved = save(
      (text) =>
        `; my notes\n${text.replace('character 1 shape', '\n; the box\ncharacter 1 shape')}`,
    );

    assert.deepStrictEqual(saved.edits, []);
    assert.deepStrictEqual(saved.apt, apt);
  });

  test('editing placement fields gives one placement edit of those fields', () => {
    const { offsets, save } = full();
    const saved = save((text) =>
      replaceOnce(
        text,
        'place move depth=2 char=1 name="clip" at 5,6 color *64,128,255,128 +16,32,48,0 ratio=0.5 clip=4',
        'place depth=3 char=1 name="clip" at 5,6 scale 2,2 color *64,128,255,128 +16,32,48,0 clip=4',
      ),
    );

    assert.deepStrictEqual(saved.edits, [
      {
        kind: 'placement',
        offset: offsets.place,
        change: {
          depth: 3,
          matrix: [2, 0, 0, 2],
          translate: [5, 6],
          isMove: false,
          clear: ['ratio'],
        },
      },
    ]);
  });

  test('each record kind edits through its own AptEdit', () => {
    const { offsets, save } = full();
    const saved = save((text) => {
      let next = text;

      next = replaceOnce(next, 'frame 0 "_start"', 'frame 0 "_begin"');
      next = replaceOnce(next, 'bg #302010ff', 'bg #302011ff');
      next = replaceOnce(next, 'initaction sprite=4', 'initaction sprite=5');
      next = replaceOnce(next, 'remove depth=7', 'remove depth=8');
      next = replaceOnce(next, 'geometry=1', 'geometry=2');
      next = replaceOnce(next, 'glyphs=65,66', 'glyphs=65');
      next = replaceOnce(next, 'color 0.5,0.25,1,1', 'color 0.5,0.25,1,0.5');
      next = replaceOnce(next, 'condition=0x00000008', 'condition=0x00000010');
      next = replaceOnce(next, 'events=0x00000002', 'events=0x00000004');
      next = replaceOnce(next, 'texture=5', 'texture=6');
      next = replaceOnce(next, 'morph start=1 end=1', 'morph start=1 end=2');
      next = replaceOnce(next, 'height=12 glyphs=3:7', 'height=14 glyphs=3:7');
      next = replaceOnce(next, 'text="Hello"', 'text="Hi" var="score"');
      next = replaceOnce(
        next,
        'import 9 "shared" "Thing"',
        'import 9 "common" "Thing"',
      );
      next = replaceOnce(next, 'export 8 "Label"', 'export 8 "Title"');
      next = replaceOnce(next, 'screen=1024x768', 'screen=800x600');
      return next;
    });

    assert.deepStrictEqual(saved.edits, [
      { kind: 'import', index: 0, movie: 'common' },
      { kind: 'screen', width: 800, height: 600 },
      { kind: 'character', id: 1, change: { field: 'geometry', value: 2 } },
      { kind: 'character', id: 2, change: { field: 'glyphs', value: [65] } },
      {
        kind: 'buttonRecord',
        offset:
          saved.edits[4].kind === 'buttonRecord' ? saved.edits[4].offset : -1,
        color: [0.5, 0.25, 1, 0.5],
      },
      { kind: 'buttonAction', id: 3, index: 0, condition: 0x10 },
      { kind: 'character', id: 5, change: { field: 'texture', value: 6 } },
      { kind: 'character', id: 6, change: { field: 'endShape', value: 2 } },
      { kind: 'textRecord', id: 7, index: 0, change: { textHeight: 14 } },
      { kind: 'character', id: 8, change: { field: 'text', value: 'Hi' } },
      {
        kind: 'character',
        id: 8,
        change: { field: 'variable', value: 'score' },
      },
      { kind: 'export', index: 0, name: 'Title' },
      { kind: 'frameLabel', offset: offsets.rootLabel, label: '_begin' },
      {
        kind: 'backgroundColor',
        offset: offsets.rootBackground,
        color: 0xff112030,
      },
      { kind: 'initAction', offset: offsets.rootInit, sprite: 5 },
      {
        kind: 'clipAction',
        offset: offsets.place,
        index: 0,
        events: 4,
      },
      { kind: 'removeObjectDepth', offset: offsets.remove, depth: 8 },
    ]);
    assert.ok(
      saved.edits[4].kind === 'buttonRecord' && saved.edits[4].offset > 0,
    );
  });

  test('a removed line removes its item, and an added one is appended', () => {
    const { offsets, save } = full();
    const saved = save((text) =>
      replaceOnce(
        text,
        '    remove depth=7\n',
        '    label "idle"\n    remove depth=9\n',
      ),
    );

    assert.deepStrictEqual(saved.edits, [
      { kind: 'addFrameLabel', timeline: 4, frame: 0, label: 'idle' },
      { kind: 'removeObjectDepth', offset: offsets.remove, depth: 9 },
      {
        kind: 'setTimeline',
        timeline: 4,
        frames: [
          {
            items: [
              { reuse: offsets.place },
              {
                reuse: (
                  saved.edits[2] as { frames: { items: { reuse: number }[] }[] }
                ).frames[0].items[1].reuse,
              },
              { reuse: offsets.remove },
            ],
          },
        ],
      },
    ]);

    const removed = full().save((text) =>
      replaceOnce(text, '    remove depth=7\n', ''),
    );

    assert.deepStrictEqual(removed.edits, [
      { kind: 'removeItem', timeline: 4, frame: 0, offset: offsets.remove },
    ]);
  });

  test("a new frame, character and placement are built from the editor's own edits", () => {
    const { save } = full();
    const saved = save((text) =>
      replaceOnce(
        text,
        'character 9 placeholder\n',
        'character 9 placeholder\ncharacter 10 sprite\n  frame 0\n    place depth=1 char=1 at 10,20 rot 90\n  frame 1 "end"\n',
      ),
    );

    assert.deepStrictEqual(
      saved.edits.map((edit) => edit.kind),
      ['addCharacter', 'addFrame', 'placeObject', 'addFrameLabel'],
    );
    assert.deepStrictEqual(saved.edits[2], {
      kind: 'placeObject',
      timeline: 10,
      frame: 0,
      depth: 1,
      character: 1,
      matrix: [0, 1, -1, 0],
      translate: [10, 20],
    });
  });

  test('a script edited everywhere it runs is compiled once', () => {
    const { save, apt } = full();
    const saved = save((text) =>
      text.replace(/```as\n(\s*)```/g, '```as\n$1stop();\n$1```'),
    );

    assert.deepStrictEqual(saved.edits, []);
    assert.strictEqual(saved.scripts.length, 1);
    assert.ok(saved.scripts[0].start >= apt.length);
    assert.match(movieText(saved.apt, saved.constBytes), /^ +stop\(\);$/m);
  });

  test('a script shared by several places cannot be edited in one of them', () => {
    const { apt, constFile } = buildFullMovie();
    const text = movieText(apt, constFile);
    const edited = replaceOnce(
      text,
      '    action\n      ```as\n      ```',
      '    action\n      ```as\n      stop();\n      ```',
    );
    const before = movieToText(
      apt,
      constFile,
      blockScripts(apt, parseConst(constFile).items),
    );

    assert.throws(
      () => saveMovieText(apt, constFile, before, parseMovieText(edited).movie),
      (error: unknown) =>
        error instanceof TextSaveError &&
        /runs in 4 places/.test(error.message),
    );
  });

  test('a new frame action compiles its script', () => {
    const { save } = full();
    const saved = save((text) =>
      replaceOnce(
        text,
        '    remove depth=7\n',
        '    remove depth=7\n    action\n      ```as\n      play();\n      ```\n',
      ),
    );

    assert.deepStrictEqual(
      saved.edits.map((edit) => edit.kind),
      ['addFrameScript'],
    );
    assert.match(movieText(saved.apt, saved.constBytes), /^ +play\(\);$/m);
  });

  test('constants change in place and new ones are appended', () => {
    const { save } = full();
    const saved = save((text) =>
      replaceOnce(text, '  2 7\n', '  2 8\n  3 "added"\n'),
    );

    assert.deepStrictEqual(saved.constChanges, [{ index: 2, value: 8 }]);
    assert.deepStrictEqual(
      parseConst(saved.constBytes).items.map((item) => item.value),
      ['this', 'stop', 8, 'added'],
    );
  });

  test('parse errors are reported at their line', () => {
    const { text } = full();
    const parsed = parseMovieText(
      replaceOnce(text, 'geometry=1', 'geometry=one').replace(
        'texture=5',
        'texture=5 shiny=1',
      ),
    );

    assert.deepStrictEqual(
      parsed.problems.map((problem) => [problem.line, problem.message]),
      [
        [
          text.split('\n').findIndex((line) => line.includes('geometry=')),
          'geometry must be a whole number from 0 to 4294967295, not "one"',
        ],
        [
          text.split('\n').findIndex((line) => line.includes('texture=')),
          'image has no field shiny',
        ],
      ],
    );
  });

  test('a text that cannot be saved leaves the movie as it was', () => {
    const { apt, constFile } = buildFullMovie();
    const text = movieText(apt, constFile);
    const before = movieToText(
      apt,
      constFile,
      blockScripts(apt, parseConst(constFile).items),
    );
    const copy = Uint8Array.from(apt);

    assert.throws(
      () =>
        saveMovieText(
          apt,
          constFile,
          before,
          parseMovieText(
            replaceOnce(
              text,
              'character 5 image',
              'character 5 shape geometry=1 bounds=0,0,1,1 ;',
            ),
          ).movie,
        ),
      TextSaveError,
    );
    assert.deepStrictEqual(apt, copy);
  });

  test('floats print exactly and matrices as scale and rotation only when exact', () => {
    assert.strictEqual(formatF32(Math.fround(0.1)), '0.1');
    assert.strictEqual(formatF32(-0), '-0');
    assert.strictEqual(formatF32(Math.fround(1 / 3)), '0.33333334');

    const { save } = full();
    const rotated = save((text) =>
      replaceOnce(text, 'at 5,6 color', 'at 5,6 scale 2,3 rot 30 color'),
    );

    assert.match(
      movieText(rotated.apt, rotated.constBytes),
      /at 5,6 scale 2,3 rot 30 color/,
    );
    assert.deepStrictEqual(
      (rotated.edits[0] as { change: { matrix: number[] } }).change.matrix,
      composeMatrix(2, 3, 30),
    );

    const raw = full().save((text) =>
      replaceOnce(text, 'at 5,6 color', 'at 5,6 matrix 0.1,0.2,0.3,0.4 color'),
    );

    assert.match(
      movieText(raw.apt, raw.constBytes),
      /at 5,6 matrix 0\.1,0\.2,0\.3,0\.4 color/,
    );
  });

  test('every placement matrix and translation survives the text bit for bit', () => {
    // A small fixed generator, so a failure names the same matrix every run
    let seed = 0x2545f491;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 2 ** 32;
    };
    const awkward: { matrix: number[]; at: number[] }[] = [
      // A retail menu's scale and rotation, composed at full precision
      {
        matrix: composeMatrix(0.60046236, 0.60046236, 35.84454),
        at: [0.1, -0.2],
      },
      {
        matrix: composeMatrix(Math.fround(0.60046236), 0.60046236, 35.84454),
        at: [0, 0],
      },
      { matrix: composeMatrix(0.6, 1.7, 35.84454), at: [1e-7, 3e7] },
      { matrix: composeMatrix(-2.5, 0.3, -123.456789), at: [-0, -0] },
      { matrix: composeMatrix(1, 1, 90), at: [0, 0] },
      { matrix: composeMatrix(1, 1, -0.0001), at: [0, 0] },
      { matrix: composeMatrix(1e-30, 1e30, 12.5), at: [1e-40, -1e38] },
      { matrix: [1, 0.5, -0.25, 1], at: [0, 0] },
      { matrix: [-0, 0.1, -0.1, -0], at: [0, 0] },
      { matrix: [1, -0, 0, 1], at: [0, 0] },
      { matrix: [-0, -0, -0, -0], at: [0, 0] },
      { matrix: [1e-45, 3.4e38, -3.4e38, 1e-45], at: [3.4e38, -1e-45] },
      { matrix: [0.6, 0, 0, 0.6], at: [0, 0] },
    ];

    for (let index = 0; index < 40; index++) {
      const scale = () => (random() < 0.5 ? -1 : 1) * 10 ** (random() * 8 - 4);
      const degrees = random() * 720 - 360;

      awkward.push(
        {
          matrix: composeMatrix(scale(), scale(), degrees),
          at: [scale(), scale()],
        },
        {
          matrix: [scale(), scale(), scale(), scale()].map(Math.fround),
          at: [random() * 2000 - 1000, random()],
        },
      );
    }

    for (const { matrix, at } of awkward) {
      const words = `at ${at.map(formatF32).join(',')} matrix ${matrix.map(formatF32).join(',')} color`;
      const placed = full().save((text) =>
        replaceOnce(text, 'at 5,6 color', words),
      );
      const change = (
        placed.edits[0] as { change: { matrix: number[]; translate: number[] } }
      ).change;

      assert.deepStrictEqual(
        change.matrix.map(f32Bits),
        matrix.map(f32Bits),
        words,
      );
      assert.deepStrictEqual(
        change.translate.map(f32Bits),
        at.map(f32Bits),
        words,
      );

      const text = movieText(placed.apt, placed.constBytes);
      const parsed = parseMovieText(text);

      assert.deepStrictEqual(parsed.problems, [], words);
      assert.strictEqual(printMovieText(parsed.movie), text, words);

      const resaved = saveMovieText(
        placed.apt,
        placed.constBytes,
        movieToText(
          placed.apt,
          placed.constBytes,
          blockScripts(placed.apt, parseConst(placed.constBytes).items),
        ),
        parsed.movie,
      );

      assert.deepStrictEqual(resaved.edits, [], words);
      assert.deepStrictEqual(resaved.constChanges, [], words);
      assert.deepStrictEqual(resaved.apt, placed.apt, words);
      assert.deepStrictEqual(resaved.constBytes, placed.constBytes, words);
    }
  });

  test('every character id names its declaration, and blocks fold whole', () => {
    const { text } = full();
    const lines = text.split('\n');
    const { ids } = parseMovieText(text);
    const sprite = lines.findIndex((line) => line === 'character 4 sprite');
    const place = lines.findIndex((line) => line.includes('place move'));

    assert.deepStrictEqual(
      ids.filter((site) => site.line === place),
      [
        {
          id: 1,
          line: place,
          column: lines[place].indexOf('char=1') + 5,
          endColumn: lines[place].indexOf('char=1') + 6,
          isDeclaration: false,
        },
      ],
    );
    assert.ok(
      ids.some(
        (site) =>
          site.isDeclaration &&
          site.id === 1 &&
          lines[site.line].startsWith('character 1 shape'),
      ),
    );
    assert.ok(
      textBlocks(text).some(
        (block) => block.start === sprite && block.end === place + 4,
      ),
    );
  });
});
