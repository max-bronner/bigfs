import * as assert from 'assert';
import { behaviourOf } from '../../formats/apt/aptBehaviour';
import { compileScript } from '../../formats/apt/aptCompiler';
import type { FrameItem } from '../../formats/apt/aptMovie';
import { parseScript } from '../../formats/apt/aptScriptParser';
import { AptImage } from '../../formats/apt/aptWriter';
import { OVER, Player } from '../../webview/apt/player';
import type { PageMovie } from '../../webview/apt/protocol';

const place = (
  depth: number,
  character: number,
  extra: Partial<FrameItem> = {},
): FrameItem =>
  ({
    offset: 0,
    type: 'placeObject',
    flags: 0,
    depth,
    character,
    ...extra,
  }) as FrameItem;

const label = (text: string): FrameItem => ({
  offset: 0,
  type: 'frameLabel',
  label: text,
  flags: 0,
  frame: 0,
});

/**
 * #1 a three-frame sprite whose frame 1 runs block 10 (stop); #2 a nav
 * sprite: "closed" stops, "open" at frame 2; #3 a button inside nav whose
 * rollOver runs block 11, gotoAndPlay("open"); #4 a shape.
 */
const movie = {
  name: 'Test',
  record: { screenWidth: 100, screenHeight: 100 },
  characters: [
    { id: 0, offset: 0, type: 'movie' },
    { id: 1, offset: 0, type: 'sprite' },
    { id: 2, offset: 0, type: 'sprite' },
    {
      id: 3,
      offset: 0,
      type: 'button',
      records: [
        {
          flags: 1 | 8,
          character: 4,
          depth: 1,
          matrix: [1, 0, 0, 1],
          translate: [0, 0],
        },
      ],
      actions: [{ condition: 0x1, block: 11 }],
    },
    { id: 4, offset: 0, type: 'shape', bounds: [0, 0, 10, 10] },
  ],
  imports: [],
  exports: [],
  frames: [{ items: [place(1, 1), place(2, 2, { name: 'nav' })] }],
  spriteFrames: {
    1: [
      { items: [place(1, 4)] },
      { items: [{ offset: 0, type: 'action', block: 10 }] },
      { items: [] },
    ],
    2: [
      {
        items: [
          label('closed'),
          { offset: 0, type: 'action', block: 10 },
          place(1, 3),
        ],
      },
      { items: [] },
      { items: [label('open'), { offset: 0, type: 'action', block: 10 }] },
    ],
  },
  shapes: {},
  imageTextures: {},
  behaviours: {
    10: {
      commands: [{ op: 'stop', target: [] }],
      skipped: 0,
      conditional: false,
    },
    11: {
      commands: [{ op: 'goto', target: [], label: 'open', play: true }],
      skipped: 0,
      conditional: false,
    },
  },
} as unknown as PageMovie;

const player = (scripts = true) =>
  new Player(movie, 0, {
    resolve: (from, id) =>
      from.characters[id] && {
        movie: from,
        id,
        character: from.characters[id],
      },
    scripts,
    rootScripts: true,
  });

suite('APT player', () => {
  test('a sprite plays from frame 0 and holds where a frame script stops it', () => {
    const run = player();
    const sprite = run.find('/1')!;

    run.tick();
    assert.strictEqual(sprite.frame, 1);
    run.tick();
    run.tick();
    assert.strictEqual(sprite.frame, 1, 'it stopped on frame 1');

    const loose = player(false);

    for (let tick = 0; tick < 3; tick++) {
      loose.tick();
    }
    assert.strictEqual(loose.find('/1')!.frame, 0, 'without scripts it loops');
  });

  test("a button's rollOver runs on the timeline it is placed in, and shows its over state", () => {
    const run = player();
    const nav = run.find('/2')!;
    const button = run.find('/2/1')!;

    assert.strictEqual(nav.frame, 0);
    run.hover(undefined, button);
    assert.strictEqual(button.buttonState, OVER);
    assert.strictEqual(
      nav.frame,
      2,
      'gotoAndPlay("open") moved nav, not the button',
    );
    assert.strictEqual(nav.playing, false, '"open" runs its own stop');
  });

  test('a gotoAndPlay call and a GotoLabel opcode read back as timeline commands', () => {
    const image = new AptImage(new Uint8Array(64));
    const read = (source: string) => {
      const block = compileScript(parseScript(source), image, []);

      return behaviourOf(image.bytes, block, []);
    };

    assert.deepStrictEqual(
      read('_parent.nav.gotoAndPlay("open"); stop(); trace("x");'),
      {
        commands: [
          { op: 'goto', target: ['_parent', 'nav'], label: 'open', play: true },
          { op: 'stop', target: [] },
        ],
        skipped: 1,
        conditional: false,
      },
    );
    assert.deepStrictEqual(
      read(
        'asm SetTarget "../menu"; asm GotoFrame 3; asm Play; asm SetTarget "";',
      ).commands,
      [
        { op: 'goto', target: ['_parent', 'menu'], frame: 3, play: false },
        { op: 'play', target: ['_parent', 'menu'] },
      ],
    );
    assert.strictEqual(
      read('if (a) { gotoAndStop(2); }').conditional,
      true,
      'a branch stops the reading',
    );
  });
});
