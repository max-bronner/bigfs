import { printMovieText } from '../printer';
import type { MovieText } from '../textModel';
import { TextSaveError } from './textSaveError';

/** The text as the save checks it: what a field edit cannot reach is left out */
const comparable = (movie: MovieText): string =>
  printMovieText(movie).replace(/ flags=0x[0-9a-f]+$/gm, '');

/** Where a printed line came from, best effort, for a problem the check found */
const lineOf = (movie: MovieText, printed: string | undefined): number => {
  const id = /^character (\d+)/.exec(printed ?? '')?.[1];

  return id !== undefined ? (movie.characters[Number(id)]?.line ?? 0) : 0;
};

/**
 * Checks that the movie a save made prints as the text asked for.
 * @throws TextSaveError at the first line that differs.
 */
export const checkSavedText = (after: MovieText, result: MovieText): void => {
  const wanted = comparable(after).split('\n');
  const made = comparable(result).split('\n');
  const differs = wanted.findIndex((line, index) => line !== made[index]);

  if (differs >= 0 || made.length !== wanted.length) {
    const index = differs >= 0 ? differs : wanted.length;

    throw new TextSaveError(
      `The movie cannot be made to read "${wanted[index] ?? ''}"; saving it gives "${made[index] ?? ''}"`,
      lineOf(after, wanted[index]),
    );
  }
};
