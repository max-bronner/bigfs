import type { Vec3 } from '../../../formats/w3d/w3dPose';

/** Line colour, red, green, blue and alpha from 0 to 1 */
export type LineColor = [number, number, number, number];

/** Appends a segment to line vertices, xyz rgba each */
export const pushLine = (
  out: number[],
  a: Vec3,
  b: Vec3,
  color: LineColor,
): void => {
  out.push(...a, ...color, ...b, ...color);
};
