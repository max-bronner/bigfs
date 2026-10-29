import * as assert from 'assert';
import { createAptMovie } from '../../formats/apt/aptCreate';
import { parseDat } from '../../formats/apt/aptGeometry';
import { parseAptMovie, parseConst } from '../../formats/apt/aptMovie';
import { applyAptEdit } from '../../formats/apt/writer/applyAptEdit';
import { AptImage } from '../../formats/apt/writer/aptImage';

suite('New APT movies', () => {
  test('a new movie reads back with its screen and exported sprites', () => {
    const files = createAptMovie({
      width: 800,
      height: 600,
      exports: ['PanelA', 'ButtonB'],
    });
    const parsed = parseConst(files.constFile);
    const movie = parseAptMovie(files.apt, parsed.movieOffset);

    assert.strictEqual(parsed.items.length, 0);
    assert.strictEqual(movie.record.screenWidth, 800);
    assert.strictEqual(movie.record.screenHeight, 600);
    assert.deepStrictEqual(
      movie.characters.map((character) => character.type),
      ['movie', 'sprite', 'sprite'],
    );
    assert.deepStrictEqual(movie.exports, [
      { name: 'PanelA', character: 1 },
      { name: 'ButtonB', character: 2 },
    ]);
    assert.strictEqual(movie.frames.length, 1);
    assert.strictEqual(parseDat(new TextDecoder().decode(files.dat)).size, 0);
    assert.throws(
      () => createAptMovie({ width: 1, height: 1, exports: ['a', 'a'] }),
      /"a"/,
    );
  });

  test('a root movie imports a new movie export as a new character', () => {
    const files = createAptMovie({ width: 1024, height: 768, exports: [] });
    const offset = parseConst(files.constFile).movieOffset;
    const image = new AptImage(files.apt);
    const first = applyAptEdit(image, offset, {
      kind: 'addImport',
      movie: 'Library',
      name: 'PanelA',
    });

    applyAptEdit(image, offset, {
      kind: 'addImport',
      movie: 'Library',
      name: 'ButtonB',
    });

    let movie = parseAptMovie(image.bytes, offset);

    assert.strictEqual(first.character, 1);
    assert.deepStrictEqual(movie.imports, [
      { movie: 'Library', name: 'PanelA', character: 1 },
      { movie: 'Library', name: 'ButtonB', character: 2 },
    ]);
    assert.deepStrictEqual(
      movie.characters.map((character) => character.type),
      ['movie', 'placeholder', 'placeholder'],
    );

    applyAptEdit(image, offset, { kind: 'removeImport', index: 0 });
    movie = parseAptMovie(image.bytes, offset);

    assert.deepStrictEqual(movie.imports, [
      { movie: 'Library', name: 'ButtonB', character: 2 },
    ]);
  });
});
