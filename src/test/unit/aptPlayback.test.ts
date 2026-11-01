import * as assert from 'assert';
import { decodeBlock } from '../../formats/apt/aptBytecode';
import { compileScript } from '../../formats/apt/aptCompiler';
import type { FrameItem } from '../../formats/apt/aptMovie';
import { parseScript } from '../../formats/apt/aptScriptParser';
import { AptImage } from '../../formats/apt/writer/aptImage';
import { Engine } from '../../webview/apt/avm/engine';
import { DOWN, OVER, UP } from '../../webview/apt/buttonState';
import { Player } from '../../webview/apt/player';
import type { PageMovie } from '../../webview/apt/protocol';
import { collect, findPointerTargetAt } from '../../webview/apt/scene';
import type { Leaf } from '../../webview/apt/scene';

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

interface Source {
  /** The root's frame scripts */
  root: string[];
  /** Button action scripts, by condition */
  actions?: Record<number, string>;
  /** Extra items on the root's first frame */
  placed?: FrameItem[];
  /** The clip's frame count */
  frames?: number;
}

/**
 * #1 a clip named `kid` whose frames move its shape; #2 a shape; #3 a button
 * showing #2 up and #4 over at the same depth; #4 another shape.
 */
const start = ({ root, actions = {}, placed = [], frames = 3 }: Source) => {
  const image = new AptImage(new Uint8Array(64));
  const code: PageMovie['code'] = {};
  const compile = (text: string) => {
    const block = compileScript(parseScript(text), image, []);

    code[block] = decodeBlock(image.bytes, block);
    return block;
  };
  const record = (flags: number, character: number) => ({
    flags,
    character,
    depth: 1,
    matrix: [1, 0, 0, 1],
    translate: [0, 0],
  });
  const movie = {
    name: 'Test',
    record: { screenWidth: 100, screenHeight: 100 },
    characters: [
      { id: 0, offset: 0, type: 'movie' },
      { id: 1, offset: 0, type: 'sprite' },
      { id: 2, offset: 0, type: 'shape', bounds: [0, 0, 10, 20] },
      {
        id: 3,
        offset: 0,
        type: 'button',
        records: [record(1 | 8, 2), record(2 | 4, 4)],
        actions: Object.entries(actions).map(([condition, text]) => ({
          condition: Number(condition),
          block: compile(text),
        })),
      },
      { id: 4, offset: 0, type: 'shape', bounds: [0, 0, 10, 20] },
    ],
    imports: [],
    exports: [],
    frames: root.map((text, index) => ({
      items: [
        { offset: 0, type: 'action', block: compile(text) } as FrameItem,
        ...(index === 0
          ? [place(1, 1, { name: 'kid' }), place(2, 3, { name: 'btn', matrix: [1, 0, 0, 1], translate: [50, 50] }), ...placed]
          : []),
      ],
    })),
    spriteFrames: {
      1: Array.from({ length: frames }, (_, index) => ({
        items: [
          index === 0
            ? place(1, 2, { matrix: [1, 0, 0, 1], translate: [0, 0] })
            : place(1, 2, {
                flags: 1,
                character: undefined,
                matrix: [1, 0, 0, 1],
                translate: [index * 10, 0],
              }),
        ],
      })),
    },
    shapes: {},
    imageTextures: {},
    behaviours: {},
    code,
    consts: [],
    decodeFailed: [],
  } as unknown as PageMovie;
  const engine = new Engine(
    () => {},
    () => {},
  );

  engine.load({ overrides: {}, returns: {} });
  engine.reset(movie);

  const player = new Player(movie, 0, {
    resolve: (from, id) =>
      from.characters[id] && {
        movie: from,
        id,
        character: from.characters[id],
      },
    scripts: true,
    rootScripts: true,
    engine,
  });

  return {
    player,
    read: (name: string) => player.vm!.readBound(player.root, name),
    kid: player.root.children.get('1')!,
    button: player.root.children.get('2')!,
  };
};

