import * as assert from 'assert';
import { parseMappedImage } from '../../formats/mappedImage/mappedImage';
import {
  findMappedImageHeader,
  getCoordsEdit,
  readMappedImageBlock,
} from '../../formats/mappedImage/mappedImageEdit';
import {
  getMappedCoords,
  getMappedPixelRect,
} from '../../formats/mappedImage/mappedRegion';

const block = [
  '; header comment',
  'MappedImage Sample',
  '  Texture = sample.tga',
  '  TextureWidth = 512',
  '  TextureHeight = 256',
  '  Coords = Left:10 Top:20 Right:30 Bottom:40 ; kept',
  '  Status = ROTATED_90_CLOCKWISE',
  'End',
];

suite('MappedImage editing', () => {
  test('reads the block at a header and nothing at any other line', () => {
    const found = readMappedImageBlock(block, 1);

    assert.strictEqual(found?.image.name, 'Sample');
    assert.strictEqual(found?.endLine, 7);
    assert.strictEqual(readMappedImageBlock(block, 2), undefined);
    assert.strictEqual(readMappedImageBlock(block.slice(0, 7), 1), undefined);
  });

  test('a line finds the MappedImage header above it, but not through another block', () => {
    const lines = [
      'ParticleSystem Smoke',
      '  Texture = smoke.tga',
      'End',
      ...block,
    ];

    assert.strictEqual(findMappedImageHeader(lines, 7), 4);
    assert.strictEqual(findMappedImageHeader(lines, 4), 4);
    assert.strictEqual(findMappedImageHeader(lines, 1), undefined);
    assert.strictEqual(findMappedImageHeader(lines, 2), undefined);
  });

  test('replaces the Coords value and keeps the comment after it', () => {
    const edit = getCoordsEdit(block, 1, {
      left: 1,
      top: 2,
      right: 3,
      bottom: 4,
    });

    assert.ok(edit && !edit.insertsLine);

    const line = block[edit.line];
    const rewritten = `${line.slice(0, edit.start)}${edit.text}${line.slice(edit.end)}`;

    assert.strictEqual(
      rewritten,
      '  Coords = Left:1 Top:2 Right:3 Bottom:4 ; kept',
    );
    assert.deepStrictEqual(
      parseMappedImage('Sample', [rewritten]).coords,
      { left: 1, top: 2, right: 3, bottom: 4 },
    );
  });

  test('adds a Coords line before End, indented like Texture, when there is none', () => {
    const lines = [
      'MappedImage Bare',
      '\tTexture = bare.tga',
      'End',
    ];
    const edit = getCoordsEdit(lines, 0, {
      left: 0,
      top: 0,
      right: 8,
      bottom: 8,
    });

    assert.deepStrictEqual(edit, {
      line: 2,
      start: 0,
      end: 0,
      text: '\tCoords = Left:0 Top:0 Right:8 Bottom:8',
      insertsLine: true,
    });
  });

  test('pixels of a decoded texture map to the stated space and back', () => {
    const image = parseMappedImage('Sample', block.slice(2, 7));
    const decoded: [number, number] = [1024, 512];

    assert.deepStrictEqual(getMappedPixelRect(image, decoded), {
      left: 20,
      top: 40,
      right: 60,
      bottom: 80,
    });
    assert.deepStrictEqual(
      getMappedCoords(image, decoded, {
        left: 20,
        top: 40,
        right: 60,
        bottom: 80,
      }),
      { left: 10, top: 20, right: 30, bottom: 40 },
    );
  });

  test('an edited rect is ordered and kept inside the texture', () => {
    const image = parseMappedImage('Sample', block.slice(2, 7));

    assert.deepStrictEqual(
      getMappedCoords(image, [512, 256], {
        left: 600,
        top: 100,
        right: -5,
        bottom: 20.4,
      }),
      { left: 0, top: 20, right: 512, bottom: 100 },
    );
  });
});
