import type { Character, Frame, Matrix2 } from '../../formats/apt/aptMovie';
import type { PageMovie } from './protocol';

/**
 * A colour transform as the game applies it: `out = c * mult + add`, each of
 * red, green, blue, alpha in 0-1 units. Ported from mint's apt-player
 * `ColorTransform`.
 */
export interface ColorTransform {
  mult: [number, number, number, number];
  add: [number, number, number, number];
}

export const IDENTITY_COLOR: ColorTransform = {
  mult: [1, 1, 1, 1],
  add: [0, 0, 0, 0],
};

/**
 * From a PlaceObject's two packed words: `mult` holds its channels in memory
 * order R, G, B, A; `add` is `0x00RRGGBB` and has no alpha term
 */
export const colorFromApt = (mult: number, add = 0): ColorTransform => ({
  mult: [
    (mult & 255) / 255,
    ((mult >>> 8) & 255) / 255,
    ((mult >>> 16) & 255) / 255,
    (mult >>> 24) / 255,
  ],
  add: [
    ((add >>> 16) & 255) / 255,
    ((add >>> 8) & 255) / 255,
    (add & 255) / 255,
    0,
  ],
});

/** The parent's transform followed by the child's: a child's add is scaled by the parent's mult */
export const concatColor = (
  parent: ColorTransform,
  child: ColorTransform,
): ColorTransform => ({
  mult: parent.mult.map((m, i) => m * child.mult[i]) as ColorTransform['mult'],
  add: parent.add.map(
    (a, i) => a + parent.mult[i] * child.add[i],
  ) as ColorTransform['add'],
});

/** Whether a transform leaves red, green and blue alone (alpha apart) */
export const isPlainColor = ({ mult, add }: ColorTransform): boolean =>
  mult[0] === 1 &&
  mult[1] === 1 &&
  mult[2] === 1 &&
  add[0] === 0 &&
  add[1] === 0 &&
  add[2] === 0;

/** A character on a display list, at its depth */
export interface Placement {
  depth: number;
  character: number;
  matrix: Matrix2;
  translate: [number, number];
  alpha: number;
  /** Its full colour transform; `alpha` is its multiply alpha */
  color: ColorTransform;
  name?: string;
  /** The frame this instance was placed in; a move keeps it, a new character does not */
  born: number;
  /** The PlaceObject that placed it, in frame `born` */
  placedItem: number;
  /** The last PlaceObject up to this frame that set its matrix: where moving it is written */
  matrixItem: number;
  /** For a mask: the deepest depth above it that it clips */
  clipDepth?: number;
  /** Its clip event handlers: `onClipEvent` blocks by event bits */
  clipActions?: { events: number; block: number }[];
}

/** Frames of a timeline: the movie's own, or a sprite's */
export const framesOf = (movie: PageMovie, character: Character): Frame[] =>
  character.type === 'movie'
    ? movie.frames
    : character.type === 'sprite'
      ? (movie.spriteFrames[character.id] ?? [])
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
              color: IDENTITY_COLOR,
              born: index,
              placedItem: item.offset,
              matrixItem: item.offset,
            }
          : {
              ...existing,
              born: replaces ? index : existing.born,
              placedItem: replaces ? item.offset : existing.placedItem,
            };

        if (item.character !== undefined) {
          next.character = item.character;
        }
        if (item.matrix) {
          next.matrix = item.matrix;
          next.translate = item.translate ?? [0, 0];
          next.matrixItem = item.offset;
        }
        if (item.colorTransform !== undefined) {
          next.color = colorFromApt(item.colorTransform, item.colorAdd);
          next.alpha = next.color.mult[3];
        }
        if (item.name !== undefined) {
          next.name = item.name;
        }
        if (item.clipDepth !== undefined) {
          next.clipDepth = item.clipDepth;
        }
        if (item.clipActions) {
          next.clipActions = item.clipActions;
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
