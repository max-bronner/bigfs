import type { Instance } from './instance';
import { getLocalBounds } from './scene';
import type { HitArea, Leaf } from './scene';

/** Gets a point in a leaf's own space, or nothing when its matrix has collapsed */
const toLeafSpace = (
  { matrix: [a, b, c, d, tx, ty] }: Pick<Leaf, 'matrix'>,
  [x, y]: [number, number],
): [number, number] | undefined => {
  const det = a * d - b * c;

  return det
    ? [(d * (x - tx) - c * (y - ty)) / det, (a * (y - ty) - b * (x - tx)) / det]
    : undefined;
};

/** Whether a point is in a leaf's bounds */
const isInBounds = (leaf: Leaf, point: [number, number]): boolean => {
  const local = toLeafSpace(leaf, point);

  if (!local) {
    return false;
  }

  const [left, top, right, bottom] = getLocalBounds(leaf);

  return (
    local[0] >= left &&
    local[0] <= right &&
    local[1] >= top &&
    local[1] <= bottom
  );
};

const isInTriangle = (
  [px, py]: [number, number],
  triangles: ArrayLike<number>,
  at: number,
): boolean => {
  const [ax, ay, bx, by, cx, cy] = Array.from({ length: 6 }, (_, index) => triangles[at + index]);
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);

  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

/** Whether a leaf draws on a point: a shape by its triangles, the rest by their box */
export const isDrawnAt = (leaf: Leaf, point: [number, number]): boolean => {
  if (leaf.character?.type !== 'shape') {
    return isInBounds(leaf, point);
  }

  const local = toLeafSpace(leaf, point);

  return (
    !!local &&
    (leaf.movie.shapes[leaf.id] ?? []).some(({ triangles }) => {
      for (let at = 0; at < triangles.length; at += 6) {
        if (isInTriangle(local, triangles, at)) {
          return true;
        }
      }
      return false;
    })
  );
};

/**
 * Finds the topmost button or clip whose hit area is under a point, and not
 * masked away there. A hit area is its record's bounds: the shipped hit
 * shapes are bounds around empty geometry.
 */
export const findPointerTargetAt = (
  hits: readonly HitArea[],
  point: [number, number],
): Instance | undefined => {
  for (let index = hits.length - 1; index >= 0; index--) {
    const { leaf, target } = hits[index];

    if (
      isInBounds(leaf, point) &&
      (leaf.masks ?? []).every((mask) =>
        mask.some((each) => isInBounds(each, point)),
      )
    ) {
      return target;
    }
  }
  return undefined;
};
