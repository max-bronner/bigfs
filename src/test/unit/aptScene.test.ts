/// <reference lib="dom" />
// The scene and paint modules are webview code and name DOM types; the test only runs their pure parts.
import * as assert from 'assert';
import type { FrameItem } from '../../formats/apt/aptMovie';
import { layoutText } from '../../webview/apt/paint';
import { Player } from '../../webview/apt/player';
import type { PageMovie } from '../../webview/apt/protocol';
import { resolve } from '../../webview/apt/resolve';
import { collect, textureOf } from '../../webview/apt/scene';
import { state } from '../../webview/apt/state';
import { colorFromApt, concatColor } from '../../webview/apt/timeline';

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

const synthetic = (parts: Partial<PageMovie>): PageMovie =>
  ({
    name: 'Synth',
    record: { screenWidth: 100, screenHeight: 100 },
    characters: [],
    imports: [],
    exports: [],
    frames: [],
    spriteFrames: {},
    shapes: {},
    imageTextures: {},
    imageLocations: {},
    behaviours: {},
    ...parts,
  }) as unknown as PageMovie;

const playerOf = (movie: PageMovie) =>
  new Player(movie, 0, {
    resolve,
    scripts: false,
    rootScripts: false,
  });

const sprite = (id: number) => ({ id, offset: 0, type: 'sprite' });
const shape = (id: number) => ({
  id,
  offset: 0,
  type: 'shape',
  bounds: [0, 0, 10, 10],
});

suite('APT scene', () => {
  teardown(() => {
    state.library.clear();
    state.textures.clear();
    state.movie = undefined;
  });

  test("a texture fill naming an import placeholder takes the exporting movie's texture", () => {
    const exporter = synthetic({
      name: 'Art',
      characters: [{ id: 0 }, { id: 1, offset: 0, type: 'image', texture: 1 }],
      exports: [{ name: 'Panel', character: 1 }],
      imageTextures: { 1: 'art/panel.tga' },
    } as unknown as Partial<PageMovie>);
    const shown = synthetic({
      characters: [
        { id: 0 },
        { id: 1, offset: 0, type: 'placeholder' },
      ] as never,
      imports: [{ character: 1, movie: 'Art.apt', name: 'panel' }],
      imageTextures: {},
    } as unknown as Partial<PageMovie>);
    const pixels = { width: 8, height: 8 } as HTMLCanvasElement;

    state.library.set('art', exporter);
    state.textures.set('art/panel.tga', pixels);

    assert.strictEqual(shown.imageTextures[1], undefined);
    assert.strictEqual(textureOf(shown, 1), pixels);
    assert.strictEqual(textureOf(shown, 9), undefined, 'an unknown id');
  });

  test('colour transforms nest as mint concatenates them, not as alpha alone', () => {
    const tint = { colorTransform: 0x80ffffff, colorAdd: 0x0000ff00 };
    const movie = synthetic({
      characters: [{ id: 0, offset: 0, type: 'movie' }, sprite(1), shape(2)],
      frames: [{ items: [place(1, 1, tint)] }],
      spriteFrames: { 1: [{ items: [place(1, 2, tint)] }] },
    } as unknown as Partial<PageMovie>);
    const { leaves } = collect(playerOf(movie));
    const expected = concatColor(
      colorFromApt(0x80ffffff, 0x0000ff00),
      colorFromApt(0x80ffffff, 0x0000ff00),
    );
    const half = 128 / 255;

    assert.strictEqual(leaves.length, 1);
    assert.deepStrictEqual(leaves[0].color, expected);
    assert.deepStrictEqual(leaves[0].color.mult, [1, 1, 1, half * half]);
    assert.deepStrictEqual(leaves[0].color.add, [0, 2, 0, 0]);
    assert.strictEqual(leaves[0].alpha, half * half);
  });

  test('an empty clip placed with a clip depth masks nothing', () => {
    const movie = synthetic({
      characters: [
        { id: 0, offset: 0, type: 'movie' },
        sprite(1),
        sprite(2),
        shape(3),
      ],
      frames: [
        {
          items: [
            place(1, 1, { clipDepth: 5 }),
            place(2, 2, { clipDepth: 5 }),
            place(3, 3),
          ],
        },
      ],
      spriteFrames: { 1: [{ items: [] }], 2: [{ items: [place(1, 3)] }] },
    } as unknown as Partial<PageMovie>);
    const { leaves } = collect(playerOf(movie));
    const covered = leaves.find((leaf) => leaf.top === 3)!;

    assert.strictEqual(
      covered.masks?.length,
      1,
      'only the clip with something in it is a mask',
    );
  });
});

suite('APT text layout', () => {
  const measure = (line: string) => line.length * 5;
  const field = (extra: Record<string, unknown>) =>
    ({
      type: 'editText',
      bounds: [0, 0, 100, 20],
      font: 0,
      alignment: 0,
      color: 0xffffffff,
      fontHeight: 10,
      readonly: 0,
      multiline: 0,
      wordwrap: 0,
      ...extra,
    }) as never;

  test('a single line sits centred in its box by its own width', () => {
    const { lines, baseline } = layoutText(
      field({ alignment: 2 }),
      'abcd',
      measure,
    );

    assert.strictEqual(baseline, 'middle');
    assert.deepStrictEqual(lines, [{ text: 'abcd', x: 40, y: 10 }]);
  });

  test('a multiline wordwrap field wraps at the gutter, breaks on \\r, and hangs from the top', () => {
    const { lines, baseline } = layoutText(
      field({
        bounds: [0, 0, 50, 100],
        multiline: 1,
        wordwrap: 1,
      }),
      'aaa bbb ccc\rddd',
      measure,
    );

    assert.strictEqual(baseline, 'top');
    assert.deepStrictEqual(
      lines.map((line) => line.text),
      ['aaa bbb', 'ccc', 'ddd'],
    );
    assert.deepStrictEqual(
      lines.map((line) => [line.x, line.y]),
      [
        [2, 2],
        [2, 13.5],
        [2, 25],
      ],
    );
  });
});
