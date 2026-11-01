import type { BoxGrab } from './pickBox';

/**
 * Gets the factors a box grown by a corner drag is scaled by about the opposite
 * corner, per axis. `uniform` keeps the shape by using the larger factor on both.
 */
export const getResizeScale = (
  grab: Exclude<BoxGrab, 'move'>,
  point: readonly [number, number],
  uniform: boolean,
): [number, number] => {
  const [anchorX, anchorY] = grab.anchor;
  const [handleX, handleY] = grab.handle;
  const scaleX = (point[0] - anchorX) / (handleX - anchorX || 1);
  const scaleY = (point[1] - anchorY) / (handleY - anchorY || 1);

  const larger = Math.max(Math.abs(scaleX), Math.abs(scaleY));

  return uniform ? [larger, larger] : [scaleX, scaleY];
};
