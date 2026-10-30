import type { RuRun } from './aptGeometry';
import type { AptMovie, Frame } from './aptMovie';

/**
 * Lists, in words, everything in a movie that refers to one character. A
 * character is removed only when this is empty: its id is a slot others
 * point at, and removing it under them would break them silently.
 */
export const findReferencesTo = (
  movie: AptMovie,
  spriteFrames: Record<number, Frame[]>,
  shapes: Record<number, RuRun[]>,
  id: number,
): string[] => {
  const found: string[] = [];
  const timelines: [number, Frame[]][] = [
    [0, movie.frames],
    ...Object.entries(spriteFrames).map(
      ([owner, frames]): [number, Frame[]] => [Number(owner), frames],
    ),
  ];

  for (const [owner, frames] of timelines) {
    frames.forEach((frame, index) => {
      for (const item of frame.items) {
        if (item.type === 'placeObject' && item.character === id) {
          found.push(`frame ${index} of #${owner} places it at @${item.depth}`);
        }
        if (item.type === 'initAction' && item.sprite === id) {
          found.push(`frame ${index} of #${owner} initialises it`);
        }
      }
    });
  }
  for (const character of movie.characters) {
    if (character.type === 'button') {
      character.records.forEach((record, index) => {
        if (record.character === id) {
          found.push(`#${character.id} shows it in record ${index}`);
        }
      });
    }
    if (character.type === 'editText' && character.font === id) {
      found.push(`#${character.id} uses it as its font`);
    }
  }
  for (const [shape, runs] of Object.entries(shapes)) {
    if (
      runs.some(
        (run) => run.style.kind === 'texture' && run.style.character === id,
      )
    ) {
      found.push(`#${shape} samples it as a texture`);
    }
  }
  for (const entry of movie.exports) {
    if (entry.character === id) {
      found.push(`it is exported as "${entry.name}"`);
    }
  }
  for (const entry of movie.imports) {
    if (entry.character === id) {
      found.push(`the import ${entry.movie}:${entry.name} fills it`);
    }
  }
  return found;
};
