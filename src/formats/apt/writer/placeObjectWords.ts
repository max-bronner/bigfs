import { PLACE_FLAGS } from '../aptMovie';
import type { Matrix2 } from '../aptMovie';
import type { PlaceSpec } from '../aptTimeline';
import { AptImage } from './aptImage';

/** Encodes a new 64-byte PlaceObject record as words, with no colour transform */
export const encodePlaceObject = (
  flags: number,
  depth: number,
  character: number,
  matrix: Matrix2,
  translate: [number, number],
  name: number,
): number[] => {
  const f = (value: number) =>
    new Uint32Array(new Float32Array([value]).buffer)[0];

  return [
    3,
    flags,
    depth >>> 0,
    character,
    ...matrix.map(f),
    f(translate[0]),
    f(translate[1]),
    0xffffffff,
    0,
    f(0),
    name,
    0,
    0,
  ];
};

/** Encodes the PlaceObject record of a placement or a move, its flags set by the fields given */
export const encodePlaceSpec = (image: AptImage, place: PlaceSpec): number[] => {
  const f = (value: number) =>
    new Uint32Array(new Float32Array([value]).buffer)[0];
  const flags =
    (place.move ? PLACE_FLAGS.move : 0) |
    (place.character !== undefined ? PLACE_FLAGS.hasCharacter : 0) |
    (place.matrix ? PLACE_FLAGS.hasMatrix : 0) |
    (place.colorTransform !== undefined ? PLACE_FLAGS.hasColorTransform : 0) |
    (place.ratio !== undefined ? PLACE_FLAGS.hasRatio : 0) |
    (place.name ? PLACE_FLAGS.hasName : 0) |
    (place.clipDepth !== undefined ? PLACE_FLAGS.hasClipDepth : 0) |
    (place.clipActions ? PLACE_FLAGS.hasClipActions : 0);

  return [
    3,
    flags,
    place.depth >>> 0,
    place.character ?? 0,
    ...(place.matrix ?? [1, 0, 0, 1]).map(f),
    f(place.translate?.[0] ?? 0),
    f(place.translate?.[1] ?? 0),
    place.colorTransform ?? 0xffffffff,
    place.colorAdd ?? 0,
    f(place.ratio ?? 0),
    place.name ? image.appendString(place.name) : 0,
    (place.clipDepth ?? 0) >>> 0,
    place.clipActions ?? 0,
  ];
};
