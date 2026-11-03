import * as assert from 'assert';
import {
  imageExtent,
  isRotated,
  mappedUv,
  parseMappedImage,
} from '../../formats/mappedImage/mappedImage';

const indentLines = (...lines: string[]) => lines.map((line) => `  ${line}`);

suite('MappedImage', () => {
  test('Coords are divided by the stated texture size', () => {
    const image = parseMappedImage(
      'Sample',
      indentLines(
        'Texture = sample.tga',
        'TextureWidth = 512',
        'TextureHeight = 512',
        'Coords = Left:292 Top:254 Right:326 Bottom:288',
        'Status = NONE',
      ),
    );

    assert.strictEqual(image.texture, 'sample.tga');
    assert.deepStrictEqual(mappedUv(image, [1024, 1024]), [
      292 / 512,
      254 / 512,
      34 / 512,
      34 / 512,
    ]);
  });

  test('an unstated texture size is the decoded one, and no Coords is the whole texture', () => {
    const image = parseMappedImage(
      'Sample',
      indentLines('Coords = Left:0 Top:0 Right:64 Bottom:32'),
    );

    assert.deepStrictEqual(mappedUv(image, [128, 128]), [0, 0, 0.5, 0.25]);
    assert.deepStrictEqual(
      mappedUv(parseMappedImage('Empty', []), [8, 8]),
      [0, 0, 1, 1],
    );
  });

  test('a rotated image swaps the extent it draws at', () => {
    const lines = indentLines('Coords = Left:0 Top:0 Right:40 Bottom:10');
    const plain = parseMappedImage('Plain', lines);
    const turned = parseMappedImage('Turned', [
      ...lines,
      '  Status = ROTATED_90_CLOCKWISE',
    ]);

    assert.strictEqual(isRotated(plain), false);
    assert.strictEqual(isRotated(turned), true);
    assert.deepStrictEqual(imageExtent(plain), [40, 10]);
    assert.deepStrictEqual(imageExtent(turned), [10, 40]);
  });
});
