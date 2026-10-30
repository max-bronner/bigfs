import type { Character, Rect } from '../../formats/apt/aptMovie';
import type { Instance, Player } from './player';
import type { PageMovie } from './protocol';
import { resolve } from './resolve';
import { state } from './state';
import {
  IDENTITY_COLOR,
  concatColor,
  buildDisplayList,
  type ColorTransform,
} from './timeline';

/**
 * The display tree of a character at a moment, flattened to the things
 * that draw: every shape, image and text with its absolute transform. The
 * stage paints from it, and every box it shows is measured from it, so what
 * is drawn and what is measured cannot disagree.
 */

/** The box an import that does not resolve draws */
export const UNRESOLVED: Rect = [0, 0, 64, 24];

/** 2D affine matrix in the order canvas `transform` takes it: a, b, c, d, tx, ty */
export type Affine = [number, number, number, number, number, number];

/** Matrix that leaves every point where it is */
export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** Multiplies two matrices: the result applies `n` first, then `m` */
export const multiply = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Inverts a matrix; the identity for one that cannot be undone */
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

/** Transforms a point by a matrix */
export const apply = (
  [a, b, c, d, tx, ty]: Affine,
  [x, y]: [number, number],
): [number, number] => [a * x + c * y + tx, b * x + d * y + ty];

/** A shape, image or text that draws, with the transform and colour it draws with */
export interface Leaf {
  movie: PageMovie;
  id: number;
  /** Absent for an import nothing fills, which draws as a marker */
  character?: Character;
  /** The import's `movie:name`, for one nothing fills */
  missing?: string;
  matrix: Affine;
  /** Its accumulated alpha: `color.mult[3]` */
  alpha: number;
  /** Its accumulated colour transform down the display tree */
  color: ColorTransform;
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
  /** A text field's text as scripts left it, when they did */
  text?: string;
}

/** Pointer target of a button: one of its hit-test records' leaves */
export interface HitArea {
  leaf: Leaf;
  button: Instance;
}

/**
 * Gets the colour transform an instance places itself with: the timeline's
 * red, green, blue and add terms, and the instance's own alpha, which a
 * script may have changed
 */
export const getPlacedColor = (child: Instance): ColorTransform => {
  const depth = Number(child.path.split('/').pop());
  const placement =
    child.parent && !child.dynamic && Number.isInteger(depth)
      ? buildDisplayList(child.parent.frames, child.parent.frame).find(
          (each) =>
            each.depth === depth &&
            each.born === child.born &&
            each.character === child.placed,
        )
      : undefined;
  const { mult, add } = child.tint ?? placement?.color ?? IDENTITY_COLOR;

  return { mult: [mult[0], mult[1], mult[2], child.alpha], add };
};

/** Collects what a player shows right now, flattened in paint order, with button hit areas */
export const collect = (
  player: Player,
): { leaves: Leaf[]; hits: HitArea[] } => {
  const leaves: Leaf[] = [];
  const hits: HitArea[] = [];

  const visit = (
    instance: Instance,
    matrix: Affine,
    color: ColorTransform,
    top: number | undefined,
    out: Leaf[],
    masks: Leaf[][] = [],
  ): void => {
    const { character } = instance;

    if (instance.visible === false) {
      return;
    }
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
        alpha: color.mult[3],
        color,
        instance,
        top,
        ...(masks.length ? { masks } : {}),
        ...(character?.type === 'editText'
          ? { text: player.textOf(instance) }
          : {}),
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

      // A clip with nothing in it is no mask: it draws nothing, and every
      // child above it still shows (mint's apt-player `allow_as_mask`)
      const emptyClip =
        child.children.size === 0 &&
        ['sprite', 'movie'].includes(child.character?.type ?? '');

      if (child.clipDepth !== undefined && !emptyClip) {
        const area: Leaf[] = [];

        visit(child, place(child), IDENTITY_COLOR, childTop, area, masks);
        open.push({ until: child.clipDepth, leaves: area });
        continue;
      }
      visit(
        child,
        place(child),
        concatColor(color, getPlacedColor(child)),
        childTop,
        out,
        [
        ...masks,
        ...open
          .filter((mask) => Number.isNaN(depth) || depth <= mask.until)
          .map((mask) => mask.leaves),
      ]);
    }
    if (character.type === 'button') {
      for (const hit of instance.hits) {
        const area: Leaf[] = [];

        visit(hit, place(hit), color, top, area);
        hits.push(...area.map((leaf) => ({ leaf, button: instance })));
      }
    }
  };

  visit(player.root, IDENTITY, IDENTITY_COLOR, undefined, leaves);
  return { leaves, hits };
};

/**
 * Gets the texture an image character draws: an import placeholder takes the
 * texture of the character the exporting movie names, as mint's apt-viewer
 * resolves it through the library
 */
export const getImageTexture = (
  movie: PageMovie,
  id: number,
): HTMLCanvasElement | undefined => {
  const found = resolve(movie, id);

  return found && state.textures.get(found.movie.imageTextures[found.id]);
};

/** Gets the box a leaf covers in its own space */
export const getLocalBounds = (leaf: Leaf): Rect => {
  const { character } = leaf;

  if (!character) {
    return UNRESOLVED;
  }
  if ('bounds' in character) {
    return character.bounds;
  }

  const texture = getImageTexture(leaf.movie, leaf.id);

  return [0, 0, texture?.width ?? 64, texture?.height ?? 64];
};

/** Transforms a rectangle, giving the box around the result */
export const transformRect = (m: Affine, [l, t, r, b]: Rect): Rect => {
  const xs = [l, r, l, r].map(
    (x, i) => m[0] * x + m[2] * [t, t, b, b][i] + m[4],
  );
  const ys = [l, r, l, r].map(
    (x, i) => m[1] * x + m[3] * [t, t, b, b][i] + m[5],
  );

  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** Gets the smallest box around several, or nothing for none */
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
  let box: Rect | undefined = transformRect(leaf.matrix, getLocalBounds(leaf));

  for (const mask of masked ? (leaf.masks ?? []) : []) {
    const area = getLeafBounds(mask, true);

    box = box && area && intersect(box, area);
  }
  return box;
};

/**
 * Gets the box around everything the leaves draw; with `masked`, only what
 * their masks let show
 */
export const getLeafBounds = (leaves: Leaf[], masked = false): Rect | undefined =>
  union(
    leaves.flatMap((leaf) => {
      const box = leafBounds(leaf, masked);

      return box ? [box] : [];
    }),
  );
