import type { Character } from '../../formats/apt/aptMovie';
import type { PageMovie } from './protocol';
import { state } from './state';

/** Imports filling imports deeper than this are a loop in the data */
const MAX_HOPS = 8;

/** Gets the key imports compare movie names by: lowercased, without `.apt` */
export const toMovieKey = (name: string): string =>
  name.toLowerCase().replace(/\.apt$/, '');

/** Finds the movie an import names: the shown one, or one it imports from */
export const findMovieNamed = (name: string): PageMovie | undefined => {
  const key = toMovieKey(name);

  return state.movie && toMovieKey(state.movie.name) === key
    ? state.movie
    : state.library.get(key);
};

/** A character a placeholder resolves to, with the movie and id it lives at */
export interface Resolved {
  movie: PageMovie;
  id: number;
  character: Character;
}

/**
 * Resolves what a character draws as: itself, or for an import placeholder the
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
    const target = entry && findMovieNamed(entry.movie);
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
