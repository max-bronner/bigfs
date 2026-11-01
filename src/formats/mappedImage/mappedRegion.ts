import type { MappedImage, MappedRect } from './mappedImage';

/**
 * Converts between a definition's `Coords`, written in the `TextureWidth` ×
 * `TextureHeight` space it states, and the pixels of the texture file as
 * decoded, which is what an editor draws. A rotated image's `Coords` are the
 * rect as packed on the page, so both directions leave rotation alone.
 */

type TextureSize = Pick<MappedImage, 'textureWidth' | 'textureHeight'>;

/** Ratio of the decoded texture to the space the definition states, per axis */
const getScale = (
  image: TextureSize,
  decoded: readonly [number, number],
): [number, number] => [
  decoded[0] / Math.max(image.textureWidth ?? decoded[0], 1),
  decoded[1] / Math.max(image.textureHeight ?? decoded[1], 1),
];

/** Gets the rect `Coords` cover in the decoded texture's pixels, or none when there are no `Coords` */
export const getMappedPixelRect = (
  image: Pick<MappedImage, 'coords' | 'textureWidth' | 'textureHeight'>,
  decoded: readonly [number, number],
): MappedRect | undefined => {
  if (!image.coords) {
    return undefined;
  }

  const [scaleX, scaleY] = getScale(image, decoded);

  return {
    left: image.coords.left * scaleX,
    top: image.coords.top * scaleY,
    right: image.coords.right * scaleX,
    bottom: image.coords.bottom * scaleY,
  };
};

/**
 * Converts a rect in decoded pixels to the whole-number `Coords` of the
 * definition's stated space, clamped to the texture and ordered so the left
 * edge is not past the right
 */
export const getMappedCoords = (
  image: TextureSize,
  decoded: readonly [number, number],
  pixels: MappedRect,
): MappedRect => {
  const [scaleX, scaleY] = getScale(image, decoded);
  const width = Math.max(image.textureWidth ?? decoded[0], 1);
  const height = Math.max(image.textureHeight ?? decoded[1], 1);
  const clamp = (value: number, limit: number) =>
    Math.min(limit, Math.max(0, Math.round(value)));
  const [left, right] = [pixels.left, pixels.right]
    .map((edge) => clamp(edge / scaleX, width))
    .sort((a, b) => a - b);
  const [top, bottom] = [pixels.top, pixels.bottom]
    .map((edge) => clamp(edge / scaleY, height))
    .sort((a, b) => a - b);

  return { left, top, right, bottom };
};
