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

/** The matrix that undoes another; the identity for one that cannot be undone */
export const invert = ([a, b, c, d, tx, ty]: Affine): Affine => {
  const det = a * d - b * c;

  if (!det) {
    return IDENTITY;
  }
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * ty - d * tx) / det,
    (b * tx - a * ty) / det,
  ];
};

export const apply = (
  [a, b, c, d, tx, ty]: Affine,
  [x, y]: [number, number],
): [number, number] => [a * x + c * y + tx, b * x + d * y + ty];

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
  /**
   * The masks it is drawn through, outermost first: it shows only where
   * every one of them draws. Each mask is the leaves of one masking
   * instance, whose shapes together are its area.
   */
  masks?: Leaf[][];
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
    masks: Leaf[][] = [],
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
        ...(masks.length ? { masks } : {}),
      });
      return;
    }

    const place = (child: Instance) =>
      multiply(matrix, [...child.matrix, ...child.translate] as Affine);

    // A child with a clip depth is a mask: not drawn, it bounds the
    // children above it up to that depth (SWF's PlaceObject ClipDepth)
    const open: { until: number; leaves: Leaf[] }[] = [];

    for (const [key, child] of instance.children) {
      const depth = Number(key);
      const childTop = top ?? (instance === player.root ? depth : undefined);

      if (child.clipDepth !== undefined) {
        const area: Leaf[] = [];

        visit(child, place(child), 1, childTop, area, masks);
        open.push({ until: child.clipDepth, leaves: area });
        continue;
      }
      visit(child, place(child), alpha * child.alpha, childTop, out, [
        ...masks,
        ...open
          .filter((mask) => Number.isNaN(depth) || depth <= mask.until)
          .map((mask) => mask.leaves),
      ]);
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

/** Where two boxes overlap, or nothing */
const intersect = (a: Rect, b: Rect): Rect | undefined => {
  const box: Rect = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];

  return box[0] < box[2] && box[1] < box[3] ? box : undefined;
};

/** The box a leaf covers, cut to its masks unless they are not applied */
const leafBounds = (leaf: Leaf, masked: boolean): Rect | undefined => {
  let box: Rect | undefined = transformRect(leaf.matrix, localBounds(leaf));

  for (const mask of masked ? (leaf.masks ?? []) : []) {
    const area = boundsOf(mask, true);

    box = box && area && intersect(box, area);
  }
  return box;
};

/**
 * The box around everything the leaves draw; with `masked`, only what
 * their masks let show
 */
export const boundsOf = (leaves: Leaf[], masked = false): Rect | undefined =>
  union(
    leaves.flatMap((leaf) => {
      const box = leafBounds(leaf, masked);

      return box ? [box] : [];
    }),
  );
