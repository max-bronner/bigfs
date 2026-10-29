import * as assert from 'assert';
import { addTexture, setShapeGeometry } from '../../formats/apt/aptAssets';
import { createAptMovie } from '../../formats/apt/aptCreate';
import { parseDat, parseRu } from '../../formats/apt/aptGeometry';
import type { RuRun } from '../../formats/apt/aptGeometry';
import { parseAptMovie, parseConst } from '../../formats/apt/aptMovie';
import { applyAptEdit } from '../../formats/apt/writer/applyAptEdit';
import { AptImage } from '../../formats/apt/writer/aptImage';
import { decodeTga } from '../../formats/texture/textureTools';

const newMovie = () => {
  const files = createAptMovie({ width: 100, height: 100, exports: [] });
  const image = new AptImage(files.apt);
  const movieOffset = parseConst(files.constFile).movieOffset;

  return { image, movieOffset };
};

suite('APT files beside the movie', () => {
  test("a shape's geometry is written as its .ru, and its bounds follow", () => {
    const { image, movieOffset } = newMovie();
    const shape = applyAptEdit(image, movieOffset, {
      kind: 'addCharacter',
      type: 'shape',
    }).character!;
    const runs: RuRun[] = [
      {
        style: {
          kind: 'texture',
          color: [255, 255, 255, 255],
          character: 3,
          transform: [0.5, 0, 0, 0.5, 4, 2.25],
        },
        triangles: [-10, 0, 30, 0, -10, 20.5],
        lines: [],
      },
    ];
    const files = setShapeGeometry(image, movieOffset, 'Menu', shape, runs);
    const character = parseAptMovie(image.bytes, movieOffset).characters[shape];
    const [[path, bytes]] = files;

    assert.strictEqual(
      path,
      `Menu_geometry/${character.type === 'shape' && character.geometry}.ru`,
    );
    assert.deepStrictEqual(parseRu(new TextDecoder().decode(bytes)), runs);
    assert.deepStrictEqual(
      character.type === 'shape' && character.bounds,
      [-10, 0, 30, 20.5],
    );
  });

  test('an imported texture is a new Image, a .dat line and a padded image file', () => {
    const { image, movieOffset } = newMovie();
    const pixels = new Uint8Array(5 * 3 * 4).map((_, index) => index);
    const { id, files } = addTexture(
      image,
      movieOffset,
      'Menu',
      '; Created by AptToBigc.\r\n1=0 0 8 8\r\n; Created by AptToBigc.\r\n2->1\r\n',
      { width: 5, height: 3, pixels },
    );
    const character = parseAptMovie(image.bytes, movieOffset).characters[id];
    const dat = parseDat(String.fromCharCode(...files.get('Menu.dat')!));
    const tga = decodeTga(files.get(`art/textures/apt_menu_${id}.tga`)!)
      .levels[0];

    assert.deepStrictEqual(character.type === 'image' && character.texture, id);
    assert.deepStrictEqual(dat.get(id), {
      kind: 'standalone',
      rect: [0, 0, 5, 3],
    });
    assert.deepStrictEqual(dat.get(2), { kind: 'atlas', page: 1 });
    assert.deepStrictEqual([tga.width, tga.height], [8, 4]);
    assert.deepStrictEqual(
      [...tga.pixels.subarray(8 * 4 * 2, 8 * 4 * 2 + 20)],
      [...pixels.subarray(5 * 4 * 2, 5 * 4 * 3)],
      'the third row lands where it was, padding to its right',
    );
  });
});
