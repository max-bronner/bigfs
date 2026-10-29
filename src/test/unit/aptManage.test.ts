import * as assert from 'assert';
import { createAptMovie } from '../../formats/apt/aptCreate';
import { parseRu } from '../../formats/apt/aptGeometry';
import { referencesTo } from '../../formats/apt/aptManage';
import {
  parseAptMovie,
  parseConst,
  parseSpriteFrames,
} from '../../formats/apt/aptMovie';
import { applyAptEdit } from '../../formats/apt/writer/applyAptEdit';
import { AptImage } from '../../formats/apt/writer/aptImage';

suite('APT characters in use', () => {
  test('placements, exports and texture styles keep a character; removed, its slot is empty', () => {
    const created = createAptMovie({
      width: 10,
      height: 10,
      exports: ['Panel'],
    });
    const image = new AptImage(created.apt);
    const at = parseConst(created.constFile).movieOffset;
    const edit = (each: Parameters<typeof applyAptEdit>[2]) =>
      applyAptEdit(image, at, each);
    const shape = edit({ kind: 'addCharacter', type: 'shape' }).character!;
    const picture = edit({ kind: 'addCharacter', type: 'image' }).character!;
    const unused = edit({ kind: 'addCharacter', type: 'shape' }).character!;

    edit({
      kind: 'placeObject',
      timeline: 1,
      frame: 0,
      depth: 2,
      character: shape,
    });

    const references = (id: number) => {
      const movie = parseAptMovie(image.bytes, at);
      const spriteFrames = Object.fromEntries(
        movie.characters.flatMap((each) =>
          each.type === 'sprite'
            ? [[each.id, parseSpriteFrames(image.bytes, each)]]
            : [],
        ),
      );

      return referencesTo(
        movie,
        spriteFrames,
        {
          [shape]: parseRu(
            `c\ns tc:255:255:255:255:${picture}:1:0:0:1:0:0\nt 0:0:1:0:0:1\n`,
          ),
        },
        id,
      );
    };

    assert.deepStrictEqual(references(1), ['it is exported as "Panel"']);
    assert.deepStrictEqual(references(shape), [
      'frame 0 of #1 places it at @2',
    ]);
    assert.deepStrictEqual(references(picture), [
      `#${shape} samples it as a texture`,
    ]);
    assert.deepStrictEqual(references(unused), []);

    edit({ kind: 'removeCharacter', id: unused });

    const movie = parseAptMovie(image.bytes, at);

    assert.strictEqual(
      movie.characters.length,
      unused + 1,
      'later ids keep theirs',
    );
    assert.strictEqual(movie.characters[unused].type, 'placeholder');
    assert.strictEqual(movie.characters[shape].type, 'shape');
    assert.throws(
      () => edit({ kind: 'removeCharacter', id: 0 }),
      /no character #0/,
    );
  });
});
