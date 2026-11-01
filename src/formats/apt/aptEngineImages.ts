/**
 * The pictures the engine supplies to surfaces no movie names. A retail
 * `RenderImage` usually holds a magenta square and no name: which image goes
 * there is the game's, in code. Each default here is the one mint's hosts bind,
 * and the Engine panel lets the user change it.
 */

/** Surface key the shell background is kept under, which no clip has */
export const BACKDROP_KEY = 'SetBackground';

/** Engine call a movie makes to show the shell background behind it */
export const BACKDROP_CALL = 'FSCommand:SetBackground';

/** Image value that fills a surface with black */
export const BLACK = 'black';

/** Image value that leaves a surface empty */
export const NONE = 'none';

/** An image the engine supplies, and how sure that is */
export interface EngineImage {
  /** Which surface keys take it */
  key: RegExp;
  /** A `MappedImage` name, a texture file, `BLACK` or `NONE` */
  image: string;
  /** Why this image: nothing in the game's data binds one to the surface */
  basis: string;
}

/** What the engine supplies where nothing is bound; a live game replaces some of these */
export const ENGINE_IMAGES: readonly EngineImage[] = [
  {
    key: /^MainMenu\.Image$/i,
    image: 'LogoWithShadow',
    basis: 'inferred from retail, as mint binds it',
  },
  {
    key: /^RenderFactionIcon$/i,
    image: 'AptIconMen',
    basis: "inferred: AptIcon plus the player's side",
  },
  {
    key: /(^|\.)Portrait$/i,
    image: BLACK,
    basis: 'inferred: black until something is selected',
  },
  {
    key: new RegExp(`^${BACKDROP_KEY}$`, 'i'),
    image: 'ShellMapLowLOD',
    basis: 'inferred: the shell background with the shell map off',
  },
];

/** The variables a surface's picture is keyed by */
export interface SurfaceNames {
  type?: string;
  imageName?: string;
  imageMap?: string;
}

const isPlainImageType = (type: string | undefined): boolean =>
  /^renderimage(disabled)?$/i.test(type?.trim() ?? '');

/**
 * Gets the key a surface's picture goes by, in the order mint's host pulls
 * content: `_imageMap`, `_imageName`, then a `_type` of its own. A plain
 * `RenderImage` says nothing else about itself, so it goes by where it stands.
 */
export const getSurfaceKey = (
  { type, imageName, imageMap }: SurfaceNames,
  movie: string,
  path: string,
): string =>
  imageMap?.trim() ||
  imageName?.trim() ||
  (type?.trim() && !isPlainImageType(type) ? type.trim() : `${movie}.${path}`);

/** Finds what the engine supplies to a surface key */
export const findEngineImage = (key: string): EngineImage | undefined =>
  ENGINE_IMAGES.find((each) => each.key.test(key));

/** Whether an image surface draws its picture in grey, as a disabled button's does */
export const drawsGrey = (names: SurfaceNames & { mode?: string }): boolean =>
  /^grayscale$/i.test(names.mode?.trim() ?? '') ||
  /^renderimagedisabled$/i.test(names.type?.trim() ?? '');

/** Whether an image value names a texture file rather than a `MappedImage` */
export const isTextureFile = (image: string): boolean =>
  /\.(tga|dds|jpe?g)$/i.test(image.trim());
