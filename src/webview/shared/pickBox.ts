/** A rectangle as `[left, top, right, bottom]` */
export type Box = [number, number, number, number];

/** What a press on a box grabs: the whole box, or one corner with the corner opposite it held still */
export type BoxGrab =
  | 'move'
  | { anchor: [number, number]; handle: [number, number] };

/** Gets a box's corners, clockwise from the top left */
export const getBoxCorners = ([left, top, right, bottom]: Box): [
  number,
  number,
][] => [
  [left, top],
  [right, top],
  [right, bottom],
  [left, bottom],
];

/**
 * Finds what a press at `point` grabs: a corner within `reach`, else the box
 * itself when the point is inside it. `reach` is in the box's own units.
 */
export const pickBox = (
  box: Box,
  point: readonly [number, number],
  reach: number,
): BoxGrab | undefined => {
  const corners = getBoxCorners(box);
  const near = corners.findIndex(
    ([x, y]) => Math.hypot(x - point[0], y - point[1]) <= reach,
  );

  if (near >= 0) {
    return { anchor: corners[(near + 2) % 4], handle: corners[near] };
  }
  return point[0] >= box[0] &&
    point[0] <= box[2] &&
    point[1] >= box[1] &&
    point[1] <= box[3]
    ? 'move'
    : undefined;
};
