import * as assert from 'assert';
import { addTexture, setShapeGeometry } from '../../formats/apt/aptAssets';
import { createAptMovie } from '../../formats/apt/aptCreate';
import { fitRunTo, parseRu } from '../../formats/apt/aptGeometry';
import { checkMovie } from '../../formats/apt/aptIntegrity';
import { parseConst } from '../../formats/apt/aptMovie';
import { applyAptEdit } from '../../formats/apt/writer/applyAptEdit';
import { AptImage } from '../../formats/apt/writer/aptImage';

/** A small movie that holds together: an image with its texture, and a shape sampling it */
const buildIntactMovie = () => {
  const created = createAptMovie({
    width: 100,
    height: 100,
    exports: ['Panel'],
  });
  const image = new AptImage(created.apt);
  const at = parseConst(created.constFile).movieOffset;
  const files = new Map<string, Uint8Array>([
    ['Menu.const', created.constFile],
    ['Menu.dat', created.dat],
  ]);
  const texture = addTexture(
    image,
    at,
    'Menu',
    String.fromCharCode(...created.dat),
    {
      width: 4,
      height: 4,
      pixels: new Uint8Array(64),
    },
  );

  texture.files.forEach((bytes, path) => files.set(path, bytes));

  const shape = applyAptEdit(image, at, {
    kind: 'addCharacter',
    type: 'shape',
  }).character!;
  const [run] = parseRu('c\ns s:255:255:255:255\nt 0:0:4:0:0:4\n');

  setShapeGeometry(image, at, 'Menu', shape, [
    fitRunTo(run, texture.id, [0, 0, 4, 4]),
  ]).forEach((bytes, path) => files.set(path, bytes));
  return { image, at, files, texture: texture.id, shape };
};

const check = (image: AptImage, files: Map<string, Uint8Array>) =>
  checkMovie({
    name: 'Menu',
    apt: image.bytes,
    read: async (relative) =>
      [...files].find(
        ([path]) => path.toLowerCase() === relative.toLowerCase(),
      )?.[1],
    list: async (relative) => {
      const prefix = relative.toLowerCase() + '/';
      const names = [...files.keys()]
        .filter((path) => path.toLowerCase().startsWith(prefix))
        .map((path) => path.slice(prefix.length));

      return names.length ? names : undefined;
    },
  });

const messages = async (image: AptImage, files: Map<string, Uint8Array>) =>
  (await check(image, files)).map(
    (problem) => `${problem.severity}: ${problem.message}`,
  );

suite('APT integrity', () => {
  test('a movie that holds together has nothing to report', async () => {
    const { image, files } = buildIntactMovie();

    assert.deepStrictEqual(await messages(image, files), []);
  });

  test('missing and left over files are found, each once', async () => {
    const { image, files, texture, shape } = buildIntactMovie();

    files.delete(`art/textures/apt_menu_${texture}.tga`);
    files.delete(`Menu_geometry/${shape}.ru`);
    files.set('Menu_geometry/99.ru', new Uint8Array());
    files.set('art/textures/apt_menu_42.tga', new Uint8Array());

    assert.deepStrictEqual(await messages(image, files), [
      `error: #${texture} image: its texture art/textures/apt_menu_${texture}.tga is missing`,
      `error: #${shape} shape: its geometry Menu_geometry/${shape}.ru is missing`,
      'warning: Menu_geometry/99.ru belongs to no shape',
      'warning: art/textures/apt_menu_42.tga is used by no image',
    ]);
  });

  test('an image without a .dat line, and a style sampling a non-image, are errors', async () => {
    const { image, at, files, texture, shape } = buildIntactMovie();

    files.set(
      'Menu.dat',
      Uint8Array.from('; Created by AptToBigc.\r\n', (c) => c.charCodeAt(0)),
    );
    setShapeGeometry(image, at, 'Menu', shape, [
      fitRunTo(
        parseRu('c\ns s:1:1:1:1\nt 0:0:1:0:0:1\n')[0],
        shape,
        [0, 0, 1, 1],
      ),
    ]).forEach((bytes, path) => files.set(path, bytes));

    const found = await messages(image, files);

    assert.ok(
      found.includes(
        `error: #${texture} image: Menu.dat has no line for texture ${texture}`,
      ),
    );
    assert.ok(
      found.includes(
        `error: #${shape} shape: Menu_geometry/${shape}.ru samples #${shape}, which is not an image`,
      ),
    );
    assert.ok(
      found.includes(
        `warning: art/textures/apt_menu_${texture}.tga is used by no image`,
      ),
    );
  });

  test('without its .const the movie is reported as unloadable, and nothing else', async () => {
    const { image, files } = buildIntactMovie();

    files.delete('Menu.const');
    assert.deepStrictEqual(await messages(image, files), [
      'error: Menu.const is missing: the movie cannot be loaded',
    ]);
  });
});
