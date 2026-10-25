import type { Character } from '../../formats/apt/aptMovie';
import type { PageMovie } from './protocol';
import { state } from './state';

/** Imports filling imports deeper than this are a loop in the data */
const MAX_HOPS = 8;

/** A movie name as imports compare it: no casing, no `.apt` */
export const movieKey = (name: string): string =>
  name.toLowerCase().replace(/\.apt$/, '');

/** The movie an import names: the shown one, or one it imports from */
export const movieNamed = (name: string): PageMovie | undefined => {
  const key = movieKey(name);

  return state.movie && movieKey(state.movie.name) === key
    ? state.movie
    : state.library.get(key);
};

export interface Resolved {
  movie: PageMovie;
  id: number;
  character: Character;
}

/**
 * What a character draws as: itself, or for an import placeholder the
 * character the named movie exports under that name, followed through
 * imports of imports. Names compare without casing and the first export
 * of a name wins, as in the game. Nothing when the import does not resolve.
 */
export const resolve = (movie: PageMovie, id: number): Resolved | undefined => {
  let current: Resolved | undefined = movie.characters[id] && {
    movie,
    id,
    character: movie.characters[id],
  };

  for (let hop = 0; current?.character.type === 'placeholder'; hop++) {
    const from: PageMovie = current.movie;
    const slot: number = current.id;
    const entry = from.imports.find((each) => each.character === slot);
    const target = entry && movieNamed(entry.movie);
    const exported = target?.exports.find(
      (each) => each.name.toLowerCase() === entry!.name.toLowerCase(),
    );
    const character: Character | undefined =
      exported && target!.characters[exported.character];

    current =
      hop < MAX_HOPS && exported && character
        ? { movie: target!, id: exported.character, character }
        : undefined;
  }
  return current;
};
