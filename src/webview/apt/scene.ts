import type { Character, Rect } from '../../formats/apt/aptMovie';
import type { PageMovie } from './protocol';
import { resolve } from './resolve';
import { state } from './state';
import { framesOf, stopsOf, timelineAt } from './timeline';

/**
 * The display tree of a character at a moment, flattened to the things
 * that draw: every shape, image and text with its absolute transform. The
 * stage paints from it, and every box it shows is measured from it, so what
 * is drawn and what is measured cannot disagree.
 */

/** Nesting deeper than this is a loop in the data, not a real movie */
const MAX_DEPTH = 12;

/** The box an import that does not resolve draws */
export const UNRESOLVED: Rect = [0, 0, 64, 24];

/** a, b, c, d, tx, ty as canvas `transform` takes them */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export const multiply = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** One thing that draws, where it draws */
export interface Leaf {
  movie: PageMovie;
  id: number;
  /** Absent for an import nothing fills, which draws as a marker */
  character?: Character;
  /** The import's `movie:name`, for one nothing fills */
  missing?: string;
  matrix: Affine;
  alpha: number;
  /** The depth chain of instances down to it, `/` separated */
  path: string;
  /** The depth of the root's child it is drawn inside, if any */
  top?: number;
}

export interface SceneOptions {
  /** Whether nested timelines hold on a frame that stops them */
  honourStops: boolean;
  /** Which of a button's records draw, by instance path: bit 0 up, 1 over, 2 down */
  buttonState?: (path: string) => number;
}

/**
 * Flattens what `id` draws `tick` frames into its timeline. The root plays
 * its own frames straight through, so every frame can be inspected; nested
 * timelines run as the player runs them.
 */
export const collect = (
  source: PageMovie,
  id: number,
  tick: number,
  options: SceneOptions,
): Leaf[] => {
  const out: Leaf[] = [];

  const visit = (
    from: PageMovie,
    cid: number,
    matrix: Affine,
    alpha: number,
    depth: number,
    at: number,
    path: string,
    top: number | undefined,
  ): void => {
    if (depth > MAX_DEPTH) {
      return;
    }

    const found = resolve(from, cid);

    if (!found) {
      const entry = from.imports.find((each) => each.character === cid);

      if (entry || from.characters[cid]?.type === 'placeholder') {
        out.push({
          movie: from,
          id: cid,
          missing: entry ? `${entry.movie}:${entry.name}` : 'import',
          matrix,
          alpha,
          path,
          top,
        });
      }
      return;
    }

    const { movie, id: own, character } = found;

    switch (character.type) {
      case 'sprite':
      case 'movie': {
        const isRoot = depth === 0;
        const timeline = timelineAt(
          framesOf(movie, character),
          stopsOf(movie, character),
          at,
          !isRoot && options.honourStops,
        );

        for (const placement of timeline.placements) {
          visit(
            movie,
            placement.character,
            multiply(matrix, [...placement.matrix, ...placement.translate]),
            alpha * placement.alpha,
            depth + 1,
            placement.tick,
            `${path}/${placement.depth}`,
            top ?? placement.depth,
          );
        }
        break;
      }
      case 'button': {
        const shown = options.buttonState?.(path) ?? 1;

        for (const record of character.records) {
          if (record.flags & shown) {
            visit(
              movie,
              record.character,
              multiply(matrix, [...record.matrix, ...record.translate]),
              alpha,
              depth + 1,
              at,
              `${path}/b${record.depth}`,
              top,
            );
          }
        }
        break;
      }
      case 'shape':
      case 'image':
      case 'editText':
      case 'text':
        out.push({ movie, id: own, character, matrix, alpha, path, top });
        break;
    }
  };

  visit(source, id, IDENTITY, 1, 0, tick, '', undefined);
  return out;
};

/** The box a leaf covers in its own space */
export const localBounds = (leaf: Leaf): Rect => {
  const { character } = leaf;

  if (!character) {
    return UNRESOLVED;
  }
  if ('bounds' in character) {
    return character.bounds;
  }

  const texture = state.textures.get(leaf.movie.imageTextures[leaf.id]);

  return [0, 0, texture?.width ?? 64, texture?.height ?? 64];
};

/** The box around a rectangle once transformed */
export const transformRect = (m: Affine, [l, t, r, b]: Rect): Rect => {
  const xs = [l, r, l, r].map(
    (x, i) => m[0] * x + m[2] * [t, t, b, b][i] + m[4],
  );
  const ys = [l, r, l, r].map(
    (x, i) => m[1] * x + m[3] * [t, t, b, b][i] + m[5],
  );

  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** The smallest box around several, or nothing for none */
export const union = (boxes: Rect[]): Rect | undefined =>
  boxes.length
    ? [
        Math.min(...boxes.map((box) => box[0])),
        Math.min(...boxes.map((box) => box[1])),
        Math.max(...boxes.map((box) => box[2])),
        Math.max(...boxes.map((box) => box[3])),
      ]
    : undefined;

/** The box around everything the leaves draw */
export const boundsOf = (leaves: Leaf[]): Rect | undefined =>
  union(leaves.map((leaf) => transformRect(leaf.matrix, localBounds(leaf))));
