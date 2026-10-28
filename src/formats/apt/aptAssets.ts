import { encodeTga } from '../texture/textureEncode';
import {
  getTexturePath,
  parseDat,
  runBounds,
  writeDat,
  writeRu,
} from './aptGeometry';
import type { RuRun } from './aptGeometry';
import { parseAptMovie } from './aptMovie';
import { applyAptEdit } from './aptWriter';
import type { AptImage } from './aptWriter';

/**
 * Edits that reach past the `.apt` into the files beside it: a shape's
 * `.ru` geometry, and a new texture with its Image character, `.dat` line
 * and image file. Each returns the files to write, by path relative to the
 * movie's folder, and changes the `.apt` image in place.
 */

/** The largest side an imported texture may have */
export const MAX_TEXTURE = 4096;

const powerOfTwo = (value: number) => 2 ** Math.ceil(Math.log2(value));

/** A shape's geometry file, and its bounds set to the box the geometry covers */
export const setShapeGeometry = (
  image: AptImage,
  movieOffset: number,
  name: string,
  shape: number,
  runs: RuRun[],
): Map<string, Uint8Array> => {
  const character = parseAptMovie(image.bytes, movieOffset).characters[shape];

  if (character?.type !== 'shape') {
    throw new Error(`#${shape} is not a shape`);
  }

  const bounds = runBounds(runs);

  if (bounds) {
    applyAptEdit(image, movieOffset, {
      kind: 'character',
      id: shape,
      change: { field: 'bounds', value: bounds },
    });
  }
  return new Map([
    [
      `${name}_geometry/${character.geometry}.ru`,
      new TextEncoder().encode(writeRu(runs)),
    ],
  ]);
};

/**
 * A new texture as the shipped movies keep one: an Image character whose
 * texture id is its own id, a `.dat` line naming the used box, and the
 * image padded to powers of two. `dat` is the movie's `.dat` as it stands.
 */
export const addTexture = (
  image: AptImage,
  movieOffset: number,
  name: string,
  dat: string,
  texture: { width: number; height: number; pixels: Uint8Array },
): { id: number; files: Map<string, Uint8Array> } => {
  const { width, height, pixels } = texture;

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_TEXTURE ||
    height > MAX_TEXTURE ||
    pixels.length !== width * height * 4
  ) {
    throw new Error(`An image is 1 to ${MAX_TEXTURE} pixels a side`);
  }

  const id = applyAptEdit(image, movieOffset, {
    kind: 'addCharacter',
    type: 'image',
  }).character!;

  applyAptEdit(image, movieOffset, {
    kind: 'character',
    id,
    change: { field: 'texture', value: id },
  });

  const padded = { width: powerOfTwo(width), height: powerOfTwo(height) };
  const out = new Uint8Array(padded.width * padded.height * 4);

  for (let row = 0; row < height; row++) {
    out.set(
      pixels.subarray(row * width * 4, (row + 1) * width * 4),
      row * padded.width * 4,
    );
  }

  const entries = parseDat(dat);
  const location = {
    kind: 'standalone' as const,
    rect: [0, 0, width, height] as [number, number, number, number],
  };

  entries.set(id, location);
  return {
    id,
    files: new Map([
      [
        `${name}.dat`,
        Uint8Array.from(writeDat(entries), (c) => c.charCodeAt(0)),
      ],
      [
        getTexturePath(name, id, location),
        encodeTga({ ...padded, pixels: out }, true),
      ],
    ]),
  };
};
