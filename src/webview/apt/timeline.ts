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
  /** The frame this instance was placed in; a move keeps it, a new character does not */
  born: number;
}

/** Frames of a timeline: the movie's own, or a sprite's */
export const framesOf = (movie: PageMovie, character: Character): Frame[] =>
  character.type === 'movie'
    ? movie.frames
    : character.type === 'sprite'
      ? (movie.spriteFrames[character.id] ?? [])
      : [];

/** Frames whose script stops the timeline, sorted */
export const stopsOf = (movie: PageMovie, character: Character): number[] =>
  character.type === 'movie' || character.type === 'sprite'
    ? (movie.stops[character.id] ?? [])
    : [];

/** Display lists already built, per timeline and frame */
const built = new WeakMap<Frame[], Map<number, Placement[]>>();

/** The display list after a timeline's frame, by depth, built up from frame 0 */
export const displayList = (frames: Frame[], frame: number): Placement[] => {
  let cache = built.get(frames);
  const known = cache?.get(frame);

  if (known) {
    return known;
  }

  type Entry = Omit<Placement, 'depth' | 'character'> & { character?: number };
  const list = new Map<number, Entry>();

  for (let index = 0; index <= frame && index < frames.length; index++) {
    for (const item of frames[index].items) {
      if (item.type === 'removeObject') {
        list.delete(item.depth);
      } else if (item.type === 'placeObject') {
        const existing = list.get(item.depth);
        const replaces =
          item.character !== undefined &&
          item.character !== existing?.character;
        const isNew = !(item.flags & 1) || !existing;
        const next: Entry = isNew
          ? {
              matrix: [1, 0, 0, 1],
              translate: [0, 0],
              alpha: 1,
              born: index,
            }
          : { ...existing, born: replaces ? index : existing.born };

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

  const placements = [...list.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, placement]) => ({
      depth,
      ...placement,
      character: placement.character!,
    }));

  if (!cache) {
    cache = new Map();
    built.set(frames, cache);
  }
  cache.set(frame, placements);
  return placements;
};

/** A timeline instance at a moment: the frame it shows, and its children's own clocks */
export interface TimelineAt {
  frame: number;
  placements: (Placement & { tick: number })[];
}

/**
 * Where a timeline instance is `tick` frames after it was placed, the way a
 * Flash player runs it: it advances one frame a tick from frame 0, holds on
 * the first frame whose script stops it (when `honourStops`), and otherwise
 * loops. A child plays from the frame it was placed in. When the parent
 * loops, a child placed in frame 0 and still there at the end keeps
 * playing, since the player keeps that instance; any other is placed again.
 */
export const timelineAt = (
  frames: Frame[],
  stops: number[],
  tick: number,
  honourStops: boolean,
): TimelineAt => {
  const count = frames.length;

  if (!count) {
    return { frame: 0, placements: [] };
  }

  const stop = honourStops ? stops[0] : undefined;
  const held = stop !== undefined && tick >= stop;
  const looping = !held && tick >= count;
  const frame = held ? stop : tick % count;
  const placements = displayList(frames, frame);
  const last = looping ? displayList(frames, count - 1) : [];

  return {
    frame,
    placements: placements.map((placement) => {
      const lasts =
        placement.born === 0 &&
        last.some(
          (each) =>
            each.depth === placement.depth &&
            each.born === 0 &&
            each.character === placement.character,
        );

      return {
        ...placement,
        tick: (looping && !lasts ? frame : tick) - placement.born,
      };
    }),
  };
};
