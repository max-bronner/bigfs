import type { Character, Frame, Matrix2 } from '../../formats/apt/aptMovie';
import type { PageMovie } from './protocol';

/** A character on a display list, at its depth */
export interface Placement {
  depth: number;
  character: number;
  matrix: Matrix2;
  translate: [number, number];
  alpha: number;
  name?: string;
}

/** Frames of a timeline: the movie's own, or a sprite's */
export const framesOf = (movie: PageMovie, character: Character): Frame[] =>
  character.type === 'movie'
    ? movie.frames
    : character.type === 'sprite'
      ? (movie.spriteFrames[character.id] ?? [])
      : [];

/** The display list after a timeline's frame, by depth, built up from frame 0 */
export const displayList = (frames: Frame[], frame: number): Placement[] => {
  type Entry = Omit<Placement, 'depth' | 'character'> & { character?: number };
  const list = new Map<number, Entry>();

  for (let index = 0; index <= frame && index < frames.length; index++) {
    for (const item of frames[index].items) {
      if (item.type === 'removeObject') {
        list.delete(item.depth);
      } else if (item.type === 'placeObject') {
        const existing = list.get(item.depth);
        const isNew = !(item.flags & 1) || !existing;
        const next: Entry = isNew
          ? {
              matrix: [1, 0, 0, 1] as Matrix2,
              translate: [0, 0] as [number, number],
              alpha: 1,
            }
          : { ...existing };

        if (item.character !== undefined) {
          next.character = item.character;
        }
        if (item.matrix) {
          next.matrix = item.matrix;
          next.translate = item.translate ?? [0, 0];
        }
        if (item.colorTransform !== undefined) {
          next.alpha = (item.colorTransform >>> 24) / 255;
        }
        if (item.name !== undefined) {
          next.name = item.name;
        }
        if (next.character !== undefined) {
          list.set(item.depth, next);
        }
      }
    }
  }

  return [...list.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, placement]) => ({
      depth,
      ...placement,
      character: placement.character!,
    }));
};
