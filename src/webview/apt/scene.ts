import type { Character, Rect } from '../../formats/apt/aptMovie';
import type { Instance, Player } from './player';
import type { PageMovie } from './protocol';
import { state } from './state';

/**
 * The display tree of a character at a moment, flattened to the things
 * that draw: every shape, image and text with its absolute transform. The
 * stage paints from it, and every box it shows is measured from it, so what
 * is drawn and what is measured cannot disagree.
 */

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
  /** The instance that draws it */
  instance: Instance;
  /** The depth of the root's child it is drawn inside, if any */
  top?: number;
}

/** Where a button can be pointed at: one of its hit-test records' leaves */
export interface HitArea {
  leaf: Leaf;
  button: Instance;
}

/** What a player shows right now, flattened in paint order, with button hit areas */
export const collect = (
  player: Player,
): { leaves: Leaf[]; hits: HitArea[] } => {
  const leaves: Leaf[] = [];
  const hits: HitArea[] = [];

  const visit = (
    instance: Instance,
    matrix: Affine,
    alpha: number,
    top: number | undefined,
    out: Leaf[],
  ): void => {
    const { character } = instance;

    if (
      !character ||
      ['shape', 'image', 'editText', 'text'].includes(character.type)
    ) {
      out.push({
        movie: instance.movie,
        id: instance.id,
        character,
        missing: instance.missing,
        matrix,
        alpha,
        instance,
        top,
      });
      return;
    }

    const place = (child: Instance) =>
      multiply(matrix, [...child.matrix, ...child.translate] as Affine);

    for (const [key, child] of instance.children) {
      visit(
        child,
        place(child),
        alpha * child.alpha,
        top ?? (instance === player.root ? Number(key) : undefined),
        out,
      );
    }
    if (character.type === 'button') {
      for (const hit of instance.hits) {
        const area: Leaf[] = [];

        visit(hit, place(hit), alpha, top, area);
        hits.push(...area.map((leaf) => ({ leaf, button: instance })));
      }
    }
  };

  visit(player.root, IDENTITY, 1, undefined, leaves);
  return { leaves, hits };
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
