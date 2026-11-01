import * as assert from 'assert';
import {
  findRuStyleLines,
  formatRuStyle,
  getRunTextureBox,
  parseRu,
  setRunTextureBox,
} from '../../formats/apt/aptGeometry';
import type { DatLocation } from '../../formats/apt/aptGeometry';
import {
  getImageTextures,
  getRunSamples,
  isSameTexture,
  parseAptTextureName,
} from '../../formats/apt/aptTextureUses';
import type { Character } from '../../formats/apt/aptMovie';

const ru = [
  'c',
  's s:255:0:0:255',
  't 0:0:4:0:0:4',
  'c',
  's tc:255:255:255:255:7:2:0:0:2:10:20',
  't 0:0:10:0:0:10',
  't 10:0:10:10:0:10',
  'c',
  // Turned a quarter: u runs down the shape's y, v along its x
  's tc:255:255:255:255:9:0:2:-2:0:100:50',
  't 0:0:10:0:0:5',
].join('\n');

suite('APT texture regions', () => {
  test('a texture style samples the box its points land on', () => {
    const runs = parseRu(ru);

    assert.strictEqual(getRunTextureBox(runs[0]), undefined);
    assert.deepStrictEqual(getRunTextureBox(runs[1]), [10, 20, 30, 40]);
    assert.deepStrictEqual(getRunTextureBox(runs[2]), [90, 50, 100, 70]);
  });

  test('style lines are found in the order runs are read', () => {
    assert.deepStrictEqual(findRuStyleLines(ru), [1, 4, 8]);
  });

  test('moving the box rescales the mapping and keeps a turn', () => {
    const [, plain, turned] = parseRu(ru);
    const moved = setRunTextureBox(plain, [0, 0, 10, 10]);
    const movedTurned = setRunTextureBox(turned, [0, 0, 5, 5]);

    assert.deepStrictEqual(getRunTextureBox(moved), [0, 0, 10, 10]);
    assert.deepStrictEqual(
      moved.style.kind === 'texture' && moved.style.transform,
      [1, 0, 0, 1, 0, 0],
    );
    assert.deepStrictEqual(getRunTextureBox(movedTurned), [0, 0, 5, 5]);
    assert.ok(
      movedTurned.style.kind === 'texture' &&
        movedTurned.style.transform[0] === 0 &&
        movedTurned.style.transform[3] === 0,
    );
  });

  test('a rewritten style line parses back to the same style', () => {
    const [, plain] = parseRu(ru);
    const line = formatRuStyle(setRunTextureBox(plain, [3, 4, 33, 44]).style);

    assert.strictEqual(parseRu(`c\n${line}\nt 0:0:10:0:0:10`)[0].style.kind, 'texture');
    assert.deepStrictEqual(
      getRunTextureBox({ ...plain, style: parseRu(`${line}`)[0].style }),
      [3, 4, 33, 44],
    );
  });

  test('image characters find their textures through the dat', () => {
    const characters = [
      { id: 7, offset: 0, type: 'image', texture: 7 },
      { id: 8, offset: 0, type: 'image', texture: 8 },
      { id: 9, offset: 0, type: 'image', texture: 5 },
    ] as Character[];
    const dat = new Map<number, DatLocation>([
      [7, { kind: 'atlas', page: 2 }],
      [8, { kind: 'standalone', rect: [0, 0, 8, 8] }],
    ]);
    const textures = getImageTextures('Main', characters, dat);

    assert.strictEqual(textures.get(7), 'art/textures/apt_main_2.tga');
    assert.strictEqual(textures.get(8), 'art/textures/apt_main_8.tga');
    assert.strictEqual(textures.has(9), false);

    const samples = getRunSamples(parseRu(ru), textures);

    assert.deepStrictEqual(
      samples.map(({ run, image, texture }) => [run, image, texture]),
      [
        [1, 7, 'art/textures/apt_main_2.tga'],
        [2, 9, undefined],
      ],
    );
  });

  test('texture names split into movie and number, whichever the extension', () => {
    assert.deepStrictEqual(parseAptTextureName('apt_main_menu_12.tga'), {
      movie: 'main_menu',
      id: 12,
    });
    assert.deepStrictEqual(parseAptTextureName('Art/Textures/APT_Hud_3.DDS'), {
      movie: 'hud',
      id: 3,
    });
    assert.strictEqual(parseAptTextureName('hud_3.tga'), undefined);
    assert.ok(isSameTexture('art/textures/apt_hud_3.tga', 'APT_HUD_3.dds'));
    assert.ok(!isSameTexture('art/textures/apt_hud_3.tga', 'apt_hud_4.tga'));
  });
});