suite('APT playback', () => {
  test('a frame script sees every clip already on its new frame', () => {
    const { player, read } = start({
      root: ['seen = kid._currentframe;', 'seen = kid._currentframe; stop();'],
    });

    player.tick();
    assert.strictEqual(read('seen'), 2);
  });

  test('a goto past the end lands on the last frame', () => {
    const { player, kid } = start({ root: ['kid.gotoAndStop(99); stop();'] });

    player.tick();
    assert.strictEqual(kid.frame, 2);
    assert.strictEqual(kid.playing, false);
  });

  test('both of two gotos in one script run their frames', () => {
    const { player, read } = start({
      root: ['stop(); gotoAndStop(2); gotoAndStop(3);', 'a = 1;', 'b = 1;'],
    });

    player.tick();
    assert.strictEqual(read('a'), 1);
    assert.strictEqual(read('b'), 1);
  });

  test('a one-frame clip stops playing', () => {
    const { player, kid } = start({ root: ['stop();'], frames: 1 });

    player.tick();
    assert.strictEqual(kid.playing, false);
  });

  test('hiding a clip leaves its timeline moving what it holds', () => {
    const { player, kid } = start({
      root: ['stop(); kid._visible = false;'],
    });

    player.tick();
    assert.ok(!kid.scripted);
    assert.deepStrictEqual(kid.children.get('1')!.translate, [10, 0]);
  });

  test('moving a clip takes it from its timeline', () => {
    const { kid } = start({ root: ['stop(); kid._x = 5;'] });

    assert.strictEqual(kid.scripted, true);
  });

  test("a clip's size is what it shows", () => {
    const { read } = start({
      root: ['stop(); wide = kid._width; high = kid._height;'],
    });

    assert.strictEqual(read('wide'), 10);
    assert.strictEqual(read('high'), 20);
  });

  test('a state with another character at the same depth swaps it', () => {
    const { player, button } = start({ root: ['stop();'] });

    assert.strictEqual(button.children.get('b1')!.placed, 2);
    player.hover(undefined, button);
    assert.strictEqual(button.buttonState, OVER);
    assert.strictEqual(button.children.get('b1')!.placed, 4);
  });

  test('a held button gets drag events, not roll events', () => {
    const { player, button, read } = start({
      root: ['stop();'],
      actions: { 0x2: 'rolled = 1;', 0x10: 'dragged = 1;' },
    });

    player.press(button);
    assert.strictEqual(button.buttonState, DOWN);
    player.hover(button, undefined, button);
    assert.strictEqual(read('dragged'), 1);
    assert.strictEqual(read('rolled'), undefined);
    assert.strictEqual(button.buttonState, OVER);
  });

  test('a release elsewhere rolls over what is under the pointer', () => {
    const { player, button, read } = start({
      root: ['stop();'],
      actions: { 0x40: 'outside = 1;' },
      placed: [place(3, 3, { name: 'other' })],
    });
    const other = player.root.children.get('3')!;

    player.press(button);
    player.release(button, other);
    assert.strictEqual(read('outside'), 1);
    assert.strictEqual(button.buttonState, UP);
    assert.strictEqual(other.buttonState, OVER);
  });

  test('a disabled button runs nothing', () => {
    const { player, button, read } = start({
      root: ['stop(); btn.enabled = false;'],
      actions: { 0x1: 'ran = 1;' },
    });

    player.hover(undefined, button);
    assert.strictEqual(read('ran'), undefined);
    assert.strictEqual(button.buttonState, UP);
  });

  test('a clip with a mouse handler takes the pointer over what it holds', () => {
    const { player, kid } = start({
      root: ['stop(); kid.onRollOver = function () { over = 1; };'],
    });
    const { hits } = collect(player);

    assert.strictEqual(findPointerTargetAt(hits, [5, 5]), kid);
    player.hover(undefined, kid);
    assert.strictEqual(player.vm!.readBound(player.root, 'over'), 1);
  });

  test('a cleared handler no longer takes the pointer', () => {
    const { player, kid } = start({
      root: ['stop(); kid.onRollOver = undefined;'],
    });

    assert.strictEqual(player.takesPointer(kid), false);
  });

  test('a mask cuts a hit area', () => {
    const leaf = (matrix: Leaf['matrix'], masks?: Leaf[][]) =>
      ({
        matrix,
        masks,
        character: { type: 'shape', bounds: [0, 0, 10, 10], geometry: 0 },
      }) as unknown as Leaf;
    const mask = leaf([1, 0, 0, 1, 5, 0]);
    const hits = [
      {
        leaf: leaf([1, 0, 0, 1, 0, 0], [[mask]]),
        target: 'button',
      },
    ] as unknown as Parameters<typeof findPointerTargetAt>[0];

    assert.strictEqual(findPointerTargetAt(hits, [7, 5]) as unknown, 'button');
    assert.strictEqual(findPointerTargetAt(hits, [2, 5]), undefined);
  });
});
