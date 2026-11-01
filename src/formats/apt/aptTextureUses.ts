import { getRunTextureBox, getTexturePath } from './aptGeometry';
import type { DatLocation, RuRun, TextureBox } from './aptGeometry';
import type { Character } from './aptMovie';

/**
 * Which part of which texture a movie's shapes sample. A texture style names
 * an Image character; the movie's `.dat` says which `apt_<movie>_<n>` file
 * that image's pixels are in; the style's transform then puts the run's
 * points on that file, and the box around them is the region used.
 */

/** A texture file's name split into the movie it belongs to and its number */
export interface AptTextureName {
  movie: string;
  id: number;
}

/** One texture style of a `.ru` file and the part of its texture it samples */
export interface RunSample {
  /** Index among the file's runs, which is its style's index in file order */
  run: number;
  /** The Image character the style names */
  image: number;
  /** The texture file's path as the `.dat` gives it, when the image has one */
  texture?: string;
  /** In pixels of the texture */
  box: TextureBox;
}

/** Splits `apt_<movie>_<n>.tga`, the name a movie's texture is stored under, or gives nothing for any other file */
export const parseAptTextureName = (
  fileName: string,
): AptTextureName | undefined => {
  const match = /^apt_(.+)_(\d+)\.(?:tga|dds)$/i.exec(
    fileName.slice(fileName.search(/[^\\/]*$/)),
  );

  return match ? { movie: match[1].toLowerCase(), id: Number(match[2]) } : undefined;
};

/** Gets the texture path of each Image character of a movie that its `.dat` places */
export const getImageTextures = (
  movie: string,
  characters: readonly Character[],
  dat: ReadonlyMap<number, DatLocation>,
): Map<number, string> => {
  const paths = new Map<number, string>();

  for (const character of characters) {
    const location =
      character.type === 'image' ? dat.get(character.texture) : undefined;

    if (character.type === 'image' && location) {
      paths.set(character.id, getTexturePath(movie, character.texture, location));
    }
  }
  return paths;
};

/** Lists the part of a texture each texture style among some runs samples */
export const getRunSamples = (
  runs: readonly RuRun[],
  imageTextures: ReadonlyMap<number, string>,
): RunSample[] =>
  runs.flatMap((run, index) => {
    const box = getRunTextureBox(run);

    return run.style.kind === 'texture' && box
      ? [
          {
            run: index,
            image: run.style.character,
            texture: imageTextures.get(run.style.character),
            box,
          },
        ]
      : [];
  });

/** Whether a texture path from a `.dat` and a file name are the same texture, whichever extension each has */
export const isSameTexture = (path: string, fileName: string): boolean => {
  const stem = (name: string) =>
    name
      .slice(name.search(/[^\\/]*$/))
      .replace(/\.[^.]*$/, '')
      .toLowerCase();

  return stem(path) === stem(fileName);
};
